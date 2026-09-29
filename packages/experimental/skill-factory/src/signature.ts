/**
 * Deterministic keyword signatures for distilled task patterns. Mixed
 * CJK/Latin text is tokenized into CJK bigrams plus lowercase Latin words and
 * numbers, so shared vocabulary matches regardless of spacing or case.
 * Similarity is the dot product of L2-normalized term-frequency vectors.
 * @module @deepseek-ai/dsh-experimental-skill-factory/signature
 */

/** Whether one code point belongs to a script written without word separators. */
function isUnspacedScript(code: number): boolean {
  return (code >= 0x3040 && code <= 0x30ff) // kana
    || (code >= 0x3400 && code <= 0x4dbf) // CJK extension A
    || (code >= 0x4e00 && code <= 0x9fff) // CJK unified ideographs
    || (code >= 0xac00 && code <= 0xd7af) // hangul syllables
    || (code >= 0xf900 && code <= 0xfaff) // CJK compatibility ideographs
}

const LATIN_WORD = /[\p{L}\p{N}]/u

/**
 * Tokenize text into CJK bigrams plus lowercase Latin words and numbers.
 * A single unspaced character contributes itself; separators split tokens.
 * @param text - Source text; case is folded.
 * @returns tokens in source order, with duplicates preserved.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()
  let latin = ''
  let unspaced: string[] = []
  const flushLatin = (): void => {
    if (latin.length === 0) return
    // A single Latin letter carries no routing signal; a single digit does.
    if (latin.length > 1 || /\d/u.test(latin)) tokens.push(latin)
    latin = ''
  }
  const flushUnspaced = (): void => {
    if (unspaced.length === 1) {
      tokens.push(unspaced[0] as string)
    } else {
      for (let index = 0; index + 1 < unspaced.length; index += 1) {
        tokens.push(`${unspaced[index] as string}${unspaced[index + 1] as string}`)
      }
    }
    unspaced = []
  }
  for (const char of lower) {
    const code = char.codePointAt(0) ?? 0
    if (isUnspacedScript(code)) {
      flushLatin()
      unspaced.push(char)
      continue
    }
    if (LATIN_WORD.test(char)) {
      flushUnspaced()
      latin += char
      continue
    }
    flushLatin()
    flushUnspaced()
  }
  flushLatin()
  flushUnspaced()
  return tokens
}

/**
 * Build an L2-normalized term-frequency vector. Normalization makes the
 * {@link cosine} dot product the cosine similarity.
 * @param tokens - Tokens from {@link tokenize}.
 * @returns term weight per token; an empty result for an empty token list.
 */
export function termFrequency(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  let sumSquares = 0
  for (const count of counts.values()) sumSquares += count * count
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return new Map()
  const vector = new Map<string, number>()
  for (const [token, count] of counts) vector.set(token, count / norm)
  return vector
}

/**
 * Cosine similarity of two L2-normalized vectors: their dot product.
 * @param a - Normalized vector.
 * @param b - Normalized vector.
 * @returns Similarity in `[0, 1]`.
 */
export function cosine(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [token, weight] of small) {
    const other = large.get(token)
    if (other !== undefined) dot += weight * other
  }
  return dot > 1 ? 1 : dot
}

/** The pattern fields that make up one signature. */
export interface SignatureInput {
  /** One-line intent statement; weighted heaviest. */
  intent: string
  /** Output-structure classification, carried as its own structural token. */
  docType: string
  /** Key action steps. */
  actions: readonly string[]
  /** Inputs the task consumed. */
  inputs: readonly string[]
  /** Outputs the task produced. */
  outputs: readonly string[]
  /** Tool names used. */
  tools: readonly string[]
}

/**
 * Build one pattern's signature vector. The intent is repeated so it weighs
 * twice the structural fields, and the classification contributes one token.
 * @param input - Pattern fields to sign.
 * @returns Normalized term-frequency vector.
 */
export function patternSignature(input: SignatureInput): Map<string, number> {
  return termFrequency(tokenize([
    input.intent,
    input.intent,
    input.actions.join(' '),
    input.outputs.join(' '),
    input.inputs.join(' '),
    input.tools.join(' '),
    input.docType,
  ].join('\n')))
}

/**
 * Mean of one member-to-centroid cosine list; `0` for an empty list.
 * @param centroid - Unit centroid the members are compared against.
 * @param members - Member signature vectors.
 * @returns the mean similarity, or `0` when there are no members.
 */
export function meanSimilarity(centroid: ReadonlyMap<string, number>, members: readonly ReadonlyMap<string, number>[]): number {
  if (members.length === 0) return 0
  let total = 0
  for (const member of members) total += cosine(centroid, member)
  return total / members.length
}

/**
 * Fold one new member into a running centroid and renormalize, so the
 * centroid stays a unit vector the dot product can compare against.
 * @param centroid - Current unit centroid, or `undefined` to start from the member.
 * @param member - New member vector.
 * @param memberCount - Members already folded into `centroid`.
 * @returns The updated unit centroid.
 */
export function foldCentroid(
  centroid: ReadonlyMap<string, number> | undefined,
  member: ReadonlyMap<string, number>,
  memberCount: number,
): Map<string, number> {
  if (centroid === undefined || memberCount === 0) return new Map(member)
  const merged = new Map<string, number>()
  for (const [token, weight] of centroid) merged.set(token, weight * memberCount)
  for (const [token, weight] of member) merged.set(token, (merged.get(token) ?? 0) + weight)
  let sumSquares = 0
  for (const weight of merged.values()) sumSquares += weight * weight
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return new Map()
  for (const [token, weight] of merged) merged.set(token, weight / norm)
  return merged
}

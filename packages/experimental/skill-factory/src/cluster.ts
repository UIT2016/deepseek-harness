/**
 * Deterministic greedy clustering and the evidence gate that turns pattern
 * groups into candidates. Clustering is order-dependent but deterministic for
 * a fixed input order; the gate is a pure function of cluster membership and
 * the configured thresholds.
 * @module @deepseek-ai/dsh-experimental-skill-factory/cluster
 */

import type { EvidencedPattern, SkillDocType } from './types.ts'
import { cosine, foldCentroid, meanSimilarity, patternSignature, type SignatureInput } from './signature.ts'

/** One pattern paired with its signature vector. */
export interface SignedPattern {
  /** The evidenced pattern. */
  pattern: EvidencedPattern
  /** Its normalized signature vector. */
  signature: Map<string, number>
}

/** One cluster of signed patterns with its running centroid. */
export interface PatternCluster {
  /** Members in discovery order. */
  members: SignedPattern[]
  /** Unit centroid folded from the members. */
  centroid: Map<string, number>
}

/**
 * Sign one evidenced pattern.
 * @param pattern - Pattern to sign.
 * @returns the pattern paired with its normalized signature vector.
 */
export function signPattern(pattern: EvidencedPattern): SignedPattern {
  const input: SignatureInput = {
    intent: pattern.intent,
    docType: pattern.docType,
    actions: pattern.actions,
    inputs: pattern.inputs,
    outputs: pattern.outputs,
    tools: pattern.tools,
  }
  return { pattern, signature: patternSignature(input) }
}

/**
 * Greedy single-pass clustering: each pattern joins the most similar cluster
 * whose centroid similarity reaches the threshold, otherwise it starts a new
 * cluster. The centroid is updated after each assignment.
 * @param signed - Signed patterns in a deterministic order.
 * @param similarityThreshold - Minimum centroid similarity that joins a cluster.
 * @returns clusters in first-member discovery order.
 */
export function clusterPatterns(signed: readonly SignedPattern[], similarityThreshold: number): PatternCluster[] {
  const clusters: PatternCluster[] = []
  for (const member of signed) {
    let best: PatternCluster | undefined
    let bestScore = -1
    for (const cluster of clusters) {
      const score = cosine(cluster.centroid, member.signature)
      if (score > bestScore) {
        bestScore = score
        best = cluster
      }
    }
    if (best !== undefined && bestScore >= similarityThreshold) {
      best.members.push(member)
      best.centroid = foldCentroid(best.centroid, member.signature, best.members.length - 1)
      continue
    }
    clusters.push({ members: [member], centroid: new Map(member.signature) })
  }
  return clusters
}

/**
 * Majority classification of a cluster, ties resolving to `mixed`.
 * @param cluster - Cluster to classify.
 * @returns the winning classification, or `mixed` on a tie.
 */
export function clusterDocType(cluster: PatternCluster): SkillDocType {
  const counts = new Map<SkillDocType, number>()
  for (const member of cluster.members) {
    const kind = member.pattern.docType
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  let winner: SkillDocType = 'mixed'
  let winnerCount = 0
  let tied = false
  for (const [kind, count] of counts) {
    if (count > winnerCount) {
      winner = kind
      winnerCount = count
      tied = false
    } else if (count === winnerCount) {
      tied = true
    }
  }
  return tied ? 'mixed' : winner
}

/** The evidence verdict for one cluster. */
export interface ClusterGate {
  /** Whether the cluster becomes a candidate. */
  passed: boolean
  /** Distinct sessions among the members. */
  distinctSessions: number
  /** Mean member-to-centroid similarity. */
  meanSimilarity: number
  /** `meanSimilarity` scaled by evidence completeness, in `[0, 1]`. */
  score: number
  /** Winning classification. */
  docType: SkillDocType
  /** Why the cluster failed the gate, when it did. */
  reason?: string
}

/**
 * The threshold a classification must meet.
 * @param docType - Winning classification of the cluster.
 * @param config - Configured document and workflow thresholds.
 * @returns the minimum mean similarity the cluster must reach.
 */
export function requiredSimilarity(docType: SkillDocType, config: { agreementThreshold: number; taskThreshold: number }): number {
  switch (docType) {
    case 'document':
      return config.agreementThreshold
    case 'workflow':
      return config.taskThreshold
    case 'mixed':
      // A mixed candidate promises both kinds of reuse, so it must clear both.
      return Math.max(config.agreementThreshold, config.taskThreshold)
  }
}

/**
 * Apply the evidence gate: enough distinct sessions and enough internal
 * similarity for the cluster's classification.
 * @param cluster - Cluster to judge.
 * @param config - Threshold configuration.
 * @returns the verdict, including the reason when it fails.
 */
export function gateCluster(
  cluster: PatternCluster,
  config: { agreementThreshold: number; taskThreshold: number; minEvidenceSessions: number },
): ClusterGate {
  const sessions = new Set<string>()
  const signatures: Map<string, number>[] = []
  for (const member of cluster.members) {
    sessions.add(member.pattern.sessionId)
    signatures.push(member.signature)
  }
  const docType = clusterDocType(cluster)
  const mean = meanSimilarity(cluster.centroid, signatures)
  const distinctSessions = sessions.size
  const completeness = Math.min(1, distinctSessions / Math.max(1, config.minEvidenceSessions))
  const score = mean * completeness
  if (distinctSessions < config.minEvidenceSessions) {
    return {
      passed: false,
      distinctSessions,
      meanSimilarity: mean,
      score,
      docType,
      reason: `only ${distinctSessions} distinct session${distinctSessions === 1 ? '' : 's'}; ${config.minEvidenceSessions} required`,
    }
  }
  const required = requiredSimilarity(docType, config)
  if (mean < required) {
    return {
      passed: false,
      distinctSessions,
      meanSimilarity: mean,
      score,
      docType,
      reason: `mean similarity ${mean.toFixed(2)} below the ${docType} threshold ${required}`,
    }
  }
  return { passed: true, distinctSessions, meanSimilarity: mean, score, docType }
}

/**
 * Sessions that look similar to a cluster but stayed below the joining
 * threshold: the opposing evidence a reviewer needs to judge the candidate.
 * @param cluster - The winning cluster.
 * @param signed - Every signed pattern in the run.
 * @param similarityThreshold - The joining threshold.
 * @returns distinct session ids of near-miss patterns outside the cluster.
 */
export function opposingSessions(
  cluster: PatternCluster,
  signed: readonly SignedPattern[],
  similarityThreshold: number,
): string[] {
  const memberIds = new Set(cluster.members.map(member => member.pattern.patternId))
  const floor = similarityThreshold / 2
  const sessions = new Set<string>()
  for (const candidate of signed) {
    if (memberIds.has(candidate.pattern.patternId)) continue
    const score = cosine(cluster.centroid, candidate.signature)
    if (score >= floor && score < similarityThreshold) sessions.add(candidate.pattern.sessionId)
  }
  return [...sessions]
}

/**
 * Deterministic cluster id from the sorted member pattern ids.
 * @param patternIds - Member pattern ids.
 * @returns a stable, filesystem-safe id.
 */
export function stableClusterId(patternIds: readonly string[]): string {
  const sorted = [...patternIds].sort()
  // FNV-1a over the sorted ids: stable across runs and platforms, and short
  // enough to read in a report.
  let hash = 0x811c9dc5
  for (const id of sorted) {
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0x1f
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `c${hash.toString(16).padStart(8, '0')}-${sorted.length}`
}

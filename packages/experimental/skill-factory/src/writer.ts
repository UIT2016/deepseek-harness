/**
 * Settling one authored candidate on disk: name validation, the skill-root
 * layout, the update policy for a name that already exists, and the review
 * file that a `propose` settlement leaves for the user. Every path this module
 * writes is inside the configured skill root or the workspace's
 * `.dsh/skill-factory` directory; nothing else in the workspace is touched.
 * @module @deepseek-ai/dsh-experimental-skill-factory/writer
 */

import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CandidateAction, SkillDocType } from './types.ts'
import { assembleSkillMarkdown, isSkillName, normalizeSkillName, type SkillDraft } from './templates.ts'

/** The outcome of settling one candidate on disk. */
export interface WriteOutcome {
  /** Disposition of the candidate. */
  action: CandidateAction
  /** Written SKILL.md path when the file was written. */
  path?: string
  /** Written review path when the update policy proposed instead of writing. */
  reviewPath?: string
  /** Reason for a rejection or a skip. */
  reason?: string
  /** Assembled SKILL.md content, present whenever a draft was accepted for writing or review. */
  content?: string
  /** Diff summary recorded with a proposal. */
  diff?: string
  /** Content hash (16 hex characters) used as the version stamp. */
  contentHash: string
}

/** Inputs for one settlement. */
export interface SettleRequest {
  /** Absolute root the skill file and the review directory are written under (the project root, not necessarily the session cwd). */
  workspace: string
  /** Resolved harness home, used when the skill root is `user`. */
  dshHome: string
  /** Root selection. */
  skillRoot: 'workspace' | 'user'
  /** Update policy for an existing name. */
  updatePolicy: 'propose' | 'replace' | 'skip-existing'
  /** Candidate identity and evidence. */
  candidate: {
    /** Candidate cluster id. */
    clusterId: string
    /** Proposed name, before normalization. */
    name: string
    /** Classification recorded with the skill. */
    docType: SkillDocType
    /** Evidence sessions. */
    sessionIds: readonly string[]
    /** Cluster score, recorded in a review file. */
    score: number
    /** Mean similarity, recorded in a review file. */
    meanSimilarity: number
  }
  /** Authored draft. */
  draft: SkillDraft
  /** Current stored content, when the skill file already exists. */
  previousContent?: string
  /** Clock injection for tests; defaults to `Date.now`. */
  now?: () => number
}

/**
 * The skill root for one settlement.
 * @param workspace - Absolute workspace root.
 * @param dshHome - Resolved harness home, used by the `user` root.
 * @param skillRoot - Root selection.
 * @returns the absolute skill root directory.
 */
export function resolveSkillRoot(workspace: string, dshHome: string, skillRoot: 'workspace' | 'user'): string {
  return skillRoot === 'user' ? join(dshHome, 'skills') : join(workspace, '.dsh', 'skills')
}

/**
 * The SKILL.md path for one name under a root.
 * @param root - Absolute skill root.
 * @param name - kebab-case skill name.
 * @returns the directory-bundle SKILL.md path.
 */
export function skillFilePath(root: string, name: string): string {
  return join(root, name, 'SKILL.md')
}

/** Whether a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error: unknown) {
    // Only the absent-path failure is a legitimate "no"; anything else is a
    // real read failure and must not be reported as absence.
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Content hash used as the stored version stamp.
 * @param content - Complete SKILL.md text.
 * @returns the first 16 hex characters of its SHA-256 digest.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Summarize the difference between the stored skill and a proposal without
 * pulling a diff dependency: line counts plus the first changed lines.
 * @param previous - Stored content; omitted when the skill is new.
 * @param next - Proposed content.
 * @returns a short human-readable summary.
 */
export function summarizeDiff(previous: string | undefined, next: string): string {
  if (previous === undefined) return 'new skill (no stored version)'
  const before = previous.split(/\r?\n/u)
  const after = next.split(/\r?\n/u)
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const removed = before.filter(line => !afterSet.has(line))
  const added = after.filter(line => !beforeSet.has(line))
  if (removed.length === 0 && added.length === 0) return 'no textual change'
  const lines = [`${added.length} added line(s), ${removed.length} removed line(s)`]
  for (const line of removed.slice(0, 6)) lines.push(`- ${line}`)
  for (const line of added.slice(0, 6)) lines.push(`+ ${line}`)
  if (removed.length > 6 || added.length > 6) lines.push('… (truncated)')
  return lines.join('\n')
}

/** Render the review file a `propose` settlement leaves for the user. */
function renderReview(request: SettleRequest, content: string, timestamp: number): string {
  const previous = request.previousContent
  return [
    `# Skill revision proposal: ${request.candidate.name}`,
    '',
    `- workspace: ${request.workspace}`,
    `- generated: ${new Date(timestamp).toISOString()}`,
    `- cluster: ${request.candidate.clusterId}`,
    `- classification: ${request.candidate.docType}`,
    `- score: ${request.candidate.score.toFixed(3)} (mean similarity ${request.candidate.meanSimilarity.toFixed(3)})`,
    `- evidence sessions: ${request.candidate.sessionIds.join(', ')}`,
    '',
    'A skill with this name already exists, so the factory wrote this proposal instead of replacing it. To accept it, replace the stored file with the content below and keep the factory checkpoint (the next run records the new version).',
    '',
    '## Diff summary (stored vs proposed)',
    '',
    '```text',
    summarizeDiff(previous, content),
    '```',
    '',
    '## Proposed SKILL.md',
    '',
    '~~~~md',
    content.trimEnd(),
    '~~~~',
    '',
  ].join('\n')
}

/**
 * Settle one authored candidate on disk.
 * @param request - Candidate, draft, policy, and roots.
 * @returns the disposition; `path` and `content` are set when a file was written.
 * @throws when a filesystem operation fails for any reason other than absence.
 */
export async function settleCandidate(request: SettleRequest): Promise<WriteOutcome> {
  const now = request.now ?? Date.now
  const name = normalizeSkillName(request.draft.name)
  const fallback = normalizeSkillName(request.candidate.name)
  const finalName = isSkillName(name) ? name : isSkillName(fallback) ? fallback : ''
  if (finalName.length === 0) {
    return {
      action: 'rejected',
      reason: `"${request.draft.name}" does not normalize to a kebab-case skill name`,
      contentHash: '',
    }
  }
  const draft: SkillDraft = { ...request.draft, name: finalName }
  const content = assembleSkillMarkdown(draft)
  const hash = contentHash(content)
  const root = resolveSkillRoot(request.workspace, request.dshHome, request.skillRoot)
  const target = skillFilePath(root, finalName)
  const flatTarget = join(root, `${finalName}.md`)
  const existing = (await exists(target)) || (await exists(flatTarget))

  if (!existing) {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
    return { action: 'created', path: target, content, contentHash: hash }
  }

  switch (request.updatePolicy) {
    case 'skip-existing':
      return {
        action: 'skipped-existing',
        path: target,
        reason: `a skill named "${finalName}" already exists`,
        contentHash: hash,
      }
    case 'replace':
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
      return { action: 'created', path: target, content, contentHash: hash }
    case 'propose': {
      const reviewsDir = join(request.workspace, '.dsh', 'skill-factory', 'reviews')
      await mkdir(reviewsDir, { recursive: true })
      const stamp = new Date(now()).toISOString().replace(/[:.]/gu, '-')
      const reviewPath = join(reviewsDir, `${finalName}-${stamp}.md`)
      await writeFile(reviewPath, renderReview({ ...request, candidate: { ...request.candidate, name: finalName } }, content, now()), 'utf8')
      return {
        action: 'proposed',
        path: target,
        reviewPath,
        content,
        diff: summarizeDiff(request.previousContent, content),
        contentHash: hash,
      }
    }
  }
}

/**
 * Read one stored skill file, or `undefined` when it is absent.
 * @param path - Absolute SKILL.md path.
 * @returns the stored text, or `undefined` when the file does not exist.
 * @throws when the file exists but cannot be read.
 */
export async function readSkillFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') return undefined
    throw error
  }
}

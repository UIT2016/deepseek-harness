/**
 * Bounded session digests: what one extractor subagent reads instead of a
 * whole session log. The digest keeps the user's own requests, the delivered
 * files with a short structure portrait, the tool names used, and the closing
 * assistant output, each within its own share of the character budget.
 * @module @deepseek-ai/dsh-experimental-skill-factory/digest
 */

import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
// Type-only: declares the `deliverables/presented` event this module reads.
import type {} from '@deepseek-ai/dsh-tool-present/types'
import type { SessionDigest } from './types.ts'

/** One delivery a session declared through the `present` tool. */
export interface DeliveredFile {
  /** Path as recorded: relative to the workspace, or absolute. */
  path: string
  /** Optional human description recorded with the delivery. */
  description?: string
}

/** Reads one delivered file's text for its structure portrait; `undefined` when unreadable. */
export type DeliverableReader = (absolutePath: string) => Promise<string | undefined>

/** Per-digest bounds. */
export interface DigestOptions {
  /** Hard character bound for the rendered digest. */
  digestChars: number
  /** Byte bound for one delivered file's structure portrait. */
  deliverableReadBytes: number
  /** Reader for delivered files; omitted digests still list the paths. */
  readDeliverable?: DeliverableReader
}

/**
 * Whether a session header belongs to a top-level session the factory may learn from.
 * @param header - Session header to classify.
 * @returns whether this is a root session rather than a subagent child.
 */
export function isTopLevelSession(header: SessionHeader): boolean {
  if (header.delegationDepth !== undefined && header.delegationDepth > 0) return false
  return header.origin !== 'subagent'
}

/**
 * Collect the user's own request texts in log order.
 * @param events - Session raw event log.
 * @returns one non-empty request text per user message, in log order.
 */
export function extractUserRequests(events: readonly SessionEvent[]): string[] {
  const requests: string[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const text = extractSessionEventText(event).trim()
    if (text.length > 0) requests.push(text)
  }
  return requests
}

/**
 * Collect every delivery declared in the session log.
 * @param events - Session raw event log.
 * @returns declared files in log order, with malformed entries dropped.
 */
export function extractDeliverables(events: readonly SessionEvent[]): DeliveredFile[] {
  const files: DeliveredFile[] = []
  for (const event of events) {
    if (event.type !== 'deliverables/presented') continue
    const data = event.data as { files?: unknown }
    if (!Array.isArray(data.files)) continue
    for (const entry of data.files) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as { path?: unknown; description?: unknown }
      if (typeof record.path !== 'string' || record.path.length === 0) continue
      files.push({
        path: record.path,
        ...typeof record.description === 'string' ? { description: record.description } : {},
      })
    }
  }
  return files
}

/**
 * Count tool calls by name across the log.
 * @param events - Session raw event log.
 * @returns call count per tool name.
 */
export function extractToolUsage(events: readonly SessionEvent[]): Map<string, number> {
  const usage = new Map<string, number>()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = event.data as { name?: unknown }
    if (typeof data.name !== 'string' || data.name.length === 0) continue
    usage.set(data.name, (usage.get(data.name) ?? 0) + 1)
  }
  return usage
}

/**
 * Collect the closing assistant texts, one entry per message.
 * @param events - Session raw event log.
 * @returns one non-empty assistant text per assistant message, in log order.
 */
export function extractAssistantOutcomes(events: readonly SessionEvent[]): string[] {
  const outcomes: string[] = []
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const text = extractSessionEventText(event).trim()
    if (text.length > 0) outcomes.push(text)
  }
  return outcomes
}

/** Truncate one block to a character bound, marking the cut. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * Extract at most three heading lines as a portable structure portrait.
 * @param text - Delivered file text, already bounded by the caller.
 * @returns leading markdown headings, or the first non-empty line as a fallback.
 */
export function structurePortrait(text: string): string[] {
  const headings: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const match = /^(#{1,3})\s+(.+)$/u.exec(line.trim())
    if (match === null) continue
    const heading = `${match[1] as string} ${(match[2] as string).trim()}`
    headings.push(heading)
    if (headings.length >= 3) break
  }
  if (headings.length > 0) return headings
  const firstLine = text.split(/\r?\n/u).find(line => line.trim().length > 0)
  return firstLine === undefined ? [] : [firstLine.trim().slice(0, 80)]
}

/** Resolve one delivered path against the workspace, refusing paths outside it. */
function resolveInside(cwd: string, path: string): string | undefined {
  const normalized = path.replace(/\\/gu, '/')
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)
  const base = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const joined = absolute ? normalized : `${base}/${normalized}`
  const segments: string[] = []
  for (const segment of joined.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return undefined
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  const resolved = `/${segments.join('/')}`
  if (!resolved.startsWith(`${base}/`)) return undefined
  return resolved
}

/** Render one delivered file line, appending its structure portrait when readable. */
async function renderDeliverable(
  cwd: string,
  file: DeliveredFile,
  options: DigestOptions,
): Promise<string> {
  const label = file.description === undefined ? file.path : `${file.path} — ${file.description}`
  const absolute = resolveInside(cwd, file.path)
  if (absolute === undefined || options.readDeliverable === undefined) return `- ${label}`
  let text: string | undefined
  try {
    text = await options.readDeliverable(absolute)
  } catch (error: unknown) {
    // A delivered file that cannot be read is still evidence of the delivery.
    void error
    return `- ${label}`
  }
  if (text === undefined) return `- ${label}`
  const bounded = text.slice(0, options.deliverableReadBytes)
  const portrait = structurePortrait(bounded)
  return portrait.length === 0 ? `- ${label}` : `- ${label} [structure: ${portrait.join(' / ')}]`
}

/** Options for {@link buildSessionDigest}. */
export interface BuildDigestOptions extends DigestOptions {
  /** Workspace the session ran in; delivered relative paths resolve against it. */
  cwd: string
  /** Latest folded title, when the log carries one. */
  title?: string
}

/**
 * Build one bounded digest for a session log.
 * @param session - Session header (id, cwd, identity).
 * @param events - The session's complete raw event log.
 * @param options - Digest bounds, workspace, title, and the optional deliverable reader.
 * @returns the digest plus the highest seq it observed.
 */
export async function buildSessionDigest(
  session: SessionHeader,
  events: readonly SessionEvent[],
  options: BuildDigestOptions,
): Promise<SessionDigest> {
  const requests = extractUserRequests(events)
  const outcomes = extractAssistantOutcomes(events)
  const deliverables = extractDeliverables(events)
  const usage = extractToolUsage(events)
  const lastSeq = events.length === 0 ? null : (events[events.length - 1]?.seq ?? null)
  const turns = events.filter(event => event.type === 'turn/end').length

  const budget = options.digestChars
  const deliverableBudget = Math.max(300, Math.floor(budget * 0.3))
  const requestBudget = Math.max(500, Math.floor(budget * 0.4))
  const outcomeBudget = Math.max(300, Math.floor(budget * 0.3))

  const lines: string[] = []
  lines.push(`SESSION ${session.id}${options.title === undefined ? '' : ` — ${options.title}`}`)
  lines.push(`turns: ${turns}`)
  if (usage.size > 0) {
    const ranked = [...usage.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    lines.push(`tools: ${ranked.slice(0, 12).map(([name, count]) => `${name}(${count})`).join(', ')}`)
  }
  lines.push('DELIVERABLES')
  if (deliverables.length === 0) {
    lines.push('- (none declared)')
  } else {
    const rendered: string[] = []
    for (const file of deliverables.slice(0, 20)) {
      rendered.push(await renderDeliverable(options.cwd, file, options))
    }
    lines.push(clip(rendered.join('\n'), deliverableBudget))
  }
  lines.push('USER REQUESTS')
  if (requests.length === 0) {
    lines.push('- (none)')
  } else {
    const rendered = requests.map((request, index) => `${index + 1}. ${request}`)
    lines.push(clip(rendered.join('\n'), requestBudget))
  }
  lines.push('OUTCOMES')
  if (outcomes.length === 0) {
    lines.push('- (none)')
  } else {
    const tail = outcomes.slice(-4).map(outcome => `- ${clip(outcome, 400)}`)
    lines.push(clip(tail.join('\n'), outcomeBudget))
  }

  return {
    id: session.id as SessionId,
    ...options.title === undefined ? {} : { title: options.title },
    digest: clip(lines.join('\n'), budget),
    lastSeq,
    turns,
  }
}

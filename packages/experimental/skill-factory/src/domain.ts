/**
 * The skill-factory durable domain: checkpoint accounting for processed
 * sessions, the distilled patterns and clusters that evidence each candidate,
 * the stored skills with their usage metrics, and the pending review entries
 * produced under the `propose` policy. The zod schemas validate every stored
 * record at the durability boundary.
 * @module @deepseek-ai/dsh-experimental-skill-factory/domain
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Output-structure classification shared by every stored record that carries one. */
const docType = z.enum(['document', 'workflow', 'mixed'])

/** One candidate's settlement status as persisted. */
const clusterStatus = z.enum(['proposed', 'accepted', 'revised', 'rejected'])

/**
 * Domain key for one workspace skill. A workspace root can contain `:` and
 * `|`, so the path is percent-encoded before joining.
 * @param workspace - Absolute workspace root.
 * @param name - kebab-case skill name.
 * @returns the stable domain key.
 */
export function skillKey(workspace: string, name: string): string {
  return `${encodeURIComponent(workspace)}|${name}`
}

/** Durable checkpoint for one processed session. */
export const sessionCheckpointRecord = z.object({
  /** Session id (globally unique, so it is also the table key). */
  sessionId: z.string(),
  /** Absolute workspace root the session ran in. */
  workspace: z.string(),
  /** Highest raw-log seq included in this session's extraction, or null when the log was empty. */
  lastSeq: z.number().nullable(),
  /** Processing time in epoch milliseconds. */
  processedAt: z.number(),
  /** Patterns stored from this session. */
  patternCount: z.number(),
})

/** One distilled pattern bound to the session and workspace that evidenced it. */
export const patternRecord = z.object({
  /** `<sessionId>#<index>`, the table key. */
  patternId: z.string(),
  /** Session that evidenced this pattern. */
  sessionId: z.string(),
  /** Absolute workspace root the session ran in. */
  workspace: z.string(),
  /** One-line intent statement. */
  intent: z.string(),
  /** Output-structure classification. */
  docType,
  /** Key action steps. */
  actions: z.array(z.string()),
  /** Inputs the task consumed. */
  inputs: z.array(z.string()),
  /** Outputs the task produced. */
  outputs: z.array(z.string()),
  /** Tool names used. */
  tools: z.array(z.string()),
  /** Extractor confidence. */
  confidence: z.number(),
  /** Store time in epoch milliseconds. */
  createdAt: z.number(),
})

/** One cluster of patterns that passed the evidence gate. */
export const clusterRecord = z.object({
  /** Deterministic id derived from the sorted member pattern ids. */
  clusterId: z.string(),
  /** Absolute workspace root the cluster belongs to. */
  workspace: z.string(),
  /** Member pattern ids in discovery order. */
  patternIds: z.array(z.string()),
  /** Winning output-structure classification. */
  docType,
  /** Distinct-session count scaled by mean similarity. */
  score: z.number(),
  /** Mean member-to-centroid similarity. */
  meanSimilarity: z.number(),
  /** Settlement status. */
  status: clusterStatus,
  /** Skill name the cluster was authored as, when one was written. */
  skillName: z.string().optional(),
  /** First observation time in epoch milliseconds. */
  createdAt: z.number(),
  /** Last update time in epoch milliseconds. */
  updatedAt: z.number(),
})

/** One distilled skill stored in the domain. */
export const skillRecord = z.object({
  /** `<encoded workspace>|<name>`, the table key. */
  key: z.string(),
  /** kebab-case skill name. */
  name: z.string(),
  /** Absolute workspace root the skill belongs to. */
  workspace: z.string(),
  /** Output-structure classification recorded at creation. */
  docType,
  /** Content hashes in version order, oldest first. */
  versions: z.array(z.string()),
  /** Creation time in epoch milliseconds. */
  createdAt: z.number(),
  /** Last update time in epoch milliseconds. */
  updatedAt: z.number(),
  /** Distinct sessions recorded as evidence for this skill. */
  sourceSessions: z.array(z.string()),
  /** Usage metrics. */
  metrics: z.object({
    /** Observed invocations. */
    executions: z.number(),
    /** Factory revisions plus detected user edits. */
    revisions: z.number(),
    /** `revisions / max(1, executions)`. */
    revisionRate: z.number(),
  }),
})

/** One pending review written under the `propose` update policy. */
export const reviewRecord = z.object({
  /** Same key as the skill it proposes to change. */
  key: z.string(),
  /** kebab-case skill name. */
  name: z.string(),
  /** Absolute workspace root the review belongs to. */
  workspace: z.string(),
  /** Write time in epoch milliseconds. */
  createdAt: z.number(),
  /** Absolute review file path. */
  path: z.string(),
  /** Unified-diff summary between the stored skill file and the proposal. */
  diff: z.string(),
})

/** Domain-global state: the run lock and the last completed run. */
export const skillFactoryState = z.object({
  /** Last completed run time in epoch milliseconds, or 0 before the first run. */
  lastRunAt: z.number(),
  /** Mode of the last completed run, or an empty string before the first run. */
  lastRunMode: z.string(),
  /** Whether a run currently holds the lock. */
  running: z.boolean(),
  /** Lock acquisition time in epoch milliseconds, used for stale-lock recovery. */
  runningStartedAt: z.number(),
  /** Number of checkpointed sessions. */
  sessionCount: z.number(),
})

/** One stored checkpoint record, inferred from {@link sessionCheckpointRecord}. */
export type SessionCheckpointRecord = z.infer<typeof sessionCheckpointRecord>
/** One stored pattern, inferred from {@link patternRecord}. */
export type PatternRecord = z.infer<typeof patternRecord>
/** One stored cluster, inferred from {@link clusterRecord}. */
export type ClusterRecord = z.infer<typeof clusterRecord>
/** One stored skill, inferred from {@link skillRecord}. */
export type SkillRecord = z.infer<typeof skillRecord>
/** One stored review entry, inferred from {@link reviewRecord}. */
export type ReviewRecord = z.infer<typeof reviewRecord>
/** Domain-global state, inferred from {@link skillFactoryState}. */
export type SkillFactoryState = z.infer<typeof skillFactoryState>

/**
 * The skill-factory domain: one `sessions` checkpoint table, the `patterns`,
 * `clusters`, `skills`, and `reviews` tables, and the run-lock global.
 */
export const skillFactoryDomainSpec = defineDomain({
  // UNIT_NAME_RE rejects hyphens, so the durable unit is `skill_factory`.
  name: 'skill_factory',
  version: 1,
  global: {
    schema: skillFactoryState,
    initial: { lastRunAt: 0, lastRunMode: '', running: false, runningStartedAt: 0, sessionCount: 0 },
  },
  tables: {
    sessions: domainTable<string, SessionCheckpointRecord>(sessionCheckpointRecord),
    patterns: domainTable<string, PatternRecord>(patternRecord),
    clusters: domainTable<string, ClusterRecord>(clusterRecord),
    skills: domainTable<string, SkillRecord>(skillRecord),
    reviews: domainTable<string, ReviewRecord>(reviewRecord),
  },
})

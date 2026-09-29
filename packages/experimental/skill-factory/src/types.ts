/**
 * Public vocabulary shared by the skill-factory host service and its model
 * tools: the distilled task pattern, one distill request, and the candidate,
 * metrics, and report shapes both sides exchange.
 * @module @deepseek-ai/dsh-experimental-skill-factory/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** Output-structure classification of one distilled task pattern. */
export type SkillDocType = 'document' | 'workflow' | 'mixed'

/** One repeatable task pattern distilled from one session. */
export interface TaskPattern {
  /** One-line statement of what the user wanted, in the user's own language. */
  intent: string
  /** Whether the deliverable structure or the task procedure carries the reuse. */
  docType: SkillDocType
  /** Key action steps the session took. */
  actions: string[]
  /** Inputs the task consumed. */
  inputs: string[]
  /** Outputs and deliverables the task produced. */
  outputs: string[]
  /** Tool names the session used for this pattern. */
  tools: string[]
  /** Extractor confidence from 0 to 1. */
  confidence: number
}

/** A pattern bound to the session that evidenced it. */
export interface EvidencedPattern extends TaskPattern {
  /** Stable id within the domain: `<sessionId>#<index>`. */
  patternId: string
  /** Session that evidenced this pattern. */
  sessionId: SessionId
}

/** One workspace session's bounded digest handed to an extractor subagent. */
export interface SessionDigest {
  /** Session id. */
  id: SessionId
  /** Latest folded title, when the log carries one. */
  title?: string
  /** Bounded plain-text digest of the session's requests, tools, and deliverables. */
  digest: string
  /** Highest raw-log seq included in the digest, or `null` for an empty log. */
  lastSeq: number | null
  /** Number of completed turns observed in the digest. */
  turns: number
}

/** Extraction result for one session. */
export interface SessionExtraction {
  /** Session that was extracted. */
  sessionId: SessionId
  /** Patterns the extractor found; an empty list is a valid observation. */
  patterns: TaskPattern[]
}

/** How a candidate was settled on disk. */
export type CandidateAction = 'created' | 'proposed' | 'skipped-existing' | 'rejected' | 'dry-run'

/** One candidate skill derived from one cluster, plus its disposition. */
export interface SkillCandidate {
  /** Stable cluster id within the run and the domain. */
  clusterId: string
  /** kebab-case skill name proposed for this cluster. */
  name: string
  /** Output-structure classification carried by the winning cluster. */
  docType: SkillDocType
  /** Cluster score: distinct-session count scaled by mean similarity. */
  score: number
  /** Mean member-to-centroid similarity inside the cluster. */
  meanSimilarity: number
  /** Every session that contributed a pattern to this cluster. */
  sessionIds: SessionId[]
  /** Sessions whose patterns support the cluster. */
  supporting: SessionId[]
  /** Sessions that look similar but stayed below the similarity threshold. */
  opposing: SessionId[]
  /** Disposition of this candidate on disk. */
  action: CandidateAction
  /** Human-readable reason for a rejection or a skip. */
  reason?: string
  /** Written SKILL.md path when `action` is `created` or a replace settled. */
  path?: string
  /** Review file path when `action` is `proposed`. */
  reviewPath?: string
}

/** Run modes the distill tool accepts. */
export type SkillFactoryMode = 'incremental' | 'full' | 'revise-only'

/** Request accepted by the distill operation. */
export interface DistillRequest {
  /**
   * `incremental` (default) skips checkpointed sessions; `full` re-reads every session;
   * `revise-only` skips extraction and re-authors stored clusters.
   */
  mode?: SkillFactoryMode
  /** When true the run computes everything but writes no skill, review, or checkpoint record. */
  dryRun?: boolean
  /** Explicit session-id subset to process, bypassing discovery. */
  sessionIds?: readonly SessionId[]
}

/** Per-skill usage metrics the factory records. */
export interface SkillMetrics {
  /** Observed skill invocations in the owning workspace. */
  executions: number
  /** Factory revisions plus detected user edits of the skill file. */
  revisions: number
  /** `revisions / max(1, executions)`; falling is the quality signal. */
  revisionRate: number
}

/** One distilled skill's status view. */
export interface SkillStatus {
  /** kebab-case skill name. */
  name: string
  /** Output-structure classification recorded at creation. */
  docType: SkillDocType
  /** Workspace root the skill belongs to. */
  workspace: string
  /** Number of stored content versions. */
  versions: number
  /** Creation time in epoch milliseconds. */
  createdAt: number
  /** Last update time in epoch milliseconds. */
  updatedAt: number
  /** Number of distinct source sessions recorded for this skill. */
  sourceSessions: number
  /** Usage metrics. */
  metrics: SkillMetrics
}

/** Read-only status view returned by the status tool. */
export interface SkillFactoryStatus {
  /** Last completed run time in epoch milliseconds, or 0 before the first run. */
  lastRunAt: number
  /** Mode of the last completed run, or an empty string before the first run. */
  lastRunMode: string
  /** Whether a run currently holds the lock. */
  running: boolean
  /** Number of checkpointed sessions in the domain. */
  sessions: number
  /** Distilled skills for the caller's workspace. */
  skills: SkillStatus[]
}

/** The tool-visible outcome of one distill run. */
export interface SkillFactoryReport {
  /** Mode this run executed. */
  mode: SkillFactoryMode
  /** Workspace root the run was scoped to. */
  workspace: string
  /** Whether the run wrote nothing. */
  dryRun: boolean
  /** Session accounting. */
  sessions: {
    /** Sessions discovered in the workspace (or named explicitly). */
    total: number
    /** Sessions skipped by the checkpoint. */
    skipped: number
    /** Sessions whose extraction completed. */
    processed: number
    /** Sessions whose read or extraction failed. */
    failed: number
  }
  /** Patterns distilled across the processed sessions. */
  patterns: number
  /** Clusters that passed the evidence gate. */
  clusters: number
  /** Candidate dispositions, including rejected and skipped ones. */
  candidates: SkillCandidate[]
  /** Skills stored for this workspace after the run. */
  skills: SkillStatus[]
  /** Per-session failures that did not abort the run. */
  errors: { sessionId: string; message: string }[]
}

/** A script run the caller supplies so the host service can use its agent's workflow engine. */
export interface ScriptRunRequest {
  /** Plain-JavaScript workflow body (the `workflow` tool's script contract). */
  script: string
  /** Workflow identity block. */
  meta: { name: string; description: string }
  /** Plain JSON input exposed to the script as `args`. */
  args?: Record<string, unknown>
}

/** The settled outcome of one caller-supplied script run. */
export type ScriptRunResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

/** Caller-supplied execution context for one distill run. */
export interface DistillExecution {
  /** Workspace root the run is scoped to (the calling agent's working directory). */
  cwd: string
  /** Caller lifetime; aborting cancels discovery and the script runs. */
  signal?: AbortSignal
  /** Runs one workflow script through the caller's engine, attributed to the calling agent. */
  runScript: (request: ScriptRunRequest) => Promise<ScriptRunResult>
  /** Optional progress narration for the caller's transcript. */
  log?: (message: string) => void
}

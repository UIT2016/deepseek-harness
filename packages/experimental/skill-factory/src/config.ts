/**
 * Configuration schemas for the skill-factory host service and its model tool.
 * Every deployment-varying choice is a validated field; thresholds have no
 * hidden defaults outside this schema.
 * @module @deepseek-ai/dsh-experimental-skill-factory/config
 */

import z from '@deepseek-ai/schemastery'

/** Host-service configuration: discovery bounds, thresholds, and write policy. */
export interface HostConfig {
  /** Minimum keyword-signature similarity that joins two patterns into one cluster (default 0.35). */
  similarityThreshold: number
  /** Minimum mean similarity for a `document` candidate cluster (default 0.4). */
  agreementThreshold: number
  /** Minimum mean similarity for a `workflow` candidate cluster (default 0.4). */
  taskThreshold: number
  /** Minimum distinct sessions a cluster needs before it becomes a candidate (default 2). */
  minEvidenceSessions: number
  /** Maximum extractor subagents run concurrently per batch (default 4). */
  maxConcurrency: number
  /** Per-session digest character bound handed to an extractor (default 12000). */
  sessionDigestChars: number
  /** Bytes read from one delivered file for its structure portrait (default 8192). */
  deliverableReadBytes: number
  /** Write policy for a name that already exists in the workspace skill root. */
  updatePolicy: 'propose' | 'replace' | 'skip-existing'
  /** Skill root: the workspace's `.dsh/skills`, or `$DSH_HOME/skills`. */
  skillRoot: 'workspace' | 'user'
  /** Record skill invocations from `skill`/`skill_load` tool results (default true). */
  watchMetrics: boolean
  /** Maximum sessions one run processes, newest first (default 50). */
  maxSessionsPerRun: number
  /** Maximum patterns kept per session (default 8). */
  maxPatternsPerSession: number
  /** Maximum candidates authored in one run (default 8). */
  maxCandidates: number
}

/** Host-service configuration schema. */
export const Config: z<HostConfig> = z.object({
  similarityThreshold: z.number().min(0).max(1).default(0.35),
  agreementThreshold: z.number().min(0).max(1).default(0.4),
  taskThreshold: z.number().min(0).max(1).default(0.4),
  minEvidenceSessions: z.natural().min(1).default(2),
  maxConcurrency: z.natural().min(1).default(4),
  sessionDigestChars: z.natural().min(1000).default(12_000),
  deliverableReadBytes: z.natural().min(256).default(8192),
  updatePolicy: z.union(['propose', 'replace', 'skip-existing'] as const).default('propose'),
  skillRoot: z.union(['workspace', 'user'] as const).default('workspace'),
  watchMetrics: z.boolean().default(true),
  maxSessionsPerRun: z.natural().min(1).default(50),
  maxPatternsPerSession: z.natural().min(1).default(8),
  maxCandidates: z.natural().min(1).default(8),
})

/** Tool-plugin configuration: the two model-facing tool names. */
export interface ToolConfig {
  /** Distill tool name (default `skill_factory_distill`). */
  distillToolName: string
  /** Status tool name (default `skill_factory_status`). */
  statusToolName: string
}

/** Tool-plugin configuration schema. */
export const ToolConfigSchema: z<ToolConfig> = z.object({
  distillToolName: z.string().default('skill_factory_distill'),
  statusToolName: z.string().default('skill_factory_status'),
})

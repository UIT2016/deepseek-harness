/**
 * Skill Factory: distill reusable skills from one workspace's session history
 * and its delivered files.
 *
 * This entry is the host-plane service (durable checkpoint domain, the
 * deterministic pipeline, and the skill-usage metrics listener). The
 * model-facing tools live in the `./tool` entry and are composed by an agent
 * preset; the `cordis.patch.yml` bundle mounts this host row.
 * @module @deepseek-ai/dsh-experimental-skill-factory
 */

export { default } from './host.ts'
export { Config, type HostConfig, type ToolConfig } from './config.ts'
export type {
  CandidateAction,
  DistillExecution,
  DistillRequest,
  EvidencedPattern,
  ScriptRunRequest,
  ScriptRunResult,
  SessionDigest,
  SessionExtraction,
  SkillCandidate,
  SkillDocType,
  SkillFactoryMode,
  SkillFactoryReport,
  SkillFactoryStatus,
  SkillMetrics,
  SkillStatus,
  TaskPattern,
} from './types.ts'

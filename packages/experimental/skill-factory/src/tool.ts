/**
 * The model-facing skill-factory tools: one orchestrating distill tool and one
 * read-only status tool. The tools own the model contract and the binding to
 * the calling agent's workflow engine; discovery, clustering, settlement, and
 * checkpointing live in the host service.
 * @module @deepseek-ai/dsh-experimental-skill-factory/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolCallView } from '@deepseek-ai/dsh-tools'
import type { WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type { ToolConfig } from './config.ts'
import type { DistillRequest, ScriptRunRequest, ScriptRunResult, SkillFactoryReport, SkillFactoryStatus } from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'skill-factory-tool'

/** Services these tools resolve: the registries, the host service, and the caller's workflow engine. */
export const inject = ['tools', 'systemPrompt', 'skillFactory', 'workflowEngine']

export { Config } from './config.ts'

/** Text results, rendered as-is (the session-query tools' output form). */
const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const DISTILL_DESCRIPTION = `Distill reusable skills from this workspace's sessions and their delivered files: read what the user asked for in each session, cluster the repeatable task patterns across sessions, and author a SKILL.md per evidence-backed candidate into the workspace skill directory.

Call it on a schedule or on request. It is incremental by default: sessions already checkpointed are skipped, so a repeated call only pays for new work. Existing skills are not overwritten under the default policy — a revised candidate is written to .dsh/skill-factory/reviews/ for the user to accept.

Requires a session working directory: that directory is the workspace being distilled.`

const STATUS_DESCRIPTION = 'Read the skill-factory checkpoint and the distilled skills of the caller workspace, with usage metrics.'

/** One distill call's model arguments. */
interface DistillArgs {
  mode?: 'incremental' | 'full' | 'revise-only'
  dry_run?: boolean
  session_ids?: string[]
}

/** One status call's model arguments. */
interface StatusArgs {
  /** Reserved: the caller workspace is the only scope today. */
  unused?: boolean
}

/** Render an unknown thrown value into a short message. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Bind the host service's script runs to the calling agent's workflow engine.
 * @param ctx - Plugin context carrying `workflowEngine`.
 * @param parent - The calling agent; owns every child the scripts start.
 * @param signal - Caller cancellation forwarded into each run.
 * @returns a runner that never rejects.
 */
function createScriptRunner(
  ctx: Context,
  parent: Agent,
  signal: AbortSignal | undefined,
): (request: ScriptRunRequest) => Promise<ScriptRunResult> {
  return async (request: ScriptRunRequest): Promise<ScriptRunResult> => {
    let run: WorkflowRun
    try {
      // A synchronous engine rejection (meta or script validation) surfaces
      // here as an ordinary failed script run rather than a thrown tool error.
      run = ctx.workflowEngine.start({
        script: request.script,
        meta: { name: request.meta.name, description: request.meta.description },
        ...request.args === undefined ? {} : { args: request.args },
        parent,
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      return { ok: false, error: messageOf(error) }
    }
    try {
      const result: WorkflowResult = await run.result
      if (result.stopReason === 'completed') return { ok: true, value: result.value }
      return { ok: false, error: result.error ?? `workflow run stopped: ${result.stopReason}` }
    } finally {
      try {
        await run.dispose()
      } catch (error: unknown) {
        ctx.logger.warn(`skill-factory: workflow run dispose failed: ${String(error)}`)
      }
    }
  }
}

/**
 * Render one distill report for the model.
 * @param report - Settled run report.
 * @returns the plain-text result the model receives.
 */
export function renderReport(report: SkillFactoryReport): string {
  const lines: string[] = []
  lines.push(`skill-factory ${report.mode}${report.dryRun ? ' (dry run: nothing written)' : ''} — workspace ${report.workspace}`)
  lines.push(
    `sessions: ${report.sessions.total} discovered, ${report.sessions.skipped} checkpointed, `
    + `${report.sessions.processed} processed, ${report.sessions.failed} failed`,
  )
  lines.push(`patterns extracted: ${report.patterns}; candidates settled: ${report.clusters}`)
  if (report.candidates.length === 0) {
    lines.push('candidates: none this run')
  } else {
    lines.push('candidates:')
    for (const candidate of report.candidates) {
      const parts = [
        `- ${candidate.name} [${candidate.docType}] ${candidate.action}`,
        `score ${candidate.score.toFixed(2)}`,
        `${candidate.sessionIds.length} session(s)`,
      ]
      if (candidate.path !== undefined) parts.push(`path ${candidate.path}`)
      if (candidate.reviewPath !== undefined) parts.push(`review ${candidate.reviewPath}`)
      if (candidate.reason !== undefined) parts.push(`(${candidate.reason})`)
      lines.push(parts.join(' | '))
    }
  }
  if (report.skills.length > 0) {
    lines.push(`stored skills (${report.skills.length}):`)
    for (const skill of report.skills) {
      lines.push(
        `- ${skill.name} [${skill.docType}] versions ${skill.versions}, source sessions ${skill.sourceSessions}, `
        + `executions ${skill.metrics.executions}, revisions ${skill.metrics.revisions}`,
      )
    }
  }
  if (report.errors.length > 0) {
    lines.push('errors:')
    for (const error of report.errors) lines.push(`- ${error.sessionId}: ${error.message}`)
  }
  return lines.join('\n')
}

/**
 * Render one status view for the model.
 * @param status - Stored status of the caller's workspace.
 * @returns the plain-text result the model receives.
 */
export function renderStatus(status: SkillFactoryStatus): string {
  const lines: string[] = []
  lines.push(status.lastRunAt === 0
    ? 'skill-factory: no completed run yet'
    : `skill-factory: last run ${new Date(status.lastRunAt).toISOString()} (${status.lastRunMode}), ${status.sessions} checkpointed session(s)`)
  if (status.running) lines.push('a run currently holds the lock')
  if (status.skills.length === 0) {
    lines.push('stored skills: none')
  } else {
    lines.push(`stored skills (${status.skills.length}):`)
    for (const skill of status.skills) {
      lines.push(
        `- ${skill.name} [${skill.docType}] versions ${skill.versions}, source sessions ${skill.sourceSessions}, `
        + `executions ${skill.metrics.executions}, revisions ${skill.metrics.revisions}, revision rate ${skill.metrics.revisionRate.toFixed(2)}`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * Register the two tools and their shared guidance.
 * @param ctx - Plugin context.
 * @param config - Validated tool configuration.
 */
export function apply(ctx: Context, config: ToolConfig): void {
  ctx.systemPrompt.section({
    name: 'tool:skill-factory',
    // Reuses the session-history slot: the factory is the scheduled reader of
    // this workspace's prior sessions.
    order: ctx.systemPrompt.getSectionOrder('TOOL_SESSION_QUERY') + 10,
    text: `Use ${config.distillToolName} to distill reusable skills from this workspace's sessions and their `
      + `delivered files, and ${config.statusToolName} to inspect the checkpoint and stored skills.`,
  })

  ctx.tools.register(defineTool({
    name: config.distillToolName,
    description: DISTILL_DESCRIPTION,
    parameters: {
      mode: {
        type: 'string',
        enum: ['incremental', 'full', 'revise-only'],
        description: 'incremental (default) processes only sessions absent from the checkpoint; full re-reads every session; revise-only skips extraction and re-authors stored candidates.',
      },
      dry_run: {
        type: 'boolean',
        description: 'Run the whole pipeline but write no skill, review, or checkpoint record. Still consumes subagent calls.',
      },
      session_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional explicit session ids to process instead of discovering the workspace sessions.',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args: DistillArgs, exec) {
      const parent = exec.agent
      if (!parent) {
        throw new Error(`${config.distillToolName} requires a calling agent`)
      }
      const cwd = parent.session.header.cwd
      if (cwd === undefined || cwd.length === 0) {
        throw new Error(`${config.distillToolName} requires a session working directory: that directory is the workspace to distill`)
      }
      const request: DistillRequest = {
        ...args.mode === undefined ? {} : { mode: args.mode },
        ...args.dry_run === undefined ? {} : { dryRun: args.dry_run },
        ...args.session_ids === undefined ? {} : { sessionIds: args.session_ids.map(value => value as SessionId) },
      }
      const report = await ctx.skillFactory.distill(request, {
        cwd,
        signal: exec.signal,
        runScript: createScriptRunner(ctx, parent, exec.signal),
        log: (message) => { ctx.logger.info(message) },
      })
      return renderReport(report)
    },
    presentCall: (args: DistillArgs): ToolCallView => ({
      card: 'generic',
      title: `skill-factory: distill (${args.mode ?? 'incremental'}${args.dry_run === true ? ', dry run' : ''})`,
      ...args.session_ids === undefined ? {} : { rawInput: args.session_ids.join('\n') },
    }),
  }))

  ctx.tools.register(defineTool({
    name: config.statusToolName,
    description: STATUS_DESCRIPTION,
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(_args: StatusArgs, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined || cwd.length === 0) {
        throw new Error(`${config.statusToolName} requires a session working directory`)
      }
      return renderStatus(ctx.skillFactory.status(cwd))
    },
    presentCall: (): ToolCallView => ({ card: 'generic', title: 'skill-factory: status' }),
  }))
}

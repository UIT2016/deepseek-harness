import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type {
  SessionLogSnapshot,
  SessionRecord,
  SessionResultFilter,
  SessionTitleObservation,
} from '@deepseek-ai/dsh-session-query'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import type { HostConfig } from '../src/config.ts'
import SkillFactoryService, { projectRootFor } from '../src/host.ts'
import type { ScriptRunRequest, ScriptRunResult } from '../src/types.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** One stubbed session the fake query service serves. */
interface StubSession {
  header: SessionHeader
  events: SessionEvent[]
}

function header(id: string, cwd: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  }
}

function requestEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
  }
}

function deliveredEvent(seq: number, path: string): SessionEvent {
  return {
    type: 'deliverables/presented',
    seq: SessionSeq(seq),
    time: seq,
    data: { turn: 1, callId: ToolCallId(`call-${seq}`), files: [{ path }] },
  }
}

function session(id: string, cwd: string, prompt: string, deliverable: string): StubSession {
  return {
    header: header(id, cwd),
    events: [
      requestEvent(1, prompt),
      deliveredEvent(2, deliverable),
      { type: 'turn/end', seq: SessionSeq(3), time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  }
}

/**
 * The external history the host service reads: `filterSessions`,
 * `readSession`, and `readTitleSnapshot`. `unreadable` headers are listed but
 * have no log, which is how a torn or unmounted session appears.
 */
function createStubQuery(sessions: readonly StubSession[], unreadable: readonly SessionHeader[] = []) {
  const find = (id: SessionId): StubSession | undefined => sessions.find(entry => String(entry.header.id) === String(id))
  return {
    async filterSessions(filters: readonly SessionResultFilter[]): Promise<SessionRecord[]> {
      const cwdFilter = filters.find(filter => filter.kind === 'cwd')
      const wanted = cwdFilter !== undefined && cwdFilter.kind === 'cwd' ? cwdFilter.values : undefined
      return [
        ...sessions.map(entry => entry.header),
        ...unreadable,
      ]
        .filter(candidate => wanted === undefined || wanted.includes(candidate.cwd ?? null))
        .map(candidate => ({ header: candidate, live: true, persisted: false }))
    },
    async readSession(id: SessionId): Promise<SessionLogSnapshot> {
      const entry = find(id)
      if (entry === undefined) throw new Error(`session ${String(id)} is unreadable`)
      return { session: entry.header, inheritedEventCount: SessionLogOffset(0), events: entry.events }
    },
    async readTitleSnapshot(id: SessionId): Promise<SessionTitleObservation> {
      const entry = find(id)
      if (entry === undefined) throw new Error(`session ${String(id)} is unreadable`)
      return { session: entry.header }
    },
  }
}

const config: HostConfig = {
  similarityThreshold: 0.25,
  agreementThreshold: 0.3,
  taskThreshold: 0.3,
  minEvidenceSessions: 2,
  maxConcurrency: 2,
  sessionDigestChars: 4000,
  deliverableReadBytes: 2048,
  updatePolicy: 'propose',
  skillRoot: 'workspace',
  watchMetrics: true,
  maxSessionsPerRun: 10,
  maxPatternsPerSession: 4,
  maxCandidates: 4,
}

const WEEKLY_PATTERN = {
  intent: '生成每周销售周报',
  docType: 'document',
  actions: ['汇总销售数据', '生成周报'],
  inputs: ['销售数据'],
  outputs: ['周报 markdown'],
  tools: ['read', 'write'],
  confidence: 0.9,
}

const WEEKLY_DRAFT = {
  name: 'weekly-report',
  description: '生成每周销售周报。当用户要求周报、销售汇总时使用。',
  content: '# Weekly report\n\n## Output format\n\n## Steps\n\n1. 汇总数据。',
}

/** A runner that records every script request and answers both phases. */
function createRunner(overrides: { authorName?: string; authorDelayMs?: number } = {}) {
  const requests: ScriptRunRequest[] = []
  const runScript = async (request: ScriptRunRequest): Promise<ScriptRunResult> => {
    requests.push(request)
    if (overrides.authorDelayMs !== undefined && request.meta.name === 'skill-factory-extract') {
      await new Promise(resolve => setTimeout(resolve, overrides.authorDelayMs))
    }
    if (request.meta.name === 'skill-factory-extract') {
      const sessions = Array.isArray(request.args?.sessions) ? request.args.sessions : []
      return {
        ok: true,
        value: sessions.map(entry => ({
          sessionId: String((entry as { id?: unknown }).id ?? ''),
          patterns: [WEEKLY_PATTERN],
        })),
      }
    }
    if (request.meta.name === 'skill-factory-author') {
      const candidates = Array.isArray(request.args?.candidates) ? request.args.candidates : []
      return {
        ok: true,
        value: candidates.map(entry => ({
          clusterId: String((entry as { clusterId?: unknown }).clusterId ?? ''),
          name: overrides.authorName ?? WEEKLY_DRAFT.name,
          draft: { ...WEEKLY_DRAFT, name: overrides.authorName ?? WEEKLY_DRAFT.name },
        })),
      }
    }
    return { ok: false, error: `unexpected script ${request.meta.name}` }
  }
  return { requests, runScript }
}

async function mount(
  _workspace: string,
  sessions: StubSession[],
  options: { overrides?: Partial<HostConfig>; unreadable?: SessionHeader[] } = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend()
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionQuery', createStubQuery(sessions, options.unreadable ?? []))
  await ctx.plugin(SkillFactoryService, { ...config, ...options.overrides })
  return ctx
}

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-skill-factory-'))
  roots.push(workspace)
  vi.stubEnv('DSH_HOME', join(workspace, 'home'))
  return workspace
}

function weeklySessions(workspace: string): StubSession[] {
  return [
    session('s1', workspace, '帮我生成一份销售周报', 'reports/weekly-1.md'),
    session('s2', workspace, '根据销售数据再做一份周报', 'reports/weekly-2.md'),
  ]
}

describe('SkillFactoryService.distill', () => {
  it('distills a skill from two sessions and checkpoints them', async () => {
    const workspace = await tempWorkspace()
    const ctx = await mount(workspace, weeklySessions(workspace))
    const runner = createRunner()

    const report = await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })

    expect(report.sessions).toEqual({ total: 2, skipped: 0, processed: 2, failed: 0 })
    expect(report.patterns).toBe(2)
    expect(report.candidates).toHaveLength(1)
    expect(report.candidates[0]?.action).toBe('created')
    expect(report.skills.map(skill => skill.name)).toEqual(['weekly-report'])

    const written = await readFile(join(workspace, '.dsh', 'skills', 'weekly-report', 'SKILL.md'), 'utf8')
    expect(written).toContain('name: "weekly-report"')
    expect(written).toContain('# Weekly report')

    const status = ctx.skillFactory.status(workspace)
    expect(status.sessions).toBe(2)
    expect(status.lastRunMode).toBe('incremental')
    expect(status.running).toBe(false)
    expect(status.skills[0]?.sourceSessions).toBe(2)

    // Each phase ran exactly once for this run.
    expect(runner.requests.filter(request => request.meta.name === 'skill-factory-extract')).toHaveLength(1)
    expect(runner.requests.filter(request => request.meta.name === 'skill-factory-author')).toHaveLength(1)
  })

  it('skips checkpointed sessions on the next incremental run', async () => {
    const workspace = await tempWorkspace()
    const ctx = await mount(workspace, weeklySessions(workspace))
    const runner = createRunner()
    await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })
    runner.requests.length = 0

    const second = await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })

    expect(second.sessions).toEqual({ total: 2, skipped: 2, processed: 0, failed: 0 })
    expect(second.candidates).toHaveLength(0)
    expect(runner.requests).toHaveLength(0)
  })

  it('re-reads every session in full mode without re-authoring the stored skill', async () => {
    const workspace = await tempWorkspace()
    const sessions = weeklySessions(workspace)
    const ctx = await mount(workspace, sessions)
    const runner = createRunner()
    await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })
    runner.requests.length = 0

    const report = await ctx.skillFactory.distill({ mode: 'full' }, { cwd: workspace, runScript: runner.runScript })

    expect(report.sessions.processed).toBe(2)
    expect(report.candidates).toHaveLength(0)
    expect(runner.requests.filter(request => request.meta.name === 'skill-factory-author')).toHaveLength(0)
  })

  it('proposes a revision when a third session extends an existing skill', async () => {
    const workspace = await tempWorkspace()
    const sessions = weeklySessions(workspace)
    const ctx = await mount(workspace, sessions)
    const runner = createRunner()
    await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })
    const skillPath = join(workspace, '.dsh', 'skills', 'weekly-report', 'SKILL.md')
    const before = await readFile(skillPath, 'utf8')

    sessions.push(session('s3', workspace, '汇总本周销售并输出周报', 'reports/weekly-3.md'))
    const report = await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })

    expect(report.sessions.processed).toBe(1)
    const candidate = report.candidates[0]
    expect(candidate?.action).toBe('proposed')
    expect(candidate?.reviewPath).toContain(join('.dsh', 'skill-factory', 'reviews'))
    const review = await readFile(candidate?.reviewPath ?? '', 'utf8')
    expect(review).toContain('# Skill revision proposal: weekly-report')
    expect(review).toContain('## Proposed SKILL.md')
    // The proposal never overwrites the stored skill.
    expect(await readFile(skillPath, 'utf8')).toBe(before)
    const status = ctx.skillFactory.status(workspace)
    expect(status.skills[0]?.sourceSessions).toBe(3)
  })

  it('writes nothing in a dry run', async () => {
    const workspace = await tempWorkspace()
    const ctx = await mount(workspace, weeklySessions(workspace))
    const runner = createRunner()

    const report = await ctx.skillFactory.distill({ dryRun: true }, { cwd: workspace, runScript: runner.runScript })

    expect(report.dryRun).toBe(true)
    expect(report.candidates[0]?.action).toBe('dry-run')
    expect(report.candidates[0]?.name).toBe('weekly-report')
    expect(report.skills).toHaveLength(0)
    expect(ctx.skillFactory.status(workspace).sessions).toBe(0)
    // The pipeline still ran: the dry run previews what a real run would write.
    expect(runner.requests.filter(request => request.meta.name === 'skill-factory-author')).toHaveLength(1)
    await expect(readFile(join(workspace, '.dsh', 'skills', 'weekly-report', 'SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports an extraction script failure without failing the run', async () => {
    const workspace = await tempWorkspace()
    const ctx = await mount(workspace, [session('s1', workspace, '帮我生成一份销售周报', 'reports/weekly-1.md')])

    const report = await ctx.skillFactory.distill({}, {
      cwd: workspace,
      runScript: async (): Promise<ScriptRunResult> => ({ ok: false, error: 'engine unavailable' }),
    })

    expect(report.candidates).toHaveLength(0)
    expect(report.skills).toHaveLength(0)
    expect(report.patterns).toBe(0)
  })

  it('isolates a session whose log cannot be read', async () => {
    const workspace = await tempWorkspace()
    const orphan = header('broken', workspace)
    const ctx = await mount(workspace, weeklySessions(workspace), { unreadable: [orphan] })
    const runner = createRunner()

    const report = await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })

    expect(report.sessions.total).toBe(3)
    expect(report.sessions.failed).toBe(1)
    expect(report.errors[0]?.sessionId).toBe('broken')
    // The readable sessions still produced their skill.
    expect(report.skills.map(skill => skill.name)).toEqual(['weekly-report'])
  })

  it('refuses a second run while the first holds the lock', async () => {
    const workspace = await tempWorkspace()
    const ctx = await mount(workspace, weeklySessions(workspace))
    const runner = createRunner({ authorDelayMs: 60 })

    const first = ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })
    let attempts = 0
    while (!ctx.skillFactory.status(workspace).running && attempts < 200) {
      attempts += 1
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(ctx.skillFactory.status(workspace).running).toBe(true)
    await expect(ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript }))
      .rejects.toThrow('in progress')
    await first
    expect(ctx.skillFactory.status(workspace).running).toBe(false)
  })

  it('records the skill under the user root when configured', async () => {
    const workspace = await tempWorkspace()
    const home = join(workspace, 'home')
    const ctx = await mount(workspace, weeklySessions(workspace), { overrides: { skillRoot: 'user' } })
    const runner = createRunner()

    const report = await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })

    expect(report.candidates[0]?.action).toBe('created')
    const written = await readFile(join(home, 'skills', 'weekly-report', 'SKILL.md'), 'utf8')
    expect(written).toContain('name: "weekly-report"')
  })

  it('writes skills under the project root, not the session directory', async () => {
    const project = await tempWorkspace()
    await mkdir(join(project, '.git'), { recursive: true })
    const workspace = join(project, 'docs')
    await mkdir(workspace, { recursive: true })
    const ctx = await mount(workspace, weeklySessions(workspace))
    const runner = createRunner()

    const report = await ctx.skillFactory.distill({}, { cwd: workspace, runScript: runner.runScript })

    // The report is scoped to the workspace, but the file lands where the
    // local provider discovers project skills.
    expect(report.workspace).toBe(workspace)
    expect(report.candidates[0]?.action).toBe('created')
    const written = await readFile(join(project, '.dsh', 'skills', 'weekly-report', 'SKILL.md'), 'utf8')
    expect(written).toContain('name: "weekly-report"')
    await expect(readFile(join(workspace, '.dsh', 'skills', 'weekly-report', 'SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })

    // A later run reconciles the file it wrote (no spurious revision).
    const second = await ctx.skillFactory.distill({ mode: 'full' }, { cwd: workspace, runScript: runner.runScript })
    expect(second.skills[0]?.metrics.revisions).toBe(0)
  })
})

describe('projectRootFor', () => {
  it('walks up to the nearest ancestor carrying .git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-factory-root-'))
    roots.push(root)
    const nested = join(root, 'a', 'b')
    await mkdir(join(root, '.git'), { recursive: true })
    await mkdir(nested, { recursive: true })
    expect(await projectRootFor(nested)).toBe(root)
  })

  it('returns the workspace itself when no ancestor carries .git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-factory-nogit-'))
    roots.push(root)
    expect(await projectRootFor(root)).toBe(root)
  })
})

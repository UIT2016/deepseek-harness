/**
 * The skill-factory host service: workspace session discovery, bounded
 * digests, extraction and authoring through the caller's workflow engine,
 * deterministic clustering and gating, checkpointing, skill settlement, and
 * skill-usage metrics.
 *
 * The service is host-plane because its durable checkpoint and metrics are
 * host state; the model-driven phases run through the caller-supplied
 * `runScript` capability, which the agent-plane tool implements over that
 * agent's workflow engine.
 * @module @deepseek-ai/dsh-experimental-skill-factory/host
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine, SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { Domain, DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { clusterPatterns, gateCluster, opposingSessions, signPattern, stableClusterId, type SignedPattern } from './cluster.ts'
import { Config, type HostConfig } from './config.ts'
import {
  skillFactoryDomainSpec,
  skillKey,
  type ClusterRecord,
  type PatternRecord,
  type ReviewRecord,
  type SessionCheckpointRecord,
  type SkillFactoryState,
  type SkillRecord,
} from './domain.ts'
import { buildSessionDigest, isTopLevelSession } from './digest.ts'
import {
  buildAuthoringScript,
  buildExtractionScript,
  parseAuthoringResults,
  parseExtractionResults,
  type AuthoringOutcome,
} from './scripts.ts'
import { tokenize } from './signature.ts'
import type {
  DistillExecution,
  DistillRequest,
  EvidencedPattern,
  SessionDigest,
  SessionExtraction,
  SkillCandidate,
  SkillFactoryMode,
  SkillFactoryReport,
  SkillFactoryStatus,
  SkillStatus,
  TaskPattern,
} from './types.ts'
import { contentHash, readSkillFile, resolveSkillRoot, settleCandidate, skillFilePath } from './writer.ts'

/** Names of the two model tools whose arguments name a loadable skill. */
const SKILL_LOAD_TOOLS = new Set(['skill', 'skill_load'])

/** A stale run lock older than this is reclaimed rather than blocking forever. */
const STALE_LOCK_MS = 6 * 60 * 60 * 1000

/** Total digest characters one extraction script run may carry. */
const EXTRACTION_ARGS_BUDGET = 200_000

/** Domain tables and global this service holds after init. */
interface DomainHandles {
  sessions: KvTable<string, SessionCheckpointRecord>
  patterns: KvTable<string, PatternRecord>
  clusters: KvTable<string, ClusterRecord>
  skills: KvTable<string, SkillRecord>
  reviews: KvTable<string, ReviewRecord>
  global: DomainGlobal<SkillFactoryState>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillFactory: SkillFactoryService
  }
}

/** One candidate prepared for authoring. */
interface PreparedCandidate {
  /** Stable cluster id. */
  clusterId: string
  /** Deterministic latin name hint, or an empty string when the intents carry no latin tokens. */
  nameHint: string
  /** Winning classification. */
  docType: SkillCandidate['docType']
  /** Cluster score. */
  score: number
  /** Mean member-to-centroid similarity. */
  meanSimilarity: number
  /** Supporting session ids. */
  sessionIds: SessionId[]
  /** Near-miss sessions kept as opposing evidence. */
  opposing: SessionId[]
  /** Members that evidence the candidate. */
  patterns: EvidencedPattern[]
}

/**
 * Distills reusable skills from one workspace's sessions and their delivered
 * files. Deterministic phases (discovery, digests, clustering, gating,
 * settlement, checkpointing) live here; the two model-driven phases run as
 * workflow scripts supplied by the caller.
 */
export default class SkillFactoryService extends Service {
  static inject = ['storageDomain', 'sessionQuery']
  static Config = Config

  private handles?: DomainHandles
  private readonly config: HostConfig
  private readonly dshHome: string
  private readonly sessionQuery: SessionQueryEngine

  /**
   * @param ctx - Plugin context; must already carry `storageDomain` and `sessionQuery`.
   * @param config - Validated host configuration.
   */
  constructor(ctx: Context, config: HostConfig) {
    super(ctx, 'skillFactory')
    this.config = config
    this.dshHome = resolveDshHome()
    this.sessionQuery = ctx.sessionQuery
  }

  /** Open the checkpoint domain and start the metrics listener. */
  protected async [Service.init](): Promise<void> {
    const domain: Domain<typeof skillFactoryDomainSpec> = await this.ctx.storageDomain.open(skillFactoryDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'skill-factory.domainClose')
    this.handles = {
      sessions: domain.table('sessions'),
      patterns: domain.table('patterns'),
      clusters: domain.table('clusters'),
      skills: domain.table('skills'),
      reviews: domain.table('reviews'),
      global: domain.global,
    }
    if (this.config.watchMetrics) {
      this.ctx.effect(
        () => this.ctx.on('tools/result', (exec) => { this.observeToolResult(exec) }),
        'skill-factory.metrics',
      )
    }
  }

  /** The open domain handles; throws when the service is not initialized. */
  private domain(): DomainHandles {
    const handles = this.handles
    if (handles === undefined) throw new Error('skill-factory: service used before init completed')
    return handles
  }

  /**
   * Read the stored status for one workspace.
   * @param workspace - Absolute workspace root.
   * @returns run state and this workspace's skills.
   */
  status(workspace: string): SkillFactoryStatus {
    const handles = this.domain()
    const state = handles.global.get()
    return {
      lastRunAt: state.lastRunAt,
      lastRunMode: state.lastRunMode,
      running: state.running,
      sessions: handles.sessions.size,
      skills: this.skillsFor(workspace),
    }
  }

  /** Every stored skill belonging to one workspace, name-sorted. */
  private skillsFor(workspace: string): SkillStatus[] {
    const skills: SkillStatus[] = []
    for (const record of this.domain().skills.entries()) {
      const [, skill] = record
      if (skill.workspace !== workspace) continue
      skills.push({
        name: skill.name,
        docType: skill.docType,
        workspace: skill.workspace,
        versions: skill.versions.length,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        sourceSessions: skill.sourceSessions.length,
        metrics: skill.metrics,
      })
    }
    skills.sort((left, right) => left.name.localeCompare(right.name))
    return skills
  }

  /** Record one observed skill invocation against the workspace that owns the skill. */
  private observeToolResult(exec: Readonly<ToolExecution>): void {
    if (!SKILL_LOAD_TOOLS.has(exec.name)) return
    const args = exec.arguments
    if (typeof args !== 'object' || args === null) return
    const name = (args as { name?: unknown }).name
    if (typeof name !== 'string' || name.length === 0) return
    const workspace = exec.agent?.session.header.cwd
    if (workspace === undefined) return
    void this.recordExecution(name, workspace).catch((error: unknown) => {
      this.ctx.logger.warn(`skill-factory: failed to record execution of "${name}": ${String(error)}`)
    })
  }

  /** Increment one stored skill's execution counter. */
  private async recordExecution(name: string, workspace: string): Promise<void> {
    const key = skillKey(workspace, name)
    const record = this.domain().skills.get(key)
    if (record === undefined) return
    const executions = record.metrics.executions + 1
    await this.domain().skills.put(key, {
      ...record,
      metrics: {
        executions,
        revisions: record.metrics.revisions,
        revisionRate: record.metrics.revisions / Math.max(1, executions),
      },
    })
  }

  /**
   * Run one distillation pass over a workspace.
   * @param request - Mode, dry-run flag, and optional explicit session subset.
   * @param exec - Workspace, caller lifetime, and the workflow-script runner.
   * @returns accounting, candidate dispositions, and the workspace's skills.
   * @throws when another run holds the lock, or when the caller cannot run scripts.
   */
  async distill(request: DistillRequest, exec: DistillExecution): Promise<SkillFactoryReport> {
    const handles = this.domain()
    const mode: SkillFactoryMode = request.mode ?? 'incremental'
    const dryRun = request.dryRun === true
    const workspace = exec.cwd
    // Skills must land where the local provider discovers project skills, which
    // is the nearest ancestor carrying `.git`; the workspace itself when there
    // is no such ancestor.
    const artifactRoot = await projectRootFor(workspace)
    const log = exec.log ?? ((): void => {})
    const errors: SkillFactoryReport['errors'] = []
    let skipped = 0
    let processed = 0
    let total = 0
    let patternsAdded = 0
    const candidates: SkillCandidate[] = []
    const fresh: EvidencedPattern[] = []

    if (!dryRun) await this.acquireLock()
    try {
      if (mode !== 'revise-only' && !dryRun) await this.reconcileUserEdits(workspace, artifactRoot)

      if (mode !== 'revise-only') {
        const records = await this.discover(workspace, request, exec.signal)
        total = records.length
        const targets = this.selectTargets(records, mode)
        skipped = targets.skipped
        log(`skill-factory: ${targets.sessions.length} session(s) to process, ${skipped} already checkpointed`)

        const digests: SessionDigest[] = []
        for (const record of targets.sessions) {
          exec.signal?.throwIfAborted()
          try {
            const snapshot = await this.sessionQuery.readSession(record.header.id)
            const title = await this.readTitle(record.header.id)
            digests.push(await buildSessionDigest(snapshot.session, snapshot.events, {
              cwd: workspace,
              ...title === undefined ? {} : { title },
              digestChars: this.config.sessionDigestChars,
              deliverableReadBytes: this.config.deliverableReadBytes,
              readDeliverable: async path => await this.readBounded(path),
            }))
            processed += 1
          } catch (error: unknown) {
            errors.push({ sessionId: String(record.header.id), message: messageOf(error) })
          }
        }

        const extractions = await this.extract(digests, exec)
        const digestBySession = new Map(digests.map(digest => [String(digest.id), digest]))
        for (const extraction of extractions) {
          const sessionId = extraction.sessionId
          try {
            if (!dryRun) {
              await this.replacePatterns(workspace, sessionId, extraction.patterns, digestBySession.get(String(sessionId))?.lastSeq ?? null)
            } else {
              // A dry run persists nothing, so the in-memory extraction is the
              // only evidence the clustering phase can see.
              fresh.push(...toEvidencedPatterns(sessionId, extraction.patterns))
            }
            patternsAdded += extraction.patterns.length
          } catch (error: unknown) {
            errors.push({ sessionId: String(sessionId), message: messageOf(error) })
          }
        }
      }

      const stored = mergePatterns(this.storedPatterns(workspace), fresh)
      const signed = stored.map(signPattern)
      const clusters = clusterPatterns(signed, this.config.similarityThreshold)
      const prepared = this.prepareCandidates(workspace, clusters, signed)
      log(`skill-factory: ${signed.length} stored pattern(s), ${clusters.length} cluster(s), ${prepared.length} candidate(s)`)

      if (prepared.length > 0) {
        const authored = await this.author(prepared, exec)
        for (const outcome of authored) {
          const candidate = prepared.find(entry => entry.clusterId === outcome.clusterId)
          if (candidate === undefined) continue
          candidates.push(await this.settle(workspace, artifactRoot, candidate, outcome, dryRun))
        }
      }

      if (!dryRun) {
        await handles.global.set({
          ...handles.global.get(),
          lastRunAt: Date.now(),
          lastRunMode: mode,
          sessionCount: handles.sessions.size,
        })
      }
    } finally {
      if (!dryRun) await this.releaseLock()
    }

    return {
      mode,
      workspace,
      dryRun,
      sessions: { total, skipped, processed, failed: errors.length },
      patterns: patternsAdded,
      clusters: candidates.filter(candidate => candidate.action === 'created' || candidate.action === 'proposed').length,
      candidates,
      skills: this.skillsFor(workspace),
      errors,
    }
  }

  /** Take the run lock, reclaiming a stale one. */
  private async acquireLock(): Promise<void> {
    const handles = this.domain()
    const state = handles.global.get()
    const now = Date.now()
    if (state.running && now - state.runningStartedAt < STALE_LOCK_MS) {
      throw new Error('skill-factory: another distill run is in progress for this host')
    }
    await handles.global.set({ ...state, running: true, runningStartedAt: now })
  }

  /** Release the run lock. */
  private async releaseLock(): Promise<void> {
    const handles = this.domain()
    await handles.global.set({ ...handles.global.get(), running: false })
  }

  /**
   * Detect user edits of stored skill files and record them as revisions.
   * @param workspace - Absolute workspace root the skill records belong to.
   * @param artifactRoot - Project root the skill files were written under.
   */
  private async reconcileUserEdits(workspace: string, artifactRoot: string): Promise<void> {
    const root = resolveSkillRoot(artifactRoot, this.dshHome, this.config.skillRoot)
    for (const [key, record] of this.domain().skills.entries()) {
      if (record.workspace !== workspace) continue
      const content = await readSkillFile(skillFilePath(root, record.name))
      if (content === undefined) continue
      const hash = contentHash(content)
      if (record.versions.at(-1) === hash) continue
      const revisions = record.metrics.revisions + 1
      await this.domain().skills.put(key, {
        ...record,
        versions: [...record.versions, hash],
        updatedAt: Date.now(),
        metrics: {
          executions: record.metrics.executions,
          revisions,
          revisionRate: revisions / Math.max(1, record.metrics.executions),
        },
      })
    }
  }

  /** Discover the workspace's sessions, or the explicitly requested subset. */
  private async discover(
    workspace: string,
    request: DistillRequest,
    signal: AbortSignal | undefined,
  ): Promise<SessionRecord[]> {
    if (request.sessionIds !== undefined && request.sessionIds.length > 0) {
      return await this.sessionQuery.filterSessions([{ kind: 'id', values: request.sessionIds }], signal)
    }
    return await this.sessionQuery.filterSessions([{ kind: 'cwd', values: [workspace] }], signal)
  }

  /** Split discovered records into processable targets and checkpointed skips. */
  private selectTargets(records: readonly SessionRecord[], mode: SkillFactoryMode): { sessions: SessionRecord[]; skipped: number } {
    const sessions: SessionRecord[] = []
    let skipped = 0
    for (const record of records) {
      if (!isTopLevelSession(record.header)) continue
      if (mode !== 'full' && this.domain().sessions.get(String(record.header.id)) !== undefined) {
        skipped += 1
        continue
      }
      sessions.push(record)
      if (sessions.length >= this.config.maxSessionsPerRun) break
    }
    return { sessions, skipped }
  }

  /** Read one session's folded title, tolerating a title failure. */
  private async readTitle(sessionId: SessionId): Promise<string | undefined> {
    try {
      const observation = await this.sessionQuery.readTitleSnapshot(sessionId)
      return observation.title?.title
    } catch (error: unknown) {
      this.ctx.logger.warn(`skill-factory: title read failed for ${String(sessionId)}: ${String(error)}`)
      return undefined
    }
  }

  /** Read one delivered file, bounded and never throwing. */
  private async readBounded(path: string): Promise<string | undefined> {
    try {
      const text = await readFile(path, 'utf8')
      return text.slice(0, this.config.deliverableReadBytes)
    } catch (error: unknown) {
      this.ctx.logger.warn(`skill-factory: delivered file unreadable at ${path}: ${String(error)}`)
      return undefined
    }
  }

  /** Run the extraction phase over bounded digest chunks. */
  private async extract(digests: readonly SessionDigest[], exec: DistillExecution): Promise<SessionExtraction[]> {
    const results: SessionExtraction[] = []
    const chunks: SessionDigest[][] = []
    let current: SessionDigest[] = []
    let budget = 0
    for (const digest of digests) {
      const size = digest.digest.length
      if (current.length > 0 && budget + size > EXTRACTION_ARGS_BUDGET) {
        chunks.push(current)
        current = []
        budget = 0
      }
      current.push(digest)
      budget += size
    }
    if (current.length > 0) chunks.push(current)

    for (const chunk of chunks) {
      exec.signal?.throwIfAborted()
      const script = buildExtractionScript({
        maxConcurrency: this.config.maxConcurrency,
        maxPatternsPerSession: this.config.maxPatternsPerSession,
      })
      const run = await exec.runScript({
        script,
        meta: {
          name: 'skill-factory-extract',
          description: 'Distill reusable task patterns from workspace sessions',
        },
        args: { sessions: chunk },
      })
      if (!run.ok) {
        this.ctx.logger.warn(`skill-factory: extraction script failed: ${run.error}`)
        continue
      }
      results.push(...parseExtractionResults(run.value, this.config.maxPatternsPerSession))
    }
    return results
  }

  /** Replace one session's stored patterns with the freshly extracted ones. */
  private async replacePatterns(
    workspace: string,
    sessionId: SessionId,
    patterns: readonly TaskPattern[],
    lastSeq: number | null,
  ): Promise<void> {
    const handles = this.domain()
    const prefix = `${String(sessionId)}#`
    for (const key of [...handles.patterns.keys()]) {
      if (key.startsWith(prefix)) await handles.patterns.delete(key)
    }
    const now = Date.now()
    for (const [index, pattern] of patterns.entries()) {
      await handles.patterns.put(`${prefix}${index}`, {
        patternId: `${prefix}${index}`,
        sessionId: String(sessionId),
        workspace,
        intent: pattern.intent,
        docType: pattern.docType,
        actions: pattern.actions,
        inputs: pattern.inputs,
        outputs: pattern.outputs,
        tools: pattern.tools,
        confidence: pattern.confidence,
        createdAt: now,
      })
    }
    await handles.sessions.put(String(sessionId), {
      sessionId: String(sessionId),
      workspace,
      lastSeq,
      processedAt: now,
      patternCount: patterns.length,
    })
  }

  /** Load this workspace's stored patterns in a deterministic order. */
  private storedPatterns(workspace: string): EvidencedPattern[] {
    const patterns: EvidencedPattern[] = []
    for (const [patternId, record] of this.domain().patterns.entries()) {
      if (record.workspace !== workspace) continue
      patterns.push({
        patternId,
        sessionId: record.sessionId as SessionId,
        intent: record.intent,
        docType: record.docType,
        actions: record.actions,
        inputs: record.inputs,
        outputs: record.outputs,
        tools: record.tools,
        confidence: record.confidence,
      })
    }
    patterns.sort((left, right) => left.patternId.localeCompare(right.patternId))
    return patterns
  }

  /** Gate clusters into authoring-ready candidates, skipping covered work. */
  private prepareCandidates(
    workspace: string,
    clusters: ReturnType<typeof clusterPatterns>,
    signed: readonly SignedPattern[],
  ): PreparedCandidate[] {
    const prepared: PreparedCandidate[] = []
    for (const cluster of clusters) {
      const gate = gateCluster(cluster, this.config)
      if (!gate.passed) continue
      const clusterId = stableClusterId(cluster.members.map(member => member.pattern.patternId))
      const existingCluster = this.domain().clusters.get(clusterId)
      if (existingCluster !== undefined && existingCluster.skillName !== undefined && existingCluster.status !== 'rejected') continue
      const sessionIds = [...new Set(cluster.members.map(member => member.pattern.sessionId))]
      if (this.coveredByExistingSkill(workspace, sessionIds)) continue
      const patterns = cluster.members.map(member => member.pattern)
      prepared.push({
        clusterId,
        nameHint: nameHintFor(patterns),
        docType: gate.docType,
        score: gate.score,
        meanSimilarity: gate.meanSimilarity,
        sessionIds,
        opposing: opposingSessions(cluster, signed, this.config.similarityThreshold).map(value => value as SessionId),
        patterns,
      })
    }
    prepared.sort((left, right) => right.score - left.score || left.clusterId.localeCompare(right.clusterId))
    return prepared.slice(0, this.config.maxCandidates)
  }

  /** Whether one existing skill already covers every session of this candidate. */
  private coveredByExistingSkill(workspace: string, sessionIds: readonly SessionId[]): boolean {
    if (sessionIds.length === 0) return true
    for (const [, record] of this.domain().skills.entries()) {
      if (record.workspace !== workspace) continue
      if (record.sourceSessions.length === 0) continue
      const known = new Set(record.sourceSessions)
      // Containment, not overlap: a candidate that adds even one new session
      // is a revision of that skill rather than already-covered work.
      if (sessionIds.every(id => known.has(String(id)))) return true
    }
    return false
  }

  /** Run the authoring phase over the prepared candidates. */
  private async author(candidates: readonly PreparedCandidate[], exec: DistillExecution): Promise<AuthoringOutcome[]> {
    const script = buildAuthoringScript()
    const run = await exec.runScript({
      script,
      meta: {
        name: 'skill-factory-author',
        description: 'Author one SKILL.md per evidence-backed candidate',
      },
      args: {
        candidates: candidates.map(candidate => ({
          clusterId: candidate.clusterId,
          name: candidate.nameHint,
          docType: candidate.docType,
          evidence: {
            sessionIds: candidate.sessionIds.map(String),
            supporting: candidate.sessionIds.map(String),
            opposing: candidate.opposing.map(String),
            score: candidate.score,
            meanSimilarity: candidate.meanSimilarity,
            patterns: candidate.patterns.map(pattern => ({
              sessionId: String(pattern.sessionId),
              intent: pattern.intent,
              docType: pattern.docType,
              actions: pattern.actions,
              inputs: pattern.inputs,
              outputs: pattern.outputs,
              tools: pattern.tools,
            })),
          },
        })),
      },
    })
    if (!run.ok) {
      this.ctx.logger.warn(`skill-factory: authoring script failed: ${run.error}`)
      return []
    }
    return parseAuthoringResults(run.value)
  }

  /** Settle one authored candidate on disk and in the domain. */
  private async settle(
    workspace: string,
    artifactRoot: string,
    candidate: PreparedCandidate,
    outcome: AuthoringOutcome,
    dryRun: boolean,
  ): Promise<SkillCandidate> {
    const base: SkillCandidate = {
      clusterId: candidate.clusterId,
      name: candidate.nameHint,
      docType: candidate.docType,
      score: candidate.score,
      meanSimilarity: candidate.meanSimilarity,
      sessionIds: candidate.sessionIds,
      supporting: candidate.sessionIds,
      opposing: candidate.opposing,
      action: 'rejected',
    }
    if (outcome.draft === null) {
      return { ...base, reason: 'authoring returned no usable draft' }
    }
    if (dryRun) {
      return { ...base, name: outcome.draft.name, action: 'dry-run', reason: 'dry run: nothing was written' }
    }

    const root = resolveSkillRoot(artifactRoot, this.dshHome, this.config.skillRoot)
    const existingKey = skillKey(workspace, outcome.draft.name)
    const existing = this.domain().skills.get(existingKey)
    const previousContent = await readSkillFile(skillFilePath(root, outcome.draft.name))
    const settled = await settleCandidate({
      workspace: artifactRoot,
      dshHome: this.dshHome,
      skillRoot: this.config.skillRoot,
      updatePolicy: this.config.updatePolicy,
      candidate: {
        clusterId: candidate.clusterId,
        name: outcome.draft.name,
        docType: candidate.docType,
        sessionIds: candidate.sessionIds.map(String),
        score: candidate.score,
        meanSimilarity: candidate.meanSimilarity,
      },
      draft: outcome.draft,
      ...previousContent === undefined ? {} : { previousContent },
    })

    if (settled.action === 'rejected') {
      return {
        ...base,
        name: outcome.draft.name,
        ...settled.reason === undefined ? {} : { reason: settled.reason },
      }
    }

    const name = outcome.draft.name
    const sourceSessions = dedupe([...(existing?.sourceSessions ?? []), ...candidate.sessionIds.map(String)])
    const isRevision = existing !== undefined && settled.action === 'created'
    const versions = settled.action === 'created'
      ? [...(existing?.versions ?? []), settled.contentHash]
      : (existing?.versions ?? [])
    const revisions = (existing?.metrics.revisions ?? 0) + (isRevision ? 1 : 0)
    const executions = existing?.metrics.executions ?? 0
    await this.domain().skills.put(existingKey, {
      key: existingKey,
      name,
      workspace,
      docType: candidate.docType,
      versions,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      sourceSessions,
      metrics: { executions, revisions, revisionRate: revisions / Math.max(1, executions) },
    })
    await this.domain().clusters.put(candidate.clusterId, {
      clusterId: candidate.clusterId,
      workspace,
      patternIds: candidate.patterns.map(pattern => pattern.patternId),
      docType: candidate.docType,
      score: candidate.score,
      meanSimilarity: candidate.meanSimilarity,
      status: settled.action === 'created' ? 'accepted' : 'proposed',
      skillName: name,
      createdAt: this.domain().clusters.get(candidate.clusterId)?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    if (settled.reviewPath !== undefined) {
      await this.domain().reviews.put(existingKey, {
        key: existingKey,
        name,
        workspace,
        createdAt: Date.now(),
        path: settled.reviewPath,
        diff: settled.diff ?? '',
      })
    }

    return {
      ...base,
      name,
      action: settled.action,
      ...settled.path === undefined ? {} : { path: settled.path },
      ...settled.reviewPath === undefined ? {} : { reviewPath: settled.reviewPath },
      ...settled.reason === undefined ? {} : { reason: settled.reason },
    }
  }
}

/**
 * Project one session's extracted patterns into evidenced patterns.
 * @param sessionId - Session that evidenced the patterns.
 * @param patterns - Extracted patterns in returned order.
 * @returns one evidenced pattern per input, id-prefixed by the session.
 */
export function toEvidencedPatterns(sessionId: SessionId, patterns: readonly TaskPattern[]): EvidencedPattern[] {
  return patterns.map((pattern, index) => ({
    patternId: `${String(sessionId)}#${index}`,
    sessionId,
    intent: pattern.intent,
    docType: pattern.docType,
    actions: pattern.actions,
    inputs: pattern.inputs,
    outputs: pattern.outputs,
    tools: pattern.tools,
    confidence: pattern.confidence,
  }))
}

/**
 * Merge stored patterns with in-memory ones, the in-memory entry winning a
 * shared id, in a deterministic order.
 * @param stored - Patterns already durable for the workspace.
 * @param fresh - Patterns this run observed but has not persisted.
 * @returns the merged set sorted by pattern id.
 */
export function mergePatterns(
  stored: readonly EvidencedPattern[],
  fresh: readonly EvidencedPattern[],
): EvidencedPattern[] {
  if (fresh.length === 0) return [...stored]
  const byId = new Map(stored.map(pattern => [pattern.patternId, pattern]))
  for (const pattern of fresh) byId.set(pattern.patternId, pattern)
  return [...byId.values()].sort((left, right) => left.patternId.localeCompare(right.patternId))
}

/**
 * The project root the local skill provider discovers for a workspace: the
 * nearest ancestor carrying `.git`, or the workspace itself when no ancestor
 * has one. Skill files must land here rather than at the session's directory,
 * or a session whose project root is the repository would not discover them.
 * @param workspace - Absolute workspace root (the session working directory).
 * @returns the absolute root that owns the workspace's skill directory.
 */
export async function projectRootFor(workspace: string): Promise<string> {
  let current = workspace
  for (;;) {
    try {
      await access(join(current, '.git'))
      return current
    } catch (error: unknown) {
      // A missing marker means "keep walking"; any other failure stops the
      // walk here rather than guessing a parent.
      const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
      if (code !== 'ENOENT') return current
    }
    const parent = dirname(current)
    if (parent === current) return workspace
    current = parent
  }
}

/**
 * Derive a latin kebab-case name hint from a cluster's intents.
 * @param patterns - Patterns of one cluster.
 * @returns a hyphen-joined hint of up to four latin tokens, or an empty string.
 */
export function nameHintFor(patterns: readonly EvidencedPattern[]): string {
  const tokens: string[] = []
  for (const pattern of patterns) {
    for (const token of tokenize(pattern.intent)) {
      if (/^[a-z0-9]+$/u.test(token) && token.length > 1) tokens.push(token)
      if (tokens.length >= 6) break
    }
    if (tokens.length >= 6) break
  }
  const unique = dedupe(tokens).slice(0, 4)
  return unique.join('-').slice(0, 64)
}

/** Deduplicate strings preserving first-seen order. */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
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

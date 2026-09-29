import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleSkillMarkdown, isSkillName, normalizeSkillName } from '../src/templates.ts'
import {
  contentHash,
  readSkillFile,
  resolveSkillRoot,
  settleCandidate,
  skillFilePath,
  summarizeDiff,
  type SettleRequest,
} from '../src/writer.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-factory-writer-'))
  roots.push(root)
  return root
}

function request(overrides: Partial<SettleRequest> & { workspace: string }): SettleRequest {
  return {
    dshHome: join(overrides.workspace, 'home'),
    skillRoot: 'workspace',
    updatePolicy: 'propose',
    candidate: {
      clusterId: 'c1',
      name: 'weekly-report',
      docType: 'document',
      sessionIds: ['s1', 's2'],
      score: 0.6,
      meanSimilarity: 0.6,
    },
    draft: {
      name: 'weekly-report',
      description: 'Produce the weekly sales report. Use when asked for a weekly report.',
      content: '# Weekly report\n\n## Steps\n\n1. Collect the data.\n',
    },
    ...overrides,
  }
}

describe('templates', () => {
  it('validates and normalizes names', () => {
    expect(isSkillName('weekly-report')).toBe(true)
    expect(isSkillName('Weekly Report')).toBe(false)
    expect(isSkillName('a'.repeat(65))).toBe(false)
    expect(normalizeSkillName('  Weekly Report v2! ')).toBe('weekly-report-v2')
  })

  it('assembles frontmatter with exactly one trailing newline', () => {
    const markdown = assembleSkillMarkdown({
      name: 'weekly-report',
      description: 'Report "quoted" text',
      whenToUse: 'Weekly cadence',
      content: '# Weekly report\n\nBody.',
    })
    expect(markdown.startsWith('---\nname: "weekly-report"\n')).toBe(true)
    expect(markdown).toContain('description: "Report \\"quoted\\" text"')
    expect(markdown).toContain('whenToUse: "Weekly cadence"')
    expect(markdown.endsWith('Body.\n')).toBe(true)
  })
})

describe('settleCandidate', () => {
  it('creates a directory-bundle skill under the workspace root', async () => {
    const root = await workspace()
    const outcome = await settleCandidate(request({ workspace: root }))
    expect(outcome.action).toBe('created')
    expect(outcome.path).toBe(skillFilePath(join(root, '.dsh', 'skills'), 'weekly-report'))
    const written = await readFile(outcome.path ?? '', 'utf8')
    expect(written).toContain('name: "weekly-report"')
    expect(outcome.contentHash).toBe(contentHash(written))
  })

  it('proposes instead of overwriting an existing skill', async () => {
    const root = await workspace()
    const stored = join(root, '.dsh', 'skills', 'weekly-report', 'SKILL.md')
    await mkdir(join(root, '.dsh', 'skills', 'weekly-report'), { recursive: true })
    await writeFile(stored, '---\nname: "weekly-report"\ndescription: "stored"\n---\n\n# Stored\n', 'utf8')
    const previousContent = await readSkillFile(stored)
    const outcome = await settleCandidate(request({
      workspace: root,
      ...previousContent === undefined ? {} : { previousContent },
    }))
    expect(outcome.action).toBe('proposed')
    expect(outcome.reviewPath).toBeDefined()
    expect(outcome.diff).toContain('added line(s)')
    expect(await readFile(stored, 'utf8')).toContain('# Stored')
    const review = await readFile(outcome.reviewPath ?? '', 'utf8')
    expect(review).toContain('# Skill revision proposal: weekly-report')
    expect(review).toContain('## Proposed SKILL.md')
    expect(review).toContain('~~~~md')
  })

  it('skips an existing skill under the skip-existing policy', async () => {
    const root = await workspace()
    const stored = join(root, '.dsh', 'skills', 'weekly-report', 'SKILL.md')
    await mkdir(join(root, '.dsh', 'skills', 'weekly-report'), { recursive: true })
    await writeFile(stored, 'stored', 'utf8')
    const outcome = await settleCandidate(request({ workspace: root, updatePolicy: 'skip-existing' }))
    expect(outcome.action).toBe('skipped-existing')
    expect(outcome.reason).toContain('already exists')
    expect(await readFile(stored, 'utf8')).toBe('stored')
  })

  it('replaces an existing skill under the replace policy', async () => {
    const root = await workspace()
    const stored = join(root, '.dsh', 'skills', 'weekly-report', 'SKILL.md')
    await mkdir(join(root, '.dsh', 'skills', 'weekly-report'), { recursive: true })
    await writeFile(stored, 'stored', 'utf8')
    const outcome = await settleCandidate(request({ workspace: root, updatePolicy: 'replace' }))
    expect(outcome.action).toBe('created')
    expect(await readFile(stored, 'utf8')).toContain('# Weekly report')
  })

  it('rejects a name that cannot normalize to kebab-case', async () => {
    const root = await workspace()
    const outcome = await settleCandidate(request({
      workspace: root,
      candidate: {
        clusterId: 'c1',
        name: '---',
        docType: 'document',
        sessionIds: ['s1'],
        score: 0.5,
        meanSimilarity: 0.5,
      },
      draft: { name: '---', description: 'x', content: '# x' },
    }))
    expect(outcome.action).toBe('rejected')
    expect(outcome.reason).toContain('kebab-case')
  })

  it('falls back to the candidate name when the author returns an unusable one', async () => {
    const root = await workspace()
    const outcome = await settleCandidate(request({
      workspace: root,
      candidate: {
        clusterId: 'c1',
        name: 'weekly-report',
        docType: 'document',
        sessionIds: ['s1'],
        score: 0.5,
        meanSimilarity: 0.5,
      },
      draft: { name: '!!!', description: 'x', content: '# x' },
    }))
    expect(outcome.action).toBe('created')
    expect(outcome.path).toContain('weekly-report')
  })

  it('writes a flat-file conflict as a proposal too', async () => {
    const root = await workspace()
    await mkdir(join(root, '.dsh', 'skills'), { recursive: true })
    await writeFile(join(root, '.dsh', 'skills', 'weekly-report.md'), 'flat', 'utf8')
    const outcome = await settleCandidate(request({ workspace: root }))
    expect(outcome.action).toBe('proposed')
  })
})

describe('resolveSkillRoot and summarizeDiff', () => {
  it('routes the user root under the harness home', () => {
    expect(resolveSkillRoot('/ws', '/home/dsh', 'user')).toBe(join('/home/dsh', 'skills'))
    expect(resolveSkillRoot('/ws', '/home/dsh', 'workspace')).toBe(join('/ws', '.dsh', 'skills'))
  })

  it('summarizes a first version and a textual change', () => {
    expect(summarizeDiff(undefined, '# a')).toBe('new skill (no stored version)')
    expect(summarizeDiff('# a\n', '# a\n')).toBe('no textual change')
    const summary = summarizeDiff('# a\nold\n', '# a\nnew\n')
    expect(summary).toContain('1 added line(s), 1 removed line(s)')
    expect(summary).toContain('- old')
    expect(summary).toContain('+ new')
  })
})

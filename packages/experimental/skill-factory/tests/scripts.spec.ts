import { describe, expect, it } from 'vitest'
import {
  AUTHORING_SCHEMA,
  EXTRACTION_SCHEMA,
  buildAuthoringScript,
  buildExtractionScript,
  extractorInstructions,
  parseAuthoringResults,
  parseExtractionResults,
} from '../src/scripts.ts'

describe('buildExtractionScript', () => {
  const script = buildExtractionScript({ maxConcurrency: 3, maxPatternsPerSession: 5 })

  it('fans out through the engine hooks and returns the per-session array', () => {
    expect(script).toContain('const sessions = Array.isArray(args.sessions)')
    expect(script).toContain('await parallel(batch.map')
    expect(script).toContain('agent(basePrompt')
    expect(script).toContain('start += 3')
    expect(script.trimEnd().endsWith('return out')).toBe(true)
  })

  it('embeds the schema and the pattern bound', () => {
    expect(script).toContain(JSON.stringify(EXTRACTION_SCHEMA))
    expect(script).toContain('at most 5 patterns')
    expect(extractorInstructions(5)).toContain('language the user wrote in')
  })

  it('clamps a non-positive concurrency to one', () => {
    expect(buildExtractionScript({ maxConcurrency: 0, maxPatternsPerSession: 1 })).toContain('start += 1')
  })
})

describe('buildAuthoringScript', () => {
  const script = buildAuthoringScript()

  it('authors one draft per candidate and keeps the schema', () => {
    expect(script).toContain('const candidates = Array.isArray(args.candidates)')
    expect(script).toContain('await parallel(candidates.map')
    expect(script).toContain(JSON.stringify(AUTHORING_SCHEMA))
    expect(script.trimEnd().endsWith('return candidates.map((candidate, index) => ({ clusterId: candidate.clusterId, name: candidate.name, draft: settled[index] || null }))')).toBe(true)
  })
})

describe('parseExtractionResults', () => {
  it('keeps valid patterns and drops unusable entries', () => {
    const parsed = parseExtractionResults([
      {
        sessionId: 's1',
        patterns: [
          {
            intent: '生成周报',
            docType: 'document',
            actions: ['collect'],
            inputs: ['data'],
            outputs: ['report'],
            tools: ['read'],
            confidence: 1.4,
          },
          { intent: '', docType: 'document', actions: [], inputs: [], outputs: [], tools: [], confidence: 0.5 },
          { intent: '未知分类', docType: 'nonsense', actions: [], inputs: [], outputs: [], tools: [], confidence: 0.2 },
        ],
      },
      { patterns: [] },
      'not-an-object',
    ], 8)
    expect(parsed).toHaveLength(1)
    const entry = parsed[0]
    expect(entry?.sessionId).toBe('s1')
    expect(entry?.patterns).toHaveLength(2)
    expect(entry?.patterns[0]?.confidence).toBe(1)
    expect(entry?.patterns[1]?.docType).toBe('mixed')
  })

  it('applies the per-session bound and the string-array caps', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      intent: `intent ${index}`,
      docType: 'workflow',
      actions: Array.from({ length: 20 }, (_, action) => `action ${action}`),
      inputs: [],
      outputs: [],
      tools: [],
      confidence: 0.5,
    }))
    const parsed = parseExtractionResults([{ sessionId: 's1', patterns: many }], 2)
    expect(parsed[0]?.patterns).toHaveLength(2)
    expect(parsed[0]?.patterns[0]?.actions).toHaveLength(8)
  })

  it('returns nothing for a non-array value', () => {
    expect(parseExtractionResults(null, 3)).toEqual([])
  })
})

describe('parseAuthoringResults', () => {
  it('keeps complete drafts and reports incomplete children as null', () => {
    const parsed = parseAuthoringResults([
      { clusterId: 'c1', name: 'weekly-report', draft: { name: 'weekly-report', description: 'desc', content: '# body' } },
      { clusterId: 'c2', name: 'x', draft: { name: 'x', description: '', content: '# body' } },
      { clusterId: 'c3', name: 'y', draft: null },
      { clusterId: '', name: 'z', draft: { name: 'z', description: 'd', content: 'c' } },
    ])
    expect(parsed).toHaveLength(3)
    expect(parsed[0]?.draft?.name).toBe('weekly-report')
    expect(parsed[1]?.draft).toBeNull()
    expect(parsed[2]?.draft).toBeNull()
  })

  it('clips over-long fields and drops an empty whenToUse', () => {
    const parsed = parseAuthoringResults([{
      clusterId: 'c1',
      name: 'n',
      draft: {
        name: 'x'.repeat(80),
        description: 'd'.repeat(600),
        whenToUse: '   ',
        content: 'c'.repeat(5000),
      },
    }])
    const draft = parsed[0]?.draft
    expect(draft?.name).toHaveLength(64)
    expect(draft?.description).toHaveLength(500)
    expect(draft?.content).toHaveLength(4000)
    expect(draft?.whenToUse).toBeUndefined()
  })
})

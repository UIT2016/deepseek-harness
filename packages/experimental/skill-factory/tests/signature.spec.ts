import { describe, expect, it } from 'vitest'
import { cosine, foldCentroid, meanSimilarity, patternSignature, termFrequency, tokenize } from '../src/signature.ts'

describe('tokenize', () => {
  it('emits CJK bigrams and keeps a lone unspaced character', () => {
    expect(tokenize('生成周报')).toEqual(['生成', '成周', '周报'])
    expect(tokenize('周')).toEqual(['周'])
  })

  it('folds Latin case, keeps digits, and drops single letters', () => {
    expect(tokenize('Hello, World 42 a b')).toEqual(['hello', 'world', '42'])
    expect(tokenize('v2 5')).toEqual(['v2', '5'])
  })

  it('splits mixed text at every separator boundary', () => {
    expect(tokenize('周报 report-v2')).toEqual(['周报', 'report', 'v2'])
  })
})

describe('termFrequency and cosine', () => {
  it('normalizes to a unit vector', () => {
    const vector = termFrequency(tokenize('weekly report weekly'))
    let sumSquares = 0
    for (const weight of vector.values()) sumSquares += weight * weight
    expect(sumSquares).toBeCloseTo(1, 10)
  })

  it('scores identical vectors 1 and disjoint vectors 0', () => {
    const a = termFrequency(tokenize('生成周报'))
    const b = termFrequency(tokenize('生成周报'))
    const c = termFrequency(tokenize('deploy pipeline'))
    expect(cosine(a, b)).toBeCloseTo(1, 10)
    expect(cosine(a, c)).toBe(0)
  })

  it('returns an empty vector for text with no tokens', () => {
    expect(termFrequency(tokenize('   ')).size).toBe(0)
  })
})

describe('patternSignature', () => {
  const weekly = {
    intent: '生成每周销售周报',
    docType: 'document' as const,
    actions: ['汇总销售数据', '生成图表'],
    inputs: ['销售数据'],
    outputs: ['周报 markdown'],
    tools: ['read', 'write'],
  }
  const weeklyAgain = {
    intent: '根据运营数据做周报',
    docType: 'document' as const,
    actions: ['整理运营数据', '输出周报'],
    inputs: ['运营数据'],
    outputs: ['周报文件'],
    tools: ['read', 'write'],
  }
  const bugAnalysis = {
    intent: '分析这个 bug 的根因',
    docType: 'workflow' as const,
    actions: ['复现问题', '定位代码'],
    inputs: ['崩溃日志'],
    outputs: ['根因说明'],
    tools: ['grep', 'read'],
  }

  it('scores two instances of one task higher than two different tasks', () => {
    const a = patternSignature(weekly)
    const b = patternSignature(weeklyAgain)
    const c = patternSignature(bugAnalysis)
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c))
  })

  it('keeps the classification as a structural token', () => {
    const document = patternSignature({ ...bugAnalysis, docType: 'document' })
    const workflow = patternSignature(bugAnalysis)
    expect(cosine(document, workflow)).toBeLessThan(1)
  })
})

describe('foldCentroid and meanSimilarity', () => {
  it('keeps the centroid a unit vector when folding a second member', () => {
    const first = termFrequency(tokenize('weekly report'))
    const second = termFrequency(tokenize('weekly summary'))
    const centroid = foldCentroid(first, second, 1)
    let sumSquares = 0
    for (const weight of centroid.values()) sumSquares += weight * weight
    expect(sumSquares).toBeCloseTo(1, 10)
    expect(meanSimilarity(centroid, [first, second])).toBeGreaterThan(0)
  })

  it('uses the member itself as the first centroid', () => {
    const only = termFrequency(tokenize('weekly report'))
    const centroid = foldCentroid(undefined, only, 0)
    expect(cosine(centroid, only)).toBeCloseTo(1, 10)
    expect(meanSimilarity(centroid, [])).toBe(0)
  })
})

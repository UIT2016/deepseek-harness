import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  clusterDocType,
  clusterPatterns,
  gateCluster,
  opposingSessions,
  requiredSimilarity,
  signPattern,
  stableClusterId,
} from '../src/cluster.ts'
import type { EvidencedPattern } from '../src/types.ts'

function pattern(patternId: string, sessionId: string, intent: string, docType: EvidencedPattern['docType']): EvidencedPattern {
  return {
    patternId,
    sessionId: SessionId(sessionId),
    intent,
    docType,
    actions: ['collect data', 'write output'],
    inputs: ['source data'],
    outputs: ['weekly artifact'],
    tools: ['read', 'write'],
    confidence: 0.8,
  }
}

const weeklyA = pattern('s1#0', 's1', '生成每周销售周报', 'document')
const weeklyB = pattern('s2#0', 's2', '根据销售数据做周报', 'document')
const weeklyC = pattern('s3#0', 's3', '生成每周运营周报', 'document')
const bug: EvidencedPattern = {
  ...pattern('s4#0', 's4', '分析线上 bug 根因', 'workflow'),
  actions: ['复现崩溃', '定位代码'],
  inputs: ['崩溃日志'],
  outputs: ['根因说明'],
  tools: ['grep'],
}

const signed = [weeklyA, weeklyB, weeklyC, bug].map(signPattern)

describe('clusterPatterns', () => {
  it('groups similar patterns and separates a different task', () => {
    const clusters = clusterPatterns(signed, 0.25)
    expect(clusters).toHaveLength(2)
    const [weekly, analysis] = clusters
    expect(weekly?.members).toHaveLength(3)
    expect(analysis?.members).toHaveLength(1)
    expect(analysis?.members[0]?.pattern.sessionId).toBe('s4')
  })

  it('starts a new cluster when nothing reaches the threshold', () => {
    const clusters = clusterPatterns(signed, 0.99)
    expect(clusters).toHaveLength(4)
  })

  it('classifies by majority with ties resolving to mixed', () => {
    const mixed = [weeklyA, bug].map(signPattern)
    const clusters = clusterPatterns(mixed, 0.99)
    const first = clusters[0]
    const second = clusters[1]
    if (first === undefined || second === undefined) throw new Error('expected two clusters')
    expect(clusterDocType(first)).toBe('document')
    expect(clusterDocType(second)).toBe('workflow')
    expect(clusterDocType({ members: [...first.members, ...second.members], centroid: first.centroid })).toBe('mixed')
  })
})

describe('gateCluster', () => {
  const config = { agreementThreshold: 0.4, taskThreshold: 0.4, minEvidenceSessions: 2 }

  it('rejects a single-session cluster', () => {
    const clusters = clusterPatterns([signPattern(weeklyA)], 0.2)
    const cluster = clusters[0]
    if (cluster === undefined) throw new Error('expected one cluster')
    const gate = gateCluster(cluster, config)
    expect(gate.passed).toBe(false)
    expect(gate.reason).toContain('distinct session')
  })

  it('accepts a two-session cluster above the document threshold', () => {
    const clusters = clusterPatterns([signPattern(weeklyA), signPattern(weeklyB)], 0.2)
    const cluster = clusters[0]
    if (cluster === undefined) throw new Error('expected one cluster')
    const gate = gateCluster(cluster, config)
    expect(gate.passed).toBe(true)
    expect(gate.distinctSessions).toBe(2)
    expect(gate.docType).toBe('document')
    expect(gate.score).toBeGreaterThan(0)
    expect(gate.score).toBeLessThanOrEqual(1)
  })

  it('rejects a cluster whose internal similarity is below the required threshold', () => {
    const clusters = clusterPatterns([signPattern(weeklyA), signPattern(bug)], 0)
    const cluster = clusters[0]
    if (cluster === undefined) throw new Error('expected one cluster')
    const gate = gateCluster(cluster, { ...config, agreementThreshold: 0.9, taskThreshold: 0.9 })
    expect(gate.passed).toBe(false)
    expect(gate.reason).toContain('mean similarity')
  })

  it('requires a mixed candidate to clear both thresholds', () => {
    expect(requiredSimilarity('document', { agreementThreshold: 0.2, taskThreshold: 0.6 })).toBe(0.2)
    expect(requiredSimilarity('workflow', { agreementThreshold: 0.2, taskThreshold: 0.6 })).toBe(0.6)
    expect(requiredSimilarity('mixed', { agreementThreshold: 0.2, taskThreshold: 0.6 })).toBe(0.6)
  })
})

describe('opposingSessions and stableClusterId', () => {
  it('reports a near-miss session as opposing evidence', () => {
    const clusters = clusterPatterns(signed, 0.3)
    const weekly = clusters[0]
    if (weekly === undefined) throw new Error('expected one cluster')
    const opposing = opposingSessions(weekly, signed, 0.3)
    expect(opposing).not.toContain('s1')
    expect(opposing).not.toContain('s2')
  })

  it('derives the same id regardless of member order', () => {
    expect(stableClusterId(['b#0', 'a#1'])).toBe(stableClusterId(['a#1', 'b#0']))
    expect(stableClusterId(['a#0'])).not.toBe(stableClusterId(['a#1']))
  })
})

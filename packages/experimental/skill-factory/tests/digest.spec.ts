import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import {
  buildSessionDigest,
  extractAssistantOutcomes,
  extractDeliverables,
  extractToolUsage,
  extractUserRequests,
  isTopLevelSession,
  structurePortrait,
} from '../src/digest.ts'

function header(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('session-1'),
    createdAt: 1,
    cwd: '/work',
    isSeeded: false,
    delegationDepth: 0,
    ...overrides,
  }
}

function userEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
  }
}

function assistantEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
      stream: [],
    },
  }
}

function toolCallEvent(seq: number, name: string): SessionEvent {
  return {
    type: 'tool/call',
    seq: SessionSeq(seq),
    time: seq,
    data: { turn: 1, step: 1, callId: ToolCallId(`call-${seq}`), name, arguments: '{}' },
  }
}

function presentedEvent(seq: number, files: { path: string; description?: string }[]): SessionEvent {
  return {
    type: 'deliverables/presented',
    seq: SessionSeq(seq),
    time: seq,
    data: { turn: 1, callId: ToolCallId(`call-${seq}`), files },
  }
}

function turnEndEvent(seq: number): SessionEvent {
  return { type: 'turn/end', seq: SessionSeq(seq), time: seq, data: { turn: 1, reason: { kind: 'completed' } } }
}

describe('isTopLevelSession', () => {
  it('accepts a root session and rejects subagent children', () => {
    expect(isTopLevelSession(header())).toBe(true)
    expect(isTopLevelSession(header({ delegationDepth: 1 }))).toBe(false)
    expect(isTopLevelSession(header({ origin: 'subagent' }))).toBe(false)
  })
})

describe('event extraction', () => {
  const events = [
    userEvent(1, '帮我生成一份周报'),
    toolCallEvent(2, 'read'),
    toolCallEvent(3, 'read'),
    toolCallEvent(4, 'write'),
    assistantEvent(5, '周报已生成'),
    presentedEvent(6, [{ path: 'reports/weekly.md', description: '周报' }]),
    turnEndEvent(7),
  ]

  it('collects user requests, tool usage, outcomes, and deliverables', () => {
    expect(extractUserRequests(events)).toEqual(['帮我生成一份周报'])
    expect([...extractToolUsage(events).entries()]).toEqual([['read', 2], ['write', 1]])
    expect(extractAssistantOutcomes(events)).toEqual(['周报已生成'])
    expect(extractDeliverables(events)).toEqual([{ path: 'reports/weekly.md', description: '周报' }])
  })

  it('ignores delivered entries without a usable path', () => {
    const malformed: SessionEvent = {
      type: 'deliverables/presented',
      seq: SessionSeq(8),
      time: 8,
      data: { turn: 1, callId: ToolCallId('call-8'), files: [{ path: '', description: 'empty path' }] },
    }
    expect(extractDeliverables([malformed])).toEqual([])
  })
})

describe('structurePortrait', () => {
  it('prefers markdown headings, then the first non-empty line', () => {
    expect(structurePortrait('# Weekly\n\n## Sections\n\n## Metrics\ntext')).toEqual(['# Weekly', '## Sections', '## Metrics'])
    expect(structurePortrait('plain first line\nsecond')).toEqual(['plain first line'])
    expect(structurePortrait('   ')).toEqual([])
  })
})

describe('buildSessionDigest', () => {
  const events = [
    userEvent(1, '帮我生成一份周报，包含销售和运营数据'),
    toolCallEvent(2, 'read'),
    toolCallEvent(3, 'bash'),
    presentedEvent(4, [{ path: 'reports/weekly.md', description: '周报' }]),
    assistantEvent(5, '周报已生成，包含销售与运营两个章节。'),
    turnEndEvent(6),
  ]

  it('renders the requests, deliverables with a portrait, tools, and outcomes', async () => {
    const digest = await buildSessionDigest(header(), events, {
      cwd: '/work',
      title: '周报生成',
      digestChars: 4000,
      deliverableReadBytes: 1024,
      readDeliverable: async () => '# Weekly report\n\n## Sales\n\n## Operations\n',
    })
    expect(digest.id).toBe('session-1')
    expect(digest.title).toBe('周报生成')
    expect(digest.turns).toBe(1)
    expect(digest.lastSeq).toBe(6)
    expect(digest.digest).toContain('USER REQUESTS')
    expect(digest.digest).toContain('帮我生成一份周报')
    expect(digest.digest).toContain('[structure: # Weekly report / ## Sales / ## Operations]')
    expect(digest.digest).toContain('tools: bash(1), read(1)')
    expect(digest.digest).toContain('OUTCOMES')
  })

  it('stays within the character bound and still lists deliverables', async () => {
    const long = Array.from({ length: 40 }, (_, index) => userEvent(index + 1, `请求 ${index} ${'x'.repeat(200)}`))
    const digest = await buildSessionDigest(header(), [...long, presentedEvent(100, [{ path: 'out.md' }])], {
      cwd: '/work',
      digestChars: 1200,
      deliverableReadBytes: 1024,
    })
    expect(digest.digest.length).toBeLessThanOrEqual(1200)
    expect(digest.digest).toContain('DELIVERABLES')
    expect(digest.digest).toContain('out.md')
  })

  it('never reads a delivered path outside the workspace', async () => {
    let called = 0
    const digest = await buildSessionDigest(header(), [presentedEvent(1, [{ path: '../secret.md' }])], {
      cwd: '/work/project',
      digestChars: 2000,
      deliverableReadBytes: 512,
      readDeliverable: async () => { called += 1; return '# leaked' },
    })
    expect(called).toBe(0)
    expect(digest.digest).toContain('../secret.md')
  })

  it('reports an empty log without throwing', async () => {
    const digest = await buildSessionDigest(header(), [], { cwd: '/work', digestChars: 1000, deliverableReadBytes: 256 })
    expect(digest.lastSeq).toBeNull()
    expect(digest.turns).toBe(0)
    expect(digest.digest).toContain('(none declared)')
  })
})

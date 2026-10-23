import { describe, expect, it, vi } from 'vitest'
import {
  distribution,
  interactionResultErrors,
  QAProfiler
} from '../../fixtures/migration/performanceMetrics'

describe('performance QA metrics', () => {
  it('rejects incomplete, untrusted and mismatched interaction results', () => {
    const result = {
      schemaVersion: 1, sent: 1, received: 1, completed: 1,
      pendingHandlers: 0, checks: {
        content: true, selection: true, receivedAll: true, completedAll: true,
        trusted: true, inputChain: true, repeat: true
      }, passed: true,
      events: [{ trusted: true, handlerMs: 2 }]
    }
    expect(interactionResultErrors(result)).toEqual([])
    expect(interactionResultErrors({ ...result, received: 0 }))
      .toContain('received')
    expect(interactionResultErrors({ ...result,
      checks: { content: false } })).toContain('checks')
    expect(interactionResultErrors({ ...result,
      events: [{ trusted: false, handlerMs: 2 }] })).toContain('events')
    expect(interactionResultErrors({})).toContain('sent')
  })
  it('reports nearest-rank tails, empty samples and preserves raw order', () => {
    const values = [40, 10, 30, 20]
    expect(distribution(values)).toEqual({
      count: 4,
      p50: 20,
      p95: 40,
      p99: 40,
      max: 40
    })
    expect(values).toEqual([40, 10, 30, 20])
    expect(distribution([]).p95).toBeNull()
  })

  it('separates nested self time and retains receivers and return values', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const profiler = new QAProfiler()
      const subject = {
        value: 7,
        inner() {
          now += 3
          return this.value
        },
        outer() {
          now += 2
          const result = this.inner()
          now += 5
          return result
        }
      }
      profiler.track(subject, 'inner', 'inner')
      profiler.track(subject, 'outer', 'outer', () => ({ items: 1 }))
      expect(subject.outer()).toBe(7)
      expect(profiler.stages.startup.outer).toEqual({
        calls: 1,
        ms: 10,
        selfMs: 7,
        work: { items: 1 }
      })
      expect(profiler.stages.startup.inner.selfMs).toBe(3)
      profiler.reset('edit')
      profiler.enabled = false
      subject.outer()
      expect(profiler.stages).toEqual({})
    } finally {
      clock.mockRestore()
    }
  })

  it('unwinds thrown spans so later measurements remain usable', () => {
    const profiler = new QAProfiler()
    const subject = {
      fail() {
        throw new Error('failure')
      }
    }
    profiler.track(subject, 'fail', 'failure')
    expect(() => subject.fail()).toThrow('failure')
    expect(profiler.stages.startup.failure.calls).toBe(1)
    expect(() => profiler.reset('next')).not.toThrow()
  })
})

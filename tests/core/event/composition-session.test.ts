import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompositionSession } from '@/editor/core/event/CompositionSession'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('composition frame scheduling', () => {
  it('coalesces latest state and has a synchronous materialization barrier', () => {
    vi.useFakeTimers()
    const consume = vi.fn()
    const session = new CompositionSession(consume)
    session.update('n', true)
    session.update('ni', true)
    session.update('nih', true)
    expect(consume).not.toHaveBeenCalled()
    vi.advanceTimersByTime(17)
    expect(consume).toHaveBeenCalledExactlyOnceWith('nih', true)
    session.flush(true)
    expect(consume).toHaveBeenLastCalledWith('nih', false)
    expect(session.stats.merged).toBe(2)
    session.close()
  })

  it('falls back when rAF is suspended and invalidates callbacks on close', () => {
    vi.useFakeTimers()
    const callbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => {
      callbacks.push(fn)
      return callbacks.length
    })
    const consume = vi.fn()
    const session = new CompositionSession(consume)
    session.update('n', true)
    vi.advanceTimersByTime(51)
    expect(consume).toHaveBeenCalledOnce()
    session.update('ni', true)
    session.close()
    callbacks.forEach(fn => fn(0))
    vi.advanceTimersByTime(100)
    expect(consume).toHaveBeenCalledOnce()
  })
})

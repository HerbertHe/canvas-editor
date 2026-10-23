import { describe, expect, it, vi } from 'vitest'
import { WorkerRequestRegistry } from '@/editor/core/worker/WorkerRequestRegistry'

function worker() {
  const value = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker
  const answer = (data: unknown) => value.onmessage?.call(value,
    new MessageEvent('message', { data }))
  return { value, answer }
}

describe('worker requests', () => {
  it('remembers startup errors before the first request', async () => {
    const registry = new WorkerRequestRegistry()
    const { value } = worker()
    registry.attach(value)
    value.onerror?.call(value, new ErrorEvent('error', { message: 'CSP denied' }))
    await expect(registry.request(value, null, 1)).rejects.toThrow('CSP denied')
    expect(value.postMessage).not.toHaveBeenCalled()
    registry.destroy()
  })
  it('resolves each snapshot when responses arrive out of order', async () => {
    const registry = new WorkerRequestRegistry()
    const { value, answer } = worker()
    const first = registry.request(value, { text: 'first' }, 1)
    const second = registry.request(value, { text: 'second' }, 2)
    answer({ requestId: 2, revision: 2, result: 'second' })
    answer({ requestId: 1, revision: 1, result: 'first' })
    expect(await first).toBe('first')
    expect(await second).toBe('second')
    registry.destroy()
    expect(value.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects mismatches, timeout, synchronous posting errors and destroy', async () => {
    vi.useFakeTimers()
    const registry = new WorkerRequestRegistry(20)
    const { value, answer } = worker()
    const wrong = expect(registry.request(value, null, 1)).rejects.toThrow('revision')
    answer({ requestId: 1, revision: 2, result: null })
    await wrong
    const timed = expect(registry.request(value, null, 3)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(21)
    await timed
    vi.mocked(value.postMessage).mockImplementationOnce(() => { throw new Error('clone') })
    await expect(registry.request(value, null, 4)).rejects.toThrow('clone')
    const pending = expect(registry.request(value, null, 5)).rejects.toThrow('destroyed')
    registry.destroy()
    await pending
    await expect(registry.request(value, null, 6)).rejects.toThrow('destroyed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails all requests for the crashed worker while preserving other workers', async () => {
    const registry = new WorkerRequestRegistry()
    const first = worker()
    const other = worker()
    const a = expect(registry.request(first.value, null, 1)).rejects.toThrow('crash')
    const b = expect(registry.request(first.value, null, 1)).rejects.toThrow('crash')
    const c = registry.request(other.value, null, 1)
    first.value.onerror?.call(first.value, new ErrorEvent('error', { message: 'crash' }))
    await Promise.all([a, b])
    other.answer({ requestId: 3, revision: 1, result: 123 })
    expect(await c).toBe(123)
    registry.destroy()
  })

})

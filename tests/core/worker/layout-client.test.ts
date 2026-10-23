import { describe, expect, it, vi } from 'vitest'
import { LayoutWorkerClient } from '@/editor/core/worker/layout/LayoutWorkerClient'
import type { LayoutRequest, LayoutResponse } from '@/editor/core/worker/layout/protocol'

function worker() {
  const messages: LayoutRequest[] = []
  const value = { onmessage: null, onerror: null, onmessageerror: null,
    terminate: vi.fn(), postMessage: (message: LayoutRequest) => {
      messages.push(structuredClone(message))
    } } as unknown as Worker
  const answer = (message: LayoutRequest, type: LayoutResponse['type'] = 'ack') =>
    value.onmessage?.call(value, new MessageEvent('message', {
      data: { sessionId: message.sessionId, requestId: message.requestId,
        documentRevision: message.documentRevision, fontRevision: message.fontRevision,
        constraintsRevision: message.constraintsRevision, type, layouts: [], inputs: [] }
    }))
  return { value, messages, answer }
}

describe('layout worker client lifecycle and backpressure', () => {
  it('batches ordered edits and waits for their acknowledgement before layout', async () => {
    const fake = worker()
    const client = new LayoutWorkerClient(() => fake.value)
    const initialized = client.initialize({ main: [], header: [], footer: [] }, [], '', 0, 0)
    fake.answer(fake.messages[0])
    await initialized
    const edits = Array.from({ length: 100 }, (_, i) => client.edit({
      baseRevision: i, targetRevision: i + 1, kind: 'input',
      before: null, after: null, dirtyScopes: ['main'], source: 'edit',
      operations: [{ kind: 'splice', scope: 'main', index: i,
        before: [], after: [{ value: 'x' }] }]
    }))
    const layout = client.layout([], 1)
    await Promise.resolve()
    const batch = fake.messages.at(-1)!
    expect(batch.type).toBe('edits')
    if (batch.type === 'edits') {
      expect(batch.transactions).toHaveLength(100)
      expect(batch.transactions.map(t => t.targetRevision))
        .toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
    }
    expect(fake.messages.filter(m => m.type === 'layout')).toHaveLength(0)
    fake.answer(batch)
    await Promise.all(edits)
    await client.waitForEdits()
    await vi.waitFor(() => expect(fake.messages.at(-1)!.type).toBe('layout'))
    const request = fake.messages.at(-1)!
    expect(request.type).toBe('layout')
    expect(request.documentRevision).toBe(100)
    fake.answer(request, 'layout')
    await layout
    expect(client.getQueueStats().queuedBytes).toBe(0)
    expect(client.stats.maxPending).toBe(1)
    client.destroy()
  })

  it('rejects active and waiting layouts on destroy and ignores late replies', async () => {
    const fake = worker()
    const client = new LayoutWorkerClient(() => fake.value)
    const initialized = client.initialize({ main: [], header: [], footer: [] }, [], '', 0, 0)
    fake.answer(fake.messages[0])
    await initialized
    const late = fake.value.onmessage!
    const active = expect(client.layout([], 1)).rejects.toThrow('destroyed')
    const waiting = expect(client.layout([], 2)).rejects.toThrow('destroyed')
    const request = fake.messages.at(-1)!
    client.destroy()
    await Promise.all([active, waiting])
    late.call(fake.value, new MessageEvent('message', { data: {
      ...request, type: 'layout', layouts: []
    } }))
    expect(client.ready).toBe(false)
    expect(fake.messages.filter(message => message.type === 'layout')).toHaveLength(1)
    await expect(client.inspect()).rejects.toThrow('unavailable')
  })

  it('refuses oversized waiting inputs before posting or replacing valid work', async () => {
    const fake = worker()
    const client = new LayoutWorkerClient(() => fake.value, 5000, 1024)
    const initialized = client.initialize({ main: [], header: [], footer: [] }, [], '', 0, 0)
    fake.answer(fake.messages[0])
    await initialized
    const active = client.layout([], 1)
    const waiting = client.layout([], 2)
    // A long scope ID is enough to exceed the DTO budget without shaping text.
    const oversized = [{ scopeId: 'x'.repeat(2048) }] as unknown as Parameters<typeof client.layout>[0]
    await expect(client.layout(oversized, 3)).rejects.toThrow('waiting queue budget')
    fake.answer(fake.messages.at(-1)!, 'layout')
    await active
    await Promise.resolve()
    fake.answer(fake.messages.at(-1)!, 'layout')
    expect((await waiting).constraintsRevision).toBe(2)
    expect(client.ready).toBe(true)
    client.destroy()
  })

  it('retains one latest waiting layout and rejects every superseded request', async () => {
    const fake = worker()
    const client = new LayoutWorkerClient(() => fake.value)
    const initialized = client.initialize({ main: [], header: [], footer: [] }, [], '', 0, 1)
    fake.answer(fake.messages[0])
    await initialized
    const first = client.layout([], 1)
    const superseded = expect(client.layout([], 2)).rejects.toThrow('superseded')
    const latest = client.layout([], 3)
    let drained = false
    const idle = client.waitForIdle().then(() => { drained = true })
    await superseded
    expect(fake.messages.filter(m => m.type === 'layout')).toHaveLength(1)
    fake.answer(fake.messages.at(-1)!, 'layout')
    await first
    await Promise.resolve()
    expect(drained).toBe(false)
    fake.answer(fake.messages.at(-1)!, 'layout')
    expect((await latest).constraintsRevision).toBe(3)
    await idle
    expect(drained).toBe(true)
    expect(client.getQueueStats().requests).toBe(0)
    expect(client.stats.maxPending).toBeLessThanOrEqual(1)
    client.destroy()
    expect(fake.value.terminate).toHaveBeenCalledOnce()
  })

  it('rejects old sessions, pending destroy and timeout without leaking timers', async () => {
    vi.useFakeTimers()
    const workers = [worker(), worker()]
    const client = new LayoutWorkerClient(() => workers.shift()!.value, 20)
    // Keep references before the factory consumes them.
    const first = workers[0]
    const initialized = client.initialize({ main: [], header: [], footer: [] }, [], '', 0, 0)
    first.answer(first.messages[0])
    await initialized
    const pending = expect(client.layout([], 1)).rejects.toThrow('session replaced')
    const second = workers[0]
    const restarted = client.initialize({ main: [], header: [], footer: [] }, [], '', 0, 0)
    await pending
    second.answer(second.messages[0])
    await restarted
    const timed = expect(client.layout([], 2)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(21)
    await timed
    expect(client.ready).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    client.destroy()
    expect(first.value.terminate).toHaveBeenCalledOnce()
    expect(second.value.terminate).toHaveBeenCalledOnce()
  })
})

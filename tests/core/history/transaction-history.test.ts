import { describe, expect, it } from 'vitest'
import { HistoryManager } from '@/editor/core/history/HistoryManager'
import type { Draw } from '@/editor/core/draw/Draw'

function setup(max = 100, bytes = 10000) {
  let value = 0
  let checkpoints = 0
  const snapshot = () => {
    const saved = value
    checkpoints++
    return Object.assign(() => { value = saved }, { estimatedBytes: 16 })
  }
  const manager = new HistoryManager({
    getOptions: () => ({ historyMaxRecordCount: max,
      lab: { transactionHistory: true, historyByteBudget: bytes } }),
    createHistorySnapshot: snapshot,
    replayHistoryBatch: (action: () => void) => action()
  } as unknown as Draw)
  manager.execute(snapshot())
  const edit = (time: number, groupable = true, scope = 'main', kind = 'input') => {
    const previous = value
    value++
    const next = value
    manager.executeDelta({ undo: () => { value = previous },
      redo: () => { value = next }, from: previous, to: next,
      time, groupable, scope, kind, bytes: 20 })
  }
  return { manager, edit, value: () => value, checkpoints: () => checkpoints,
    snapshot, set: (next: number) => { value = next } }
}

describe('transaction history', () => {
  it('groups adjacent same-kind edits within 400ms and closes at 401ms', () => {
    const { manager, edit, value } = setup()
    edit(0); edit(400); edit(800); edit(1201)
    manager.undo()
    expect(value()).toBe(3)
    manager.undo()
    expect(value()).toBe(0)
    manager.redo(); manager.redo()
    expect(value()).toBe(4)
    manager.undo()
    edit(1300)
    expect(manager.isCanRedo()).toBe(false)
  })

  it('reconstructs a previous delta state when undoing a snapshot barrier', () => {
    const context = setup()
    context.edit(0)
    context.edit(1)
    context.set(20)
    context.manager.execute(context.snapshot())
    context.manager.undo()
    expect(context.value()).toBe(2)
    context.manager.undo()
    expect(context.value()).toBe(0)
    context.manager.redo(); context.manager.redo()
    expect(context.value()).toBe(20)
  })

  it('honors count and byte budgets without losing the earliest usable checkpoint', () => {
    const context = setup(3, 70)
    for (let i = 0; i < 12; i++) context.edit(i * 500, false)
    expect(context.manager.getStats().undo).toBeLessThanOrEqual(4)
    expect(context.manager.getStats().bytes).toBeLessThanOrEqual(70)
    const current = context.value()
    context.manager.undo(); context.manager.redo()
    expect(context.value()).toBe(current)
    context.manager.recovery()
    expect(context.manager.getStats()).toEqual({ undo: 0, redo: 0, bytes: 0 })
  })
})

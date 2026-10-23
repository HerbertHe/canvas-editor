import { describe, expect, it } from 'vitest'
import { EditJournal, applyOperation, inverseOperation,
  type EditOperation } from '@/editor/core/history/EditTransaction'
import type { IElement } from '@/editor/interface/Element'

describe('reversible journal', () => {
  it('owns payloads, replays in order and distinguishes deletion from undefined', () => {
    const elements: IElement[] = [{ value: 'a' }]
    const ops: EditOperation[] = [
      { kind: 'splice', scope: 'main', index: 1, before: [], after: [{ value: 'b' }] },
      { kind: 'attributes', scope: 'main', index: 0,
        before: { color: { present: false } },
        after: { color: { present: true, value: undefined } } }
    ]
    const journal = new EditJournal()
    const tx = journal.publish('input', ops, { index: 0 }, { index: 1 })!
    if (ops[0].kind === 'splice') ops[0].after[0].value = 'external mutation'
    for (const op of tx.operations) applyOperation(op, () => elements)
    expect(elements[1].value).toBe('b')
    expect(Object.hasOwn(elements[0], 'color')).toBe(true)
    for (const op of tx.operations.slice().reverse()) applyOperation(inverseOperation(op), () => elements)
    expect(elements).toEqual([{ value: 'a' }])
    expect(Object.hasOwn(elements[0], 'color')).toBe(false)
    expect(journal.publish('render', [], {}, {})).toBeNull()
    expect(journal.getRevision()).toBe(1)
  })
})

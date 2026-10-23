import { describe, expect, it } from 'vitest'
import { DocumentFlow } from '@/editor/core/layout/DocumentFlow'
import { PaperDirection } from '@/editor/dataset/enum/Editor'
import { captureFlow, restoreFlow, sameFlow } from '@/editor/core/layout/FlowCheckpoint'

describe('complete flow checkpoint dependencies', () => {
  it('restores the exact suffix across columns, pages, gaps and exclusions', () => {
    const page = () => ({ top: 20, bottom: 200, left: 10, width: 110,
      columns: [0, 130] })
    const exclusions = [{ pageNo: 0, x: 10, y: 40, width: 25, height: 40 }]
    const original = new DocumentFlow(PaperDirection.VERTICAL, page, exclusions)
    original.place(32)
    original.place(20, 3, 7, 6)
    const checkpoint = captureFlow(original, 'p:1', 'frames/fonts/constraints:v1')
    const restored = new DocumentFlow(PaperDirection.VERTICAL, page, exclusions)
    restoreFlow(restored, checkpoint, 'frames/fonts/constraints:v1')
    for (let i = 0; i < 100; i++) {
      const height = 10 + i % 7
      expect(restored.place(height, 1, 2, 5, !!(i % 2)))
        .toEqual(original.place(height, 1, 2, 5, !!(i % 2)))
    }
    expect(restored.state).toEqual(original.state)
    expect(sameFlow(restored.state, { ...restored.state, y: restored.state.y + 1e-9 }))
      .toBe(false)
  })

  it('rejects frame/font/constraint, exclusion and page geometry mismatches', () => {
    let width = 100
    const page = () => ({ top: 10, bottom: 100, left: 0, width, columns: [0] })
    const flow = new DocumentFlow(PaperDirection.VERTICAL, page)
    const checkpoint = captureFlow(flow, 'p', 'v1')
    expect(() => restoreFlow(flow, checkpoint, 'v2')).toThrow('dependencies')
    width = 101
    expect(() => restoreFlow(flow, checkpoint, 'v1')).toThrow('page')
    width = 100
    flow.exclusions.push({ pageNo: 0, x: 0, y: 0, width: 1, height: 1 })
    expect(() => restoreFlow(flow, checkpoint, 'v1')).toThrow('exclusions')
  })
})

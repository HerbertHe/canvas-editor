import { describe, expect, it } from 'vitest'
import { IncrementalFlow } from '@/editor/core/layout/IncrementalFlow'
import { DocumentFlow } from '@/editor/core/layout/DocumentFlow'
import { PaperDirection } from '@/editor/dataset/enum/Editor'
import type { LayoutRow } from '@/editor/interface/LayoutRow'
import type { ParagraphRecord } from '@/editor/core/layout/ParagraphIndex'

const entry = (id: string, start: number) => ({ start, end: start + 1,
  record: { id, elements: [{ value: 'a' }], content: 1, metrics: 0, paint: 0,
    editable: true, plain: true } as ParagraphRecord })
function setup() {
  let width = 100
  const page = () => ({ top: 0, bottom: 100, left: 0, width, columns: [0] })
  const makeFlow = () => new DocumentFlow(PaperDirection.VERTICAL, page)
  const cache = new IncrementalFlow()
  const entries = Array.from({ length: 1000 }, (_, i) => entry(`p${i}`, i))
  const flow = makeFlow()
  cache.begin()
  for (const e of entries) cache.paragraph(e.record, e.start, 0, flow, 'v1', () => {
    flow.place(10)
    return { rows: [], nodes: [] }
  }, false, true)
  cache.end()
  return { cache, entries, makeFlow, width: (value: number) => { width = value } }
}

describe('range flow commits', () => {
  it('resumes an exact prefix and converged suffix with checks per page rather than paragraph', () => {
    const { cache, entries, makeFlow } = setup()
    cache.begin()
    const flow = makeFlow()
    const before = { ...cache.stats }
    expect(cache.reuseRange(entries.slice(0, 500), flow, 'v1', 0)).toHaveLength(500)
    expect(cache.reuseRange(entries, flow, 'v1', 0, 500)).toHaveLength(500)
    expect(cache.stats.checked - before.checked).toBe(0)
    expect(cache.stats.checkpointChecks - before.checkpointChecks).toBeLessThan(120)
    expect(cache.stats.batchChecked - before.batchChecked).toBe(1000)
    expect(cache.reused).toHaveLength(1000)
  })

  it('rejects revision, dependency, placement and page changes without partially accepting the run', () => {
    for (const change of ['revision', 'dependencies', 'placement', 'page']) {
      const { cache, entries, makeFlow, width } = setup()
      cache.begin()
      const flow = makeFlow()
      if (change === 'revision') entries[700].record.paint++
      if (change === 'placement') flow.state.y++
      if (change === 'page') width(101)
      expect(cache.reuseRange(entries, flow,
        change === 'dependencies' ? 'v2' : 'v1', 0)).toBeNull()
      expect(cache.reused).toHaveLength(0)
      expect(cache.stats.batchReused).toBe(0)
    }
  })

  it('checks intermediate pages of a paragraph, not only its entry and exit pages', () => {
    let middleWidth = 100
    const makeFlow = () => new DocumentFlow(PaperDirection.VERTICAL, page => ({
      top: 0, bottom: 100, left: 0,
      width: page === 1 ? middleWidth : 100, columns: [0]
    }))
    const cache = new IncrementalFlow()
    const e = entry('long', 0)
    const flow = makeFlow()
    cache.begin()
    cache.paragraph(e.record, 0, 0, flow, 'v1', () => ({
      rows: Array.from({ length: 3 }, () => ({ flow: flow.place(100) } as LayoutRow)),
      nodes: []
    }), false, true)
    cache.end()
    cache.begin()
    middleWidth = 101
    expect(cache.reuseRange([e], makeFlow(), 'v1', 0)).toBeNull()
    expect(cache.reused).toHaveLength(0)
    let computed = 0
    cache.paragraph(e.record, 0, 0, makeFlow(), 'v1', () => {
      computed++
      return { rows: [], nodes: [] }
    }, false, true)
    expect(computed).toBe(1)
  })

  it('does not mistake a reordered tail for convergence', () => {
    const { cache, entries, makeFlow } = setup()
    cache.begin()
    const reordered = [...entries]
    ;[reordered[5], reordered[6]] = [reordered[6], reordered[5]]
    expect(cache.reuseRange(reordered, makeFlow(), 'v1', 0)).toBeNull()
  })
})

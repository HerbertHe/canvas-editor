import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LayoutCaret,
  LayoutFontRef,
  TextLine
} from '@/editor/interface/Layout'
import * as legacy from '@/editor/core/layout/InteractionGeometry'
import {
  LineGeometryCache,
  LineGeometryIndex,
  NativeRowIndex
} from '@/editor/core/layout/LineGeometryIndex'

const font: LayoutFontRef = {
  faceId: 'font', family: 'Test', weight: 400,
  style: 'normal', fontRevision: 1
}
function caret(index: number, offset: number, x: number): LayoutCaret {
  return {
    position: { elementIndex: index, offset },
    x, y: 2, height: 18, bidiLevel: 0, affinity: 'upstream'
  }
}
function line(length = 4): TextLine {
  const clusters = Array.from({ length }, (_, i) => ({
    textStart: i, textEnd: i + 1, logicalIndices: [i + 1],
    glyphStart: i, glyphEnd: i + 1, font,
    rect: { x: i * 10, y: 2, width: 10, height: 18 },
    carets: [caret(i + 1, 0, i * 10), caret(i + 1, 1, (i + 1) * 10)]
  }))
  return {
    kind: 'textLine', id: 'p:line:0', paragraphId: 'p',
    source: { scope: 'main', nodeId: 'p', start: 1, end: length + 1 },
    revision: { documentRevision: 1, fontRevision: 1 },
    rect: { x: 0, y: 2, width: length * 10, height: 18 },
    hidden: false, direction: 'ltr', baseline: 14, contentHeight: 18,
    spacingBefore: 0, spacingAfter: 12, glyphs: [], clusters,
    carets: clusters.flatMap(cluster => cluster.carets), inlines: [],
    empty: length === 0
  }
}
function verify(placed: legacy.PlacedTextLine, cache = new LineGeometryCache()) {
  const index = cache.get(placed)
  expect(index.carets).toEqual(legacy.lineCarets(placed))
  expect(index.segments).toEqual(legacy.lineSegments(placed))
  for (let i = 0; i <= placed.line.source.end + 1; i++) {
    expect(index.getCarets(i)).toEqual(
      legacy.lineCarets(placed).filter(c => c.index === i)
    )
    expect(index.getElementRects(i)).toEqual(
      legacy.textRangeRects(placed, i, i + 1)
    )
  }
  return index
}
afterEach(() => vi.restoreAllMocks())

describe('line geometry differential', () => {
  for (const scale of [0.75, 1, 1.75])
    for (const clip of [
      undefined,
      { x: -3, y: 30, width: 27, height: 8 },
      { x: 999, y: 999, width: 1, height: 1 }
    ]) {
      it(`matches transforms and clipping: ${scale}/${clip?.x}`, () => {
        verify({ line: line(), x: -12, y: 25, pageNo: 2,
          columnIndex: 1, scale, clip })
      })
    }

  it('preserves both visual affinities and first-match deduplication', () => {
    const source = line()
    source.direction = 'rtl'
    source.carets.push({ ...caret(2, 0, 50), affinity: 'downstream' })
    source.carets.push({ ...caret(2, 0, 50), affinity: 'upstream' })
    const index = verify({ line: source, x: 0, y: 0, pageNo: 0, scale: 1 })
    expect(index.getCarets(1)).toHaveLength(2)
    expect(index.getCarets(1)[1].affinity).toBe('downstream')
    expect(index.logicalCarets.map(c => c.index)).toEqual(
      [...index.carets].map(c => c.index).sort((a, b) => a - b)
    )
  })

  it('deduplicates after clipping, retaining the taller visible duplicate', () => {
    const source = line(0)
    source.carets = [caret(1, 0, 0), { ...caret(1, 0, 0), height: 30 }]
    const placed = { line: source, x: 0, y: 0, pageNo: 0, scale: 1,
      clip: { x: 0, y: 22, width: 30, height: 10 } }
    expect(verify(placed).carets).toHaveLength(1)
  })

  it('matches combining clusters, ligature stops and missing/object boxes', () => {
    const source = line()
    source.clusters[0].logicalIndices = [1, 2]
    source.clusters[0].carets = [caret(1, 0, 0), caret(2, 1, 20)]
    source.clusters.splice(1, 1)
    const missing = {
      kind: 'missingGlyph' as const, id: 'missing', text: '👩‍👩‍👧‍👦',
      source: { scope: 'main', nodeId: 'missing', start: 5, end: 7 },
      revision: source.revision,
      rect: { x: 40, y: 2, width: 20, height: 18 }, hidden: false,
      diagnosticId: 'missing', advance: 20,
      carets: [caret(5, 0, 40), caret(6, 1, 60)]
    }
    source.inlines.push(missing, {
      kind: 'inlineObject', objectType: 'checkbox', id: 'box',
      source: { scope: 'main', nodeId: 'box', start: 7, end: 8 },
      revision: source.revision, hidden: false,
      rect: { x: 60, y: 2, width: 12, height: 18 },
      advance: 12, ascent: 18, descent: 0, anchor: caret(7, 0, 60)
    })
    source.source.end = 8
    source.carets = [
      ...source.clusters.flatMap(cluster => cluster.carets), ...missing.carets
    ]
    verify({ line: source, x: 17, y: -5, pageNo: 1, scale: 1.25 })
  })

  it('matches empty and hidden lines without selecting paragraph spacing', () => {
    for (const hidden of [false, true]) {
      const source = line(0)
      source.hidden = hidden
      source.carets = [caret(1, 0, 0)]
      const index = verify({ line: source, x: 0, y: 0, pageNo: 0, scale: 1 })
      expect(index.getElementRects(1)).toEqual([])
    }
  })
})

describe('geometry ownership and invalidation', () => {
  it('constructs once per placement, not once per element/query', () => {
    const build = vi.spyOn(LineGeometryIndex, 'create')
    const local = vi.spyOn(legacy, 'lineSegments')
    const cache = new LineGeometryCache()
    const placed = { line: line(200), x: 0, y: 0, pageNo: 0, scale: 1 }
    const first = cache.get(placed)
    for (let i = 1; i <= 200; i++) {
      const current = cache.get(placed)
      expect(current).toBe(first)
      current.getCarets(i)
      expect(current.getElementRects(i)).toBe(first.getElementRects(i))
    }
    expect(build).toHaveBeenCalledTimes(1)
    expect(local).toHaveBeenCalledTimes(1)
    cache.get({ ...placed, pageNo: 1 })
    expect(build).toHaveBeenCalledTimes(2)
    expect(local).toHaveBeenCalledTimes(1)
  })

  it('reprojects after shifts, clip mutations, zoom, columns and revisions', () => {
    const cache = new LineGeometryCache()
    const placed = { line: line(), x: 0, y: 0, pageNo: 0, scale: 1,
      columnIndex: 0, clip: { x: 0, y: 0, width: 100, height: 100 } }
    let previous = verify(placed, cache)
    for (const mutate of [
      () => { placed.y += 30 },
      () => { placed.clip.y += 15 },
      () => { placed.clip.width = 22 },
      () => { placed.scale = 0.75 },
      () => { placed.x = 5 },
      () => { placed.pageNo = 2 },
      () => { placed.columnIndex = 1 },
      () => { placed.line.revision.fontRevision++ },
      () => { placed.line.revision.documentRevision++ },
      () => { placed.line = structuredClone(placed.line) }
    ]) {
      mutate()
      const next = verify(placed, cache)
      expect(next).not.toBe(previous)
      previous = next
    }
    cache.invalidate(placed)
    expect(cache.get(placed)).not.toBe(previous)
    previous = cache.get(placed)
    cache.clear()
    expect(cache.get(placed)).not.toBe(previous)
  })

  it('isolates repeated fragments and independent cells sharing IDs', () => {
    const cache = new LineGeometryCache()
    const source = line()
    const a = { line: source, x: 0, y: 0, pageNo: 0, scale: 1 }
    const b = { ...a, y: 100, columnIndex: 1 }
    const c = { ...a, line: { ...source,
      source: { ...source.source, scope: 'td:other' } } }
    expect(cache.get(a)).not.toBe(cache.get(b))
    expect(cache.get(a)).not.toBe(cache.get(c))
    expect(cache.get(b).carets[0].y - cache.get(a).carets[0].y).toBe(100)
  })
})

describe('native row lookup', () => {
  it('matches identity before source ID, retaining first page/column matches', () => {
    const index = new NativeRowIndex()
    const a = { line: line(), x: 0, y: 0, pageNo: 0, scale: 1 }
    const b = { ...a, line: structuredClone(a.line), pageNo: 1 }
    const c = { ...a, pageNo: 1 }
    for (const item of [a, b, c, { ...c, columnIndex: 2 }]) index.add(item)
    expect(index.find(a.line)).toBe(a)
    expect(index.find(a.line, 1)).toBe(c)
    expect(index.find(structuredClone(a.line), 1)).toBe(b)
    expect(index.find(a.line, 2)).toBeUndefined()
    expect(new NativeRowIndex().find(a.line)).toBeUndefined()
    expect(index.find({ ...a.line,
      source: { ...a.line.source, scope: 'td:other' } })).toBeUndefined()
  })

  it.each(['header:vertical', 'footer:horizontal'])(
    'preserves frame fallback across pages: %s', scope => {
      const index = new NativeRowIndex()
      const source = line()
      source.source.scope = scope
      const placed = { line: source, x: 0, y: 0, pageNo: 0, scale: 1 }
      index.add(placed)
      expect(index.find(source, 7)).toBe(placed)
      expect(index.find(structuredClone(source), 7)).toBe(placed)
    }
  )
})

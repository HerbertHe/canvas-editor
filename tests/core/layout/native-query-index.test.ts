import { describe, expect, it, vi } from 'vitest'
import type { LayoutCaret, LayoutFontRef, TextLine } from '@/editor/interface/Layout'
import { NativeQueryIndex } from '@/editor/core/layout/NativeQueryIndex'
import { LineGeometryCache, LineGeometryIndex } from '@/editor/core/layout/LineGeometryIndex'
import { projectTextLine } from '@/editor/core/layout/relativeLayout'
import { compareNativeQueries } from '../../fixtures/migration/compareNativeQueries'

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

function placed(start = 1, hidden = false, rtl = false) {
  const source = line()
  source.id = `p:${start}`
  source.source.start = start
  source.source.end += start - 1
  source.hidden = hidden
  source.direction = rtl ? 'rtl' : 'ltr'
  for (const c of source.carets) c.position.elementIndex += start - 1
  for (const cluster of source.clusters)
    cluster.logicalIndices = cluster.logicalIndices.map(i => i + start - 1)
  return { line: source, x: 0, y: start * 10, pageNo: 0, scale: 1 }
}

describe('native query differential', () => {
  it('preserves queries across incrementally shifted lines and page boundaries', () => {
    const lines = [placed(1), placed(5, false, true), placed(9)]
    lines[1].pageNo = 1
    lines[2].pageNo = 1
    lines[0].line.clusters[0].logicalIndices = [1, 2]
    lines[0].line.clusters[0].carets = [caret(1, 0, 0), caret(2, 1, 20)]
    lines[0].line.clusters.splice(1, 1)
    lines[0].line.carets = lines[0].line.clusters.flatMap(c => c.carets)
    expect(() => compareNativeQueries(lines, true)).not.toThrow()
    expect(() => compareNativeQueries(lines.map(p => ({ ...p,
      line: projectTextLine(p.line, 3) })), true)).not.toThrow()
  })

  it('reuses character maps when only global source indices change', () => {
    const cache = new LineGeometryCache()
    const lines = Array.from({ length: 1000 }, (_, i) => placed(i * 4 + 1))
    NativeQueryIndex.create(lines, cache, true)
    const get = vi.spyOn(cache, 'get')
    const shifted = lines.map(p => ({ ...p,
      line: projectTextLine(p.line, 7) }))
    const query = NativeQueryIndex.create(shifted, cache, true)
    expect(get).not.toHaveBeenCalled()
    expect(query.caret(10, null)?.index).toBe(10)
    expect(query.deleteRange(query.caret(10, null)!, true, false))
      .toEqual({ index: 10, count: 1, cursorIndex: 9 })
    expect(get).not.toHaveBeenCalled()
  })

  it('uses committed geometry and rebases from an already shifted query basis', () => {
    const cache = new LineGeometryCache()
    const first = [placed(1), placed(5)].map(p => ({ ...p,
      line: projectTextLine(p.line, 7) }))
    first.forEach(p => cache.get(p))
    const builds = vi.spyOn(LineGeometryIndex, 'create')
    NativeQueryIndex.create(first, cache, true)
    expect(builds).not.toHaveBeenCalled()
    const next = first.map(p => ({ ...p,
      line: projectTextLine(p.line, 3) }))
    const query = NativeQueryIndex.create(next, cache, true)
    expect(builds).not.toHaveBeenCalled()
    const current = query.caret(12, null)!
    expect(current.index).toBe(12)
    expect(current.position.elementIndex).toBe(12)
    expect(query.deleteRange(current, true, false))
      .toEqual({ index: 12, count: 1, cursorIndex: 11 })
    builds.mockRestore()
  })

  it('retains boundaries, hints, hidden lines, bidi, clips and repeated placements', () => {
    const lines = [placed(), placed(5, true), placed(9, false, true)]
    lines[2].line.carets.push({ ...caret(10, 0, 70), affinity: 'downstream' })
    // A grapheme spans multiple host elements; no internal caret is legal.
    const cluster = lines[0].line.clusters[0]
    cluster.logicalIndices = [1, 2]
    cluster.carets = [caret(1, 0, 0), caret(2, 1, 20)]
    lines[0].line.clusters.splice(1, 1)
    lines[0].line.carets = lines[0].line.clusters.flatMap(c => c.carets)
    expect(compareNativeQueries([...lines,
      { ...lines[0], pageNo: 1, y: 100 },
      { ...placed(13), clip: { x: 10, y: 130, width: 20, height: 10 } }
    ])).toBeGreaterThan(1000)
  })

  it('does no remote line geometry work after building the generation', () => {
    for (const count of [10, 1000]) {
      const cache = new LineGeometryCache()
      const lines = Array.from({ length: count }, (_, i) => placed(i * 4 + 1))
      const query = new NativeQueryIndex(lines, cache)
      const get = vi.spyOn(cache, 'get')
      for (let i = 0; i < 100; i++) {
        const current = query.caret(2, null)!
        query.deleteRange(current, true, false)
        query.deleteRange(current, false, true)
        query.normalize(2, 'before')
        query.move(current, 1, false, false)
      }
      expect(get).not.toHaveBeenCalled()
    }
  })
})

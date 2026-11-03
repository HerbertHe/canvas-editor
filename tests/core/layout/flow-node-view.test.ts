import { describe, expect, it } from 'vitest'
import { projectTextLine, translateTextLineView } from '@/editor/core/layout/relativeLayout'
import { translateLayout } from '@/editor/core/layout/translateLayout'
import type { TextLine } from '@/editor/interface/Layout'

describe('re-placed native node views', () => {
  it('matches eager translation after a source shift without reading carets at creation', () => {
    let reads = 0
    const caret = { x: 1, y: 2, height: 10, bidiLevel: 0, affinity: 'downstream',
      position: { elementIndex: 2, offset: 1 } }
    const carets = new Proxy([caret], { get: (target, key, receiver) => {
      if (key === '0') reads++
      return Reflect.get(target, key, receiver)
    } })
    const box = { x: 0, y: 0, width: 10, height: 10 }
    const source = { scope: 'main', nodeId: 'p', start: 2, end: 3 }
    const line = { kind: 'textLine', id: 'line', source,
      revision: { documentRevision: 1, fontRevision: 1 },
      rect: box, glyphs: [], carets, direction: 'ltr',
      clusters: [{ rect: box, logicalIndices: [2], carets }],
      inlines: [{ kind: 'missingGlyph', rect: box, source, carets }],
      labels: [{ rect: box, source }], baseline: 8,
      contentHeight: 10, spacingBefore: 0, spacingAfter: 0 } as unknown as TextLine
    const shifted = projectTextLine(line, 3)
    const view = translateTextLineView(shifted, 20, 30)
    expect(reads).toBe(0)
    expect(view.rect).toEqual({ x: 20, y: 30, width: 10, height: 10 })
    expect(view.carets[0].position.elementIndex).toBe(5)
    expect(view.carets[0]).toMatchObject({ x: 21, y: 32 })
    expect(JSON.parse(JSON.stringify(view)))
      .toEqual(JSON.parse(JSON.stringify(translateLayout([shifted], 20, 30)[0])))
  })
})

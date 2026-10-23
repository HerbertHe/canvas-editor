import { describe, expect, it } from 'vitest'
import { projectLayout, projectTextLine } from '@/editor/core/layout/relativeLayout'
import type { NativeParagraphLayout } from '@/editor/core/text-engine/layout/TextLayoutService'

describe('canonical geometry projection', () => {
  it('keeps repeated suffix shifts equivalent to a single projection', () => {
    const base = {
      lines: [{ kind: 'textLine', source: { start: 10, end: 12 },
        revision: { documentRevision: 1, fontRevision: 1 }, glyphs: [],
        carets: [{ position: { elementIndex: 10, offset: 0 } }],
        clusters: [{ logicalIndices: [10, 11],
          carets: [{ position: { elementIndex: 11, offset: 0 } }] }],
        labels: [{ source: { start: 10, end: 12 } }],
        inlines: [{ kind: 'missingGlyph', source: { start: 10, end: 11 },
          carets: [{ position: { elementIndex: 10, offset: 0 } }] }] }],
      shaped: { lines: [{ logicalStart: 10, logicalEnd: 12,
        glyphs: [{ logicalIndexStart: 10, logicalIndexEnd: 12,
          logicalIndices: [10, 11] }] }] }
    } as unknown as NativeParagraphLayout
    const revision = { documentRevision: 2, fontRevision: 1 }
    let projected = base
    let line = base.lines[0]
    for (let i = 0; i < 10000; i++) {
      projected = projectLayout(projected, 1, revision)
      line = projectTextLine(line, 1)
    }
    // Reading any nested geometry must not recurse through 10000 prior views.
    expect(projected).toEqual(projectLayout(base, 10000, revision))
    expect(line).toEqual(projectTextLine(base.lines[0], 10000))
    expect(projected.lines[0].glyphs).toBe(base.lines[0].glyphs)
    expect(base.lines[0].carets[0].position.elementIndex).toBe(10)
  })
})

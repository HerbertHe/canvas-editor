import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LayoutKernel } from '@/editor/core/text-engine/layout/LayoutKernel'
import { createLayoutWork } from '@/editor/core/text-engine/layout/LayoutWork'
import type { NativeParagraphInput } from '@/editor/core/text-engine/layout/TextLayoutService'

const kernels: LayoutKernel[] = []
afterEach(() => kernels.splice(0).forEach(kernel => kernel.destroy()))

describe('optional paragraph work profiling', () => {
  it.each(['Latin fi words', '中文 e\u0301 😀', 'مرحبا بالعالم'])(
    'counts actual work without changing %s layout', async text => {
      const kernel = new LayoutKernel()
      kernels.push(kernel)
      await kernel.initialize([{ family: 'Test', data: new Uint8Array(
        readFileSync('public/fonts/NotoNaskhArabic-Regular.ttf')).buffer }], 'Test')
      const input: NativeParagraphInput = {
        spans: [{ logicalIndex: 0,
          logicalIndices: Array.from({ length: text.length }, (_, i) => i),
          text, style: { fontFamily: 'Test', fontSize: 16 } }],
        direction: text.includes('مرحبا') ? 'rtl' : 'ltr', align: 'left',
        availableWidth: 80, lineHeight: 16,
        source: { scope: 'test', nodeId: 'paragraph', start: 0, end: text.length },
        revision: { documentRevision: 0, fontRevision: kernel.fonts.getRevision() },
        positions: Array.from({ length: text.length }, (_, i) =>
          ({ start: i, textStart: 0, textEnd: 1 })),
        emptyStyle: { fontFamily: 'Test', fontSize: 16 }
      }
      const work = createLayoutWork()
      const profiled = kernel.service.layoutParagraph(input, work)
      expect(profiled).toEqual(kernel.service.layoutParagraph(input))
      expect(work.scanUnits).toBe(text.length)
      expect(work.shapeCalls).toBeGreaterThan(0)
      expect(work.shapeUnits).toBeGreaterThanOrEqual(text.length)
      expect(work.measuredGlyphs).toBe(profiled.shaped.lines.reduce(
        (sum, line) => sum + line.glyphs.length, 0))
      expect(work.breakGlyphCopies).toBeGreaterThan(0)
      expect(work.geometryItems).toBeGreaterThan(profiled.lines.length)
      for (const [key, value] of Object.entries(work)) {
        expect(Number.isFinite(value), key).toBe(true)
        expect(value, key).toBeGreaterThanOrEqual(0)
      }
    })
})

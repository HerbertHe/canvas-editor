import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LayoutKernel } from '@/editor/core/text-engine/layout/LayoutKernel'

describe('complete shaping run reuse', () => {
  it('reuses unchanged mixed-script runs with current logical indices', async () => {
    const fonts = [{ family: 'Test', data: new Uint8Array(readFileSync(
      'public/fonts/NotoNaskhArabic-Regular.ttf')).buffer }]
    const cached = new LayoutKernel(undefined, () => true)
    const full = new LayoutKernel()
    await cached.initialize(fonts, 'Test')
    await full.initialize(fonts, 'Test')
    const paragraph = (text: string, base: number) => ({
      spans: [{ text, logicalIndex: base,
        logicalIndices: Array.from({ length: text.length }, (_, i) => base + i),
        style: { fontFamily: 'Test', fontSize: 16 } }],
      availableWidth: 260, direction: 'ltr' as const, align: 'left' as const,
      lineHeight: 16, emptyStyle: { fontFamily: 'Test', fontSize: 16 },
      source: { scope: 'main', nodeId: 'p', start: base, end: base + text.length },
      positions: Array.from({ length: text.length }, (_, i) => ({
        start: base + i, textStart: 0, textEnd: 1 })),
      revision: { documentRevision: base, fontRevision: 1 }
    })
    try {
      for (const [index, text] of ['abc مرحبا office', 'abcd مرحبا office',
        'abcd مرحبا office é', 'abcd مرحبا office 👩‍👩‍👧‍👦'].entries()) {
        const input = paragraph(text, index * 10)
        expect(cached.layout({ schemaVersion: 1, input }))
          .toEqual(full.layout({ schemaVersion: 1, input }))
      }
      expect(cached.runs.stats.reusedUnits).toBeGreaterThan(0)
      expect(cached.runs.stats.hits).toBeGreaterThan(0)
    } finally { cached.destroy(); full.destroy() }
  })
})

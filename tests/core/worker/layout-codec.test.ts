import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LayoutKernel } from '@/editor/core/text-engine/layout/LayoutKernel'
import { decodeLayout, encodeLayout, layoutTransferBuffers } from '@/editor/core/worker/layout/layoutCodec'
import { TransferBufferPool } from '@/editor/core/worker/layout/TransferBufferPool'

describe('transferable layout vectors', () => {
  it('preserves exact numeric indices, affinities, marks and missing glyph DTOs', async () => {
    const kernel = new LayoutKernel()
    await kernel.initialize([{ family: 'Test', data: new Uint8Array(readFileSync(
      'public/fonts/NotoNaskhArabic-Regular.ttf')).buffer }], 'Test')
    try {
      const text = 'office مرحبا é 漢 👩‍👩‍👧‍👦'
      const base = 2 ** 40
      const layout = kernel.layout({ schemaVersion: 1, input: {
        spans: [{ text, logicalIndex: base,
          logicalIndices: Array.from({ length: text.length }, (_, i) => base + i),
          style: { fontFamily: 'Test', fontSize: 16, bold: undefined } }],
        availableWidth: 180, direction: 'ltr', align: 'left', lineHeight: 16,
        emptyStyle: { fontFamily: 'Test', fontSize: 16 },
        source: { scope: 'main', nodeId: 'p', start: base, end: base + text.length },
        revision: { documentRevision: 2, fontRevision: 1 },
        positions: Array.from({ length: text.length }, (_, i) => ({
          start: base + i, textStart: 0, textEnd: 1 }))
      } }).layout
      const pool = new TransferBufferPool(1024 * 1024)
      const { packed, buffers } = encodeLayout(layout, pool)
      const wire = structuredClone(packed, { transfer: buffers })
      expect(buffers.every(buffer => buffer.byteLength === 0)).toBe(true)
      expect(decodeLayout(wire)).toEqual(layout)
      const received = layoutTransferBuffers([wire])
      const returned = structuredClone(received, { transfer: received })
      returned.forEach(buffer => pool.release(buffer))
      expect(pool.stats.retainedBytes).toBeGreaterThan(0)
      const next = encodeLayout(layout, pool)
      expect(pool.stats.reuses).toBeGreaterThan(0)
      expect(decodeLayout(next.packed)).toEqual(layout)
      expect(pool.stats.retainedBytes).toBeLessThanOrEqual(1024 * 1024)
      pool.clear()
      expect(pool.stats.retainedBytes).toBe(0)
    } finally { kernel.destroy() }
  })

  it('handles empty results, malformed versions and bounded recycling', () => {
    const pool = new TransferBufferPool(128, 1)
    const first = pool.acquire(64)
    pool.release(first)
    pool.release(first)
    pool.release(new ArrayBuffer(256))
    expect(pool.stats.retainedBytes).toBe(64)
    expect(pool.acquire(64)).toBe(first)
    expect(pool.stats.retainedBytes).toBe(0)
    expect(() => decodeLayout({ schemaVersion: 2, data: {}, references: [] } as any))
      .toThrow('encoding')
    const empty = { lines: [], shaped: { lines: [], paragraphText: '', glyphs: [] } } as any
    expect(decodeLayout(encodeLayout(empty).packed)).toEqual(empty)
  })
})

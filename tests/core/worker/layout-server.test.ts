import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LayoutKernel } from '@/editor/core/text-engine/layout/LayoutKernel'
import { LayoutWorkerServer } from '@/editor/core/worker/layout/LayoutWorkerServer'
import type { NativeParagraphInput } from '@/editor/core/text-engine/layout/TextLayoutService'

const fonts = [{ family: 'Test', data: new Uint8Array(
  readFileSync('public/fonts/NotoNaskhArabic-Regular.ttf')).buffer }]
const input = (text: string): NativeParagraphInput => ({
  spans: [{ text, logicalIndex: 0, logicalIndices: [...text].map((_, i) => i),
    style: { fontFamily: 'Test', fontSize: 16 } }],
  availableWidth: 150, direction: 'rtl', align: 'right', lineHeight: 16,
  emptyStyle: { fontFamily: 'Test', fontSize: 16 },
  source: { scope: 'main', nodeId: 'p', start: 0, end: text.length },
  positions: Array.from({ length: text.length }, (_, i) => ({
    start: i, textStart: 0, textEnd: 1 })),
  revision: { documentRevision: 0, fontRevision: 1 }
})
const version = { sessionId: 1, requestId: 1, documentRevision: 0,
  fontRevision: 1, constraintsRevision: 0 }

describe('pure layout kernel and ordered worker mirror', () => {
  it('applies a deletion batch sequentially and validates its final revision', async () => {
    const server = new LayoutWorkerServer()
    try {
      await server.handle({ ...version, type: 'init', fonts, defaultFont: 'Test',
        model: { main: [...'abcd'].map(value => ({ value })), header: [], footer: [] } })
      const transactions = ['d', 'c', 'b'].map((value, i) => ({
        baseRevision: i, targetRevision: i + 1, kind: 'backspace',
        before: null, after: null, dirtyScopes: ['main'], source: 'edit' as const,
        operations: [{ kind: 'splice' as const, scope: 'main', index: 3 - i,
          before: [{ value }], after: [] }]
      }))
      expect((await server.handle({ ...version, type: 'edits', transactions,
        documentRevision: 3 })).type).toBe('ack')
      const mirror = await server.handle({ ...version, type: 'inspect',
        documentRevision: 3 })
      expect(mirror.model!.main).toEqual([{ value: 'a' }])
      expect((await server.handle({ ...version, type: 'edits', transactions,
        documentRevision: 3 })).needsResync).toBe(true)
    } finally { server.destroy() }
  })

  it('initializes without a document and produces cloneable identical DTOs', async () => {
    const kernel = new LayoutKernel()
    const server = new LayoutWorkerServer()
    const text = 'office مرحبا é'
    const model = { main: [...text].map(value => ({ value })), header: [], footer: [] }
    vi.stubGlobal('document', undefined)
    try {
      await kernel.initialize(fonts, 'Test')
      expect((await server.handle({ ...version, type: 'init', fonts,
        model, defaultFont: 'Test' })).type).toBe('ack')
      const request = structuredClone({ schemaVersion: 1 as const, input: input(text) })
      const expected = kernel.layout(request)
      expect(structuredClone(expected)).toEqual(expected)
      const response = await server.handle({ ...version, requestId: 2,
        type: 'layout', inputs: [request.input] })
      expect(response.type).toBe('layout')
      expect(response.layouts![0]).toEqual(expected.layout)
      kernel.destroy()
      expect(() => kernel.layout(request)).toThrow('destroyed')
    } finally {
      kernel.destroy()
      server.destroy()
      vi.unstubAllGlobals()
    }
  })

  it('applies every edit once and demands resync for gaps, duplicates and old sessions', async () => {
    const server = new LayoutWorkerServer()
    await server.handle({ ...version, type: 'init', fonts, defaultFont: 'Test',
      model: { main: [{ value: 'a' }], header: [], footer: [] } })
    const transaction = { baseRevision: 0, targetRevision: 1, kind: 'input',
      before: null, after: null, dirtyScopes: ['main'], source: 'edit' as const,
      operations: [{ kind: 'splice' as const, scope: 'main', index: 1,
        before: [], after: [{ value: 'b' }] }] }
    const request = { ...version, documentRevision: 1,
      type: 'edit' as const, transaction }
    expect((await server.handle(request)).type).toBe('ack')
    expect((await server.handle(request)).needsResync).toBe(true)
    const result = await server.handle({ ...version, documentRevision: 1,
      type: 'inspect' })
    expect(result.model!.main).toEqual([{ value: 'a' }, { value: 'b' }])
    expect((await server.handle({ ...version, sessionId: 0,
      type: 'inspect' })).needsResync).toBe(true)
    expect((await server.handle({ ...version, documentRevision: 1,
      fontRevision: 9, type: 'layout', inputs: [] })).needsResync).toBe(true)
    expect((await server.handle({ ...version, type: 'layout', inputs: [] }))
      .needsResync).toBe(true)
    server.destroy()
  })
})

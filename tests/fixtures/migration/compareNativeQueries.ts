import { LegacyNativeQuery } from './LegacyNativeQuery'
import { NativeQueryIndex } from '../../../src/editor/core/layout/NativeQueryIndex'
import { LineGeometryCache } from '../../../src/editor/core/layout/LineGeometryIndex'
import type { PlacedTextLine } from '../../../src/editor/core/layout/InteractionGeometry'

export function compareNativeQueries(lines: PlacedTextLine[], incremental = false) {
  const legacy = new LegacyNativeQuery(lines)
  const cache = new LineGeometryCache()
  const query = NativeQueryIndex.create(lines, cache, incremental)
  let checks = 0
  const same = (a: unknown, b: unknown) => {
    checks++
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error(`Native query mismatch at check ${checks}: ` +
        JSON.stringify({ a, b }))
  }
  const indices = new Set<number>([-1, 0])
  for (const placed of lines)
    for (let i = placed.line.source.start - 1; i <= placed.line.source.end; i++)
      indices.add(i)
  for (const index of indices) {
    for (const bias of ['before', 'after'] as const)
      same(query.normalize(index, bias), legacy.normalizeNativeIndex(index, bias))
    for (const page of [undefined, 0, 1, 99])
      for (const x of [-Infinity, 0, 25, Infinity])
        same(query.atX(index, x, page), legacy.getNativeCaretAtX([], index, x, page))
    const hints = [null, ...lines.filter(p => !p.line.hidden)
      .flatMap(p => cache.get(p).getCarets(index))]
    for (const hint of hints) {
      legacy.nativeCaretHint = hint
      const current = query.caret(index, hint)
      same(current, legacy.getNativeCaret(index))
      for (const start of [undefined, ...lines.map(p => p.line.source.start)])
        same(query.caret(index, hint, start), legacy.getNativeCaret(index, start))
      for (const visual of [false, true]) {
        for (const backward of [false, true])
          same(current ? query.deleteRange(current, backward, visual) : null,
            legacy.getNativeDeleteRange(index, backward, visual))
        for (const delta of [-1, 1] as const)
          for (const vertical of [false, true])
            same(current ? query.move(current, delta, visual, vertical) : null,
              legacy.moveNativeCaret(index, delta, visual, vertical))
      }
    }
  }
  return checks
}

import { freezeLayout, projectLayout } from '../layout/relativeLayout'
import type {
  LayoutCaret,
  LayoutSource,
  TextLine
} from '../../interface/Layout'
import type {
  NativeParagraphInput,
  NativeParagraphLayout
} from '../text-engine/layout/TextLayoutService'

/** Rebase every source-bearing native field; text/glyph offsets stay local. */
function rebase(layout: NativeParagraphLayout, delta: number) {
  const source = (value: LayoutSource) => ({
    ...value,
    start: value.start + delta,
    end: value.end + delta
  })
  const caret = (value: LayoutCaret) => ({
    ...value,
    position: {
      ...value.position,
      elementIndex: value.position.elementIndex + delta
    }
  })
  const line = (value: TextLine): TextLine => ({
    ...value,
    source: source(value.source),
    marker: value.marker && line(value.marker),
    labels: value.labels?.map(label => ({
      ...label,
      source: source(label.source)
    })),
    carets: value.carets.map(caret),
    clusters: value.clusters.map(cluster => ({
      ...cluster,
      logicalIndices: cluster.logicalIndices.map(index => index + delta),
      carets: cluster.carets.map(caret)
    })),
    inlines: value.inlines.map(inline => ({
      ...inline,
      source: source(inline.source),
      ...(inline.kind === 'missingGlyph'
        ? { carets: inline.carets.map(caret) }
        : { anchor: caret(inline.anchor) })
    }))
  })
  return {
    lines: layout.lines.map(line),
    shaped: {
      ...layout.shaped,
      lines: layout.shaped.lines.map(value => ({
        ...value,
        logicalStart: value.logicalStart + delta,
        logicalEnd: value.logicalEnd + delta,
        glyphs: value.glyphs.map(glyph => ({
          ...glyph,
          logicalIndexStart: glyph.logicalIndexStart + delta,
          logicalIndexEnd: glyph.logicalIndexEnd + delta,
          logicalIndices: glyph.logicalIndices?.map(index => index + delta)
        }))
      }))
    }
  }
}

/**
 * Bounded native paragraph cache. Owns no host elements, IRows, page placements
 * or legacy snapshots. Inputs include fonts, source identity and flow widths.
 */
export class IncrementalParagraphComputer {
  private cache = new Map<string, NativeParagraphLayout>()
  private immutable = new Map<string, {
    scope: string; layout: NativeParagraphLayout; bytes: number
  }>()
  private order = new Map<string, { native: boolean; key: string; bytes: number }>()
  readonly stats = { hits: 0, misses: 0, bytes: 0, evictions: 0, bypasses: 0 }

  constructor(private byteBudget = 32 * 1024 * 1024) {}

  setByteBudget(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0)
      throw new TypeError('Paragraph cache byte budget must be positive')
    this.byteBudget = bytes
    while (this.stats.bytes > bytes) this.drop(this.order.keys().next().value!)
  }

  private remember(native: boolean, key: string, bytes: number) {
    const id = (native ? 'native:' : 'legacy:') + key
    this.order.delete(id)
    this.order.set(id, { native, key, bytes })
    this.stats.bytes += bytes
    while (this.stats.bytes > this.byteBudget || this.order.size > 2048)
      this.drop(this.order.keys().next().value!)
  }

  private touch(native: boolean, key: string) {
    const id = (native ? 'native:' : 'legacy:') + key
    const cost = this.order.get(id)
    if (cost) { this.order.delete(id); this.order.set(id, cost) }
  }

  private drop(id: string) {
    const cost = this.order.get(id)
    if (!cost) return
    this.order.delete(id)
    if (cost.native) this.immutable.delete(cost.key)
    else this.cache.delete(cost.key)
    this.stats.bytes -= cost.bytes
    this.stats.evictions++
  }

  private estimate(layout: NativeParagraphLayout) {
    return layout.lines.reduce((n, line) => n + 512 +
      line.glyphs.length * 128 + line.clusters.length * 256 +
      line.carets.length * 128 + line.inlines.length * 256, 0) +
      layout.shaped.lines.reduce((n, line) => n + 256 + line.glyphs.length * 384, 0)
  }

  private trusted(
    input: NativeParagraphInput,
    compute: (input: NativeParagraphInput) => NativeParagraphLayout,
    identity: string
  ) {
    if (input.spans.reduce((n, span) => n + span.text.length, 0) > 32768) {
      this.stats.bypasses++
      return compute(input)
    }
    const { spans: _spans, positions: _positions, source: _source,
      revision: _revision, ...constraints } = input
    void _spans; void _positions; void _source; void _revision
    const key = JSON.stringify([identity, input.source.scope,
      input.source.nodeId, input.revision.fontRevision, constraints], (_, value) =>
      typeof value === 'number' && !Number.isFinite(value) ? String(value) : value)
    let entry = this.immutable.get(key)
    if (!entry) {
      this.stats.misses++
      const start = input.source.start
      const relative = { ...input,
        source: { ...input.source, start: 0, end: input.source.end - start },
        spans: input.spans.map(span => ({ ...span,
          logicalIndex: span.logicalIndex - start,
          logicalIndices: span.logicalIndices?.map(index => index - start) })),
        positions: input.positions.map(position => ({ ...position,
          start: position.start - start }))
      }
      const layout = freezeLayout(compute(relative))
      const bytes = this.estimate(layout) + key.length * 2
      entry = { scope: input.source.scope, layout, bytes }
      if (bytes > this.byteBudget) {
        this.stats.bypasses++
        return projectLayout(layout, start, input.revision)
      }
      this.immutable.set(key, entry)
      this.remember(true, key, bytes)
    } else {
      this.stats.hits++
      this.immutable.delete(key)
      this.immutable.set(key, entry)
      this.touch(true, key)
    }
    return projectLayout(entry.layout, input.source.start, input.revision)
  }

  reset() {
    this.cache.clear()
    this.immutable.clear()
    this.order.clear()
    this.stats.bytes = 0
  }

  releaseScope(scope: string) {
    for (const [key, value] of this.immutable)
      if (value.scope === scope || value.scope.startsWith(`${scope}/`)) {
        this.drop('native:' + key)
      }
    for (const key of this.cache.keys()) {
      const cachedScope = JSON.parse(key).source.scope as string
      if (cachedScope === scope || cachedScope.startsWith(`${scope}/`))
        this.drop('legacy:' + key)
    }
  }

  compute(
    input: NativeParagraphInput,
    compute: (input: NativeParagraphInput) => NativeParagraphLayout,
    identity?: string
  ): NativeParagraphLayout {
    if (identity) return this.trusted(input, compute, identity)
    if (input.spans.reduce((n, span) => n + span.text.length, 0) > 32768) {
      this.stats.bypasses++
      return compute(input)
    }
    const start = input.source.start
    const relative = {
      ...input,
      source: { ...input.source, start: 0, end: input.source.end - start },
      spans: input.spans.map(span => ({
        ...span,
        logicalIndex: span.logicalIndex - start,
        logicalIndices: span.logicalIndices?.map(index => index - start)
      })),
      positions: input.positions.map(position => ({
        nodeId: position.nodeId,
        start: position.start - start,
        textStart: position.textStart,
        textEnd: position.textEnd
      }))
    }
    // JSON normally conflates Infinity (unbounded flow) with null.
    const key = JSON.stringify(relative, (_, value) =>
      typeof value === 'number' && !Number.isFinite(value)
        ? String(value)
        : value
    )
    let result = this.cache.get(key)
    if (!result) {
      result = structuredClone(rebase(compute(input), -start))
      this.stats.misses++
      const bytes = this.estimate(result) + key.length * 2
      if (bytes <= this.byteBudget) {
        this.cache.set(key, result)
        this.remember(false, key, bytes)
      } else this.stats.bypasses++
    } else {
      this.cache.delete(key)
      this.cache.set(key, result)
      this.touch(false, key)
      this.stats.hits++
    }
    // Projection/flow consumers can mutate their own result, never the cache.
    return rebase(structuredClone(result), start)
  }
}

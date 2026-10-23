import type { LayoutCaret, LayoutSource, TextLine } from '../../interface/Layout'
import type { NativeParagraphLayout } from '../text-engine/layout/TextLayoutService'

/** Lazy, memoized projection. No glyph/caret traversal when creating a view. */
export function mapView<T, U>(source: readonly T[], map: (value: T) => U): U[] {
  const values = new Map<number, U>()
  const numeric = (key: PropertyKey) => typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
  const read = (index: number) => {
    if (index >= source.length) return undefined
    if (!values.has(index)) values.set(index, map(source[index]))
    return values.get(index)
  }
  return new Proxy(new Array<U>(source.length), {
    has: (target, key) => numeric(key) ? Number(key) < source.length : key in target,
    ownKeys: () => [...Array.from({ length: source.length }, (_, i) => String(i)), 'length'],
    getOwnPropertyDescriptor(target, key) {
      if (!numeric(key)) return Reflect.getOwnPropertyDescriptor(target, key)
      if (Number(key) >= source.length) return undefined
      return { configurable: true, enumerable: true, writable: false,
        value: read(Number(key)) }
    },
    set() { throw new TypeError('Immutable layout array view') },
    get(target, key, receiver) {
      if (!numeric(key)) return Reflect.get(target, key, receiver)
      return read(Number(key))
    }
  })
}

export function freezeLayout<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeLayout(child)
  return Object.freeze(value)
}

// Re-project canonical geometry, never the last view. Otherwise every edit
// retains and traverses another layer of old proxies in the shifted suffix.
const lineOrigins = new WeakMap<TextLine, { base: TextLine; delta: number }>()

/** Canonical identity survives source-index shifts without retaining old views. */
export function getTextLineOrigin(line: TextLine) {
  return lineOrigins.get(line) || { base: line, delta: 0 }
}
type Shaped = NativeParagraphLayout['shaped']
const shapedOrigins = new WeakMap<Shaped, { base: Shaped; delta: number }>()

function projectLine(value: TextLine, shift: number,
  revision: TextLine['revision']): TextLine {
  const origin = lineOrigins.get(value)
  const base = origin?.base || value
  const delta = shift + (origin?.delta || 0)
  const source = (item: LayoutSource) => ({ ...item,
    start: item.start + delta, end: item.end + delta })
  const caret = (item: LayoutCaret) => ({ ...item,
    position: { ...item.position, elementIndex: item.position.elementIndex + delta } })
  const result: TextLine = { ...base,
    source: source(base.source), revision: { ...revision },
    marker: base.marker && projectLine(base.marker, delta, revision),
    labels: base.labels && mapView(base.labels, label => ({ ...label,
      source: source(label.source) })),
    glyphs: base.glyphs,
    carets: mapView(base.carets, caret),
    clusters: mapView(base.clusters, cluster => ({ ...cluster,
      logicalIndices: mapView(cluster.logicalIndices, index => index + delta),
      carets: mapView(cluster.carets, caret) })),
    inlines: mapView(base.inlines, inline => ({ ...inline,
      revision: { ...revision }, source: source(inline.source),
      ...(inline.kind === 'missingGlyph'
        ? { carets: mapView(inline.carets, caret) }
        : { anchor: caret(inline.anchor) })
    }))
  }
  lineOrigins.set(result, { base, delta })
  return result
}

function projectShaped(value: Shaped, shift: number): Shaped {
  const origin = shapedOrigins.get(value)
  const base = origin?.base || value
  const delta = shift + (origin?.delta || 0)
  const result: Shaped = { ...base,
    lines: mapView(base.lines, line => ({ ...line,
      logicalStart: line.logicalStart + delta,
      logicalEnd: line.logicalEnd + delta,
      glyphs: mapView(line.glyphs, glyph => ({ ...glyph,
        logicalIndexStart: glyph.logicalIndexStart + delta,
        logicalIndexEnd: glyph.logicalIndexEnd + delta,
        logicalIndices: glyph.logicalIndices &&
          mapView(glyph.logicalIndices, index => index + delta)
      }))
    }))
  }
  shapedOrigins.set(result, { base, delta })
  return result
}

export function projectLayout(layout: NativeParagraphLayout, delta: number,
  revision: TextLine['revision']): NativeParagraphLayout {
  // Materialize only the line references so this array does not retain a
  // previous layout view. Glyph/caret/cluster data remains lazy and shared.
  return { lines: layout.lines.map(value => projectLine(value, delta, revision)),
    shaped: projectShaped(layout.shaped, delta) }
}

export function projectTextLine(value: TextLine, delta: number): TextLine {
  return projectLine(value, delta, value.revision)
}

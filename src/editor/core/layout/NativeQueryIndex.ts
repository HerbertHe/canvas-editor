import {
  type NativeCaret,
  type PlacedTextLine,
  type lineSegments
} from './InteractionGeometry'
import { LineGeometryCache } from './LineGeometryIndex'
import { getTextLineOrigin } from './relativeLayout'

type Segment = ReturnType<typeof lineSegments>[number]

/** Stable first-match lookup at an ordered boundary, without query sorting. */
class Boundaries<T> {
  private values = new Map<number, T>()
  private keys: number[] = []

  add(key: number, value: T) {
    if (!this.values.has(key)) this.values.set(key, value)
  }

  seal() {
    this.keys = [...this.values.keys()].sort((a, b) => a - b)
  }

  neighbour(key: number, before: boolean, inclusive = false): T | undefined {
    let low = 0
    let high = this.keys.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.keys[mid] < key ||
        (this.keys[mid] === key && (before ? inclusive : !inclusive)))
        low = mid + 1
      else high = mid
    }
    return this.values.get(this.keys[before ? low - 1 : low])
  }
}

function append<K, T>(map: Map<K, T[]>, key: K, value: T) {
  const items = map.get(key)
  if (items) items.push(value)
  else map.set(key, [value])
}

function lineKey(lineId: string, pageNo: number) {
  return JSON.stringify([lineId, pageNo])
}

/** Owned by one position-array generation, including its table fragments. */
export class NativeQueryIndex {
  private carets = new Map<number, NativeCaret[]>()
  private starts = new Map<number, PlacedTextLine>()
  private sourceLines = new Map<number, PlacedTextLine[]>()
  private interiors = new Map<number, Segment>()
  private logical = new Boundaries<NativeCaret>()
  private ends = new Boundaries<Segment>()
  private beginnings = new Boundaries<Segment>()
  private visual = new Map<string, {
    ends: Boundaries<Segment>
    starts: Boundaries<Segment>
  }>()
  private visible: PlacedTextLine[] = []
  private ordinals = new Map<string, number>()

  static create(lines: PlacedTextLine[], cache: LineGeometryCache,
    incremental = false) {
    if (incremental && lines.length &&
      new Set(lines.map(p => lineKey(p.line.id, p.pageNo))).size === lines.length &&
      lines.every((placed, i) =>
      placed.line.source.scope === 'main' && !placed.line.hidden &&
      !placed.clip && placed.line.source.end > placed.line.source.start &&
      (!i || lines[i - 1].line.source.end <= placed.line.source.start)))
      return new IncrementalNativeQueryIndex(lines, cache)
    return new NativeQueryIndex(lines, cache)
  }

  constructor(lines: PlacedTextLine[], private cache: LineGeometryCache) {
    for (const placed of lines) {
      const { line } = placed
      const geometry = cache.get(placed)
      const key = lineKey(line.id, placed.pageNo)
      let visual = this.visual.get(key)
      if (!visual) {
        visual = { ends: new Boundaries(), starts: new Boundaries() }
        this.visual.set(key, visual)
      }
      for (const segment of geometry.segments) {
        this.ends.add(segment.end - 1, segment)
        this.beginnings.add(segment.start, segment)
        visual.ends.add(segment.rect.x + segment.rect.width, segment)
        visual.starts.add(segment.rect.x, segment)
        if (!line.hidden)
          for (let i = segment.start; i < segment.end - 1; i++)
            if (!this.interiors.has(i)) this.interiors.set(i, segment)
      }
      if (line.hidden) continue
      const ordinalKey = JSON.stringify([
        line.id, line.source.scope, placed.pageNo
      ])
      if (!this.ordinals.has(ordinalKey))
        this.ordinals.set(ordinalKey, this.visible.length)
      this.visible.push(placed)
      if (!this.starts.has(line.source.start))
        this.starts.set(line.source.start, placed)
      for (let i = line.source.start; i < line.source.end; i++)
        append(this.sourceLines, i, placed)
      for (const caret of geometry.carets) {
        append(this.carets, caret.index, caret)
        this.logical.add(caret.index, caret)
      }
    }
    this.logical.seal()
    this.ends.seal()
    this.beginnings.seal()
    for (const group of this.visual.values()) {
      group.ends.seal()
      group.starts.seal()
    }
  }

  private hit(placed: PlacedTextLine, x: number): NativeCaret | null {
    const carets = this.cache.get(placed).carets
    if (!carets.length) return null
    if (x === Infinity) return carets.at(-1)!
    if (x === -Infinity) return carets[0]
    return carets.reduce((a, b) =>
      Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a
    )
  }

  firstCaret(index: number) { return this.carets.get(index)?.[0] || null }

  caret(index: number, hint: NativeCaret | null, start?: number) {
    const line = start === undefined ? undefined : this.starts.get(start)
    if (line)
      return this.hit(line, line.line.direction === 'rtl' ? Infinity : -Infinity)
    const candidates = this.carets.get(index) || []
    if (hint?.index === index) {
      const found = candidates.find(c => c.lineId === hint.lineId &&
        c.scope === hint.scope && c.pageNo === hint.pageNo &&
        Math.abs(c.x - hint.x) < 0.01)
      if (found) return found
    }
    return candidates.find(c => c.affinity === 'upstream') || candidates[0] || null
  }

  normalize(index: number, bias: 'before' | 'after') {
    const segment = this.interiors.get(index)
    return segment ? bias === 'before'
      ? Math.max(0, segment.start - 1) : segment.end - 1 : index
  }

  atX(index: number, x: number, pageNo?: number) {
    const line = this.sourceLines.get(index)?.find(
      p => pageNo === undefined || p.pageNo === pageNo
    )
    return line ? this.hit(line, x) : null
  }

  move(current: NativeCaret, delta: 1 | -1, visual: boolean, vertical: boolean) {
    const at = this.ordinals.get(JSON.stringify([
      current.lineId, current.scope, current.pageNo
    ]))!
    if (vertical) {
      const next = this.visible[at + delta]
      return next ? this.hit(next, current.x) : null
    }
    if (!visual) return this.logical.neighbour(current.index, delta < 0) || null
    const placed = this.visible[at]
    const slots = this.cache.get(placed).carets
    const slot = slots.findIndex(c => c.index === current.index &&
      Math.abs(c.x - current.x) < 0.01)
    if (slots[slot + delta]) return slots[slot + delta]
    const next = this.visible[
      at + (placed.line.direction === 'rtl' ? -delta : delta)
    ]
    if (!next) return null
    const nextSlots = this.cache.get(next).carets
    return (delta > 0 ? nextSlots[0] : nextSlots.at(-1)) || null
  }

  deleteRange(current: NativeCaret, backward: boolean, visual: boolean) {
    const group = this.visual.get(lineKey(current.lineId, current.pageNo))
    const target = visual
      ? backward ? group?.ends.neighbour(current.x + 0.01, true, true)
        : group?.starts.neighbour(current.x - 0.01, false, true)
      : backward ? this.ends.neighbour(current.index, true, true)
        : this.beginnings.neighbour(current.index, false)
    if (!target) return null
    const adjacent = backward ? current.index : current.index + 1
    if (!visual && (adjacent < target.start || adjacent >= target.end)) return null
    return { index: target.start, count: target.end - target.start,
      cursorIndex: target.start - 1 }
  }
}

interface QueryChunk {
  placed: PlacedTextLine
  query: NativeQueryIndex
  delta: number
}

// Weak canonical ownership: a source shift reuses the character maps, not a
// chain of old document generations. Only the small line directory is rebuilt.
const chunks = new WeakMap<LineGeometryCache,
  WeakMap<PlacedTextLine['line'], {
    key: string; query: NativeQueryIndex; delta: number
  }>>()

class IncrementalNativeQueryIndex extends NativeQueryIndex {
  private chunks: QueryChunk[]
  private byLine = new Map<string, number>()

  constructor(lines: PlacedTextLine[], cache: LineGeometryCache) {
    super([], cache)
    let owned = chunks.get(cache)
    if (!owned) chunks.set(cache, owned = new WeakMap())
    this.chunks = lines.map((placed, index) => {
      const { base, delta } = getTextLineOrigin(placed.line)
      const key = JSON.stringify([placed.x, placed.y, placed.scale,
        placed.pageNo, placed.columnIndex, base.revision])
      let chunk = owned.get(base)
      if (!chunk || chunk.key !== key) {
        // The position pass already built this placement's geometry. Retain
        // that basis and shift query results relative to it on later commits.
        chunk = { key, delta, query: new NativeQueryIndex([placed], cache) }
        owned.set(base, chunk)
      }
      this.byLine.set(lineKey(placed.line.id, placed.pageNo), index)
      return { placed, query: chunk.query, delta: delta - chunk.delta }
    })
  }

  private lower(index: number) {
    let low = 0, high = this.chunks.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.chunks[mid].placed.line.source.end <= index) low = mid + 1
      else high = mid
    }
    return low
  }

  private candidates(index: number) {
    const result: QueryChunk[] = []
    for (let i = this.lower(index); i < this.chunks.length; i++) {
      const chunk = this.chunks[i]
      if (chunk.placed.line.source.start > index + 1) break
      result.push(chunk)
    }
    return result
  }

  private project(caret: NativeCaret | null, delta: number): NativeCaret | null {
    return !caret || !delta ? caret : { ...caret, index: caret.index + delta,
      position: { ...caret.position,
        elementIndex: caret.position.elementIndex + delta } }
  }

  private logicalResult(caret: NativeCaret): NativeCaret {
    for (const chunk of this.candidates(caret.index)) {
      const first = chunk.query.firstCaret(caret.index - chunk.delta)
      if (first) return this.project(first, chunk.delta)!
    }
    return caret
  }

  override caret(index: number, hint: NativeCaret | null, start?: number) {
    if (start !== undefined) {
      const chunk = this.chunks[this.lower(start)]
      if (chunk?.placed.line.source.start === start)
        return this.project(chunk.query.caret(index - chunk.delta, null,
          start - chunk.delta), chunk.delta)
    }
    const candidates = this.candidates(index).flatMap(chunk => {
      // Query each affinity so a boundary hint is preserved across two lines.
      const current = chunk.query.caret(index - chunk.delta,
        this.project(hint, -chunk.delta))
      return current ? [this.project(current, chunk.delta)!] : []
    })
    if (hint?.index === index) {
      const found = candidates.find(c => c.lineId === hint.lineId &&
        c.scope === hint.scope && c.pageNo === hint.pageNo &&
        Math.abs(c.x - hint.x) < 0.01)
      if (found) return found
    }
    return candidates.find(c => c.affinity === 'upstream') || candidates[0] || null
  }

  override normalize(index: number, bias: 'before' | 'after') {
    const chunk = this.chunks[this.lower(index)]
    return chunk && chunk.placed.line.source.start <= index
      ? chunk.query.normalize(index - chunk.delta, bias) + chunk.delta : index
  }

  override atX(index: number, x: number, pageNo?: number) {
    const chunk = this.chunks[this.lower(index)]
    return chunk && chunk.placed.line.source.start <= index
      ? this.project(chunk.query.atX(index - chunk.delta, x, pageNo), chunk.delta)
      : null
  }

  override move(current: NativeCaret, delta: 1 | -1,
    visual: boolean, vertical: boolean): NativeCaret | null {
    const at = this.byLine.get(lineKey(current.lineId, current.pageNo))
    if (at === undefined) return null
    const chunk = this.chunks[at]
    if (!vertical) {
      const local = chunk.query.move(this.project(current, -chunk.delta)!,
        delta, visual, false)
      if (local) {
        const result = this.project(local, chunk.delta)!
        return visual ? result : this.logicalResult(result)
      }
    }
    const step = vertical || !visual || chunk.placed.line.direction !== 'rtl'
      ? delta : -delta
    for (let i = at + step; i >= 0 && i < this.chunks.length; i += step) {
      const next = this.chunks[i]
      const start = next.placed.line.source.start - next.delta
      if (vertical) return this.project(next.query.atX(start, current.x), next.delta)
      if (visual) return this.project(next.query.atX(start,
        delta > 0 ? -Infinity : Infinity), next.delta)
      const result = next.query.move(this.project(current, -next.delta)!,
        delta, false, false)
      if (result) return this.logicalResult(this.project(result, next.delta)!)
    }
    return null
  }

  override deleteRange(current: NativeCaret, backward: boolean, visual: boolean) {
    const at = this.byLine.get(lineKey(current.lineId, current.pageNo))
    const candidates = visual ? at === undefined ? [] : [this.chunks[at]]
      : this.candidates(current.index)
    for (const chunk of candidates) {
      const result = chunk.query.deleteRange(
        this.project(current, -chunk.delta)!, backward, visual)
      if (result) return { ...result, index: result.index + chunk.delta,
        cursorIndex: result.cursorIndex + chunk.delta }
    }
    return null
  }
}

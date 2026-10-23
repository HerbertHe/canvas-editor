import type { LayoutCaret, LayoutRect, TextLine } from '../../interface/Layout'
import {
  hostCaretIndex,
  lineSegments,
  pageRect,
  type NativeCaret,
  type PlacedTextLine
} from './InteractionGeometry'

type Segment = ReturnType<typeof lineSegments>[number]

/** A TextLine is immutable after layout; placements may still move. */
class LocalLineGeometry {
  readonly segments: Segment[]
  readonly carets: { caret: LayoutCaret; index: number }[]
  private readonly documentRevision: number
  private readonly fontRevision: number
  private readonly sourceStart: number
  private readonly scope: string
  private readonly lineId: string
  private readonly hidden: boolean
  private readonly rectY: number
  private readonly contentHeight: number
  private readonly sourceCarets: LayoutCaret[]
  private readonly sourceClusters: TextLine['clusters']
  private readonly sourceInlines: TextLine['inlines']

  constructor(line: TextLine) {
    this.documentRevision = line.revision.documentRevision
    this.fontRevision = line.revision.fontRevision
    this.sourceStart = line.source.start
    this.scope = line.source.scope
    this.lineId = line.id
    this.hidden = line.hidden
    this.rectY = line.rect.y
    this.contentHeight = line.contentHeight
    this.sourceCarets = line.carets
    this.sourceClusters = line.clusters
    this.sourceInlines = line.inlines
    // Do not deduplicate here: clipping can remove the first of two stops
    // with the same index/x/y but different heights. Dedup happens below.
    this.carets = line.carets.map(caret => ({
      caret,
      index: hostCaretIndex(line, caret)
    }))
    this.segments = lineSegments({ line, x: 0, y: 0, pageNo: 0, scale: 1 })
  }

  matches(line: TextLine) {
    return (
      this.documentRevision === line.revision.documentRevision &&
      this.fontRevision === line.revision.fontRevision &&
      this.sourceStart === line.source.start &&
      this.scope === line.source.scope &&
      this.lineId === line.id &&
      this.hidden === line.hidden &&
      this.rectY === line.rect.y &&
      this.contentHeight === line.contentHeight &&
      this.sourceCarets === line.carets &&
      this.sourceClusters === line.clusters &&
      this.sourceInlines === line.inlines
    )
  }
}

function append<T>(map: Map<number, T[]>, index: number, value: T) {
  const items = map.get(index)
  if (items) items.push(value)
  else map.set(index, [value])
}

/** One placement's visual/logical indices. Never shared across position lists. */
export class LineGeometryIndex {
  readonly carets: readonly NativeCaret[]
  readonly segments: readonly Segment[]
  readonly logicalCarets: readonly NativeCaret[]
  readonly logicalSegments: readonly Segment[]
  private readonly caretsByIndex = new Map<number, NativeCaret[]>()
  private readonly segmentsByIndex = new Map<number, Segment[]>()
  private readonly elementRects = new Map<number, LayoutRect[]>()
  private readonly placement: PlacedTextLine

  private constructor(
    placed: PlacedTextLine,
    private readonly local: LocalLineGeometry
  ) {
    this.placement = {
      ...placed,
      clip: placed.clip && { ...placed.clip }
    }
    const seen = new Set<string>()
    this.carets = local.carets
      .map(({ caret, index }): NativeCaret => ({
        ...caret,
        position: { ...caret.position },
        index,
        x: placed.x + caret.x * placed.scale,
        y: placed.y + caret.y * placed.scale,
        height: caret.height * placed.scale,
        pageNo: placed.pageNo,
        lineId: placed.line.id,
        scope: placed.line.source.scope
      }))
      .filter(caret => {
        if (placed.clip) {
          const clip = placed.clip
          const bottom = Math.min(caret.y + caret.height, clip.y + clip.height)
          caret.y = Math.max(caret.y, clip.y)
          caret.height = Math.max(0, bottom - caret.y)
          if (!caret.height || caret.x < clip.x || caret.x > clip.x + clip.width)
            return false
        }
        const key = `${caret.index}:${caret.x}:${caret.y}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => a.x - b.x)
    for (const caret of this.carets)
      append(this.caretsByIndex, caret.index, caret)
    this.logicalCarets = [...this.carets].sort(
      (a, b) => a.index - b.index || a.x - b.x
    )
    this.segments = local.segments.map(segment => ({
      ...segment,
      rect: pageRect(placed, segment.rect)
    }))
    for (const segment of this.segments)
      for (let index = segment.start; index < segment.end; index++)
        append(this.segmentsByIndex, index, segment)
    this.logicalSegments = [...this.segments].sort(
      (a, b) => a.start - b.start || a.end - b.end
    )
  }

  static create(
    placed: PlacedTextLine,
    local = new LocalLineGeometry(placed.line)
  ) {
    return new LineGeometryIndex(placed, local)
  }

  matches(placed: PlacedTextLine, local: LocalLineGeometry) {
    const previous = this.placement
    return (
      this.local === local &&
      previous.line === placed.line &&
      previous.pageNo === placed.pageNo &&
      previous.columnIndex === placed.columnIndex &&
      previous.x === placed.x &&
      previous.y === placed.y &&
      previous.scale === placed.scale &&
      previous.clip?.x === placed.clip?.x &&
      previous.clip?.y === placed.clip?.y &&
      previous.clip?.width === placed.clip?.width &&
      previous.clip?.height === placed.clip?.height
    )
  }

  getCarets(index: number): readonly NativeCaret[] {
    return this.caretsByIndex.get(index) || []
  }

  /** Same clipping, visual ordering and merging as textRangeRects(i, i+1). */
  getElementRects(index: number): readonly LayoutRect[] {
    const segments = this.segmentsByIndex.get(index)
    if (this.placement.line.hidden || !segments) return []
    const cached = this.elementRects.get(index)
    if (cached) return cached
    const rects = segments
      .map(segment => {
        const rect = { ...segment.rect }
        const clip = this.placement.clip
        if (clip) {
          const right = Math.min(rect.x + rect.width, clip.x + clip.width)
          const bottom = Math.min(rect.y + rect.height, clip.y + clip.height)
          rect.x = Math.max(rect.x, clip.x)
          rect.y = Math.max(rect.y, clip.y)
          rect.width = Math.max(0, right - rect.x)
          rect.height = Math.max(0, bottom - rect.y)
        }
        return rect
      })
      .filter(rect => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.x - b.x)
    const merged: LayoutRect[] = []
    for (const rect of rects) {
      const previous = merged.at(-1)
      if (previous && rect.x <= previous.x + previous.width + 0.01)
        previous.width =
          Math.max(previous.x + previous.width, rect.x + rect.width) - previous.x
      else merged.push({ ...rect })
    }
    this.elementRects.set(index, merged)
    return merged
  }
}

/** Weak ownership by the current immutable line and mutable placement. */
export class LineGeometryCache {
  private local = new WeakMap<TextLine, LocalLineGeometry>()
  private placed = new WeakMap<PlacedTextLine, LineGeometryIndex>()

  get(placed: PlacedTextLine) {
    let local = this.local.get(placed.line)
    if (!local?.matches(placed.line)) {
      local = new LocalLineGeometry(placed.line)
      this.local.set(placed.line, local)
    }
    let index = this.placed.get(placed)
    if (!index?.matches(placed, local)) {
      index = LineGeometryIndex.create(placed, local)
      this.placed.set(placed, index)
    }
    return index
  }

  invalidate(placed: PlacedTextLine) {
    this.placed.delete(placed)
  }

  clear() {
    this.local = new WeakMap()
    this.placed = new WeakMap()
  }
}

interface RowPlacements {
  first: PlacedTextLine
  pages: Map<number, PlacedTextLine>
}

/** First-match semantics of getNativeRow, isolated by position-array identity. */
export class NativeRowIndex {
  private lines = new WeakMap<TextLine, RowPlacements>()
  private scopes = new Map<string, Map<string, RowPlacements>>()

  add(placed: PlacedTextLine) {
    let scope = this.scopes.get(placed.line.source.scope)
    if (!scope) {
      scope = new Map()
      this.scopes.set(placed.line.source.scope, scope)
    }
    this.addGroup(this.lines, placed.line, placed)
    this.addGroup(scope, placed.line.id, placed)
  }

  private addGroup<K>(
    map: {
      get(key: K): RowPlacements | undefined
      set(key: K, value: RowPlacements): unknown
    },
    key: K,
    placed: PlacedTextLine
  ) {
    const group = map.get(key)
    if (!group)
      map.set(key, { first: placed, pages: new Map([[placed.pageNo, placed]]) })
    else if (!group.pages.has(placed.pageNo))
      group.pages.set(placed.pageNo, placed)
  }

  find(line: TextLine, pageNo?: number) {
    const exact = this.lines.get(line)
    const direct = pageNo === undefined ? exact?.first : exact?.pages.get(pageNo)
    if (direct) return direct
    const fallback = this.scopes.get(line.source.scope)?.get(line.id)
    return pageNo === undefined || /^(header|footer):/.test(line.source.scope)
      ? fallback?.first
      : fallback?.pages.get(pageNo)
  }
}

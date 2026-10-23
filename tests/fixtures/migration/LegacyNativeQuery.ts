// Frozen pre-PERF-03 query oracle. QA only; never imported by the editor.
import {
  hitTextLine, lineCarets, lineSegments,
  type NativeCaret, type PlacedTextLine
} from '../../../src/editor/core/layout/InteractionGeometry'
import type { IElementPosition } from '../../../src/editor/interface/Element'

export class LegacyNativeQuery {
  nativeCaretHint: NativeCaret | null = null
  constructor(private lines: PlacedTextLine[]) {}
  getNativeLines(positions?: IElementPosition[]) {
    void positions
    return this.lines
  }
  public getNativeCaret(
    index: number,
    hitLineStartIndex?: number
  ): NativeCaret | null {
    const lines = this.getNativeLines().filter(p => !p.line.hidden)
    const hint = this.nativeCaretHint
    const candidates = lines.flatMap(lineCarets).filter(c => c.index === index)
    if (hitLineStartIndex !== undefined) {
      const next = lines.find(p => p.line.source.start === hitLineStartIndex)
      if (next)
        return hitTextLine(
          next,
          next.line.direction === 'rtl' ? Infinity : -Infinity
        )
    }
    if (hint?.index === index) {
      const found = candidates.find(
        c =>
          c.lineId === hint.lineId &&
          c.scope === hint.scope &&
          c.pageNo === hint.pageNo &&
          Math.abs(c.x - hint.x) < 0.01
      )
      if (found) return found
    }
    return (
      candidates.find(c => c.affinity === 'upstream') || candidates[0] || null
    )
  }

  public normalizeNativeIndex(
    index: number,
    bias: 'before' | 'after' = 'after'
  ) {
    for (const placed of this.getNativeLines()) {
      if (placed.line.hidden) continue
      const segment = lineSegments(placed).find(
        s => s.start <= index && index < s.end - 1
      )
      if (segment)
        return bias === 'before'
          ? Math.max(0, segment.start - 1)
          : segment.end - 1
    }
    return index
  }

  public getNativeCaretAtX(
    positions: IElementPosition[],
    index: number,
    x: number,
    pageNo?: number
  ) {
    const placed = this.getNativeLines(positions).find(
      p =>
        !p.line.hidden &&
        index >= p.line.source.start &&
        index < p.line.source.end &&
        (pageNo === undefined || pageNo === p.pageNo)
    )
    return placed ? hitTextLine(placed, x) : null
  }

  public moveNativeCaret(
    index: number,
    delta: 1 | -1,
    visual = true,
    vertical = false
  ): NativeCaret | null {
    const lines = this.getNativeLines().filter(p => !p.line.hidden)
    const current = this.getNativeCaret(index)
    if (!current) return null
    const at = lines.findIndex(
      p =>
        p.line.id === current.lineId &&
        p.line.source.scope === current.scope &&
        p.pageNo === current.pageNo
    )
    if (vertical) {
      const next = lines[at + delta]
      return next ? hitTextLine(next, current.x) : null
    }
    if (!visual) {
      const candidates = lines
        .flatMap(lineCarets)
        .filter(c => (delta > 0 ? c.index > index : c.index < index))
      candidates.sort((a, b) => delta * (a.index - b.index))
      return candidates[0] || null
    }
    const slots = lineCarets(lines[at])
    const slot = slots.findIndex(
      c => c.index === current.index && Math.abs(c.x - current.x) < 0.01
    )
    const neighbour = slots[slot + delta]
    if (neighbour) return neighbour
    const next =
      lines[at + (lines[at].line.direction === 'rtl' ? -delta : delta)]
    if (!next) return null
    const nextSlots = lineCarets(next)
    return (delta > 0 ? nextSlots[0] : nextSlots.at(-1)) || null
  }

  public getNativeDeleteRange(
    index: number,
    backward: boolean,
    visual: boolean
  ) {
    const current = this.getNativeCaret(index)
    if (!current) return null
    const lines = this.getNativeLines()
    const segments = lines.flatMap(placed =>
      lineSegments(placed).map(segment => ({ ...segment, placed }))
    )
    const candidates = segments.filter(segment => {
      if (visual)
        return (
          segment.placed.line.id === current.lineId &&
          segment.placed.pageNo === current.pageNo &&
          (backward
            ? segment.rect.x + segment.rect.width <= current.x + 0.01
            : segment.rect.x >= current.x - 0.01)
        )
      return backward ? segment.end - 1 <= index : segment.start > index
    })
    candidates.sort((a, b) =>
      visual
        ? backward
          ? b.rect.x + b.rect.width - (a.rect.x + a.rect.width)
          : a.rect.x - b.rect.x
        : backward
          ? b.end - a.end
          : a.start - b.start
    )
    const target = candidates[0]
    if (!target) return null
    if (!visual) {
      const adjacent = backward ? index : index + 1
      if (adjacent < target.start || adjacent >= target.end) return null
    }
    return {
      index: target.start,
      count: target.end - target.start,
      cursorIndex: target.start - 1
    }
  }

}

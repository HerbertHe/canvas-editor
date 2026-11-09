import type { Draw } from './Draw'
import type { LayoutRow } from '../../interface/LayoutRow'
import type { IElement } from '../../interface/Element'
import type { TextLine } from '../../interface/Layout'
import type { PlacedTextLine, NativeCaret } from '../layout/InteractionGeometry'
import { lineCarets, textRangeRects } from '../layout/InteractionGeometry'
import { getAnchorElement, getSlimCloneElementList } from '../../utils/element'
import { splitText } from '../../utils'
import { ZERO } from '../../dataset/constant/Common'
import type { NativeParagraphLayout } from '../text-engine/layout/TextLayoutService'
import type { ParagraphSpan } from '../text-engine-host/ElementBridge'

const MAX_WINDOW_ELEMENTS = 2048
const MAX_FOLLOWING_ROWS = 8

type PreparedPreview = { elements: IElement[]; from: number; to: number;
  insertedCount: number;
  paragraph: ParagraphSpan; lineCount: number }

type PreviewWindow = { lines: PlacedTextLine[]; target: number;
  initialCount: number; paragraphEnd: number;
  paragraphElements: number; paragraphLines: number }

/** Temporary replacement rows accepted after the paragraph flow converges. */
export class CompositionPreview {
  coverageElements: IElement[] = []
  private original: IElement[]
  private key: string
  private current: PlacedTextLine
  private replacements = new Map<LayoutRow, PlacedTextLine>()
  private start = 0
  private end = 0
  private underlineColor = ''
  caret: NativeCaret | null = null
  readonly work = { paragraphElements: 0, windowElements: 0, laidOutLines: 0,
    checkedLines: 0, reusedLines: 0, skippedLines: 0, replacedLines: 0 }

  private constructor(private draw: Draw, readonly row: LayoutRow,
    readonly placed: PlacedTextLine, readonly from: number, readonly to: number,
    readonly base: number, elements: IElement[], private window?: PreviewWindow) {
    this.original = getSlimCloneElementList(elements)
    this.current = placed
    this.key = this.dependencies()
    this.work.paragraphElements = window?.paragraphElements || elements.length
  }

  private dependencies() {
    return [this.draw.getDocumentRevision(), this.draw.getInnerWidth(),
      this.draw.getOptions().scale,
      this.draw.getLayoutHostAdapter().getFontManager().getRevision()].join(':')
  }

  static create(draw: Draw, from: number, to: number) {
    const options = draw.getOptions()
    if (!draw.getZone().isMainActive() || draw.getPosition().getPositionContext().isTable ||
      !draw.getIsPagingMode() || draw.isPrintMode() || !options.trace.disabled ||
      !options.lineBreak.disabled || !options.whiteSpace.disabled ||
      !options.lineNumber.disabled ||
      draw.getRange().getDefaultStyle() ||
      draw.getSearch().getSearchKeyword() || (draw.getColumnLayout()?.count || 1) !== 1)
      return null
    const elements = draw.getOriginalMainElementList()
    // Float exclusions need per-line width constraints, not the full page width.
    if (elements.some(element => !!element.imgDisplay)) return null
    const adapter = draw.getLayoutHostAdapter()
    // Baseline edits do not maintain the incremental paragraph directory.
    if (!options.lab.incrementalEditing) adapter.paragraphs.invalidate(elements)
    const entry = adapter.paragraphs.get(elements).locate(from)
    if (!entry || !entry.record.editable ||
      to >= entry.end || entry.record.elements.some(element =>
        element.underline || element.strikeout || element.highlight ||
        element.textDecoration || element.translateX ||
        element.imgDisplay || element.rowFlex || element.direction ||
        (element.type && element.type !== 'text'))) return null
    const lines = draw.getPosition().getNativeLines().filter(placed =>
      placed.line.source.start >= entry.start && placed.line.source.start < entry.end)
    if (!lines.length || lines.some(p => p.line.direction !== 'ltr' ||
      p.clip || p.line.marker)) return null
    let window: PreviewWindow | undefined
    let base = entry.start
    let original = entry.record.elements
    let placed = lines[0]
    if (lines.length > 1) {
      if (!options.lab.imeWindowPreview) return null
      // Keep shaping context at complete wrap units. Contextual scripts and
      // metric/style changes continue through the authoritative full layout.
      const metric = (e: IElement) => JSON.stringify([
        e.font, e.size, e.bold, e.italic, e.letterSpacing, e.rowMargin
      ])
      const style = metric(original.find(e => e.value !== ZERO) || original[0])
      if (original.some(e => (metric(e) !== style && e.value !== ZERO) ||
        /[^\p{Script=Latin}\p{Script=Han}\p{Script=Common}\p{Script=Inherited}]/u
          .test(e.value) || e.spacingBefore || e.spacingAfter) ||
        lines.some(p => p.line.rect.x || p.line.carets.some(c => c.bidiLevel & 1)))
        return null
      const target = lines.findIndex(p => from >= p.line.source.start &&
        from < p.line.source.end && to < p.line.source.end)
      if (target < 0) return null
      const first = Math.max(0, target - 1)
      base = lines[first].line.source.start
      // Never cut a Latin word, whitespace run, combining or emoji sequence.
      const boundary = (at: number) => {
        if (at === entry.start || at === entry.end) return true
        const before = elements[at - 1]?.value || ''
        const after = elements[at]?.value || ''
        return (/^\s+$/u.test(before) !== /^\s+$/u.test(after)) ||
          (/^\p{Script=Han}+$/u.test(before) &&
            /^\p{Script=Han}+$/u.test(after))
      }
      if (!boundary(base)) return null
      const initial = Math.min(lines.length - 1, target + 1)
      let last = initial
      // Look ahead only within the target page. Keep one matching tail line
      // to prove convergence before reusing the rest of the paragraph.
      const limit = Math.min(lines.length - 1, target + MAX_FOLLOWING_ROWS)
      for (let i = initial + 1; i <= limit; i++) {
        const candidate = lines[i]
        if (candidate.pageNo !== lines[target].pageNo ||
          candidate.line.source.end - base > MAX_WINDOW_ELEMENTS) break
        if (boundary(candidate.line.source.end)) last = i
      }
      const end = lines[last].line.source.end
      if (!boundary(end) || end - base > MAX_WINDOW_ELEMENTS) return null
      original = elements.slice(base, end)
      window = { lines: lines.slice(first, last + 1), target: target - first,
        initialCount: boundary(lines[initial].line.source.end)
          ? initial - first + 1 : last - first + 1, paragraphEnd: entry.end,
        paragraphElements: entry.end - entry.start, paragraphLines: lines.length }
      placed = lines[target]
    } else if (original.length > MAX_WINDOW_ELEMENTS) return null
    const row = draw.getLayoutPages()[placed.pageNo]?.find(row =>
      draw.getPosition().getNativeRow(row,
        draw.getPosition().getOriginalMainPositionList(true), placed.pageNo)?.line === placed.line)
    if (!row) return null
    return new CompositionPreview(draw, row, placed, from, to, base,
      original, window)
  }

  prepare(value: string, expand = false): PreparedPreview | null {
    if (this.dependencies() !== this.key || value.length > MAX_WINDOW_ELEMENTS ||
      /[\r\n\u200b]/.test(value)) return null
    const from = this.from - this.base
    const to = this.to - this.base
    const style = getAnchorElement(this.original, to)
    if (!style) return null
    this.underlineColor = style.color || this.draw.getOptions().underlineColor
    const inserted = splitText(value).map(text => ({ ...style, value: text }))
    const lineCount = expand
      ? this.window!.lines.length
      : this.window?.initialCount ?? 1
    const end = this.window
      ? this.window.lines[lineCount - 1].line.source.end - this.base
      : this.original.length
    const elements = [...this.original.slice(0, from + 1), ...inserted,
      ...this.original.slice(to + 1, end)]
    if (elements.length > MAX_WINDOW_ELEMENTS ||
      elements.filter(e => e.value === ZERO).length > 1)
      return null
    const adapter = this.draw.getLayoutHostAdapter()
    const paragraphs = adapter.scanParagraphs(elements)
    if (paragraphs.length !== 1) return null
    this.work.windowElements = elements.length
    return { elements, paragraph: paragraphs[0], from, to, lineCount,
      insertedCount: inserted.length }
  }

  workerInput(prepared: PreparedPreview) {
    const adapter = this.draw.getLayoutHostAdapter()
    try {
      return adapter.prepareParagraphInput(prepared.paragraph, prepared.elements,
        this.draw.getInnerWidth(), 'ime-preview')
    } finally { adapter.releaseScope('ime-preview') }
  }

  update(value: string) {
    if (this.layout(this.prepare(value))) return true
    return !!this.window && this.window.lines.length > this.window.initialCount &&
      this.layout(this.prepare(value, true))
  }

  private layout(prepared: PreparedPreview | null) {
    if (!prepared) return false
    const adapter = this.draw.getLayoutHostAdapter()
    let layout: ReturnType<typeof adapter.layoutParagraph>
    try {
      layout = adapter.layoutParagraph(prepared.paragraph, prepared.elements,
        this.draw.getInnerWidth(), 'ime-preview')
    } finally {
      adapter.releaseScope('ime-preview')
    }
    return this.accept(prepared, layout)
  }

  accept(prepared: PreparedPreview, layout: NativeParagraphLayout) {
    if (this.dependencies() !== this.key) return false
    const { elements, from, to, insertedCount } = prepared
    this.work.laidOutLines = layout.lines.length
    if (layout.lines.length !== prepared.lineCount) return false
    const width = this.draw.getInnerWidth()
    if (this.window?.lines.slice(0, prepared.lineCount).some(placed =>
      this.draw.getPageSize(placed.pageNo).innerWidth !== width
    )) return false
    const target = this.window?.target || 0
    const changed = this.window
      ? this.converges(layout.lines, insertedCount - (to - from))
      : [0]
    if (!changed) return false
    const replacements = new Map<LayoutRow, PlacedTextLine>()
    for (const i of changed) {
      const placed = this.window?.lines[i] || this.placed
      const old = placed.line
      let line = layout.lines[i]
      if (line.direction !== 'ltr' || line.carets.some(c => c.bidiLevel % 2 === 1) ||
        Math.abs(line.rect.height - old.rect.height) > 0.01 ||
        Math.abs(line.baseline - old.baseline) > 0.01 || line.hidden ||
        line.inlines.some(item => item.kind !== 'missingGlyph')) return false
      if (this.window) line = this.placeLine(line, old)
      const position = this.draw.getPosition()
      const row = i === target ? this.row : this.draw.getLayoutPages()[placed.pageNo]
        ?.find(row => position.getNativeRow(row,
          position.getOriginalMainPositionList(true), placed.pageNo)?.line === old)
      if (!row) return false
      replacements.set(row, { ...placed, line,
        y: this.window ? placed.y : placed.y + (old.rect.y - line.rect.y) * placed.scale })
    }
    const start = from + 1
    const end = from + insertedCount + 1
    // Preserve the current caret affinity at a soft wrap. A caret that moves
    // to another row is handled by the authoritative layout.
    const current = replacements.get(this.row)!
    if (current.line.source.end < end) return false
    const caret = lineCarets(current).find(c => c.index === end - 1)
    if (!caret) return false
    this.replacements = replacements
    this.coverageElements = elements
    this.current = current
    this.start = start
    this.end = end
    this.caret = caret
    this.work.replacedLines = changed.length
    return true
  }

  private placeLine(line: TextLine, old: TextLine): TextLine {
    // Use the canonical paragraph Y to preserve raster rounding.
    const localY = line.rect.y
    const y = (value: number) => old.rect.y + (value - localY)
    const caret = (c: typeof line.carets[number]) => ({ ...c, y: y(c.y) })
    return { ...line, rect: { ...line.rect, y: old.rect.y },
      carets: line.carets.map(caret),
      clusters: line.clusters.map(c => ({ ...c,
        rect: { ...c.rect, y: y(c.rect.y) }, carets: c.carets.map(caret) })),
      inlines: line.inlines.map(item => item.kind === 'missingGlyph'
        ? { ...item, rect: { ...item.rect, y: y(item.rect.y) },
            carets: item.carets.map(caret) } : item) }
  }

  private converges(lines: TextLine[], delta: number) {
    const window = this.window!
    const changed: number[] = []
    let stableTail = false
    this.work.checkedLines = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const old = window.lines[i].line
      this.work.checkedLines++
      if (line.direction !== old.direction || line.hidden !== old.hidden ||
        line.rect.height !== old.rect.height || line.baseline !== old.baseline ||
        line.spacingBefore !== old.spacingBefore || line.spacingAfter !== old.spacingAfter ||
        line.rect.x !== old.rect.x) return false
      stableTail = i !== window.target &&
        this.matchesLine(line, old, this.base - (i > window.target ? delta : 0))
      if (stableTail) continue
      if (i < window.target || window.lines[i].pageNo !== this.placed.pageNo)
        return false
      if (i === window.target && line.source.start + this.base !== old.source.start)
        return false
      changed.push(i)
    }
    const end = window.lines[lines.length - 1].line.source.end
    if (lines.at(-1)!.source.end + this.base !== end + delta ||
      (end !== window.paragraphEnd && !stableTail)) return false
    this.work.reusedLines = window.paragraphLines - changed.length
    this.work.skippedLines = window.paragraphLines - lines.length
    return changed
  }

  private matchesLine(line: TextLine, old: TextLine, offset: number) {
    if (line.source.start + offset !== old.source.start ||
      line.source.end + offset !== old.source.end || line.rect.width !== old.rect.width)
      return false
    // Compare native paint and caret geometry, not only a cached breakpoint.
    const carets = (node: TextLine, shift: number) => node.carets.map(c =>
      [c.position.elementIndex + shift, c.position.offset, c.affinity,
        c.x, c.height, c.bidiLevel])
    const inlines = (node: TextLine, shift: number) => node.inlines.map(item =>
      [item.kind, item.kind === 'missingGlyph' ? item.text : '',
        item.advance, item.rect.x, item.rect.y - node.rect.y,
        item.rect.width, item.rect.height, item.source.start + shift,
        item.source.end + shift])
    return JSON.stringify(line.glyphs) === JSON.stringify(old.glyphs) &&
      JSON.stringify(inlines(line, offset)) === JSON.stringify(inlines(old, 0)) &&
      JSON.stringify(carets(line, offset)) === JSON.stringify(carets(old, 0))
  }

  replaces(row: LayoutRow) {
    return this.replacements.has(row)
  }

  paint(ctx: CanvasRenderingContext2D, row: LayoutRow) {
    const placed = row === this.row ? this.current : this.replacements.get(row)!
    const { line, x, y, scale } = placed
    this.draw.getLayoutHostAdapter().getGlyphRenderer().drawNativeLine(ctx, line, x, y, scale)
    ctx.save()
    ctx.strokeStyle = this.underlineColor
    ctx.lineWidth = scale
    for (const rect of textRangeRects(placed, this.start, this.end)) {
      ctx.beginPath()
      const underlineY = Math.floor(rect.y + rect.height + 2 * scale) + 0.5
      ctx.moveTo(rect.x, underlineY)
      ctx.lineTo(rect.x + rect.width, underlineY)
      ctx.stroke()
    }
    ctx.restore()
  }
}

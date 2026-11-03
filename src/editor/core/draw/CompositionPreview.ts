import type { Draw } from './Draw'
import type { LayoutRow } from '../../interface/LayoutRow'
import type { IElement } from '../../interface/Element'
import type { PlacedTextLine, NativeCaret } from '../layout/InteractionGeometry'
import { lineCarets, textRangeRects } from '../layout/InteractionGeometry'
import { getAnchorElement, getSlimCloneElementList } from '../../utils/element'
import { splitText } from '../../utils'
import { ZERO } from '../../dataset/constant/Common'
import type { NativeParagraphLayout } from '../text-engine/layout/TextLayoutService'
import type { ParagraphSpan } from '../text-engine-host/ElementBridge'

type PreparedPreview = { elements: IElement[]; from: number; to: number;
  insertedCount: number;
  paragraph: ParagraphSpan }

type PreviewWindow = { lines: PlacedTextLine[]; target: number;
  paragraphElements: number; paragraphLines: number }

/** A replacement row accepted only after its surrounding breaks converge. */
export class CompositionPreview {
  coverageElements: IElement[] = []
  private original: IElement[]
  private key: string
  private current: PlacedTextLine
  private start = 0
  private end = 0
  private underlineColor = ''
  caret: NativeCaret | null = null
  readonly work = { paragraphElements: 0, windowElements: 0, laidOutLines: 0,
    checkedLines: 0, reusedLines: 0, skippedLines: 0 }

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
      const last = Math.min(lines.length - 1, target + 1)
      base = lines[first].line.source.start
      const end = lines[last].line.source.end
      // Never cut a Latin word, whitespace run, combining or emoji sequence.
      const boundary = (at: number) => {
        if (at === entry.start || at === entry.end) return true
        const before = elements[at - 1]?.value || ''
        const after = elements[at]?.value || ''
        return (/^\s+$/u.test(before) !== /^\s+$/u.test(after)) ||
          (/^\p{Script=Han}+$/u.test(before) &&
            /^\p{Script=Han}+$/u.test(after))
      }
      if (!boundary(base) || !boundary(end) || end - base > 2048) return null
      original = elements.slice(base, end)
      window = { lines: lines.slice(first, last + 1), target: target - first,
        paragraphElements: entry.end - entry.start, paragraphLines: lines.length }
      placed = lines[target]
    } else if (original.length > 2048) return null
    const row = draw.getLayoutPages()[placed.pageNo]?.find(row =>
      draw.getPosition().getNativeRow(row,
        draw.getPosition().getOriginalMainPositionList(true), placed.pageNo)?.line === placed.line)
    if (!row) return null
    return new CompositionPreview(draw, row, placed, from, to, base,
      original, window)
  }

  prepare(value: string): PreparedPreview | null {
    if (this.dependencies() !== this.key || value.length > 2048 ||
      /[\r\n\u200b]/.test(value)) return null
    const from = this.from - this.base
    const to = this.to - this.base
    const style = getAnchorElement(this.original, to)
    if (!style) return null
    this.underlineColor = style.color || this.draw.getOptions().underlineColor
    const inserted = splitText(value).map(text => ({ ...style, value: text }))
    const elements = [...this.original.slice(0, from + 1), ...inserted,
      ...this.original.slice(to + 1)]
    if (elements.length > 2048 || elements.filter(e => e.value === ZERO).length > 1)
      return null
    const adapter = this.draw.getLayoutHostAdapter()
    const paragraphs = adapter.scanParagraphs(elements)
    if (paragraphs.length !== 1) return null
    this.work.windowElements = elements.length
    return { elements, paragraph: paragraphs[0], from, to,
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
    const prepared = this.prepare(value)
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
    if (layout.lines.length !== (this.window?.lines.length || 1)) return false
    if (this.window && !this.converges(layout.lines, insertedCount - (to - from)))
      return false
    let line = layout.lines[this.window?.target || 0]
    const old = this.placed.line
    if (line.direction !== 'ltr' || line.carets.some(c => c.bidiLevel % 2 === 1) ||
      Math.abs(line.rect.height - old.rect.height) > 0.01 ||
      Math.abs(line.baseline - old.baseline) > 0.01 || line.hidden ||
      line.inlines.some(item => item.kind !== 'missingGlyph')) return false
    if (this.window) {
      // Reuse the canonical paragraph Y before applying the page transform.
      // (placedY + oldY - localY) + localY changes floating-point rounding and
      // can change Canvas raster pixels even when the difference is < 1e-12.
      const localY = line.rect.y
      const y = (value: number) => old.rect.y + (value - localY)
      const caret = (c: typeof line.carets[number]) => ({ ...c, y: y(c.y) })
      line = { ...line, rect: { ...line.rect, y: old.rect.y },
        carets: line.carets.map(caret),
        clusters: line.clusters.map(c => ({ ...c,
          rect: { ...c.rect, y: y(c.rect.y) }, carets: c.carets.map(caret) })),
        inlines: line.inlines.map(item => item.kind === 'missingGlyph'
          ? { ...item, rect: { ...item.rect, y: y(item.rect.y) },
              carets: item.carets.map(caret) } : item) }
    }
    this.coverageElements = elements
    this.current = { ...this.placed, line,
      y: this.window ? this.placed.y :
        this.placed.y + (old.rect.y - line.rect.y) * this.placed.scale }
    this.start = from + 1
    this.end = from + insertedCount + 1
    this.caret = lineCarets(this.current).find(c => c.index === this.end - 1) || null
    return !!this.caret
  }

  private converges(lines: import('../../interface/Layout').TextLine[], delta: number) {
    const window = this.window!
    this.work.checkedLines = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const old = window.lines[i].line
      const startDelta = i > window.target ? delta : 0
      const endDelta = i >= window.target ? delta : 0
      this.work.checkedLines++
      if (line.source.start + this.base !== old.source.start + startDelta ||
        line.source.end + this.base !== old.source.end + endDelta ||
        line.direction !== old.direction || line.hidden !== old.hidden ||
        line.rect.height !== old.rect.height || line.baseline !== old.baseline ||
        line.rect.x !== old.rect.x) return false
      if (i === window.target) continue
      if (line.rect.width !== old.rect.width) return false
      // Compare native paint and caret geometry, not only a cached breakpoint.
      const carets = (node: typeof line, offset: number) => node.carets.map(c =>
        [c.position.elementIndex + offset, c.position.offset, c.affinity,
          c.x, c.height, c.bidiLevel])
      const inlines = (node: typeof line, offset: number) => node.inlines.map(item =>
        [item.kind, item.kind === 'missingGlyph' ? item.text : '',
          item.advance, item.rect.x, item.rect.y - node.rect.y,
          item.rect.width, item.rect.height, item.source.start + offset,
          item.source.end + offset])
      if (JSON.stringify(line.glyphs) !== JSON.stringify(old.glyphs) ||
        JSON.stringify(inlines(line, this.base - startDelta)) !==
          JSON.stringify(inlines(old, 0)) ||
        JSON.stringify(carets(line, this.base - startDelta)) !==
          JSON.stringify(carets(old, 0))) return false
    }
    this.work.reusedLines = window.paragraphLines - 1
    this.work.skippedLines = window.paragraphLines - window.lines.length
    return true
  }

  paint(ctx: CanvasRenderingContext2D) {
    const { line, x, y, scale } = this.current
    this.draw.getLayoutHostAdapter().getGlyphRenderer().drawNativeLine(ctx, line, x, y, scale)
    ctx.save()
    ctx.strokeStyle = this.underlineColor
    ctx.lineWidth = scale
    for (const rect of textRangeRects(this.current, this.start, this.end)) {
      ctx.beginPath()
      const underlineY = Math.floor(rect.y + rect.height + 2 * scale) + 0.5
      ctx.moveTo(rect.x, underlineY)
      ctx.lineTo(rect.x + rect.width, underlineY)
      ctx.stroke()
    }
    ctx.restore()
  }
}

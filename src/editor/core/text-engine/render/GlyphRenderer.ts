import type { FontManager } from '../font/FontManager'
import type { LayoutLine, ShapedGlyph } from '../types'
import type { GlyphOutline } from '../font/GlyphOutline'

/** Paint the shaped face/glyph outline at its HB pen position, without reshaping. */
export class GlyphRenderer {
  private paths = new Map<GlyphOutline, { path: Path2D; bytes: number }>()
  private pathBytes = 0
  private fontRevision = -1
  readonly stats = { builds: 0, hits: 0, evictions: 0, bytes: 0, entries: 0 }

  constructor(
    private fontManager?: FontManager,
    private cachePaths: () => boolean = () => false
  ) {}

  destroy() {
    this.paths.clear()
    this.pathBytes = 0
    this.stats.bytes = this.stats.entries = 0
  }

  drawNativeLine(
    ctx: CanvasRenderingContext2D,
    line: import('../../../interface/Layout').TextLine,
    x: number,
    y: number,
    scale = 1,
    style?: (indices: number[]) => { hidden?: boolean; color?: string }
  ) {
    if (line.hidden) return
    ctx.save()
    try {
      ctx.translate(x, y)
      ctx.scale(scale, scale)
      for (const glyph of line.glyphs) {
        const cluster = line.clusters[glyph.clusterIndex]
        const live = style?.(cluster.logicalIndices)
        if (live?.hidden) continue
        const outline = this.fontManager?.getGlyphOutlineByRef(
          glyph.font,
          glyph.glyphId,
          glyph.fontSize
        )
        if (outline?.status === 'empty') continue
        if (outline?.status !== 'ready')
          throw new Error(`No supported outline for glyph ${glyph.glyphId}`)
        ctx.save()
        ctx.translate(
          line.rect.x + glyph.x + glyph.offsetX,
          line.rect.y + line.baseline + glyph.y + glyph.offsetY
        )
        ctx.fillStyle = live?.color || glyph.color
        this.paintOutline(ctx, outline)
        ctx.restore()
      }
      for (const inline of line.inlines) {
        if (inline.kind !== 'missingGlyph' || inline.hidden) continue
        const indices = Array.from(
          { length: inline.source.end - inline.source.start },
          (_, index) => inline.source.start + index
        )
        const live = style?.(indices)
        if (live?.hidden) continue
        ctx.strokeStyle = live?.color || '#000'
        ctx.lineWidth = 1 / scale
        ctx.strokeRect(
          inline.rect.x + 1 / scale,
          inline.rect.y + 1 / scale,
          Math.max(1 / scale, inline.rect.width - 2 / scale),
          Math.max(1 / scale, inline.rect.height - 2 / scale)
        )
      }
    } finally {
      ctx.restore()
    }
  }

  private paintOutline(
    ctx: CanvasRenderingContext2D,
    outline: GlyphOutline
  ) {
    const revision = this.fontManager?.getRevision() || 0
    if (revision !== this.fontRevision) {
      this.destroy()
      this.fontRevision = revision
    }
    const cachePaths = this.cachePaths()
    if (!cachePaths && this.paths.size) this.destroy()
    if (cachePaths && typeof Path2D !== 'undefined') {
      let entry = this.paths.get(outline)
      if (!entry) {
        const path = new Path2D()
        this.replay(path, outline.commands)
        entry = { path, bytes: outline.commands.length * 64 + 128 }
        this.stats.builds++
        if (entry.bytes <= 4 * 1024 * 1024) {
          this.paths.set(outline, entry)
          this.pathBytes += entry.bytes
          while (this.paths.size > 1024 || this.pathBytes > 4 * 1024 * 1024) {
            const oldest = this.paths.keys().next().value!
            this.pathBytes -= this.paths.get(oldest)!.bytes
            this.paths.delete(oldest)
            this.stats.evictions++
          }
        }
      } else {
        this.stats.hits++
        this.paths.delete(outline)
        this.paths.set(outline, entry)
      }
      this.stats.bytes = this.pathBytes
      this.stats.entries = this.paths.size
      ctx.fill(entry.path)
      return
    }
    ctx.beginPath()
    this.replay(ctx, outline.commands)
    ctx.fill()
  }

  private replay(
    target: CanvasPath,
    commands: GlyphOutline['commands']
  ) {
    for (const command of commands) {
      switch (command.type) {
        case 'M':
          target.moveTo(command.x, command.y)
          break
        case 'L':
          target.lineTo(command.x, command.y)
          break
        case 'Q':
          target.quadraticCurveTo(command.x1, command.y1, command.x, command.y)
          break
        case 'C':
          target.bezierCurveTo(
            command.x1,
            command.y1,
            command.x2,
            command.y2,
            command.x,
            command.y
          )
          break
        case 'Z':
          target.closePath()
          break
      }
    }
  }

  drawLine(
    ctx: CanvasRenderingContext2D,
    line: LayoutLine,
    originX: number,
    baselineY: number,
    _paragraphText?: string
  ) {
    // Kept only for old callers; source text never participates in painting.
    void _paragraphText
    for (const glyph of line.glyphs) {
      this.drawGlyph(ctx, glyph, originX, baselineY)
    }
  }

  drawGlyph(
    ctx: CanvasRenderingContext2D,
    glyph: ShapedGlyph,
    originX: number,
    baselineY: number,
    _paragraphText?: string
  ) {
    void _paragraphText
    // The object particle owns its ink; whitespace has metrics but no outline.
    if (glyph.inkless || glyph.style.objectWidth != null) return
    const outline =
      glyph.font &&
      this.fontManager?.getGlyphOutlineByRef(
        glyph.font,
        glyph.glyphId,
        glyph.style.fontSize
      )
    if (!glyph.missing && outline?.status === 'empty') return
    if (!glyph.missing && outline?.status !== 'ready') {
      throw new Error(
        `No supported outline for glyph ${glyph.glyphId} in ${glyph.font?.family || 'unknown face'}`
      )
    }
    const x = originX + glyph.left + glyph.dx
    const y = baselineY + (glyph.baselineShift || 0) - glyph.dy
    ctx.save()
    try {
      ctx.translate(x, y)
      ctx.fillStyle = glyph.style.color || '#000'
      if (glyph.missing && outline?.status !== 'ready') {
        this.drawMissingBox(ctx, glyph)
        return
      }
      this.paintOutline(ctx, outline!)
    } finally {
      ctx.restore()
    }
  }

  private drawMissingBox(ctx: CanvasRenderingContext2D, glyph: ShapedGlyph) {
    const metrics = glyph.missing!.metrics
    ctx.strokeStyle = glyph.style.color || '#000'
    ctx.lineWidth = 1
    ctx.strokeRect(
      1,
      -metrics.ascent + 1,
      Math.max(1, metrics.advance - 2),
      Math.max(1, metrics.ascent + metrics.descent - 2)
    )
  }
}

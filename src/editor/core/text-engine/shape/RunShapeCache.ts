import type { ITextShaper } from './ITextShaper'
import type { ShapedGlyph, StyleRun } from '../types'

/** Reuse complete shaping runs only; BiDi and line breaking remain authoritative. */
export class RunShapeCache implements ITextShaper {
  private entries = new Map<string, { glyphs: ShapedGlyph[]; bytes: number }>()
  private bytes = 0
  private revision = -1
  readonly stats = { hits: 0, misses: 0, shapedUnits: 0, reusedUnits: 0, bytes: 0, entries: 0 }

  constructor(
    private shaper: ITextShaper,
    private getRevision: () => number,
    private enabled: () => boolean = () => true,
    private budget = 16 * 1024 * 1024
  ) {}

  clear() { this.entries.clear(); this.bytes = 0; this.stats.bytes = this.stats.entries = 0 }

  shape(run: StyleRun): ShapedGlyph[] {
    if (!this.enabled() || run.style.objectWidth != null || run.text.length > 32768)
      return this.shaper.shape(run)
    const revision = this.getRevision()
    if (revision !== this.revision) { this.clear(); this.revision = revision }
    const key = JSON.stringify([run.text, run.style, run.direction,
      run.script, run.language])
    let entry = this.entries.get(key)
    if (!entry) {
      const glyphs = this.shaper.shape({ ...run, textStart: 0,
        textEnd: run.text.length, logicalIndexAt: index => index })
      const bytes = key.length * 2 + glyphs.length * 512
      entry = { glyphs, bytes }
      this.stats.misses++
      this.stats.shapedUnits += run.text.length
      if (bytes <= this.budget) {
        this.entries.set(key, entry)
        this.bytes += bytes
        while (this.entries.size > 1024 || this.bytes > this.budget) {
          const first = this.entries.keys().next().value!
          this.bytes -= this.entries.get(first)!.bytes
          this.entries.delete(first)
        }
      }
    } else {
      this.entries.delete(key)
      this.entries.set(key, entry)
      this.stats.hits++
      this.stats.reusedUnits += run.text.length
    }
    this.stats.bytes = this.bytes
    this.stats.entries = this.entries.size
    const index = (local: number) => run.logicalIndexAt(run.textStart + local)
    return entry.glyphs.map(glyph => ({ ...glyph,
      // The layout engine may position its owned output without mutating cache.
      style: { ...glyph.style },
      charStart: run.textStart + glyph.charStart,
      charEnd: run.textStart + glyph.charEnd,
      logicalIndexStart: index(glyph.logicalIndexStart),
      logicalIndexEnd: index(glyph.logicalIndexEnd),
      logicalIndices: glyph.logicalIndices?.map(index)
    }))
  }
}

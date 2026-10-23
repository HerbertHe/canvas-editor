import { FontManager } from '../font/FontManager'
import { BidiResolver } from '../bidi/BidiResolver'
import { HarfBuzzTextShaper } from '../shape/HarfBuzzTextShaper'
import { RunShapeCache } from '../shape/RunShapeCache'
import { TextLayoutEngine } from './TextLayoutEngine'
import { TextLayoutService } from './TextLayoutService'
import type { NativeParagraphInput, NativeParagraphLayout } from './TextLayoutService'
import type { IEditorFontFace } from '../../../interface/TextEngine'

export interface LayoutKernelRequest {
  schemaVersion: 1
  input: NativeParagraphInput
}
export interface LayoutKernelResult {
  schemaVersion: 1
  layout: NativeParagraphLayout
  // Text DTOs have no model side effects. Object sizing stays in host preparation.
  patches: readonly never[]
}

/** No Draw/DOM/Canvas imports; fonts and WASM belong to this executor. */
export class LayoutKernel {
  readonly fonts: FontManager
  readonly runs: RunShapeCache
  readonly engine: TextLayoutEngine
  readonly service: TextLayoutService
  private ownsFonts: boolean
  private destroyed = false

  constructor(fonts?: FontManager, cacheRuns: () => boolean = () => false) {
    this.fonts = fonts || new FontManager()
    this.ownsFonts = !fonts
    this.runs = new RunShapeCache(new HarfBuzzTextShaper(this.fonts, false),
      () => this.fonts.getRevision(), cacheRuns)
    this.engine = new TextLayoutEngine(new BidiResolver(), this.runs)
    this.service = new TextLayoutService(this.engine, this.fonts)
  }

  async initialize(faces: IEditorFontFace[], defaultFamily?: string) {
    if (this.destroyed) throw new Error('Layout kernel destroyed')
    await this.fonts.init(faces, defaultFamily)
    if (this.fonts.getFailures().length)
      throw new Error('Layout kernel font initialization failed')
  }

  layout(request: LayoutKernelRequest): LayoutKernelResult {
    if (this.destroyed) throw new Error('Layout kernel destroyed')
    if (request.schemaVersion !== 1) throw new Error('Unsupported layout schema')
    return { schemaVersion: 1, layout: this.service.layoutParagraph(request.input),
      patches: [] }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.runs.clear()
    if (this.ownsFonts) this.fonts.destroy()
  }
}

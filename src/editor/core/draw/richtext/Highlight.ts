import { AbstractRichText } from './AbstractRichText'
import { IEditorOption } from '../../../interface/Editor'
import { Draw } from '../Draw'

export class Highlight extends AbstractRichText {
  private draw: Draw
  private options: Required<IEditorOption>

  constructor(draw: Draw) {
    super()
    this.draw = draw
    this.options = draw.getOptions()
  }

  public render(ctx: CanvasRenderingContext2D) {
    if (!this.fillRect.width) return
    const { highlightAlpha, direction } = this.options
    const { x: rawX, y, width, height } = this.fillRect
    const innerWidth = this.draw.getInnerWidth()
    const x = direction === 'rtl' ? rawX - innerWidth : rawX
    ctx.save()
    ctx.globalAlpha = highlightAlpha
    ctx.fillStyle = this.fillColor!
    ctx.fillRect(x, y, width, height)
    ctx.restore()
    this.clearFillInfo()
  }
}

import { IEditorOption } from '../../../interface/Editor'
import { Draw } from '../Draw'

export class Highlight {
  private options: Required<IEditorOption>

  constructor(draw: Draw) {
    this.options = draw.getOptions()
  }

  public render(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string
  ) {
    const { highlightAlpha } = this.options
    ctx.save()
    ctx.globalAlpha = highlightAlpha
    ctx.fillStyle = color
    ctx.fillRect(x, y, width, height)
    ctx.restore()
  }
}

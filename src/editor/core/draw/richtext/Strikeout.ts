import { IEditorOption } from '../../../interface/Editor'
import { Draw } from '../Draw'

export class Strikeout {
  private options: Required<IEditorOption>

  constructor(draw: Draw) {
    this.options = draw.getOptions()
  }

  public render(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number
  ) {
    const { strikeoutColor, direction } = this.options
    const calcX = direction === 'rtl' ? x - width : x
    ctx.save()
    ctx.strokeStyle = strikeoutColor
    const adjustY = y + 0.5 // 从1处渲染，避免线宽度等于3
    ctx.beginPath()
    ctx.moveTo(calcX, adjustY)
    ctx.lineTo(calcX + width, adjustY)
    ctx.stroke()
    ctx.restore()
    // this.clearFillInfo()
  }
}

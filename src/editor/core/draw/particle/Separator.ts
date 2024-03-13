import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IRowElement } from '../../../interface/Row'
import { Draw } from '../Draw'
export class SeparatorParticle {
  private options: DeepRequired<IEditorOption>

  constructor(draw: Draw) {
    this.options = draw.getOptions()
  }

  public render(
    ctx: CanvasRenderingContext2D,
    element: IRowElement,
    x: number,
    y: number
  ) {
    ctx.save()
    const { scale, direction } = this.options
    ctx.lineWidth = scale
    if (element.color) {
      ctx.strokeStyle = element.color
    }
    if (element.dashArray && element.dashArray.length) {
      ctx.setLineDash(element.dashArray)
    }
    const graphX = direction === 'rtl' ? x - element.width! : x
    ctx.translate(0, 0.5) // 从1处渲染，避免线宽度等于3
    ctx.beginPath()
    ctx.moveTo(graphX, y)
    ctx.lineTo(graphX + element.width! * scale, y)
    ctx.stroke()
    ctx.restore()
  }
}

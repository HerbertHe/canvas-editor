import {
  BackgroundRepeat,
  BackgroundSize
} from '../../../dataset/enum/Background'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { Draw } from '../Draw'

export class Background {
  private draw: Draw
  private options: DeepRequired<IEditorOption>

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
  }

  private _renderBackgroundColor(
    ctx: CanvasRenderingContext2D,
    color: string,
    width: number,
    height: number
  ) {
    ctx.save()
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
  }

  private _drawImage(
    ctx: CanvasRenderingContext2D,
    imageElement: HTMLImageElement,
    width: number,
    height: number
  ) {
    const { background, scale } = this.options
    // contain
    if (background.size === BackgroundSize.CONTAIN) {
      const imageWidth = imageElement.width * scale
      const imageHeight = imageElement.height * scale
      if (
        !background.repeat ||
        background.repeat === BackgroundRepeat.NO_REPEAT
      ) {
        ctx.drawImage(imageElement, 0, 0, imageWidth, imageHeight)
      } else {
        let startX = 0
        let startY = 0
        const repeatXCount =
          background.repeat === BackgroundRepeat.REPEAT ||
          background.repeat === BackgroundRepeat.REPEAT_X
            ? Math.ceil((width * scale) / imageWidth)
            : 1
        const repeatYCount =
          background.repeat === BackgroundRepeat.REPEAT ||
          background.repeat === BackgroundRepeat.REPEAT_Y
            ? Math.ceil((height * scale) / imageHeight)
            : 1
        for (let x = 0; x < repeatXCount; x++) {
          for (let y = 0; y < repeatYCount; y++) {
            ctx.drawImage(imageElement, startX, startY, imageWidth, imageHeight)
            startY += imageHeight
          }
          startY = 0
          startX += imageWidth
        }
      }
    } else {
      // cover
      ctx.drawImage(imageElement, 0, 0, width * scale, height * scale)
    }
  }

  public render(ctx: CanvasRenderingContext2D, pageNo: number) {
    const {
      background: { image, color, applyPageNumbers }
    } = this.options
    if (
      image &&
      (!applyPageNumbers?.length || applyPageNumbers.includes(pageNo))
    ) {
      const { width, height } = this.options
      const bitmap = this.draw.getImageObserver().get(ctx.canvas, image)
      if (bitmap) {
        this._drawImage(ctx, bitmap, width, height)
        return
      }
    }
    const width = this.draw.getCanvasWidth(pageNo)
    const height = this.draw.getCanvasHeight(pageNo)
    this._renderBackgroundColor(ctx, color, width, height)
  }
}

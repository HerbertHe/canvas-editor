// import { TextDecorationStyle } from '../../../dataset/enum/Text'
// // import { IElementFillRectRenderQueue } from '../../../interface/Element'

// /**
//  * @deprecated 废除抽象绘制
//  */
// export abstract class AbstractRichText {
//   // protected fillRectRenderQueue: IElementFillRectRenderItem[]
//   protected fillColor?: string
//   protected fillDecorationStyle?: TextDecorationStyle

//   // constructor() {
//   //   this.fillRectRenderQueue = this.clearFillInfo()
//   // }

//   // public clearFillInfo() {
//   //   this.fillColor = undefined
//   //   this.fillDecorationStyle = undefined
//   //   this.fillRectRenderQueue = []
//   //   return this.fillRectRenderQueue
//   // }

//   /**
//    * @deprecated
//    * @param x
//    * @param y
//    * @param width
//    * @param height
//    * @param color
//    * @param decorationStyle
//    */
//   public recordFillInfo(
//     x: number,
//     y: number,
//     width: number,
//     height?: number,
//     color?: string,
//     decorationStyle?: TextDecorationStyle
//   ) {
//     // this.fillRectRenderQueue.push({
//     //   x,
//     //   y,
//     //   width,
//     //   height,
//     //   color,
//     //   decorationStyle
//     // })
//     // TODO 在此需要进行重构，按行绘制，而不是按元素绘制
//     // TODO 需要进行同样类型进行判断
//     // 不需要判断是否是第一个，全部往里面扔
//     // const isFirstRecord = !this.fillRectRenderQueue.width
//     // 颜色不同时立即绘制
//     // if (
//     //   // !isFirstRecord &&
//     //   this.fillColor !== color ||
//     //   this.fillDecorationStyle !== decorationStyle
//     // ) {
//     //   this.render(ctx)
//     //   this.clearFillInfo()
//     //   // 重新记录
//     //   this.recordFillInfo(ctx, x, y, width, height, color, decorationStyle)
//     //   return
//     // }
//     // if (isFirstRecord) {
//     //   this.fillRect.x = x
//     //   this.fillRect.y = y
//     // }
//     // if (height && this.fillRect.height < height) {
//     //   this.fillRect.height = height
//     // }
//     // this.fillRect.width += width
//     // this.fillColor = color
//     // this.fillDecorationStyle = decorationStyle
//   }

//   public abstract render(
//     ctx: CanvasRenderingContext2D,
//     x: number,
//     y: number,
//     width: number,
//     height?: number,
//     color?: string,
//     decorationStyle?: TextDecorationStyle
//   ): void
// }

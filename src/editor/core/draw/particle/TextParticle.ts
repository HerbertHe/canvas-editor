import { ElementType, IEditorOption, IElement } from '../../..'
import { PUNCTUATION_LIST } from '../../../dataset/constant/Common'
import { DeepRequired } from '../../../interface/Common'
import { IRowElement } from '../../../interface/Row'
import { ITextMetrics, ITextRenderItem } from '../../../interface/Text'
import { Draw } from '../Draw'

export interface IMeasureWordResult {
  width: number
  endElement: IElement
}

export class TextParticle {
  private draw: Draw
  private options: DeepRequired<IEditorOption>

  private ctx: CanvasRenderingContext2D
  private textRenderQueue: ITextRenderItem[]
  private curStyle: string
  private curColor?: string
  public cacheMeasureText: Map<string, TextMetrics>

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.ctx = draw.getCtx()
    this.textRenderQueue = []
    this.curStyle = ''
    this.cacheMeasureText = new Map()
  }

  public measureWord(
    ctx: CanvasRenderingContext2D,
    elementList: IElement[],
    curIndex: number
  ): IMeasureWordResult {
    const LETTER_REG = this.draw.getLetterReg()
    let width = 0
    let endElement: IElement = elementList[curIndex]
    let i = curIndex
    while (i < elementList.length) {
      const element = elementList[i]
      if (
        (element.type && element.type !== ElementType.TEXT) ||
        !LETTER_REG.test(element.value)
      ) {
        endElement = element
        break
      }
      width += this.measureText(ctx, element).width
      i++
    }
    return {
      width,
      endElement
    }
  }

  public measurePunctuationWidth(
    ctx: CanvasRenderingContext2D,
    element: IElement
  ): number {
    if (!element || !PUNCTUATION_LIST.includes(element.value)) return 0
    return this.measureText(ctx, element).width
  }

  public measureText(
    ctx: CanvasRenderingContext2D,
    element: IElement
  ): ITextMetrics {
    // 优先使用自定义字宽设置
    if (element.width) {
      const textMetrics = ctx.measureText(element.value)
      // TextMetrics是类无法解构
      return {
        width: element.width,
        actualBoundingBoxAscent: textMetrics.actualBoundingBoxAscent,
        actualBoundingBoxDescent: textMetrics.actualBoundingBoxDescent,
        actualBoundingBoxLeft: textMetrics.actualBoundingBoxLeft,
        actualBoundingBoxRight: textMetrics.actualBoundingBoxRight,
        fontBoundingBoxAscent: textMetrics.fontBoundingBoxAscent,
        fontBoundingBoxDescent: textMetrics.fontBoundingBoxDescent
      }
    }
    const id = `${element.value}${ctx.font}`
    const cacheTextMetrics = this.cacheMeasureText.get(id)
    if (cacheTextMetrics) {
      return cacheTextMetrics
    }
    const textMetrics = ctx.measureText(element.value)
    this.cacheMeasureText.set(id, textMetrics)
    return textMetrics
  }

  public complete() {
    this._render()
    this.textRenderQueue = []
  }

  public record(
    ctx: CanvasRenderingContext2D,
    element: IRowElement,
    x: number,
    y: number
  ) {
    this.ctx = ctx
    const { value, style, color, metrics } = element
    // 样式发生改变
    if (
      (this.curStyle && element.style !== this.curStyle) ||
      element.color !== this.curColor
    ) {
      // 在 push 之前修复错误的符号结尾
      if (this.textRenderQueue.length !== 0) {
        this._fixRTLSymbols()
      }
      this.textRenderQueue.push({
        value,
        width: [metrics.width],
        style,
        color,
        x,
        y
      })
    } else {
      if (this.textRenderQueue.length !== 0) {
        this.textRenderQueue[this.textRenderQueue.length - 1].width.push(
          metrics.width
        )
        this.textRenderQueue[this.textRenderQueue.length - 1].value += value
      } else {
        // 在 push 之前修复错误的符号结尾
        if (this.textRenderQueue.length !== 0) {
          this._fixRTLSymbols()
        }
        this.textRenderQueue.push({
          value,
          width: [metrics.width],
          style,
          color,
          x,
          y
        })
      }
    }

    this.curStyle = element.style
    this.curColor = element.color
  }

  private _fixRTLSymbols() {
    const { value, ...args } =
      this.textRenderQueue[this.textRenderQueue.length - 1]
    // CJK 标点符号
    const lc = value.charAt(value.length - 1)
    if (
      /[\u3001-\u303f]/.test(lc) ||
      /[\u0021-\u002f\u003a-\u0040]+/.test(lc)
    ) {
      // 进行标点符号修正
      this.textRenderQueue[this.textRenderQueue.length - 1].value = value.slice(
        0,
        -1
      )
      const poped =
        this.textRenderQueue[this.textRenderQueue.length - 1].width.pop()!
      this.textRenderQueue.push({ ...args, width: [poped], value: lc })
    }
  }

  private _reQueue() {
    if (this.textRenderQueue.length === 1) {
      return
    }

    const result: ITextRenderItem[] = [this.textRenderQueue[0]]
    const startX = this.textRenderQueue[0].x
    let offsetX = 0

    for (let i = 1; i < this.textRenderQueue.length; i++) {
      const cur = this.textRenderQueue[i]
      const last = this.textRenderQueue[i - 1]

      // 重新进行排队
      if (
        this._isRTLCharacter(cur.value[0]) ||
        this._isRTLCharacter(last.value[0])
      ) {
        result.push(cur)
      } else {
        result.unshift(cur)
      }
    }

    // 重新计算坐标
    this.textRenderQueue = result.map(r => {
      const res = {
        ...r,
        x: startX - offsetX
      }
      offsetX += r.width.reduce((prev, curr) => {
        return prev + curr
      })
      return res
    })
  }

  private _isRTLCharacter(c: string) {
    // 希伯来语、阿拉伯语、叙利亚文、它拿字母、西非书面语、撒马利亚字母、曼达字母
    // TODO 验证其他不常用的，塞浦路斯语也是
    if (
      /[\u0590-\u06ff\u07ff-\u086f\u08a0-\u08ff\u005b-\u0060\u007b-\u007e]+/.test(
        c
      )
    ) {
      return true
    }

    // CJK 标点符号遵守 rtl 规则
    if (/[\u3001-\u303f]/.test(c)) {
      return true
    }

    if (/[\u0021-\u002f\u003a-\u0040]+/.test(c)) {
      return true
    }

    return false
  }

  private _render() {
    if (this.textRenderQueue.length === 0) return

    const { direction } = this.options
    if (direction === 'rtl') {
      this._reQueue()
      // TODO 重新计算给 underline 一个正确的 x坐标, 要修改此 element 的坐标才行
      // TODO 修改 underline, strikeout 坐标
    }

    this.ctx.save()
    this.textRenderQueue.forEach(({ value, color, style, x, y }) => {
      this.ctx.font = style
      this.ctx.fillStyle = color || this.options.defaultColor
      this.ctx.fillText(value, x, y)
    })
    this.ctx.restore()
  }
}

import { ElementType, IEditorOption, IElement } from '../../..'
import { PUNCTUATION_LIST } from '../../../dataset/constant/Common'
import { DeepRequired } from '../../../interface/Common'
import { IElementBasic, IElementPosition } from '../../../interface/Element'
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
  private curType: IElementBasic['type']
  private curStyle: string
  private curColor?: string
  public cacheMeasureText: Map<string, TextMetrics>

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.ctx = draw.getCtx()
    this.textRenderQueue = []
    this.curType = undefined
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
    y: number,
    position: IElementPosition
  ) {
    this.ctx = ctx
    const { direction } = this.options
    const { value, style, color, metrics, type } = element
    // 样式发生改变, 元素类型发生了改变

    let offsetY = 0
    if (type === ElementType.SUPERSCRIPT) {
      offsetY = -element.metrics.height / 2
    } else if (type === ElementType.SUBSCRIPT) {
      offsetY = element.metrics.height / 2
    }

    if (
      (this.curType && element.type !== this.curType) ||
      (this.curStyle && element.style !== this.curStyle) ||
      element.color !== this.curColor ||
      element.width
      // element.letterSpacing === 0
    ) {
      // TODO 通过 type='control' 和 valueSets 的方式进行计划实现
      // 在 push 之前修复错误的符号结尾
      if (this.textRenderQueue.length !== 0 && direction === 'rtl') {
        this._fixRTLSymbols()
      }

      // TODO position 坐标用于进行计算，仍然需要 position，要修改重新排队时机, position 重新定义坐标
      this.textRenderQueue.push({
        value,
        elements: [element],
        positions: [position],
        width: [metrics.width],
        style,
        color,
        x,
        y: y + offsetY
      })
    } else {
      if (this.textRenderQueue.length !== 0) {
        this.textRenderQueue[this.textRenderQueue.length - 1].width.push(
          metrics.width
        )
        this.textRenderQueue[this.textRenderQueue.length - 1].value += value
        this.textRenderQueue[this.textRenderQueue.length - 1].elements.push(
          element
        )
        this.textRenderQueue[this.textRenderQueue.length - 1].positions.push(
          position
        )
      } else {
        // 在 push 之前修复错误的符号结尾
        if (this.textRenderQueue.length !== 0 && direction === 'rtl') {
          this._fixRTLSymbols()
        }
        this.textRenderQueue.push({
          value,
          elements: [element],
          positions: [position],
          width: [metrics.width],
          style,
          color,
          x,
          y: y + offsetY
        })
      }
    }

    this.curType = element.type
    this.curStyle = element.style
    this.curColor = element.color

    if (element.control?.type === 'checkbox') {
      console.log(element)
    }
  }

  private _fixRTLSymbols() {
    const { value, ...args } =
      this.textRenderQueue[this.textRenderQueue.length - 1]
    const lc = value.charAt(value.length - 1)

    // CJK 标点符号, 处理特殊符号
    if (
      this._isSpecialCharacter(lc) ||
      /[\u3001-\u303f]/.test(lc) ||
      /[\u0021-\u002f\u003a-\u0040]+/.test(lc)
    ) {
      // 进行标点符号修正
      this.textRenderQueue[this.textRenderQueue.length - 1].value = value.slice(
        0,
        -1
      )
      const width_poped =
        this.textRenderQueue[this.textRenderQueue.length - 1].width.pop()!
      const element_poped =
        this.textRenderQueue[this.textRenderQueue.length - 1].elements.pop()!
      const position_poped =
        this.textRenderQueue[this.textRenderQueue.length - 1].positions.pop()!
      // 修正成员
      this.textRenderQueue.push({
        ...args,
        elements: [element_poped],
        positions: [position_poped],
        width: [width_poped],
        value: lc
      })
    }
  }

  // 进行外部触发
  public reQueue() {
    if (this.textRenderQueue.length < 2) {
      return
    }

    const result: ITextRenderItem[] = [this.textRenderQueue[0]]
    const startX = this.textRenderQueue[0].x
    let offsetX = 0

    for (let i = 1; i < this.textRenderQueue.length; i++) {
      const cur = this.textRenderQueue[i]
      const last = this.textRenderQueue[i - 1]

      // 重新进行排队，角标强制 ltr
      if (
        cur.elements[0].type === ElementType.SUPERSCRIPT ||
        cur.elements[0].type === ElementType.SUBSCRIPT
      ) {
        result.unshift(cur)
      } else if (
        this._isRTLCharacter(cur.value[0]) ||
        this._isRTLCharacter(last.value[0])
      ) {
        result.push(cur)
      } else {
        result.unshift(cur)
      }
    }

    // 重新计算坐标, 只计算一次就行了
    this.textRenderQueue = result.map((r, idx) => {
      // TODO 处理 letterSpacing
      // TODO control 文本不能连续绘制
      const x = startX - offsetX
      // TODO 赋值 rtlPositions, 方便进行后续取值
      const res = {
        ...r,
        positions: r.positions.map(p => ({
          ...p,
          rtlCoordinate: {
            leftTop: [x, p.coordinate.leftTop[1]],
            leftBottom: [x, p.coordinate.leftBottom[1]],
            rightTop: [x + r.width[idx], p.coordinate.rightTop[1]],
            rightBottom: [x + r.width[idx], p.coordinate.rightBottom[1]]
          }
        })),
        x
      } as ITextRenderItem

      offsetX += r.width.reduce((prev, curr) => {
        return prev + curr
      })
      return res
    })

    // console.log(this.textRenderQueue)
  }

  public getTextRenderQueue() {
    return this.textRenderQueue
  }

  private _isSpecialCharacter(c: string) {
    // TODO 对特殊单位的符号要进行处理
    return ['℃'].includes(c)
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
    this.ctx.save()
    this.textRenderQueue.forEach(({ value, color, style, x, y }) => {
      this.ctx.font = style
      this.ctx.fillStyle = color || this.options.defaultColor
      this.ctx.fillText(value, x, y)
    })
    this.ctx.restore()
  }
}

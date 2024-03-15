import { TextDecorationStyle } from '../dataset/enum/Text'
import { IRowElement } from './Row'

export interface ITextMetrics {
  width: number
  actualBoundingBoxAscent: number
  actualBoundingBoxDescent: number
  actualBoundingBoxLeft: number
  actualBoundingBoxRight: number
  fontBoundingBoxAscent: number
  fontBoundingBoxDescent: number
}

export interface ITextDecoration {
  style?: TextDecorationStyle
}

export interface ITextRenderItem {
  value: string
  elements: IRowElement[]
  width: number[]
  style: string
  color?: string
  x: number
  y: number
}

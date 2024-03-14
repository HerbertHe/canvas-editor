import { TextDecorationStyle } from '../dataset/enum/Text'

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
  width: number[]
  style: string
  color?: string
  x: number
  y: number
}

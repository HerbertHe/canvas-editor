import { TextDecorationStyle } from '../dataset/enum/Text'
import { IElementPosition } from './Element'

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
  positions: IElementPosition[]
  width: number[]
  style: string
  color?: string
  x: number
  y: number
}

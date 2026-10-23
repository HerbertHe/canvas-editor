import type { PackedLayout } from './layoutCodec'
import type { EditDocument, EditTransaction } from '../../history/EditTransaction'
import type { IEditorFontFace } from '../../../interface/TextEngine'
import type { NativeParagraphInput, NativeParagraphLayout } from '../../text-engine/layout/TextLayoutService'

export interface LayoutVersion {
  sessionId: number
  requestId: number
  documentRevision: number
  fontRevision: number
  constraintsRevision: number
}
export type LayoutRequest = LayoutVersion & ({
  type: 'init'
  model: EditDocument
  fonts: IEditorFontFace[]
  defaultFont: string
} | {
  type: 'edit'
  transaction: EditTransaction
} | {
  type: 'edits'
  transactions: EditTransaction[]
} | {
  type: 'layout'
  inputs: NativeParagraphInput[]
  simpleFlow?: boolean
  transferResults?: boolean
} | { type: 'recycle'; buffers: ArrayBuffer[] } | { type: 'inspect' | 'dispose' })

export interface LayoutResponse extends LayoutVersion {
  type: 'ack' | 'layout' | 'mirror' | 'error'
  layouts?: NativeParagraphLayout[]
  inputs?: NativeParagraphInput[]
  packed?: PackedLayout[]
  poolBytes?: number
  model?: EditDocument
  error?: string
  needsResync?: boolean
  computeMs?: number
  estimatedBytes?: number
}

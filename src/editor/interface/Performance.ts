import type { ILabOption } from './Editor'
import type { EditorRuntimeState } from './Runtime'

export type WorkerFallbackReason = 'dependencies' | 'unavailable' |
  'composition' | 'scope' | 'edit' | 'size' | 'error' | 'deadline'

/** Detached diagnostics; contains no text, font binaries or live model objects. */
export interface EditorPerformanceDiagnostics {
  schemaVersion: 1
  state: EditorRuntimeState
  options: Required<ILabOption>
  worker: {
    ready: boolean
    pending: boolean
    requests: number
    waiting: boolean
    queuedBytes: number
    bufferedEdits: number
    faults: number
    needsResync: boolean
    counters: Record<string, number>
    fallbackReasons: Record<WorkerFallbackReason, number>
  }
  flow: Record<string, number>
  tables: Record<string, number>
  placements: Record<string, number>
  paths: Record<string, number>
  runs: Record<string, number>
  utilityWorkers: { unavailable: number; fallbacks: number }
  pages: { observed: number; visible: number; dirty: number }
  composition: { active: boolean; generation: number; sequence: number;
    local: boolean; received?: number; merged?: number; flushed?: number;
    previews?: number; fallbacks?: number;
    previewWorker?: { submitted: number; committed: number; stale: number;
      fallbacks: number; deadlines: number; pending: boolean };
    previewWork?: { paragraphElements: number; windowElements: number;
      laidOutLines: number; checkedLines: number; reusedLines: number;
      skippedLines: number } }
}

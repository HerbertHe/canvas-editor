import type { Draw } from '../draw/Draw'

export interface DeltaHistoryEdit {
  undo: () => void
  redo: () => void
  kind: string
  scope: string
  from: number
  to: number
  time: number
  bytes: number
  groupable: boolean
}
type Snapshot = { type: 'snapshot'; restore: Function; bytes: number }
type Delta = { type: 'delta'; edits: DeltaHistoryEdit[]; bytes: number }
type Entry = Snapshot | Delta

/** Snapshot checkpoints and reversible edits share one ordered undo chain. */
export class HistoryManager {
  private undoStack: Entry[] = []
  private redoStack: Entry[] = []
  private maxRecordCount: number
  private groupOpen = false
  private byteBudget: number

  constructor(private draw: Draw) {
    this.maxRecordCount = draw.getOptions().historyMaxRecordCount + 1
    this.byteBudget = draw.getOptions().lab?.historyByteBudget || 16 * 1024 * 1024
  }

  closeGroup() { this.groupOpen = false }

  private replay(action: () => void, maintenance = false, source: 'undo' | 'redo' = 'undo') {
    if (this.draw.replayHistoryBatch) this.draw.replayHistoryBatch(action, maintenance, source)
    else action()
  }

  private restoreAt(index: number) {
    let checkpoint = index
    while (checkpoint >= 0 && this.undoStack[checkpoint].type !== 'snapshot') checkpoint--
    if (checkpoint < 0) throw new Error('History checkpoint missing')
    for (let i = checkpoint; i <= index; i++) {
      const entry = this.undoStack[i]
      if (entry.type === 'snapshot') entry.restore()
      else for (const edit of entry.edits) edit.redo()
    }
  }

  undo() {
    this.closeGroup()
    if (this.undoStack.length <= 1) return
    const entry = this.undoStack.pop()!
    this.redoStack.push(entry)
    this.replay(() => {
      if (entry.type === 'delta') {
        try {
          for (const edit of [...entry.edits].reverse()) edit.undo()
        } catch {
          // Explicit opaque, non-history changes can replace a scope.
          this.restoreAt(this.undoStack.length - 1)
        }
      } else this.restoreAt(this.undoStack.length - 1)
    }, false, 'undo')
  }

  redo() {
    this.closeGroup()
    const entry = this.redoStack.pop()
    if (!entry) return
    this.undoStack.push(entry)
    this.replay(() => {
      if (entry.type === 'snapshot') entry.restore()
      else for (const edit of entry.edits) edit.redo()
    }, false, 'redo')
  }

  execute(restore: Function) {
    if (this.maxRecordCount <= 1) return
    this.closeGroup()
    this.redoStack = []
    const bytes = (restore as { estimatedBytes?: number }).estimatedBytes || 0
    this.undoStack.push({ type: 'snapshot', restore, bytes })
    this.trim()
  }

  executeDelta(edit: DeltaHistoryEdit) {
    if (this.maxRecordCount <= 1) return
    if (!this.undoStack.length) throw new Error('Delta requires a baseline checkpoint')
    const previous = this.undoStack.at(-1)
    const last = previous?.type === 'delta' ? previous.edits.at(-1) : undefined
    if (this.groupOpen && edit.groupable && last?.groupable &&
      edit.kind === last.kind && edit.scope === last.scope &&
      edit.time - last.time <= 400 && edit.time >= last.time &&
      edit.from === last.to && previous?.type === 'delta') {
      previous.edits.push(edit)
      previous.bytes += edit.bytes
    } else this.undoStack.push({ type: 'delta', edits: [edit], bytes: edit.bytes })
    this.groupOpen = edit.groupable
    this.redoStack = []
    this.trim()
  }

  private trim() {
    const total = () => this.undoStack.reduce((n, entry) => n + entry.bytes, 0)
    while (this.undoStack.length > this.maxRecordCount ||
      (this.draw.getOptions().lab?.transactionHistory &&
        total() > this.byteBudget && this.undoStack.length > 1)) {
      if (this.undoStack[1]?.type === 'delta') {
        const current = this.draw.createHistorySnapshot()
        let checkpoint: Function | undefined
        this.replay(() => {
          this.restoreAt(1)
          checkpoint = this.draw.createHistorySnapshot()
          current()
        }, true)
        const bytes = (checkpoint as { estimatedBytes?: number }).estimatedBytes || 0
        this.undoStack.splice(0, 2, { type: 'snapshot', restore: checkpoint!, bytes })
      } else this.undoStack.shift()
    }
    // Periodic checkpoints bound barrier reconstruction to <= 32 groups.
    if (this.undoStack.length > 1 && this.undoStack.length % 32 === 0 &&
      this.undoStack.at(-1)?.type === 'delta') {
      const restore = this.draw.createHistorySnapshot()
      this.undoStack[this.undoStack.length - 1] = { type: 'snapshot', restore,
        bytes: (restore as { estimatedBytes?: number }).estimatedBytes || 0 }
      this.closeGroup()
    }
  }

  getStats() {
    return { undo: this.undoStack.length, redo: this.redoStack.length,
      bytes: [...this.undoStack, ...this.redoStack].reduce((n, e) => n + e.bytes, 0) }
  }

  isCanUndo() { return this.undoStack.length > 1 }
  isCanRedo() { return !!this.redoStack.length }
  isStackEmpty() { return !this.undoStack.length && !this.redoStack.length }
  recovery() { this.undoStack = []; this.redoStack = []; this.closeGroup() }
  popUndo() {
    this.closeGroup()
    const entry = this.undoStack.pop()
    return entry?.type === 'snapshot' ? entry.restore : entry?.edits.at(-1)?.redo
  }
}

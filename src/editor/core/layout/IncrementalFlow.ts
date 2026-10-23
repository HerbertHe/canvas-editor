import type { LayoutNode } from '../../interface/Layout'
import type { LayoutRow } from '../../interface/LayoutRow'
import type { ParagraphRecord } from './ParagraphIndex'
import type { DocumentFlow } from './DocumentFlow'
import { captureFlow, checkpointMismatch, restoreFlow, sameFlow } from './FlowCheckpoint'
import type { FlowCheckpoint } from './FlowCheckpoint'
import { projectTextLine, projectLayout } from './relativeLayout'
import type { LayoutResult } from '../text-engine/types'

interface Entry {
  revision: string
  start: number
  rowIndex: number
  input: FlowCheckpoint
  output: FlowCheckpoint
  rows: LayoutRow[]
  nodes: LayoutNode[]
  compatibility?: LayoutResult
}

export interface LayoutChangeSet {
  scope: string
  changedParagraphs: string[]
  indexShifts: { paragraphId: string; from: number; to: number }[]
  documentRevision: number
  geometryRevision: number
  fontRevision: number
  constraintsRevision: number
  full: boolean
  firstPage: number
  changedPages: number[]
  removedPages: number[]
  addedPages: number[]
  reusedParagraphs: string[]
}

/** Exact convergence only. Unsupported hosts never enter this cache. */
export class IncrementalFlow {
  private entries = new Map<string, Entry>()
  private next = new Map<string, Entry>()
  readonly stats = { computed: 0, reused: 0, shifted: 0 }
  reused: string[] = []
  changed: string[] = []
  shifts: LayoutChangeSet['indexShifts'] = []

  begin() {
    this.next.clear()
    this.reused = []
    this.changed = []
    this.shifts = []
  }
  clear() { this.entries.clear(); this.begin() }
  end() { this.entries = this.next; this.next = new Map() }

  paragraph(
    record: ParagraphRecord,
    start: number,
    rowIndex: number,
    flow: DocumentFlow,
    dependencies: string,
    compute: () => Pick<Entry, 'rows' | 'nodes' | 'compatibility'>,
    dirty = false
  ) {
    const revision = [record.content, record.metrics, record.paint].join(':')
    const previous = this.entries.get(record.id)
    const input = captureFlow(flow, record.id, dependencies)
    let result: Pick<Entry, 'rows' | 'nodes' | 'compatibility'>
    if (!dirty && previous && previous.revision === revision &&
      !checkpointMismatch(previous.input, flow, dependencies) &&
      sameFlow(previous.input.state, flow.state)) {
      restoreFlow(flow, previous.output, dependencies)
      const delta = start - previous.start
      const rowDelta = rowIndex - previous.rowIndex
      result = !delta && !rowDelta ? previous : {
        rows: previous.rows.map(row => {
          const line = projectTextLine(row.nativeLine!, delta)
          return { ...row, nativeLine: line, node: line,
            startIndex: row.startIndex + delta,
            rowIndex: row.rowIndex + rowDelta,
            sourceIndices: row.sourceIndices?.map(index => index + delta) }
        }),
        compatibility: previous.compatibility && projectLayout({
          lines: [], shaped: previous.compatibility
        }, delta, { documentRevision: 0, fontRevision: 0 }).shaped,
        nodes: previous.nodes.map(node => {
          if (node.kind !== 'textLine') throw new Error('Unsupported cached node')
          return projectTextLine(node, delta)
        })
      }
      this.stats.reused++
      if (delta || rowDelta) this.stats.shifted++
      if (delta) this.shifts.push({ paragraphId: record.id, from: previous.start, to: start })
      this.reused.push(record.id)
    } else {
      result = compute()
      this.stats.computed++
      this.changed.push(record.id)
    }
    this.next.set(record.id, { ...result, start, rowIndex, revision, input,
      output: captureFlow(flow, record.id, dependencies) })
    return result
  }
}

export function changedLayoutPages(
  previous: LayoutRow[][],
  current: LayoutRow[][],
  reusedParagraphs: string[],
  full: boolean,
  metadata: Pick<LayoutChangeSet, 'scope' | 'changedParagraphs' | 'indexShifts' |
    'documentRevision' | 'geometryRevision' | 'fontRevision' | 'constraintsRevision'>
): LayoutChangeSet {
  const changedPages = current.flatMap((rows, page) => {
    const old = previous[page]
    return !old || rows.length !== old.length ||
      rows.some((row, i) => row !== old[i]) ? [page] : []
  })
  return { ...metadata, full, changedPages,
    firstPage: full ? 0 : changedPages[0] ?? current.length,
    removedPages: previous.flatMap((_, i) => i >= current.length ? [i] : []),
    addedPages: current.flatMap((_, i) => i >= previous.length ? [i] : []),
    reusedParagraphs }
}

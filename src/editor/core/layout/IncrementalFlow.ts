import type { LayoutNode } from '../../interface/Layout'
import type { LayoutRow } from '../../interface/LayoutRow'
import type { ParagraphRecord } from './ParagraphIndex'
import type { DocumentFlow, FlowPlacement } from './DocumentFlow'
import { captureFlow, checkpointMismatch, restoreFlow, sameFlow } from './FlowCheckpoint'
import type { FlowCheckpoint } from './FlowCheckpoint'
import { mapView, projectTextLine, projectLayout, translateTextLineView } from './relativeLayout'
import type { LayoutResult } from '../text-engine/types'

const indexOrigins = new WeakMap<number[], { base: number[]; delta: number }>()
function shiftIndices(indices: number[] | undefined, shift: number) {
  if (!indices || !shift) return indices
  const origin = indexOrigins.get(indices) || { base: indices, delta: 0 }
  const delta = origin.delta + shift
  const result = mapView(origin.base, index => index + delta)
  indexOrigins.set(result, { base: origin.base, delta })
  return result
}

interface Entry {
  revision: string
  start: number
  rowIndex: number
  input: FlowCheckpoint
  output: FlowCheckpoint
  rows: LayoutRow[]
  nodes: LayoutNode[]
  compatibility?: LayoutResult
  pages: FlowCheckpoint[]
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
  readonly stats = { computed: 0, reused: 0, shifted: 0, reflowed: 0,
    checked: 0, batchChecked: 0, batchReused: 0, checkpointChecks: 0 }
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

  private project(previous: Entry, start: number, rowIndex: number,
    lazy = false, includeNodes = true) {
    const delta = start - previous.start
    const rowDelta = rowIndex - previous.rowIndex
    if (delta) this.shifts.push({ paragraphId: previous.input.nodeId,
      from: previous.start, to: start })
    if (delta || rowDelta) this.stats.shifted++
    return !delta && !rowDelta ? previous : { ...previous, start, rowIndex,
      rows: previous.rows.map(row => {
        const line = projectTextLine(row.nativeLine!, delta)
        return { ...row, nativeLine: line, node: line,
          startIndex: row.startIndex + delta,
          rowIndex: row.rowIndex + rowDelta,
          sourceIndices: lazy ? shiftIndices(row.sourceIndices, delta)
            : row.sourceIndices?.map(index => index + delta) }
      }),
      compatibility: previous.compatibility && projectLayout({
        lines: [], shaped: previous.compatibility
      }, delta, { documentRevision: 0, fontRevision: 0 }).shaped,
      nodes: includeNodes ? previous.nodes.map(node => {
        if (node.kind !== 'textLine') throw new Error('Unsupported cached node')
        return projectTextLine(node, delta)
      }) : [] }
  }

  /** Keep line breaking only when every new line interval matches the cached one. */
  private reflow(previous: Entry, start: number, rowIndex: number, flow: DocumentFlow) {
    if (flow.exclusions.length || !previous.rows.length || previous.rows.some(row =>
      !row.nativeLine || row.nativeLine.marker || !row.flow || row.isSurround)) return null
    const cursor = flow.fork()
    const placements: FlowPlacement[] = []
    for (const row of previous.rows) {
      const line = row.nativeLine!
      const placed = cursor.place(line.contentHeight, line.spacingBefore,
        line.spacingAfter, 0, line.direction === 'rtl')
      if (placed.width !== row.flow!.width || placed.x !== row.flow!.x ||
        (placed.indent || 0) !== (row.flow!.indent || 0)) return null
      placements.push(placed)
    }
    const projected = this.project(previous, start, rowIndex, true, false)
    const rows = projected.rows.map((row, index) => ({ ...row,
      flow: placements[index], columnIndex: placements[index].columnIndex }))
    const nodes = rows.map((row, index) => {
      const line = row.nativeLine!
      const placement = placements[index]
      const page = cursor.page(placement.pageNo, placement.direction)
      const x = page.left + page.columns[placement.columnIndex] +
        (line.direction === 'ltr' ? placement.indent || 0 : 0)
      const y = placement.y + line.spacingBefore - line.rect.y
      return { ...translateTextLineView(line, x, y), placement: {
        pageNo: placement.pageNo, columnIndex: placement.columnIndex
      } }
    })
    flow.state = { ...cursor.state }
    return { ...projected, rows, nodes }
  }

  /** Validate metadata and every distinct page before accepting an entire run. */
  reuseRange(entries: { record: ParagraphRecord; start: number; end: number }[],
    flow: DocumentFlow, dependencies: string, rowIndex: number, from = 0) {
    if (from >= entries.length) return []
    const pages = new Set<string>()
    let state = flow.state
    const cached: Entry[] = []
    for (let i = from; i < entries.length; i++) {
      const entry = entries[i]
      this.stats.batchChecked++
      const previous = this.entries.get(entry.record.id)
      const revision = [entry.record.content, entry.record.metrics, entry.record.paint].join(':')
      if (!previous || previous.revision !== revision ||
        previous.input.dependencies !== dependencies ||
        !sameFlow(previous.input.state, state)) return null
      for (const checkpoint of previous.pages) {
        const key = `${checkpoint.state.pageNo}:${checkpoint.state.direction}`
        if (pages.has(key)) continue
        pages.add(key)
        this.stats.checkpointChecks++
        if (checkpointMismatch(checkpoint, flow, dependencies)) return null
      }
      cached.push(previous)
      state = previous.output.state
    }
    const result: Entry[] = []
    for (let i = from; i < entries.length; i++) {
      const entry = entries[i]
      const value = this.project(cached[i - from], entry.start, rowIndex, true)
      this.next.set(entry.record.id, value)
      this.reused.push(entry.record.id)
      result.push(value)
      rowIndex += value.rows.length
    }
    restoreFlow(flow, cached[cached.length - 1].output, dependencies)
    this.stats.reused += entries.length - from
    this.stats.batchReused += entries.length - from
    return result
  }

  private matchesPages(previous: Entry, flow: DocumentFlow,
    dependencies: string, complete: boolean) {
    if (!complete) {
      this.stats.checkpointChecks++
      return !checkpointMismatch(previous.input, flow, dependencies)
    }
    const seen = new Set<string>()
    for (const checkpoint of complete ? previous.pages : [previous.input]) {
      const key = `${checkpoint.state.pageNo}:${checkpoint.state.direction}`
      if (seen.has(key)) continue
      seen.add(key)
      this.stats.checkpointChecks++
      if (checkpointMismatch(checkpoint, flow, dependencies)) return false
    }
    return true
  }

  paragraph(
    record: ParagraphRecord,
    start: number,
    rowIndex: number,
    flow: DocumentFlow,
    dependencies: string,
    compute: () => Pick<Entry, 'rows' | 'nodes' | 'compatibility'>,
    dirty = false,
    capturePages = false
  ) {
    this.stats.checked++
    const revision = [record.content, record.metrics, record.paint].join(':')
    const previous = this.entries.get(record.id)
    const input = captureFlow(flow, record.id, dependencies)
    let result: Pick<Entry, 'rows' | 'nodes' | 'compatibility'>
    if (!dirty && previous && previous.revision === revision &&
      this.matchesPages(previous, flow, dependencies, capturePages) &&
      sameFlow(previous.input.state, flow.state)) {
      restoreFlow(flow, previous.output, dependencies)
      result = this.project(previous, start, rowIndex, capturePages)
      this.stats.reused++
      this.reused.push(record.id)
    } else {
      const reflowed = capturePages && !dirty && previous &&
        previous.revision === revision && previous.input.dependencies === dependencies
        ? this.reflow(previous, start, rowIndex, flow) : null
      if (reflowed) {
        result = reflowed
        this.stats.reflowed++
      } else {
        result = compute()
        this.stats.computed++
      }
      this.changed.push(record.id)
    }
    const output = captureFlow(flow, record.id, dependencies)
    let pages = [input, output]
    if (capturePages && result.rows.length > 1) {
      const pageMap = new Map<string, FlowCheckpoint>()
      for (const checkpoint of pages)
        pageMap.set(`${checkpoint.state.pageNo}:${checkpoint.state.direction}`, checkpoint)
      for (const row of result.rows) {
        if (!row.flow) continue
        const key = `${row.flow.pageNo}:${row.flow.direction}`
        if (!pageMap.has(key)) {
          const page = flow.page(row.flow.pageNo, row.flow.direction)
          pageMap.set(key, { ...input, state: { ...row.flow },
            page: { ...page, columns: [...page.columns] } })
        }
      }
      pages = [...pageMap.values()]
    }
    this.next.set(record.id, { ...result, start, rowIndex, revision, input,
      output, pages })
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

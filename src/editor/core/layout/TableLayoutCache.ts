import type { IElement } from '../../interface/Element'
import type { LayoutNode, LayoutRevision } from '../../interface/Layout'
import type { LayoutRow } from '../../interface/LayoutRow'
import { getSlimCloneElementList, matchesSlimScalarElements } from '../../utils/element'
import { projectTextLine } from './relativeLayout'
import { getCellContentWidth, layoutTable } from './TableLayout'
import type { CellContentLayout, TableCellInput, TableLayoutInput,
  TableLayoutResult } from './TableLayout'

type CellLayout = { rows: LayoutRow[]; nodes: LayoutNode[] }
type ScalarSnapshot = { elements: IElement[]; keyCounts: number[] }
type CellEntry = { key: string; value: CellLayout; elements: IElement[]
  bytes: number; lastPass: number; dependencies: string; snapshot?: ScalarSnapshot }

/** Bounded canonical cell contents; table geometry itself has weak ownership. */
export class TableLayoutCache {
  private cells = new Map<IElement[], CellEntry>()
  private tables = new WeakMap<IElement, { key: string; value: TableLayoutResult }>()
  private bytes = 0
  private pass = 0
  private evictionCandidates: IElement[][] | null = null
  readonly stats = { checkedCells: 0, computedCells: 0, reusedCells: 0,
    computedRows: 0, reusedRows: 0, inputElements: 0, bytes: 0,
    entries: 0, admissionSkips: 0, evictions: 0, scalarHits: 0, signatures: 0 }

  constructor(private maxEntries = 1024, private byteBudget = 16 * 1024 * 1024) {}

  beginPass() {
    this.pass++
    this.evictionCandidates = null
    Object.assign(this.stats, { checkedCells: 0, computedCells: 0, reusedCells: 0,
      computedRows: 0, reusedRows: 0, inputElements: 0,
      admissionSkips: 0, evictions: 0, scalarHits: 0, signatures: 0 })
  }

  clear() {
    this.cells.clear()
    this.tables = new WeakMap()
    this.bytes = this.stats.bytes = 0
    this.stats.entries = 0
    this.pass = 0
    this.evictionCandidates = null
  }

  cell(elements: IElement[], dependencies: string, revision: LayoutRevision,
    compute: () => CellLayout): CellLayout {
    this.stats.checkedCells++
    this.stats.inputElements += elements.length
    const cached = this.cells.get(elements)
    const sameElements = !!cached && cached.elements.length === elements.length &&
      cached.elements.every((element, i) => element === elements[i])
    const scalarHit = sameElements && cached.dependencies === dependencies &&
      !!cached.snapshot && matchesSlimScalarElements(
        elements, cached.snapshot.elements, cached.snapshot.keyCounts
      )
    // Containers recurse normally so a changed nested scope cannot hide behind
    // an unchanged outer array. Stateful controls/areas/objects also run normally.
    const eligible = !scalarHit && elements.length <= 4096 && elements.every(e =>
      (!e.type || e.type === 'text') && !e.controlId && !e.control &&
      !e.listId && !e.areaId && !e.area && !e.groupIds?.length &&
      !e.hide && !e.trace?.length && !e.imgDisplay && !e.titleId && !e.title)
    let key = ''
    let model: IElement[] | undefined
    if (eligible) {
      this.stats.signatures++
      try {
        model = getSlimCloneElementList(elements)
        key = dependencies + ':' + JSON.stringify(model)
      }
      catch { /* Cyclic extension metadata is not a cacheable text cell. */ }
    }
    if (cached && (scalarHit ||
      (!cached.snapshot && sameElements && key && cached.key === key))) {
      this.stats.reusedCells++
      if (scalarHit) this.stats.scalarHits++
      cached.lastPass = this.pass
      this.cells.delete(elements)
      this.cells.set(elements, cached)
      const project = (node: LayoutNode) => node.kind === 'textLine'
        ? projectTextLine(node, 0, revision) : node
      return {
        rows: cached.value.rows.map(row => {
          const nativeLine = row.nativeLine && projectTextLine(row.nativeLine, 0, revision)
          return { ...row, nativeLine,
            node: row.node === row.nativeLine ? nativeLine : row.node && project(row.node) }
        }),
        nodes: cached.value.nodes.map(project)
      }
    }
    this.stats.computedCells++
    const value = compute()
    if (cached) { this.cells.delete(elements); this.bytes -= cached.bytes }
    if (key && model && value.nodes.every(n => n.kind === 'textLine') &&
      value.rows.every(row => !!row.nativeLine)) {
      const snapshot = model.every(element => Object.values(element).every(item =>
        item === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof item)
      )) ? { elements: model, keyCounts: model.map(e => Object.keys(e).length) } : undefined
      const snapshotBytes = snapshot?.keyCounts.reduce((sum, count) =>
        sum + 32 + 16 * count, 0) || 0
      const bytes = key.length * 2 + value.rows.reduce((sum, row) => sum + 512 +
        row.nativeLine!.glyphs.length * 512 + row.nativeLine!.carets.length * 256, 0) +
        snapshotBytes
      this.admit(elements, { key, value, bytes, elements: [...elements],
        lastPass: this.pass, dependencies, snapshot })
    }
    this.stats.bytes = this.bytes
    this.stats.entries = this.cells.size
    return value
  }

  private admit(elements: IElement[], entry: CellEntry) {
    let bytes = this.bytes + entry.bytes
    let count = this.cells.size + 1
    if (bytes <= this.byteBudget && count <= this.maxEntries) {
      this.cells.set(elements, entry)
      this.bytes += entry.bytes
      return
    }
    const victims: IElement[][] = []
    if (entry.bytes <= this.byteBudget) {
      this.evictionCandidates ||= [...this.cells].filter(([, value]) =>
        value.lastPass < this.pass - 1).map(([key]) => key)
      for (const key of this.evictionCandidates) {
        const value = this.cells.get(key)
        if (!value) continue
        if (bytes <= this.byteBudget && count <= this.maxEntries) break
        // A sequential table scan must not evict cells it has yet to reuse.
        // Protect the previous pass as well as the current one; old documents
        // become eligible after a full pass without access, so the cache adapts.
        if (value.lastPass >= this.pass - 1) continue
        victims.push(key)
        bytes -= value.bytes
        count--
      }
      if (bytes <= this.byteBudget && count <= this.maxEntries) {
        for (const key of victims) {
          this.bytes -= this.cells.get(key)!.bytes
          this.cells.delete(key)
          this.stats.evictions++
        }
        this.cells.set(elements, entry)
        this.bytes += entry.bytes
        return
      }
    }
    // Admission is all-or-nothing: failed candidates leave hot entries intact.
    this.stats.admissionSkips++
  }

  table(element: IElement, input: TableLayoutInput,
    computeCell: (cell: TableCellInput, width: number) => CellContentLayout) {
    const signature = (columns = input.columns) => JSON.stringify({ ...input,
      columns, revision: { ...input.revision, documentRevision: 0 } })
    const old = this.tables.get(element)
    let prepared: Map<string, CellContentLayout> | undefined
    if (old?.key === signature()) {
      const contents = input.rows.flatMap(row => row.cells).map((cell, i) =>
        input.hidden ? { nodes: [], height: 0 } : computeCell(cell,
          getCellContentWidth(old.value.fragment.cells[i].rect.width, input.padding)))
      if (contents.every((cell, i) => cell.height === old.value.contentHeights[i])) {
        this.stats.reusedRows += input.rows.length
        return { ...old.value, fragment: { ...old.value.fragment,
          source: { ...input.source }, revision: { ...input.revision },
          cells: old.value.fragment.cells.map((cell, i) =>
            ({ ...cell, children: contents[i].nodes })) } }
      }
      prepared = new Map(input.rows.flatMap(row => row.cells)
        .map((cell, i) => [cell.id, contents[i]]))
    }
    this.stats.computedRows += input.rows.length
    const result = layoutTable(input, (cell, width) =>
      prepared?.get(cell.id) || computeCell(cell, width))
    // Retain geometry only, never an old version of the entire cell content tree.
    this.tables.set(element, { key: signature(result.columns), value: { ...result,
      fragment: { ...result.fragment,
        cells: result.fragment.cells.map(cell => ({ ...cell, children: [] })) } } })
    return result
  }
}

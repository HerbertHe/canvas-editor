import type { IElement } from '../../interface/Element'
import { ZERO } from '../../dataset/constant/Common'
import { isParagraphObject } from '../text-engine-host/ElementBridge'
import type { ParagraphSpan } from '../text-engine-host/ElementBridge'

export interface ParagraphRecord {
  id: string
  elements: IElement[]
  plain: boolean
  editable: boolean
  content: number
  metrics: number
  paint: number
  scanned?: { key: string; paragraphs: ParagraphSpan[] }
  scans?: Map<string, ParagraphSpan[]>
}
interface Node {
  record: ParagraphRecord
  priority: number
  weight: number
  left: Node | null
  right: Node | null
  parent: Node | null
}
const weight = (node: Node | null): number => node?.weight || 0
function refresh(node: Node) {
  node.weight = weight(node.left) + node.record.elements.length + weight(node.right)
  if (node.left) node.left.parent = node
  if (node.right) node.right.parent = node
  return node
}
function merge(a: Node | null, b: Node | null): Node | null {
  if (!a || !b) {
    const result = a || b
    if (result) result.parent = null
    return result
  }
  if (a.priority < b.priority) {
    a.right = merge(a.right, b)
    refresh(a)
    a.parent = null
    return a
  }
  b.left = merge(a, b.left)
  refresh(b)
  b.parent = null
  return b
}
function split(node: Node | null, offset: number): [Node | null, Node | null] {
  if (!node) return [null, null]
  const left = weight(node.left)
  if (offset <= left) {
    const [a, b] = split(node.left, offset)
    node.left = b
    refresh(node).parent = null
    return [a, node]
  }
  const end = left + node.record.elements.length
  if (offset < end) throw new Error('Paragraph split must be at a boundary')
  const [a, b] = split(node.right, offset - end)
  node.right = a
  refresh(node).parent = null
  return [node, b]
}
function visit(node: Node | null, fn: (node: Node) => void) {
  if (!node) return
  visit(node.left, fn)
  fn(node)
  visit(node.right, fn)
}
function chunks(elements: IElement[]) {
  const result: IElement[][] = []
  let current: IElement[] = []
  const flush = () => {
    if (current.length) result.push(current)
    current = []
  }
  for (const element of elements) {
    if (current.length && element.areaId !== current.at(-1)?.areaId) flush()
    if (isParagraphObject(element)) {
      flush()
      result.push([element])
    } else {
      if (element.value === ZERO) flush()
      current.push(element)
    }
  }
  flush()
  return result
}

/** An implicit length treap. Editing a paragraph never shifts suffix records. */
export class ParagraphIndex {
  private root: Node | null = null
  private members = new WeakMap<IElement, Node>()
  private random = 0x12345678
  revision = 1
  readonly stats = { scannedElements: 0, editedElements: 0 }

  constructor(
    readonly elements: IElement[],
    private allocate: (anchor: IElement) => string,
    private remember?: (element: IElement, index: ParagraphIndex) => void
  ) {
    this.root = this.build(chunks(elements), [])
  }

  private build(groups: IElement[][], old: ParagraphRecord[]) {
    let root: Node | null = null
    const used = new Set<ParagraphRecord>()
    for (const elements of groups) {
      const same = old.find(r => r.elements.length === elements.length &&
        r.elements.every((e, i) => e === elements[i]))
      const anchor = old.find(r => !used.has(r) && elements.includes(r.elements[0]))
      const previous = same || anchor
      if (previous) used.add(previous)
      const record = same || {
        id: previous?.id || this.allocate(elements[0]), elements,
        plain: elements.every(element => (!element.type || element.type === 'text') &&
          !element.controlId && !element.control && !element.areaId && !element.area),
        editable: elements.every(element => (!element.type || element.type === 'text') &&
          !element.listId && !element.controlId && !element.control && !element.titleId &&
          !element.title && !element.areaId && !element.area && !element.groupIds?.length &&
          !element.hide && !element.trace?.length),
        content: (previous?.content || 0) + 1,
        metrics: previous?.metrics || 0, paint: previous?.paint || 0
      }
      this.random ^= this.random << 13
      this.random ^= this.random >>> 17
      this.random ^= this.random << 5
      const node: Node = { record, priority: this.random >>> 0,
        weight: elements.length, left: null, right: null, parent: null }
      for (const element of elements) {
        this.members.set(element, node)
        this.remember?.(element, this)
      }
      root = merge(root, node)
    }
    return root
  }

  locate(index: number) {
    let node = this.root
    let base = 0
    const at = Math.max(0, Math.min(index, weight(node) - 1))
    while (node) {
      const start = base + weight(node.left)
      const end = start + node.record.elements.length
      if (at < start) node = node.left
      else if (at >= end) { base = end; node = node.right }
      else return { record: node.record, start, end }
    }
    return undefined
  }

  between(from: number, to: number) {
    const result: ParagraphRecord[] = []
    const walk = (node: Node | null, base: number) => {
      if (!node) return
      const start = base + weight(node.left)
      const end = start + node.record.elements.length
      if (from < start) walk(node.left, base)
      if (from < end && to > start) result.push(node.record)
      if (to > end) walk(node.right, end)
    }
    walk(this.root, 0)
    return result
  }

  entries() {
    const result: { record: ParagraphRecord; start: number; end: number }[] = []
    let start = 0
    visit(this.root, node => {
      const end = start + node.record.elements.length
      result.push({ record: node.record, start, end })
      start = end
    })
    return result
  }

  /** Capture before a splice; finish after its actual, possibly filtered edit. */
  capture(start: number, count: number) {
    const length = this.elements.length
    const from = this.locate(start - 1)?.start || 0
    const end = this.locate(start + count)?.end || length
    return () => {
      this.revision++
      const delta = this.elements.length - length
      const [head, rest] = split(this.root, from)
      const [middle, tail] = split(rest, end - from)
      const old: ParagraphRecord[] = []
      visit(middle, node => {
        old.push(node.record)
        for (const element of node.record.elements) this.members.delete(element)
      })
      const changed = this.elements.slice(from, end + delta)
      this.stats.editedElements += changed.length
      const replacement = this.build(chunks(changed), old)
      this.root = merge(merge(head, replacement), tail)
      return old.map(record => record.id)
    }
  }

  location(element: IElement) {
    let node = this.members.get(element)
    if (!node) return undefined
    const record = node.record
    let start = weight(node.left)
    while (node.parent) {
      if (node === node.parent.right)
        start += weight(node.parent.left) + node.parent.record.elements.length
      node = node.parent
    }
    return { record, start, end: start + record.elements.length }
  }

  touch(element: IElement, kind: 'content' | 'metrics' | 'paint') {
    const node = this.members.get(element)
    if (!node) return false
    this.revision++
    node.record[kind]++
    node.record.scanned = undefined
    node.record.scans = undefined
    return true
  }

  scan(
    key: string,
    scan: (elements: IElement[]) => ParagraphSpan[]
  ) {
    return this.entries().flatMap(({ record, start }) => {
      let paragraphs = record.plain ? record.scans?.get(key) : undefined
      if (!paragraphs) {
        this.stats.scannedElements += record.elements.length
        paragraphs = scan(record.elements)
        if (record.plain) {
          const scans = record.scans || new Map<string, ParagraphSpan[]>()
          scans.set(key, paragraphs)
          if (scans.size > 4) scans.delete(scans.keys().next().value!)
          record.scans = scans
        }
      }
      record.scanned = { key, paragraphs }
      return record.scanned!.paragraphs.map(paragraph => ({
        ...paragraph, startIndex: paragraph.startIndex + start,
        endIndex: paragraph.endIndex + start,
        spans: paragraph.spans.map(span => ({ ...span,
          logicalIndex: span.logicalIndex + start,
          logicalIndices: span.logicalIndices?.map(i => i + start)
        }))
      }))
    })
  }
}

/** Internal identity never appears in IElement or the exported document. */
export class ParagraphDirectory {
  private indices = new WeakMap<IElement[], ParagraphIndex>()
  private ids = new WeakMap<IElement, string>()
  private sequence = 0
  private owners = new WeakMap<IElement, ParagraphIndex>()

  owner(element: IElement) { return this.owners.get(element) }

  get(elements: IElement[]) {
    let index = this.indices.get(elements)
    if (!index) {
      index = new ParagraphIndex(elements, anchor => {
        let id = this.ids.get(anchor)
        if (!id) { id = `paragraph-${++this.sequence}`; this.ids.set(anchor, id) }
        return id
      }, (element, index) => this.owners.set(element, index))
      this.indices.set(elements, index)
    }
    return index
  }

  invalidate(elements?: IElement[]) {
    if (elements) {
      const index = this.indices.get(elements)
      for (const entry of index?.entries() || [])
        for (const element of entry.record.elements)
          if (this.owners.get(element) === index) this.owners.delete(element)
      this.indices.delete(elements)
    }
    else {
      this.indices = new WeakMap()
      this.owners = new WeakMap()
    }
  }

  clear() {
    this.indices = new WeakMap()
    this.ids = new WeakMap()
    this.owners = new WeakMap()
  }
}

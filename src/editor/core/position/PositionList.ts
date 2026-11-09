import type { IElementPosition } from '../../interface/Element'

type Block = {
  start: number
  end: number
  source: IElementPosition[]
  offset: number
  shift: number
  rowIndex: number
  rowNo: number
  placement?: { pageNo: number; y: number }
  values: Map<number, IElementPosition>
  projected?: () => void
}
const lists = new WeakMap<IElementPosition[], PositionList>()
const numeric = (key: PropertyKey) =>
  typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)

/** Sparse array overrides plus canonical row blocks. Views never retain a prior list. */
class PositionList {
  readonly array: IElementPosition[]
  private target: IElementPosition[] = []
  private blocks: Block[] = []
  private deleted = new Set<number>()
  private explicit = new Set<number>()

  constructor() {
    const read = (index: number) => {
      if (this.deleted.has(index)) return undefined
      if (Object.hasOwn(this.target, index)) return this.target[index]
      const block = this.find(index)
      if (!block) return undefined
      const at = block.offset + index - block.start
      const original = block.source[at]
      if (!block.placement && !block.shift && original.rowIndex === block.rowIndex &&
        original.rowNo === block.rowNo) return original
      let value = block.values.get(at)
      if (!value) {
        value = { ...original, index: original.index + block.shift,
          rowIndex: block.rowIndex, rowNo: block.rowNo }
        if (block.placement) {
          const { pageNo, y } = block.placement
          const bottom = y + original.lineHeight
          const { leftTop, leftBottom, rightTop, rightBottom } = original.coordinate
          value.pageNo = pageNo
          value.coordinate = {
            leftTop: [leftTop[0], y],
            leftBottom: [leftBottom[0], bottom],
            rightTop: [rightTop[0], y],
            rightBottom: [rightBottom[0], bottom]
          }
        }
        block.values.set(at, value)
        block.projected?.()
      }
      return value
    }
    this.array = new Proxy(this.target, {
      get: (target, key, receiver) => numeric(key)
        ? read(Number(key)) : Reflect.get(target, key, receiver),
      has: (target, key) => numeric(key)
        ? !this.deleted.has(Number(key)) &&
          (Reflect.has(target, key) || !!this.find(Number(key))) : Reflect.has(target, key),
      ownKeys: target => {
        const keys = Reflect.ownKeys(target)
        const indices = new Set(keys.filter(numeric).map(Number))
        for (const block of this.blocks)
          for (let i = block.start; i < Math.min(block.end, target.length); i++)
            indices.add(i)
        return [...[...indices].filter(i => !this.deleted.has(i))
          .sort((a, b) => a - b).map(String),
          ...keys.filter(key => !numeric(key))]
      },
      getOwnPropertyDescriptor: (target, key) => {
        const own = Reflect.getOwnPropertyDescriptor(target, key)
        if (numeric(key) && this.deleted.has(Number(key))) return undefined
        if (own || !numeric(key) || !this.find(Number(key))) return own
        return { configurable: true, enumerable: true, writable: true,
          value: read(Number(key)) }
      },
      set: (target, key, value) => {
        const length = target.length
        const changed = Reflect.set(target, key, value)
        if (changed && numeric(key)) {
          this.deleted.delete(Number(key))
          this.explicit.add(Number(key))
        }
        if (changed && key === 'length' && target.length < length) {
          this.blocks = this.blocks.filter(block => block.start < target.length)
            .map(block => ({ ...block, end: Math.min(block.end, target.length) }))
          this.deleted = new Set([...this.deleted].filter(i => i < target.length))
          this.explicit = new Set([...this.explicit].filter(i => i < target.length))
        }
        return changed
      },
      deleteProperty: (target, key) => {
        const removed = Reflect.deleteProperty(target, key)
        if (removed && numeric(key)) {
          this.deleted.add(Number(key))
          this.explicit.delete(Number(key))
        }
        return removed
      }
    })
    lists.set(this.array, this)
  }

  private find(index: number) {
    if (index >= this.target.length) return undefined
    let low = 0
    let high = this.blocks.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.blocks[mid].end <= index) low = mid + 1
      else high = mid
    }
    const block = this.blocks[low]
    return block && block.start <= index ? block : undefined
  }

  add(block: Block) {
    // Render appends rows in source order; malformed/sparse rows use the eager path.
    if (this.blocks.length && block.start < this.blocks.at(-1)!.end)
      return false
    for (let i = block.start; i < Math.min(block.end, this.target.length); i++) {
      delete this.target[i]
      this.explicit.delete(i)
    }
    this.blocks.push(block)
    this.target.length = Math.max(this.target.length, block.end)
    return true
  }

  slice(start: number, end: number): IElementPosition[] {
    // Non-native hosts can own sparse explicit overrides. Snapshot those rather
    // than constructing a view chain over a mutable list generation.
    if ([...this.deleted].some(i => i >= start && i < end) ||
      [...this.explicit].some(i => i >= start && i < end))
      return this.array.slice(start, end)
    const result = new PositionList()
    let low = 0
    let high = this.blocks.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.blocks[mid].end <= start) low = mid + 1
      else high = mid
    }
    for (let i = low; i < this.blocks.length && this.blocks[i].start < end; i++) {
      const block = this.blocks[i]
      const from = Math.max(start, block.start)
      const to = Math.min(end, block.end)
      result.add({ ...block, start: from - start, end: to - start,
        offset: block.offset + from - block.start })
    }
    result.target.length = end - start
    return result.array
  }

  append(array: IElementPosition[]) {
    const previous = lists.get(array)
    if (!previous || previous.deleted.size || previous.explicit.size) {
      const start = this.target.length
      let visited = 0
      for (let i = 0; i < array.length; i++)
        if (i in array) {
          visited++
          this.target[start + i] = array[i]
          this.explicit.add(start + i)
        }
      this.target.length = start + array.length
      return visited
    }
    const start = this.target.length
    for (const block of previous.blocks)
      this.add({ ...block, start: block.start + start, end: block.end + start })
    this.target.length = start + array.length
    return 0
  }
}

export function isPositionList(array: IElementPosition[]) { return lists.has(array) }

export function createPositionList() { return new PositionList().array }

export function appendPositionList(target: IElementPosition[], source: IElementPosition[]) {
  const list = lists.get(target)
  if (list) return list.append(source)
  target.push(...source)
  return source.length
}

export function slicePositionList(array: IElementPosition[], start: number, end = array.length) {
  return lists.get(array)?.slice(start, end) || array.slice(start, end)
}

export function setPositionBlock(array: IElementPosition[], start: number,
  source: IElementPosition[], shift: number, rowIndex: number, rowNo: number,
  projected?: () => void, placement?: Block['placement']) {
  const list = lists.get(array)
  if (!list || !source.length) return false
  return list.add({ start, end: start + source.length, source, shift, rowIndex, rowNo,
    offset: 0, values: new Map(), projected, placement })
}

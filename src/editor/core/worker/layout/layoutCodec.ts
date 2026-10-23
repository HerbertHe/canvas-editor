import type { NativeParagraphLayout } from '../../text-engine/layout/TextLayoutService'
import type { TransferBufferPool } from './TransferBufferPool'

// Float64 preserves indices beyond 32 bits and all layout coordinate precision.
const fields = ['glyphId', 'cluster', 'ax', 'dx', 'dy', 'charStart', 'charEnd',
  'logicalIndexStart', 'logicalIndexEnd', 'left', 'right', 'bidiLevel',
  'baselineShift', 'fontSize', 'x', 'y', 'advance', 'offsetX', 'offsetY',
  'clusterIndex', 'height', 'position.elementIndex', 'position.offset']

interface Vector {
  __ceVector: 1
  count: number
  numbers: Float64Array
  masks: Uint32Array
  metadata: Record<string, unknown>[]
}
export interface PackedLayout {
  schemaVersion: 1
  data: unknown
  references: unknown[]
}

/** Lossless numeric vectors plus interned font/style DTOs; no live model objects. */
export function encodeLayout(layout: NativeParagraphLayout, pool?: TransferBufferPool) {
  const references: unknown[] = []
  const ids = new Map<string, number>()
  const buffers: ArrayBuffer[] = []
  const buffer = (bytes: number) => {
    const value = pool?.acquire(bytes) || new ArrayBuffer(bytes)
    buffers.push(value)
    return value
  }
  const intern = (value: unknown) => {
    const key = JSON.stringify(value, (_, item) => item === undefined
      ? { __ceUndefined: true } : item)
    let id = ids.get(key)
    if (id === undefined) {
      id = references.length
      ids.set(key, id)
      references.push(walk(value))
    }
    return { __ceRef: id }
  }
  const vector = (items: Record<string, unknown>[]): Vector => {
    const numbers = new Float64Array(buffer(items.length * fields.length * 8),
      0, items.length * fields.length)
    const masks = new Uint32Array(buffer(items.length * 4), 0, items.length)
    const metadata = items.map((item, index) => {
      const rest = { ...item }
      if (rest.position && typeof rest.position === 'object')
        rest.position = { ...rest.position }
      let mask = 0
      fields.forEach((field, slot) => {
        const [key, child] = field.split('.')
        const owner = (child ? rest[key] : rest) as Record<string, unknown> | undefined
        const property = child || key
        if (owner && typeof owner[property] === 'number') {
          numbers[index * fields.length + slot] = owner[property] as number
          mask |= 1 << slot
          delete owner[property]
        }
      })
      if (rest.position && !Object.keys(rest.position).length &&
        (mask & ((1 << 21) | (1 << 22)))) delete rest.position
      masks[index] = mask
      return walk(rest) as Record<string, unknown>
    })
    return { __ceVector: 1, count: items.length, numbers, masks, metadata }
  }
  function walk(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(walk)
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'glyphs' || key === 'carets') && Array.isArray(child) && child.length)
        result[key] = vector(child)
      else if ((key === 'font' || key === 'style') && child && typeof child === 'object')
        result[key] = intern(child)
      else result[key] = walk(child)
    }
    return result
  }
  return { packed: { schemaVersion: 1 as const, data: walk(layout), references }, buffers }
}

export function decodeLayout(packed: PackedLayout): NativeParagraphLayout {
  if (packed.schemaVersion !== 1) throw new Error('Unsupported geometry encoding')
  const references = new Map<number, unknown>()
  function walk(value: any): any {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(walk)
    if (typeof value.__ceRef === 'number') {
      const index = value.__ceRef
      if (index < 0 || index >= packed.references.length) throw new Error('Invalid geometry reference')
      if (!references.has(index)) references.set(index, walk(packed.references[index]))
      return references.get(index)
    }
    if (value.__ceVector === 1) {
      const vector = value as Vector
      if (!Number.isInteger(vector.count) || vector.count < 0 ||
        !ArrayBuffer.isView(vector.numbers) || !ArrayBuffer.isView(vector.masks) ||
        Object.prototype.toString.call(vector.numbers) !== '[object Float64Array]' ||
        Object.prototype.toString.call(vector.masks) !== '[object Uint32Array]' ||
        vector.metadata.length !== vector.count || vector.masks.length !== vector.count ||
        vector.numbers.length !== vector.count * fields.length)
        throw new Error('Invalid geometry vector')
      return vector.metadata.map((metadata, index) => {
        const result = walk(metadata)
        fields.forEach((field, slot) => {
          if (!(vector.masks[index] & (1 << slot))) return
          const [key, child] = field.split('.')
          if (child) result[key] ||= {}
          const owner = child ? result[key] : result
          owner[child || key] = vector.numbers[index * fields.length + slot]
        })
        return result
      })
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]))
  }
  return walk(packed.data)
}

export function layoutTransferBuffers(packed: PackedLayout[]) {
  const buffers = new Set<ArrayBuffer>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (ArrayBuffer.isView(value)) {
      buffers.add(value.buffer as ArrayBuffer)
      return
    }
    for (const child of Object.values(value)) visit(child)
  }
  packed.forEach(visit)
  return [...buffers]
}

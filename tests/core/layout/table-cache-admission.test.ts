import { describe, expect, it } from 'vitest'
import { TableLayoutCache } from '@/editor/core/layout/TableLayoutCache'

const revision = { documentRevision: 1, fontRevision: 1 }
const contents = () => ({ rows: [], nodes: [] })
const cells = (count: number) => Array.from({ length: count }, () => [{ value: 'abc' }])

describe('table cache admission under sequential scans', () => {
  it('keeps 512 hot cells when a 600-cell table exceeds the entry limit', () => {
    const cache = new TableLayoutCache(512)
    const table = cells(600)
    for (let pass = 0; pass < 5; pass++) {
      cache.beginPass()
      for (const value of table) cache.cell(value, 'width=100', revision, contents)
      expect(cache.stats.entries).toBe(512)
      expect(cache.stats.evictions).toBe(0)
      expect(cache.stats.admissionSkips).toBe(88)
      expect(cache.stats.reusedCells).toBe(pass ? 512 : 0)
      expect(cache.stats.computedCells).toBe(pass ? 88 : 600)
    }
  })

  it('reuses unchanged scalar cells without serializing them again', () => {
    const cache = new TableLayoutCache()
    const table = cells(600)
    const scan = (dependencies = 'width=100') => {
      cache.beginPass()
      for (const value of table) cache.cell(value, dependencies, revision, contents)
    }
    scan()
    expect(cache.stats).toMatchObject({ entries: 600, computedCells: 600 })
    table[0][0].value = 'changed'
    scan()
    expect(cache.stats).toMatchObject({
      entries: 600, scalarHits: 599, signatures: 1, computedCells: 1
    })
    Object.assign(table[0][0], { bold: true })
    scan()
    expect(cache.stats).toMatchObject({ scalarHits: 599, computedCells: 1 })
    Reflect.deleteProperty(table[0][0], 'bold')
    scan()
    expect(cache.stats).toMatchObject({ scalarHits: 599, computedCells: 1 })
    Reflect.set(table[0][0], 'metrics', { width: 100 })
    scan()
    expect(cache.stats).toMatchObject({ scalarHits: 600, signatures: 0 })
    scan('width=90')
    expect(cache.stats).toMatchObject({ scalarHits: 0, computedCells: 600 })
  })

  it('also protects hot entries when the byte limit is reached', () => {
    const cache = new TableLayoutCache(512, 300)
    const table = cells(30)
    cache.beginPass()
    for (const value of table) cache.cell(value, 'width=100', revision, contents)
    const retained = cache.stats.entries
    expect(retained).toBeGreaterThan(0)
    expect(retained).toBeLessThan(30)
    for (let pass = 0; pass < 3; pass++) {
      cache.beginPass()
      for (const value of table) cache.cell(value, 'width=100', revision, contents)
      expect(cache.stats.reusedCells).toBe(retained)
      expect(cache.stats.bytes).toBeLessThanOrEqual(300)
      expect(cache.stats.evictions).toBe(0)
    }
  })

  it('admits a new document after an idle pass and invalidates changed cells', () => {
    const cache = new TableLayoutCache(2)
    const old = cells(2), next = cells(2)
    const scan = (values: typeof old) => {
      cache.beginPass()
      for (const value of values) cache.cell(value, 'width=100', revision, contents)
    }
    scan(old)
    scan(next)
    expect(cache.stats.admissionSkips).toBe(2)
    scan(next)
    expect(cache.stats.evictions).toBe(2)
    scan(next)
    expect(cache.stats.reusedCells).toBe(2)
    next[1][0].value = 'changed'
    scan(next)
    expect(cache.stats).toMatchObject({ computedCells: 1, reusedCells: 1, entries: 2 })
    cache.clear()
    expect(cache.stats).toMatchObject({ bytes: 0, entries: 0 })
  })
})

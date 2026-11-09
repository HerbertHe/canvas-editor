import { describe, expect, it } from 'vitest'
import { createPositionList, setPositionBlock, slicePositionList,
  appendPositionList } from '@/editor/core/position/PositionList'
import type { IElementPosition } from '@/editor/interface/Element'
const position = (index: number) => ({ index, rowIndex: 0, rowNo: 0,
  pageNo: 0, coordinate: { leftTop: [index, 1] } } as IElementPosition)

describe('canonical position blocks', () => {
  it('installs a row without reading its elements and memoizes projected metadata', () => {
    let reads = 0
    let projected = 0
    const source = new Proxy(Array.from({ length: 1000 }, (_, i) => position(i)), {
      get: (target, key, receiver) => {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      }
    })
    const list = createPositionList()
    expect(setPositionBlock(list, 2, source, 2, 3, 4, () => projected++)).toBe(true)
    expect(reads).toBe(0)
    expect(list.length).toBe(1002)
    expect(list[500]).toMatchObject({ index: 500, rowIndex: 3, rowNo: 4 })
    expect(list[500]).toBe(list[500])
    expect(projected).toBe(1)
    expect(reads).toBeLessThan(5)
  })

  it('copies page spans without retaining a chain of previous generations', () => {
    let reads = 0
    const source = new Proxy([position(0), position(1)], {
      get: (target, key, receiver) => {
        if (key === '0') reads++
        return Reflect.get(target, key, receiver)
      }
    })
    let list = createPositionList()
    setPositionBlock(list, 0, source, 0, 0, 0)
    for (let i = 0; i < 1000; i++) {
      const next = createPositionList()
      appendPositionList(next, slicePositionList(list, 0))
      list = next
    }
    expect(reads).toBe(0)
    expect(list[0]).toBe(source[0])
    expect(reads).toBe(2)
  })

  it('projects a relocated row from canonical positions through page slices', () => {
    const original = { ...position(0), lineHeight: 3.25,
      coordinate: { leftTop: [1, 0.1], leftBottom: [1, 3.35],
        rightTop: [2, 0.1], rightBottom: [2, 3.35] } }
    const list = createPositionList()
    let projected = 0
    setPositionBlock(list, 0, [original], 0, 5, 1, () => projected++,
      { pageNo: 2, y: 7.1 })
    const next = createPositionList()
    appendPositionList(next, slicePositionList(list, 0))

    expect(projected).toBe(0)
    expect(next[0]).toMatchObject({ pageNo: 2, rowIndex: 5, rowNo: 1,
      coordinate: { leftTop: [1, 7.1], leftBottom: [1, 7.1 + 3.25],
        rightTop: [2, 7.1], rightBottom: [2, 7.1 + 3.25] } })
    expect(next[0]).toBe(list[0])
    expect(projected).toBe(1)
    expect(original.pageNo).toBe(0)
    expect(original.coordinate.leftTop).toEqual([1, 0.1])
  })

  it('preserves array order, sparse holes, overrides and truncation', () => {
    const list = createPositionList()
    setPositionBlock(list, 0, [position(0), position(1), position(2)], 0, 0, 0)
    list[1] = position(100)
    expect(list.map(p => p.index)).toEqual([0, 100, 2])
    expect(Object.keys(list)).toEqual(['0', '1', '2'])
    expect(structuredClone(slicePositionList(list, 0)).map(p => p.index))
      .toEqual([0, 100, 2])
    delete list[1]
    expect(1 in list).toBe(false)
    expect(1 in slicePositionList(list, 0)).toBe(false)
    list.length = 1
    list.length = 3
    expect(2 in list).toBe(false)
  })
})

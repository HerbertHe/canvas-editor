import { describe, expect, it } from 'vitest'
import { ParagraphDirectory } from '@/editor/core/layout/ParagraphIndex'
import { ElementBridge } from '@/editor/core/text-engine-host/ElementBridge'
import { TextDirection } from '@/editor/dataset/enum/TextDirection'
import { ElementType } from '@/editor/dataset/enum/Element'
import { ZERO } from '@/editor/dataset/constant/Common'
import type { IElement } from '@/editor/interface/Element'

const bridge = new ElementBridge()
const options = { defaultDirection: TextDirection.LTR,
  defaultFont: 'Test', defaultSize: 16, defaultColor: '#000' }
const scan = (elements: IElement[]) => bridge.scanParagraphs(elements, options)

describe('paragraph directory', () => {
  it('matches a full scan after deterministic random splits/merges and objects', () => {
    const elements: IElement[] = [
      { value: ZERO }, { value: 'a' }, { value: ZERO },
      { value: '', type: ElementType.TABLE, trList: [], colgroup: [] },
      { value: ZERO }, { value: 'b', areaId: 'area' }, { value: 'c' }
    ]
    const directory = new ParagraphDirectory()
    const index = directory.get(elements)
    let seed = 173
    const random = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }
    for (let i = 0; i < 250; i++) {
      const start = random(elements.length + 1)
      const count = Math.min(random(3), elements.length - start)
      const finish = index.capture(start, count)
      const items = Array.from({ length: random(3) }, () => ({
        value: random(4) ? String.fromCharCode(97 + random(26)) : ZERO
      }))
      elements.splice(start, count, ...items)
      finish()
      expect(index.scan('same-options', scan)).toEqual(scan(elements))
    }
  })

  it('keeps suffix IDs/revisions and limits metadata updates to nearby paragraphs', () => {
    const elements = Array.from({ length: 1000 }, () => [
      { value: ZERO }, { value: 'x' }, { value: 'y' }
    ]).flat()
    const directory = new ParagraphDirectory()
    const index = directory.get(elements)
    index.scan('options', scan)
    const tail = index.entries().at(-1)!.record
    const work = index.stats.scannedElements
    const finish = index.capture(1, 0)
    elements.splice(1, 0, { value: 'new' })
    finish()
    index.scan('options', scan)
    expect(index.entries().at(-1)!.record).toBe(tail)
    expect(index.stats.editedElements).toBeLessThan(10)
    expect(index.stats.scannedElements - work).toBeLessThan(10)
    expect(Object.keys(elements[0])).toEqual(['value'])
    directory.invalidate(elements)
    expect(directory.get(elements).entries().at(-1)!.record.id).toBe(tail.id)
  })
})

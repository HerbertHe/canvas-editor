import type { IElement, IElementPosition } from '../../interface/Element'
import type { EditOperation } from '../history/EditTransaction'
import type { ParagraphDirectory, ParagraphRecord } from '../layout/ParagraphIndex'
import { groupText, pickText } from '../worker/works/wordCountModel'
import { ZERO } from '../../dataset/constant/Common'

type Summary = { count: number; empty: boolean; first: boolean; last: boolean }

/** Existing word rules, including ASCII joins across scope/chunk boundaries. */
export function summarizeWords(text: string): Summary {
  const value = text.replaceAll(ZERO, '\n')
  const ascii = (char: string) => /^[!-~]$/.test(char)
  return { count: groupText(value).length, empty: !value.length,
    first: ascii(value[0] || ''), last: ascii(value.at(-1) || '') }
}

export function countSummaries(summaries: Summary[]) {
  let count = 0
  let previous = false
  for (const summary of summaries) {
    if (summary.empty) continue
    count += summary.count - (previous && summary.first ? 1 : 0)
    previous = summary.last
  }
  return count
}

export class DerivedState {
  private words = new WeakMap<ParagraphRecord, { revision: string; summary: Summary }>()
  private titles: { element: IElement; owner: IElement }[] | null = null
  readonly stats = { wordUpdated: 0, wordReused: 0, wordFallback: 0, catalogScans: 0 }

  invalidateFor(operations: EditOperation[]) {
    for (const operation of operations)
      if (operation.kind === 'snapshot' ||
        (operation.kind === 'splice' && [...operation.before, ...operation.after]
          .some(element => element.titleId || element.trList)) ||
        (operation.kind === 'attributes' && Object.keys(operation.after)
          .some(key => ['titleId', 'level', 'value', 'trList'].includes(key)))) {
        this.titles = null
        return
      }
  }

  wordCount(elements: IElement[], directory: ParagraphDirectory): number | null {
    const summaries: Summary[] = []
    const visit = (elements: IElement[]): boolean => {
      for (const { record } of directory.get(elements).entries()) {
        if (record.plain) {
          const revision = [record.content, record.metrics, record.paint].join(':')
          let cached = this.words.get(record)
          if (cached?.revision !== revision) {
            cached = { revision, summary: summarizeWords(pickText(record.elements)) }
            this.words.set(record, cached)
            this.stats.wordUpdated++
          } else this.stats.wordReused++
          summaries.push(cached.summary)
        } else if (record.elements.length === 1 && record.elements[0].type === 'table') {
          for (const row of record.elements[0].trList || [])
            for (const cell of row.tdList) if (!visit(cell.value)) return false
        } else return false
      }
      return true
    }
    if (!visit(elements)) { this.stats.wordFallback++; return null }
    return countSummaries(summaries)
  }

  catalogSignature(elements: IElement[], positions: IElementPosition[],
    directory: ParagraphDirectory) {
    if (!this.titles) {
      this.titles = []
      const visit = (list: IElement[], parent?: IElement) => {
        for (const element of list) {
          if (element.titleId) this.titles!.push({ element, owner: parent || element })
          for (const row of element.trList || [])
            for (const cell of row.tdList) visit(cell.value, parent || element)
        }
      }
      visit(elements)
      this.stats.catalogScans++
    }
    const main = directory.get(elements)
    return JSON.stringify(this.titles.map(({ element, owner }) => {
      const location = main.location(owner)
      const index = location
        ? location.start + location.record.elements.indexOf(owner) : -1
      return [element.titleId, element.level, element.value, positions[index]?.pageNo]
    }))
  }

  clear() { this.words = new WeakMap(); this.titles = null }
}

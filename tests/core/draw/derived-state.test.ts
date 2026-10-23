import { describe, expect, it } from 'vitest'
import { countSummaries, summarizeWords } from '@/editor/core/draw/DerivedState'
import { groupText } from '@/editor/core/worker/works/wordCountModel'

describe('incremental word boundaries', () => {
  it('is additive only after accounting for ASCII joins and empty fragments', () => {
    const chunks = ['hello', '', 'world ', '汉字', ' é', '👩‍👩', '\u200B', 'one', '!two']
    for (let i = 0; i <= chunks.length; i++)
      expect(countSummaries(chunks.slice(0, i).map(summarizeWords))).toBe(
        groupText(chunks.slice(0, i).join('').replaceAll('\u200B', '\n')).length)
  })
})

import { expect, it } from 'vitest'
import { demoPerformance } from '@/utils/demoPerformance'

it('selects constructor-only QA settings with independent paragraph cache', () => {
  expect(demoPerformance('?performance=sync&imePreview=on&paragraphCache=off',
    { incrementalCompute: true })).toEqual({ performanceProfile: 'sync',
    imePreview: true, incrementalCompute: false })
  expect(demoPerformance('', { incrementalCompute: true })).toEqual({ incrementalCompute: true })
  expect(() => demoPerformance('?performance=typo')).toThrow()
  expect(() => demoPerformance('?imePreview=true')).toThrow()
})

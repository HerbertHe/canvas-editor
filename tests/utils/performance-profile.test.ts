import { describe, expect, it } from 'vitest'
import { mergeOption } from '@/editor/utils/option'

describe('performance rollout profiles', () => {
  it('preserves baseline defaults and keeps transfer opt-in in every profile', () => {
    const baseline = mergeOption({}).lab
    expect(baseline.performanceProfile).toBe('baseline')
    for (const profile of ['baseline', 'sync', 'worker'] as const) {
      const options = mergeOption({ lab: { performanceProfile: profile } }).lab
      expect(options.workerTransfer).toBe(false)
      expect(options.layoutWorker).toBe(profile === 'worker')
      expect(options.incrementalEditing).toBe(profile !== 'baseline')
      expect(options.glyphPathCache).toBe(profile !== 'baseline')
    }
  })

  it('honors explicit rollback switches and rejects unknown profiles', () => {
    const lab = mergeOption({ lab: { performanceProfile: 'worker',
      layoutWorker: false, glyphPathCache: false } }).lab
    expect(lab.layoutWorker).toBe(false)
    expect(lab.glyphPathCache).toBe(false)
    expect(lab.incrementalFlow).toBe(true)
    expect(() => mergeOption({ lab: { performanceProfile: 'typo' as any } }))
      .toThrow('Unknown lab.performanceProfile')
  })
})

import { describe, expect, it } from 'vitest'
import { mergeOption } from '@/editor/utils/option'

describe('performance rollout profiles', () => {
  it('defaults to the synchronous optimizations with IME preview', () => {
    const lab = mergeOption({}).lab
    expect(lab).toMatchObject({
      performanceProfile: 'sync',
      imePreview: true,
      incrementalEditing: true,
      transactionHistory: true,
      incrementalCoverage: true,
      incrementalFlow: true,
      incrementalCommit: true,
      glyphPathCache: true,
      shapingRunCache: true,
      imeWindowPreview: true,
      imeTableLayout: true,
      dirtyPagePaint: true,
      deferredPaint: true,
      incrementalCompute: false,
      layoutWorker: false,
      workerTransfer: false,
      imeWorkerPreview: false
    })
    expect(mergeOption({ lab: { imePreview: false } }).lab).toMatchObject({
      performanceProfile: 'sync',
      imePreview: false
    })
  })

  it('preserves explicit presets and keeps transfer opt-in', () => {
    for (const profile of ['baseline', 'sync', 'worker'] as const) {
      const options = mergeOption({ lab: { performanceProfile: profile } }).lab
      expect(options.workerTransfer).toBe(false)
      expect(options.layoutWorker).toBe(profile === 'worker')
      expect(options.incrementalEditing).toBe(profile !== 'baseline')
      expect(options.incrementalCommit).toBe(profile !== 'baseline')
      expect(options.imeWindowPreview).toBe(profile !== 'baseline')
      expect(options.imeTableLayout).toBe(profile !== 'baseline')
      expect(options.imeWorkerPreview).toBe(false)
      expect(options.imePreview).toBe(false)
      expect(options.glyphPathCache).toBe(profile !== 'baseline')
    }
  })

  it('honors explicit rollback switches and rejects unknown profiles', () => {
    const lab = mergeOption({ lab: { performanceProfile: 'worker',
      layoutWorker: false, glyphPathCache: false, incrementalCommit: false,
      imeWindowPreview: false } }).lab
    expect(lab.layoutWorker).toBe(false)
    expect(lab.glyphPathCache).toBe(false)
    expect(lab.incrementalFlow).toBe(true)
    expect(lab.incrementalCommit).toBe(false)
    expect(lab.imeWindowPreview).toBe(false)
    expect(() => mergeOption({ lab: { performanceProfile: 'typo' as any } }))
      .toThrow('Unknown lab.performanceProfile')
  })
})

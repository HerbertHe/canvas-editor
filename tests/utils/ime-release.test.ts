import { describe, expect, it } from 'vitest'
import { evaluateImeRelease, IME_RELEASE_CHECKS, IME_RELEASE_ENGINES,
  IME_RELEASE_QUALITY, IME_RELEASE_SCENARIOS } from '@/utils/imeRelease'
import type { ImeManualTrial } from '@/utils/imeRelease'

function evidence() {
  const manual: ImeManualTrial[] = []
  for (const platform of ['macos', 'windows'] as const)
    for (const scenario of IME_RELEASE_SCENARIOS.filter(s => s !== 'large'))
      for (const profile of ['baseline', 'sync'] as const)
        for (let i = 0; i < 3; i++) manual.push({ platform, scenario, profile,
          sourceHash: 'current', digest: `${platform}:${scenario}:${profile}:${i}`,
          trusted: true, metadataComplete: true, reviewed: true })
  return { sourceHash: 'current', sourceUnchanged: true,
    quality: IME_RELEASE_QUALITY.map(name => ({ name, passed: true })),
    checks: IME_RELEASE_ENGINES.flatMap(engine => IME_RELEASE_CHECKS.map(name =>
      ({ engine, name, passed: true }))),
    performance: IME_RELEASE_ENGINES.flatMap(engine => IME_RELEASE_SCENARIOS.map(scenario =>
      ({ engine, scenario, optimized: true, trials: 3, samples: 21,
        handlerP95: 1, geometryP95: 10 }))), manual }
}

describe('IME release evidence gate', () => {
  it('holds with missing native evidence even when automation passes', () => {
    const input = evidence()
    input.manual = []
    expect(evaluateImeRelease(input)).toMatchObject({ status: 'hold', manualStatus: 'pending',
      imePreviewDefault: false, imeWorkerPreviewDefault: false })
  })
  it('rejects synthetic, duplicate, old-source and unreviewed manual records', () => {
    for (const patch of [{ trusted: false }, { digest: 'copied' },
      { sourceHash: 'old' }, { metadataComplete: false }, { reviewed: false }]) {
      const input = evidence()
      input.manual = input.manual.map(record => ({ ...record, ...patch }))
      expect(evaluateImeRelease(input).status).toBe('hold')
    }
  })
  it('does not allow missing browsers, checks, quality or measurements to pass', () => {
    for (const field of ['checks', 'quality', 'performance'] as const) {
      const input = evidence()
      input[field] = []
      expect(evaluateImeRelease(input).status).toBe('hold')
    }
    for (const value of [null, NaN, Infinity, -1, 33]) {
      const input = evidence()
      input.performance[0].geometryP95 = value as number
      expect(evaluateImeRelease(input).status).toBe('hold')
    }
  })
  it('requires three trials, unchanged sources, budgets and complete evidence', () => {
    const input = evidence()
    expect(evaluateImeRelease(input).status).toBe('ready')
    input.performance[0].trials = 2
    expect(evaluateImeRelease(input).status).toBe('hold')
    input.performance[0].trials = 3
    input.sourceUnchanged = false
    expect(evaluateImeRelease(input).status).toBe('hold')
  })
})

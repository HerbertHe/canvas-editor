export const IME_RELEASE_ENGINES = ['chromium', 'firefox', 'webkit'] as const
export const IME_RELEASE_SCENARIOS = ['short', '100', '1000', 'long', 'table', 'large'] as const
export const IME_RELEASE_CHECKS = ['ordinary', 'preview', 'anchor', 'closure',
  'long', 'tableWorker', 'workerAnchor'] as const
export const IME_RELEASE_QUALITY = ['lint', 'types', 'unit', 'library', 'app', 'docs', 'package'] as const

export interface ImeManualTrial {
  platform: 'macos' | 'windows'
  scenario: string
  profile: 'baseline' | 'sync'
  sourceHash: string
  digest: string
  trusted: boolean
  metadataComplete: boolean
  reviewed: boolean
}

export function evaluateImeRelease(input: {
  sourceHash: string
  sourceUnchanged: boolean
  quality: { name: string; passed: boolean }[]
  checks: { engine: string; name: string; passed: boolean }[]
  performance: { engine: string; scenario: string; optimized: boolean;
    trials: number; samples: number; handlerP95: number | null;
    geometryP95: number | null }[]
  manual: ImeManualTrial[]
}) {
  const reasons: string[] = []
  if (!input.sourceHash || !input.sourceUnchanged) reasons.push('source-changed-or-unbound')
  for (const name of IME_RELEASE_QUALITY)
    if (!input.quality.some(q => q.name === name && q.passed)) reasons.push('quality:' + name)
  for (const engine of IME_RELEASE_ENGINES) {
    for (const name of IME_RELEASE_CHECKS)
      if (!input.checks.some(c => c.engine === engine && c.name === name && c.passed))
        reasons.push(`check:${engine}:${name}`)
    for (const scenario of IME_RELEASE_SCENARIOS) {
      const p = input.performance.find(p => p.engine === engine &&
        p.scenario === scenario && p.optimized)
      if (!p || p.trials < 3 || p.samples < 21 ||
        !Number.isFinite(p.handlerP95) || !Number.isFinite(p.geometryP95) ||
        p.handlerP95 === null || p.geometryP95 === null) {
        reasons.push(`performance-missing:${engine}:${scenario}`)
      } else if (p.handlerP95 > 8 || p.geometryP95 > 32 ||
        p.handlerP95 < 0 || p.geometryP95 < 0)
        reasons.push(`performance-budget:${engine}:${scenario}`)
    }
  }
  for (const platform of ['macos', 'windows'])
    for (const scenario of IME_RELEASE_SCENARIOS.filter(s => s !== 'large'))
      for (const profile of ['baseline', 'sync']) {
        const records = input.manual.filter(m => m.platform === platform &&
          m.scenario === scenario && m.profile === profile &&
          m.sourceHash === input.sourceHash && m.trusted &&
          m.metadataComplete && m.reviewed && !!m.digest)
        if (new Set(records.map(r => r.digest)).size < 3)
          reasons.push(`manual:${platform}:${scenario}:${profile}`)
      }
  return { status: reasons.length ? 'hold' as const : 'ready' as const,
    budgets: { handlerP95: 8, geometryP95: 32 }, reasons,
    manualStatus: reasons.some(r => r.startsWith('manual:')) ? 'pending' : 'complete',
    imePreviewDefault: false, imeWorkerPreviewDefault: false }
}

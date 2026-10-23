import type { ILabOption } from '../interface/Editor'

export type PerformanceProfile = 'baseline' | 'sync' | 'worker'

/** Constructor presets only. Explicit switches always take precedence. */
export function performanceProfile(profile: PerformanceProfile): ILabOption {
  if (!['baseline', 'sync', 'worker'].includes(profile))
    throw new TypeError('Unknown lab.performanceProfile: ' + profile)
  if (profile === 'baseline') return {}
  return {
    incrementalEditing: true,
    transactionHistory: true,
    incrementalCoverage: true,
    glyphPathCache: true,
    shapingRunCache: true,
    incrementalFlow: true,
    dirtyPagePaint: true,
    deferredPaint: true,
    layoutWorker: profile === 'worker',
    workerTransfer: false
  }
}

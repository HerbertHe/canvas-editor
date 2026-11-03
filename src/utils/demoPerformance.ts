import type { ILabOption } from '../editor/interface/Editor'
import type { PerformanceProfile } from '../editor/utils/performanceProfile'

/** QA URLs rebuild the demo; these are not runtime editor configuration APIs. */
export function demoPerformance(search: string, current: ILabOption = {}): ILabOption {
  const params = new URLSearchParams(search)
  const lab = { ...current }
  const profile = params.get('performance')
  if (profile !== null) {
    if (!['baseline', 'sync', 'worker'].includes(profile))
      throw new TypeError('Invalid demo performance profile')
    lab.performanceProfile = profile as PerformanceProfile
  }
  for (const [param, key] of [['paragraphCache', 'incrementalCompute'],
    ['imePreview', 'imePreview']] as const) {
    const value = params.get(param)
    if (value === null) continue
    if (value !== 'on' && value !== 'off') throw new TypeError('Invalid demo ' + param)
    lab[key] = value === 'on'
  }
  return lab
}

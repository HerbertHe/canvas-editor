export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p: number) =>
    sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null
  return {
    count: values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? null
  }
}

/** Validate before persisting a successful run; partial failures stay failures. */
export function interactionResultErrors(result: any): string[] {
  const errors: string[] = []
  if (result?.schemaVersion !== 1) errors.push('schemaVersion')
  if (!Number.isInteger(result?.sent) || result.sent < 1) errors.push('sent')
  if (result?.received !== result?.sent) errors.push('received')
  if (result?.completed !== result?.sent) errors.push('completed')
  if (result?.pendingHandlers !== 0) errors.push('pendingHandlers')
  const required = ['content', 'selection', 'receivedAll', 'completedAll',
    'trusted', 'inputChain', 'repeat']
  if (required.some(key => result?.checks?.[key] !== true))
    errors.push('checks')
  if (!result?.passed) errors.push('passed')
  if (!Array.isArray(result?.events) || !result.events.length ||
    result.events.some((e: any) => !e.trusted ||
      !Number.isFinite(e.handlerMs) || e.handlerMs < 0)) errors.push('events')
  return errors
}

export interface StageMetric {
  calls: number
  ms: number
  selfMs: number
  work: Record<string, number>
}

/** Synchronous spans only. selfMs excludes other instrumented child spans. */
export class QAProfiler {
  enabled = true
  phase = 'startup'
  stages: Record<string, Record<string, StageMetric>> = {}
  private stack: { children: number }[] = []

  reset(phase: string) {
    if (this.stack.length) throw new Error('Cannot reset an active profiler')
    this.stages = {}
    this.phase = phase
  }

  track(
    object: any,
    method: string,
    label: string,
    work?: (args: any[], result: any) => Record<string, number>
  ) {
    const original = object?.[method]
    if (typeof original !== 'function')
      throw new Error(`Missing QA instrumentation point: ${method}`)
    const profiler = this
    object[method] = function (...args: any[]) {
      if (!profiler.enabled) return original.apply(this, args)
      const bucket = (profiler.stages[profiler.phase] ||= {})
      const metric = (bucket[label] ||= {
        calls: 0,
        ms: 0,
        selfMs: 0,
        work: {}
      })
      const frame = { children: 0 }
      profiler.stack.push(frame)
      const start = performance.now()
      let result: any
      let succeeded = false
      try {
        result = original.apply(this, args)
        succeeded = true
        return result
      } finally {
        const elapsed = performance.now() - start
        profiler.stack.pop()
        const parent = profiler.stack.at(-1)
        if (parent) parent.children += elapsed
        metric.calls++
        metric.ms += elapsed
        metric.selfMs += Math.max(0, elapsed - frame.children)
        if (work && succeeded) {
          for (const [key, value] of Object.entries(work(args, result)))
            metric.work[key] = (metric.work[key] || 0) + value
        }
      }
    }
  }
}

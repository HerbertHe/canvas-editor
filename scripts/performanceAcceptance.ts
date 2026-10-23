/** Fixed rollout budgets. A geometry proxy never proves actual presentation. */
export function assessPerformance(report: any, requireMatrix = true) {
  const errors: string[] = []
  const holds: string[] = []
  if (report?.schemaVersion !== 1 || report?.mode !== 'interaction')
    errors.push('Expected an interaction report, schema 1')
  if (!report?.results?.length) errors.push('No measured cases')
  if (report?.errors?.length) errors.push('Browser errors')
  const settings = report?.settings || {}
  if (!(settings.durationMs >= 10000)) holds.push('Window shorter than 10 seconds')
  if (requireMatrix && !(settings.trials >= 3)) holds.push('Fewer than 3 trials')
  const cases = (report?.results || []).map((row: any) => {
    const invalid = []
    if (row.passed !== true || row.schemaVersion !== 1 || !(row.sent > 0) ||
      row.sent !== row.received || row.sent !== row.completed || row.pendingHandlers !== 0)
      invalid.push('incomplete run')
    if (['content', 'selection', 'receivedAll', 'completedAll', 'trusted',
      'inputChain', 'repeat'].some(key => row.checks?.[key] !== true) ||
      !row.events?.length || row.events.some((event: any) => event.trusted !== true ||
        !Number.isFinite(event.handlerMs) || event.handlerMs < 0))
      invalid.push('unverified events')
    if (row.driver?.pendingAfterDrain !== 0) invalid.push('driver backlog')
    if (row.checks?.geometryCommitted !== true) invalid.push('geometry commit')
    if (settings.verifyHistory && (!row.historyVerification?.undo ||
      !row.historyVerification?.redo)) invalid.push('history')
    const key = row.config?.action === 'input' ? 'inputHandlerMs' : 'keydownHandlerMs'
    const handler = row.timings?.[key]
    const geometry = row.timings?.geometryCommitMs
    if (geometry?.count !== row.sent) invalid.push('incomplete geometry timings')
    const measured = (metric: any) => metric?.count > 0 &&
      ['p50', 'p95', 'p99', 'max'].every(k => Number.isFinite(metric[k]) && metric[k] >= 0) &&
      metric.p50 <= metric.p95 && metric.p95 <= metric.p99 && metric.p99 <= metric.max
    if (!measured(handler) || !measured(geometry)) invalid.push('invalid latency distribution')
    if (invalid.length) errors.push(`${row.name}: ${invalid.join(', ')}`)
    const handlerBudget = measured(handler) && handler.p95 <= 8
    const geometryBudget = measured(geometry) && geometry.p95 <= 32
    if (!handlerBudget || !geometryBudget) holds.push(`${row.name}: latency budget`)
    if (settings.workerLayout) {
      const backend = row.optimizationStats?.diagnostics?.worker
      if (!backend) holds.push(`${row.name}: missing backend diagnostics`)
      else if (!backend.ready || backend.needsResync)
        holds.push(`${row.name}: backend not ready after run`)
    }
    return { name: row.name, operations: row.sent, valid: !invalid.length,
      handler, geometry, handlerBudget, geometryBudget,
      offerToGeometry: row.driver?.offerToGeometryMs,
      maxPending: row.driver?.maxPending, memory: row.memory,
      longTaskMs: row.longTasks?.reduce((sum: number, t: any) => sum + t.duration, 0),
      work: row.optimizationStats }
  })
  // Presence of multiple random cases cannot silently replace a workload axis.
  if (requireMatrix) for (const sample of ['paragraphs-100', 'paragraphs-1000',
    'single-long-paragraph', 'large-table'])
    for (const action of ['input', 'backspace', 'delete']) {
      const matching = (report?.results || []).filter((row: any) =>
        row.config?.sample === sample && row.config?.action === action)
      if (!matching.length)
        holds.push(`Missing workload: ${sample}/${action}`)
      else if (new Set(matching.map((row: any) => row.trial)).size < 3)
        holds.push(`Missing measured trials: ${sample}/${action}`)
    }
  return { status: errors.length ? 'fail' : holds.length ? 'hold' : 'pass',
    budgets: { handlerP95Ms: 8, geometryProxyP95Ms: 32 }, errors, holds, cases,
    presentation: 'unverified: DOM-to-geometry and rAF are not screen presentation' }
}

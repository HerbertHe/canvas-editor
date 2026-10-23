import { describe, expect, it } from 'vitest'
import { assessPerformance } from '../../../scripts/performanceAcceptance'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

function report() {
  const metric = { count: 300, p50: 1, p95: 2, p99: 3, max: 4 }
  return { schemaVersion: 1, mode: 'interaction',
    settings: { durationMs: 10000, trials: 3 }, results:
    ['paragraphs-100', 'paragraphs-1000', 'single-long-paragraph', 'large-table']
      .flatMap(sample => ['input', 'backspace', 'delete'].map(action => ({
        schemaVersion: 1, name: `${sample}/${action}`, config: { sample, action },
        sent: 300, received: 300, completed: 300, pendingHandlers: 0,
        checks: { content: true, selection: true, receivedAll: true,
          completedAll: true, trusted: true, inputChain: true, repeat: true,
          geometryCommitted: true }, passed: true,
        events: [{ trusted: true, handlerMs: 1 }],
        driver: { pendingAfterDrain: 0 },
        timings: { inputHandlerMs: metric, keydownHandlerMs: metric,
          geometryCommitMs: metric }
      }))).flatMap(row => [0, 1, 2].map(trial => ({ ...row,
        name: `${row.name}/${trial}`, trial }))) }
}

describe('performance release gate', () => {
  it('keeps release on hold and never suppresses stale evidence errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-perf-gate-'))
    try {
      const source = join(dir, 'source.ts')
      writeFileSync(source, 'measured source')
      const data = { ...report(), sourceHashes: { [source]:
        createHash('sha256').update('measured source').digest('hex') } }
      const input = join(dir, 'input.json')
      const manifest = join(dir, 'manifest.json')
      const output = join(dir, 'acceptance.json')
      writeFileSync(input, JSON.stringify(data))
      writeFileSync(manifest, JSON.stringify({ performance: [input], output }))
      const run = (extra: string[] = []) => spawnSync(process.execPath,
        ['scripts/test-performance-acceptance.mjs', manifest, ...extra],
        { encoding: 'utf8' })
      expect(run().status).toBe(1)
      expect(JSON.parse(readFileSync(output, 'utf8')).status).toBe('hold')
      expect(run(['--report-only']).status).toBe(0)
      writeFileSync(source, 'changed after measurement')
      expect(run(['--report-only']).status).toBe(1)
      expect(JSON.parse(readFileSync(output, 'utf8')).status).toBe('fail')
      writeFileSync(source, 'measured source')
      const build = join(dir, 'build.json')
      const artifact = join(dir, 'bundle.js')
      writeFileSync(artifact, 'stale bundle')
      writeFileSync(build, JSON.stringify({ passed: true, artifactHashes: {
        [artifact]: createHash('sha256').update('accepted bundle').digest('hex')
      } }))
      writeFileSync(manifest, JSON.stringify({ performance: [input], output,
        automated: [{ kind: 'build', path: build }] }))
      expect(run(['--report-only']).status).toBe(1)
      expect(JSON.parse(readFileSync(output, 'utf8')).errors.join(' '))
        .toContain('stale artifact')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('holds a fast handler with delayed geometry and missing workload coverage', () => {
    const data = report()
    expect(assessPerformance(data).status).toBe('pass')
    data.results[0].timings.geometryCommitMs = {
      count: 300, p50: 100, p95: 200, p99: 300, max: 400
    }
    const held = assessPerformance(data)
    expect(held.status).toBe('hold')
    expect(held.cases[0].handlerBudget).toBe(true)
    expect(held.cases[0].geometryBudget).toBe(false)
    data.results = data.results.filter(row => row.config.sample !== 'large-table' ||
      row.config.action !== 'delete')
    expect(assessPerformance(data).holds).toContain('Missing workload: large-table/delete')
  })

  it('fails incomplete or untrusted runs instead of treating them as faster', () => {
    const data = report()
    data.results[0].received = 1
    data.results[0].events[0].trusted = false
    expect(assessPerformance(data).status).toBe('fail')
    expect(assessPerformance({}).status).toBe('fail')
    const corrupt = report()
    corrupt.results[0].timings.inputHandlerMs.p95 = NaN
    expect(assessPerformance(corrupt).status).toBe('fail')
    const singleTrial = report()
    singleTrial.results = singleTrial.results.filter(row => row.trial === 0)
    expect(assessPerformance(singleTrial).holds)
      .toContain('Missing measured trials: paragraphs-100/input')
    const fallback = report()
    Object.assign(fallback.settings, { workerLayout: true })
    Object.assign(fallback.results[0], { optimizationStats: {
      diagnostics: { worker: { ready: false, needsResync: true } }
    } })
    expect(assessPerformance(fallback).holds.some(reason =>
      reason.includes('backend not ready after run'))).toBe(true)
  })
})

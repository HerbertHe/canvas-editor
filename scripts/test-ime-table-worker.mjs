import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { launchImeBrowser, sameImePixels } from './ime-browser.mjs'
import { arch, cpus, platform, release, totalmem } from 'node:os'

const browser = await launchImeBrowser({ software: true })
const base = process.env.BASE_URL || 'http://127.0.0.1:3020'
const correctnessOnly = process.env.CORRECTNESS_ONLY === '1'
const trials = Number(process.env.TRIALS || 3)
const iterations = Number(process.env.ITERATIONS || 5)
const tableCacheEntries = process.env.TABLE_CACHE_ENTRIES === undefined
  ? undefined : Number(process.env.TABLE_CACHE_ENTRIES)
assert.ok(Number.isInteger(trials) && trials > 0 && Number.isInteger(iterations) && iterations > 0)
assert.ok(tableCacheEntries === undefined ||
  (Number.isInteger(tableCacheEntries) && tableCacheEntries > 0))
const output = process.env.OUTPUT || 'cypress/results/ime/table-worker-comparison.json'
const report = { date: '2026-11-02', passed: false, browser: browser.version(), node: process.version,
  machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model,
    memoryGiB: totalmem() / 2 ** 30 }, settings: { trials, iterations,
    values: ['n', 'ni', 'nih', 'niha', 'nihao', 'ni', ''], viewport: [1366, 720],
    chromiumArgs: ['--disable-gpu'], incrementalCompute: false, imePreview: true,
    tableCacheEntries },
  semantics: 'Synthetic Vite development fixture, not OS IME or actual presentation FPS. Table modes use sync profile; body modes use worker profile and switch only imeWorkerPreview. handlerMs ends at input + flushComposition(false) return. geometryMs waits for local preview completion or synchronous fallback. nextRafMs waits for the following rAF, not presentation. Later scheduled paint/notifications may not be included in handlerMs. Longtasks are observer entries starting within measured update intervals; setup/reset/cancel outside those intervals is excluded. Drain starts after session cancellation and waits for worker synchronization. Table inputElements sums cell inputs presented to layout/cache checks, not actual unique traversal or allocation counts. computedCells counts child layout callbacks, not HarfBuzz calls. No heap-byte claims.',
  sources: {}, fonts: {}, checks: [], boundaries: [], bursts: [], results: [], aggregate: [], errors: [] }
for (const file of ['src/editor/core/layout/TableLayoutCache.ts',
  'src/editor/core/text-engine-host/TableLayoutHost.ts', 'src/editor/core/layout/TableLayout.ts',
  'src/editor/core/layout/relativeLayout.ts', 'src/editor/core/draw/CompositionPreview.ts',
  'src/editor/core/draw/Draw.ts', 'src/editor/core/event/CanvasEvent.ts',
  'src/editor/core/event/CompositionSession.ts', 'src/editor/core/worker/layout/protocol.ts',
  'src/editor/core/worker/layout/LayoutWorkerClient.ts', 'src/editor/core/worker/layout/LayoutWorkerServer.ts',
  'src/editor/utils/option.ts', 'src/editor/utils/performanceProfile.ts',
  'tests/fixtures/migration/ime-table-worker.ts', 'scripts/test-ime-table-worker.mjs'])
  report.sources[file] = createHash('sha256').update(await readFile(file)).digest('hex')
for (const file of ['tests/fixtures/fonts/NotoSans-Latin-Regular.woff2',
  'tests/fixtures/fonts/NotoSansSC-Regular.woff2', 'public/fonts/NotoNaskhArabic-Regular.ttf'])
  report.fonts[file] = createHash('sha256').update(await readFile(file)).digest('hex')

async function open(kind, enabled, denied = false, capacity) {
  const body = ['plain', 'wide'].includes(kind)
  const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-table-worker.html')
  await page.waitForFunction(() => window.imeTableWorker)
  const fixture = await page.evaluate(config => window.imeTableWorker.setup(config),
    { kind, tableCache: body || enabled, workerPreview: body && enabled, denied,
      tableCacheEntries: capacity })
  return { page, fixture }
}
async function close(page) {
  await page.evaluate(() => window.imeTableWorker.dispose())
  await page.close()
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) }
}
function summarize(samples, drains, tasks) {
  const tableMeans = {}
  const workerTotals = {}
  for (const sample of samples)
    for (const [key, value] of Object.entries(sample.tables))
      tableMeans[key] = (tableMeans[key] || 0) + value / samples.length
  for (const sample of samples)
    for (const [key, value] of Object.entries(sample.workerWork))
      workerTotals[key] = (workerTotals[key] || 0) + value
  return { handlerMs: distribution(samples.map(s => s.handlerMs)),
    geometryMs: distribution(samples.map(s => s.geometryMs)),
    nextRafMs: distribution(samples.map(s => s.nextRafMs)), drainMs: distribution(drains),
    tableMeans, workerTotals, local: samples.filter(s => s.composition.local).length,
    workerPending: samples.filter(s => s.composition.previewWorker.pending).length,
    longtasks: { count: tasks.length, ms: tasks.reduce((sum, task) => sum + task.ms, 0),
      max: Math.max(0, ...tasks.map(t => t.ms)) },
    slowest: samples.reduce((a, b) => a.geometryMs > b.geometryMs ? a : b) }
}
try {
  for (const kind of ['table', 'large', 'merged', 'nested', 'repeated', 'rtl', 'plain', 'wide']) {
    const results = []
    for (const enabled of [false, true]) {
      const { page } = await open(kind, enabled)
      results.push(await page.evaluate(() => window.imeTableWorker.differential()))
      await close(page)
    }
    if (['plain', 'wide'].includes(kind)) assert.ok(results[1].results.some(r =>
      r.composition.previewWorker.committed > 0), kind + ' must commit real Worker previews')
    else assert.ok(results[1].results.some(r => r.tables.reusedCells > 0),
      kind + ' must reuse cells')
    assert.equal(results[1].final, results[0].final, kind + ' final')
    const comparison = await browser.newPage()
    for (let i = 0; i < results[0].results.length; i++) {
      const a = results[0].results[i], b = results[1].results[i]
      if (kind === 'large') {
        assert.equal(b.tables.computedCells, 1)
        assert.equal(b.tables.scalarHits, 599)
        assert.equal(b.tables.signatures, 1)
      }
      assert.equal(b.geometry, a.geometry, `${kind}/${i} table geometry`)
      assert.equal(b.model, a.model, `${kind}/${i} model`)
      assert.equal(b.previewGeometry, a.previewGeometry, `${kind}/${i} preview geometry`)
      const equal = await sameImePixels(comparison, b.images, a.images)
      if (!equal) {
        await mkdir('cypress/results/ime', { recursive: true })
        for (let p = 0; p < a.images.length; p++) {
          if (a.images[p] === b.images[p]) continue
          for (const [name, value] of [['baseline', a.images[p]], ['optimized', b.images[p]]])
            await writeFile(`cypress/results/ime/table-worker-${kind}-${name}-${p}.png`,
              Buffer.from(value.split(',')[1], 'base64'))
        }
        throw new Error(`${kind}/${i} pixels differ; PNGs saved`)
      }
      assert.ok(a.caret && b.caret, `${kind}/${i} missing caret in ` +
        JSON.stringify({ baseline: a.caret, optimized: b.caret }))
      assert.equal(b.caret.pageNo, a.caret.pageNo)
      for (const key of ['x', 'y', 'height']) assert.ok(Math.abs(b.caret[key] - a.caret[key]) < 1e-7,
        `${kind}/${i} caret ${key}`)
      report.checks.push({ kind, update: i, geometry: true, pixels: true, caret: true,
        tables: b.tables, composition: b.composition })
    }
    await comparison.close()
  }
  for (const kind of ['stale', 'deadline', 'fault', 'oversize', 'denied']) {
    const { page } = await open('plain', true, kind === 'denied')
    const result = await page.evaluate(kind => window.imeTableWorker.boundary(kind), kind)
    assert.equal(result.pending, false)
    assert.equal(result.worker.requests, 0)
    assert.equal(result.worker.waiting, false)
    report.boundaries.push(result)
    await close(page)
  }
  for (const kind of ['plain', 'wide']) {
    const { page } = await open(kind, true)
    report.bursts.push({ kind, ...await page.evaluate(() => window.imeTableWorker.burst()) })
    await close(page)
  }
  const raw = []
  if (!correctnessOnly) {
    const cases = [['table', false], ['large', false], ['merged', true],
      ['plain', false], ['wide', false]]
    for (let trial = 0; trial < trials; trial++) {
      for (const [kind, grow] of cases) {
        for (const enabled of trial % 2 ? [true, false] : [false, true]) {
          const { page, fixture } = await open(kind, enabled, false,
            kind === 'large' ? tableCacheEntries : undefined)
          const result = await page.evaluate(({ iterations, grow }) =>
            window.imeTableWorker.trial(iterations, grow), { iterations, grow })
          raw.push({ kind, grow, enabled, trial, ...result })
          report.results.push({ kind, grow, enabled, trial, fixture,
            ...summarize(result.samples, result.drains, result.longtasks), worker: result.worker })
          await close(page)
        }
      }
    }
    for (const [kind] of cases)
      for (const enabled of [false, true]) {
        const runs = raw.filter(r => r.kind === kind && r.enabled === enabled)
        report.aggregate.push({ kind, enabled,
          ...summarize(runs.flatMap(r => r.samples), runs.flatMap(r => r.drains),
            runs.flatMap(r => r.longtasks)) })
      }
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(`PASS: ${report.checks.length} table/Worker differentials, ${report.boundaries.length} boundaries, ${report.bursts.length} bursts`)
console.log(JSON.stringify(report.aggregate, null, 2))

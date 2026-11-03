import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cpus, platform, release, totalmem } from 'node:os'
const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const { chromium } = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime)
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const trials = Number(process.env.TRIALS || 3)
const iterations = Number(process.env.ITERATIONS || 20)
assert.ok(Number.isInteger(trials) && trials > 0 && Number.isInteger(iterations) && iterations > 0)
const base = process.env.BASE_URL || 'http://127.0.0.1:3020'
const output = process.env.OUTPUT || 'cypress/results/ime/flow-comparison.json'
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
  return { count: sorted.length, min: sorted[0], p50: at(.5), p95: at(.95),
    p99: at(.99), max: sorted.at(-1) }
}
function summarize(records) {
  const mean = key => Object.fromEntries(Object.keys(records[0][key]).map(name =>
    [name, records.reduce((sum, record) => sum + record[key][name], 0) / records.length]))
  const worst = records.reduce((a, b) => b.ms > a.ms ? b : a)
  return { finalHandlerMs: distribution(records.map(r => r.ms)), meanWork: mean('work'),
    stagesMs: Object.fromEntries(Object.keys(records[0].stages).map(name =>
      [name, distribution(records.map(r => r.stages[name]))])), slowest: worst }
}
const report = { date: new Date().toISOString(), passed: false, browser: browser.version(),
  node: process.version, machine: { cpu: cpus()[0]?.model, platform: platform(),
    release: release(), memory: totalmem() }, settings: { trials, iterations,
    warmup: 1, profile: 'sync', paragraphs: 1000, viewport: { width: 1366, height: 720 }, dpr: 1 },
  semantics: 'Same-code counterfactual: incrementalCommit=false/true; all earlier incremental features stay enabled. Synchronous compositionend handler/geometry timings exclude later paint, notifications and presentation. Inclusive stages overlap. Work is measured through the next rAF. Synthetic events, not OS IME.',
  sourceHashes: {}, fonts: {}, results: [], errors: [] }
for (const file of ['src/editor/core/layout/IncrementalFlow.ts',
  'src/editor/core/layout/FlowCheckpoint.ts', 'src/editor/core/layout/ParagraphIndex.ts',
  'src/editor/core/layout/relativeLayout.ts', 'src/editor/core/layout/NativeQueryIndex.ts',
  'src/editor/core/draw/Draw.ts', 'src/editor/core/position/Position.ts',
  'src/editor/core/position/PositionList.ts', 'src/editor/core/draw/interactive/Area.ts',
  'src/editor/core/event/CanvasEvent.ts', 'src/editor/core/event/handlers/input.ts',
  'src/editor/utils/option.ts', 'src/editor/utils/performanceProfile.ts',
  'tests/fixtures/migration/ime-performance.ts', 'scripts/test-ime-flow.mjs'])
  report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
for (const file of ['NotoSans-Latin-Regular.woff2', 'NotoSansSC-Regular.woff2'])
  report.fonts[file] = createHash('sha256').update(await readFile('tests/fixtures/fonts/' + file)).digest('hex')
const groups = new Map()
try {
  for (let trial = 0; trial < trials; trial++)
    for (const kind of (process.env.CASES || 'stable,wrap,page').split(','))
      for (const incrementalCommit of trial % 2 ? [true, false] : [false, true]) {
        const page = await browser.newPage({ viewport: report.settings.viewport, deviceScaleFactor: 1 })
        page.on('pageerror', error => report.errors.push(error.message))
        await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-performance.html')
        await page.waitForFunction(() => window.imePerformance)
        await page.evaluate(config => window.imePerformance.setup(config),
          { profile: 'sync', sample: '1000', preview: true, instrumentation: false, incrementalCommit })
        const records = await page.evaluate(({ kind, iterations }) =>
          window.imePerformance.flowTrial(kind, iterations), { kind, iterations })
        const key = `${kind}:${incrementalCommit}`
        groups.set(key, [...(groups.get(key) || []), ...records])
        report.results.push({ kind, incrementalCommit, trial, ...summarize(records) })
        await page.evaluate(() => window.imePerformance.dispose())
        await page.close()
        console.log(`PASS flow ${kind} enabled=${incrementalCommit} trial=${trial}`)
      }
  report.aggregate = [...groups].map(([key, records]) => {
    const [kind, enabled] = key.split(':')
    return { kind, incrementalCommit: enabled === 'true', ...summarize(records) }
  })
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
}

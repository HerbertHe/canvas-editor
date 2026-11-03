import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { platform, release, cpus, totalmem } from 'node:os'

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const engines = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime)
const engine = process.env.BROWSER || 'chromium'
const browser = await engines[engine].launch({ headless: process.env.HEADED !== '1',
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const base = process.env.BASE_URL || 'http://127.0.0.1:3014'
const output = process.env.OUTPUT || 'cypress/results/ime/comparison.json'
const trials = Number(process.env.TRIALS || 3)
assert.ok(Number.isInteger(trials) && trials > 0)
const interval = Number(process.env.INTERVAL_MS || 33)
assert.ok(Number.isFinite(interval) && interval > 0)
const report = { date: new Date().toISOString(), node: process.version,
  machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model, memory: totalmem() },
  browser: browser.version(), engine, results: [], errors: [], sourceHashes: {}, fonts: {},
  settings: { trials, intervalMs: interval, warmup: 0,
    instrumentation: process.env.INSTRUMENTATION !== 'off',
    viewport: { width: 1366, height: 720 }, dpr: 1 },
  manualSystemIME: 'pending', passed: false }
for (const path of ['src/editor/core/event/CompositionSession.ts',
  'src/editor/core/event/CanvasEvent.ts', 'src/editor/core/draw/Draw.ts',
  'src/editor/core/draw/CompositionPreview.ts', 'src/editor/core/cursor/CursorAgent.ts',
  'src/editor/core/cursor/Cursor.ts', 'tests/fixtures/migration/ime-performance.ts',
  'src/editor/core/event/handlers/composition.ts', 'src/editor/core/event/handlers/input.ts',
  'src/editor/index.ts', 'src/editor/utils/option.ts',
  'scripts/test-ime-performance.mjs'])
  report.sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex')
for (const name of ['NotoSans-Latin-Regular.woff2', 'NotoSansSC-Regular.woff2'])
  report.fonts[name] = createHash('sha256').update(await readFile('tests/fixtures/fonts/' + name)).digest('hex')
try {
  for (const sample of (process.env.SAMPLES || 'short,100,1000,long,table').split(','))
    for (const profile of (process.env.PROFILES || 'baseline,sync').split(','))
      for (const preview of [false, true]) for (let trial = 0; trial < trials; trial++) {
        const page = await browser.newPage({ viewport: { width: 1366, height: 720 }, deviceScaleFactor: 1 })
        page.on('pageerror', error => report.errors.push(error.message))
        await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-performance.html')
        await page.waitForFunction(() => window.imePerformance)
        const config = { sample, profile, preview,
          instrumentation: process.env.INSTRUMENTATION !== 'off' }
        await page.evaluate(config => window.imePerformance.setup(config), config)
        const result = await page.evaluate(async interval => window.imePerformance.replay(
          ['n', 'ni', 'nih', 'niha', 'nihao', 'niha', 'nihao'], '你好', interval), interval)
        assert.equal(result.mode, 'synthetic')
        assert.ok(result.events.every(event => !event.trusted))
        assert.equal(result.received, 7)
        assert.equal(result.submitted + result.merged + result.finalized, result.received)
        report.results.push({ trial, ...result })
        await page.evaluate(() => window.imePerformance.dispose())
        await page.close()
        console.log(`PASS IME ${sample} ${profile} preview=${preview} trial=${trial}`)
      }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
}

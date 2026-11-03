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
assert.ok(Number.isInteger(trials) && trials > 0 && Number.isInteger(iterations) && iterations > 0)
const output = process.env.OUTPUT || 'cypress/results/ime/long-comparison.json'
const cases = [['cjk', 'end'], ['latin', 'end'], ['cjk', 'middle']]
const report = { date: '2026-11-02', passed: false, browser: browser.version(),
  node: process.version, machine: { platform: platform(), release: release(),
    arch: arch(), cpu: cpus()[0]?.model, memoryGiB: totalmem() / 2 ** 30 },
  settings: { trials, iterations, values: ['n', 'ni', 'nih', 'niha', 'nihao', 'ni', ''],
    profile: 'sync', imePreview: true, incrementalCompute: false, deferredPaint: true,
    viewport: [1366, 720], dpr: 1, chromiumArgs: ['--disable-gpu'] },
  semantics: 'Vite development fixture. Synchronous input + explicit flushComposition(false), including any synchronous paint; scheduled later paint and next rAF excluded. Setup, warmup and undo excluded. Software rendering fixes the raster backend for exact pixel checks. Synthetic; not OS IME or presented FPS. Stage profiling is a separate run. measureMs is nested in geometryMs. shapeAndStylesMs includes shaping cache projection and paint styles, not only HarfBuzz. breakGlyphCopies counts copies appended to line glyph arrays, not total heap allocations. geometryItems counts native lines/glyphs/clusters/carets/inlines/labels, not bytes. Full model/coverage and synchronous paint overhead remain in total timing.',
  sourceHashes: {}, fonts: {}, checks: [], results: [], aggregate: [], profiling: [], errors: [] }
const sourceFiles = ['src/editor/core/draw/CompositionPreview.ts',
  'src/editor/core/text-engine/layout/TextLayoutEngine.ts',
  'src/editor/core/text-engine/layout/TextLayoutService.ts',
  'src/editor/core/text-engine/layout/LayoutWork.ts',
  'src/editor/core/text-engine/shape/RunShapeCache.ts',
  'src/editor/core/text-engine-host/LayoutHostAdapter.ts',
  'src/editor/core/event/CanvasEvent.ts', 'src/editor/core/draw/Draw.ts',
  'src/editor/utils/performanceProfile.ts', 'src/editor/utils/option.ts',
  'tests/fixtures/migration/ime-long.ts', 'scripts/test-ime-long.mjs']
for (const file of sourceFiles)
  report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
for (const file of ['tests/fixtures/fonts/NotoSans-Latin-Regular.woff2',
  'tests/fixtures/fonts/NotoSansSC-Regular.woff2', 'public/fonts/NotoNaskhArabic-Regular.ttf'])
  report.fonts[file] = createHash('sha256').update(await readFile(file)).digest('hex')
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) }
}
function summarize(samples) {
  return { ms: distribution(samples.map(s => s.ms)),
    local: samples.filter(s => s.local).length,
    fallback: samples.filter(s => !s.local).length,
    slowest: samples.reduce((a, b) => a.ms > b.ms ? a : b) }
}
async function open(enabled, kind, location) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-long.html')
  await page.waitForFunction(() => window.imeLong)
  const fixture = await page.evaluate(({ enabled, kind, location }) =>
    window.imeLong.setup(enabled, kind, location), { enabled, kind, location })
  return { page, fixture }
}
async function close(page) {
  await page.evaluate(() => window.imeLong.dispose())
  await page.close()
}
try {
  // Correctness and timing use separate pages/runs.
  for (const [kind, location] of [...cases, ['unicode', 'end'], ['arabic', 'end']]) {
    const results = []
    for (const enabled of [false, true]) {
      const { page } = await open(enabled, kind, location)
      results.push(await page.evaluate(() => window.imeLong.differential()))
      await close(page)
    }
    assert.equal(results[1].final, results[0].final)
    const comparison = await browser.newPage()
    for (let i = 0; i < results[0].results.length; i++) {
      const reference = results[0].results[i]
      const preview = results[1].results[i]
      const equal = await sameImePixels(comparison, preview.images, reference.images)
      if (!equal) {
        await mkdir('cypress/results/ime', { recursive: true })
        await writeFile('cypress/results/ime/long-geometry-diff.json', JSON.stringify({
          reference: reference.geometry, preview: preview.geometry,
          placements: [reference.placements, preview.placements] }, null, 2))
        for (let p = 0; p < reference.images.length; p++) {
          if (preview.images[p] === reference.images[p]) continue
          for (const [name, result] of [['reference', reference], ['preview', preview]])
            await writeFile(`cypress/results/ime/long-${name}-${p}.png`,
              Buffer.from(result.images[p].split(',')[1], 'base64'))
        }
        throw new Error(`${kind}/${location}/${i} pixels differ; PNGs saved. ` +
          JSON.stringify({ reference: reference.caret, preview: preview.caret,
            diagnostics: preview.diagnostics }))
      }
      assert.equal(preview.caret.pageNo, reference.caret.pageNo)
      for (const key of ['x', 'y', 'height'])
        assert.ok(Math.abs(preview.caret[key] - reference.caret[key]) < 1e-7,
          `${kind}/${location}/${i} caret ${key}`)
      if (kind === 'arabic') assert.equal(preview.diagnostics.local, false)
      report.checks.push({ kind, location, value: report.settings.values[i],
        pixels: true, caret: true, local: preview.diagnostics.local,
        work: preview.diagnostics.previewWork })
    }
    await comparison.close()
  }
  const raw = []
  if (!correctnessOnly) {
    for (let trial = 0; trial < trials; trial++) {
      for (const [kind, location] of cases) {
        for (const enabled of trial % 2 ? [true, false] : [false, true]) {
          const { page, fixture } = await open(enabled, kind, location)
          const result = await page.evaluate(iterations => window.imeLong.trial(iterations, false), iterations)
          raw.push({ kind, location, enabled, trial, samples: result.samples })
          report.results.push({ kind, location, enabled, trial, fixture, ...summarize(result.samples) })
          await close(page)
        }
      }
    }
    for (const [kind, location] of cases) {
      for (const enabled of [false, true]) {
        const samples = raw.filter(r => r.kind === kind && r.location === location &&
          r.enabled === enabled).flatMap(r => r.samples)
        report.aggregate.push({ kind, location, enabled, ...summarize(samples) })
        const { page } = await open(enabled, kind, location)
        const result = await page.evaluate(() => window.imeLong.trial(1, true))
        const mean = {}
        const meanRuns = {}
        const meanHostScan = { ms: 0, elements: 0 }
        for (const sample of result.samples)
          for (const [key, value] of Object.entries(sample.work))
            mean[key] = (mean[key] || 0) + value / result.samples.length
        for (const sample of result.samples) {
          for (const [key, value] of Object.entries(sample.runs))
            meanRuns[key] = (meanRuns[key] || 0) + value / result.samples.length
          meanHostScan.ms += sample.hostScan.ms / result.samples.length
          meanHostScan.elements += sample.hostScan.elements / result.samples.length
        }
        report.profiling.push({ kind, location, enabled, mean, meanRuns, meanHostScan,
          local: result.samples.filter(s => s.local).length,
          previewWork: result.samples.map(s => s.previewWork || null) })
        await close(page)
      }
    }
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(`PASS: ${report.checks.length} long-paragraph pixel/caret comparisons`)
console.log(JSON.stringify(report.aggregate, null, 2))

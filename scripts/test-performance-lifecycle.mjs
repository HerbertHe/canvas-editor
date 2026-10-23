import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const { chromium } = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime)
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const base = process.env.BASE_URL || 'http://127.0.0.1:3014'
const report = { passed: false, browser: browser.version(), cycles: [],
  note: 'Forced-GC page heap and short lifecycle cycles; excludes total process/native memory.' }
try {
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  const root = await browser.newBrowserCDPSession()
  for (let cycle = 0; cycle < 6; cycle++) {
    await page.goto(base + '/canvas-editor/tests/fixtures/migration/native-interaction.html?plain&advanced&tracked&worker&transfer')
    await page.waitForFunction(() => window.nativeInteraction)
    await page.evaluate(() => {
      const { draw, place } = window.nativeInteraction
      place(2)
      draw.getCursor().focus()
    })
    await page.keyboard.type('lifecycle')
    const diagnostics = await page.evaluate(async () => {
      const { draw } = window.nativeInteraction
      await draw.waitForWorkerLayout()
      const live = draw.getPerformanceDiagnostics()
      draw.destroy()
      const disposed = draw.getPerformanceDiagnostics()
      const canvases = document.querySelectorAll('canvas').length
      delete window.nativeInteraction
      return { live, disposed, canvases }
    })
    assert.equal(diagnostics.canvases, 0)
    assert.equal(diagnostics.disposed.worker.requests, 0)
    assert.equal(diagnostics.disposed.worker.waiting, false)
    assert.equal(diagnostics.disposed.paths.bytes, 0)
    assert.equal(diagnostics.disposed.pages.observed, 0)
    assert.equal(diagnostics.disposed.pages.dirty, 0)
    assert.ok((diagnostics.live.paths.bytes || 0) <= 4 * 1024 * 1024)
    assert.ok((diagnostics.live.runs.bytes || 0) <= 16 * 1024 * 1024)
    await page.waitForTimeout(150)
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = await cdp.send('Runtime.getHeapUsage')
    const { targetInfos } = await root.send('Target.getTargets')
    const workers = targetInfos.filter(target => target.type === 'worker').length
    assert.equal(workers, 0, 'Worker target retained after destroy')
    report.cycles.push({ cycle, heap, workers, ...diagnostics })
  }
  const heaps = report.cycles.map(cycle => cycle.heap.usedSize)
  // Not a process-memory guarantee: catch retained editors in this fixed fixture.
  assert.ok(heaps.at(-1) - heaps[0] < 8 * 1024 * 1024,
    'Post-destroy page heap grew beyond the lifecycle fixture allowance')
  report.passed = true
  console.log('PASS six create/edit/destroy cycles, worker targets and forced-GC page heap')
} finally {
  await mkdir('cypress/results/perf21', { recursive: true })
  await writeFile('cypress/results/perf21/lifecycle.json', JSON.stringify(report, null, 2))
  await browser.close()
}

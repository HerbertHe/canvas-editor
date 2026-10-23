import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const { chromium } = await import(runtime.startsWith('/')
  ? pathToFileURL(runtime).href : runtime)
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const output = process.env.OUTPUT || 'cypress/results/perf03-05/pipeline.json'
const report = { browser: browser.version(), results: [], sourceHashes: {} }
for (const file of ['scripts/test-render-pipeline.mjs',
  'src/editor/core/draw/Draw.ts', 'src/editor/interface/Draw.ts',
  'src/editor/core/event/handlers/input.ts'])
  report.sourceHashes[file] = createHash('sha256')
    .update(await readFile(file)).digest('hex')
try {
  for (const mode of ['paging', 'continuity']) {
    const page = await browser.newPage()
    await page.goto(base +
      '/canvas-editor/tests/fixtures/migration/native-interaction.html')
    await page.waitForFunction(() => window.nativeInteraction)
    const result = await page.evaluate(async mode => {
      const { draw } = window.nativeInteraction
      draw.getOptions().pageMode = mode
      draw.getOptions().lab.deferredPaint = true
      draw.getRange().setRange(2, 2)
      draw.render({ curIndex: 2, isSubmitHistory: false, isLazy: false })
      const raf = window.requestAnimationFrame
      const cancel = window.cancelAnimationFrame
      const callbacks = new Map()
      let id = 0
      window.requestAnimationFrame = fn => { callbacks.set(++id, fn); return id }
      window.cancelAnimationFrame = id => callbacks.delete(id)
      let paints = 0
      const paint = draw._drawPage
      draw._drawPage = function (...args) {
        paints++
        return paint.apply(this, args)
      }
      try {
        draw.getCanvasEvent().input('x')
        const paintAfterInput = paints
        const queuedAfterInput = callbacks.size
        const caret = draw.getPosition().getNativeCaret(3)
        if (!caret) throw new Error('Geometry not committed before paint')
        const first = await draw.getDataURL()
        const pendingAfterExport = draw.pendingPaint
        const second = await draw.getDataURL()
        if (JSON.stringify(first) !== JSON.stringify(second))
          throw new Error('Immediate export differs from settled render')
        draw.getCanvasEvent().input('y')
        const print = await draw.getDataURL({ mode: 'print' })
        const printAgain = await draw.getDataURL({ mode: 'print' })
        if (JSON.stringify(print) !== JSON.stringify(printAgain))
          throw new Error('Immediate print differs from settled render')
        draw.getCanvasEvent().input('z')
        draw.destroy()
        const before = paints
        for (const callback of callbacks.values()) callback(0)
        if (paints !== before) throw new Error('Paint after destroy')
        return { mode, paintAfterInput, queuedAfterInput, pendingAfterExport,
          exportsEqual: true, printEqual: true, paintAfterDestroy: paints - before,
          remainingCanvases: document.querySelectorAll('#editor canvas').length }
      } finally {
        window.requestAnimationFrame = raf
        window.cancelAnimationFrame = cancel
      }
    }, mode)
    assert.equal(result.pendingAfterExport, null)
    assert.equal(result.remainingCanvases, 0)
    assert.equal(result.paintAfterDestroy, 0)
    if (mode === 'paging') {
      assert.equal(result.paintAfterInput, 0)
      assert.equal(result.queuedAfterInput, 1)
    } else assert.ok(result.paintAfterInput > 0)
    report.results.push(result)
    await page.close()
  }
  report.passed = true
} finally {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log('PASS: immediate export/print, paused rAF, continuity and destruction')

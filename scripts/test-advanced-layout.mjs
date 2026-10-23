import { snapshot } from './layoutSnapshot.mjs'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const engines = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime)
const engine = process.env.BROWSER || 'chromium'
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine))
const browser = await engines[engine].launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const base = process.env.BASE_URL || 'http://127.0.0.1:3014'
const output = process.env.OUTPUT || 'cypress/results/perf11-20/differential.json'
const randomEdits = Number(process.env.RANDOM_EDITS || 0)
const seed = Number(process.env.SEED || 21)
assert.ok(Number.isInteger(randomEdits) && randomEdits >= 0)
let randomState = seed >>> 0
const random = () => (randomState = (1664525 * randomState + 1013904223) >>> 0)
const report = { engine, seed, randomEdits, browser: browser.version(), results: [], errors: [], sourceHashes: {} }
for (const file of ['scripts/test-advanced-layout.mjs',
  'scripts/layoutSnapshot.mjs',
  'src/editor/utils/performanceProfile.ts',
  'src/editor/utils/option.ts',
  'src/editor/core/event/CanvasEvent.ts',
  'src/editor/core/position/Position.ts',
  'src/editor/core/layout/NativeQueryIndex.ts',
  'src/editor/core/layout/FlowCheckpoint.ts',
  'src/editor/core/layout/IncrementalFlow.ts',
  'src/editor/core/text-engine/layout/LayoutKernel.ts',
  'src/editor/core/text-engine/shape/RunShapeCache.ts',
  'src/editor/core/text-engine/shape/HarfBuzzTextShaper.ts',
  'src/editor/core/text-engine/render/GlyphRenderer.ts',
  'src/editor/core/text-engine/font/GlyphOutline.ts',
  'src/editor/core/text-engine/font/FontManager.ts',
  'src/editor/core/worker/layout/LayoutWorkerClient.ts',
  'src/editor/core/worker/layout/LayoutWorkerServer.ts',
  'src/editor/core/worker/layout/layout.worker.ts',
  'src/editor/core/worker/layout/layoutCodec.ts',
  'src/editor/core/worker/layout/TransferBufferPool.ts',
  'src/editor/core/worker/layout/protocol.ts',
  'tests/fixtures/migration/native-interaction.ts',
  'vite.config.ts',
  'src/editor/core/draw/Draw.ts', 'src/editor/core/layout/ParagraphIndex.ts',
  'src/editor/core/draw/IncrementalParagraphComputer.ts',
  'src/editor/core/layout/relativeLayout.ts',
  'src/editor/core/history/HistoryManager.ts',
  'src/editor/core/history/EditTransaction.ts',
  'src/editor/core/text-engine-host/LayoutHostAdapter.ts',
  'src/editor/core/text-engine/font/FontCoverageTracker.ts',
  'src/editor/core/worker/WorkerRequestRegistry.ts',
  'src/editor/core/worker/WorkerManager.ts'])
  report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')


try {
  for (const kind of ['plain', 'mixed', 'tables']) for (const rtl of [false, true]) {
    const tables = kind === 'tables'
    const pages = []
    for (const mode of ['legacy', 'advanced', 'worker', 'transfer']) {
      const tracked = mode !== 'legacy'
      const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
      const evaluate = page.evaluate.bind(page)
      page.evaluate = async (...args) => {
        let timer
        try {
          return await Promise.race([evaluate(...args), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('QA evaluate exceeded 60s')), 60000)
          })])
        } finally { clearTimeout(timer) }
      }
      page.on('pageerror', error => report.errors.push(error.message))
      const params = [tables ? 'tables' : '', rtl ? 'rtl' : '',
        kind === 'plain' ? 'plain' : '',
        tracked ? 'advanced' : '', ['worker', 'transfer'].includes(mode) ? 'worker' : '',
        mode === 'transfer' ? 'transfer' : '',
        tracked ? 'tracked' : ''].filter(Boolean).join('&')
      await page.goto(base + '/canvas-editor/tests/fixtures/migration/native-interaction.html?' + params)
      await page.waitForFunction(() => window.nativeInteraction)
      await page.evaluate(tables => {
        const { draw, place } = window.nativeInteraction
        if (tables) {
          const index = draw.getOriginalMainElementList().findIndex(e => e.type === 'table')
          const table = draw.getOriginalMainElementList()[index]
          const cell = table.trList[1].tdList[0]
          draw.getPosition().setPositionContext({ isTable: true, index,
            trIndex: 1, tdIndex: 0, tdId: cell.id })
        }
        place(2)
        draw.getCursor().focus()
      }, tables)
      pages.push(page)
    }
    let checks = 0
    const compare = async (history = false) => {
      for (const page of pages) await page.evaluate(() => window.nativeInteraction.draw.waitForWorkerLayout())
      const expected = await snapshot(pages[0])
      // Delta undo restores the pre-edit selection, including cursor movement
      // since the last edit. Legacy snapshots restore the last edit's cursor.
      // Selection restoration is asserted separately in native-interaction tests.
      if (history) delete expected.range
      for (const page of pages.slice(1)) {
        const actual = await snapshot(page)
        if (history) delete actual.range
        assert.deepEqual(actual, expected)
        checks++
      }
    }
    console.log('CHECK initial', kind, rtl)
    await compare()
    for (const action of ['x', 'y', 'Backspace', 'ArrowLeft', 'Delete', 'Enter', 'é']) {
      for (const page of pages) {
        if (action === 'é') await page.keyboard.insertText(action)
        else await page.keyboard.press(action)
        await page.evaluate(() => window.nativeInteraction.draw.getHistoryManager().closeGroup())
      }
      await compare()
    }
    for (const direction of ['undo', 'undo', 'undo', 'redo', 'redo', 'redo']) {
      for (const page of pages)
        await page.evaluate(direction => window.nativeInteraction.command[direction](), direction)
      await compare(true)
    }
    if (kind === 'plain') {
      // No wait between keys: each geometry consumer must flush safely.
      for (const page of pages) {
        for (const action of ['a', 'b', 'Backspace', 'ArrowLeft', 'Delete'])
          await page.keyboard.press(action)
      }
      await compare()
      for (const page of pages) await page.evaluate(() => {
        const host = window.nativeInteraction.draw.getCanvasEvent()
        host.compositionstart()
        host.input('n')
        host.input('ni')
        host.compositionend(new CompositionEvent('compositionend', { data: '你' }))
      })
      await compare()
      for (const page of pages) await page.evaluate(async () => {
        const { draw } = window.nativeInteraction
        draw.getCanvasEvent().input('z')
        // Font/resize updates race the in-flight result; old results must not commit.
        draw.getOptions().width += 10
        draw.render({ isSubmitHistory: false, curIndex: draw.getRange().getRange().endIndex })
        const face = draw.getOptions().fonts[0]
        await draw.registerFonts([{ ...face, resourceId: 'advanced-qa-font' }])
      })
      await compare()
      for (const page of pages.slice(2)) await page.evaluate(async () => {
        const { draw } = window.nativeInteraction
        await draw.waitForWorkerLayout()
        const response = await draw.inspectLayoutWorker()
        if (JSON.stringify(response.model) !== JSON.stringify(draw.captureEditModel()))
          throw new Error('Worker mirror does not match the authoritative model')
        draw.getCanvasEvent().input('r')
        const worker = draw.layoutWorkerClient.worker
        worker.onerror?.call(worker, new ErrorEvent('error', { message: 'QA crash' }))
        await draw.waitForWorkerLayout()
        const diagnostics = draw.getPerformanceDiagnostics().worker
        if (!diagnostics.ready || diagnostics.needsResync || diagnostics.requests)
          throw new Error('Worker did not recover after the injected crash')
        // Force bounded edit-queue backpressure without changing the model.
        // The next ordinary input must survive and the idle mirror must resync.
        const client = draw.layoutWorkerClient
        const budget = client.byteBudget
        client.byteBudget = 1
        try { draw.getCanvasEvent().input('q') }
        finally { client.byteBudget = budget }
        await draw.waitForWorkerLayout()
        const recovered = draw.getPerformanceDiagnostics().worker
        if (!recovered.ready || recovered.needsResync || recovered.requests)
          throw new Error('Worker did not recover from edit-queue backpressure')
        const mirror = await draw.inspectLayoutWorker()
        if (JSON.stringify(mirror.model) !== JSON.stringify(draw.captureEditModel()))
          throw new Error('Recovered Worker mirror differs after backpressure')
      })
      for (const page of pages.slice(0, 2))
        await page.evaluate(() => {
          window.nativeInteraction.draw.getCanvasEvent().input('r')
          window.nativeInteraction.draw.getCanvasEvent().input('q')
        })
      await compare()
    }
    console.log('CHECK fixed actions', kind, rtl)
    const actions = ['x', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight',
      'Enter', 'é', 'مرحبا', '👩‍👩‍👧‍👦']
    const randomActions = []
    for (let step = 0; step < randomEdits; step++) {
      const action = actions[random() % actions.length]
      randomActions.push(action)
      console.log('CHECK random', kind, rtl, step, action)
      for (const page of pages) {
        if (action === 'x' || action.startsWith('Arrow') ||
          ['Enter', 'Backspace', 'Delete'].includes(action))
          await page.keyboard.press(action)
        else await page.keyboard.insertText(action)
        await page.evaluate(() => window.nativeInteraction.draw.getHistoryManager().closeGroup())
      }
      await compare()
    }
    console.log('CHECK export', kind, rtl)
    const images = []
    for (const page of pages) images.push(await page.evaluate(() => window.nativeInteraction.draw.getDataURL()))
    const pixels = []
    for (const [mode, actual] of images.entries()) {
      const difference = await pages[0].evaluate(async ({ expected, actual }) => {
        if (expected.length !== actual.length)
          return { pagesEqual: false, expected: expected.length, actual: actual.length }
        const decode = async url => {
          const image = new Image()
          image.src = url
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          const ctx = canvas.getContext('2d')
          ctx.drawImage(image, 0, 0)
          return { width: canvas.width, height: canvas.height,
            data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
        }
        let channels = 0, maxDelta = 0
        for (let i = 0; i < expected.length; i++) {
          const a = await decode(expected[i]), b = await decode(actual[i])
          if (a.width !== b.width || a.height !== b.height) return { dimensionsEqual: false }
          for (let c = 0; c < a.data.length; c++) {
            const delta = Math.abs(a.data[c] - b.data[c])
            if (delta) channels++
            maxDelta = Math.max(maxDelta, delta)
          }
        }
        return { pagesEqual: true, channels, maxDelta }
      }, { expected: images[0], actual })
      pixels.push({ mode, ...difference })
      if (difference.channels !== 0) {
        const artifacts = output.replace(/\.json$/, '-pixels')
        await mkdir(artifacts, { recursive: true })
        for (const [index, url] of images[0].entries())
          await writeFile(`${artifacts}/${kind}-${rtl}-expected-${index}.png`, Buffer.from(url.split(',')[1], 'base64'))
        for (const [index, url] of actual.entries())
          await writeFile(`${artifacts}/${kind}-${rtl}-mode${mode}-${index}.png`, Buffer.from(url.split(',')[1], 'base64'))
        console.log('PIXEL DIFFERENCE', kind, rtl, mode, difference)
      }
      assert.equal(difference.channels, 0, `Canvas pixels differ: ${kind}/${rtl}/mode${mode}`)
    }
    const executor = await pages[2].evaluate(() => window.nativeInteraction.draw.getLayoutWorkerStats())
    if (kind === 'plain') assert.ok(executor.committed > 0, 'No worker geometry was committed')
    const transfer = await pages[3].evaluate(() => window.nativeInteraction.draw.getLayoutWorkerStats())
    if (kind === 'plain') assert.ok(transfer.packedResponses > 0, 'No transferred geometry')
    const workers = await pages[1].evaluate(async () => {
      const { draw } = window.nativeInteraction
      const manager = draw.getWorkerManager()
      const before = draw.getElementList().map(e => e.value).join('')
      const first = manager.getValue()
      const firstColor = draw.getOptions().defaultColor
      draw.getCanvasEvent().input('Q')
      draw.getOptions().defaultColor = '#123456'
      const second = manager.getValue()
      const [a, b, count1, count2, catalog1, catalog2] = await Promise.all([
        first, second, manager.getWordCount(), manager.getWordCount(),
        manager.getCatalog(), manager.getCatalog()
      ])
      if (a.options.defaultColor !== firstColor || b.options.defaultColor !== '#123456')
        throw new Error('getValue options are not request snapshots')
      if (JSON.stringify(a.data) === JSON.stringify(b.data)) throw new Error('getValue snapshots were overwritten')
      if (count1 !== count2 || JSON.stringify(catalog1) !== JSON.stringify(catalog2))
        throw new Error('Concurrent derived requests differ')
      const pending = manager.getValue().then(() => false, error => /destroyed/.test(error.message))
      draw.destroy()
      if (!await pending) throw new Error('Destroy did not reject pending request')
      return { snapshotsIndependent: true, pendingRejected: true,
        beforeLength: before.length, count: count1 }
    })
    report.results.push({ kind, tables, rtl, checks, randomActions, pixels, exportsEqual: true, workers, executor, transfer })
    for (const page of pages) {
      await page.evaluate(() => window.nativeInteraction.draw.destroy())
      await page.close()
    }
    console.log(`PASS advanced layout: kind=${kind}, rtl=${rtl}`)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
}

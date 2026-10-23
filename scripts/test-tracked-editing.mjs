import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const { chromium } = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime)
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const base = process.env.BASE_URL || 'http://127.0.0.1:3014'
const output = process.env.OUTPUT || 'cypress/results/perf06-10/differential.json'
const report = { browser: browser.version(), results: [], errors: [], sourceHashes: {} }
for (const file of ['scripts/test-tracked-editing.mjs',
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

async function snapshot(page) {
  return page.evaluate(() => {
    const { draw, lineCarets } = window.nativeInteraction
    const position = draw.getPosition()
    const scopes = [{ id: 'main', elements: draw.getOriginalMainElementList(),
      positions: position.getOriginalMainPositionList() }]
    const visit = (elements, path) => {
      elements.forEach((element, e) => (element.trList || []).forEach((row, r) =>
        row.tdList.forEach((cell, c) => {
          const id = `${path}/${e}/${r}/${c}`
          scopes.push({ id, elements: cell.value, positions: cell.positionList || [] })
          visit(cell.value, id)
        })))
    }
    visit(draw.getOriginalMainElementList(), 'main')
    return {
      range: { start: draw.getRange().getRange().startIndex,
        end: draw.getRange().getRange().endIndex },
      scopes: scopes.map(scope => ({ id: scope.id,
        text: scope.elements.map(element => element.value).join(''),
        positions: scope.positions.map(item => ({ index: item.index,
          pageNo: item.pageNo, coordinate: item.coordinate })),
        lines: position.getNativeLines(scope.positions).map(placed => ({
          pageNo: placed.pageNo, x: placed.x, y: placed.y, scale: placed.scale,
          carets: lineCarets(placed).map(c => ({ index: c.index, x: c.x, y: c.y,
            height: c.height, affinity: c.affinity, bidiLevel: c.bidiLevel })),
          glyphs: placed.line.glyphs,
          inlines: placed.line.inlines.map(item => ({ kind: item.kind, rect: item.rect,
            text: item.kind === 'missingGlyph' ? item.text : undefined }))
        }))
      }))
    }
  })
}
try {
  for (const tables of [false, true]) for (const rtl of [false, true]) {
    const pages = []
    for (const mode of ['legacy-cache', 'tracked-cache', 'tracked-uncached']) {
      const tracked = mode !== 'legacy-cache'
      const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
      page.on('pageerror', error => report.errors.push(error.message))
      const params = [tables ? 'tables' : '', rtl ? 'rtl' : '',
        mode !== 'tracked-uncached' ? 'incremental' : '',
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
    const images = []
    for (const page of pages) images.push(await page.evaluate(() => window.nativeInteraction.draw.getDataURL()))
    assert.deepEqual(images[1], images[0], 'Canvas export differs')
    assert.deepEqual(images[2], images[0], 'Uncached Canvas export differs')
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
    report.results.push({ tables, rtl, checks, exportsEqual: true, workers })
    for (const page of pages) await page.close()
    console.log(`PASS tracked editing: tables=${tables}, rtl=${rtl}`)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
}

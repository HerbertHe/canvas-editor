import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

// Real-font geometry differential; optional QA Playwright, never a dependency.
const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const { chromium } = await import(
  runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime
)
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const output = process.env.OUTPUT || 'cypress/results/perf02/geometry.json'
await mkdir(dirname(output), { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {})
})
const report = { browser: browser.version(), results: [], errors: [], heap: [] }
report.source = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8'
}).trim()
report.sourceHashes = {}
for (const file of [
  'scripts/test-line-geometry.mjs',
  'src/editor/core/position/Position.ts',
  'src/editor/core/layout/LineGeometryIndex.ts',
  'src/editor/core/layout/InteractionGeometry.ts',
  'src/editor/core/layout/NativeQueryIndex.ts',
  'tests/fixtures/migration/LegacyNativeQuery.ts',
  'tests/fixtures/migration/compareNativeQueries.ts'
]) report.sourceHashes[file] = createHash('sha256')
  .update(await readFile(file)).digest('hex')
try {
  for (const tables of [false, true])
    for (const rtl of [false, true])
      for (const incremental of [false, true]) {
        if (process.env.MEMORY_ONLY === '1' && (tables || rtl || incremental))
          continue
        const page = await browser.newPage({
          viewport: { width: 1366, height: 720 }
        })
        page.on('pageerror', error => report.errors.push(error.message))
        await page.goto(base +
          '/canvas-editor/tests/fixtures/migration/native-interaction.html?' +
          [tables ? 'tables' : '', rtl ? 'rtl' : '',
            incremental ? 'incremental' : ''].filter(Boolean).join('&'))
        await page.waitForFunction(() => window.nativeInteraction)
        for (const scale of [0.75, 1.25, 1.75]) {
          const result = await page.evaluate(async scale => {
            const { LineGeometryCache, LineGeometryIndex } = await import(
              '/canvas-editor/src/editor/core/layout/LineGeometryIndex.ts'
            )
            const legacy = await import(
              '/canvas-editor/src/editor/core/layout/InteractionGeometry.ts'
            )
            const { compareNativeQueries } = await import(
              '/canvas-editor/tests/fixtures/migration/compareNativeQueries.ts'
            )
            const { draw } = window.nativeInteraction
            const position = draw.getPosition()
            const build = LineGeometryIndex.create
            const compute = position.computePageRowPosition
            const invalidate = LineGeometryCache.prototype.invalidate
            const built = new WeakSet()
            LineGeometryCache.prototype.invalidate = function (placed) {
              if (built.delete(placed)) expectedBuilds++
              return invalidate.call(this, placed)
            }
            let builds = 0
            let expectedBuilds = 0
            LineGeometryIndex.create = function (...args) {
              builds++
              built.add(args[0])
              return build.apply(this, args)
            }
            position.computePageRowPosition = function (payload) {
              expectedBuilds += payload.rowList.filter(r => r.nativeLine).length
              return compute.call(this, payload)
            }
            try {
              draw.getOptions().scale = scale
              draw.render({ isLazy: false, isSubmitHistory: false,
                isSetCursor: false })
            } finally {
              LineGeometryIndex.create = build
              position.computePageRowPosition = compute
              LineGeometryCache.prototype.invalidate = invalidate
            }
            if (builds !== expectedBuilds)
              throw new Error(`Geometry builds: ${builds} != ${expectedBuilds}`)
            const lists = new Set([position.getOriginalMainPositionList()])
            const rows = []
            const visitRows = list => {
              for (const row of list) {
                rows.push(row)
                for (const repeat of row.repeatTdPositionList || []) {
                  lists.add(repeat.positionList)
                  visitRows(repeat.td.rowList || [])
                }
              }
            }
            const visit = elements => {
              for (const element of elements)
                for (const row of element.trList || [])
                  for (const td of row.tdList) {
                    lists.add(td.positionList || [])
                    visitRows(td.rowList || [])
                    visit(td.value)
                  }
            }
            draw.getLayoutPages().forEach(visitRows)
            visit(draw.getOriginalMainElementList())
            for (const direction of ['vertical', 'horizontal'])
              lists.add(draw.getHeader().getPositionList(direction))
            const cache = new LineGeometryCache()
            let placements = 0
            let clipped = 0
            let carets = 0
            let queries = 0
            let rowLookups = 0
            let nativeQueryChecks = 0
            const same = (a, b, label) => {
              if (JSON.stringify(a) !== JSON.stringify(b))
                throw new Error(`Geometry mismatch: ${label}`)
            }
            for (const list of lists) {
              const lines = position.getNativeLines(list)
              const before = JSON.stringify(lines.map(p => p.line))
              nativeQueryChecks += compareNativeQueries(lines)
              for (const placed of lines) {
                const index = cache.get(placed)
                placements++
                if (placed.clip) clipped++
                carets += index.carets.length
                same(index.carets, legacy.lineCarets(placed), 'carets')
                same(index.segments, legacy.lineSegments(placed), 'segments')
                for (let i = placed.line.source.start - 1;
                  i <= placed.line.source.end; i++) {
                  same(index.getElementRects(i),
                    legacy.textRangeRects(placed, i, i + 1), 'element rect')
                  same(index.getCarets(i),
                    legacy.lineCarets(placed).filter(c => c.index === i),
                    'element carets')
                  queries++
                }
              }
              const candidates = [
                ...rows.filter(row => row.nativeLine),
                ...lines.map(placed => ({ nativeLine: placed.line }))
              ]
              for (const row of candidates) {
                for (const pageNo of [undefined, 0, 1, 100]) {
                  const expected = lines.find(p => p.line === row.nativeLine &&
                    (pageNo === undefined || p.pageNo === pageNo)) ||
                    lines.find(p => p.line.id === row.nativeLine.id &&
                      p.line.source.scope === row.nativeLine.source.scope &&
                      (pageNo === undefined || p.pageNo === pageNo ||
                        /^(header|footer):/.test(p.line.source.scope)))
                  if (position.getNativeRow(row, list, pageNo) !== expected)
                    throw new Error('Native row lookup mismatch')
                  rowLookups++
                }
              }
              same(lines.map(p => p.line), JSON.parse(before), 'model mutation')
            }
            return { scale, builds, expectedBuilds, placements, clipped,
              carets, queries, rowLookups, nativeQueryChecks }
          }, scale)
          assert.ok(result.placements > 0)
          assert.ok(result.queries > 0)
          if (tables) assert.ok(result.clipped > 0)
          report.results.push({ tables, rtl, incremental, ...result })
          console.log(`PASS geometry: ${tables}/${rtl}/${incremental}/${scale}`)
        }
        if (!tables && !rtl && !incremental) {
          const cdp = await page.context().newCDPSession(page)
          for (let batch = 0; batch < 6; batch++) {
            await page.evaluate(async () => {
              const { draw } = window.nativeInteraction
              for (let i = 0; i < 10; i++)
                draw.render({ isLazy: false, isSubmitHistory: false,
                  isSetCursor: false })
              await new Promise(resolve => requestAnimationFrame(() =>
                requestAnimationFrame(resolve)))
            })
            await cdp.send('HeapProfiler.collectGarbage')
            report.heap.push({ batch,
              ...(await cdp.send('Runtime.getHeapUsage')) })
          }
          // Diagnostic retained JS heap budget after warmup, not total native,
          // GPU or WASM memory. Keep raw samples instead of claiming zero cost.
          const warm = report.heap[0].usedSize
          assert.ok(report.heap.at(-1).usedSize <= warm + 1024 * 1024,
            'Geometry retained heap grew by more than 1 MiB over 60 rebuilds')
          await cdp.detach()
        }
        const released = await page.evaluate(() => {
          const { draw } = window.nativeInteraction
          const position = draw.getPosition()
          const list = position.getOriginalMainPositionList()
          const row = draw.getLayoutPages()[0][0]
          draw.destroy()
          return position.getNativeLines(list).length === 0 &&
            position.getNativeRow(row, list) === undefined &&
            document.querySelectorAll('#editor canvas').length === 0
        })
        assert.ok(released)
        await page.close()
      }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
}

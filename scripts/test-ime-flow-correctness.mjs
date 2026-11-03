import assert from 'node:assert/strict'
import { launchImeBrowser } from './ime-browser.mjs'
const browser = await launchImeBrowser()
const base = process.env.BASE_URL || 'http://127.0.0.1:3020'
const errors = []
let checks = 0
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-performance.html')
  await page.waitForFunction(() => window.imePerformance)
  for (const incrementalCommit of [false, true])
    for (const kind of ['stable', 'wrap', 'page']) {
      await page.evaluate(config => window.imePerformance.setup(config),
        { profile: 'sync', sample: '1000', preview: true, instrumentation: false, incrementalCommit })
      assert.equal(await page.evaluate(kind => window.imePerformance.flowDifferential(kind), kind), true)
      checks++
    }
  await page.evaluate(() => window.imePerformance.dispose())
  assert.deepEqual(errors, [])
} finally { await browser.close() }
console.log(`PASS: ${checks} thousand-paragraph flow/position/pixel differentials`)

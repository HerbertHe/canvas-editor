import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchImeBrowser } from './ime-browser.mjs'
const browser = await launchImeBrowser()
const base = process.env.BASE_URL || 'http://127.0.0.1:3020'
const report = { passed: false, browser: browser.version(), cases: [], errors: [],
  semantics: 'Synthetic semantic/worker assertions, not real OS IME or presentation timing.' }
try {
  for (const denied of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
    page.on('pageerror', error => report.errors.push(error.message))
    if (denied) await page.addInitScript(() => {
      window.Worker = class { constructor() { throw new Error('CSP worker-src none') } }
    })
    await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-performance.html')
    await page.waitForFunction(() => window.imePerformance)
    for (const profile of denied ? ['sync'] : (process.env.PROFILES?.split(',') || ['baseline', 'sync', 'worker'])) {
      for (const sample of denied ? ['short'] : (process.env.SAMPLES?.split(',') || ['short', '100', '1000', 'long', 'table'])) {
        await page.evaluate(config => window.imePerformance.setup(config),
          { profile, sample, preview: true, instrumentation: false })
        const result = await page.evaluate(() => window.imePerformance.closure())
        report.cases.push({ profile, sample, denied, ...result })
      }
    }
    if (!denied) {
      await page.evaluate(() => window.imePerformance.setup({ profile: 'worker',
        sample: 'short', preview: true, instrumentation: false }))
      assert.equal(await page.evaluate(() => window.imePerformance.staleCompositionReply()), true)
      report.staleReplyDiscarded = true
    }
    await page.evaluate(() => window.imePerformance.dispose())
    await page.close()
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir('cypress/results/ime', { recursive: true })
  await writeFile('cypress/results/ime/commit-closure.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`PASS: ${report.cases.length} IME commit scenarios; delayed Worker response discarded`)

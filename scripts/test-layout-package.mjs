import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const engines = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime)
const engine = process.env.BROWSER || 'chromium'
const browser = await engines[engine].launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const report = { engine, browser: browser.version(), results: [], errors: [], consoleErrors: [] }
try {
  for (const path of ['native', 'bundled']) for (const policy of ['allowed', 'denied']) {
    const page = await browser.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push({ path, policy,
        text: message.text().slice(0, 400) })
    })
    await page.route('http://127.0.0.1:4179/**', async route => {
      if (route.request().resourceType() !== 'document') return route.continue()
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(),
        'content-security-policy': "default-src 'self'; connect-src 'self' data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src " + (policy === 'denied' ? "'none'" : "blob: 'self'") } })
    })
    await page.route('https://**/*', route => route.abort())
    await page.addInitScript(() => {
      window.layoutReplies = 0
      window.layoutAcks = 0
      window.packedReplies = 0
      const OriginalWorker = window.Worker
      window.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args)
          this.addEventListener('message', event => {
            if (event.data.type === 'ack') window.layoutAcks++
            if (event.data.type === 'layout') {
              window.layoutReplies++
              if (event.data.packed) window.packedReplies++
            }
          })
        }
      }
      for (const key of ['measureText', 'fillText', 'strokeText'])
        CanvasRenderingContext2D.prototype[key] = () => { throw new Error('Browser text API used') }
    })
    await page.goto(`http://127.0.0.1:4179/${path}/?worker&transfer`)
    await page.waitForFunction(() => window.migrationEditor ||
      document.querySelector('#status')?.textContent.startsWith('failed:'))
    assert.ok(await page.evaluate(() => !!window.migrationEditor),
      await page.locator('#status').textContent())
    if (policy === 'allowed') await page.waitForFunction(() => window.layoutAcks > 0)
    await page.evaluate(() => window.migrationEditor.command.executeSetRange(2, 2))
    await page.keyboard.press('x')
    if (policy === 'allowed') await page.waitForFunction(() => window.layoutReplies > 0)
    const result = await page.evaluate(async () => {
      const editor = window.migrationEditor
      const text = editor.command.getValue().data.main.map(element => element.value).join('')
      const images = await editor.command.getImage({ pixelRatio: 1 })
      const diagnostics = editor.getPerformanceDiagnostics()
      const result = { diagnostics, text: text.slice(0, 12), pages: images.length,
        layouts: window.layoutReplies, packed: window.packedReplies }
      editor.destroy()
      return result
    })
    assert.ok(result.text.includes('ofxfice'))
    assert.ok(result.pages > 0)
    if (policy === 'allowed') assert.ok(result.packed > 0)
    else assert.ok(result.diagnostics.utilityWorkers.fallbacks > 0)
    report.results.push({ path, policy, ...result })
    await page.close()
    console.log(`PASS packaged layout worker: /${path}/ CSP=${policy}`)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir('cypress/results/perf21', { recursive: true })
  await writeFile(`cypress/results/perf21/${engine}-package.json`, JSON.stringify(report, null, 2))
  await browser.close()
}

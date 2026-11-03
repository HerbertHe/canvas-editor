import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchImeBrowser } from './ime-browser.mjs'
const browser = await launchImeBrowser()
const base = process.env.BASE_URL || 'http://127.0.0.1:3020'
const report = { passed: false, browser: browser.version(), cases: [], errors: [],
  semantics: 'Synthetic events assert DOM geometry, not actual OS candidate-window position.' }
const close = (a, b, label) => assert.ok(Math.abs(a - b) < .1, `${label}: ${a} vs ${b}`)
function check(result, value) {
  close(result.style.left, result.expected.left, 'logical x')
  close(result.style.top, result.expected.top, 'logical y')
  close(result.style.height, result.expected.height, 'logical height')
  close(result.agent.left, result.caret.left, 'viewport x')
  close(result.agent.top, result.caret.top, 'viewport y')
  close(result.agent.height, result.caret.height, 'viewport height')
  for (const port of result.ports) {
    assert.ok(result.caret.left >= port.left && result.caret.right <= port.right,
      `${port.id} horizontal clipping: ${JSON.stringify(result)}`)
    assert.ok(result.caret.top >= port.top && result.caret.bottom <= port.bottom,
      `${port.id} vertical clipping: ${JSON.stringify(result)}`)
  }
  assert.ok(result.metrics.scrollHeight <= result.metrics.clientHeight + 2,
    `preedit must remain on one native textarea line: ${JSON.stringify(result.metrics)}`)
  assert.equal(result.value, value)
  assert.deepEqual(result.selection, [value.length, value.length])
  assert.equal(result.active, true)
  assert.equal(result.composition.active, true)
}
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 },
      deviceScaleFactor: dpr })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-anchor.html')
    await page.waitForFunction(() => window.imeAnchorQA)
    for (const sample of ['local', 'page', 'rtl', 'table']) {
      await page.evaluate(sample => window.imeAnchorQA.setup(sample), sample)
      await page.evaluate(() => {
        window.anchorFocusCalls = 0
        const agent = document.querySelector('#editor textarea')
        const focus = agent.focus.bind(agent)
        agent.focus = (...args) => { window.anchorFocusCalls++; return focus(...args) }
      })
      for (const value of ['nihao', 'n']) {
        const result = await page.evaluate(value => window.imeAnchorQA.preedit(value), value)
        check(result, value)
        if (sample === 'local') assert.equal(result.composition.local, true)
        if (sample === 'page') assert.ok(result.nativePage > 0)
        if (sample === 'rtl') assert.equal(result.dir, 'rtl')
      }
      const manual = await page.evaluate(async () => {
        const port = document.getElementById('inner')
        port.scrollTop += 10
        const expected = port.scrollTop
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
        return { expected, actual: port.scrollTop }
      })
      assert.equal(manual.actual, manual.expected)
      const scaled = await page.evaluate(() => window.imeAnchorQA.scale(1.5))
      check(scaled, 'n')
      assert.equal(scaled.composition.local, false)
      // External CSS transforms and editor zoom are different coordinate scales.
      await page.evaluate(() => {
        const port = document.getElementById('outer')
        port.style.transformOrigin = 'top left'
        port.style.transform = 'scale(.8)'
      })
      check(await page.evaluate(() => window.imeAnchorQA.preedit('ni')), 'ni')
      assert.equal(await page.evaluate(() => window.anchorFocusCalls), 0)
      // Explicit focus transfer must complete without a delayed focus steal.
      await page.locator('#outside').focus()
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)))
      assert.equal(await page.evaluate(() => document.activeElement.id), 'outside')
      assert.equal(await page.evaluate(() => window.imeAnchorQA.snapshot().composition.active), false)
      await page.evaluate(() => {
        document.getElementById('outer').style.transform = ''
        window.imeAnchorQA.dispose()
      })
      report.cases.push({ sample, dpr, passed: true })
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir('cypress/results/ime', { recursive: true })
  await writeFile('cypress/results/ime/anchor-geometry.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`PASS: ${report.cases.length} IME anchor scenarios`)

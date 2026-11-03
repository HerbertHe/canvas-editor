import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchImeBrowser, sameImePixels } from './ime-browser.mjs'
const browser = await launchImeBrowser()
const base = process.env.BASE_URL || 'http://127.0.0.1:3014'
const report = { results: [], errors: [], browser: browser.version(), passed: false }
try {
  for (const sample of ['short', '100']) {
    const pages = []
    for (const preview of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
      page.on('pageerror', error => report.errors.push(error.message))
      await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-performance.html')
      await page.waitForFunction(() => window.imePerformance)
      await page.evaluate(config => window.imePerformance.setup(config),
        { profile: 'sync', preview, sample })
      pages.push(page)
    }
    for (const value of ['n', 'ni', 'nihao', 'ni', '', '你好']) {
      const results = []
      for (const page of pages)
        results.push(await page.evaluate(value => window.imePerformance.preedit(value), value))
      if (!await sameImePixels(pages[0], results[1].images, results[0].images)) {
        await mkdir('cypress/results/ime', { recursive: true })
        for (let i = 0; i < results[0].images.length; i++) {
          if (results[0].images[i] === results[1].images[i]) continue
          for (const [mode, result] of [['reference', results[0]], ['preview', results[1]]])
            await writeFile(`cypress/results/ime/pixel-${mode}-${i}.png`,
              Buffer.from(result.images[i].split(',')[1], 'base64'))
          const delta = await pages[0].evaluate(async images => {
            const pixels = []
            let width, height
            for (const src of images) {
              const img = new Image(); img.src = src; await img.decode()
              const canvas = document.createElement('canvas')
              canvas.width = width = img.width; canvas.height = height = img.height
              const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
              pixels.push(ctx.getImageData(0, 0, width, height).data)
            }
            let changed = 0, left = width, right = 0, top = height, bottom = 0
            for (let n = 0; n < pixels[0].length; n += 4)
              if ([0, 1, 2, 3].some(c => pixels[0][n + c] !== pixels[1][n + c])) {
                changed++; const x = (n / 4) % width, y = Math.floor(n / 4 / width)
                left = Math.min(left, x); right = Math.max(right, x)
                top = Math.min(top, y); bottom = Math.max(bottom, y)
              }
            return { changed, left, right, top, bottom }
          }, [results[0].images[i], results[1].images[i]])
          throw new Error(`IME preview pixels differ: ${sample}/${value} page=${i} ${JSON.stringify(delta)}`)
        }
      }
      assert.equal(results[1].composition.local, true)
      report.results.push({ sample, value, pages: results[0].images.length, pixelsEqual: true })
    }
    await mkdir('cypress/results/ime', { recursive: true })
    await pages[1].screenshot({ path: `cypress/results/ime/preview-${sample}.png` })
    for (const page of pages) {
      await page.evaluate(() => window.imePerformance.dispose())
      await page.close()
    }
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await mkdir('cypress/results/ime', { recursive: true })
  await writeFile('cypress/results/ime/preview-differential.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`PASS: ${report.results.length} IME pixel comparisons`)

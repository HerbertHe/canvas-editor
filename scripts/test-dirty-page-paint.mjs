import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
const { chromium } = await import(runtime.startsWith('/')
  ? pathToFileURL(runtime).href : runtime)
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
const base = process.env.BASE_URL || 'http://127.0.0.1:3014'
const results = []
try {
  for (const advanced of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
    await page.goto(base + '/canvas-editor/tests/fixtures/migration/native-interaction.html?plain' +
      (advanced ? '&advanced&tracked' : ''))
    await page.waitForFunction(() => window.nativeInteraction)
    const setup = await page.evaluate(() => {
      const { draw } = window.nativeInteraction
      draw.getOptions().height = 350
      draw.render({ isSubmitHistory: false })
      window.paintObserver = draw.lazyRenderIntersectionObserver
      return { pages: draw.pageList.length }
    })
    assert.ok(setup.pages > 1, 'Offscreen fixture requires multiple pages')
    await page.waitForTimeout(150)
    await page.evaluate(() => {
      const { draw } = window.nativeInteraction
      draw.getOptions().background.color = '#123456'
      draw.render({ isCompute: false, isSubmitHistory: false })
      draw.pageList.at(-1).scrollIntoView()
    })
    await page.waitForTimeout(250)
    const result = await page.evaluate(advanced => {
      const { draw } = window.nativeInteraction
      const last = draw.pageList.at(-1)
      if (advanced && draw.lazyRenderIntersectionObserver !== window.paintObserver)
        throw new Error('Observer replaced during paint-only update')
      if (advanced && draw.dirtyPages.has(draw.pageList.length - 1))
        throw new Error('Entering viewport did not paint current page')
      if (advanced && draw.observedPages.size !== draw.pageList.length)
        throw new Error('Observer targets do not match pages')
      const pixel = [...last.getContext('2d').getImageData(0, 0, 1, 1).data]
      if (pixel.join(',') !== '18,52,86,255')
        throw new Error('Offscreen page did not paint the new background')
      return { pixels: last.toDataURL(), pages: draw.pageList.length }
    }, advanced)
    results.push(result)
    await page.evaluate(advanced => {
      const { draw } = window.nativeInteraction
      draw.getOptions().height = 1000
      draw.render({ isSubmitHistory: false })
      if (advanced && [...draw.observedPages].some(p => !draw.pageList.includes(p)))
        throw new Error('Removed page is still observed')
      if (advanced && draw.lazyRenderIntersectionObserver !== window.paintObserver)
        throw new Error('Observer replaced after page removal')
      draw.destroy()
      if (advanced && (draw.lazyRenderIntersectionObserver || draw.observedPages.size ||
        draw.visiblePages.size || draw.dirtyPages.size))
        throw new Error('Destroy retained page observation state')
    }, advanced)
    await page.close()
  }
  assert.deepEqual(results[1], results[0], 'Visible offscreen page differs before export')
  await mkdir('cypress/results/perf11-20', { recursive: true })
  await writeFile('cypress/results/perf11-20/dirty-paint.json', JSON.stringify({
    passed: true, browser: browser.version(), pages: results[0].pages,
    offscreenPixelsEqual: true, persistentObserver: true,
    removedPagesUnobserved: true, destroyed: true
  }, null, 2))
  console.log('PASS offscreen pixels, persistent observer, page removal and destroy')
} finally {
  await browser.close()
}

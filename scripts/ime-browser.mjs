import { pathToFileURL } from 'node:url'

export async function launchImeBrowser({ software = false } = {}) {
  const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright'
  const engines = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime)
  const name = process.env.BROWSER || 'chromium'
  if (!['chromium', 'firefox', 'webkit'].includes(name))
    throw new Error('Unsupported IME browser: ' + name)
  return engines[name].launch({ headless: process.env.HEADED !== '1',
    ...(software && name === 'chromium' ? { args: ['--disable-gpu'] } : {}),
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
}

/** Compare decoded RGBA, not PNG encoder metadata/compression choices. */
export async function sameImePixels(page, a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    const equal = await page.evaluate(async images => {
      const pixels = []
      let width = 0, height = 0
      for (const src of images) {
        const img = new Image()
        img.src = src
        await img.decode()
        if (pixels.length && (img.width !== width || img.height !== height)) return false
        const canvas = document.createElement('canvas')
        canvas.width = width = img.width
        canvas.height = height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        pixels.push(ctx.getImageData(0, 0, width, height).data)
      }
      return pixels[0].every((value, index) => value === pixels[1][index])
    }, [a[i], b[i]])
    if (!equal) return false
  }
  return true
}

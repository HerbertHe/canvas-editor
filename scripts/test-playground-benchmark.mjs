import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { arch, cpus, release, totalmem } from 'node:os'
import { dirname, isAbsolute } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const env = process.env
const runtime = env.PLAYWRIGHT_MODULE || 'playwright'
const { chromium } = await import(
  isAbsolute(runtime) ? pathToFileURL(runtime).href : runtime
)
const targets = [
  {
    id: 'upstream',
    url: env.UPSTREAM_URL || 'https://hufe.club/canvas-editor/'
  },
  {
    id: 'initial',
    url: env.INITIAL_URL || 'http://127.0.0.1:3027/initial/playground/',
    source: env.INITIAL_SOURCE || 'c5a00d388309562d7377758e3377a93afdeddd2e'
  },
  {
    id: 'current',
    url: env.CURRENT_URL || 'http://127.0.0.1:3027/canvas-editor/playground/',
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeDiffSha256: createHash('sha256')
      .update(execFileSync('git', ['diff', 'HEAD', '--', 'src', 'index.html']))
      .digest('hex')
  }
]
const trials = Number(env.TRIALS || 3)
const keys = Number(env.KEYS || 12)
assert.ok(Number.isInteger(trials) && trials >= 1)
assert.ok(Number.isInteger(keys) && keys >= 2)
const samples = (env.SAMPLES || 'demo,paragraphs-100').split(',')
assert.ok(samples.every(sample => sample === 'demo' || /^paragraphs-\d+$/.test(sample)))
const keyIntervalMs = 50
const compositionIntervalMs = 40
const composition = ['n', 'ni', 'nih', 'niha', 'nihao', 'niha', 'nihao']
const output = env.OUTPUT || 'cypress/results/playground-benchmark.json'
const viewport = { width: 1366, height: 720 }
const deviceScaleFactor = 1
const browser = await chromium.launch({
  ...(env.BROWSER_EXECUTABLE ? { executablePath: env.BROWSER_EXECUTABLE } : {})
})
const report = {
  schemaVersion: 1,
  date: new Date().toISOString(),
  browser: browser.version(),
  platform: { arch: arch(), release: release(), cpu: cpus()[0]?.model,
    memory: totalmem(), node: process.version },
  settings: { samples, trials, keys, keyIntervalMs, compositionIntervalMs, composition,
    viewport, deviceScaleFactor, headless: true },
  targets,
  results: [],
  errors: []
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = percentile => sorted[Math.ceil(sorted.length * percentile) - 1]
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) }
}

async function waitForFrames(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

async function prepare(page, sample) {
  return page.evaluate(({ sample, keys }) => {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    const command = editor.command
    let index = 0
    if (sample !== 'demo') {
      const count = Number(sample.split('-')[1])
      const paragraph = 'Weekend plans مرحبا بالعالم Hello 123 '.repeat(2)
      command.executeUpdateOptions({ ...command.getOptions(), defaultSize: 16 })
      command.executePaperSize(480, 640)
      command.executeSetPaperMargin([32, 32, 32, 32])
      command.executePageScale(1)
      command.executeSetValue({
        main: [{ value: Array(count).fill(paragraph).join('\n') }],
        header: [],
        footer: []
      })
      index = Math.floor(count / 2) * (paragraph.length + 1)
    }
    const original = command.getText().main
    const left = 'QZBENCH'
    const right = 'd'.repeat(keys + 8) + 'ENDQA'
    const lane = left + right
    if (original.includes(lane)) throw new Error('Editing lane already exists')
    command.executeSetRange(index, index)
    command.executeInsertElementList([{ value: lane }])
    const end = command.getRange().endIndex
    const start = end - lane.length
    command.executeSetRange(start, end)
    if (command.getRangeText() !== lane) throw new Error('Incorrect lane range')
    const text = command.getText().main
    if (text.replace(lane, '') !== original) throw new Error('Incorrect lane insertion')
    const caret = start + left.length
    command.executeSetRange(caret, caret)
    const agent = document.querySelector('.ce-inputarea')
    agent.focus({ preventScroll: true })
    const options = command.getOptions()
    if (sample !== 'demo' && (options.width !== 480 || options.height !== 640 ||
        options.scale !== 1 || options.defaultSize !== 16 ||
        options.margins.join(',') !== '32,32,32,32'))
      throw new Error('Controlled paper size, margins or font size changed')
    return { caret, left, right, text, options: {
      width: options.width, height: options.height, scale: options.scale,
      margins: options.margins, defaultSize: options.defaultSize,
      pageMode: options.pageMode, defaultFont: options.defaultFont,
      backend: options.backend, lab: options.lab
    }, documentLength: original.length,
    pages: document.querySelectorAll('.ce-page-container canvas').length,
    editorVersion: editor.version }
  }, { sample, keys })
}

async function startSampling(page) {
  await page.evaluate(() => {
    const agent = document.querySelector('.ce-inputarea')
    const events = []
    const paints = []
    const frames = []
    const samples = new WeakMap()
    const types = ['keydown', 'input', 'compositionstart', 'compositionend']
    const start = performance.now()
    const relativeNow = () => performance.now() - start
    const capture = event => {
      const row = { type: event.type, key: event.key, data: event.data,
        repeat: event.repeat, composing: event.isComposing,
        trusted: event.isTrusted, at: relativeNow() }
      samples.set(event, row)
      events.push(row)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        row.secondRafMs = relativeNow() - row.at
      }))
    }
    const complete = event => {
      samples.get(event).handlerMs = relativeNow() - samples.get(event).at
    }
    for (const type of types) {
      agent.addEventListener(type, capture, true)
      agent.addEventListener(type, complete)
    }
    const prototype = CanvasRenderingContext2D.prototype
    const clearRect = prototype.clearRect
    prototype.clearRect = function (...args) {
      if (this.canvas.parentElement?.classList.contains('ce-page-container'))
        paints.push(relativeNow())
      return clearRect.apply(this, args)
    }
    let frame
    const tick = time => {
      frames.push(time - start)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    window.stopBenchmarkSample = () => {
      cancelAnimationFrame(frame)
      for (const type of types) {
        agent.removeEventListener(type, capture, true)
        agent.removeEventListener(type, complete)
      }
      prototype.clearRect = clearRect
      delete window.stopBenchmarkSample
      return { events, paints, frames }
    }
  })
}

async function measure(page, action, dispatch, expectedText, expectedCaret) {
  await waitForFrames(page)
  await startSampling(page)
  const start = performance.now()
  await dispatch()
  const driverMs = performance.now() - start
  await waitForFrames(page)
  const sample = await page.evaluate(({ expectedText, expectedCaret }) => {
    const editor = window.__CANVAS_EDITOR_INSTANCE__
    const result = window.stopBenchmarkSample()
    const range = editor.command.getRange()
    const text = editor.command.getText().main
    return { ...result, contentMatches: text === expectedText,
      actualLength: text.length, expectedLength: expectedText.length,
      caretMatches: range.startIndex === expectedCaret && range.endIndex === expectedCaret,
      caret: range.endIndex, expectedCaret }
  }, { expectedText, expectedCaret })
  const relevant = sample.events.filter(event => action === 'ime'
    ? event.type === 'input' && event.composing && composition.includes(event.data)
    : action === 'input'
      ? event.type === 'input' && event.data === 'x'
      : event.type === 'keydown' && event.key === action)
  const expectedEvents = action === 'ime' ? composition.length : keys
  sample.countMatches = relevant.length === expectedEvents
  sample.trusted = relevant.every(event => event.trusted)
  sample.timing = {
    handlerMs: summarize(relevant.map(event => event.handlerMs).filter(Number.isFinite)),
    secondRafMs: summarize(relevant.map(event => event.secondRafMs).filter(Number.isFinite))
  }
  return { ...sample, action, driverMs }
}

async function run(target, sample, trial) {
  const page = await browser.newPage({ viewport, deviceScaleFactor })
  const scripts = new Map()
  const scriptHashes = new Map()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('response', response => {
    if (response.ok() && response.request().resourceType() === 'script' &&
      new URL(response.url()).origin === new URL(target.url).origin)
      scripts.set(response.url(), response)
  })
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForFunction(() => {
      const editor = window.__CANVAS_EDITOR_INSTANCE__
      return editor && (editor.state === undefined || editor.state === 'ready')
    }, null, { timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 15000 })
    const setup = await prepare(page, sample)
    const { caret, left, right, text, ...metadata } = setup
    const originalLane = left + right
    const repeatedKeys = key => async () => {
      for (let i = 0; i < keys; i++) {
        if (i) await delay(keyIntervalMs)
        await page.keyboard.down(key)
      }
      await page.keyboard.up(key)
    }
    await page.keyboard.press('w')
    await page.keyboard.press('Backspace')
    const inserted = 'x'.repeat(keys)
    const afterInput = text.replace(originalLane, left + inserted + right)
    const afterDelete = text.replace(originalLane, left + right.slice(keys))
    const imeText = '你好'
    const afterIme = afterDelete.replace(left + right.slice(keys),
      left + imeText + right.slice(keys))
    const results = []
    results.push(await measure(page, 'input', repeatedKeys('x'), afterInput, caret + keys))
    results.push(await measure(page, 'Backspace', repeatedKeys('Backspace'), text, caret))
    results.push(await measure(page, 'Delete', repeatedKeys('Delete'), afterDelete, caret))
    const session = await page.context().newCDPSession(page)
    results.push(await measure(page, 'ime', async () => {
      for (const value of composition) {
        await session.send('Input.imeSetComposition', {
          text: value, selectionStart: value.length, selectionEnd: value.length
        })
        await delay(compositionIntervalMs)
      }
      await session.send('Input.insertText', { text: imeText })
    }, afterIme, caret + imeText.length))
    await session.detach()
    for (const [url, response] of scripts)
      scriptHashes.set(url, createHash('sha256').update(await response.body()).digest('hex'))
    return { target: target.id, sample, trial, setup: { caret, ...metadata },
      actions: results,
      scripts: Object.fromEntries(scriptHashes), pageErrors }
  } finally {
    await page.close()
  }
}

try {
  for (let trial = 0; trial < trials; trial++) {
    for (const sample of samples) {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[(i + trial) % targets.length]
        try {
          const result = await run(target, sample, trial)
          report.results.push(result)
          for (const action of result.actions) {
            if (!action.contentMatches || !action.caretMatches ||
                !action.countMatches || !action.trusted ||
                action.timing.handlerMs.count !== (action.action === 'ime'
                  ? composition.length : keys))
              report.errors.push({ target: target.id, sample, trial,
                action: action.action, message: 'Input validation failed' })
          }
          console.log(target.id, sample, trial + 1, JSON.stringify(
            Object.fromEntries(result.actions.map(a => [a.action, {
              handler: a.timing.handlerMs, frame: a.timing.secondRafMs.p95,
              valid: a.contentMatches && a.caretMatches && a.countMatches
            }]))
          ))
        } catch (error) {
          report.errors.push({ target: target.id, sample, trial,
            message: String(error) })
          console.error(target.id, sample, trial + 1, error.message)
        }
        await mkdir(dirname(output), { recursive: true })
        await writeFile(output, JSON.stringify(report, null, 2) + '\n')
      }
    }
  }
  if (report.errors.length) process.exitCode = 1
} finally {
  await browser.close()
}

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import {
  distribution,
  interactionResultErrors
} from '../tests/fixtures/migration/performanceMetrics.ts'

// Uses Node >=24's type stripping. Playwright remains an optional QA runtime.
const env = process.env
const runtime = env.PLAYWRIGHT_MODULE || 'playwright'
const playwright = await import(
  runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime
)
const browserName = env.BROWSER || 'chromium'
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName))
const numeric = (name, fallback, minimum = 1) => {
  const value = Number(env[name] || fallback)
  assert.ok(Number.isFinite(value) && value >= minimum, name)
  return value
}
const durationMs = numeric('DURATION_MS', 10000)
const rate = numeric('INPUT_RATE', 30)
const trials = numeric('TRIALS', 3)
assert.ok(Number.isInteger(trials))
const full = env.MATRIX === 'full'
assert.ok(!env.MATRIX || ['full', 'standard'].includes(env.MATRIX))
const axis = (name, fallback, allowed) => {
  const values = (env[name] || fallback).split(',')
  assert.ok(values.length && values.every(v => allowed.includes(v)), name)
  return values
}
const samples = (env.SAMPLES ||
  'paragraphs-100,paragraphs-1000,single-long-paragraph,large-table').split(',')
const positions = axis('POSITIONS', 'start,middle,end', ['start', 'middle', 'end'])
const actions = axis('ACTIONS', 'input,backspace,delete', ['input', 'backspace', 'delete'])
const pageModes = axis('PAGE_MODES', full ? 'paging,continuity' : 'paging',
  ['paging', 'continuity'])
const histories = axis('HISTORY', full ? 'on,off' : 'on', ['on', 'off'])
const caches = axis('INCREMENTAL', full ? 'off,on' : 'off', ['on', 'off'])
const dprs = axis('DPRS', full ? '1,2' : '1', ['1', '2']).map(Number)
const warmups = numeric('WARMUP_KEYS', 1, 0)
assert.ok(Number.isInteger(warmups))
const timeoutMs = numeric('TIMEOUT_MS', 300000)
async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
const instrumentation = env.INSTRUMENTATION !== 'off'
const deferredPaint = env.DEFERRED_PAINT !== 'off'
const trackedEdits = env.TRACKED_EDITS === 'on'
const advancedLayout = env.ADVANCED_LAYOUT === 'on'
const workerLayout = env.LAYOUT_WORKER === 'on'
const workerTransfer = env.WORKER_TRANSFER === 'on'
assert.ok(!workerLayout || (advancedLayout && trackedEdits), 'Worker requires advanced/tracked')
const verifyHistory = env.VERIFY_HISTORY === 'on'
const captureTrace = env.TRACE === '1'
assert.ok(!captureTrace || browserName === 'chromium', 'TRACE requires Chromium')
const output = env.OUTPUT || 'cypress/results/perf01/interaction.json'
const artifacts = output.replace(/\.json$/, '') + '-artifacts'
await mkdir(dirname(output), { recursive: true })
await mkdir(artifacts, { recursive: true })
const fontPath = 'public/fonts/NotoNaskhArabic-Regular.ttf'
const report = {
  schemaVersion: 1,
  mode: 'interaction',
  date: new Date().toISOString(),
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  sourceHashes: {},
  machine: {
    platform: platform(), release: release(), arch: arch(),
    cpu: cpus()[0]?.model, logicalCPUs: cpus().length, totalMemory: totalmem()
  },
  node: process.version,
  browser: { name: browserName, version: '', executable: env.BROWSER_EXECUTABLE || 'playwright default' },
  fonts: [{ path: fontPath, sha256: createHash('sha256')
    .update(await readFile(fontPath)).digest('hex') }],
  viewport: [1366, 720],
  settings: {
    durationMs, rate, trials, positions, actions, samples, pageModes,
    histories, caches, dprs, warmups, instrumentation, captureTrace, deferredPaint, trackedEdits, verifyHistory, advancedLayout, workerLayout, workerTransfer
  },
  semantics: {
    timing: 'Stage ms is inclusive; selfMs excludes instrumented children only. Do not sum inclusive stages.',
    cache: 'paragraphCache selfMs includes key/clone/rebase/map overhead; these private functions are not separately timed.',
    latency: 'Event timestamp to capture listener is a browser dispatch proxy, not OS/hardware latency. Driver RTT includes IPC and scheduling.',
    paint: 'rAF gaps and settle barriers are scheduling observations, not actual presentation latency; screenshots verify endpoints, trace provides frame evidence.',
    worker: 'drainedMs is keyboard acknowledgement, not final Worker geometry; finish awaits geometry. geometryCommitMs measures received DOM event to atomic geometry commit. commitNextRafMs is a scheduling observation, not presentation.',
    queue: 'driver samples track offered/acknowledged calls; pendingHandlers and exact content checks track completion. No internal Worker queue is inferred.',
    startup: 'Fresh page/editor per case. Cold = first edit after startup; warmup uses real x/Backspace pairs. Browser/font OS caches are not flushed.',
    repeat: 'Repeated Playwright keyboard.down generates trusted repeat events; not an OS repeat-timer or real IME test.',
    workload: 'ASCII editing lane capacity=ceil(duration*rate)+8, prepared before editor construction inside a selected text scope. Surrounding mixed content is unchanged.'
  },
  results: [],
  errors: [],
  requests: []
}
for (const file of [
  'scripts/test-native-performance.mjs',
  'scripts/test-kernel-performance.mjs',
  'scripts/test-interaction-performance.mjs',
  'tests/fixtures/migration/interaction-performance.ts',
  'tests/fixtures/migration/performanceMetrics.ts',
  'tests/fixtures/migration/documents.ts',
  'src/editor/utils/performanceProfile.ts',
  'src/editor/interface/Performance.ts',
  'src/editor/core/worker/works/catalogModel.ts',
  'src/editor/core/worker/works/groupModel.ts',
  'src/editor/core/worker/works/valueModel.ts',
  'src/editor/core/layout/FlowCheckpoint.ts',
  'src/editor/core/layout/IncrementalFlow.ts',
  'src/editor/core/text-engine/layout/LayoutKernel.ts',
  'src/editor/core/text-engine/shape/RunShapeCache.ts',
  'src/editor/core/text-engine/shape/HarfBuzzTextShaper.ts',
  'src/editor/core/text-engine/render/GlyphRenderer.ts',
  'src/editor/core/text-engine/font/GlyphOutline.ts',
  'src/editor/core/text-engine/font/FontManager.ts',
  'src/editor/core/worker/layout/LayoutWorkerClient.ts',
  'src/editor/core/worker/layout/LayoutWorkerServer.ts',
  'src/editor/core/worker/layout/layout.worker.ts',
  'src/editor/core/worker/layout/protocol.ts',
  'src/editor/core/worker/layout/layoutCodec.ts',
  'src/editor/core/worker/layout/TransferBufferPool.ts',
  'src/editor/index.ts',
  'vite.config.ts',
  'src/editor/core/layout/LineGeometryIndex.ts',
  'src/editor/core/layout/NativeQueryIndex.ts',
  'src/editor/core/text-engine-host/LayoutHostAdapter.ts',
  'src/editor/core/text-engine-host/ListMarker.ts',
  'src/editor/core/draw/particle/ListParticle.ts',
  'src/editor/core/event/handlers/input.ts',
  'src/editor/core/event/handlers/keydown/backspace.ts',
  'src/editor/core/event/handlers/keydown/delete.ts',
  'src/editor/interface/Draw.ts',
  'src/editor/interface/Editor.ts',
  'src/editor/utils/option.ts',
  'src/editor/core/layout/ParagraphIndex.ts',
  'src/editor/core/layout/relativeLayout.ts',
  'src/editor/core/draw/DirtyRangeTracker.ts',
  'src/editor/core/draw/DerivedState.ts',
  'src/editor/core/draw/IncrementalParagraphComputer.ts',
  'src/editor/core/history/EditTransaction.ts',
  'src/editor/core/history/HistoryManager.ts',
  'src/editor/core/event/CanvasEvent.ts',
  'src/editor/core/text-engine-host/ElementBridge.ts',
  'src/editor/core/text-engine/font/FontCoverageTracker.ts',
  'src/editor/core/worker/WorkerManager.ts',
  'src/editor/core/worker/WorkerRequestRegistry.ts',
  'src/editor/core/worker/works/wordCountModel.ts',
  'src/editor/core/worker/works/respond.ts',
  'src/editor/core/draw/interactive/Search.ts',
  'src/editor/core/draw/control/interactive/ControlSearch.ts',
  'src/editor/core/layout/InteractionGeometry.ts',
  'src/editor/core/position/Position.ts',
  'src/editor/core/draw/Draw.ts'
]) report.sourceHashes[file] = createHash('sha256')
  .update(await readFile(file)).digest('hex')

const browser = await playwright[browserName].launch({
  headless: env.HEADED !== '1',
  ...(browserName === 'chromium' ? {
    args: ['--enable-precise-memory-info']
  } : {}),
  ...(env.BROWSER_EXECUTABLE ? { executablePath: env.BROWSER_EXECUTABLE } : {})
})
report.browser.version = browser.version()
let failed = false
try {
  for (const sample of samples)
    for (const position of positions)
      for (const action of actions)
        for (const pageMode of pageModes)
          for (const history of histories)
            for (const incremental of caches)
              for (const dpr of dprs)
                for (let trial = 0; trial < trials; trial++) {
                  const config = {
                    sample, position, action, pageMode,
                    history: history === 'on', incremental: incremental === 'on',
                    deferredPaint, trackedEdits, advancedLayout, workerLayout, workerTransfer,
                    instrumentation, capacity: Math.ceil(durationMs * rate / 1000)
                  }
                  const name = [sample, position, action, pageMode,
                    `history-${history}`, `cache-${incremental}`, `dpr-${dpr}`,
                    trial].join('-')
                  console.log(`RUN ${name}`)
                  const context = await browser.newContext({
                    viewport: { width: 1366, height: 720 }, deviceScaleFactor: dpr
                  })
                  try {
                    await context.route('https://**/*', route => {
                      report.requests.push(route.request().url())
                      return route.abort()
                    })
                    await context.addInitScript(() => {
                      for (const name of ['measureText', 'fillText', 'strokeText'])
                        CanvasRenderingContext2D.prototype[name] = () => {
                          throw new Error(`Browser text API reached: ${name}`)
                        }
                    })
                    const page = await context.newPage()
                    page.setDefaultTimeout(timeoutMs)
                    page.on('pageerror', error => report.errors.push(error.message))
                    await page.goto((env.BASE_URL || 'http://127.0.0.1:3000') +
                      '/canvas-editor/tests/fixtures/migration/interaction-performance.html')
                    await page.waitForFunction(() => window.interactionPerformance)
                    const setup = await bounded(page.evaluate(
                      c => window.interactionPerformance.setup(c), config), 'setup')
                    const key = action === 'input' ? 'x' : action === 'backspace'
                      ? 'Backspace' : 'Delete'
                    for (let i = 0; i < warmups; i++) {
                      await page.keyboard.press('x')
                      await page.keyboard.press('Backspace')
                    }
                    await page.evaluate(() => window.interactionPerformance.settle())
                    const beforePng = join(artifacts, name + '-before.png')
                    const afterPng = join(artifacts, name + '-after.png')
                    await page.screenshot({ path: beforePng })
                    let cdp
                    if (captureTrace) {
                      cdp = await context.newCDPSession(page)
                      await cdp.send('Tracing.start', {
                        categories: 'devtools.timeline,blink.user_timing,' +
                          'disabled-by-default-devtools.screenshot,' +
                          'disabled-by-default-v8.cpu_profiler',
                        transferMode: 'ReturnAsStream'
                      })
                    }
                    if (verifyHistory && config.history)
                      await page.evaluate(() => window.interactionPerformance.prepareHistoryCheck())
                    const beginSentAt = performance.now()
                    const begin = await page.evaluate(() => window.interactionPerformance.begin())
                    const beginRTT = performance.now() - beginSentAt
                    const driver = []
                    const pending = []
                    let acknowledged = 0
                    let maxPending = 0
                    const started = performance.now()
                    // Fixed-rate offers from Node, independent of renderer rAF.
                    // Each down is retained; all are drained before keyup/checks.
                    for (let i = 0; i < config.capacity; i++) {
                      const plannedMs = i * 1000 / rate
                      await new Promise(resolve => setTimeout(resolve,
                        Math.max(0, started + plannedMs - performance.now())))
                      const sentAt = performance.now()
                      const row = { index: i, plannedMs,
                        offeredMs: sentAt - started, acknowledgedMs: null,
                        pendingAtOffer: i + 1 - acknowledged }
                      maxPending = Math.max(maxPending, row.pendingAtOffer)
                      driver.push(row)
                      pending.push(page.keyboard.down(key).then(() => {
                        acknowledged++
                        row.acknowledgedMs = performance.now() - started
                      }, error => {
                        row.error = error.message
                      }))
                    }
                    // Hold for the requested window, even when the last offer
                    // precedes its end. Slow cases may drain well after it.
                    await new Promise(resolve => setTimeout(resolve,
                      Math.max(0, started + durationMs - performance.now())))
                    const pendingAtWindowEnd = config.capacity - acknowledged
                    await bounded(Promise.all(pending), 'drain keyboard offers')
                    assert.ok(driver.every(row => !row.error), 'Keyboard dispatch failed')
                    await page.keyboard.up(key)
                    const drainedMs = performance.now() - started
                    const result = await bounded(page.evaluate(
                      count => window.interactionPerformance.finish(count), pending.length),
                    'finish')
                    await page.screenshot({ path: afterPng })
                    let tracePath = null
                    if (cdp) {
                      const complete = new Promise(resolve =>
                        cdp.once('Tracing.tracingComplete', resolve))
                      await cdp.send('Tracing.end')
                      const { stream } = await complete
                      const chunks = []
                      for (;;) {
                        const chunk = await cdp.send('IO.read', { handle: stream })
                        chunks.push(Buffer.from(chunk.data,
                          chunk.base64Encoded ? 'base64' : 'utf8'))
                        if (chunk.eof) break
                      }
                      await cdp.send('IO.close', { handle: stream })
                      tracePath = join(artifacts, name + '-trace.json')
                      await writeFile(tracePath, Buffer.concat(chunks))
                    }
                    const historyVerification = verifyHistory && config.history
                      ? await page.evaluate(() => window.interactionPerformance.verifyHistory()) : null
                    const disposed = await page.evaluate(() => window.interactionPerformance.dispose())
                    const errors = interactionResultErrors(result)
                    if (disposed.canvases !== 0) errors.push('canvases not released')
                    const measured = result.stages.interaction || {}
                    const hotspots = Object.entries(measured)
                      .sort((a, b) => b[1].selfMs - a[1].selfMs)
                      .slice(0, 3).map(([stage, metric]) => ({ stage, ...metric }))
                    report.results.push({
                      name, trial, dpr, setup, begin, ...result, historyVerification,
                      driver: {
                        samples: driver, maxPending, pendingAtWindowEnd,
                        pendingAfterDrain: config.capacity - acknowledged,
                        drainedMs,
                        beginClockUncertaintyMs: beginRTT,
                        offerToGeometryMs: distribution(result.geometryCommits.map(commit =>
                          Math.max(0, commit.atMs - driver[commit.operation].offeredMs))),
                        roundTripMs: distribution(driver.map(row =>
                          row.acknowledgedMs - row.offeredMs)),
                        offerLatenessMs: distribution(driver.map(row =>
                          Math.max(0, row.offeredMs - row.plannedMs)))
                      },
                      hotspots, artifacts: { beforePng, afterPng, tracePath },
                      disposed, validationErrors: errors
                    })
                    assert.deepEqual(errors, [], name)
                    console.log(`PASS ${name}: ${result.sent} operations`)
                  } finally {
                    await context.close()
                    await writeFile(output, JSON.stringify(report, null, 2))
                  }
                }
  assert.deepEqual(report.requests, [], 'Offline fixture requested remote resources')
  assert.deepEqual(report.errors, [], 'Browser errors')
} catch (error) {
  failed = true
  report.errors.push(error.stack || String(error))
  throw error
} finally {
  report.passed = !failed
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
  console.log(`Report: ${output} (${report.results.length} cases)`)
}

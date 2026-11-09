import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { cpus, release, totalmem } from 'node:os'
import { launchImeBrowser } from './ime-browser.mjs'
import { evaluateImeRelease, IME_RELEASE_ENGINES } from '../src/utils/imeRelease.ts'

const root = process.cwd()
const base = process.env.BASE_URL || 'http://127.0.0.1:3020'
const output = process.env.OUTPUT || 'cypress/results/ime/release.json'
const artifacts = 'cypress/results/ime/release'
const engines = (process.env.ENGINES || IME_RELEASE_ENGINES.join(',')).split(',')
if (engines.some(name => !IME_RELEASE_ENGINES.includes(name))) throw new Error('Unknown engine')
const trials = Number(process.env.TRIALS || 3)
if (!Number.isInteger(trials) || trials < 1) throw new Error('Invalid TRIALS')
await mkdir(artifacts, { recursive: true })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fingerprint() {
  const files = []
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) files.push(child.replaceAll('\\', '/'))
    }
  }
  for (const path of ['src', 'scripts', 'tests', 'public/fonts']) await visit(path)
  files.push('package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts',
    'eslint.config.js')
  const hashes = {}
  for (const file of files.sort()) hashes[file] = digest(await readFile(file))
  return { hash: digest(JSON.stringify(hashes)), files: hashes }
}
const source = await fingerprint()
const report = { schemaVersion: 1, startedAt: new Date().toISOString(),
  date: process.env.REPORT_DATE || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
  status: 'running', sourceHash: source.hash, sourceFiles: source.files,
  machine: { node: process.version, os: process.platform, release: release(),
    cpu: cpus()[0]?.model, memoryGiB: totalmem() / 2 ** 30 },
  settings: { trials, warmupSessions: 1, intervalMs: 33, viewport: [1366, 720], dpr: 1,
    frameBudgetProxyMs: 16.7, experimentalWorkerPreviewDefault: false },
  semantics: 'Synthetic browser events and rAF/geometry proxies, not OS IME or actual presentation FPS. Long-task observation covers replay including final commit/history checks. Unsupported long-task APIs are unavailable, not zero. All phases run serially; quality/checks finish before timing. Manual evidence is separately bound to sources, trusted events, reviewer observations and a local video digest. User text/videos are never copied into this report.',
  quality: [], checks: [], browsers: [], performance: [], manual: [],
  release: { status: 'hold', reasons: ['incomplete-run'] } }
async function save() {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
}
await writeFile('cypress/results/ime/release-source.json', JSON.stringify({ sourceHash: source.hash }))
await save()
async function job(label, args, env = process.env, executable = process.execPath) {
  const path = `${artifacts}/${label}.log`
  console.log('RUN ' + label)
  const result = await new Promise(resolveJob => {
    const log = createWriteStream(path)
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    let settled = false
    const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000)
    const finish = code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      log.end(() => resolveJob({ passed: code === 0, exitCode: code }))
    }
    child.once('error', error => { log.write(String(error)); finish(-1) })
    child.once('close', code => finish(code ?? -1))
  })
  const bytes = await readFile(path)
  console.log((result.passed ? 'PASS ' : 'FAIL ') + label)
  return { ...result, log: path, logHash: digest(bytes), text: bytes.toString() }
}
if (process.env.SKIP_QUALITY !== '1') {
  for (const [name, args] of [
    ['lint', ['node_modules/eslint/bin/eslint.js', '.']],
    ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['unit', ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1']],
    ['app', ['node_modules/vite/bin/vite.js', 'build', '--mode', 'app', '--outDir', `${artifacts}/app`]],
    ['library', ['node_modules/vite/bin/vite.js', 'build', '--mode', 'lib']],
    ['docs', []],
    ['package', ['scripts/test-package.mjs']]
  ]) {
    if (name === 'docs') {
      const steps = []
      for (const [label, command] of [
        ['diagrams', ['scripts/check-docs-diagrams.mjs']],
        ['demo', ['scripts/build-docs-demo.mjs']],
        ['site', ['node_modules/vitepress/bin/vitepress.js', 'build', 'docs']]
      ]) {
        const step = await job('quality-docs-' + label, command)
        steps.push({ passed: step.passed, exitCode: step.exitCode,
          log: step.log, logHash: step.logHash })
      }
      report.quality.push({ name, passed: steps.every(step => step.passed), steps })
    } else {
      const { text, ...result } = await job('quality-' + name, args)
      report.quality.push({ name, ...result,
        ...(name === 'unit' ? { summary: text.match(/Test Files[^\n]+|Tests\s+[^\n]+/g) } : {}) })
    }
    await save()
  }
}
const stages = [
  ['ordinary', 'scripts/test-native-browsers.mjs', null, 26],
  ['preview', 'scripts/test-ime-preview.mjs', 'cypress/results/ime/preview-differential.json', 12],
  ['anchor', 'scripts/test-ime-anchor.mjs', 'cypress/results/ime/anchor-geometry.json', 8],
  ['closure', 'scripts/test-ime-commit.mjs', 'cypress/results/ime/commit-closure.json', 16],
  ['long', 'scripts/test-ime-long.mjs', 'cypress/results/ime/long-comparison.json', 42],
  ['tableWorker', 'scripts/test-ime-table-worker.mjs', 'cypress/results/ime/table-worker-comparison.json', 62],
  ['workerAnchor', 'scripts/test-ime-table-worker-anchors.mjs', null, 60]
]
const originalExecutable = process.env.BROWSER_EXECUTABLE
function environment(engine) {
  const env = { ...process.env, BASE_URL: base, BROWSER: engine, CORRECTNESS_ONLY: '1',
    PROFILES: 'baseline,sync,worker' }
  delete env.BROWSER_EXECUTABLE
  delete env.OUTPUT
  const executable = process.env[engine.toUpperCase() + '_EXECUTABLE'] ||
    (engine === 'chromium' ? originalExecutable : undefined)
  if (executable) env.BROWSER_EXECUTABLE = executable
  return env
}
// Correctness precedes every timing phase. A partial engine selection cannot pass the gate.
for (const engine of engines) {
  for (const [name, script, file, count] of stages) {
    const path = name === 'ordinary' ? `cypress/results/${engine}/report.json` : file
    if (path) await rm(path, { force: true })
    const result = await job(`${engine}-${name}`, [script], environment(engine))
    let data = null, actual = 0
    try {
      if (path) data = JSON.parse(await readFile(path, 'utf8'))
      actual = name === 'workerAnchor' ? [...result.text.matchAll(/checks=(\d+)/g)]
        .reduce((sum, match) => sum + Number(match[1]), 0) :
        (name === 'long' || name === 'tableWorker' ? data?.checks || [] :
          name === 'anchor' || name === 'closure' ? data?.cases || [] : data?.results || []).length
    } catch { /* Missing or corrupt output is a failed stage. */ }
    report.checks.push({ engine, name, passed: result.passed && actual === count &&
      (data ? data.passed === true : true), count: actual, expected: count,
      log: result.log, logHash: result.logHash,
      ...(name === 'tableWorker' ? { boundaries: data?.boundaries?.length,
        bursts: data?.bursts?.length } : {}) })
    await save()
  }
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) }
}
if (process.env.SKIP_PERFORMANCE !== '1') for (const engine of engines) {
  const env = environment(engine)
  process.env.BROWSER = engine
  if (env.BROWSER_EXECUTABLE) process.env.BROWSER_EXECUTABLE = env.BROWSER_EXECUTABLE
  else delete process.env.BROWSER_EXECUTABLE
  let browser
  try {
    browser = await launchImeBrowser()
    report.browsers.push({ engine, version: browser.version() })
    for (const scenario of ['short', '100', '1000', 'long', 'table', 'large']) {
      const samples = new Map([[false, []], [true, []]])
      const runs = new Map([[false, []], [true, []]])
      for (let trial = 0; trial < trials; trial++) for (const optimized of trial % 2 ? [true, false] : [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        try {
          console.log(`MEASURE ${engine} ${scenario} optimized=${optimized} trial=${trial}`)
          await page.goto(base + '/canvas-editor/tests/fixtures/migration/' +
            (scenario === 'large' ? 'ime-table-worker.html' : 'ime-performance.html'))
          await page.waitForFunction(large => large ? window.imeTableWorker : window.imePerformance,
            scenario === 'large')
          if (scenario === 'large') {
            await page.evaluate(config => window.imeTableWorker.setup(config),
              { kind: 'large', tableCache: optimized, workerPreview: false })
            const result = await page.evaluate(() => window.imeTableWorker.trial(3))
            const values = result.samples.map(s => ({ handler: s.handlerMs, geometry: s.geometryMs,
              nextRaf: s.nextRafMs, tables: s.tables }))
            samples.get(optimized).push(...values)
            runs.get(optimized).push({ trial, handler: distribution(values.map(v => v.handler)),
              geometry: distribution(values.map(v => v.geometry)), tables: values.at(-1).tables,
              longtasks: { supported: result.longtaskSupported,
                count: result.longtaskSupported ? result.longtasks.length : null,
                max: result.longtaskSupported ? Math.max(0, ...result.longtasks.map(t => t.ms)) : null } })
            await page.evaluate(() => window.imeTableWorker.dispose())
          } else {
            await page.evaluate(config => window.imePerformance.setup(config),
              { sample: scenario, profile: optimized ? 'sync' : 'baseline',
                preview: optimized, instrumentation: false })
            await page.evaluate(async () => {
              await window.imePerformance.replay(['n', 'ni', 'nih', 'niha', 'nihao', 'niha', 'nihao'], '你好', 33)
              await window.imePerformance.resetTrial()
            })
            const result = await page.evaluate(async () => {
              const tasks = []
              const supported = PerformanceObserver.supportedEntryTypes?.includes('longtask') || false
              const observer = supported ? new PerformanceObserver(list =>
                tasks.push(...list.getEntries().map(e => e.duration))) : null
              observer?.observe({ type: 'longtask' })
              const value = await window.imePerformance.replay(
                ['n', 'ni', 'nih', 'niha', 'nihao', 'niha', 'nihao'], '你好', 33)
              await new Promise(requestAnimationFrame)
              observer?.disconnect()
              return { value, tasks, supported }
            })
            const r = result.value
            const handlers = r.events.filter(e => e.type === 'input' && e.isComposing).map(e => e.handlerMs)
            const geometry = r.commits.map(c => c.latency)
            samples.get(optimized).push(...handlers.map((handler, i) => ({ handler,
              geometry: geometry[i], nextRaf: r.nextFrames[i] })))
            runs.get(optimized).push({ trial, received: r.received, submitted: r.submitted,
              merged: r.merged, finalized: r.finalized, trusted: r.events.some(e => e.trusted),
              handler: distribution(handlers), geometry: distribution(geometry),
              nextRaf: distribution(r.nextFrames), frameGaps: r.frameGaps,
              longtasks: { supported: result.supported, count: result.supported ? result.tasks.length : null,
                max: result.supported ? Math.max(0, ...result.tasks) : null } })
            await page.evaluate(() => window.imePerformance.dispose())
          }
          if (errors.length) throw new Error(errors.join('\n'))
        } finally { await page.close() }
      }
      for (const optimized of [false, true]) {
        const values = samples.get(optimized)
        const times = key => distribution(values.map(v => v[key]).filter(Number.isFinite))
        const handler = times('handler'), geometry = times('geometry')
        report.performance.push({ engine, scenario, optimized, trials,
          samples: handler.count, geometrySamples: geometry.count,
          handlerP95: handler.p95, geometryP95: geometry.p95, handler, geometry,
          nextRaf: times('nextRaf'), runs: runs.get(optimized),
          ...(scenario === 'large' ? { tableWork: values.at(-1)?.tables } : {}) })
      }
      await save()
    }
  } catch (error) {
    report.browsers.push({ engine, error: String(error) })
    await save()
  } finally { await browser?.close() }
}
if (process.env.IME_MANUAL_EVIDENCE) {
  const manifestPath = resolve(process.env.IME_MANUAL_EVIDENCE)
  let records = []
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (!Array.isArray(manifest.records)) throw new Error('Invalid records')
    records = manifest.records
  } catch { report.manual.push({ invalid: true, reason: 'unreadable-or-invalid-manifest' }) }
  for (const item of records) {
    try {
      const recordPath = resolve(dirname(manifestPath), item.path)
      if ((await stat(recordPath)).size > 16 * 1024 * 1024) throw new Error('Record exceeds budget')
      const bytes = await readFile(recordPath)
      const raw = JSON.parse(bytes.toString())
      let recordingHash = null
      if (item.recording) {
        const videoPath = resolve(dirname(manifestPath), item.recording)
        const info = await stat(videoPath)
        if (info.isFile() && info.size > 0 && ['.mp4', '.mov', '.webm', '.mkv', '.avi']
          .includes(extname(videoPath).toLowerCase())) {
          const hash = createHash('sha256')
          for await (const chunk of createReadStream(videoPath)) hash.update(chunk)
          recordingHash = hash.digest('hex')
        }
      }
      const e = raw.environment || {}, review = raw.nativeReview || {}
      report.manual.push({ platform: e.platform, scenario: raw.config?.sample, profile: raw.config?.profile,
        sourceHash: raw.sourceHash, digest: digest(bytes),
        trusted: raw.mode === 'manual' && raw.events?.filter(event => event.type === 'input' &&
          event.isComposing && event.trusted === true).length >= 2 &&
          raw.events.some(event => event.type === 'compositionend' && event.trusted === true),
        metadataComplete: [e.osVersion, e.browserVersion, e.inputMethod, e.inputMethodVersion]
          .every(value => typeof value === 'string' && value.trim() && value !== 'not recorded'),
        reviewed: ['candidateWindow', 'visibleRefresh', 'commit', 'cancel'].every(key =>
          review[key] === 'passed') && (review.notes?.trim().length || 0) >= 10 && !!recordingHash,
        recordingHash })
    } catch { report.manual.push({ invalid: true }) }
  }
}
const after = await fingerprint()
report.sourceUnchanged = after.hash === source.hash
report.release = evaluateImeRelease({ ...report, sourceUnchanged: report.sourceUnchanged })
report.status = 'completed'
report.completedAt = new Date().toISOString()
report.checksPassed = report.checks.length === 21 && report.checks.every(c => c.passed)
report.automaticPassed = report.release.reasons.every(reason => reason.startsWith('manual:'))
await save()
console.log(JSON.stringify({ automaticPassed: report.automaticPassed, release: report.release }, null, 2))
process.exitCode = report.release.status === 'ready' ? 0 : 2

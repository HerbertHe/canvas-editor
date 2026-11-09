import { Draw } from '../../../src/editor/core/draw/Draw'
import { CommandAdapt } from '../../../src/editor/core/command/CommandAdapt'
import { Listener } from '../../../src/editor/core/listener/Listener'
import { EventBus } from '../../../src/editor/core/event/eventbus/EventBus'
import { Override } from '../../../src/editor/core/override/Override'
import { formatElementList, getSlimCloneElementList } from '../../../src/editor/utils/element'
import { mergeOption } from '../../../src/editor/utils/option'
import { ZERO } from '../../../src/editor/dataset/constant/Common'
import { ElementType } from '../../../src/editor/dataset/enum/Element'
import type { IElement } from '../../../src/editor/interface/Element'
import type { PerformanceProfile } from '../../../src/editor/utils/performanceProfile'
import type { IPositionContext } from '../../../src/editor/interface/Position'

type Config = { profile: PerformanceProfile; preview: boolean;
  sample: 'short' | '100' | '1000' | 'long' | 'table'; instrumentation?: boolean;
  incrementalCommit?: boolean }
type EventSample = { type: string; data: string | null; inputType?: string;
  isComposing?: boolean; trusted: boolean; at: number; handlerMs?: number;
  generation?: number; sequence?: number; status?: 'pending' | 'merged' | 'submitted' | 'finalized' }
let draw: Draw
let config: Config
let events: EventSample[] = []
let frames: number[] = []
let paints: { at: number; sequence: number }[] = []
let stages: Record<string, { calls: number; ms: number }> = {}
let active = false
let start = 0
let raf = 0
let original = ''
let originalIndex = 0
let originalContext: IPositionContext
let finalDiagnostics: unknown
let commits: { sequence: number; latency: number; local: boolean }[] = []
let nextFrames: number[] = []
let preeditStages: typeof stages = {}
const base = import.meta.env.BASE_URL
const fonts = await Promise.all(['NotoSans-Latin-Regular.woff2', 'NotoSansSC-Regular.woff2']
  .map(async file => ({ family: file.startsWith('NotoSansSC') ? 'CJK' : 'Latin',
    data: await (await fetch(`${base}tests/fixtures/fonts/${file}`)).arrayBuffer() })))
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const text = () => draw.getOriginalMainElementList().map(e => e.value).join('')

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) }
}

async function setup(next: Config) {
  dispose()
  config = next
  const count = next.sample === '1000' ? 1000 : next.sample === '100' ? 100 : 1
  const main: IElement[] = next.sample === 'table' ? [{ value: '', type: ElementType.TABLE,
    colgroup: [{ width: 220 }], trList: [{ height: 40, tdList: [{ colspan: 1,
      rowspan: 1, value: [{ value: '中文 abcdef' }] }] }] }]
    : Array.from({ length: count }, () => [{ value: ZERO },
      { value: next.sample === 'long' ? '中文 abcdef '.repeat(300) : '中文 abcdef' }]).flat()
  const options = mergeOption({ autoDownloadFonts: false, defaultFont: 'CJK', fonts,
    width: 620, height: 600, margins: [30, 30, 30, 30],
    header: { disabled: true }, footer: { disabled: true }, pageNumber: { disabled: true },
    lab: { performanceProfile: next.profile, incrementalCompute: false, imePreview: next.preview,
      ...(next.incrementalCommit === undefined ? {} : { incrementalCommit: next.incrementalCommit }) } })
  const content = { main, header: [{ value: ZERO }], footer: [{ value: ZERO }] }
  Object.values(content).forEach(elements => formatElementList(elements, {
    editorOptions: options, isForceCompensation: true }))
  const container = document.createElement('div')
  document.querySelector('#editor')!.append(container)
  draw = new Draw(container, options, content, new Listener(), new EventBus(), new Override())
  await draw.ready
  if (next.sample === 'table') {
    const index = draw.getOriginalMainElementList().findIndex(e => e.type === ElementType.TABLE)
    const td = draw.getOriginalMainElementList()[index].trList![0].tdList[0]
    draw.getPosition().setPositionContext({ isTable: true, index, trIndex: 0, tdIndex: 0, tdId: td.id })
  }
  const index = next.sample === 'table' ? 3 : Math.floor(count / 2) * 10 + 3
  originalIndex = index
  originalContext = structuredClone(draw.getPosition().getPositionContext())
  draw.getRange().setRange(index, index)
  draw.render({ curIndex: index, isLazy: false, isSubmitHistory: false })
  await draw.waitForWorkerLayout()
  await frame()
  original = currentText()
  const agent = draw.getCursor().getAgentDom()
  const samples = new WeakMap<Event, EventSample>()
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
    agent.addEventListener(type, event => {
      if (!active) return
      const input = event as InputEvent
      const sample: EventSample = { type, data: input.data ?? null,
        inputType: input.inputType, isComposing: input.isComposing,
        trusted: event.isTrusted, at: performance.now() - start }
      if (type === 'input' && draw.getCanvasEvent().isComposing) {
        const diagnostics = draw.getCanvasEvent().getCompositionDiagnostics()
        sample.generation = diagnostics.generation
        sample.sequence = diagnostics.sequence + 1
        sample.status = 'pending'
      }
      events.push(sample)
      samples.set(event, sample)
    }, true)
    agent.addEventListener(type, event => {
      const sample = samples.get(event)
      if (sample) sample.handlerMs = performance.now() - start - sample.at
      if (type === 'compositionstart' && active) {
        const session = Reflect.get(draw.getCanvasEvent(), 'compositionSession')
        const consume = session.consume
        session.consume = (value: string, local: boolean) => {
          consume(value, local)
          const generation = draw.getCanvasEvent().getCompositionDiagnostics().generation
          const current = events.findLast(e => e.generation === generation && e.sequence === session.sequence)
          if (current?.status === 'pending') {
            for (const earlier of events)
              if (earlier.generation === generation && earlier.status === 'pending' &&
                earlier.sequence! < session.sequence) earlier.status = 'merged'
            current.status = 'submitted'
            commits.push({ sequence: session.sequence, local: session.local,
              latency: performance.now() - start - current.at })
            requestAnimationFrame(() => {
              if (active) nextFrames.push(performance.now() - start - current.at)
            })
          }
        }
      }
      if (type === 'compositionend' && active)
        for (const pending of events) if (pending.status === 'pending') pending.status = 'finalized'
    })
  }
  const internal = draw as unknown as Record<string, (...args: any[]) => any>
  for (const name of ['computeRenderGeometry', 'previewComposition', '_drawPage', 'updateFontCoverage']) {
    const fn = internal[name]
    internal[name] = function (...args) {
      if (!active || config.instrumentation === false) return fn.apply(draw, args)
      const before = performance.now()
      try { return fn.apply(draw, args) } finally {
        const stage = stages[name] ||= { calls: 0, ms: 0 }
        stage.calls++
        stage.ms += performance.now() - before
        if (name === '_drawPage') paints.push({ at: performance.now() - start,
          sequence: draw.getCanvasEvent().getCompositionDiagnostics().sequence })
      }
    }
  }
  return { options: draw.getOptions().lab, original }
}

function currentText() {
  return draw.getElementList().map(e => e.value).join('')
}

async function resetTrial() {
  new CommandAdapt(draw).undo()
  draw.getPosition().setPositionContext(structuredClone(originalContext))
  if (currentText() !== original) throw new Error('Trial reset did not restore original text')
  draw.getRange().setRange(originalIndex, originalIndex)
  draw.render({ curIndex: originalIndex, isSubmitHistory: false, isLazy: false })
  await draw.waitForWorkerLayout()
  await frame()
}

function begin() {
  events = []; frames = []; paints = []; stages = {}; finalDiagnostics = null
  commits = []; nextFrames = []; preeditStages = {}
  active = true
  start = performance.now()
  const tick = () => {
    if (!active) return
    frames.push(performance.now() - start)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  draw.getCursor().focus()
}

function dispatch(type: string, data: string, inputType = 'insertCompositionText') {
  const agent = draw.getCursor().getAgentDom()
  if (type === 'input' || type === 'beforeinput') {
    if (type === 'input') agent.value = data
    agent.dispatchEvent(new InputEvent(type, { bubbles: true, data, inputType,
      isComposing: draw.getCanvasEvent().isComposing }))
  } else agent.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }))
}

async function replay(values: string[], final = '你好', interval = 8) {
  begin()
  const before = currentText()
  const { startIndex, endIndex } = draw.getRange().getRange()
  const elements = draw.getElementList()
  const expected = [...elements.slice(0, startIndex + 1).map(e => e.value), final,
    ...elements.slice(endIndex + 1).map(e => e.value)].join('')
  dispatch('compositionstart', '')
  for (const value of values) {
    dispatch('compositionupdate', value)
    dispatch('beforeinput', value)
    dispatch('input', value)
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  await frame()
  finalDiagnostics = draw.getCanvasEvent().getCompositionDiagnostics()
  preeditStages = structuredClone(stages)
  dispatch('compositionend', final)
  // A native final input after compositionend must not duplicate the commit.
  dispatch('beforeinput', final, 'insertText')
  dispatch('input', final, 'insertText')
  await frame(); await frame()
  await draw.waitForWorkerLayout()
  if (currentText() !== (final ? expected : before)) throw new Error('IME final text mismatch')
  if (final && config.profile !== 'baseline') {
    new CommandAdapt(draw).undo()
    if (currentText() !== before) throw new Error('IME undo mismatch')
    new CommandAdapt(draw).redo()
    if (currentText() !== expected) throw new Error('IME redo mismatch')
  }
  return finish('synthetic')
}

async function flowDifferential(kind: 'stable' | 'wrap' | 'page') {
  const host = draw.getCanvasEvent()
  const position = draw.getPosition()
  const before = position.getPlacementStats().relocatedBlocks
  host.compositionstart()
  host.input('nihao')
  host.flushComposition(false)
  const value = kind === 'stable' ? '你' :
    kind === 'wrap' ? '中文 abcdef '.repeat(18) : '中文 abcdef '.repeat(180)
  host.compositionend(new CompositionEvent('compositionend', { data: value }))
  if (kind !== 'stable' && draw.getOptions().lab.incrementalCommit &&
    position.getPlacementStats().relocatedBlocks === before)
    throw new Error(`Flow differential did not reuse any relocated rows: ${kind}`)
  draw.flushPaint()
  const queries = () => position.getNativeLines().filter((_, index) => index % 101 === 0)
    .map(({ line, pageNo }) => {
      const index = line.source.start + 2
      const caret = position.getNativeCaret(index)
      if (!caret) throw new Error('Flow differential missing caret')
      return {
        caret,
        hit: position.getPositionByXY({ x: caret.x, y: caret.y, pageNo }),
        range: position.getNativeRangeRects(index, index + 2, undefined, pageNo),
        horizontal: position.moveNativeCaret(index, 1),
        vertical: position.moveNativeCaret(index, 1, true, true),
        deletion: position.getNativeDeleteRange(index, false, true)
      }
    })
  const capture = () => ({
    data: draw.getValue().data,
    positions: position.getOriginalMainPositionList(),
    queries: queries(),
    pages: draw.getLayoutPages().map(rows => rows.map(row => ({
      start: row.startIndex, rowIndex: row.rowIndex, width: row.width,
      height: row.height, flow: row.flow, indices: row.sourceIndices && [...row.sourceIndices]
    }))),
    pixels: draw.getPageList().map(canvas => canvas.toDataURL())
  })
  const incremental = json(capture())
  draw.getOptions().lab.incrementalFlow = false
  draw.getLayoutHostAdapter().clearParagraphCache()
  draw.render({ isCompute: true, isSubmitHistory: false, isLazy: false })
  if (json(capture()) !== incremental) throw new Error(`Flow full-commit differential failed: ${kind}`)
  return true
}

async function flowTrial(kind: 'stable' | 'wrap' | 'page', iterations: number) {
  const host = draw.getCanvasEvent()
  const adapt = new CommandAdapt(draw)
  const target = kind === 'stable' ? '你' :
    kind === 'wrap' ? '中文 abcdef '.repeat(18) : '中文 abcdef '.repeat(180)
  const stageNames = ['computeRenderGeometry', 'computeRowList', 'updateFontCoverage']
  const originals = new Map<string, (...args: any[]) => any>()
  let stages: Record<string, number> | null = null
  for (const name of stageNames) {
    const original = Reflect.get(draw, name).bind(draw)
    originals.set(name, original)
    Reflect.set(draw, name, (...args: unknown[]) => {
      const start = performance.now()
      try { return original(...args) } finally {
        if (stages) stages[name] = (stages[name] || 0) + performance.now() - start
      }
    })
  }
  const position = draw.getPosition()
  const positionMethods = new Map<string, (...args: any[]) => any>()
  for (const [method, stage] of [
    ['computePositionList', 'positions'],
    ['computePositionListInternal', 'positionBody'],
    ['computePageRowPositionInternal', 'positionRows']
  ]) {
    const original = Reflect.get(position, method).bind(position)
    positionMethods.set(method, original)
    Reflect.set(position, method, (...args: unknown[]) => {
      const start = performance.now()
      try { return original(...args) } finally {
        if (stages) stages[stage] = (stages[stage] || 0) + performance.now() - start
      }
    })
  }
  const stats = () => ({ ...draw.getFlowStats(), ...position.getPlacementStats() })
  const records: { ms: number; stages: Record<string, number>; work: Record<string, number>;
    trace: { firstPage: number; changedPages: number; addedPages: number;
      changedParagraphs: number; reusedParagraphs: number } }[] = []
  const original = json(draw.getValue().data)
  try {
    // One warmup per scenario, recorded samples keep their fixed order.
    for (let i = -1; i < iterations; i++) {
      host.compositionstart()
      host.input('ni')
      host.input('nihao')
      host.flushComposition(false)
      const before = stats()
      stages = {}
      const start = performance.now()
      host.compositionend(new CompositionEvent('compositionend', { data: target }))
      const ms = performance.now() - start
      const measuredStages = stages
      stages = null
      const change = draw.getLayoutChangeSet()!
      await frame()
      const after = stats()
      const work = Object.fromEntries(Object.entries(after).map(([key, value]) =>
        [key, value - before[key as keyof typeof before]]))
      measuredStages.positionDirectory = measuredStages.positionBody - measuredStages.positionRows
      measuredStages.positionQueryIndex = measuredStages.positions - measuredStages.positionBody
      const lines = position.getNativeLines()
      const placed = lines[Math.floor(lines.length * .85)]
      const startHit = performance.now()
      const hit = position.getNativeCaret(placed.line.source.start, placed.line.source.start)
      if (!hit) throw new Error('Flow benchmark missing suffix caret')
      position.getPositionByXY({ x: hit.x, y: hit.y, pageNo: hit.pageNo })
      measuredStages.firstSuffixQuery = performance.now() - startHit
      const startSnapshot = performance.now()
      position.getOriginalMainPositionList()
      measuredStages.positionSnapshot = performance.now() - startSnapshot
      if (i >= 0) records.push({ ms, stages: measuredStages, work,
        trace: { firstPage: change.firstPage, changedPages: change.changedPages.length,
          addedPages: change.addedPages.length, changedParagraphs: change.changedParagraphs.length,
          reusedParagraphs: change.reusedParagraphs.length } })
      adapt.undo()
      await frame()
    }
    if (json(draw.getValue().data) !== original) throw new Error('Flow benchmark undo mismatch')
    return records
  } finally {
    for (const [name, original] of originals) Reflect.set(draw, name, original)
    for (const [method, original] of positionMethods) Reflect.set(position, method, original)
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, canonical(value)]))
  return value
}
const json = (value: unknown) => JSON.stringify(canonical(value))

/** Semantic closure checks; deliberately separate from performance timing. */
async function closure() {
  let checks = 0
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`${config.profile}/${config.sample}: ${message}`)
    checks++
  }
  const host = draw.getCanvasEvent()
  const range = draw.getRange()
  const adapt = new CommandAdapt(draw)
  await frame(); await frame()
  const startIndex = range.getRange().startIndex
  range.setRange(startIndex, startIndex + 2)
  draw.render({ curIndex: startIndex + 2, isSubmitHistory: false })
  const before = json(draw.getValue().data)
  const history = draw.getHistoryManager().getStats().undo
  let contentChanges = 0
  const onChange = () => { contentChanges++ }
  draw.getEventBus().on('contentChange', onChange)
  try {
    dispatch('compositionstart', '')
    dispatch('input', 'ni')
    await frame()
    dispatch('input', 'nihao')
    host.flushComposition()
    draw.flushCompositionDerivedState()
    const snapshot = json(draw.getValue().data)
    const request = draw.getWorkerManager().getValue()
    check(draw.getHistoryManager().getStats().undo === history, 'preedit history leak')
    dispatch('input', 'nih')
    dispatch('compositionend', '你好')
    dispatch('input', '你好', 'insertText')
    dispatch('compositionend', '你好')
    await frame(); await frame()
    check(json((await request).data) === snapshot, 'async query lost request snapshot')
    const final = json(draw.getValue().data)
    check(json((await draw.getWorkerManager().getValue()).data) === final, 'final async export mismatch')
    check(draw.getHistoryManager().getStats().undo === history + 1, 'not one history entry')
    check(contentChanges === 1, 'duplicate final content event')
    check(!host.isComposing && host.compositionInfo === null, 'stale final session')
    adapt.undo()
    check(json(draw.getValue().data) === before, 'undo did not restore original')
    adapt.redo()
    check(json(draw.getValue().data) === final, 'redo did not restore final')
    await frame(); await frame()
    // rAF is not a timer queue barrier in every engine. Drain the history
    // notifications before attributing subsequent events to cancellation.
    await new Promise(resolve => setTimeout(resolve, 0))
    contentChanges = 0
    const index = range.getRange().endIndex
    range.setRange(Math.max(0, index - 1), Math.min(index + 1, draw.getElementList().length - 1))
    const selected = structuredClone(range.getRange())
    draw.render({ curIndex: selected.endIndex, isSubmitHistory: false })
    const cancelled = json(draw.getValue().data)
    const cancelHistory = draw.getHistoryManager().getStats().undo
    dispatch('compositionstart', '')
    dispatch('input', 'ni')
    host.flushComposition()
    dispatch('input', '')
    host.flushComposition()
    dispatch('compositionend', '')
    await frame(); await frame()
    check(json(draw.getValue().data) === cancelled, 'cancel left document residue')
    check(json(range.getRange()) === json(selected), 'cancel lost selected range')
    check(draw.getHistoryManager().getStats().undo === cancelHistory, 'cancel changed history')
    check(contentChanges === 0, 'cancel emitted a content commit')
    await draw.waitForWorkerLayout()
    if (config.profile === 'worker' && config.sample !== 'table') {
      const mirror = await draw.inspectLayoutWorker()
      const model = { main: getSlimCloneElementList(draw.getOriginalMainElementList()),
        header: getSlimCloneElementList(draw.getHeaderElementList()),
        footer: getSlimCloneElementList(draw.getFooterElementList()) }
      check(json(mirror?.model) === json(model), 'layout worker mirror diverged')
      check(mirror?.documentRevision === draw.getDocumentRevision(), 'mirror revision mismatch')
      const stats = draw.getPerformanceDiagnostics().worker
      check(stats.ready && !stats.pending && !stats.needsResync &&
        !stats.requests && !stats.waiting && !stats.bufferedEdits && !stats.queuedBytes,
      'worker queue did not drain')
    }
    if (config.profile === 'worker' && config.sample === 'table')
      check(!draw.getLayoutWorkerStats().pending, 'table fallback retained pending layout')
    return { checks, history: draw.getHistoryManager().getStats(),
      worker: draw.getPerformanceDiagnostics().worker }
  } finally { draw.getEventBus().off('contentChange', onChange) }
}

async function staleCompositionReply() {
  const client = Reflect.get(draw, 'layoutWorkerClient') as
    import('../../../src/editor/core/worker/layout/LayoutWorkerClient').LayoutWorkerClient
  if (!client?.ready) throw new Error('Expected ready layout worker')
  const layout = client.layout.bind(client)
  let held = false
  let release = () => {}
  client.layout = async (...args) => {
    const result = await layout(...args)
    return new Promise<typeof result>(resolve => {
      held = true
      release = () => resolve(result)
    })
  }
  try {
    draw.getRange().setRange(3, 3)
    draw.render({ curIndex: 3, isSubmitHistory: false })
    draw.getCanvasEvent().input('x')
    for (let i = 0; i < 120 && !held; i++) await frame()
    if (!held) throw new Error('No worker layout response was held')
    dispatch('compositionstart', '')
    dispatch('input', 'ni')
    dispatch('compositionend', '你')
    draw.flushPaint()
    const final = json(draw.getValue().data)
    const pixels = draw.getPageList().map(canvas => canvas.toDataURL())
    release()
    await draw.waitForWorkerLayout()
    draw.flushPaint()
    if (json(draw.getValue().data) !== final ||
      json(draw.getPageList().map(canvas => canvas.toDataURL())) !== json(pixels))
      throw new Error('Old layout response overwrote final composition')
    return true
  } finally { release(); client.layout = layout }
}

async function preedit(value: string) {
  if (!draw.getCanvasEvent().isComposing) dispatch('compositionstart', '')
  dispatch('input', value)
  await frame(); await frame()
  return { images: [...document.querySelectorAll<HTMLCanvasElement>('#editor canvas')]
    .map(canvas => canvas.toDataURL()), text: currentText(),
    range: { ...draw.getRange().getRange() },
    composition: draw.getCanvasEvent().getCompositionDiagnostics() }
}

function finish(mode: 'synthetic' | 'manual' = 'manual') {
  active = false
  cancelAnimationFrame(raf)
  const inputs = events.filter(e => e.type === 'input' && e.isComposing)
  const gaps = frames.slice(1).map((t, i) => t - frames[i])
  const value = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)?.value || ''
  const checked = (id: string) =>
    (document.getElementById(id) as HTMLInputElement)?.checked ? 'passed' : 'pending'
  return { config, mode, events, frames, paints, stages, preeditStages, commits, nextFrames,
    sourceHash: value('qa-source'), recordedAt: new Date().toISOString(),
    nativeReview: { candidateWindow: checked('qa-candidate'), visibleRefresh: checked('qa-refresh'),
      commit: checked('qa-commit'), cancel: checked('qa-cancel'), notes: value('qa-notes') },
    original, finalText: currentText(),
    composition: finalDiagnostics || draw.getCanvasEvent().getCompositionDiagnostics(),
    handler: distribution(inputs.map(e => e.handlerMs || 0)), frameGaps: distribution(gaps),
    updateToGeometryProxy: distribution(commits.map(commit => commit.latency)),
    updateToNextRaf: distribution(nextFrames),
    received: inputs.length, submitted: inputs.filter(e => e.status === 'submitted').length,
    merged: inputs.filter(e => e.status === 'merged').length,
    finalized: inputs.filter(e => e.status === 'finalized').length,
    environment: { userAgent: navigator.userAgent, dpr: devicePixelRatio,
      languages: navigator.languages, platform: value('qa-platform'), osVersion: value('qa-os'),
      browserVersion: value('qa-browser'), inputMethod: value('qa-ime') ||
        new URLSearchParams(location.search).get('inputMethod') || 'not recorded',
      inputMethodVersion: value('qa-ime-version') },
    overFrameBudget: gaps.filter(gap => gap > 16.7).length,
    semantics: 'Synthetic dispatch is untrusted and is not OS IME. Paint/rAF are submission proxies, not actual presentation. Inclusive stages overlap.',
    diagnostics: draw.getPerformanceDiagnostics(), bodyText: text() }
}

function dispose() {
  active = false
  cancelAnimationFrame(raf)
  draw?.destroy()
}

declare global {
  interface Window { imePerformance: { setup: typeof setup; begin: typeof begin;
    resetTrial: typeof resetTrial;
    replay: typeof replay; preedit: typeof preedit; closure: typeof closure;
    staleCompositionReply: typeof staleCompositionReply; flowTrial: typeof flowTrial;
    flowDifferential: typeof flowDifferential;
    finish: typeof finish; dispose: typeof dispose } }
}
document.querySelector('#record')!.addEventListener('click', () => begin())
document.querySelector('#save')!.addEventListener('click', () => {
  const result = finish()
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = 'ime-manual.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
})
const params = new URLSearchParams(location.search)
const imeInput = document.getElementById('qa-ime') as HTMLInputElement
imeInput.value = params.get('inputMethod') || ''
try {
  const stamp = params.get('sourceHash') || (await (await fetch(
    base + 'cypress/results/ime/release-source.json')).json()).sourceHash
  if (/^[a-f0-9]{64}$/.test(stamp)) {
    const sourceInput = document.getElementById('qa-source') as HTMLInputElement
    sourceInput.value = stamp
    document.getElementById('qa-source-status')!.textContent = '已绑定当前验收源码。'
  }
} catch { /* Unbound records can be saved but cannot satisfy the release gate. */ }
await setup({ profile: (params.get('performance') || 'baseline') as PerformanceProfile,
  preview: params.get('imePreview') === 'on', sample: (params.get('sample') || 'short') as Config['sample'] })
window.imePerformance = { setup, begin, replay, preedit, closure, resetTrial,
  staleCompositionReply, flowTrial, flowDifferential, finish, dispose }

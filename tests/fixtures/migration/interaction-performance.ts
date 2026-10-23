import { ElementBridge } from '../../../src/editor/core/text-engine-host/ElementBridge'
import { NativeQueryIndex } from '../../../src/editor/core/layout/NativeQueryIndex'
import { Draw } from '../../../src/editor/core/draw/Draw'
import { Listener } from '../../../src/editor/core/listener/Listener'
import { EventBus } from '../../../src/editor/core/event/eventbus/EventBus'
import { Override } from '../../../src/editor/core/override/Override'
import { LineGeometryIndex } from '../../../src/editor/core/layout/LineGeometryIndex'
import { HarfBuzzTextShaper } from '../../../src/editor/core/text-engine/shape/HarfBuzzTextShaper'
import { TextLayoutEngine } from '../../../src/editor/core/text-engine/layout/TextLayoutEngine'
import { BidiResolver } from '../../../src/editor/core/text-engine/bidi/BidiResolver'
import { mergeOption } from '../../../src/editor/utils/option'
import { formatElementList, getSlimCloneElementList } from '../../../src/editor/utils/element'
import {
  interactionPerformanceSamples,
  migrationOptions
} from './documents'
import { distribution, QAProfiler } from './performanceMetrics'

// QA entry point only: nothing in this file is imported by the library/demo.
const profiler = new QAProfiler()
profiler.track(Draw.prototype, 'render', 'render')
profiler.track(Draw.prototype, 'createHistorySnapshot', 'historyCheckpoint')
profiler.track(ElementBridge.prototype, 'scanParagraphs', 'paragraphScanBuild', args => ({
  elements: (args[3] ?? args[0].length) - (args[2] || 0)
}))
profiler.track(NativeQueryIndex, 'create', 'queryIndexBuild', args => ({
  placements: args[0].length
}))
profiler.track(Draw.prototype, 'spliceElementList', 'mutation', args => ({
  deletedElements: args[2],
  insertedElements: args[3]?.length || 0
}))
profiler.track(Draw.prototype, 'deleteElementList', 'deleteMutation')
profiler.track(Draw.prototype, 'computeRowList', 'flow', (args, result) => ({
  inputElements: args[0].elementList.length,
  outputRows: result.length
}))
profiler.track(Draw.prototype, '_computePageList', 'pagination')
profiler.track(Draw.prototype, 'submitHistory', 'history')
profiler.track(Draw.prototype, '_drawPage', 'paint', args => ({
  pages: 1,
  rows: args[0].rowList.length
}))
profiler.track(Draw.prototype, 'updateFontCoverage', 'coverage')
profiler.track(HarfBuzzTextShaper.prototype, 'shape', 'shaping', args => ({
  utf16Units: args[0].text.length
}))
profiler.track(BidiResolver.prototype, 'getLevelRuns', 'bidi', args => ({
  utf16Units: args[0].length
}))
profiler.track(TextLayoutEngine.prototype, 'breakLines', 'lineBreaking')
profiler.track(LineGeometryIndex, 'create', 'lineGeometryBuild', (_, result) => ({
  placements: 1,
  carets: result.carets.length,
  segments: result.segments.length
}))

type Action = 'input' | 'backspace' | 'delete'
interface Config {
  sample: string
  position: 'start' | 'middle' | 'end'
  action: Action
  pageMode: 'paging' | 'continuity'
  history: boolean
  incremental: boolean
  instrumentation: boolean
  deferredPaint: boolean
  trackedEdits: boolean
  advancedLayout: boolean
  workerLayout: boolean
  workerTransfer: boolean
  capacity: number
}
interface EventSample {
  type: string
  key: string | null
  inputType: string | null
  trusted: boolean
  repeat: boolean
  receivedAt: number
  dispatchToHandlerMs: number
  handlerMs?: number
  operation?: number
}
let draw: any
let config: Config
let active = false
let startedAt = 0
let frames: number[] = []
let memorySamples: { at: number; heap: ReturnType<typeof memory> }[] = []
let frameId = 0
let events: EventSample[] = []
let eventSamples = new WeakMap<Event, EventSample>()
let longTasks: { startTime: number; duration: number }[] = []
let eventTiming: any[] = []
let initial: Record<string, string> = {}
let targetScope = ''
let initialIndex = 0
let initialOffset = 0
let initialPageCount = 0
let finished: any
let optimizationBefore: any
let commitLatencies: number[] = []
let rafCommitLatencies: number[] = []
let modelTimes = new Map<number, { receivedAt: number; operation: number }>()
let observedOperations = 0
let geometryCommits: { operation: number; atMs: number }[] = []
let historyBaseline: any
let historyBefore = 0
const observers: PerformanceObserver[] = []
const marker = 'PERF01EDIT'
const bytes = await fetch(
  '/canvas-editor/fonts/NotoNaskhArabic-Regular.ttf'
).then(r => r.arrayBuffer())

function scopes() {
  const result: { id: string; elements: any[]; context?: any }[] = []
  const visit = (elements: any[], id: string, context?: any) => {
    result.push({ id, elements, context })
    elements.forEach((element, index) => {
      element.trList?.forEach((row: any, trIndex: number) => {
        row.tdList.forEach((td: any, tdIndex: number) => {
          const step = { index, trIndex, tdIndex }
          visit(td.value, `${id}/${index}:${trIndex}:${tdIndex}`, {
            isTable: true,
            ...step,
            tablePath: [...(context?.tablePath || []), step]
          })
        })
      })
    })
  }
  visit(draw.getOriginalMainElementList(), 'main')
  visit(draw.getHeader().getElementList(), 'header')
  visit(draw.getFooter().getElementList(), 'footer')
  return result
}
function textSnapshot() {
  return Object.fromEntries(
    scopes().map(scope => [
      scope.id,
      scope.elements.map(element => element.value).join('')
    ])
  )
}
function memory() {
  const heap = (performance as any).memory
  return heap
    ? {
        usedJSHeapSize: heap.usedJSHeapSize,
        totalJSHeapSize: heap.totalJSHeapSize,
        jsHeapSizeLimit: heap.jsHeapSizeLimit
      }
    : null
}
function observe(type: string, consume: (entries: any[]) => void) {
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) return
  const observer = new PerformanceObserver(list => consume(list.getEntries()))
  observer.observe({ type, ...(type === 'event' ? { durationThreshold: 16 } : {}) })
  observers.push(observer)
}
function consumePending() {
  observers.forEach(observer => {
    for (const entry of observer.takeRecords()) {
      if (entry.entryType === 'longtask')
        longTasks.push({ startTime: entry.startTime, duration: entry.duration })
      else if (entry.entryType === 'event') eventTiming.push(entry.toJSON())
    }
  })
}
function frame() {
  if (!active) return
  const now = performance.now()
  frames.push(now)
  if (!memorySamples.length || now - memorySamples.at(-1)!.at >= 1000)
    memorySamples.push({ at: now, heap: memory() })
  frameId = requestAnimationFrame(frame)
}
function startEvent(event: Event) {
  if (!active) return
  const key = event as KeyboardEvent
  const input = event as InputEvent
  const stamp =
    event.timeStamp > performance.timeOrigin
      ? event.timeStamp - performance.timeOrigin
      : event.timeStamp
  const sample: EventSample = {
    type: event.type,
    key: key.key || null,
    inputType: input.inputType || null,
    repeat: key.repeat || false,
    trusted: event.isTrusted,
    receivedAt: performance.now(),
    dispatchToHandlerMs: Math.max(0, performance.now() - stamp)
  }
  const actionEvent = config.action === 'input'
    ? event.type === 'input' && input.inputType === 'insertText'
    : event.type === 'keydown' && key.key === (config.action === 'backspace' ? 'Backspace' : 'Delete')
  if (actionEvent) sample.operation = observedOperations++
  events.push(sample)
  eventSamples.set(event, sample)
}
function endEvent(event: Event) {
  const sample = eventSamples.get(event)
  if (sample) sample.handlerMs = performance.now() - sample.receivedAt
}

async function setup(next: Config) {
  if (draw) dispose()
  config = next
  profiler.enabled = next.instrumentation
  profiler.reset('startup')
  const sample = interactionPerformanceSamples().find(s => s.id === next.sample)
  if (!sample) throw new Error(`Unknown interaction sample: ${next.sample}`)
  // The ASCII lane is prepared before editor creation, never inserted by splice
  // during measurement. It provides an independent exact oracle for every key.
  const leaves: any[] = []
  const visit = (elements: any[]) => {
    for (const element of elements) {
      if (element.trList)
        for (const row of element.trList)
          for (const td of row.tdList) visit(td.value)
      else if (!element.type && element.value !== '\n') leaves.push(element)
    }
  }
  visit(sample.data.main)
  const leaf =
    leaves[next.position === 'start'
      ? 0
      : next.position === 'end'
        ? leaves.length - 1
        : Math.floor(leaves.length / 2)]
  if (!leaf) throw new Error('Sample has no plain editable text')
  const lane = marker + 'a'.repeat(next.capacity + 8) + 'ENDPERF01'
  leaf.value = next.position === 'end' ? leaf.value + lane : lane + leaf.value
  const options = mergeOption({
    ...migrationOptions,
    ...sample.options,
    pageMode: next.pageMode as any,
    ...(next.history ? {} : { historyMaxRecordCount: 0 }),
    autoDownloadFonts: false,
    lab: { incrementalCompute: next.incremental,
      deferredPaint: next.deferredPaint,
      incrementalEditing: next.trackedEdits,
      transactionHistory: next.trackedEdits,
      incrementalCoverage: next.trackedEdits,
      glyphPathCache: next.advancedLayout,
      shapingRunCache: next.advancedLayout,
      incrementalFlow: next.advancedLayout,
      dirtyPagePaint: next.advancedLayout,
      layoutWorker: next.workerLayout,
      workerTransfer: next.workerTransfer },
    fonts: [{ family: 'Noto Naskh Arabic', data: bytes }]
  })
  const content = {
    main: sample.data.main,
    header: sample.data.header || [],
    footer: sample.data.footer || []
  }
  Object.values(content).forEach(elements =>
    formatElementList(elements, {
      editorOptions: options,
      isForceCompensation: true
    })
  )
  const start = performance.now()
  draw = new Draw(
    document.querySelector<HTMLDivElement>('#editor')!,
    options,
    content,
    new Listener(),
    new EventBus(),
    new Override()
  )
  await draw.ready
  await draw.waitForWorkerLayout()
  draw.getEditJournal().subscribe((transaction: any) => {
    if (!active || transaction.source !== 'edit') return
    const type = config.action === 'input' ? 'input' : 'keydown'
    const event = events.findLast(sample => sample.type === type)
    if (event?.operation !== undefined) modelTimes.set(transaction.targetRevision,
      { receivedAt: event.receivedAt, operation: event.operation })
  })
  draw.getEventBus().on('renderChange', () => {
    if (!active) return
    const revision = draw.getDocumentRevision()
    for (const [modelRevision, event] of modelTimes) {
      if (modelRevision > revision) continue
      modelTimes.delete(modelRevision)
      commitLatencies.push(performance.now() - event.receivedAt)
      geometryCommits.push({ operation: event.operation, atMs: performance.now() - startedAt })
      requestAnimationFrame(() => {
        if (active) rafCommitLatencies.push(performance.now() - event.receivedAt)
      })
    }
  })
  const adapter = draw.getLayoutHostAdapter()
  profiler.track(adapter, 'withListMarkers', 'markerContext', args => ({
    elements: args[0].length
  }))
  profiler.track(adapter, 'scanParagraphs', 'scan', (args, result) => ({
    inputElements: (args[3] ?? args[0].length) - (args[2] || 0),
    paragraphs: result.length
  }))
  profiler.track(adapter.nativeCache, 'compute', 'paragraphCache')
  profiler.track(adapter.getTextLayoutService(), 'layoutParagraph', 'paragraphLayout')
  profiler.track(draw.getPosition(), 'computePositionList', 'positions')
  profiler.track(draw.getPosition(), 'computePageRowPosition', 'pagePositions',
    args => ({
      elements: args[0].rowList.reduce(
        (sum: number, row: any) => sum + row.elementList.length, 0
      )
    }))
  profiler.track(draw.getPosition(), 'getNativeDeleteRange', 'deleteQuery')
  profiler.track(adapter, 'collectFontCoverage', 'coverageScan', (_, result) => ({
    inputs: result.length
  }))
  const found = scopes().find(scope =>
    scope.elements.map(element => element.value).join('').includes(marker)
  )!
  targetScope = found.id
  draw.getPosition().setPositionContext(found.context || { isTable: false })
  const markerStart = found.elements.findIndex(el => el.value === marker[0] &&
    found.elements.slice(found.elements.indexOf(el),
      found.elements.indexOf(el) + marker.length
    ).map(element => element.value).join('') === marker)
  if (markerStart < 0) throw new Error('Editing lane was not normalized')
  initialIndex = markerStart + marker.length - 1 +
    (next.action === 'backspace' ? next.capacity + 4 : 4)
  draw.getRange().setRange(initialIndex, initialIndex)
  draw.render({ curIndex: initialIndex, isCompute: false, isSubmitHistory: false })
  const caret = draw.getPosition().getNativeCaret(initialIndex)
  if (caret) draw.getPageList()[caret.pageNo]?.scrollIntoView({ block: 'center' })
  const agent = draw.getCursor().getAgentDom() as HTMLTextAreaElement
  agent.dataset.performanceAgent = 'true'
  draw.getCursor().focus()
  for (const type of ['keydown', 'keyup', 'beforeinput', 'input']) {
    agent.addEventListener(type, startEvent, true)
    agent.addEventListener(type, endEvent)
  }
  await settle()
  return {
    startupMs: performance.now() - start,
    historyMaxRecordCount: options.historyMaxRecordCount,
    targetScope,
    pages: draw.getPageCount(),
    elements: scopes().reduce((sum, scope) => sum + scope.elements.length, 0),
    memory: memory()
  }
}

async function settle() {
  // Observation barrier only. This is NOT a claim that pixels reached a screen.
  await new Promise(resolve => requestAnimationFrame(() =>
    requestAnimationFrame(resolve)))
  await new Promise(resolve => setTimeout(resolve, 60))
}
function begin() {
  consumePending()
  observers.forEach(observer => observer.disconnect())
  observers.length = 0
  initial = textSnapshot()
  initialPageCount = draw.getPageCount()
  const target = scopes().find(scope => scope.id === targetScope)!
  initialIndex = draw.getRange().getRange().startIndex
  initialOffset = target.elements.slice(0, initialIndex + 1)
    .map(element => element.value).join('').length
  optimizationBefore = optimizationStats()
  modelTimes = new Map()
  observedOperations = 0
  geometryCommits = []
  commitLatencies = []
  rafCommitLatencies = []
  profiler.reset('interaction')
  events = []
  frames = []
  memorySamples = []
  longTasks = []
  eventTiming = []
  eventSamples = new WeakMap()
  observe('longtask', entries => longTasks.push(...entries.map(entry => ({
    startTime: entry.startTime, duration: entry.duration
  }))))
  observe('event', entries => eventTiming.push(...entries.map(e => e.toJSON())))
  active = true
  startedAt = performance.now()
  frameId = requestAnimationFrame(frame)
  performance.mark('perf01:interaction-start')
  return { startedAt, memory: memory() }
}
function historyState() {
  return {
    data: ['main', 'header', 'footer'].map(id => getSlimCloneElementList(
      scopes().find(scope => scope.id === id)!.elements)),
    context: structuredClone(draw.getPosition().getPositionContext()),
    range: structuredClone(draw.getRange().getRange())
  }
}
function prepareHistoryCheck() {
  draw.getHistoryManager().closeGroup()
  historyBefore = draw.getHistoryManager().getStats().undo
  historyBaseline = historyState()
}
async function verifyHistory() {
  const manager = draw.getHistoryManager()
  const groups = manager.getStats().undo - historyBefore
  if (groups <= 0) throw new Error('No measured history groups retained')
  const after = historyState()
  for (let i = 0; i < groups; i++) manager.undo()
  await settle()
  const restored = historyState()
  for (let i = 0; i < groups; i++) manager.redo()
  await settle()
  const redone = historyState()
  const result = {
    groups,
    undo: JSON.stringify(restored) === JSON.stringify(historyBaseline),
    redo: JSON.stringify(redone) === JSON.stringify(after)
  }
  if (!result.undo || !result.redo) throw new Error(`History mismatch: ${JSON.stringify(result)}`)
  historyBaseline = null
  return result
}
async function finish(sent: number) {
  await draw.waitForWorkerLayout()
  await settle()
  active = false
  cancelAnimationFrame(frameId)
  consumePending()
  observers.forEach(observer => observer.disconnect())
  const final = textSnapshot()
  const before = initial[targetScope]
  const expected = { ...initial }
  expected[targetScope] = config.action === 'input'
    ? before.slice(0, initialOffset) + 'x'.repeat(sent) + before.slice(initialOffset)
    : config.action === 'backspace'
      ? before.slice(0, initialOffset - sent) + before.slice(initialOffset)
      : before.slice(0, initialOffset) + before.slice(initialOffset + sent)
  const range = draw.getRange().getRange()
  const expectedIndex = initialIndex +
    (config.action === 'input' ? sent : config.action === 'backspace' ? -sent : 0)
  const key = config.action === 'input' ? 'x' :
    config.action === 'backspace' ? 'Backspace' : 'Delete'
  const keydowns = events.filter(e => e.type === 'keydown' && e.key === key)
  const completed = keydowns.filter(e => e.handlerMs !== undefined)
  const matched = JSON.stringify(expected) === JSON.stringify(final)
  const selected = range.startIndex === expectedIndex && range.endIndex === expectedIndex
  const pendingHandlers = events.filter(e => e.handlerMs === undefined).length
  const trusted = events.every(e => e.trusted)
  const checks = {
    content: matched,
    selection: selected,
    receivedAll: keydowns.length === sent,
    completedAll: completed.length === sent && pendingHandlers === 0,
    trusted,
    geometryCommitted: !config.trackedEdits || commitLatencies.length === sent,
    inputChain: config.action !== 'input' || ['beforeinput', 'input'].every(type =>
      events.filter(e => e.type === type && e.inputType === 'insertText').length === sent),
    repeat: keydowns[0]?.repeat === false && keydowns.slice(1).every(e => e.repeat)
  }
  const gaps = frames.slice(1).map((time, i) => time - frames[i])
  performance.mark('perf01:interaction-settled')
  finished = {
    schemaVersion: 1,
    config,
    elapsedMs: performance.now() - startedAt,
    sent,
    received: keydowns.length,
    completed: completed.length,
    pendingHandlers,
    repeatEvents: keydowns.filter(e => e.repeat).length,
    checks,
    passed: Object.values(checks).every(Boolean),
    selection: { startIndex: range.startIndex, endIndex: range.endIndex, expectedIndex },
    content: {
      scope: targetScope,
      beforeLength: before.length,
      expectedLength: expected[targetScope].length,
      actualLength: final[targetScope].length,
      ...(matched ? {} : { expected: expected[targetScope], actual: final[targetScope] })
    },
    events,
    timings: {
      dispatchToHandlerMs: distribution(keydowns.map(e => e.dispatchToHandlerMs)),
      keydownHandlerMs: distribution(completed.map(e => e.handlerMs!)),
      inputHandlerMs: distribution(events.filter(e => e.type === 'input')
        .map(e => e.handlerMs!)),
      rafGapMs: distribution(gaps),
      geometryCommitMs: distribution(commitLatencies),
      commitNextRafMs: distribution(rafCommitLatencies)
    },
    geometryCommits,
    rafTimestamps: frames,
    memorySamples,
    longTasks,
    eventTiming,
    stages: profiler.stages,
    pagesBefore: initialPageCount,
    pagesAfter: draw.getPageCount(),
    memory: memory(),
    optimizationBefore,
    optimizationStats: optimizationStats(),
    supportedEntryTypes: PerformanceObserver.supportedEntryTypes
  }
  return finished
}
function optimizationStats() {
  return {
    paragraphCache: { ...draw.getLayoutHostAdapter().nativeCache.stats },
    coverage: { ...draw.getLayoutHostAdapter().coverageStats },
    history: draw.getHistoryManager().getStats(),
    documentRevision: draw.getDocumentRevision(),
    derived: { ...draw.getDerivedState().stats },
    flow: { ...draw.getFlowStats() },
    runs: { ...draw.getLayoutHostAdapter().getRunStats() },
    paths: { ...draw.getLayoutHostAdapter().getGlyphRenderer().stats },
    worker: draw.getLayoutWorkerStats(),
    placements: draw.getPosition().getPlacementStats(),
    diagnostics: draw.getPerformanceDiagnostics()
  }
}
function dispose() {
  active = false
  cancelAnimationFrame(frameId)
  observers.forEach(observer => observer.disconnect())
  observers.length = 0
  if (draw) draw.destroy()
  draw = null
  return { canvases: document.querySelectorAll('#editor canvas').length }
}
function progress() {
  const key = config.action === 'input' ? 'x' :
    config.action === 'backspace' ? 'Backspace' : 'Delete'
  return {
    active,
    keydownCount: events.filter(e => e.type === 'keydown' && e.key === key).length
  }
}
Object.assign(window, {
  interactionPerformance: { setup, begin, finish, settle, dispose,
    prepareHistoryCheck, verifyHistory,
    progress,
    samples: interactionPerformanceSamples().map(sample => sample.id),
    getResult: () => finished }
})
document.querySelector('#status')!.textContent = 'ready'

import { Draw } from '../../../src/editor/core/draw/Draw'
import { Listener } from '../../../src/editor/core/listener/Listener'
import { EventBus } from '../../../src/editor/core/event/eventbus/EventBus'
import { Override } from '../../../src/editor/core/override/Override'
import { CommandAdapt } from '../../../src/editor/core/command/CommandAdapt'
import { ZERO } from '../../../src/editor/dataset/constant/Common'
import { ElementType } from '../../../src/editor/dataset/enum/Element'
import { TextDirection } from '../../../src/editor/dataset/enum/TextDirection'
import { formatElementList, getSlimCloneElementList } from '../../../src/editor/utils/element'
import { mergeOption } from '../../../src/editor/utils/option'
import type { IElement } from '../../../src/editor/interface/Element'
import type { LayoutWorkerClient } from '../../../src/editor/core/worker/layout/LayoutWorkerClient'
import { TableLayoutCache } from '../../../src/editor/core/layout/TableLayoutCache'

type Kind = 'table' | 'large' | 'merged' | 'nested' | 'repeated' | 'rtl' | 'plain' | 'wide'
type Config = { kind: Kind; tableCache: boolean; workerPreview: boolean
  denied?: boolean; tableCacheEntries?: number }
let draw: Draw
let config: Config
let original = ''
let originalElements: string[] = []
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const base = import.meta.env.BASE_URL
const fonts = await Promise.all([
  ['Latin', 'tests/fixtures/fonts/NotoSans-Latin-Regular.woff2'],
  ['CJK', 'tests/fixtures/fonts/NotoSansSC-Regular.woff2'],
  ['Arabic', 'fonts/NotoNaskhArabic-Regular.ttf']
].map(async ([family, file]) => ({ family,
  data: await (await fetch(base + file)).arrayBuffer() })))
const values = ['n', 'ni', 'nih', 'niha', 'nihao', 'ni', '']
const host = () => draw.getCanvasEvent()
const text = () => draw.getElementList().map(e => e.value).join('')

function table(rows: number, columns: number, width = 130): IElement {
  return { type: ElementType.TABLE, value: '',
    colgroup: Array.from({ length: columns }, () => ({ width })),
    trList: Array.from({ length: rows }, () => ({ height: 40,
      tdList: Array.from({ length: columns }, () => ({ rowspan: 1, colspan: 1,
        value: [{ value: config.kind === 'rtl' ? 'مرحبا abc' : 'abc' }] })) })) }
}

async function setup(next: Config) {
  dispose()
  config = next
  const body = next.kind === 'plain' || next.kind === 'wide'
  const main: IElement[] = body ? [{ value: next.kind === 'wide'
    ? 'office fi e\u0301 '.repeat(60) : '中文 abcdef' }] : [table(next.kind === 'large' ? 150 : 24, 4)]
  if (next.kind === 'merged') {
    main[0].trList![0].tdList[0].rowspan = 2
    main[0].trList![1].tdList.shift()
    main[0].trList![3].tdList[0].colspan = 2
    main[0].trList![3].tdList.splice(1, 1)
  }
  if (next.kind === 'nested') main[0].trList![5].tdList[1].value = [table(6, 2, 50)]
  if (next.kind === 'repeated') main[0].trList![0].pagingRepeat = true
  if (next.kind === 'rtl') main[0].direction = TextDirection.RTL
  const options = mergeOption({ autoDownloadFonts: false, defaultFont: 'CJK', fonts,
    width: next.kind === 'wide' ? 9000 : 600, height: next.kind === 'wide' ? 180 : 600,
    margins: [20, 20, 20, 20], header: { disabled: true }, footer: { disabled: true },
    pageNumber: { disabled: true }, lab: { performanceProfile: body ? 'worker' : 'sync',
      imePreview: true, incrementalCompute: false, imeTableLayout: next.tableCache,
      imeWorkerPreview: next.workerPreview } })
  const content = { main, header: [{ value: ZERO }], footer: [{ value: ZERO }] }
  Object.values(content).forEach(elements => formatElementList(elements,
    { editorOptions: options, isForceCompensation: true }))
  const container = document.createElement('div')
  document.querySelector('#editor')!.append(container)
  const WorkerClass = window.Worker
  if (next.denied) window.Worker = class {
    constructor() { throw new Error('Simulated CSP worker-src none') }
  } as unknown as typeof Worker
  try {
    draw = new Draw(container, options, content, new Listener(), new EventBus(), new Override())
    await draw.ready
    if (next.tableCacheEntries !== undefined)
      Reflect.set(draw, 'tableLayoutCache', new TableLayoutCache(next.tableCacheEntries))
    if (!body) {
      const root = draw.getOriginalMainElementList()
      const index = root.findIndex(e => e.type === ElementType.TABLE)
      const outer = root[index]
      const trIndex = next.kind === 'merged' ? 0 : next.kind === 'large' ? 149 : 5
      const tdIndex = next.kind === 'merged' ? 0 : next.kind === 'large' ? 3 : 1
      const td = outer.trList![trIndex].tdList[tdIndex]
      const first = { index, trIndex, tdIndex, tableId: outer.id, tdId: td.id }
      if (next.kind === 'nested') {
        const nestedIndex = td.value.findIndex(e => e.type === ElementType.TABLE)
        const inner = td.value[nestedIndex]
        const child = inner.trList![3].tdList[0]
        const last = { index: nestedIndex, trIndex: 3, tdIndex: 0,
          tableId: inner.id, tdId: child.id }
        draw.getPosition().setPositionContext({ isTable: true, ...last, tablePath: [first, last] })
      } else draw.getPosition().setPositionContext({ isTable: true, ...first })
    }
    resetRange()
    await draw.waitForWorkerLayout()
  } finally { window.Worker = WorkerClass }
  const caret = draw.getPosition().getNativeCaret(1)
  draw.getPageList()[caret?.pageNo || 0].scrollIntoView({ block: 'center' })
  await frame(); await frame()
  original = text()
  originalElements = draw.getElementList().map(e => e.value)
  return { pages: draw.getPageList().length, elements: draw.getElementList().length,
    worker: draw.getLayoutWorkerStats().ready, options: draw.getOptions().lab }
}

function resetRange() {
  draw.getRange().setRange(1, 1)
  draw.render({ curIndex: 1, isSubmitHistory: false, isLazy: false })
}

function end(value: string) {
  host().compositionend(new CompositionEvent('compositionend', { data: value }))
}

function canonical(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e8) / 1e8
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'tableId', 'tdId', 'trId', 'nodeId', 'paragraphId',
      'diagnosticId', 'documentRevision'].includes(key))
    .map(([key, item]) => [key, key === 'scope' ?
      String(item).replace(/td:.*/, 'cell').replace(/^(main|ime-preview)$/, 'text') : canonical(item)]))
  return value
}

function geometry(elements = draw.getOriginalMainElementList()): unknown[] {
  return elements.flatMap(element => (element.trList || []).map(row => ({ height: row.height,
    repeated: row.pagingRepeat, cells: row.tdList.map(cell => ({ x: cell.x, y: cell.y,
      width: cell.width, height: cell.height, mainHeight: cell.mainHeight,
      positions: cell.positionList?.map(p => ({ coordinate: p.coordinate,
        pageNo: p.pageNo, ascent: p.ascent, left: p.left, metrics: p.metrics })),
      children: geometry(cell.value) })) })))
}

function snapshot() {
  for (let pageNo = 0; pageNo < draw.getPageList().length; pageNo++)
    Reflect.get(draw, 'paintPage').call(draw, pageNo)
  const preview = Reflect.get(draw, 'compositionPreview')
  const caret = preview?.caret || draw.getPosition().getNativeCaret(draw.getRange().getRange().endIndex)
  const body = config.kind === 'plain' || config.kind === 'wide'
  const session = Reflect.get(host(), 'compositionSession')
  const visible = session?.local ? [...originalElements.slice(0, 2),
    session.value, ...originalElements.slice(2)].join('') : text()
  const line = preview ? Reflect.get(preview, 'current').line :
    draw.getPosition().getNativeLines().find(p => p.line.id === caret?.lineId)?.line
  return { images: draw.getPageList().map(canvas => canvas.toDataURL()),
    geometry: JSON.stringify(canonical(geometry())),
    previewGeometry: body ? JSON.stringify(canonical(line)) : null,
    model: body ? visible : JSON.stringify(canonical(
      getSlimCloneElementList(draw.getOriginalMainElementList()))),
    caret: caret && { x: caret.x, y: caret.y, height: caret.height, pageNo: caret.pageNo },
    tables: draw.getTableLayoutStats(), composition: host().getCompositionDiagnostics() }
}

async function differential() {
  host().compositionstart()
  const results = []
  const sequence = config.kind === 'plain' || config.kind === 'wide' ? values
    : config.kind === 'large' ? ['n', 'ni', '']
      : [...values, '中文 '.repeat(config.kind === 'nested' ? 3 : 25), 'ni']
  for (const value of sequence) {
    host().input(value)
    host().flushComposition(false)
    await draw.waitForCompositionPreview()
    await frame(); await frame()
    results.push(snapshot())
  }
  end('你')
  const final = text()
  if (final !== original.slice(0, 2) + '你' + original.slice(2))
    throw new Error('Final composition text mismatch')
  new CommandAdapt(draw).undo()
  if (text() !== original) throw new Error('Composition undo mismatch')
  new CommandAdapt(draw).redo()
  if (text() !== final) throw new Error('Composition redo mismatch')
  return { results, final }
}

async function trial(iterations: number, grow = false) {
  const samples = []
  const drains = []
  const intervals: [number, number][] = []
  const tasks: { start: number; ms: number }[] = []
  const longtaskSupported = PerformanceObserver.supportedEntryTypes?.includes('longtask') || false
  const observer = longtaskSupported ? new PerformanceObserver(list => {
    for (const item of list.getEntries()) tasks.push({ start: item.startTime, ms: item.duration })
  }) : null
  observer?.observe({ type: 'longtask', buffered: false })
  try {
    for (let iteration = -1; iteration < iterations; iteration++) {
      resetRange()
      await draw.waitForWorkerLayout()
      host().compositionstart()
      const sequence = grow ? ['中文 '.repeat(25), '中文 '.repeat(26), 'ni'] : values
      for (const value of sequence) {
        const workerBefore = draw.getCompositionWorkerStats()
        const started = performance.now()
        host().input(value)
        host().flushComposition(false)
        const handlerMs = performance.now() - started
        await draw.waitForCompositionPreview()
        const geometryMs = performance.now() - started
        await frame()
        const nextRafMs = performance.now() - started
        if (iteration >= 0) {
          intervals.push([started, performance.now()])
          samples.push({ handlerMs, geometryMs, nextRafMs,
            workerWork: Object.fromEntries(['submitted', 'committed', 'stale', 'fallbacks', 'deadlines']
              .map(key => [key, Number(Reflect.get(draw.getCompositionWorkerStats(), key)) -
                Number(Reflect.get(workerBefore, key))])),
            tables: draw.getTableLayoutStats(), composition: host().getCompositionDiagnostics() })
        }
      }
      end('')
      if (text() !== original) throw new Error('Composition cancel mismatch')
      const started = performance.now()
      await draw.waitForWorkerLayout()
      if (iteration >= 0) drains.push(performance.now() - started)
      await frame()
    }
    await frame(); await frame()
  } finally { observer?.disconnect() }
  return { samples, drains, longtaskSupported, longtasks: tasks.filter(task => intervals.some(
    ([start, end]) => task.start >= start && task.start < end)),
    worker: draw.getPerformanceDiagnostics().worker }
}

async function boundary(kind: 'stale' | 'deadline' | 'fault' | 'oversize' | 'denied') {
  const client = Reflect.get(draw, 'layoutWorkerClient') as LayoutWorkerClient | null
  const releases: (() => void)[] = []
  if (kind === 'stale' || kind === 'deadline') {
    if (!client?.ready) throw new Error('Expected a real initialized Worker')
    const preview = client.preview.bind(client)
    client.preview = (...args) => preview(...args).then(response => new Promise(resolve => {
      releases.push(() => resolve(response))
    }))
  }
  if (kind === 'oversize') Reflect.set(client!, 'byteBudget', 512)
  host().compositionstart()
  host().input('ni')
  host().flushComposition(false)
  if (kind === 'fault') {
    const worker = Reflect.get(client!, 'worker') as Worker
    worker.onerror?.call(worker, new ErrorEvent('error', { message: 'Injected real Worker fault' }))
  }
  if (kind === 'stale') {
    draw.flushGeometry()
    end('你')
    host().compositionstart()
    host().input('hao')
    host().flushComposition(false)
  }
  if (kind !== 'stale') await draw.waitForCompositionPreview()
  await new Promise(resolve => setTimeout(resolve, 70))
  releases.splice(0).forEach(release => release())
  await frame(); await frame()
  const beforeEnd = text()
  const diagnostics = host().getCompositionDiagnostics()
  if (kind === 'oversize') Reflect.set(client!, 'byteBudget', 16 * 1024 * 1024)
  end(kind === 'stale' ? '好' : '你')
  const final = text()
  const expected = original.slice(0, 2) + (kind === 'stale' ? '你好' : '你') + original.slice(2)
  if (final !== expected) throw new Error(kind + ': wrong final model')
  await draw.waitForWorkerLayout()
  return { kind, beforeEnd, final, diagnostics,
    worker: draw.getPerformanceDiagnostics().worker, pending: draw.getCompositionWorkerStats().pending }
}

async function burst() {
  const started = performance.now()
  host().compositionstart()
  for (let i = 0; i < 20; i++) {
    host().input('n'.repeat(i % 8 + 1))
    host().flushComposition(false)
    await new Promise(resolve => setTimeout(resolve, 4))
  }
  const drainStart = performance.now()
  await draw.waitForCompositionPreview()
  await frame(); await frame()
  const pixels = () => draw.getPageList().map(canvas => canvas.getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height).data)
  snapshot()
  const local = pixels()
  draw.flushGeometry()
  snapshot()
  const full = pixels()
  if (local.length !== full.length || local.some((page, index) =>
    page.length !== full[index].length || page.some((value, i) => value !== full[index][i])))
    throw new Error('Burst latest preview differs from full geometry')
  const diagnostics = host().getCompositionDiagnostics()
  end('你')
  await draw.waitForWorkerLayout()
  if (text() !== original.slice(0, 2) + '你' + original.slice(2))
    throw new Error('Burst final mismatch')
  return { diagnostics, worker: draw.getPerformanceDiagnostics().worker,
    drainMs: performance.now() - drainStart, totalMs: performance.now() - started }
}

function dispose() { draw?.destroy(); document.querySelector('#editor')?.replaceChildren() }
declare global {
  interface Window { imeTableWorker: { setup: typeof setup; differential: typeof differential;
    trial: typeof trial; boundary: typeof boundary; burst: typeof burst; dispose: typeof dispose } }
}
window.imeTableWorker = { setup, differential, trial, boundary, burst, dispose }

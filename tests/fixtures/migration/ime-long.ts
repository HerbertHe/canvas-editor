import { Draw } from '../../../src/editor/core/draw/Draw'
import { Listener } from '../../../src/editor/core/listener/Listener'
import { EventBus } from '../../../src/editor/core/event/eventbus/EventBus'
import { Override } from '../../../src/editor/core/override/Override'
import { CommandAdapt } from '../../../src/editor/core/command/CommandAdapt'
import { CompositionPreview } from '../../../src/editor/core/draw/CompositionPreview'
import { formatElementList } from '../../../src/editor/utils/element'
import { mergeOption } from '../../../src/editor/utils/option'
import { ZERO } from '../../../src/editor/dataset/constant/Common'
import { lineCarets } from '../../../src/editor/core/layout/InteractionGeometry'
import { createLayoutWork } from '../../../src/editor/core/text-engine/layout/LayoutWork'
import type { IElement } from '../../../src/editor/interface/Element'

type Kind = 'latin' | 'cjk' | 'unicode' | 'arabic'
type Location = 'end' | 'middle' | 'start'
let draw: Draw
let original = ''
let originalElements: string[] = []
let from = 0
let to = 0
let enabled = false
const base = import.meta.env.BASE_URL
const fonts = await Promise.all([
  ['Latin', 'tests/fixtures/fonts/NotoSans-Latin-Regular.woff2'],
  ['CJK', 'tests/fixtures/fonts/NotoSansSC-Regular.woff2'],
  ['Arabic', 'public/fonts/NotoNaskhArabic-Regular.ttf']
].map(async ([family, file]) => ({ family,
  data: await (await fetch(base + file)).arrayBuffer() })))
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const text = () => draw.getOriginalMainElementList().map(e => e.value).join('')
const values = ['n', 'ni', 'nih', 'niha', 'nihao', 'ni', '']

async function setup(windowPreview: boolean, kind: Kind, location: Location) {
  dispose()
  enabled = windowPreview
  const sample = { latin: 'Latin words and spaces ', cjk: '中文 abcdef ',
    unicode: '中文 e\u0301 👩‍👩‍👧‍👦 abc ', arabic: 'abc مرحبا ' }[kind]
  const options = mergeOption({ autoDownloadFonts: false,
    defaultFont: kind === 'arabic' ? 'Arabic' : 'CJK', fonts,
    width: 600, height: 500, margins: [20, 20, 20, 20],
    header: { disabled: true }, footer: { disabled: true },
    pageNumber: { disabled: true }, lab: { performanceProfile: 'sync',
      imePreview: true, imeWindowPreview: enabled, incrementalCompute: false } })
  const content = { main: [{ value: sample.repeat(350) + ' tail' }] as IElement[],
    header: [{ value: ZERO }], footer: [{ value: ZERO }] }
  Object.values(content).forEach(elements => formatElementList(elements,
    { editorOptions: options, isForceCompensation: true }))
  const container = document.createElement('div')
  document.querySelector('#editor')!.append(container)
  draw = new Draw(container, options, content, new Listener(), new EventBus(), new Override())
  await draw.ready
  const lines = draw.getPosition().getNativeLines()
  const target = location === 'end' ? lines.at(-1)! :
    location === 'start' ? lines[0] : lines[Math.floor(lines.length / 2)]
  from = location === 'start' ? 3 : target.line.source.start + 1
  to = from
  if (location === 'middle') {
    const elements = draw.getOriginalMainElementList()
    // Replace a whole CJK wrap unit with a changing Latin preedit.
    to = elements.findIndex((e, i) => i > target.line.source.start + 2 &&
      i < target.line.source.end - 2 && e.value === '中')
    if (to < 0) throw new Error('Missing fixed middle-row edit anchor')
    from = to - 1
  }
  resetRange()
  draw.getPageList()[target.pageNo].scrollIntoView({ block: 'center' })
  await frame(); await frame()
  original = text()
  originalElements = draw.getOriginalMainElementList().map(e => e.value)
  return { elements: content.main.length, lines: lines.length, from, to,
    window: !!CompositionPreview.create(draw, from, to) }
}

function resetRange() {
  draw.getRange().setRange(from, to)
  draw.render({ curIndex: to, isSubmitHistory: false, isLazy: false })
}

function end(value: string) {
  draw.getCanvasEvent().compositionend(new CompositionEvent('compositionend', { data: value }))
}

function snapshot() {
  // Read comparable freshly painted pages without invoking the geometry/export
  // barrier, which intentionally materializes an active local preview.
  for (let pageNo = 0; pageNo < draw.getPageList().length; pageNo++)
    Reflect.get(draw, 'paintPage').call(draw, pageNo)
  const preview = Reflect.get(draw, 'compositionPreview') as CompositionPreview | null
  const current = preview ? Reflect.get(preview, 'current') : null
  const caret = preview?.caret || draw.getPosition().getNativeCaret(
    draw.getRange().getRange().endIndex)
  const placed = current || draw.getPosition().getNativeLines().find(p =>
    p.line.id === caret?.lineId)
  return {
    images: draw.getPageList().map(canvas => canvas.toDataURL()),
    caret: caret && { x: caret.x, y: caret.y, height: caret.height, pageNo: caret.pageNo },
    rowCarets: current ? lineCarets(current).map(c =>
      [c.index + preview!.base, c.x, c.y, c.height]) : null,
    diagnostics: draw.getCanvasEvent().getCompositionDiagnostics(),
    geometry: placed && { line: placed.line, x: placed.x, y: placed.y },
    placements: draw.getPosition().getNativeLines().map(p => ({ x: p.x, y: p.y,
      pageNo: p.pageNo, rect: p.line.rect, inlines: p.line.inlines.map(i => i.rect) }))
  }
}

async function differential(sequence: string[] = values) {
  const host = draw.getCanvasEvent()
  host.compositionstart()
  const results = []
  for (const value of sequence) {
    host.input(value)
    host.flushComposition(false)
    await frame(); await frame()
    results.push(snapshot())
  }
  end('你')
  const final = text()
  const expected = [...originalElements.slice(0, from + 1), '你',
    ...originalElements.slice(to + 1)].join('')
  if (final !== expected) throw new Error('Long preview final text mismatch')
  new CommandAdapt(draw).undo()
  if (text() !== original) throw new Error('Long preview undo mismatch')
  new CommandAdapt(draw).redo()
  if (text() !== final) throw new Error('Long preview redo mismatch')
  return { results, final }
}

async function trial(iterations: number, instrument: boolean) {
  const adapter = draw.getLayoutHostAdapter()
  const service = adapter.getTextLayoutService()
  const layout = service.layoutParagraph
  const scan = adapter.scanParagraphs
  let hostScan = { ms: 0, elements: 0 }
  let works: ReturnType<typeof createLayoutWork>[] = []
  if (instrument) service.layoutParagraph = function (input) {
    const work = createLayoutWork()
    works.push(work)
    return layout.call(service, input, work)
  }
  if (instrument) adapter.scanParagraphs = function (...args) {
    const before = performance.now()
    try { return scan.apply(adapter, args) } finally {
      hostScan.ms += performance.now() - before
      hostScan.elements += args[0].length
    }
  }
  const samples: { ms: number; local: boolean;
    work: ReturnType<typeof createLayoutWork>;
    hostScan: typeof hostScan; runs: Record<string, number>;
    previewWork: ReturnType<Draw['getCompositionPreviewWork']> }[] = []
  try {
    for (let iteration = -1; iteration < iterations; iteration++) {
      resetRange()
      const host = draw.getCanvasEvent()
      host.compositionstart()
      for (const value of values) {
        works = []
        hostScan = { ms: 0, elements: 0 }
        const runs = instrument ? { ...adapter.getRunStats() } : {}
        const before = performance.now()
        host.input(value)
        host.flushComposition(false)
        const ms = performance.now() - before
        const diagnostics = host.getCompositionDiagnostics()
        if (iteration >= 0) {
          const work = createLayoutWork()
          for (const item of works)
            for (const key of Object.keys(work) as (keyof typeof work)[])
              work[key] += item[key]
          samples.push({ ms, local: diagnostics.local, work,
            hostScan, runs: Object.fromEntries(['shapedUnits', 'reusedUnits', 'misses', 'hits']
              .map(key => [key, instrument ?
                Number(Reflect.get(adapter.getRunStats()!, key)) -
                Number(Reflect.get(runs, key)) : 0])),
            previewWork: diagnostics.previewWork })
        }
        await frame()
      }
      end('')
      if (text() !== original) throw new Error('Long preview cancellation mismatch')
      await frame()
    }
  } finally {
    service.layoutParagraph = layout
    adapter.scanParagraphs = scan
  }
  return { enabled, instrument, samples }
}

function dispose() { draw?.destroy(); document.querySelector('#editor')?.replaceChildren() }

declare global {
  interface Window { imeLong: { setup: typeof setup; differential: typeof differential;
    trial: typeof trial; dispose: typeof dispose } }
}
window.imeLong = { setup, differential, trial, dispose }

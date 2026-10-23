import { IncrementalParagraphComputer } from '@/editor/core/draw/IncrementalParagraphComputer'
import { FontCoverageTracker } from '@/editor/core/text-engine/font/FontCoverageTracker'
import { countWords } from '@/editor/core/worker/works/wordCountModel'
import { applyOperation } from '@/editor/core/history/EditTransaction'
import { getSlimCloneElementList } from '@/editor/utils/element'
import * as markers from '@/editor/core/text-engine-host/ListMarker'
import { ListStyle, ListType } from '@/editor/dataset/enum/List'
import { compareNativeQueries } from '../../fixtures/migration/compareNativeQueries'
import { CommandAdapt } from '@/editor/core/command/CommandAdapt'
import { Draw } from '@/editor/core/draw/Draw'
import { EventBus } from '@/editor/core/event/eventbus/EventBus'
import {
  lineCarets,
  pageRect,
  textRangeRects
} from '@/editor/core/layout/InteractionGeometry'
import { LineGeometryIndex } from '@/editor/core/layout/LineGeometryIndex'
import { Listener } from '@/editor/core/listener/Listener'
import { Override } from '@/editor/core/override/Override'
import { ZERO } from '@/editor/dataset/constant/Common'
import { EditorZone, PaperDirection } from '@/editor/dataset/enum/Editor'
import { ElementType } from '@/editor/dataset/enum/Element'
import {
  CaretMovement,
  DeleteMovement,
  TextDirection
} from '@/editor/dataset/enum/TextDirection'
import { TextScript } from '@/editor/dataset/enum/TextScript'
import type { IEditorOption } from '@/editor/interface/Editor'
import type { IElement } from '@/editor/interface/Element'
import { formatElementList } from '@/editor/utils/element'
import { mergeOption } from '@/editor/utils/option'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
const arabic = new Uint8Array(
  readFileSync('public/fonts/NotoNaskhArabic-Regular.ttf')
).buffer
const latin = new Uint8Array(
  readFileSync('tests/fixtures/fonts/NotoSans-Latin-Regular.woff2')
).buffer
const draws: Draw[] = []
afterEach(() => {
  draws.splice(0).forEach(d => d.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
async function setup(main: IElement[], extra: Partial<IEditorOption> = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const options = mergeOption({
    autoDownloadFonts: false,
    defaultFont: 'Latin',
    fonts: [
      { family: 'Latin', data: latin },
      { family: 'Arabic', scripts: [TextScript.ARAB], data: arabic }
    ],
    width: 360,
    height: 320,
    margins: [20, 20, 20, 20],
    pageNumber: { disabled: true },
    header: { disabled: true },
    footer: { disabled: true },
    ...extra
  })
  const content = { main, header: [{ value: ZERO }], footer: [{ value: ZERO }] }
  Object.values(content).forEach(elements =>
    formatElementList(elements, {
      editorOptions: options,
      isForceCompensation: true
    })
  )
  const container = document.createElement('div')
  document.body.append(container)
  const draw = new Draw(
    container,
    options,
    content,
    new Listener(),
    new EventBus(),
    new Override()
  )
  draws.push(draw)
  await draw.ready
  draw.render({ isLazy: false, isSetCursor: false, isSubmitHistory: false })
  return draw
}
function caret(draw: Draw, index: number) {
  draw.getPosition().setNativeCaretHint(null)
  draw.getRange().setRange(index, index)
  draw.render({ curIndex: index, isCompute: false, isSubmitHistory: false })
}

it('reuses unchanged suffix positions while matching a fresh full commit', async () => {
  const draw = await setup(Array.from({ length: 80 }, () => [
    { value: ZERO }, { value: 'abcdefghijklmno' }
  ]).flat(), { lab: { performanceProfile: 'sync' } })
  const position = draw.getPosition()
  caret(draw, 40 * 16 + 5)
  const before = position.getPlacementStats()
  draw.getCanvasEvent().input('x')
  draw.flushGeometry()
  const after = position.getPlacementStats()
  expect(after.reusedElements - before.reusedElements).toBeGreaterThan(500)
  expect(after.computedElements - before.computedElements).toBeLessThan(100)
  const indices = [0, 1, 640, 645, 646, 1000, 1280]
  const incremental = structuredClone(position.getOriginalMainPositionList())
  const carets = indices.map(index => position.getNativeCaret(index))
  draw.getOptions().lab.incrementalFlow = false
  draw.render({ isCompute: true, isSubmitHistory: false })
  expect(position.getOriginalMainPositionList()).toEqual(incremental)
  expect(indices.map(index => position.getNativeCaret(index))).toEqual(carets)
})

it('commits repeat deletion geometry without posting redundant Worker layouts', async () => {
  const draw = await setup([{ value: 'abcdefghijklmnopqrstuvwxyz' }], {
    lab: { performanceProfile: 'sync' }
  })
  caret(draw, 20)
  const client = { ready: true, stats: {},
    getRevision: () => draw.getDocumentRevision(), getSession: () => 1,
    edit: () => Promise.resolve(), layout: vi.fn(), destroy: vi.fn() }
  Object.assign(draw, { layoutWorkerClient: client,
    workerFontRevision: draw.getLayoutHostAdapter().getFontManager().getRevision() })
  draw.getOptions().lab.layoutWorker = true
  const original = draw.getOriginalMainElementList().map(e => e.value).join('')
  for (let i = 0; i < 10; i++) {
    key(draw, 'Backspace')
    expect(draw.hasPendingWorkerGeometry()).toBe(false)
    expect(draw.getRange().getRange().endIndex).toBe(19 - i)
    expect(draw.getPosition().getOriginalMainPositionList().length)
      .toBe(draw.getOriginalMainElementList().length)
  }
  expect(client.layout).not.toHaveBeenCalled()
  draw.getHistoryManager().undo()
  expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toBe(original)
})

it('commits current geometry when a worker cannot keep up and releases its deadline', async () => {
  const draw = await setup([{ value: 'office مرحبا' }], {
    lab: { performanceProfile: 'sync' }
  })
  caret(draw, 2)
  let rejectLayout: (error: Error) => void = () => {}
  const client = { ready: true, stats: {},
    getRevision: () => draw.getDocumentRevision(), getSession: () => 1,
    getQueueStats: () => ({ requests: 0, waiting: false, queuedBytes: 0 }),
    edit: () => Promise.resolve(), destroy: vi.fn(),
    layout: () => new Promise((_, reject) => { rejectLayout = reject }) }
  Object.assign(draw, { layoutWorkerClient: client,
    workerFontRevision: draw.getLayoutHostAdapter().getFontManager().getRevision() })
  draw.getOptions().lab.layoutWorker = true
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const history = draw.getHistoryManager().getStats().undo
    draw.getCanvasEvent().input('x')
    await Promise.resolve()
    expect(draw.hasPendingWorkerGeometry()).toBe(true)
    await vi.advanceTimersByTimeAsync(101)
    expect(draw.hasPendingWorkerGeometry()).toBe(false)
    const diagnostics = draw.getPerformanceDiagnostics()
    expect(diagnostics.worker.fallbackReasons.deadline).toBe(1)
    expect(draw.getOriginalMainElementList().length)
      .toBe(draw.getPosition().getOriginalMainPositionList().length)
    expect(draw.getHistoryManager().getStats().undo).toBe(history + 1)
    rejectLayout(new Error('Superseded worker result'))
    await Promise.resolve()
    expect(draw.getPerformanceDiagnostics().worker.fallbackReasons.error).toBe(0)
    diagnostics.options.layoutWorker = false
    diagnostics.worker.fallbackReasons.deadline = 99
    expect(draw.getPerformanceDiagnostics().worker.fallbackReasons.deadline).toBe(1)
    draw.destroy()
    expect(client.destroy).toHaveBeenCalledOnce()
    expect(draw.getPerformanceDiagnostics().pages.observed).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

it('groups real printable keydown/input pairs and closes the group on movement', async () => {
  const draw = await setup([{ value: 'abc' }], {
    lab: { incrementalEditing: true, transactionHistory: true }
  })
  caret(draw, 2)
  const host = draw.getCanvasEvent()
  const before = draw.getOriginalMainElementList().map(e => e.value).join('')
  const history = draw.getHistoryManager()
  const count = history.getStats().undo
  for (const key of ['x', 'y', 'z']) {
    host.keydown(new KeyboardEvent('keydown', { key }))
    host.input(key)
  }
  expect(history.getStats().undo).toBe(count + 1)
  history.undo()
  expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toBe(before)
  history.redo()
  host.keydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
  host.keydown(new KeyboardEvent('keydown', { key: 'q' }))
  host.input('q')
  expect(history.getStats().undo).toBe(count + 2)
})
function key(draw: Draw, key: string, shiftKey = false) {
  draw.getCanvasEvent().keydown(
    new KeyboardEvent('keydown', {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true
    })
  )
}
describe('T17 native interaction geometry', () => {
  it('builds one geometry index per placed row and directly indexes row lookup', async () => {
    const draw = await setup([{ value: 'office é مرحبا '.repeat(20) }])
    const position = draw.getPosition()
    const builds = vi.spyOn(LineGeometryIndex, 'create')
    position.computePositionList({})
    const positions = position.getOriginalMainPositionList()
    const lines = position.getNativeLines(positions)
    expect(builds).toHaveBeenCalledTimes(lines.length)
    expect(lines.length).toBeGreaterThan(1)
    const expected = draw.getLayoutPages().flatMap((rows, pageNo) =>
      rows.filter(row => row.nativeLine).map(row => ({
        row,
        pageNo,
        placed: lines.find(p => p.line === row.nativeLine && p.pageNo === pageNo)
      }))
    )
    const reads = vi.spyOn(position, 'getNativeLines').mockImplementation(() => {
      throw new Error('Row lookup scanned the native line array')
    })
    for (const { row, pageNo, placed } of expected) {
      expect(placed).toBeDefined()
      expect(position.getNativeRow(row, positions, pageNo)).toBe(placed)
      expect(position.getNativeRow({ ...row,
        nativeLine: structuredClone(row.nativeLine) }, positions, pageNo))
        .toBe(placed)
    }
    reads.mockRestore()
  })

  it('isolates new position arrays and releases indices on editor destruction', async () => {
    const draw = await setup([{ value: 'abc مرحبا '.repeat(4) }])
    const position = draw.getPosition()
    const before = position.getOriginalMainPositionList()
    const row = draw.getLayoutPages()[0][0]
    const old = position.getNativeRow(row, before, 0)
    expect(old).toBeDefined()
    position.computePositionList({})
    const after = position.getOriginalMainPositionList()
    expect(after).not.toBe(before)
    expect(position.getNativeRow(row, after, 0)).not.toBe(old)
    expect(position.getNativeRow(row, before, 0)).toBe(old)
    draw.destroy()
    expect(position.getNativeRow(row, before, 0)).toBeUndefined()
    expect(position.getNativeLines(before)).toEqual([])
  })

  for (const scale of [0.75, 1.75])
    for (const direction of [TextDirection.LTR, TextDirection.RTL]) {
      it(`round-trips native carets, keeps graphemes intact and scales once: ${scale}/${direction}`, async () => {
        const draw = await setup(
          [{ value: 'office é مرحبا 👩‍👩‍👧‍👦 words '.repeat(8), direction }],
          { scale }
        )
        const position = draw.getPosition()
        const before = JSON.stringify(
          position.getNativeLines().map(p => p.line)
        )
        const old = draw.getLayoutHostAdapter().getHitTest()
        vi.spyOn(old, 'pointToLogicalIndex').mockImplementation(() => {
          throw new Error('old hit geometry')
        })
        vi.spyOn(old, 'caretMetrics').mockImplementation(() => {
          throw new Error('old caret geometry')
        })
        for (const placed of position.getNativeLines()) {
          for (const stop of lineCarets(placed)) {
            const hit = position.getPositionByXY({
              pageNo: stop.pageNo,
              x: stop.x,
              y: stop.y + stop.height / 2
            })
            expect(hit.nativeCaret).toBeTruthy()
            expect(hit.nativeCaret!.x).toBeCloseTo(stop.x)
            const element =
              draw.getOriginalMainElementList()[
                hit.nativeCaret!.position.elementIndex
              ]
            if (element)
              expect([0, element.value.length]).toContain(
                hit.nativeCaret!.position.offset
              )
          }
        }
        expect(JSON.stringify(position.getNativeLines().map(p => p.line))).toBe(
          before
        )
      })
    }
  it('uses the true native caret box for cursor and IME placement, including soft-wrap affinity', async () => {
    const draw = await setup([{ value: 'office مرحبا '.repeat(70) }], {
      scale: 1.25
    })
    const position = draw.getPosition()
    const placed = position.getNativeLines().find(p => p.pageNo === 1)!
    const stop = lineCarets(placed)[0]
    position.setNativeCaretHint(stop)
    draw.getRange().setRange(stop.index, stop.index)
    draw.render({
      curIndex: stop.index,
      isCompute: false,
      isSubmitHistory: false
    })
    const dom = draw.getCursor().getCursorDom()
    const offset = draw.getPageOffset(stop.pageNo)
    expect(parseFloat(dom.style.left)).toBeCloseTo(stop.x + offset.x)
    expect(parseFloat(dom.style.top)).toBeCloseTo(stop.y + offset.y)
    expect(parseFloat(dom.style.height)).toBeCloseTo(stop.height)
    expect(draw.getPageNo()).toBe(stop.pageNo)
  })
  it('uses cluster/caret ranges for selection, search and spellcheck without paragraph spacing', async () => {
    const draw = await setup(
      [
        { value: 'office مرحبا', spacingAfter: 60 },
        { value: ZERO },
        { value: 'next' }
      ],
      { spellcheck: { disabled: false } }
    )
    const position = draw.getPosition(),
      elements = draw.getOriginalMainElementList()
    const end = elements.findIndex((e, i) => i > 0 && e.value === ZERO) - 1
    draw.getRange().setRange(0, end)
    const rangePaint = vi.spyOn(draw.getRange(), 'render')
    draw.render({
      isCompute: false,
      isSetCursor: false,
      isLazy: false,
      isSubmitHistory: false
    })
    const rects = position.getNativeRangeRects(1, end + 1)
    expect(rangePaint.mock.calls.map(c => c.slice(1))).toEqual(
      rects.map(r => [r.x, r.y, r.width, r.height])
    )
    const line = position.getNativeLines()[0],
      box = pageRect(line, line.line.rect)
    expect(
      draw.getRange().getIsPointInRange(box.x + 1, box.y + box.height + 20)
    ).toBe(false)
    draw.getSearch().setSearchKeyword('office')
    draw.getSearch().compute('office')
    const ctx = document.createElement('canvas').getContext('2d')!
    const fill = vi.spyOn(ctx, 'fillRect')
    draw.getSearch().render(ctx, 0)
    expect(fill).toHaveBeenCalled()
    for (const call of fill.mock.calls)
      expect(call[3]).toBeLessThanOrEqual(box.height)
    draw
      .getSpellcheck()
      .setSpellcheckRangeList([{ startIndex: 1, endIndex: 6 }])
    const wave = vi.spyOn(draw.getSpellcheck() as any, '_drawWave')
    draw.getSpellcheck().render(ctx, 0)
    expect(wave.mock.calls[0][2]).toBeCloseTo(box.y + box.height)
  })
  it('keeps BiDi group gaps unpainted and returns the same visual intervals as selection', async () => {
    const draw = await setup([{ value: 'abc مرحبا xyz' }])
    const elements = draw.getOriginalMainElementList()
    elements[2].groupIds = ['g']
    elements[8].groupIds = ['g']
    const ctx = document.createElement('canvas').getContext('2d')!
    const fill = vi.spyOn(ctx, 'fillRect')
    const group = draw.getGroup()
    for (const index of [2, 8])
      for (const rect of draw
        .getPosition()
        .getNativeRangeRects(index, index + 1))
        group.recordFillInfo(
          elements[index],
          rect.x,
          rect.y,
          rect.width,
          rect.height
        )
    group.render(ctx)
    expect(fill.mock.calls.length).toBe(2)
  })
  it('publishes native range/group rectangles in container CSS pixels at zoom', async () => {
    const draw = await setup([{ value: 'abc مرحبا xyz' }], { scale: 1.75 })
    const command = new CommandAdapt(draw)
    const elements = draw.getOriginalMainElementList()
    elements.slice(2, 9).forEach(element => {
      element.groupIds = ['g']
    })
    draw.getRange().setRange(1, 8)
    const context = command.getRangeContext()!
    const rects = command.getGroupRectList('g')!
    expect(context.rangeRects).toEqual(rects)
    expect(rects.every(rect => rect.width > 0 && rect.height > 0)).toBe(true)
    expect(rects[0].height).toBeCloseTo(
      draw.getPosition().getNativeLines()[0].line.contentHeight * 1.75
    )
  })

  it('retains dedicated object geometry in mixed text selection and group queries', async () => {
    const draw = await setup(
      [
        { value: 'body' },
        { type: ElementType.SEPARATOR, value: '', groupIds: ['object'] }
      ],
      { scale: 1.25 }
    )
    const elements = draw.getOriginalMainElementList()
    const index = elements.findIndex(e => e.type === ElementType.SEPARATOR)
    const command = new CommandAdapt(draw)
    draw.getRange().setRange(index - 1, index)
    const rectangles = command.getGroupRectList('object')!
    expect(rectangles.length).toBeGreaterThan(0)
    expect(rectangles[0].width).toBeGreaterThan(0)
    expect(command.getRangeContext()!.rangeRects).toEqual(rectangles)
    const pos = draw.getPosition().getOriginalMainPositionList()[index]
    expect(
      draw
        .getRange()
        .getIsPointInRange(
          pos.coordinate.leftTop[0] + 1,
          pos.coordinate.leftTop[1] + 1
        )
    ).toBe(true)
  })

  it('moves visually on screen, logically in source order, and preserves a fixed Shift anchor', async () => {
    const draw = await setup([{ value: 'abc مرحبا xyz' }])
    const position = draw.getPosition()
    const stops = lineCarets(position.getNativeLines()[0])
    const first = stops[0]
    position.setNativeCaretHint(first)
    draw.getRange().setRange(first.index, first.index)
    draw.render({
      curIndex: first.index,
      isCompute: false,
      isSubmitHistory: false
    })
    let previous = first.x
    for (let i = 0; i < stops.length - 1; i++) {
      key(draw, 'ArrowRight')
      const next = position.getNativeCaret(
        draw.getRange().getRange().startIndex
      )!
      expect(next.x).toBeGreaterThanOrEqual(previous)
      previous = next.x
    }
    draw.getOptions().caretMovement = CaretMovement.LOGICAL
    caret(draw, 2)
    key(draw, 'ArrowRight', true)
    key(draw, 'ArrowRight', true)
    expect(draw.getRange().getRange()).toMatchObject({
      startIndex: 2,
      endIndex: 4
    })
    key(draw, 'ArrowLeft', true)
    expect(draw.getRange().getRange()).toMatchObject({
      startIndex: 2,
      endIndex: 3
    })
    expect(position.getCursorPosition()!.index).toBe(2)
  })
  it('deletes a combining cluster across source elements atomically and retains missing ZWJ text', async () => {
    const draw = await setup([{ value: 'e' }, { value: '́' }, { value: 'X' }], {
      caretMovement: CaretMovement.LOGICAL,
      deleteMovement: DeleteMovement.LOGICAL
    })
    const position = draw.getPosition()
    expect(position.getNativeDeleteRange(2, true, false)).toMatchObject({
      index: 1,
      count: 2,
      cursorIndex: 0
    })
    caret(draw, 1)
    expect(draw.getRange().getRange().startIndex).toBe(2)
    caret(draw, 0)
    key(draw, 'ArrowRight')
    expect(draw.getRange().getRange().startIndex).toBe(2)
    key(draw, 'Backspace')
    expect(
      draw
        .getOriginalMainElementList()
        .map(e => e.value)
        .join('')
    ).toBe(ZERO + 'X')
    const missing = await setup([{ value: '👩‍👩‍👧‍👦' }, { value: 'A' }])
    caret(missing, 1)
    new CommandAdapt(missing).backspace()
    expect(
      missing
        .getOriginalMainElementList()
        .map(e => e.value)
        .join('')
    ).toBe(ZERO + 'A')
  })
  it('places cell interaction geometry with vertical alignment and fragment clipping, including nested scopes', async () => {
    const table: IElement = {
      type: ElementType.TABLE,
      value: '',
      colgroup: [{ width: 160 }, { width: 160 }],
      trList: [
        {
          height: 80,
          tdList: [
            {
              colspan: 1,
              rowspan: 1,
              verticalAlign: 'bottom' as any,
              value: [{ value: 'cell' }]
            },
            { colspan: 1, rowspan: 1, value: [{ value: 'second' }] }
          ]
        },
        {
          height: 40,
          tdList: [
            {
              colspan: 2,
              rowspan: 1,
              value: [{ value: 'long مرحبا '.repeat(90) }]
            }
          ]
        }
      ]
    }
    const draw = await setup([table])
    const position = draw.getPosition(),
      model = draw
        .getOriginalMainElementList()
        .find(e => e.type === ElementType.TABLE)!
    for (const row of model.trList!)
      for (const td of row.tdList) {
        for (const placed of position.getNativeLines(td.positionList!)) {
          for (const rect of textRangeRects(placed, 0, td.value.length)) {
            expect(rect.y).toBeGreaterThanOrEqual(placed.clip!.y - 0.01)
            expect(rect.y + rect.height).toBeLessThanOrEqual(
              placed.clip!.y + placed.clip!.height + 0.01
            )
            const hit = position.getPositionByXY({
              pageNo: placed.pageNo,
              x: rect.x + Math.min(1, rect.width / 2),
              y: rect.y + rect.height / 2
            })
            expect(hit.isTable).toBe(true)
            expect(hit.tdId).toBe(td.id)
          }
        }
      }
  })
  it('maps UTF-16 search matches to grapheme sources and highlights/replaces inside nested cells', async () => {
    const nested: IElement = {
      type: ElementType.TABLE,
      value: '',
      colgroup: [{ width: 220 }],
      trList: [
        {
          height: 40,
          tdList: [
            { colspan: 1, rowspan: 1, value: [{ value: 'A👩‍👩‍👧‍👦B é office' }] }
          ]
        }
      ]
    }
    const outer: IElement = {
      type: ElementType.TABLE,
      value: '',
      colgroup: [{ width: 280 }],
      trList: [
        {
          height: 180,
          tdList: [
            {
              colspan: 1,
              rowspan: 1,
              verticalAlign: 'bottom' as any,
              value: [nested]
            }
          ]
        }
      ]
    }
    const draw = await setup([outer])
    const root = draw.getOriginalMainElementList()
    const search = draw.getSearch()
    const results = search.getMatchList('B', root)
    expect(results).toHaveLength(1)
    expect(results[0].tablePath).toHaveLength(2)
    const context = {
      isTable: true,
      index: results[0].tableIndex,
      tablePath: results[0].tablePath
    }
    const cell = draw.getPosition().getTableTdByContext(root, context)!
    expect(
      lineCarets(draw.getPosition().getNativeLines(cell.positionList!)[0])
        .length
    ).toBeGreaterThan(0)
    expect(cell.value[results[0].index].value).toBe('B')
    cell.value[results[0].index].groupIds = ['nested-group']
    expect(
      new CommandAdapt(draw).getGroupRectList('nested-group')?.length
    ).toBeGreaterThan(0)

    expect(search.getMatchList('👩', root)).toHaveLength(1)
    search.setSearchKeyword('office')
    search.compute('office')
    const ctx = document.createElement('canvas').getContext('2d')!
    const fill = vi.spyOn(ctx, 'fillRect')
    search.render(ctx, 0)
    expect(fill).toHaveBeenCalled()
    search.replace('👩‍👩‍👧‍👦')
    expect(cell.value.filter(e => e.value === '👩‍👩‍👧‍👦')).toHaveLength(2)
    expect(cell.value.map(e => e.value).join('')).not.toContain('office')
    expect(draw.getPosition().getPositionContext().tablePath).toHaveLength(2)
  })

  it('keeps header geometry separate for mixed paper directions', async () => {
    const draw = await setup(
      [
        { value: 'body' },
        {
          value: '',
          type: ElementType.PAGE_BREAK,
          paperDirection: PaperDirection.HORIZONTAL
        },
        { value: 'wide' }
      ],
      { header: { disabled: false } }
    )
    draw.getHeader().setElementList([{ value: ZERO }, { value: 'header' }])
    draw.render({ isLazy: false, isSetCursor: false, isSubmitHistory: false })
    draw.getZone().setZone(EditorZone.HEADER)
    draw.setPageNo(1)
    const position = draw.getPosition()
    const lines = position.getNativeLines(position.getOriginalPositionList(1))
    expect(lines[0].line.source.scope).toBe('header:horizontal')
    const stop = lineCarets(lines[0]).at(-1)!
    const hit = position.getPositionByXY({
      pageNo: 1,
      x: stop.x,
      y: stop.y + stop.height / 2
    })
    expect(hit.nativeCaret?.scope).toBe('header:horizontal')
  })
})


describe('PERF-03/04/05 interaction pipeline', () => {
  it('matches frozen queries on real mixed-font, wrapped and empty lines', async () => {
    const draw = await setup([
      { value: 'abc مرحبا office 👩‍👩‍👧‍👦 é '.repeat(2) },
      { value: ZERO }, { value: ZERO }, { value: 'نهاية end' }
    ])
    expect(compareNativeQueries(draw.getPosition().getNativeLines()))
      .toBeGreaterThan(1000)
  })

  it('scans marker anchors once per scope pass, independent of paragraph count', async () => {
    const draw = await setup([{ value: 'seed' }])
    const scan = vi.spyOn(markers, 'collectListMarkers')
    for (const count of [10, 100]) {
      const elements: IElement[] = Array.from({ length: count }, () => [
        { value: ZERO, listId: 'same', listType: ListType.OL,
          listStyle: ListStyle.DECIMAL },
        { value: 'item', listId: 'same', listType: ListType.OL }
      ]).flat()
      formatElementList(elements, { editorOptions: draw.getOptions() })
      scan.mockClear()
      const rows = draw.computeRowList({ elementList: elements,
        innerWidth: 300, layoutScope: 'td:first' })
      expect(scan).toHaveBeenCalledTimes(1)
      expect(rows.filter(row => row.isList)).toHaveLength(count)
      // A new scope with the same listId restarts from its own first anchor.
      const other = elements.slice(0, 5).map(e => ({ ...e }))
      scan.mockClear()
      draw.computeRowList({ elementList: other,
        innerWidth: 300, layoutScope: 'td:other' })
      expect(scan).toHaveBeenCalledTimes(1)
    }
  })

  it('commits every edit and notification before a single deferred paint', async () => {
    const draw = await setup([{ value: 'abcd' }])
    const callbacks = new Map<number, FrameRequestCallback>()
    let serial = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callbacks.set(++serial, callback)
      return serial
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      callbacks.delete(id)
    })
    const paint = vi.spyOn(draw as any, 'paintRender')
    const history = vi.spyOn(draw, 'submitHistory')
    const changed = vi.fn()
    draw.getEventBus().on('contentChange', changed)
    let revision = draw.flushGeometry()
    for (let i = 0; i < 3; i++) {
      draw.spliceElementList(draw.getOriginalMainElementList(), 2, 0,
        [{ value: 'x' }])
      draw.getRange().setRange(2, 2)
      draw.render({ curIndex: 2, isDeferredPaint: true })
      expect(draw.getPosition().getNativeCaret(2)).not.toBeNull()
      expect(draw.flushGeometry()).toBeGreaterThan(revision)
      revision = draw.flushGeometry()
    }
    expect(history).toHaveBeenCalledTimes(3)
    expect(paint).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(changed).toHaveBeenCalledTimes(3)
    // flushPaint is the immediate-pixel path; its cancelled rAF cannot repaint.
    draw.flushPaint()
    expect(paint).toHaveBeenCalledTimes(1)
    draw.flushPaint()
    expect(paint).toHaveBeenCalledTimes(1)
    draw.render({ isCompute: false, isDeferredPaint: true,
      isSubmitHistory: false })
    draw.destroy()
    for (const callback of callbacks.values()) callback(0)
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('merges same-frame paints and preserves synchronous render by default', async () => {
    const draw = await setup([{ value: 'abcd' }])
    let callback: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => {
      callback = fn
      return 42
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const paint = vi.spyOn(draw as any, 'paintRender')
    for (let i = 0; i < 3; i++) draw.render({ isDeferredPaint: true,
      isCompute: false, isSubmitHistory: false, isSetCursor: false })
    expect(paint).not.toHaveBeenCalled()
    callback!(0)
    expect(paint).toHaveBeenCalledTimes(1)
    draw.render({ isCompute: false, isSubmitHistory: false })
    expect(paint).toHaveBeenCalledTimes(2)
  })

  it('matches immediate editing through input, delete, movement, IME and undo', async () => {
    const deferred = await setup([{ value: 'abc مرحبا é' }], {
      lab: { deferredPaint: true }
    })
    const immediate = await setup([{ value: 'abc مرحبا é' }])
    const original = immediate.render.bind(immediate)
    vi.spyOn(immediate, 'render').mockImplementation(payload => {
      original({ ...payload, isDeferredPaint: false })
    })
    const callbacks = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => {
      callbacks.set(++id, fn)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(value => {
      callbacks.delete(value)
    })
    const state = (draw: Draw) => ({
      text: draw.getOriginalMainElementList().map(e => e.value).join(''),
      range: draw.getRange().getRange(),
      caret: draw.getPosition().getNativeCaret(draw.getRange().getRange().endIndex)
    })
    const operations = [
      (draw: Draw) => caret(draw, 2),
      (draw: Draw) => draw.getCanvasEvent().input('xy'),
      (draw: Draw) => key(draw, 'Backspace'),
      (draw: Draw) => key(draw, 'ArrowLeft'),
      (draw: Draw) => key(draw, 'Delete'),
      (draw: Draw) => draw.getCanvasEvent().compositionstart(),
      (draw: Draw) => draw.getCanvasEvent().input('n'),
      (draw: Draw) => draw.getCanvasEvent().input('ni'),
      (draw: Draw) => draw.getCanvasEvent().compositionend(
        new CompositionEvent('compositionend', { data: '你' })),
      (draw: Draw) => new CommandAdapt(draw).undo(),
      (draw: Draw) => new CommandAdapt(draw).redo()
    ]
    for (const operation of operations) {
      operation(deferred)
      operation(immediate)
      expect(state(deferred)).toEqual(state(immediate))
    }
    deferred.flushPaint()
    expect(deferred.getPosition().getNativeLines()).toEqual(
      immediate.getPosition().getNativeLines())
  })


  it('flushes geometry after soft deletion and property changes', async () => {
    const draw = await setup([{ value: 'abcd' }], { trace: { disabled: false } })
    let revision = draw.flushGeometry()
    const before = draw.getPosition().getOriginalMainPositionList()
    draw.deleteElementList(draw.getOriginalMainElementList(), 2, 1)
    expect(draw.flushGeometry()).toBeGreaterThan(revision)
    expect(draw.getPosition().getOriginalMainPositionList()).not.toBe(before)
    revision = draw.flushGeometry()
    draw.setElementProperty(draw.getOriginalMainElementList()[1], { size: 24 })
    // A caller cannot opt out of geometry commit for a tracked dirty model.
    draw.render({ isCompute: false, isSubmitHistory: false })
    expect(draw.flushGeometry()).toBeGreaterThan(revision)
  })

})


describe('PERF-06–10 tracked edits', () => {
  const lab = { incrementalEditing: true, incrementalCompute: true,
    transactionHistory: true, incrementalCoverage: true }

  it('replays trace edits and rolls back a command affecting multiple scopes', async () => {
    const draw = await setup([{ value: 'abcd', bold: true }], {
      lab, trace: { disabled: false }
    })
    caret(draw, 3)
    const model = () => ({
      main: getSlimCloneElementList(draw.getOriginalMainElementList()),
      header: getSlimCloneElementList(draw.getHeader().getElementList()),
      footer: getSlimCloneElementList(draw.getFooter().getElementList())
    })
    const before = model()
    let mirror = structuredClone(before)
    draw.getEditJournal().subscribe(transaction => {
      if (transaction.source === 'rollback') {
        expect(draw.getLayoutChangeSet()!.documentRevision).toBe(transaction.targetRevision)
        expect(draw.getPosition().getOriginalMainPositionList().length)
          .toBe(draw.getOriginalMainElementList().length)
      }
      for (const operation of transaction.operations)
        applyOperation(operation, scope => {
          if (scope !== 'main' && scope !== 'header' && scope !== 'footer')
            throw new Error('Unexpected scope')
          return mirror[scope]
        }, next => { mirror = next })
    })
    key(draw, 'Backspace')
    expect(mirror).toEqual(model())
    new CommandAdapt(draw).undo()
    expect(model()).toEqual(before)
    expect(mirror).toEqual(before)
    expect(() => draw.runEditTransaction('attributes', () => {
      draw.setElementProperty(draw.getOriginalMainElementList()[1], { color: '#abcdef' })
      draw.spliceElementList(draw.getHeader().getElementList(), 1, 0, [{ value: 'header' }])
      draw.spliceElementList(draw.getFooter().getElementList(), 1, 0, [{ value: 'footer' }])
      draw.render({ isSubmitHistory: false })
      throw new Error('Abort multi-scope command')
    })).toThrow('Abort multi-scope command')
    expect(model()).toEqual(before)
    expect(mirror).toEqual(before)
  })

  it('groups input, undo/redo and snapshot barriers without changing text', async () => {
    const draw = await setup([{ value: 'abc' }, { value: ZERO }, { value: 'tail' }], { lab })
    caret(draw, 2)
    const revisions: number[] = []
    draw.getEditJournal().subscribe(tx => revisions.push(tx.targetRevision))
    const host = draw.getCanvasEvent()
    host.input('x')
    host.input('y')
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toContain('abxyc')
    new CommandAdapt(draw).undo()
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toContain('abc')
    new CommandAdapt(draw).redo()
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toContain('abxyc')
    const text = draw.getOriginalMainElementList().map(e => e.value).join('')
    draw.setElementProperty(draw.getOriginalMainElementList()[1], { bold: true })
    draw.render({ curIndex: 4 })
    new CommandAdapt(draw).undo()
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toBe(text)
    expect(draw.getOriginalMainElementList()[1].bold).not.toBe(true)
    new CommandAdapt(draw).undo()
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toContain('abc')
    expect(revisions.every((value, i) => !i || value > revisions[i - 1])).toBe(true)
  })

  it('keeps remote paragraph revisions stable and rolls back failed mutations', async () => {
    const draw = await setup([{ value: 'abc' }, { value: ZERO }, { value: 'tail' }], { lab })
    caret(draw, 2)
    const elements = draw.getOriginalMainElementList()
    const directory = draw.getLayoutHostAdapter().paragraphs
    const before = directory.get(elements).entries().at(-1)!.record
    const id = before.id
    draw.getCanvasEvent().input('x')
    const after = directory.get(elements).entries().at(-1)!.record
    expect(after.id).toBe(id)
    expect(after.content).toBe(before.content)
    const text = elements.map(e => e.value).join('')
    expect(() => draw.runEditTransaction('input', () => {
      draw.spliceElementList(elements, 2, 0, [{ value: 'error' }])
      throw new Error('abort')
    })).toThrow('abort')
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toBe(text)
  })

  it('commits IME once and cancellation restores the selected original text', async () => {
    const draw = await setup([{ value: 'abcdef' }], { lab })
    caret(draw, 2)
    const host = draw.getCanvasEvent()
    const before = draw.getOriginalMainElementList().map(e => e.value).join('')
    host.compositionstart()
    host.input('n')
    host.input('ni')
    host.compositionend(new CompositionEvent('compositionend', { data: '你' }))
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toContain('你')
    new CommandAdapt(draw).undo()
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toBe(before)
    draw.getRange().setRange(1, 3)
    host.compositionstart()
    host.input('temp')
    host.compositionend(new CompositionEvent('compositionend', { data: '' }))
    expect(draw.getOriginalMainElementList().map(e => e.value).join('')).toBe(before)
  })
})


describe('tracked edit differential and work budgets', () => {
  const lab = { incrementalEditing: true, incrementalCompute: true,
    transactionHistory: true, incrementalCoverage: true }

  it('reuses remote geometry and coverage while editing one paragraph', async () => {
    const draw = await setup(Array.from({ length: 40 }, () => [
      { value: ZERO }, { value: 'abc مرحبا end' }
    ]).flat(), { lab })
    caret(draw, 2)
    const adapter = draw.getLayoutHostAdapter()
    const oldGlyphs = draw.getPosition().getNativeLines().at(-1)!.line.glyphs
    const coverage = { ...adapter.coverageStats }
    const clone = vi.spyOn(globalThis, 'structuredClone')
    draw.getCanvasEvent().input('x')
    expect(draw.getPosition().getNativeLines().at(-1)!.line.glyphs).toBe(oldGlyphs)
    expect(adapter.coverageStats.updated - coverage.updated).toBeLessThan(5)
    expect(adapter.coverageStats.reused - coverage.reused).toBeGreaterThan(30)
    expect(clone.mock.calls.some(([value]) => value && typeof value === 'object' && 'lines' in value && 'shaped' in value)).toBe(false)
    expect(await draw.getWorkerManager().getWordCount()).toBe(
      countWords(draw.getOriginalMainElementList()))
    const beforeWords = draw.getDerivedState().stats.wordUpdated
    draw.getCanvasEvent().input('y')
    expect(await draw.getWorkerManager().getWordCount()).toBe(
      countWords(draw.getOriginalMainElementList()))
    expect(draw.getDerivedState().stats.wordUpdated - beforeWords).toBeLessThan(5)
  })

  it('matches full coverage including deletion of the final missing glyph', async () => {
    const draw = await setup([{ value: 'abc 漢' }, { value: ZERO }, { value: 'مرحبا' }], { lab })
    const adapter = draw.getLayoutHostAdapter()
    const verify = () => {
      const full = new FontCoverageTracker()
      const inputs = adapter.collectFontCoverage([
        { scope: 'main', elements: draw.getOriginalMainElementList() }
      ])
      full.update(full.begin(), inputs, adapter.getFontManager(), false)
      const actual = draw.getFontCoverageReport().issues.filter(issue =>
        issue.locations.some(location => location.scope === 'main'))
      expect(actual).toEqual(full.getReport().issues)
      full.destroy()
    }
    verify()
    caret(draw, 5)
    key(draw, 'Backspace')
    verify()
  })

  it('publishes one reversible change per undo across a snapshot barrier', async () => {
    const draw = await setup([{ value: 'abc' }], { lab })
    caret(draw, 2)
    let mirror = { main: getSlimCloneElementList(draw.getOriginalMainElementList()),
      header: getSlimCloneElementList(draw.getHeaderElementList()),
      footer: getSlimCloneElementList(draw.getFooterElementList()) }
    const events: string[] = []
    draw.getEditJournal().subscribe(tx => {
      events.push(tx.source)
      for (const operation of tx.operations)
        applyOperation(operation, scope => mirror[scope as 'main'], model => { mirror = model })
      expect(mirror.main).toEqual(getSlimCloneElementList(draw.getOriginalMainElementList()))
    })
    draw.getCanvasEvent().input('x')
    draw.setElementProperty(draw.getOriginalMainElementList()[1], { bold: true })
    draw.render({ curIndex: 3 })
    const before = events.length
    new CommandAdapt(draw).undo()
    expect(events.slice(before)).toEqual(['undo'])
    new CommandAdapt(draw).undo()
    new CommandAdapt(draw).redo()
    new CommandAdapt(draw).redo()
    const revision = draw.getDocumentRevision()
    draw.render({ isSubmitHistory: false })
    expect(draw.getDocumentRevision()).toBe(revision)
  })
})


describe('immutable cache ownership and disabled history', () => {
  it('projects shifted source offsets without cloning on a trusted cache hit', async () => {
    const draw = await setup([{ value: 'office مرحبا é' }])
    const adapter = draw.getLayoutHostAdapter()
    const service = adapter.getTextLayoutService()
    const compute = vi.spyOn(service, 'layoutParagraph')
    const elements = draw.getOriginalMainElementList()
    const paragraph = adapter.scanParagraphs(elements)[0]
    adapter.layoutParagraph(paragraph, elements, 250)
    const input = compute.mock.calls.at(-1)![0]
    const cache = new IncrementalParagraphComputer(1024 * 1024)
    const first = cache.compute(input, value => service.layoutParagraph(value), 'p:1')
    const count = compute.mock.calls.length
    const clone = vi.spyOn(globalThis, 'structuredClone')
    const second = cache.compute({ ...input,
      source: { ...input.source, start: input.source.start + 10, end: input.source.end + 10 }
    }, value => service.layoutParagraph(value), 'p:1')
    expect(compute).toHaveBeenCalledTimes(count)
    expect(clone).not.toHaveBeenCalled()
    expect(second.lines[0].source.start).toBe(first.lines[0].source.start + 10)
    expect(second.lines[0].glyphs).toBe(first.lines[0].glyphs)
    const originalX = second.lines[0].carets[0].x
    first.lines[0].carets[0].x = 999
    expect(second.lines[0].carets[0].x).toBe(originalX)
    expect(() => { first.lines[0].glyphs[0].color = '#f00' }).toThrow()
    const bytes = cache.stats.bytes
    cache.setByteBudget(bytes + 1)
    cache.compute(input, value => service.layoutParagraph(value), 'p:2')
    expect(cache.stats.bytes).toBeLessThanOrEqual(bytes + 1)
    expect(cache.stats.evictions).toBeGreaterThan(0)
    cache.releaseScope('main')
    expect(cache.stats.bytes).toBe(0)
  })

  it('keeps no undo payload when history is disabled and still publishes edits', async () => {
    const draw = await setup([{ value: 'abcdef' }], {
      historyMaxRecordCount: 0,
      lab: { incrementalEditing: true, transactionHistory: true }
    })
    caret(draw, 3)
    const snapshot = vi.spyOn(draw, 'createHistorySnapshot')
    draw.getCanvasEvent().input('x')
    key(draw, 'Backspace')
    expect(snapshot).not.toHaveBeenCalled()
    expect(draw.getHistoryManager().getStats()).toEqual({ undo: 0, redo: 0, bytes: 0 })
    expect(draw.getDocumentRevision()).toBe(2)
  })
})


describe('PERF-12–14 incremental flow', () => {
  it('publishes page-limit truncation as a reversible model snapshot', async () => {
    const draw = await setup(Array.from({ length: 30 }, () => [
      { value: ZERO }, { value: 'paragraph text' }
    ]).flat(), { lab: { incrementalEditing: true, incrementalFlow: true } })
    expect(draw.getPageCount()).toBeGreaterThan(1)
    let mirror = {
      main: getSlimCloneElementList(draw.getOriginalMainElementList()),
      header: getSlimCloneElementList(draw.getHeader().getElementList()),
      footer: getSlimCloneElementList(draw.getFooter().getElementList())
    }
    const revision = draw.getDocumentRevision()
    const kinds: string[] = []
    draw.getEditJournal().subscribe(transaction => {
      for (const operation of transaction.operations) {
        kinds.push(operation.kind)
        applyOperation(operation, () => { throw new Error('Expected snapshot') },
          model => { mirror = model })
      }
    })
    draw.getOptions().pageNumber.maxPageNo = 1
    draw.render({ curIndex: 1 })
    expect(kinds).toEqual(['snapshot'])
    expect(mirror.main).toEqual(getSlimCloneElementList(draw.getOriginalMainElementList()))
    expect(draw.getDocumentRevision()).toBe(revision + 1)
    draw.render({ isSubmitHistory: false, curIndex: 1 })
    expect(draw.getDocumentRevision()).toBe(revision + 1)
  })

  it('reuses prefix flow and all committed prefix native indices', async () => {
    const content = Array.from({ length: 30 }, () => [
      { value: ZERO }, { value: 'abc مرحبا xyz' }
    ]).flat()
    const options = { incrementalEditing: true, incrementalFlow: true,
      transactionHistory: true, incrementalCoverage: true }
    const incremental = await setup(structuredClone(content), { lab: options })
    const full = await setup(structuredClone(content))
    const at = Math.floor(incremental.getOriginalMainElementList().length * 0.8)
    caret(incremental, at)
    caret(full, at)
    const position = incremental.getPosition()
    const prefix = position.getOriginalMainPositionList()[1]
    const placement = position.getNativeLines()[0]
    const before = incremental.getFlowStats().computed
    const state = (draw: Draw) => draw.getPosition().getOriginalMainPositionList()
      .map(p => ({ index: p.index, pageNo: p.pageNo, coordinate: p.coordinate,
        rowIndex: p.rowIndex }))
    incremental.getCanvasEvent().input('X')
    full.getCanvasEvent().input('X')
    expect(state(incremental)).toEqual(state(full))
    expect(incremental.getFlowStats().computed - before).toBeLessThan(5)
    expect(position.getOriginalMainPositionList()[1]).toBe(prefix)
    expect(position.getNativeLines()[0]).toBe(placement)
    expect(position.getNativeRow(incremental.getLayoutPages()[0][0], position.getOriginalMainPositionList(), 0)).toBe(placement)
    expect(incremental.getLayoutChangeSet()!.firstPage).toBeGreaterThan(0)
    for (const action of ['Backspace', 'Enter', 'Delete']) {
      key(incremental, action)
      key(full, action)
      expect(state(incremental)).toEqual(state(full))
    }
  })
})

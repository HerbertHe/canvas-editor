import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Draw } from '@/editor/core/draw/Draw'
import { Listener } from '@/editor/core/listener/Listener'
import { EventBus } from '@/editor/core/event/eventbus/EventBus'
import { Override } from '@/editor/core/override/Override'
import { CommandAdapt } from '@/editor/core/command/CommandAdapt'
import { mergeOption } from '@/editor/utils/option'
import { formatElementList } from '@/editor/utils/element'
import { ZERO } from '@/editor/dataset/constant/Common'
import { CompositionPreview } from '@/editor/core/draw/CompositionPreview'
import type { NativeParagraphInput } from '@/editor/core/text-engine/layout/TextLayoutService'
import { lineCarets } from '@/editor/core/layout/InteractionGeometry'
import type { IElement } from '@/editor/interface/Element'
import type { FontCoverageReport } from '@/editor/interface/FontCoverage'
import Editor from '@/editor'
import { ElementType } from '@/editor/dataset/enum/Element'
import { TextDirection } from '@/editor/dataset/enum/TextDirection'
import { ControlType, ControlComponent } from '@/editor/dataset/enum/Control'

const font = new Uint8Array(readFileSync('tests/fixtures/fonts/NotoSans-Latin-Regular.woff2')).buffer
const cjk = new Uint8Array(readFileSync('tests/fixtures/fonts/NotoSansSC-Regular.woff2')).buffer
const draws: Draw[] = []
afterEach(() => {
  draws.splice(0).forEach(draw => draw.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function setup(preview = true, tracked = true,
  main: IElement[] = [{ value: 'abcdef' }], defaultFont = 'Latin',
  accessibility = false) {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const options = mergeOption({ autoDownloadFonts: false, defaultFont,
    fonts: [{ family: 'Latin', data: font }, { family: 'CJK', data: cjk }], width: 600, height: 500,
    margins: [20, 20, 20, 20], header: { disabled: true }, footer: { disabled: true },
    pageNumber: { disabled: true }, accessibility: { disabled: !accessibility },
    lab: { performanceProfile: tracked ? 'sync' : 'baseline', imePreview: preview } })
  const content = { main, header: [{ value: ZERO }], footer: [{ value: ZERO }] }
  Object.values(content).forEach(elements => formatElementList(elements, {
    editorOptions: options, isForceCompensation: true }))
  const container = document.createElement('div')
  document.body.append(container)
  const draw = new Draw(container, options, content, new Listener(), new EventBus(), new Override())
  draws.push(draw)
  await draw.ready
  draw.getRange().setRange(2, 2)
  draw.render({ curIndex: 2, isSubmitHistory: false, isLazy: false })
  return draw
}
const text = (draw: Draw) => draw.getOriginalMainElementList().map(e => e.value).join('')
const end = (draw: Draw, data: string) => draw.getCanvasEvent().compositionend(
  new CompositionEvent('compositionend', { data }))

describe('IME local preview', () => {
  function previewWorker(draw: Draw) {
    const requests: { input: NativeParagraphInput;
      constraints: number;
      resolve: (response: any) => void; reject: (error: Error) => void;
      composition: { generation: number; sequence: number } }[] = []
    Object.assign(draw.getOptions().lab, { layoutWorker: true, imeWorkerPreview: true })
    Reflect.set(draw, 'workerFontRevision', draw.getLayoutHostAdapter().getFontManager().getRevision())
    Reflect.set(draw, 'workerNeedsResync', false)
    const client = { ready: true, getRevision: () => draw.getDocumentRevision(),
      getSession: () => 1,
      cancelPreview: vi.fn(),
      preview: (input: any, constraints: number, composition: any) => new Promise((resolve, reject) =>
        requests.push({ input, constraints, composition, resolve, reject })), destroy: vi.fn(),
      edit: () => Promise.resolve(), getQueueStats: () => ({ requests: requests.length,
        waiting: false, queuedBytes: 0, bufferedEdits: 0 }) }
    Reflect.set(draw, 'layoutWorkerClient', client)
    const answer = (index: number) => {
      const request = requests[index]
      request.resolve({ composition: request.composition,
        constraintsRevision: request.constraints,
        documentRevision: draw.getDocumentRevision(),
        fontRevision: draw.getLayoutHostAdapter().getFontManager().getRevision(),
        layouts: [draw.getLayoutHostAdapter().getTextLayoutService()
          .layoutParagraph(request.input as any)] })
    }
    return { requests, answer }
  }

  it('accepts only the newest worker preview and materializes synchronously at a query barrier', async () => {
    const draw = await setup()
    const original = text(draw)
    const worker = previewWorker(draw)
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('n'); host.flushComposition(false)
    host.input('ni'); host.flushComposition(false)
    expect(worker.requests).toHaveLength(2)
    worker.answer(0)
    await Promise.resolve(); await Promise.resolve()
    expect(draw.getCompositionWorkerStats()).toMatchObject({ committed: 0, stale: 1, pending: true })
    worker.answer(1)
    await draw.waitForCompositionPreview()
    expect(draw.getCompositionWorkerStats()).toMatchObject({ committed: 1, pending: false })
    expect(text(draw)).toBe(original)
    host.input('nih'); host.flushComposition(false)
    draw.flushGeometry()
    const current = text(draw)
    expect(current).toContain('abnihcdef')
    worker.answer(2)
    await Promise.resolve(); await Promise.resolve()
    expect(text(draw)).toBe(current)
    expect(draw.getCompositionWorkerStats().stale).toBe(2)
    draw.getOptions().lab.layoutWorker = false
    end(draw, '你')
    expect(text(draw)).toContain('ab你cdef')
  })

  it.each(['fault', 'deadline', 'cancel', 'destroy'])(
    'safely drains or invalidates a worker preview on %s', async reason => {
      const draw = await setup()
      const original = text(draw)
      const worker = previewWorker(draw)
      const host = draw.getCanvasEvent()
      host.compositionstart()
      host.input('ni'); host.flushComposition(false)
      const drained = draw.waitForCompositionPreview()
      if (reason === 'fault') worker.requests[0].reject(new Error('worker crash'))
      if (reason === 'deadline') await new Promise(resolve => setTimeout(resolve, 60))
      if (reason === 'cancel') end(draw, '')
      if (reason === 'destroy') draw.destroy()
      await drained
      expect(draw.getCompositionWorkerStats().pending).toBe(false)
      if (reason === 'fault' || reason === 'deadline') {
        expect(text(draw)).toContain('abnicdef')
        expect(host.getCompositionDiagnostics().local).toBe(false)
        expect(draw.getCompositionWorkerStats().fallbacks).toBe(1)
      } else expect(text(draw)).toBe(original)
      if (reason !== 'fault') {
        if (reason === 'destroy') worker.requests[0].resolve({ layouts: [] })
        else worker.answer(0)
        await Promise.resolve(); await Promise.resolve()
        expect(draw.getCompositionWorkerStats().committed).toBe(0)
      }
      draw.getOptions().lab.layoutWorker = false
    })

  it('lays out only the edited table cell and preserves full-layout geometry', async () => {
    const draw = await setup(true, true, [{ value: '', type: ElementType.TABLE,
      colgroup: Array.from({ length: 4 }, () => ({ width: 130 })),
      trList: Array.from({ length: 12 }, () => ({ height: 40,
        tdList: Array.from({ length: 4 }, () => ({ colspan: 1, rowspan: 1,
          value: [{ value: 'abc' }] })) })) }])
    const root = draw.getOriginalMainElementList()
    const index = root.findIndex(e => e.type === ElementType.TABLE)
    const table = root[index]
    const td = table.trList![5].tdList[1]
    draw.getPosition().setPositionContext({ isTable: true, index,
      trIndex: 5, tdIndex: 1, tdId: td.id })
    draw.getRange().setRange(1, 1)
    draw.render({ curIndex: 1, isSubmitHistory: false, isLazy: false })
    const host = draw.getCanvasEvent()
    host.compositionstart()
    for (const value of ['n', 'ni', 'nih']) {
      host.input(value)
      host.flushComposition(false)
      expect(draw.getTableLayoutStats()).toMatchObject({ computedCells: 1,
        reusedCells: 47, computedRows: 0, reusedRows: 12 })
    }
    const geometry = () => table.trList!.map(row => ({ height: row.height,
      cells: row.tdList.map(cell => ({ x: cell.x, y: cell.y, width: cell.width,
        height: cell.height, mainHeight: cell.mainHeight,
        positions: cell.positionList })) }))
    const incremental = JSON.stringify(geometry())
    draw.getOptions().lab.imeTableLayout = false
    draw.render({ curIndex: 4, isSubmitHistory: false, isLazy: false })
    expect(JSON.stringify(geometry())).toBe(incremental)
    end(draw, '')
    expect(td.value.map(e => e.value).join('')).toBe(ZERO + 'abc')
  })

  it.each(['中文 abcdef ', 'Latin words and spaces ', '中文 e\u0301 👩‍👩‍👧‍👦 abc '])(
    'reuses long-paragraph rows and matches full layout for %s', async sample => {
      const draw = await setup(true, true, [{ value: sample.repeat(350) }], 'CJK')
      const lines = draw.getPosition().getNativeLines()
      const last = lines[lines.length - 1]
      // A short last row leaves room for a growing pinyin preedit.
      const index = last.line.source.start + 1
      draw.getRange().setRange(index, index)
      draw.render({ curIndex: index, isSubmitHistory: false, isLazy: false })
      const original = text(draw)
      const preview = CompositionPreview.create(draw, index, index)
      expect(preview).not.toBeNull()
      expect(preview!.update('ni')).toBe(true)
      expect(preview!.work.windowElements).toBeLessThan(2048)
      expect(preview!.work.paragraphElements).toBeGreaterThan(2048)
      expect(preview!.work.reusedLines).toBe(lines.length - 1)
      const placed = Reflect.get(preview!, 'current')
      const expectedGlyphs = structuredClone(placed.line.glyphs)
      const expectedCarets = lineCarets(placed).map(c => ({ index: c.index + preview!.base,
        x: c.x, y: c.y, height: c.height }))
      const host = draw.getCanvasEvent()
      const compute = vi.spyOn(draw as any, 'computeRenderGeometry')
      host.compositionstart()
      host.input('n')
      host.flushComposition(false)
      host.input('ni')
      host.flushComposition(false)
      expect(host.getCompositionDiagnostics().local).toBe(true)
      expect(text(draw)).toBe(original)
      expect(compute).not.toHaveBeenCalled()
      draw.flushGeometry()
      const full = draw.getPosition().getNativeLines().at(-1)!
      expect(full.line.glyphs).toEqual(expectedGlyphs)
      const actual = lineCarets(full)
      expect(actual).toHaveLength(expectedCarets.length)
      actual.forEach((c, i) => {
        expect(c.index).toBe(expectedCarets[i].index)
        expect(c.x).toBeCloseTo(expectedCarets[i].x, 8)
        expect(c.y).toBeCloseTo(expectedCarets[i].y, 8)
        expect(c.height).toBe(expectedCarets[i].height)
      })
      end(draw, '')
      expect(text(draw)).toBe(original)
    })

  it('validates both neighbouring breaks for a middle-row replacement', async () => {
    const draw = await setup(true, true, [{ value: '中文 abcdef '.repeat(350) }], 'CJK')
    const lines = draw.getPosition().getNativeLines()
    const middle = lines[Math.floor(lines.length / 2)]
    const elements = draw.getOriginalMainElementList()
    const to = elements.findIndex((e, i) => i > middle.line.source.start + 2 &&
      i < middle.line.source.end - 2 && e.value === '中')
    expect(to).toBeGreaterThan(0)
    const preview = CompositionPreview.create(draw, to - 1, to)!
    expect(preview).not.toBeNull()
    expect(preview.update('文')).toBe(true)
    expect(preview.work.checkedLines).toBe(3)
    const placed = Reflect.get(preview, 'current')
    draw.getRange().setRange(to - 1, to)
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('文')
    draw.flushGeometry()
    const full = draw.getPosition().getNativeLines()[Math.floor(lines.length / 2)]
    expect(full.line.glyphs).toEqual(placed.line.glyphs)
    expect(preview.update('x'.repeat(100))).toBe(false)
  })

  it('retains the full path for long contextual scripts and explicit rollback', async () => {
    const draw = await setup(true, true, [{ value: '中文 abcdef '.repeat(350) }])
    draw.getOptions().lab.imeWindowPreview = false
    expect(CompositionPreview.create(draw, 3, 3)).toBeNull()
    draw.getOptions().lab.imeWindowPreview = true
    const arabic = await setup(true, true, [{ value: 'abc مرحبا '.repeat(350) }])
    expect(CompositionPreview.create(arabic, 3, 3)).toBeNull()
  })

  it('uses the selected endpoint style just like formal input', async () => {
    const draw = await setup(true, true, [{ value: 'ab', color: '#ff0000' },
      { value: 'cdef', color: '#0000ff' }])
    draw.getRange().setRange(1, 3)
    const preview = CompositionPreview.create(draw, 1, 3)!
    expect(preview.update('ni')).toBe(true)
    const glyphs = structuredClone(Reflect.get(preview, 'current').line.glyphs)
    draw.getCanvasEvent().compositionstart()
    draw.getCanvasEvent().input('ni')
    draw.flushGeometry()
    expect(draw.getPosition().getNativeLines()[0].line.glyphs).toEqual(glyphs)
  })

  it('lays out latest text locally without changing the formal model, then commits once', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    const original = text(draw)
    const compute = vi.spyOn(draw as any, 'computeRenderGeometry')
    const paint = vi.spyOn(CompositionPreview.prototype, 'paint')
    expect(CompositionPreview.create(draw, 2, 2)).not.toBeNull()
    host.compositionstart()
    host.input('n')
    host.input('ni')
    host.flushComposition(false)
    expect(text(draw)).toBe(original)
    expect(compute).not.toHaveBeenCalled()
    expect(paint).toHaveBeenCalledOnce()
    expect(host.getCompositionDiagnostics()).toMatchObject({ received: 2, merged: 1, previews: 1 })
    end(draw, '你')
    expect(text(draw)).toContain('ab你cdef')
    expect(compute).toHaveBeenCalledTimes(1)
    new CommandAdapt(draw).undo()
    expect(text(draw)).toBe(original)
  })

  it('materializes latest visible content for synchronous geometry consumers', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    draw.flushGeometry()
    expect(text(draw)).toContain('abnicdef')
    expect(host.getCompositionDiagnostics().local).toBe(false)
    host.input('nih')
    host.flushComposition(false)
    expect(text(draw)).toContain('abnihcdef')
    end(draw, '你')
    expect(text(draw)).toContain('ab你cdef')
  })

  it.each([true, false])('cancels a selected replacement with tracked=%s', async tracked => {
    const draw = await setup(true, tracked)
    const host = draw.getCanvasEvent()
    const original = text(draw)
    draw.getRange().setRange(1, 3)
    host.compositionstart()
    host.input('ni')
    draw.flushGeometry()
    expect(text(draw)).not.toBe(original)
    host.input('')
    host.flushComposition(false)
    end(draw, '')
    expect(text(draw)).toBe(original)
    expect(draw.getRange().getRange()).toMatchObject({ startIndex: 1, endIndex: 3 })
  })

  it('does not duplicate an untouched selected range on cancellation', async () => {
    const draw = await setup(true, false)
    const original = text(draw)
    draw.getRange().setRange(1, 3)
    draw.getCanvasEvent().compositionstart()
    end(draw, '')
    expect(text(draw)).toBe(original)
  })

  it('deduplicates the final native input and repeated end, preserving ordinary direct input', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    end(draw, '你')
    host.input('你', new InputEvent('input', { data: '你', inputType: 'insertText' }))
    end(draw, '你')
    expect(text(draw).split('你')).toHaveLength(2)
    host.input('你')
    expect(text(draw).split('你')).toHaveLength(3)
  })

  it('falls back for wrapping and clears all preview callbacks on destruction', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('x'.repeat(150))
    host.flushComposition(false)
    expect(host.getCompositionDiagnostics()).toMatchObject({ local: false, fallbacks: 1 })
    expect(text(draw)).toContain('x'.repeat(150))
    host.input('pending')
    draw.destroy()
    expect(host.getCompositionDiagnostics().active).toBe(false)
    host.flushComposition()
    expect(draw.getContainer().isConnected).toBe(false)
  })

  it('matches full glyph and caret placement when previewing a later paragraph', async () => {
    const draw = await setup(true, true, [{ value: ZERO }, { value: 'first' },
      { value: ZERO }, { value: 'abcdef' }])
    draw.getRange().setRange(9, 9)
    draw.render({ curIndex: 9, isSubmitHistory: false, isLazy: false })
    const preview = CompositionPreview.create(draw, 9, 9)!
    expect(preview).not.toBeNull()
    expect(preview.update('ni')).toBe(true)
    const placed = Reflect.get(preview, 'current')
    const before = lineCarets(placed).map(c => ({ index: c.index + preview.base,
      x: c.x, y: c.y, height: c.height }))
    const glyphs = structuredClone(placed.line.glyphs)
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    draw.flushGeometry()
    const full = draw.getPosition().getNativeLines().find(p => p.line.source.start === preview.base)!
    expect(full.line.glyphs).toEqual(glyphs)
    expect(lineCarets(full).map(c => ({ index: c.index, x: c.x, y: c.y,
      height: c.height }))).toEqual(before)
    end(draw, '')
  })

  it('handles null-data composition deletion through the textarea input path', async () => {
    const draw = await setup()
    const agent = draw.getCursor().getAgentDom()
    const original = text(draw)
    agent.dispatchEvent(new CompositionEvent('compositionstart'))
    agent.dispatchEvent(new InputEvent('input', { data: 'ni', isComposing: true }))
    draw.flushGeometry()
    agent.value = ''
    agent.dispatchEvent(new InputEvent('input', { data: null,
      inputType: 'deleteCompositionText', isComposing: true }))
    draw.getCanvasEvent().flushComposition(false)
    expect(text(draw)).toBe(original)
    agent.dispatchEvent(new CompositionEvent('compositionend', { data: '' }))
    expect(text(draw)).toBe(original)
  })

  it('matches CJK prefix glyph positions with multiple paragraph anchors', async () => {
    const draw = await setup(true, true, [{ value: ZERO }, { value: '中文 abcdef' }], 'CJK')
    draw.getRange().setRange(3, 3)
    draw.render({ curIndex: 3, isSubmitHistory: false, isLazy: false })
    const preview = CompositionPreview.create(draw, 3, 3)!
    expect(preview).not.toBeNull()
    expect(preview.update('n')).toBe(true)
    const placed = Reflect.get(preview, 'current')
    const glyphs = structuredClone(placed.line.glyphs)
    draw.getCanvasEvent().compositionstart()
    draw.getCanvasEvent().input('n')
    draw.flushGeometry()
    const full = draw.getPosition().getNativeLines().find(p => p.line.source.start === preview.base)!
    expect(full.line.glyphs).toEqual(glyphs)
  })

  it('invalidates a forced completion tail without blocking a new composition', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.finishComposition()
    const committed = text(draw)
    host.input('你', new InputEvent('input', { data: '你', isComposing: true }))
    end(draw, '你')
    host.input('你', new InputEvent('input', { data: '你', inputType: 'insertText' }))
    expect(text(draw)).toBe(committed)
    host.compositionstart()
    host.input('hao')
    end(draw, '好')
    expect(text(draw)).toContain('ni好')
  })

  it('preserves explicit typing styles through the conservative path', async () => {
    const draw = await setup()
    draw.getRange().setDefaultStyle({ color: '#ff0000' })
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    expect(host.getCompositionDiagnostics()).toMatchObject({ local: false, fallbacks: 1 })
    expect(draw.getElementList().filter(e => e.underline).every(e => e.color === '#ff0000')).toBe(true)
    end(draw, '你')
    expect(draw.getElementList().find(e => e.value === '你')?.color).toBe('#ff0000')
  })

  it('materializes through the actual public value query without ending composition', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const editor = await Editor.create(container, { main: [{ value: 'abcdef' }] }, {
      autoDownloadFonts: false, defaultFont: 'Latin', fonts: [{ family: 'Latin', data: font }],
      lab: { performanceProfile: 'sync', imePreview: true } })
    try {
      editor.command.executeSetRange(2, 2)
      const agent = container.querySelector('textarea')!
      agent.dispatchEvent(new CompositionEvent('compositionstart'))
      agent.dispatchEvent(new InputEvent('input', { data: 'ni', isComposing: true }))
      expect(editor.command.getValue().data.main.map(e => e.value).join('')).toContain('ni')
      expect(editor.getPerformanceDiagnostics().composition).toMatchObject({ active: true, local: false })
      agent.dispatchEvent(new CompositionEvent('compositionend', { data: '你' }))
      expect(editor.command.getValue().data.main.map(e => e.value).join('')).toContain('你')
    } finally { editor.destroy() }
  })

  it.each([false, true])('reuses the latest committed text in a new session, tracked=%s', async tracked => {
    const draw = await setup(true, tracked, [{ value: 'abcdef' }], 'CJK')
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    end(draw, '你')
    host.compositionstart()
    host.input('hao')
    host.flushComposition(false)
    expect(host.getCompositionDiagnostics().local).toBe(true)
    const preview = Reflect.get(draw, 'compositionPreview')
    const glyphs = structuredClone(Reflect.get(preview, 'current').line.glyphs)
    draw.flushGeometry()
    expect(text(draw)).toContain('ab你haocdef')
    expect(draw.getPosition().getNativeLines()[0].line.glyphs).toEqual(glyphs)
    end(draw, '好')
    expect(text(draw)).toContain('ab你好cdef')
  })
})


describe('IME derived work', () => {
  it('scans only the transient paragraph and retains missing glyph download work', async () => {
    const draw = await setup(true, true, Array.from({ length: 50 }, () =>
      [{ value: ZERO }, { value: 'abcdef' }]).flat())
    const adapter = draw.getLayoutHostAdapter()
    const collect = vi.spyOn(adapter, 'collectFontCoverage')
    const sync = vi.spyOn(Reflect.get(draw, 'fontDownloadManager'), 'sync')
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    expect(collect).toHaveBeenCalledOnce()
    expect(collect.mock.calls[0][0][0].elements.length).toBeLessThan(15)
    host.input('🛸')
    host.flushComposition(false)
    expect(sync.mock.calls.some(([report]) => (report as FontCoverageReport).issues.some(
      issue => issue.missingCharacters.includes('🛸') ||
        issue.missingSequences.includes('🛸')))).toBe(true)
    end(draw, '你')
    expect(collect.mock.calls.some(([roots]) =>
      roots[0].elements.length > 300)).toBe(true)
    const report = draw.getFontCoverageReport()
    expect(report.issues.flatMap(i => i.missingCharacters)).not.toContain('🛸')
  })

  it('defers search, control highlights and tools then restores them on completion', async () => {
    const draw = await setup()
    await new Promise(resolve => setTimeout(resolve, 0))
    const search = draw.getSearch()
    search.setSearchKeyword('ab')
    search.compute('ab')
    const compute = vi.spyOn(search, 'compute')
    const control = vi.spyOn(draw.getControl(), 'computeHighlightList')
    const tools = vi.spyOn(draw as any, 'refreshRenderTools')
    const searchPaint = vi.spyOn(search, 'render')
    const host = draw.getCanvasEvent()
    host.compositionstart()
    for (const value of ['n', 'ni', 'nih']) {
      host.input(value)
      host.flushComposition(false)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(compute).not.toHaveBeenCalled()
    expect(control).not.toHaveBeenCalled()
    expect(tools).not.toHaveBeenCalled()
    expect(searchPaint).not.toHaveBeenCalled()
    end(draw, '你')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(compute).toHaveBeenCalledOnce()
    expect(control).toHaveBeenCalledOnce()
    expect(tools).toHaveBeenCalledOnce()
    draw.flushPaint()
    expect(searchPaint).toHaveBeenCalled()
  })

  it('flushes complete coverage on a report query and on cancellation', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('🛸')
    host.flushComposition(false)
    const report = draw.getFontCoverageReport()
    expect(text(draw)).toContain('🛸')
    expect(report.issues.flatMap(i => i.missingCharacters)).toContain('🛸')
    expect(host.isComposing).toBe(true)
    end(draw, '')
    expect(draw.getFontCoverageReport().issues.flatMap(i =>
      i.missingCharacters)).not.toContain('🛸')
  })

  it('provides local accessibility feedback without forced layout', async () => {
    const draw = await setup(true, true, [{ value: 'abcdef' }], 'Latin', true)
    const host = draw.getCanvasEvent()
    const live = Reflect.get(draw.getAccessibility(), 'assertiveDom') as HTMLElement
    const layout = vi.spyOn(live, 'offsetHeight', 'get')
    const writes = vi.spyOn(live, 'replaceChildren')
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    expect(host.getCompositionDiagnostics().local).toBe(true)
    expect(live.textContent).toContain('ni')
    host.input('ni')
    host.flushComposition(false)
    expect(writes).toHaveBeenCalledOnce()
    expect(layout).not.toHaveBeenCalled()
    end(draw, '你')
    expect(live.textContent).toContain('你')
    expect(layout).toHaveBeenCalledOnce()
  })
})


describe('IME derived state barriers', () => {
  it.each([false, true])('measures coverage work with imePreview=%s', async enabled => {
    const draw = await setup(enabled, true, Array.from({ length: 50 }, () =>
      [{ value: ZERO }, { value: 'abcdef' }]).flat())
    const collect = vi.spyOn(draw.getLayoutHostAdapter(), 'collectFontCoverage')
    const host = draw.getCanvasEvent()
    host.compositionstart()
    for (const value of ['n', 'ni', 'nih']) {
      host.input(value)
      host.flushComposition(false)
    }
    const visited = collect.mock.calls.reduce((sum, [roots]) =>
      sum + roots.reduce((count, root) => count + root.elements.length, 0), 0)
    expect(visited).toBe(enabled ? 27 : 1062)
    end(draw, '你')
  })

  it('rebuilds and paints deferred highlights at a query barrier', async () => {
    const draw = await setup()
    const search = draw.getSearch()
    search.setSearchKeyword('ab')
    search.compute('ab')
    const compute = vi.spyOn(search, 'compute')
    const originalMatches = search.getSearchMatchList().map(match => match.index)
    const paint = vi.spyOn(search, 'render')
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    expect(compute).not.toHaveBeenCalled()
    draw.flushCompositionDerivedState()
    expect(compute).toHaveBeenCalledOnce()
    expect(paint).toHaveBeenCalled()
    expect(host.isComposing).toBe(true)
    host.input('nih')
    host.flushComposition(false)
    expect(compute).toHaveBeenCalledOnce()
    end(draw, '')
    expect(search.getSearchMatchList().map(match => match.index)).toEqual(originalMatches)
    expect(text(draw)).toContain('abcdef')
  })

  it('invalidates deferred font coverage when a font arrives during composition', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    const full = vi.spyOn(Reflect.get(draw, 'fontCoverageTracker'), 'updateContributions')
    await draw.registerFonts([{ family: 'Added', data: cjk }])
    expect(full).toHaveBeenCalled()
    host.input('nih')
    host.flushComposition(false)
    end(draw, '你')
    expect(text(draw)).toContain('ab你cdef')
  })
})


describe('IME caret anchoring', () => {
  function assertAnchor(draw: Draw) {
    const cursor = draw.getCursor()
    const native = Reflect.get(cursor, 'compositionCaret') ||
      draw.getPosition().getNativeCaret(draw.getRange().getRange().endIndex)
    expect(native).not.toBeNull()
    const offset = draw.getPageOffset(native.pageNo)
    const agent = cursor.getAgentDom()
    expect(parseFloat(agent.style.left)).toBeCloseTo(native.x + offset.x)
    expect(parseFloat(agent.style.top)).toBeCloseTo(native.y + offset.y)
    expect(parseFloat(agent.style.height)).toBeCloseTo(native.height)
    expect(agent.style.left).toBe(cursor.getCursorDom().style.left)
    expect(agent.style.top).toBe(cursor.getCursorDom().style.top)
  }

  it('places local preedit without refocusing, clearing input or resetting its selection', async () => {
    const draw = await setup()
    const agent = draw.getCursor().getAgentDom()
    agent.value = 'nihao'
    agent.setSelectionRange(1, 4)
    const focus = vi.spyOn(agent, 'focus')
    const select = vi.spyOn(agent, 'setSelectionRange')
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    assertAnchor(draw)
    expect(agent.value).toBe('nihao')
    expect([agent.selectionStart, agent.selectionEnd]).toEqual([1, 4])
    expect(focus).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    host.input('n')
    host.flushComposition(false)
    await Promise.resolve()
    assertAnchor(draw)
  })

  it('preserves the session while scaling and anchors to the new formal geometry', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    draw.setPageScale(1.5)
    await Promise.resolve()
    expect(host.isComposing).toBe(true)
    expect(host.getCompositionDiagnostics().local).toBe(false)
    assertAnchor(draw)
    host.input('nih')
    host.flushComposition(false)
    await Promise.resolve()
    assertAnchor(draw)
    end(draw, '你')
    expect(text(draw)).toContain('ab你cdef')
    expect(draw.getCursor().getAgentDom().style.width).toBe('')
  })

  it.each(['rtl', 'table', 'page'])('uses authoritative fallback carets in %s', async sample => {
    const main: IElement[] = sample === 'table' ? [{ value: '', type: ElementType.TABLE,
      colgroup: [{ width: 180 }], trList: [{ height: 40, tdList: [{ colspan: 1,
        rowspan: 1, value: [{ value: 'abcdef' }] }] }] }]
      : sample === 'rtl' ? [{ value: ZERO, direction: TextDirection.RTL },
        { value: 'abc אבג def', direction: TextDirection.RTL }]
        : [{ value: 'abcdef'.repeat(40) }]
    const draw = await setup(true, true, main)
    let index = 2
    if (sample === 'table') {
      const tableIndex = draw.getOriginalMainElementList().findIndex(e => e.type === ElementType.TABLE)
      const td = draw.getOriginalMainElementList()[tableIndex].trList![0].tdList[0]
      draw.getPosition().setPositionContext({ isTable: true, index: tableIndex,
        trIndex: 0, tdIndex: 0, tdId: td.id })
    } else if (sample === 'page') {
      Object.assign(draw.getOptions(), { width: 200, height: 120 })
      index = 80
    }
    draw.getRange().setRange(index, index)
    draw.render({ curIndex: index, isSubmitHistory: false, isLazy: false })
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('nihao')
    host.flushComposition(false)
    await Promise.resolve()
    expect(host.getCompositionDiagnostics().local).toBe(false)
    assertAnchor(draw)
    if (sample === 'page') expect(draw.getPosition().getNativeCaret(
      draw.getRange().getRange().endIndex)!.pageNo).toBeGreaterThan(0)
    if (sample === 'rtl') expect(draw.getCursor().getAgentDom().dir).toBe('rtl')
    end(draw, '你')
  })

  it('does not reclaim focus after an explicit DOM focus transfer', async () => {
    const draw = await setup()
    const agent = draw.getCursor().getAgentDom()
    agent.focus()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition(false)
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(document.activeElement).toBe(button)
    expect(host.isComposing).toBe(false)
  })

  it('keeps public page-scale commands inside the active composition', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const editor = await Editor.create(container, { main: [{ value: 'abcdef' }] }, {
      autoDownloadFonts: false, defaultFont: 'Latin', fonts: [{ family: 'Latin', data: font }],
      lab: { performanceProfile: 'sync', imePreview: true } })
    try {
      editor.command.executeSetRange(2, 2)
      const agent = container.querySelector('textarea')!
      agent.dispatchEvent(new CompositionEvent('compositionstart'))
      agent.dispatchEvent(new InputEvent('input', { data: 'ni', isComposing: true }))
      editor.command.executePageScale(1.5)
      await Promise.resolve()
      expect(editor.getPerformanceDiagnostics().composition?.active).toBe(true)
      expect(editor.command.getOptions().scale).toBe(1.5)
      agent.dispatchEvent(new CompositionEvent('compositionend', { data: '你' }))
      expect(editor.command.getValue().data.main.map(e => e.value).join('')).toContain('ab你cdef')
    } finally { editor.destroy() }
  })
})


describe('IME commit and cancellation boundaries', () => {
  it.each([false, true])('restores trace edits, range and typing style on cancellation, tracked=%s', async tracked => {
    const draw = await setup(true, tracked)
    draw.getOptions().trace.disabled = false
    draw.getRange().setRange(1, 3)
    draw.getRange().setDefaultStyle({ color: '#ff0000' })
    draw.render({ curIndex: 3, isSubmitHistory: false, isLazy: false })
    const before = draw.getValue().data
    const history = draw.getHistoryManager().getStats()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition()
    const render = vi.spyOn(draw, 'render')
    end(draw, '')
    expect(draw.getValue().data).toEqual(before)
    expect(draw.getRange().getRange()).toMatchObject({ startIndex: 1, endIndex: 3 })
    expect(draw.getRange().getDefaultStyle()).toMatchObject({ color: '#ff0000' })
    expect(draw.getHistoryManager().getStats()).toEqual(history)
    expect(render).toHaveBeenCalledOnce()
  })

  it('lets a final render subscriber undo the complete composition atomically', async () => {
    const draw = await setup()
    const original = text(draw)
    const host = draw.getCanvasEvent()
    let undone = false
    draw.getEventBus().on('renderChange', () => {
      if (!host.isComposing && !undone) {
        undone = true
        new CommandAdapt(draw).undo()
      }
    })
    host.compositionstart()
    host.input('ni')
    end(draw, '你')
    expect(undone).toBe(true)
    expect(text(draw)).toBe(original)
    new CommandAdapt(draw).redo()
    expect(text(draw)).toContain('ab你cdef')
  })

  it('can finish from a preedit render subscriber without duplicate text or stale composition info', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    let finished = false
    draw.getEventBus().on('renderChange', () => {
      if (host.isComposing && !finished) {
        finished = true
        host.finishComposition()
      }
    })
    host.compositionstart()
    host.input('ni')
    host.flushComposition()
    expect(text(draw)).toContain('abnicdef')
    expect(text(draw)).not.toContain('nini')
    expect(host.compositionInfo).toBeNull()
    expect(host.isComposing).toBe(false)
  })
})


describe('IME history and snapshot queries', () => {
  it.each([false, true])('makes one history entry through materialized replacements, tracked=%s', async tracked => {
    const draw = await setup(true, tracked)
    draw.getRange().setRange(1, 3)
    draw.render({ curIndex: 3, isSubmitHistory: false })
    const before = draw.getValue().data
    const count = draw.getHistoryManager().getStats().undo
    const host = draw.getCanvasEvent()
    host.compositionstart()
    for (const value of ['n', 'ni', 'nihao', 'ni']) {
      host.input(value)
      host.flushComposition()
      expect(draw.getHistoryManager().getStats().undo).toBe(count)
    }
    end(draw, '你')
    const final = draw.getValue().data
    expect(draw.getHistoryManager().getStats().undo).toBe(count + 1)
    expect(draw.getOriginalMainElementList().some(e => e.underline)).toBe(false)
    new CommandAdapt(draw).undo()
    expect(draw.getValue().data).toEqual(before)
    new CommandAdapt(draw).redo()
    expect(draw.getValue().data).toEqual(final)
  })

  it('preserves the snapshot of an async query while a later preedit is committed', async () => {
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('CSP worker-src none') }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const editor = await Editor.create(container, { main: [{ value: 'abcdef' }] }, {
      autoDownloadFonts: false, defaultFont: 'Latin', fonts: [{ family: 'Latin', data: font }],
      lab: { performanceProfile: 'sync', imePreview: true } })
    try {
      editor.command.executeSetRange(2, 2)
      const agent = container.querySelector('textarea')!
      agent.dispatchEvent(new CompositionEvent('compositionstart'))
      agent.dispatchEvent(new InputEvent('input', { data: 'ni', isComposing: true }))
      const snapshot = editor.command.getValue()
      const pending = editor.command.getValueAsync()
      agent.dispatchEvent(new InputEvent('input', { data: 'nih', isComposing: true }))
      agent.dispatchEvent(new CompositionEvent('compositionend', { data: '你' }))
      expect((await pending).data).toStrictEqual(snapshot.data)
      expect(editor.command.getValue().data.main.map(e => e.value).join('')).toBe('ab你cdef')
      expect((await editor.command.getValueAsync()).data).toStrictEqual(editor.command.getValue().data)
    } finally { editor.destroy() }
  })

  it('isolates a new session started by a final render listener from old cleanup', async () => {
    const draw = await setup(true, false)
    const host = draw.getCanvasEvent()
    let started = false
    draw.getEventBus().on('renderChange', () => {
      if (!host.isComposing && !started) {
        started = true
        host.compositionstart()
        host.input('hao')
        host.flushComposition()
      }
    })
    host.compositionstart()
    host.input('ni')
    end(draw, '你')
    expect(host.isComposing).toBe(true)
    end(draw, '')
    expect(text(draw)).toContain('ab你cdef')
    expect(text(draw)).not.toContain('hao')
  })
})


describe('IME stale native events and destruction', () => {
  it('keeps a forced-end tombstone until the native session ends, beyond the dedupe timer', async () => {
    const draw = await setup()
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.finishComposition()
    const committed = text(draw)
    await new Promise(resolve => setTimeout(resolve, 70))
    host.input('你', new InputEvent('input', { data: '你', isComposing: true }))
    end(draw, '你')
    host.input('你', new InputEvent('input', { data: '你', inputType: 'insertText' }))
    expect(text(draw)).toBe(committed)
    host.compositionstart()
    host.input('hao')
    end(draw, '好')
    expect(text(draw)).toContain('ni好')
  })

  it('ignores detached native input and queued callbacks after destruction', async () => {
    const draw = await setup()
    await new Promise(resolve => setTimeout(resolve, 0))
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    const content = vi.fn()
    draw.getEventBus().on('contentChange', content)
    const render = vi.spyOn(draw, 'render')
    draw.destroy()
    host.input('你', new InputEvent('input', { data: '你', isComposing: true }))
    host.compositionstart()
    end(draw, '你')
    await new Promise(resolve => setTimeout(resolve, 70))
    expect(host.isComposing).toBe(false)
    expect(render).not.toHaveBeenCalled()
    expect(content).not.toHaveBeenCalled()
  })
})


describe('IME control cancellation and events', () => {
  it.each([false, true])('restores an empty control placeholder and publishes its final value after history, tracked=%s', async tracked => {
    const draw = await setup(true, tracked, [{ value: '', type: ElementType.CONTROL,
      control: { type: ControlType.TEXT, value: null, placeholder: 'empty',
        prefix: '{', postfix: '}' } }])
    const prefix = draw.getElementList().findIndex(e =>
      e.controlComponent === ControlComponent.PREFIX)
    expect(prefix).toBeGreaterThan(0)
    draw.getRange().setRange(prefix, prefix)
    draw.render({ curIndex: prefix, isSubmitHistory: false })
    const before = draw.getValue().data
    const history = draw.getHistoryManager().getStats().undo
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition()
    end(draw, '')
    expect(draw.getValue().data).toEqual(before)
    expect(draw.getHistoryManager().getStats().undo).toBe(history)
    const events: unknown[] = []
    draw.getEventBus().on('controlContentChange', () => {
      events.push(draw.getValue().data)
      expect(host.isComposing).toBe(false)
      expect(host.compositionInfo).toBeNull()
      expect(draw.getHistoryManager().getStats().undo).toBe(history + 1)
    })
    host.compositionstart()
    host.input('ni')
    host.flushComposition()
    end(draw, '你')
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events[0])).toContain('你')
    new CommandAdapt(draw).undo()
    expect(draw.getValue().data).toEqual(before)
  })
})


describe('IME compact history', () => {
  it('retains the same final delta size regardless of intermediate preedit versions', async () => {
    const bytes: number[] = []
    for (const values of [['n'], ['n', 'ni', 'nih', 'niha', 'nihao']]) {
      const draw = await setup()
      draw.getRange().setRange(1, 3)
      draw.render({ curIndex: 3, isSubmitHistory: false })
      const original = draw.getValue().data
      const history = vi.spyOn(draw.getHistoryManager(), 'executeDelta')
      const host = draw.getCanvasEvent()
      host.compositionstart()
      for (const value of values) {
        host.input(value)
        host.flushComposition()
      }
      end(draw, '你好')
      const final = draw.getValue().data
      expect(history).toHaveBeenCalledOnce()
      bytes.push(history.mock.calls[0][0].bytes)
      new CommandAdapt(draw).undo()
      expect(draw.getValue().data).toEqual(original)
      new CommandAdapt(draw).redo()
      expect(draw.getValue().data).toEqual(final)
    }
    expect(bytes[0]).toBeGreaterThan(0)
    expect(bytes[1]).toBe(bytes[0])
  })
})


describe('IME Unicode and nested scopes', () => {
  it.each(['😀', 'e\u0301', 'אבג'])('replays compact Unicode history after %s preedit', async value => {
    const draw = await setup()
    const original = draw.getValue().data
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input(value)
    host.flushComposition()
    host.input('ni')
    host.flushComposition()
    end(draw, '👩‍👩‍👧‍👦你')
    const final = draw.getValue().data
    new CommandAdapt(draw).undo()
    expect(draw.getValue().data).toEqual(original)
    new CommandAdapt(draw).redo()
    expect(draw.getValue().data).toEqual(final)
  })

  it.each([false, true])('restores and replays a nested cell scope, tracked=%s', async tracked => {
    const table = (width: number, value: IElement[]): IElement => ({
      type: ElementType.TABLE, value: '', colgroup: [{ width }],
      trList: [{ height: 40, tdList: [{ colspan: 1, rowspan: 1, value }] }] })
    const draw = await setup(true, tracked, [table(320, [table(200, [{ value: 'abcdef' }])])])
    const root = draw.getOriginalMainElementList()
    const outerIndex = root.findIndex(e => e.type === ElementType.TABLE)
    const outer = root[outerIndex]
    const outerTd = outer.trList![0].tdList[0]
    const innerIndex = outerTd.value.findIndex(e => e.type === ElementType.TABLE)
    const inner = outerTd.value[innerIndex]
    const innerTd = inner.trList![0].tdList[0]
    const path = [
      { index: outerIndex, trIndex: 0, tdIndex: 0, tableId: outer.id, tdId: outerTd.id },
      { index: innerIndex, trIndex: 0, tdIndex: 0, tableId: inner.id, tdId: innerTd.id }
    ]
    draw.getPosition().setPositionContext({ isTable: true, ...path[1], tablePath: path })
    draw.getRange().setRange(1, 3)
    draw.render({ curIndex: 3, isSubmitHistory: false })
    const before = draw.getValue().data
    const host = draw.getCanvasEvent()
    host.compositionstart()
    host.input('ni')
    host.flushComposition()
    end(draw, '你好')
    const final = draw.getValue().data
    new CommandAdapt(draw).undo()
    expect(draw.getValue().data).toEqual(before)
    new CommandAdapt(draw).redo()
    expect(draw.getValue().data).toEqual(final)
    draw.getRange().setRange(1, 2)
    host.compositionstart()
    host.input('nihao')
    host.flushComposition()
    end(draw, '')
    expect(draw.getValue().data).toEqual(final)
    expect(draw.getRange().getRange()).toMatchObject({ startIndex: 1, endIndex: 2 })
    expect(draw.getPosition().getPositionContext().tablePath).toEqual(path)
  })
})

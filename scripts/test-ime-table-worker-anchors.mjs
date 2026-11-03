import assert from 'node:assert/strict'
import { launchImeBrowser } from './ime-browser.mjs'
const browser = await launchImeBrowser()
const base = process.env.BASE_URL || 'http://127.0.0.1:3020'
const errors = []
try {
  for (const kind of ['plain', 'wide', 'long', 'table']) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 720 } })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/canvas-editor/tests/fixtures/migration/ime-table-worker.html')
    await page.waitForFunction(() => window.imeTableWorker)
    const result = await page.evaluate(async kind => {
      const [{ Draw }, { Listener }, { EventBus }, { Override }, { mergeOption },
        { formatElementList }] = await Promise.all([
        import('/canvas-editor/src/editor/core/draw/Draw.ts'),
        import('/canvas-editor/src/editor/core/listener/Listener.ts'),
        import('/canvas-editor/src/editor/core/event/eventbus/EventBus.ts'),
        import('/canvas-editor/src/editor/core/override/Override.ts'),
        import('/canvas-editor/src/editor/utils/option.ts'),
        import('/canvas-editor/src/editor/utils/element.ts')
      ])
      const fonts = await Promise.all(['NotoSans-Latin-Regular.woff2', 'NotoSansSC-Regular.woff2']
        .map(async file => ({ family: file.includes('SC') ? 'CJK' : 'Latin',
          data: await (await fetch('/canvas-editor/tests/fixtures/fonts/' + file)).arrayBuffer() })))
      const body = kind !== 'table'
      const table = { value: '', type: 'table', colgroup: [{ width: 180 }],
        trList: Array.from({ length: 16 }, () => ({ height: 40,
          tdList: [{ rowspan: 1, colspan: 1, value: [{ value: '中文 abcdef' }] }] })) }
      const container = document.createElement('div')
      document.querySelector('#editor').append(container)
      const options = mergeOption({
        autoDownloadFonts: false, defaultFont: 'CJK', fonts,
        width: kind === 'wide' ? 9000 : 600, height: 600,
        margins: [20, 20, 20, 20], header: { disabled: true }, footer: { disabled: true },
        pageNumber: { disabled: true }, lab: { performanceProfile: body ? 'worker' : 'sync',
          imePreview: true, imeTableLayout: true, imeWorkerPreview: body }
      })
      const content = { main: body ? [{ value: kind === 'wide'
        ? 'office fi e\u0301 '.repeat(60) : kind === 'long'
          ? '中文 abcdef '.repeat(350) + ' tail' : '中文 abcdef' }] : [table],
        header: [{ value: '\u200b' }], footer: [{ value: '\u200b' }] }
      Object.values(content).forEach(elements => formatElementList(elements,
        { editorOptions: options, isForceCompensation: true }))
      const draw = new Draw(container, options, content,
        new Listener(), new EventBus(), new Override())
      await draw.ready
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      try {
        if (!body) {
          const root = draw.getOriginalMainElementList()
          const index = root.findIndex(e => e.type === 'table')
          const td = root[index].trList[12].tdList[0]
          draw.getPosition().setPositionContext({ isTable: true, index,
            trIndex: 12, tdIndex: 0, tdId: td.id })
        }
        const index = kind === 'long'
          ? draw.getPosition().getNativeLines().at(-1).line.source.start + 1 : 1
        draw.getRange().setRange(index, index)
        draw.render({ curIndex: index, isSubmitHistory: false, isLazy: false })
        await draw.waitForWorkerLayout()
        const initialCaret = draw.getPosition().getNativeCaret(index)
        draw.getPageList()[initialCaret.pageNo].scrollIntoView({ block: 'center' })
        const agent = draw.getCursor().getAgentDom()
        agent.focus()
        const host = draw.getCanvasEvent()
        await frame(); await frame()
        if (body) {
          host.compositionstart()
          host.input('n')
          host.flushComposition(false)
          await draw.waitForCompositionPreview()
          host.compositionend(new CompositionEvent('compositionend', { data: '' }))
          await draw.waitForWorkerLayout()
        }
        const beforeCommits = draw.getCompositionWorkerStats().committed
        host.compositionstart()
        agent.value = 'nihao'
        agent.setSelectionRange(1, 4)
        let checks = 0
        for (const value of ['n', 'ni', 'nih', 'nihao', 'ni']) {
          host.input(value)
          host.flushComposition(false)
          await draw.waitForCompositionPreview()
          await frame(); await frame()
          const native = Reflect.get(draw.getCursor(), 'compositionCaret') ||
            draw.getPosition().getNativeCaret(draw.getRange().getRange().endIndex)
          if (!native) throw new Error(kind + ': missing native caret')
          const offset = draw.getPageOffset(native.pageNo)
          for (const [key, expected] of [['left', native.x + offset.x],
            ['top', native.y + offset.y], ['height', native.height]]) {
            const actual = parseFloat(agent.style[key])
            // CSSOM serializes large pixel coordinates with limited precision.
            if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.01)
              throw new Error(`${kind}/${value}: ${key} ${actual} != ${expected}`)
            checks++
          }
          if (body && host.getCompositionDiagnostics().local &&
            (agent.value !== 'nihao' || agent.selectionStart !== 1 || agent.selectionEnd !== 4))
            throw new Error(kind + ': native preedit buffer/selection changed')
        }
        const worker = draw.getCompositionWorkerStats()
        if (body) {
          const images = () => draw.getPageList().map((canvas, pageNo) => {
            Reflect.get(draw, 'paintPage').call(draw, pageNo)
            return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
          })
          const preview = images()
          draw.flushGeometry()
          const full = images()
          if (full.length !== preview.length || full.some((page, index) =>
            page.length !== preview[index].length || page.some((value, i) => value !== preview[index][i])))
            throw new Error(kind + ': Worker preview pixels differ from formal layout')
        }
        host.compositionend(new CompositionEvent('compositionend', { data: '你' }))
        await draw.waitForWorkerLayout()
        if (body && worker.committed === beforeCommits) throw new Error(kind + ': no real Worker preview accepted ' +
          JSON.stringify({ worker, diagnostics: host.getCompositionDiagnostics(),
            layout: draw.getLayoutWorkerStats() }))
        return { checks, worker }
      } finally { draw.destroy() }
    }, kind)
    assert.equal(result.checks, 15)
    console.log(`PASS: ${kind} real DOM anchor checks=${result.checks}, Worker commits=${result.worker.committed}`)
    await page.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }

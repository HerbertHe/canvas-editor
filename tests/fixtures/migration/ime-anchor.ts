import { Draw } from '../../../src/editor/core/draw/Draw'
import { Listener } from '../../../src/editor/core/listener/Listener'
import { EventBus } from '../../../src/editor/core/event/eventbus/EventBus'
import { Override } from '../../../src/editor/core/override/Override'
import { formatElementList } from '../../../src/editor/utils/element'
import { mergeOption } from '../../../src/editor/utils/option'
import { ElementType } from '../../../src/editor/dataset/enum/Element'
import { TextDirection } from '../../../src/editor/dataset/enum/TextDirection'
import { ZERO } from '../../../src/editor/dataset/constant/Common'
import type { IElement } from '../../../src/editor/interface/Element'
import type { NativeCaret } from '../../../src/editor/core/layout/InteractionGeometry'

let draw: Draw | null = null
const fonts = await Promise.all([
  ['Latin', 'NotoSans-Latin-Regular.woff2'], ['CJK', 'NotoSansSC-Regular.woff2']
].map(async ([family, file]) => ({ family, data: await (await fetch(
  `${import.meta.env.BASE_URL}tests/fixtures/fonts/${file}`)).arrayBuffer() })))
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

async function setup(sample: 'local' | 'page' | 'rtl' | 'table' = 'local') {
  draw?.destroy()
  for (const id of ['inner', 'outer']) document.getElementById(id)!.scrollTo(0, 0)
  const main: IElement[] = sample === 'table' ? [{ value: '', type: ElementType.TABLE,
    colgroup: [{ width: 280 }], trList: [{ height: 40, tdList: [{ colspan: 1,
      rowspan: 1, value: [{ value: '中文 abcdef' }] }] }] }]
    : sample === 'rtl' ? [{ value: ZERO, direction: TextDirection.RTL },
      { value: 'abc אבג def', direction: TextDirection.RTL }]
      : sample === 'page' ? [{ value: '中文 abcdef '.repeat(90) }]
        : Array.from({ length: 25 }, () => [{ value: ZERO }, { value: '中文 abcdef' }]).flat()
  const options = mergeOption({ autoDownloadFonts: false, defaultFont: 'CJK', fonts,
    width: 620, height: 260, margins: [25, 25, 25, 25],
    header: { disabled: true }, footer: { disabled: true }, pageNumber: { disabled: true },
    maskMargin: [4, 4, 4, 4], lab: { performanceProfile: 'sync', imePreview: true } })
  const content = { main, header: [{ value: ZERO }], footer: [{ value: ZERO }] }
  Object.values(content).forEach(elements => formatElementList(elements, {
    editorOptions: options, isForceCompensation: true }))
  const container = document.createElement('div')
  document.getElementById('editor')!.append(container)
  draw = new Draw(container, options, content, new Listener(), new EventBus(), new Override())
  await draw.ready
  let index = sample === 'page' ? 600 : sample === 'local' ? 123 : 3
  if (sample === 'table') {
    const tableIndex = draw.getOriginalMainElementList().findIndex(e => e.type === ElementType.TABLE)
    const td = draw.getOriginalMainElementList()[tableIndex].trList![0].tdList[0]
    draw.getPosition().setPositionContext({ isTable: true, index: tableIndex,
      trIndex: 0, tdIndex: 0, tdId: td.id })
    index = 3
  }
  draw.getRange().setRange(index, index)
  draw.render({ curIndex: index, isSubmitHistory: false, isLazy: false })
  await frame()
  draw.getCursor().focus()
  return snapshot()
}

function snapshot() {
  if (!draw) throw new Error('Call setup first')
  const cursor = draw.getCursor()
  const native: NativeCaret = Reflect.get(cursor, 'compositionCaret') ||
    draw.getPosition().getNativeCaret(draw.getRange().getRange().endIndex)
  const offset = draw.getPageOffset(native.pageNo)
  const agent = cursor.getAgentDom()
  const caret = cursor.getCursorDom()
  const rect = (element: Element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
    return { left, top, right, bottom, width, height }
  }
  return { expected: { left: native.x + offset.x, top: native.y + offset.y,
    height: native.height }, nativePage: native.pageNo,
    agent: rect(agent), caret: rect(caret),
    style: { left: parseFloat(agent.style.left), top: parseFloat(agent.style.top),
      height: parseFloat(agent.style.height) },
    ports: ['inner', 'outer'].map(id => ({ id, ...rect(document.getElementById(id)!),
      scrollTop: document.getElementById(id)!.scrollTop,
      scrollLeft: document.getElementById(id)!.scrollLeft })),
    active: document.activeElement === agent, dir: agent.dir,
    metrics: { clientHeight: agent.clientHeight, scrollHeight: agent.scrollHeight,
      fontSize: getComputedStyle(agent).fontSize, lineHeight: getComputedStyle(agent).lineHeight,
      wrap: agent.wrap },
    value: agent.value, selection: [agent.selectionStart, agent.selectionEnd],
    composition: draw.getCanvasEvent().getCompositionDiagnostics() }
}

async function preedit(value: string) {
  const agent = draw!.getCursor().getAgentDom()
  if (!draw!.getCanvasEvent().isComposing)
    agent.dispatchEvent(new CompositionEvent('compositionstart'))
  // Emulate native textarea contents/selection before the untrusted input event.
  agent.value = value
  agent.setSelectionRange(value.length, value.length)
  agent.dispatchEvent(new InputEvent('input', { data: value, isComposing: true }))
  await frame()
  await frame()
  return snapshot()
}

async function scale(value: number) {
  draw!.setPageScale(value)
  await frame()
  return snapshot()
}
function dispose() { draw?.destroy(); draw = null }
const api = { setup, preedit, scale, snapshot, dispose }
declare global { interface Window { imeAnchorQA: typeof api } }
await setup()
window.imeAnchorQA = api

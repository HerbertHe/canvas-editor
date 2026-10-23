import { DerivedState } from './DerivedState'
import type { EditorPerformanceDiagnostics, WorkerFallbackReason } from '../../interface/Performance'
import { EditJournal, applyOperation, inverseOperation,
  type EditOperation, type EditDocument } from '../history/EditTransaction'
import type { IRange } from '../../interface/Range'
import type { IPositionContext } from '../../interface/Position'
import { defaultPlaceholderOption } from '../../dataset/constant/Placeholder'
import type {
  FontCoverageLocation,
  FontCoverageReport
} from '../../interface/FontCoverage'
import type { LayoutNode } from '../../interface/Layout'
import type { LayoutRow } from '../../interface/LayoutRow'
import type { IEditorFontFace } from '../../interface/TextEngine'
import { mergeOption } from '../../utils/option'
import { EditorLifecycle } from '../EditorLifecycle'
import { DocumentFlow } from '../layout/DocumentFlow'
import { LayoutWorkerClient } from '../worker/layout/LayoutWorkerClient'
import { IncrementalFlow, changedLayoutPages } from '../layout/IncrementalFlow'
import type { LayoutChangeSet } from '../layout/IncrementalFlow'
import { getHostRowsHeight } from '../layout/hostRowGeometry'
import { isFloatingImage } from '../layout/InlineObjectMeasure'
import { textRangeRects, type NativeCaret } from '../layout/InteractionGeometry'
import {
  resolveListOffset,
  resolveRowMargin
} from '../layout/ParagraphStyleResolver'
import { rowElementMetrics, rowSourceIndex } from '../layout/rowGeometry'
import { snapshotRows } from '../layout/rowSnapshot'
import { sliceTableFragment } from '../layout/TableFragment'
import { translateLayout } from '../layout/translateLayout'
import { groupAreaLayouts } from '../text-engine-host/AreaLayoutHost'
import { layoutFlowParagraph } from '../text-engine-host/FlowParagraphHost'
import { layoutHostObject } from '../text-engine-host/ObjectLayoutHost'
import { layoutHostTable } from '../text-engine-host/TableLayoutHost'
import { FontCoverageTracker } from '../text-engine/font/FontCoverageTracker'
import { FontDownloadManager } from '../text-engine/font/FontDownloadManager'
import { DirtyRangeTracker } from './DirtyRangeTracker'
import { FontDiagnostics } from './FontDiagnostics'
import { version } from '../../../../package.json'
import { ZERO } from '../../dataset/constant/Common'
import {
  IAppendElementListOption,
  IComputeRowListPayload,
  IDrawFloatPayload,
  IDrawOption,
  IDrawPagePayload,
  IDrawRowPayload,
  IGetImageOption,
  IGetOriginValueOption,
  IGetValueOption,
  IPainterOption
} from '../../interface/Draw'
import {
  IEditorData,
  IEditorOption,
  IEditorResult,
  ISetValueOption
} from '../../interface/Editor'
import {
  IElement,
  IElementFillRect,
  IElementStyle,
  IInsertElementListOption,
  ISpliceElementListOption
} from '../../interface/Element'
import { IMarkElementListDeletedOption } from '../../interface/Trace'
import { IColumnLayout, IColumnOption } from '../../interface/Column'
import { ColumnManager } from './column/ColumnManager'
import { LayoutHostAdapter, type ParagraphSpan } from '../text-engine-host'
import { deepClone, nextTick } from '../../utils'
import { Cursor } from '../cursor/Cursor'
import { CanvasEvent } from '../event/CanvasEvent'
import { GlobalEvent } from '../event/GlobalEvent'
import { HistoryManager } from '../history/HistoryManager'
import { Listener } from '../listener/Listener'
import { Position } from '../position/Position'
import { RangeManager } from '../range/RangeManager'
import { Background } from './frame/Background'
import { Highlight } from './richtext/Highlight'
import { Margin } from './frame/Margin'
import { Search } from './interactive/Search'
import { Spellcheck } from './interactive/Spellcheck'
import { Strikeout } from './richtext/Strikeout'
import { Underline } from './richtext/Underline'
import { ElementType } from '../../dataset/enum/Element'
import { TraceType } from '../../dataset/enum/Trace'
import { ImageParticle } from './particle/ImageParticle'
import { LaTexParticle } from './particle/latex/LaTexParticle'
import { PageNumber } from './frame/PageNumber'
import { ScrollObserver } from '../observer/ScrollObserver'
import { SelectionObserver } from '../observer/SelectionObserver'
import { TableParticle } from './particle/table/TableParticle'
import { TablePaging } from './particle/table/TablePaging'
import { TableTool } from './particle/table/TableTool'
import { Ruler } from './ruler/Ruler'
import { HyperlinkParticle } from './particle/HyperlinkParticle'
import { HintParticle } from './particle/HintParticle'
import { TraceParticle } from './particle/TraceParticle'
import { LabelParticle } from './particle/LabelParticle'
import { Header } from './frame/Header'
import { SuperscriptParticle } from './particle/SuperscriptParticle'
import { SubscriptParticle } from './particle/SubscriptParticle'
import { SeparatorParticle } from './particle/SeparatorParticle'
import { PageBreakParticle } from './particle/PageBreakParticle'
import { Watermark } from './frame/Watermark'
import { WatermarkLayer, WatermarkType } from '../../dataset/enum/Watermark'
import { TextDirection } from '../../dataset/enum/TextDirection'
import {
  EditorComponent,
  EditorMode,
  EditorZone,
  PageMode,
  PaperDirection
} from '../../dataset/enum/Editor'
import { Control } from './control/Control'
import { CascadeManager } from '../cascade/CascadeManager'
import { Validate } from '../validate/Validate'
import { CheckboxParticle } from './particle/CheckboxParticle'
import { RadioParticle } from './particle/RadioParticle'
import { DeepRequired, IPadding } from '../../interface/Common'
import { ControlComponent } from '../../dataset/enum/Control'
import {
  formatElementList,
  getSlimCloneElementList,
  isElementLayoutHidden,
  pickSurroundElementList,
  zipElementList
} from '../../utils/element'
import { WorkerManager } from '../worker/WorkerManager'
import { Previewer } from './particle/previewer/Previewer'
import { DateParticle } from './particle/date/DateParticle'
import { IMargin } from '../../interface/Margin'
import { BlockParticle } from './particle/block/BlockParticle'
import { EDITOR_COMPONENT, EDITOR_PREFIX } from '../../dataset/constant/Editor'
import { I18n } from '../i18n/I18n'
import { ImageObserver } from '../observer/ImageObserver'
import { Zone } from '../zone/Zone'
import { Footer } from './frame/Footer'
import {
  IMAGE_ELEMENT_TYPE,
  TEXTLIKE_ELEMENT_TYPE
} from '../../dataset/constant/Element'
import { ListParticle } from './particle/ListParticle'
import { Placeholder } from './frame/Placeholder'
import { EventBus } from '../event/eventbus/EventBus'
import { EventBusMap } from '../../interface/EventBus'
import { Group } from './interactive/Group'
import { Override } from '../override/Override'
import { ImageDisplay } from '../../dataset/enum/Common'
import { WHITE_SPACE_REG } from '../../dataset/constant/Regular'
import { LineBreakParticle } from './particle/LineBreakParticle'
import { WhiteSpaceParticle } from './particle/WhiteSpaceParticle'
import { MouseObserver } from '../observer/MouseObserver'
import { LineNumber } from './frame/LineNumber'
import { PageBorder } from './frame/PageBorder'
import { ITd } from '../../interface/table/Td'
import { Actuator } from '../actuator/Actuator'
import { TableOperate } from './particle/table/TableOperate'
import { Area } from './interactive/Area'
import { Badge } from './frame/Badge'
import { Graffiti } from './graffiti/Graffiti'
import { Magnifier } from './interactive/Magnifier'
import { Accessibility } from '../accessibility/Accessibility'

interface EditSelection {
  cursorIndex: number
  hint: NativeCaret | null
  range: IRange
  context: IPositionContext
  pageNo: number
  zone: EditorZone
}
interface PendingEdit {
  kind: string
  before: EditSelection
  publishedState: EditSelection
  operations: EditOperation[]
  published: number
  publishedModel: boolean
  trusted: boolean
  history: boolean
  groupable: boolean
  started: number
  depth: number
  snapshot?: EditDocument
}

export class Draw {
  private container: HTMLDivElement
  private pageContainer: HTMLDivElement
  private pageList: HTMLCanvasElement[]
  private ctxList: CanvasRenderingContext2D[]
  private pageNo: number
  private renderCount: number
  private pagePixelRatio: number | null
  private mode: EditorMode
  private options: DeepRequired<IEditorOption>
  private position: Position
  private zone: Zone
  private elementList: IElement[]
  private listener: Listener
  private eventBus: EventBus<EventBusMap>
  private override: Override

  private i18n: I18n
  private canvasEvent: CanvasEvent
  private globalEvent: GlobalEvent
  private cursor: Cursor
  private range: RangeManager
  private margin: Margin
  private background: Background
  private badge: Badge
  private magnifier: Magnifier
  private search: Search
  private spellcheck: Spellcheck
  private group: Group
  private area: Area
  private underline: Underline
  private strikeout: Strikeout
  private highlight: Highlight
  private historyManager: HistoryManager
  private previewer: Previewer
  private imageParticle: ImageParticle
  private laTexParticle: LaTexParticle
  private tableParticle: TableParticle
  private tablePaging: TablePaging
  private tableTool: TableTool
  private tableOperate: TableOperate
  private pageNumber: PageNumber
  private lineNumber: LineNumber
  private waterMark: Watermark
  private placeholder: Placeholder
  private header: Header
  private footer: Footer
  private hyperlinkParticle: HyperlinkParticle
  private hintParticle: HintParticle
  private traceParticle: TraceParticle
  private labelParticle: LabelParticle
  private dateParticle: DateParticle
  private separatorParticle: SeparatorParticle
  private pageBreakParticle: PageBreakParticle
  private superscriptParticle: SuperscriptParticle
  private subscriptParticle: SubscriptParticle
  private checkboxParticle: CheckboxParticle
  private radioParticle: RadioParticle
  private blockParticle: BlockParticle
  private listParticle: ListParticle
  private lineBreakParticle: LineBreakParticle
  private whiteSpaceParticle: WhiteSpaceParticle
  private control: Control
  private cascadeManager: CascadeManager
  private validate: Validate
  private pageBorder: PageBorder
  private workerManager: WorkerManager
  private scrollObserver: ScrollObserver
  private selectionObserver: SelectionObserver
  private imageObserver: ImageObserver
  private graffiti: Graffiti
  private accessibility: Accessibility

  private LETTER_REG: RegExp
  private rowList: LayoutRow[]
  // 跨页表格拆分前的原始行列表：增量计算以其为基准（片段行不参与复用定位）
  private rawRowList: LayoutRow[]
  private dirtyRangeTracker: DirtyRangeTracker
  // maxPageNo 截断发生过（elementList 被裁剪导致行/元素失配），禁用增量
  private isElementListTruncated: boolean
  private pageRowList: LayoutRow[][]
  private pageDirectionList: PaperDirection[]
  private painterStyle: IElementStyle | null
  private painterOptions: IPainterOption | null
  private visiblePageNoList: number[]
  private intersectionPageNo: number
  private lazyRenderIntersectionObserver: IntersectionObserver | null
  private printModeData: Required<Omit<IEditorData, 'graffiti'>> | null
  private columnManager: ColumnManager
  private ruler: Ruler
  private lifecycle = new EditorLifecycle()
  public readonly ready = this.lifecycle.ready
  private readonly guardedEvents = [
    'pointerdown',
    'mousedown',
    'mouseup',
    'mousemove',
    'click',
    'dblclick',
    'contextmenu',
    'keydown',
    'beforeinput',
    'input',
    'paste',
    'cut',
    'compositionstart',
    'compositionend',
    'dragover',
    'drop',
    'touchstart'
  ]
  private interactionGuard = (event: Event) => {
    if (this.lifecycle.state === 'ready') return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private renderedFontRevision = 0
  private layoutHostAdapter: LayoutHostAdapter

  constructor(
    rootContainer: HTMLElement,
    options: DeepRequired<IEditorOption>,
    data: IEditorData,
    listener: Listener,
    eventBus: EventBus<EventBusMap>,
    override: Override
  ) {
    this.container = this._wrapContainer(rootContainer)
    this.pageList = []
    this.ctxList = []
    this.pageNo = 0
    this.renderCount = 0
    this.pagePixelRatio = null
    this.mode = options.mode
    this.options = options
    this.elementList = data.main
    this.pageDirectionList = [options.paperDirection]
    this.listener = listener
    this.eventBus = eventBus
    this.override = override

    this._formatContainer()
    this.pageContainer = this._createPageContainer()
    this._createPage(0)

    this.i18n = new I18n(options.locale, () => {
      this.fontDiagnostics?.refresh()
      if (this.isReady())
        this.render({
          isCompute: false,
          isSetCursor: false,
          isSubmitHistory: false
        })
    })
    this.fontDiagnostics = new FontDiagnostics(
      this.container,
      this.i18n,
      () => ({
        print: this.isPrintMode(),
        rtl: this.options.direction === TextDirection.RTL
      }),
      location => this.locateFontCoverage(location)
    )
    this.historyManager = new HistoryManager(this)
    this.position = new Position(this)
    this.zone = new Zone(this)
    this.range = new RangeManager(this)
    this.margin = new Margin(this)
    this.background = new Background(this)
    this.badge = new Badge(this)
    this.magnifier = new Magnifier(this)
    this.search = new Search(this)
    this.spellcheck = new Spellcheck(this)
    this.group = new Group(this)
    this.area = new Area(this)
    this.underline = new Underline(this)
    this.strikeout = new Strikeout(this)
    this.highlight = new Highlight(this)
    this.previewer = new Previewer(this)
    this.imageParticle = new ImageParticle(this)
    this.laTexParticle = new LaTexParticle(this)
    this.tableParticle = new TableParticle(this)
    this.tablePaging = new TablePaging(this)
    this.rawRowList = []
    this.isElementListTruncated = false
    this.dirtyRangeTracker = new DirtyRangeTracker(() => {
      this.promoteSnapshotEdit()
      this.opaqueEditPending = true
      this.layoutHostAdapter?.clearParagraphCache()
    }, () => {
      if (this.options.lab?.incrementalEditing && !this.trackedMutationDepth) {
        this.promoteSnapshotEdit()
        this.opaqueEditPending = true
        this.layoutHostAdapter?.clearParagraphCache()
      }
    })
    this.editJournal.subscribe(transaction => {
      if (this.layoutChange && !this.pendingWorkerRender &&
        this.geometryRevision === this.modelRevision)
        this.layoutChange.documentRevision = transaction.targetRevision
      this.derivedState.invalidateFor(transaction.operations)
      const client = this.layoutWorkerClient
      if (client?.ready) {
        const session = client.getSession()
        void client.edit(transaction).catch(() => {
          if (this.layoutWorkerClient === client && client.getSession() === session)
            this.scheduleWorkerRecovery()
        })
      } else if (this.layoutWorkerClient) this.scheduleWorkerRecovery()
    })
    this.tableTool = new TableTool(this)
    this.tableOperate = new TableOperate(this)
    this.pageNumber = new PageNumber(this)
    this.lineNumber = new LineNumber(this)
    this.waterMark = new Watermark(this)
    this.placeholder = new Placeholder(this)
    this.header = new Header(this, data.header)
    this.footer = new Footer(this, data.footer)
    this.hyperlinkParticle = new HyperlinkParticle(this)
    this.hintParticle = new HintParticle(this)
    this.traceParticle = new TraceParticle(this)
    this.labelParticle = new LabelParticle(this)
    this.dateParticle = new DateParticle(this)
    this.separatorParticle = new SeparatorParticle(this)
    this.pageBreakParticle = new PageBreakParticle(this)
    this.superscriptParticle = new SuperscriptParticle()
    this.subscriptParticle = new SubscriptParticle()
    this.checkboxParticle = new CheckboxParticle(this)
    this.radioParticle = new RadioParticle(this)
    this.blockParticle = new BlockParticle(this)
    this.listParticle = new ListParticle(this)
    this.lineBreakParticle = new LineBreakParticle(this)
    this.whiteSpaceParticle = new WhiteSpaceParticle(this)
    this.control = new Control(this)
    this.cascadeManager = new CascadeManager(this)
    this.validate = new Validate(this)
    this.pageBorder = new PageBorder(this)
    this.graffiti = new Graffiti(this, data.graffiti)
    this.columnManager = new ColumnManager(this)
    this.ruler = new Ruler(this)
    this.layoutHostAdapter = new LayoutHostAdapter(
      () => this.options,
      () => ({
        isDesignMode: this.isDesignMode(),
        isAreaHideDisabled: this.isAreaHideDisabled(),
        isTraceHidden: (el: IElement) => this.traceParticle.isTraceHidden(el)
      })
    )

    this.scrollObserver = new ScrollObserver(this)
    this.selectionObserver = new SelectionObserver(this)
    this.imageObserver = new ImageObserver()
    new MouseObserver(this)

    this.canvasEvent = new CanvasEvent(this)
    this.cursor = new Cursor(this, this.canvasEvent)
    this.canvasEvent.register()
    this.globalEvent = new GlobalEvent(this, this.canvasEvent)
    this.globalEvent.register()

    this.workerManager = new WorkerManager(this)
    new Actuator(this)
    this.accessibility = new Accessibility(this)

    const { letterClass } = options
    this.LETTER_REG = new RegExp(`[${letterClass.join('')}]`)
    this.rowList = []
    this.pageRowList = []
    this.painterStyle = null
    this.painterOptions = null
    this.visiblePageNoList = []
    this.intersectionPageNo = 0
    this.lazyRenderIntersectionObserver = null
    this.printModeData = null

    // 打印模式优先设置打印数据
    if (this.mode === EditorMode.PRINT) {
      this.setPrintData()
    }
    for (const event of this.guardedEvents) {
      this.container.addEventListener(event, this.interactionGuard, true)
    }
    const agent = this.cursor.getAgentDom()
    agent.readOnly = true
    this.container.setAttribute('aria-busy', 'true')
    this.lifecycle.start(this.layoutHostAdapter.ensureReady(), () => {
      this.render({ isInit: true, isSetCursor: false, isFirstRender: true })
      this.cascadeManager.executeAll()
      if (this.lifecycle.state !== 'destroyed') agent.readOnly = false
    })
    void this.ready.then(
      () => {
        if (this.lifecycle.state !== 'destroyed') {
          this.container.setAttribute('aria-busy', 'false')
          this.updateFontCoverage()
          this.ensureLayoutWorker()
        }
      },
      () => {
        if (this.lifecycle.state !== 'destroyed') {
          this.container.setAttribute('aria-busy', 'false')
        }
      }
    )
  }

  private fontDownloadManager = new FontDownloadManager({
    register: async (faces, signal) => {
      await this.ready
      if (signal.aborted)
        throw new DOMException('Font registration aborted', 'AbortError')
      this.lifecycle.assertReady()
      const manager = this.layoutHostAdapter.getFontManager()
      const results = []
      for (const face of faces)
        results.push(await manager.registerFace(face, signal))
      this.lifecycle.assertReady()
      if (manager.getRevision() !== this.renderedFontRevision) {
        this.dirtyRangeTracker.markFullDirty()
        this.render({ isSetCursor: false, isSubmitHistory: false })
      }
      return results
    },
    change: () => {
      if (this.isReady()) this.updateFontCoverage()
    }
  })
  private coveragePublishedSignature = ''

  public retryFontDownloads() {
    this.lifecycle.assertReady()
    this.fontDownloadManager.retry()
  }

  private fontDiagnostics: FontDiagnostics

  private pendingFontCoverage: FontCoverageReport | null = null
  private fontCoverageEmission = 0
  private fontCoverageTracker = new FontCoverageTracker(report => {
    this.pendingFontCoverage = report
  })

  private publishFontCoverage() {
    if (this.lifecycle.state === 'initializing') return
    if (!this.isReady() || !this.pendingFontCoverage) return
    const report = this.getFontCoverageReport()
    this.pendingFontCoverage = null
    this.fontDiagnostics.update(report)
    const signature = JSON.stringify(report)
    if (signature === this.coveragePublishedSignature) return
    this.coveragePublishedSignature = signature
    const emission = ++this.fontCoverageEmission
    this.listener.fontCoverageChange?.(structuredClone(report))
    // A listener can synchronously edit or destroy the editor.
    if (this.isReady() && emission === this.fontCoverageEmission)
      this.eventBus.emit('fontCoverageChange', structuredClone(report))
  }

  /** Resolve stable source identity after edits; never navigate by stale offsets. */
  private locateFontCoverage(location: FontCoverageLocation) {
    const visit = (
      elements: IElement[],
      zone: EditorZone,
      path: import('../../interface/Position').ITablePositionContext[] = []
    ): boolean => {
      for (const [index, element] of elements.entries()) {
        if (this.layoutHostAdapter.matchesSource(element, location.nodeId)) {
          this.zone.setZone(zone)
          this.position.setPositionContext(
            path.length
              ? { isTable: true, ...path[path.length - 1], tablePath: path }
              : { isTable: false }
          )
          this.range.replaceRange({
            startIndex: Math.max(0, index - 1),
            endIndex: index
          })
          this.render({
            curIndex: index,
            isCompute: false,
            isSubmitHistory: false
          })
          return true
        }
        for (const [trIndex, tr] of (element.trList || []).entries()) {
          for (const [tdIndex, td] of tr.tdList.entries()) {
            if (
              visit(td.value, zone, [
                ...path,
                {
                  index,
                  trIndex,
                  tdIndex,
                  tdId: td.id,
                  trId: tr.id,
                  tableId: element.id
                }
              ])
            )
              return true
          }
        }
      }
      return false
    }
    for (const [zone, elements] of [
      [EditorZone.MAIN, this.getOriginalMainElementList()],
      [EditorZone.HEADER, this.getHeaderElementList()],
      [EditorZone.FOOTER, this.getFooterElementList()]
    ] as const)
      if (visit(elements, zone)) break
  }

  public getFontCoverageReport() {
    this.lifecycle.assertReady(true)
    return this.fontDownloadManager.decorate({
      ...this.fontCoverageTracker.getReport(),
      autoDownloadFonts: this.options.autoDownloadFonts
    })
  }

  private auxiliaryCoverageSignature = ''

  private getAuxiliaryCoverageSignature() {
    const { watermark, pageNumber, lineNumber, placeholder, ruler } =
      this.options
    return JSON.stringify([
      watermark,
      pageNumber,
      lineNumber,
      placeholder,
      ruler,
      this.i18n.getLocale(),
      this.i18n.t('pageBreak.displayName'),
      this.mode
    ])
  }

  private updateFontCoverage() {
    if (!this.layoutHostAdapter.isReady()) return
    const roots = [{ scope: 'main', elements: this.elementList }]
    if (this.getIsPagingMode()) {
      if (!this.options.header.disabled)
        roots.push({ scope: 'header', elements: this.header.getElementList() })
      if (!this.options.footer.disabled)
        roots.push({ scope: 'footer', elements: this.footer.getElementList() })
    }
    const inputs = this.layoutHostAdapter.collectFontCoverage(
      roots,
      element => {
        if (element.type === ElementType.IMAGE && element.imgCaption?.value) {
          const caption = element.imgCaption
          const defaults = this.options.imgCaption
          return [
            {
              text: this.imageParticle.getCaptionText(element),
              fontFamily: caption.font || defaults.font,
              fontSize: caption.size || defaults.size,
              color: caption.color || defaults.color
            }
          ]
        }
        const area = element.areaId
          ? this.area.getAreaInfo().get(element.areaId)
          : undefined
        if (
          area?.area?.placeholder &&
          area.elementList[0] === element &&
          area.positionList.length <= 1 &&
          !this.isPrintMode() &&
          !(area.area.hide && !this.isAreaHideDisabled())
        ) {
          const text = { ...defaultPlaceholderOption, ...area.area.placeholder }
          return [
            {
              text: text.data,
              fontFamily: text.font,
              fontSize: text.size,
              color: text.color
            }
          ]
        }
        if (
          element.type === ElementType.PAGE_BREAK &&
          this.getMode() !== EditorMode.PRINT
        ) {
          const { font, fontSize } = this.options.pageBreak
          return [
            {
              text: this.i18n.t('pageBreak.displayName'),
              fontFamily: font,
              fontSize,
              color: this.options.defaultColor
            }
          ]
        }
        return []
      }
    )
    const add = (
      kind: string,
      text: string,
      font: string,
      size: number,
      color: string
    ) => {
      inputs.push(
        ...this.layoutHostAdapter.collectPlainTextCoverage(
          {
            text,
            fontFamily: font,
            fontSize: size,
            color
          },
          { scope: `aux:${kind}`, nodeId: `aux:${kind}`, start: 0, end: 0 }
        )
      )
    }
    const { pageNumber, watermark, lineNumber, placeholder, ruler } =
      this.options
    for (let pageNo = 0; pageNo < this.getPageCount(); pageNo++) {
      if (
        this.getIsPagingMode() &&
        !pageNumber.disabled &&
        pageNo >= pageNumber.fromPageNo
      )
        add(
          'pageNumber',
          this.pageNumber.getText(pageNo),
          pageNumber.font,
          pageNumber.size,
          pageNumber.color
        )
      if (
        this.getIsPagingMode() &&
        watermark.type !== WatermarkType.IMAGE &&
        watermark.data
      )
        add(
          'watermark',
          this.waterMark.formatText(watermark.data, pageNo),
          watermark.font,
          watermark.size,
          watermark.color
        )
      if (!lineNumber.disabled) {
        for (const [index, row] of (this.pageRowList[pageNo] || []).entries())
          add(
            'lineNumber',
            String(lineNumber.type === 'page' ? index + 1 : row.rowIndex + 1),
            lineNumber.font,
            lineNumber.size,
            lineNumber.color
          )
      }
    }
    if (this.elementList.length <= 1 && !this.elementList[0]?.listId)
      add(
        'placeholder',
        placeholder.data,
        placeholder.font,
        placeholder.size,
        placeholder.color
      )
    if (!ruler.disabled && this.getIsPagingMode()) {
      const { width, height } = this.getPageSize(0)
      const count = Math.floor(
        Math.max(width, height) / ((96 / 25.4) * this.options.scale) / 10
      )
      for (let i = 1; i <= count; i++)
        add('ruler', String(i), this.options.defaultFont, 8, '#666666')
    }
    this.auxiliaryCoverageSignature = this.getAuxiliaryCoverageSignature()
    const token = this.fontCoverageTracker.begin()
    const contributions = this.options.lab?.incrementalCoverage
      ? this.layoutHostAdapter.getCoverageContributions(inputs) : undefined
    if (contributions) this.fontCoverageTracker.updateContributions(
      token, contributions, this.layoutHostAdapter.getFontManager(),
      this.options.autoDownloadFonts)
    else this.fontCoverageTracker.update(token, inputs,
      this.layoutHostAdapter.getFontManager(), this.options.autoDownloadFonts)
    const currentReport = this.fontCoverageTracker.getReport()
    this.fontDownloadManager.sync(
      currentReport,
      id => this.fontCoverageTracker.getContexts(id),
      this.isReady()
    )
    this.pendingFontCoverage = currentReport
    const { documentRevision, fontRevision } =
      this.fontCoverageTracker.getReport()
    const syncRows = (rows: LayoutRow[]) => {
      for (const row of rows) {
        for (const box of row.nativeLine?.inlines || [])
          if (box.kind === 'missingGlyph')
            box.revision = { documentRevision, fontRevision }
      }
    }
    syncRows(this.rowList)
    syncRows(this.header.getLayoutRowList())
    syncRows(this.footer.getLayoutRowList())
    const syncCells = (elements: IElement[]) => {
      for (const element of elements) {
        for (const row of element.trList || []) {
          for (const cell of row.tdList) {
            syncRows(cell.rowList || [])
            syncCells(cell.value)
          }
        }
      }
    }
    for (const root of roots) syncCells(root.elements)
    this.publishFontCoverage()
  }

  public async registerFonts(faces: IEditorFontFace[]) {
    const snapshots = mergeOption({ fonts: faces }).fonts.map(face => ({
      ...face,
      data: face.data?.slice(0) ?? null,
      scripts: [...face.scripts]
    }))
    await this.ready
    this.lifecycle.assertReady()
    const fontManager = this.layoutHostAdapter.getFontManager()
    const results = await this.layoutHostAdapter.registerFonts(snapshots)
    this.lifecycle.assertReady()
    results.forEach((result, index) => {
      if (result.status === 'registered')
        this.options.fonts.push(snapshots[index])
    })
    if (fontManager.getRevision() !== this.renderedFontRevision) {
      this.dirtyRangeTracker.markFullDirty()
      this.render({ isSetCursor: false, isSubmitHistory: false })
    }
    this.updateFontCoverage()
    return results
  }

  public getLifecycle(): EditorLifecycle {
    return this.lifecycle
  }

  public isReady(): boolean {
    return this.lifecycle.state === 'ready'
  }

  // 设置打印数据
  public setPrintData() {
    this.printModeData = {
      header: this.header.getElementList(),
      main: this.elementList,
      footer: this.footer.getElementList()
    }
    // 过滤控件辅助元素
    const clonePrintModeData = deepClone(this.printModeData)
    const editorDataKeys: (keyof Omit<IEditorData, 'graffiti'>)[] = [
      'header',
      'main',
      'footer'
    ]
    editorDataKeys.forEach(key => {
      clonePrintModeData[key] = this.control.filterAssistElement(
        clonePrintModeData[key]
      )
    })
    this.setEditorData(clonePrintModeData)
  }

  // 还原打印数据
  public clearPrintData() {
    if (this.printModeData) {
      this.setEditorData(this.printModeData)
      this.printModeData = null
    }
  }

  public getLetterReg(): RegExp {
    return this.LETTER_REG
  }

  public getMode(): EditorMode {
    return this.mode
  }

  public setMode(payload: EditorMode) {
    if (this.mode === payload) return
    // 设置打印模式
    if (payload === EditorMode.PRINT) {
      this.setPrintData()
    }
    // 取消打印模式
    if (this.mode === EditorMode.PRINT) {
      this.clearPrintData()
    }
    this.clearSideEffect()
    this.range.clearRange()
    this.mode = payload
    this.options.mode = payload
    this.fontDiagnostics.refresh()
    this.render({
      isSetCursor: false,
      isSubmitHistory: false
    })
  }

  public isReadonly() {
    if (this.area.getActiveAreaInfo()?.area?.mode) {
      return this.area.isReadonly()
    }
    switch (this.mode) {
      case EditorMode.DESIGN:
        return false
      case EditorMode.READONLY:
      case EditorMode.PRINT:
      case EditorMode.GRAFFITI:
      case EditorMode.TRACE:
        return true
      case EditorMode.FORM:
        return !this.control.getIsRangeWithinControl()
      default:
        return false
    }
  }

  public isDisabled() {
    if (!this.isReady()) return true
    if (this.mode === EditorMode.DESIGN) return false
    const { startIndex, endIndex } = this.range.getRange()
    const elementList = this.getElementList()
    // 优先判断表格单元格
    if (this.getTd()?.disabled) return true
    if (startIndex === endIndex) {
      const startElement = elementList[startIndex]
      const nextElement = elementList[startIndex + 1]
      return !!(
        (startElement?.title?.disabled &&
          nextElement?.title?.disabled &&
          startElement.titleId === nextElement.titleId) ||
        (startElement?.control?.disabled &&
          nextElement?.control?.disabled &&
          startElement.controlId === nextElement.controlId)
      )
    }
    const selectionElementList = elementList.slice(startIndex + 1, endIndex + 1)
    return selectionElementList.some(
      element => element.title?.disabled || element.control?.disabled
    )
  }

  public isDesignMode() {
    return this.mode === EditorMode.DESIGN
  }

  public isPrintMode() {
    return this.mode === EditorMode.PRINT
  }

  public isAreaHideDisabled() {
    return (
      this.isDesignMode() ||
      (this.isPrintMode() &&
        this.options.modeRule[EditorMode.PRINT].areaHideDisabled)
    )
  }

  public isGraffitiMode() {
    return this.mode === EditorMode.GRAFFITI
  }

  public isTraceMode() {
    return this.mode === EditorMode.TRACE
  }

  public setTraceEnabled(enabled: boolean) {
    // 留痕查看模式下不允许切换记录开关，避免查看态偷偷改数据
    if (this.mode === EditorMode.TRACE) return
    if (!this.options.trace.disabled === enabled) return
    this.options.trace.disabled = !enabled
    this.render({
      isSetCursor: false,
      isSubmitHistory: false
    })
  }

  public setRulerEnabled(enabled: boolean) {
    if (!this.options.ruler.disabled === enabled) return
    this.ruler.setEnabled(enabled)
    this.updateFontCoverage()
  }

  // 删除元素：trace 启用时软删除（保留在原位仅打标），否则硬删除
  public deleteElementList(
    elementList: IElement[],
    index: number,
    count: number = 1,
    options?: IMarkElementListDeletedOption
  ) {
    if (!this.options.trace.disabled) {
      // 留痕删除不移除元素但改变可见性，同样影响布局
      this.modelRevision++
      this.dirtyRangeTracker.markRangeDirty(elementList, index, count, 0)
      return this.traceParticle.markElementListDeleted(
        elementList.slice(index, index + count),
        options
      )
    } else {
      this.spliceElementList(elementList, index, count, undefined, {
        isIgnoreDeletedRule: options?.isIgnoreDeletedRule
      })
      return []
    }
  }

  public getOriginalWidth(direction = this.options.paperDirection): number {
    const { width, height } = this.options
    return direction === PaperDirection.VERTICAL ? width : height
  }

  public getOriginalHeight(direction = this.options.paperDirection): number {
    const { width, height } = this.options
    return direction === PaperDirection.VERTICAL ? height : width
  }

  public getWidth(direction = this.options.paperDirection): number {
    return Math.floor(this.getOriginalWidth(direction) * this.options.scale)
  }

  public getHeight(direction = this.options.paperDirection): number {
    return Math.floor(this.getOriginalHeight(direction) * this.options.scale)
  }

  public getMainHeight(): number {
    const pageHeight = this.getHeight()
    return pageHeight - this.getMainOuterHeight()
  }

  public getMainOuterHeight(
    pageNo?: number,
    direction?: PaperDirection
  ): number {
    const curDirection =
      direction ||
      (pageNo === undefined
        ? this.options.paperDirection
        : this.getPageDirection(pageNo))
    const margins = this.getMargins(curDirection)
    const headerExtraHeight = this.header.getExtraHeight(pageNo, curDirection)
    const footerExtraHeight = this.footer.getExtraHeight(pageNo, curDirection)
    return margins[0] + margins[2] + headerExtraHeight + footerExtraHeight
  }

  public getCanvasWidth(pageNo = -1): number {
    const page = this.getPage(pageNo)
    return page.width
  }

  public getCanvasHeight(pageNo = -1): number {
    const page = this.getPage(pageNo)
    return page.height
  }

  public getInnerWidth(direction = this.options.paperDirection): number {
    const width = this.getWidth(direction)
    const margins = this.getMargins(direction)
    return width - margins[1] - margins[3]
  }

  public getColumnLayout(direction?: PaperDirection): IColumnLayout | null {
    return this.columnManager.getLayout(direction)
  }

  public setColumnConfig(config: IColumnOption | null): void {
    if (this.options.pageMode === PageMode.CONTINUITY) return
    this.columnManager.setConfig(config)
  }

  private objectContainerWidths = new WeakMap<IElement, number>()

  public getObjectContainerWidth(element: IElement): number {
    return (
      this.objectContainerWidths.get(element) ?? this.getOriginalInnerWidth()
    )
  }

  private tableContainerWidths = new WeakMap<IElement, number>()

  /** The actual parent cell/column width, recorded during table layout. */
  public getTableContainerWidth(element: IElement): number {
    return (
      this.tableContainerWidths.get(element) ?? this.getOriginalInnerWidth()
    )
  }

  public getOriginalInnerWidth(): number {
    const width = this.getOriginalWidth()
    const margins = this.getOriginalMargins()
    return width - margins[1] - margins[3]
  }

  public getContextInnerWidth(): number {
    const positionContext = this.position.getPositionContext()
    if (positionContext.isTable) {
      const elementList = this.getOriginalElementList()
      const td = this.position.getTableTdByContext(elementList, positionContext)
      const {
        table: { tdPadding }
      } = this.options
      return td!.width! - tdPadding[1] - tdPadding[3]
    }
    // 分栏布局下按栏宽计算可用宽度（栏宽为缩放值，还原为未缩放单位）
    const columnLayout = this.getColumnLayout()
    if (columnLayout && columnLayout.count > 1) {
      return columnLayout.width / this.options.scale
    }
    return this.getOriginalInnerWidth()
  }

  public getMargins(direction = this.options.paperDirection): IMargin {
    return <IMargin>(
      this.getOriginalMargins(direction).map(m => m * this.options.scale)
    )
  }

  public getOriginalMargins(direction = this.options.paperDirection): number[] {
    const { margins } = this.options
    return direction === PaperDirection.VERTICAL
      ? margins
      : [margins[1], margins[2], margins[3], margins[0]]
  }

  public getPageDirection(pageNo: number): PaperDirection {
    return this.pageDirectionList[pageNo] || this.options.paperDirection
  }

  public getPageDirectionList(): PaperDirection[] {
    return this.pageDirectionList
  }

  public getPageSize(pageNo: number) {
    const direction = this.getPageDirection(pageNo)
    const margins = this.getMargins(direction)
    const width = this.getWidth(direction)
    return {
      width,
      height: this.getHeight(direction),
      margins,
      innerWidth: width - margins[1] - margins[3]
    }
  }

  // 获取页面容器中的偏移
  public getPageOffset(pageNo: number, isOriginal = false) {
    const getWidth = (direction: PaperDirection) =>
      isOriginal ? this.getOriginalWidth(direction) : this.getWidth(direction)
    const getHeight = (direction: PaperDirection) =>
      isOriginal ? this.getOriginalHeight(direction) : this.getHeight(direction)
    const pageGap = isOriginal ? this.options.pageGap : this.getPageGap()
    let y = 0
    for (let i = 0; i < pageNo; i++) {
      y += getHeight(this.getPageDirection(i)) + pageGap
    }
    // CSS 会居中较窄页面，浮层坐标需补偿水平偏移
    const direction = this.getPageDirection(pageNo)
    const width = getWidth(direction)
    return {
      x: (this._getPageMaxWidth(isOriginal) - width) / 2,
      y
    }
  }

  private _getPageMaxWidth(isOriginal = false) {
    const width = isOriginal ? this.getOriginalWidth() : this.getWidth()
    const isMixed = this.pageDirectionList.some(
      direction => direction !== this.options.paperDirection
    )
    if (!isMixed) return width
    const height = isOriginal ? this.getOriginalHeight() : this.getHeight()
    return Math.max(width, height)
  }

  public getPageGap(): number {
    return this.options.pageGap * this.options.scale
  }

  public getOriginalPageGap(): number {
    return this.options.pageGap
  }

  public getPageNumberBottom(): number {
    const {
      pageNumber: { bottom },
      scale
    } = this.options
    return bottom * scale
  }

  public getMarginIndicatorSize(): number {
    return this.options.marginIndicatorSize * this.options.scale
  }

  public getDefaultBasicRowMarginHeight(): number {
    return this.options.defaultBasicRowMarginHeight * this.options.scale
  }

  public getHighlightMarginHeight(): number {
    return this.options.highlightMarginHeight * this.options.scale
  }

  public getTdPadding(): IPadding {
    const {
      table: { tdPadding },
      scale
    } = this.options
    return <IPadding>tdPadding.map(m => m * scale)
  }

  public getContainer(): HTMLDivElement {
    return this.container
  }

  public getPageContainer(): HTMLDivElement {
    return this.pageContainer
  }

  public getVisiblePageNoList(): number[] {
    return this.visiblePageNoList
  }

  public setVisiblePageNoList(payload: number[]) {
    this.visiblePageNoList = payload
    if (this.listener.visiblePageNoListChange) {
      this.listener.visiblePageNoListChange(this.visiblePageNoList)
    }
    if (this.eventBus.isSubscribe('visiblePageNoListChange')) {
      this.eventBus.emit('visiblePageNoListChange', this.visiblePageNoList)
    }
  }

  public getIntersectionPageNo(): number {
    return this.intersectionPageNo
  }

  public setIntersectionPageNo(payload: number) {
    this.intersectionPageNo = payload
    if (this.listener.intersectionPageNoChange) {
      this.listener.intersectionPageNoChange(this.intersectionPageNo)
    }
    if (this.eventBus.isSubscribe('intersectionPageNoChange')) {
      this.eventBus.emit('intersectionPageNoChange', this.intersectionPageNo)
    }
  }

  public getPageNo(): number {
    return this.pageNo
  }

  public setPageNo(payload: number) {
    this.pageNo = payload
  }

  public getRenderCount(): number {
    return this.renderCount
  }

  public getPage(pageNo = -1): HTMLCanvasElement {
    return this.pageList[~pageNo ? pageNo : this.pageNo]
  }

  public getPageList(): HTMLCanvasElement[] {
    return this.pageList
  }

  public getPageCount(): number {
    return this.pageList.length
  }

  public getTableRowList(sourceElementList: IElement[]): LayoutRow[] {
    const positionContext = this.position.getPositionContext()
    return this.position.getTableTdByContext(
      sourceElementList,
      positionContext
    )!.rowList!
  }

  public getLayoutRows() {
    const zoneManager = this.getZone()
    if (zoneManager.isHeaderActive()) {
      return this.header.getLayoutRowList()
    }
    if (zoneManager.isFooterActive()) {
      return this.footer.getLayoutRowList()
    }
    return this.rowList
  }

  public getLayoutRowList(): LayoutRow[] {
    const positionContext = this.position.getPositionContext()
    return positionContext.isTable
      ? this.getTableRowList(this.getOriginalElementList())
      : this.getLayoutRows()
  }

  /** Compatibility snapshots for consumers; editor internals use native getters. */
  public snapshotRows(rows: LayoutRow[]) {
    return snapshotRows(
      rows,
      this.options.scale,
      row =>
        row.nativeLine
          ? this.layoutHostAdapter.findLayoutByElementIndex(
              row.startIndex,
              row.nativeLine.source.scope
            )?.layout
          : undefined,
      this.options
    )
  }

  public getRowList() {
    return this.snapshotRows(this.getLayoutRowList())
  }
  public getOriginalRowList() {
    return this.snapshotRows(this.getLayoutRows())
  }
  public getRawRowList() {
    return this.snapshotRows(this.rawRowList)
  }
  public getPageRowList() {
    return this.pageRowList.map(rows => this.snapshotRows(rows))
  }

  public getLayoutPages(): LayoutRow[][] {
    return this.pageRowList
  }

  public getCtx(): CanvasRenderingContext2D {
    return this.ctxList[this.pageNo]
  }

  public getOptions(): DeepRequired<IEditorOption> {
    return this.options
  }

  public getSearch(): Search {
    return this.search
  }

  public getSpellcheck(): Spellcheck {
    return this.spellcheck
  }

  public getGroup(): Group {
    return this.group
  }

  public getArea(): Area {
    return this.area
  }

  public getBadge(): Badge {
    return this.badge
  }

  public getMagnifier(): Magnifier {
    return this.magnifier
  }

  public getHistoryManager(): HistoryManager {
    return this.historyManager
  }

  public getPosition(): Position {
    return this.position
  }

  public getLayoutHostAdapter(): LayoutHostAdapter {
    return this.layoutHostAdapter
  }

  public getZone(): Zone {
    return this.zone
  }

  public getColumnManager(): ColumnManager {
    return this.columnManager
  }

  public getRange(): RangeManager {
    return this.range
  }

  public getLineBreakParticle(): LineBreakParticle {
    return this.lineBreakParticle
  }

  public getStrikeout(): Strikeout {
    return this.strikeout
  }

  public getUnderline(): Underline {
    return this.underline
  }

  public getSubscriptParticle(): SubscriptParticle {
    return this.subscriptParticle
  }

  public getSuperscriptParticle(): SuperscriptParticle {
    return this.superscriptParticle
  }

  public getHeaderElementList(): IElement[] {
    return this.header.getElementList()
  }

  public getTableElementList(sourceElementList: IElement[]): IElement[] {
    const positionContext = this.position.getPositionContext()
    return (
      this.position.getTableTdByContext(sourceElementList, positionContext)
        ?.value || []
    )
  }

  public getElementList(): IElement[] {
    const positionContext = this.position.getPositionContext()
    const elementList = this.getOriginalElementList()
    return positionContext.isTable
      ? this.getTableElementList(elementList)
      : elementList
  }

  public getMainElementList(): IElement[] {
    const positionContext = this.position.getPositionContext()
    return positionContext.isTable
      ? this.getTableElementList(this.elementList)
      : this.elementList
  }

  public getRawLayoutRows(): LayoutRow[] {
    return this.rawRowList
  }

  public getDirtyRangeTracker(): DirtyRangeTracker {
    return this.dirtyRangeTracker
  }

  public getIsElementListTruncated(): boolean {
    return this.isElementListTruncated
  }

  public getOriginalElementList() {
    const zoneManager = this.getZone()
    if (zoneManager.isHeaderActive()) {
      return this.getHeaderElementList()
    }
    if (zoneManager.isFooterActive()) {
      return this.getFooterElementList()
    }
    return this.elementList
  }

  public getOriginalMainElementList(): IElement[] {
    return this.elementList
  }

  public getFooterElementList(): IElement[] {
    return this.footer.getElementList()
  }

  public getTd(): ITd | null {
    const positionContext = this.position.getPositionContext()
    if (!positionContext.isTable) return null
    return this.position.getTableTdByContext(
      this.getOriginalElementList(),
      positionContext
    )
  }

  public insertElementList(
    payload: IElement[],
    options: IInsertElementListOption = {}
  ) {
    if (!payload.length || !this.range.getIsCanInput()) return
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return
    const { isSubmitHistory = true } = options
    formatElementList(payload, {
      isHandleFirstElement: false,
      editorOptions: this.options
    })
    this.traceParticle.markElementListInserted(payload)
    let curIndex = -1
    // 判断是否在控件内
    let activeControl = this.control.getActiveControl()
    // 光标在控件内如果当前没有被激活，需要手动激活
    if (!activeControl && this.control.getIsRangeWithinControl()) {
      this.control.initControl()
      activeControl = this.control.getActiveControl()
    }
    if (activeControl && this.control.getIsRangeWithinControl()) {
      curIndex = activeControl.setValue(payload, undefined, {
        isIgnoreDisabledRule: true
      })
      this.control.emitControlContentChange()
    } else {
      const elementList = this.getElementList()
      const isCollapsed = startIndex === endIndex
      const start = startIndex + 1
      if (!isCollapsed) {
        this.deleteElementList(elementList, start, endIndex - startIndex)
      }
      this.spliceElementList(elementList, start, 0, payload)
      curIndex = startIndex + payload.length
      // 列表前如有换行符则删除-因为列表内已存在
      const preElement = elementList[start - 1]
      if (
        payload[0].listId &&
        preElement &&
        !preElement.listId &&
        preElement?.value === ZERO &&
        (!preElement.type || preElement.type === ElementType.TEXT)
      ) {
        elementList.splice(startIndex, 1)
        this.dirtyRangeTracker.markRangeDirty(elementList, startIndex, 1, 0)
        curIndex -= 1
      }
    }
    if (~curIndex) {
      this.range.setRange(curIndex, curIndex)
      this.render({
        curIndex,
        isSubmitHistory
      })
    }
  }

  public appendElementList(
    elementList: IElement[],
    options: IAppendElementListOption = {}
  ) {
    if (!elementList.length) return
    formatElementList(elementList, {
      isHandleFirstElement: false,
      editorOptions: this.options
    })
    this.traceParticle.markElementListInserted(elementList)
    let curIndex: number
    const { isPrepend, isSubmitHistory = true } = options
    if (isPrepend) {
      this.elementList.splice(1, 0, ...elementList)
      this.dirtyRangeTracker.markRangeDirty(
        this.elementList,
        1,
        0,
        elementList.length
      )
      curIndex = elementList.length
    } else {
      const appendStart = this.elementList.length
      this.elementList.push(...elementList)
      this.dirtyRangeTracker.markRangeDirty(
        this.elementList,
        appendStart,
        0,
        elementList.length
      )
      curIndex = this.elementList.length - 1
    }
    this.range.setRange(curIndex, curIndex)
    this.render({
      curIndex,
      isSubmitHistory
    })
  }

  // 原地修改元素字段的唯一入口（支持多元素、多字段）：
  // 任一值发生变化时自动标记下次渲染全量计算，调用方无需关心脏区间
  public setElementProperty(
    elementList: IElement | IElement[],
    properties: Partial<IElement>
  ) {
    const list = Array.isArray(elementList) ? elementList : [elementList]
    const keys = Object.keys(properties) as (keyof IElement)[]
    for (const element of list) {
      for (const key of keys) {
        const value = properties[key]
        if (element[key] !== value) {
          this.changeAttribute(element, key, true, value)
        }
      }
    }
  }

  // 原地删除元素字段（同 setElementProperty，支持多元素、多字段）
  public deleteElementProperty(
    elementList: IElement | IElement[],
    keys: (keyof IElement)[]
  ) {
    const list = Array.isArray(elementList) ? elementList : [elementList]
    for (const element of list) {
      for (const key of keys) {
        if (key in element) {
          this.changeAttribute(element, key, false)
        }
      }
    }
  }

  public spliceElementList(
    elementList: IElement[],
    start: number,
    deleteCount: number,
    items?: IElement[],
    options?: ISpliceElementListOption
  ) {
    if (start < 0) {
      this.promoteSnapshotEdit()
      this.layoutHostAdapter.clearParagraphCache()
    }
    const finishParagraphs = this.options.lab?.incrementalEditing && start >= 0
      ? this.layoutHostAdapter.paragraphs.get(elementList).capture(start, deleteCount)
      : undefined
    this.modelRevision++
    this.markTrackedRange(
      elementList,
      start,
      deleteCount,
      items?.length ?? 0
    )
    const { isIgnoreDeletedRule = false } = options || {}
    const { group, modeRule } = this.options
    if (deleteCount > 0) {
      // 当最后元素与开始元素列表信息不一致时：清除当前列表信息
      const endIndex = start + deleteCount
      const endElement = elementList[endIndex]
      const endElementListId = endElement?.listId
      if (
        endElementListId &&
        elementList[start - 1]?.listId !== endElementListId
      ) {
        let startIndex = endIndex
        while (startIndex < elementList.length) {
          const curElement = elementList[startIndex]
          if (
            curElement.listId !== endElementListId ||
            curElement.value === ZERO
          ) {
            break
          }
          // 此处的清理区间已由下方 markRangeDirty 精确覆盖，
          // 不走访问器（避免退化为整页全量计算）
          this.deleteElementProperty(curElement, ['listId', 'listType', 'listStyle'])
          startIndex++
        }
        // 列表信息清理改写了主删除区间之外的元素，扩展脏区间覆盖，
        // 防止增量续算复用到丢失列表缩进/序号的陈旧行
        if (startIndex > endIndex) {
          this.dirtyRangeTracker.markRangeDirty(
            elementList,
            endIndex,
            startIndex - endIndex,
            0
          )
        }
      }
      // 非明确忽略删除规则 && 非设计模式 && 非光标在控件内(控件内控制) =》 校验删除规则
      if (
        !isIgnoreDeletedRule &&
        !this.isDesignMode() &&
        !this.control.getIsRangeWithinControl()
      ) {
        const tdDeletable = this.getTd()?.deletable
        let deleteIndex = endIndex - 1
        while (deleteIndex >= start) {
          const deleteElement = elementList[deleteIndex]
          // 删除痕迹不可移除
          if (
            deleteElement?.trace?.length &&
            deleteElement.trace[deleteElement.trace.length - 1].type ===
              TraceType.DELETED
          ) {
            deleteIndex--
            continue
          }
          if (
            deleteElement?.hide ||
            deleteElement?.control?.hide ||
            deleteElement?.area?.hide ||
            (tdDeletable !== false &&
              deleteElement?.control?.deletable !== false &&
              (!deleteElement.controlId ||
                this.mode !== EditorMode.FORM ||
                !modeRule[this.mode].controlDeletableDisabled) &&
              deleteElement?.title?.deletable !== false &&
              (group.deletable !== false || !deleteElement.groupIds?.length) &&
              (deleteElement?.area?.deletable !== false ||
                deleteElement?.areaIndex !== 0))
          ) {
            this.performElementSplice(elementList, deleteIndex, 1)
          }
          deleteIndex--
        }
      } else {
        // 留痕删除记录不可移除
        let deleteIndex = endIndex - 1
        while (deleteIndex >= start) {
          const deleteElement = elementList[deleteIndex]
          if (
            !deleteElement?.trace?.length ||
            deleteElement.trace[deleteElement.trace.length - 1].type !==
              TraceType.DELETED
          ) {
            this.performElementSplice(elementList, deleteIndex, 1)
          }
          deleteIndex--
        }
      }
    }
    // 循环添加，避免使用解构影响性能
    if (items?.length) {
      this.performElementInsert(elementList, start, items)
    }
    finishParagraphs?.()
  }

  public getCanvasEvent(): CanvasEvent {
    return this.canvasEvent
  }

  public getGlobalEvent(): GlobalEvent {
    return this.globalEvent
  }

  public getListener(): Listener {
    return this.listener
  }

  public getEventBus(): EventBus<EventBusMap> {
    return this.eventBus
  }

  public getOverride(): Override {
    return this.override
  }

  public getCursor(): Cursor {
    return this.cursor
  }

  public getPreviewer(): Previewer {
    return this.previewer
  }

  public getImageParticle(): ImageParticle {
    return this.imageParticle
  }

  public getTableTool(): TableTool {
    return this.tableTool
  }

  public getRuler(): Ruler {
    return this.ruler
  }

  public getTableOperate(): TableOperate {
    return this.tableOperate
  }

  public getTableParticle(): TableParticle {
    return this.tableParticle
  }

  public getBlockParticle(): BlockParticle {
    return this.blockParticle
  }

  public getHeader(): Header {
    return this.header
  }

  public getFooter(): Footer {
    return this.footer
  }

  public getHyperlinkParticle(): HyperlinkParticle {
    return this.hyperlinkParticle
  }

  public getHintParticle(): HintParticle {
    return this.hintParticle
  }

  public getTraceParticle(): TraceParticle {
    return this.traceParticle
  }

  public getDateParticle(): DateParticle {
    return this.dateParticle
  }

  public getListParticle(): ListParticle {
    return this.listParticle
  }

  public getCheckboxParticle(): CheckboxParticle {
    return this.checkboxParticle
  }

  public getRadioParticle(): RadioParticle {
    return this.radioParticle
  }

  public getControl(): Control {
    return this.control
  }

  public getCascadeManager(): CascadeManager {
    return this.cascadeManager
  }

  public getValidate(): Validate {
    return this.validate
  }

  public getWorkerManager(): WorkerManager {
    return this.workerManager
  }

  public getImageObserver(): ImageObserver {
    return this.imageObserver
  }

  public getI18n(): I18n {
    return this.i18n
  }

  public getGraffiti(): Graffiti {
    return this.graffiti
  }

  public getAccessibility(): Accessibility {
    return this.accessibility
  }

  public getRowCount(): number {
    return this.getLayoutRowList().length
  }

  public async getDataURL(payload: IGetImageOption = {}): Promise<string[]> {
    const { pixelRatio, mode, snapDomFunction } = payload
    // 放大像素比
    if (pixelRatio) {
      this.setPagePixelRatio(pixelRatio)
    }
    // 不同模式
    const currentMode = this.mode
    const isSwitchMode = !!mode && currentMode !== mode
    if (isSwitchMode) {
      this.setMode(mode)
    }
    this.render({
      isLazy: false,
      isCompute: false,
      isSetCursor: false,
      isSubmitHistory: false
    })
    await this.imageObserver.allSettled()
    // 叠加iframe图片
    if (snapDomFunction) {
      await this.blockParticle.drawIframeToPage(this.pageList, snapDomFunction)
    }
    const dataUrlList = this.pageList.map(c => c.toDataURL())
    // 还原
    if (pixelRatio) {
      this.setPagePixelRatio(null)
    }
    if (isSwitchMode) {
      this.setMode(currentMode)
    }
    return dataUrlList
  }

  public getPainterStyle(): IElementStyle | null {
    return this.painterStyle && Object.keys(this.painterStyle).length
      ? this.painterStyle
      : null
  }

  public getPainterOptions(): IPainterOption | null {
    return this.painterOptions
  }

  public setPainterStyle(
    payload: IElementStyle | null,
    options?: IPainterOption
  ) {
    this.painterStyle = payload
    this.painterOptions = options || null
    if (this.getPainterStyle()) {
      this.pageList.forEach(c => (c.style.cursor = 'copy'))
    }
  }

  public setDefaultRange() {
    if (!this.elementList.length) return
    setTimeout(() => {
      if (!this.isReady()) return
      const curIndex = this.elementList.length - 1
      this.range.setRange(curIndex, curIndex)
      this.range.setRangeStyle()
    })
  }

  public getIsPagingMode(): boolean {
    return this.options.pageMode === PageMode.PAGING
  }

  public setPageMode(payload: PageMode) {
    if (!payload || this.options.pageMode === payload) return
    this.options.pageMode = payload
    // 纸张大小重置
    if (payload === PageMode.PAGING) {
      const height = this.getHeight()
      const dpr = this.getPagePixelRatio()
      const canvas = this.pageList[0]
      canvas.style.height = `${height}px`
      canvas.height = height * dpr
      // canvas尺寸发生变化，上下文被重置
      this._initPageContext(this.ctxList[0])
    } else {
      // 连页模式：移除懒加载监听&清空页眉页脚计算数据
      this._disconnectLazyRender()
      this.header.recovery()
      this.footer.recovery()
      this.zone.setZone(EditorZone.MAIN)
    }
    const { startIndex } = this.range.getRange()
    const isCollapsed = this.range.getIsCollapsed()
    this.render({
      isSetCursor: true,
      curIndex: startIndex,
      isSubmitHistory: false
    })
    // 重新定位避免事件监听丢失
    if (!isCollapsed) {
      this.cursor.drawCursor({
        isShow: false
      })
    }
    // 回调
    setTimeout(() => {
      if (!this.isReady()) return
      if (this.listener.pageModeChange) {
        this.listener.pageModeChange(payload)
      }
      if (this.eventBus.isSubscribe('pageModeChange')) {
        this.eventBus.emit('pageModeChange', payload)
      }
    })
  }

  public setPageScale(payload: number) {
    this.options.scale = payload
    this._updatePageSizes()
    const cursorPosition = this.position.getCursorPosition()
    this.render({
      isSubmitHistory: false,
      isSetCursor: !!cursorPosition,
      curIndex: cursorPosition?.index
    })
    if (this.listener.pageScaleChange) {
      this.listener.pageScaleChange(payload)
    }
    if (this.eventBus.isSubscribe('pageScaleChange')) {
      this.eventBus.emit('pageScaleChange', payload)
    }
  }

  public getPagePixelRatio(): number {
    return this.pagePixelRatio || window.devicePixelRatio
  }

  public setPagePixelRatio(payload: number | null) {
    if (
      (!this.pagePixelRatio && payload === window.devicePixelRatio) ||
      payload === this.pagePixelRatio
    ) {
      return
    }
    this.pagePixelRatio = payload
    this.setPageDevicePixel()
  }

  public setPageDevicePixel() {
    this._updatePageSizes()
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  public setPaperSize(width: number, height: number) {
    this.options.width = width
    this.options.height = height
    this._updatePageSizes()
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  public setPaperDirection(payload: PaperDirection) {
    this.options.paperDirection = payload
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  // 设置光标所在节的纸张方向，首节修改全局方向
  public setPageDirection(payload: PaperDirection | null) {
    if (
      this.isReadonly() ||
      this.isDisabled() ||
      this.zone.getZone() !== EditorZone.MAIN
    ) {
      return
    }
    const { endIndex } = this.range.getRange()
    let pageBreakElement: IElement | null = null
    for (let i = endIndex; i >= 0; i--) {
      if (this.elementList[i].type === ElementType.PAGE_BREAK) {
        pageBreakElement = this.elementList[i]
        break
      }
    }
    if (!pageBreakElement) {
      if (payload) {
        this.setPaperDirection(payload)
      }
      return
    }
    if (payload) {
      pageBreakElement.paperDirection = payload
    } else {
      delete pageBreakElement.paperDirection
    }
    this.render({ curIndex: endIndex })
  }

  public setPaperMargin(payload: IMargin) {
    this.options.margins = payload
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  public getOriginValue(
    options: IGetOriginValueOption = {}
  ): Required<IEditorData> {
    const { pageNo } = options
    let mainElementList = this.elementList
    if (
      Number.isInteger(pageNo) &&
      pageNo! >= 0 &&
      pageNo! < this.pageRowList.length
    ) {
      const indices = new Set(
        this.pageRowList[pageNo!].flatMap(row =>
          row.elementList.map((_, offset) => rowSourceIndex(row, offset))
        )
      )
      mainElementList = [...indices]
        .sort((a, b) => a - b)
        .map(index => this.elementList[index])
        .filter(Boolean)
    }
    // 同步block的最新数据
    this.blockParticle.update()
    const data: Required<IEditorData> = {
      header: this.getHeaderElementList(),
      main: mainElementList,
      footer: this.getFooterElementList(),
      graffiti: this.graffiti.getValue()
    }
    return data
  }

  public getValue(options: IGetValueOption = {}): IEditorResult {
    const originData = this.getOriginValue(options)
    const { extraPickAttrs } = options
    const data: IEditorData = {
      header: zipElementList(originData.header, {
        extraPickAttrs
      }),
      main: zipElementList(originData.main, {
        extraPickAttrs,
        isClassifyArea: true
      }),
      footer: zipElementList(originData.footer, {
        extraPickAttrs
      }),
      graffiti: originData.graffiti
    }
    return {
      version,
      data,
      options: deepClone(this.options)
    }
  }

  public setValue(payload: Partial<IEditorData>, options?: ISetValueOption) {
    const { header, main, footer } = deepClone(payload)
    if (!header && !main && !footer) return
    const { isSetCursor = false } = options || {}
    const pageComponentData = [header, main, footer]
    pageComponentData.forEach(data => {
      if (!data) return
      formatElementList(data, {
        editorOptions: this.options,
        isForceCompensation: true
      })
    })
    this.setEditorData({
      header,
      main,
      footer
    })
    // 渲染&计算&清空历史记录
    this.historyManager.recovery()
    const curIndex = isSetCursor
      ? main?.length
        ? main.length - 1
        : 0
      : undefined
    if (curIndex !== undefined) {
      this.range.setRange(curIndex, curIndex)
    }
    this.render({
      curIndex,
      isSetCursor,
      isFirstRender: true
    })
    // 数据替换后级联规则全量重算
    this.cascadeManager.executeAll()
    // API callers can edit a selection before focusing a collapsed caret.
    // Preserve the replaced document as the baseline for that first undo.
    if (this.historyManager.isStackEmpty()) this.submitHistory(curIndex)
  }

  public setEditorData(payload: Partial<Omit<IEditorData, 'graffiti'>>) {
    const { header, main, footer } = payload
    if (header) {
      this.header.setElementList(header)
    }
    if (main) {
      this.elementList = main
    }
    if (footer) {
      this.footer.setElementList(footer)
    }
  }

  private _wrapContainer(rootContainer: HTMLElement): HTMLDivElement {
    const container = document.createElement('div')
    rootContainer.append(container)
    return container
  }

  private _formatContainer() {
    // 容器宽度需跟随纸张宽度
    this.container.style.position = 'relative'
    this.container.style.width = `${this.getWidth()}px`
    this.container.setAttribute(EDITOR_COMPONENT, EditorComponent.MAIN)
    this.syncUiDirection()
  }

  /**
   * Sync LTR/RTL mode class for chrome that opts in via CSS.
   * 不得给画布容器设 dir=rtl：绝对定位光标（left+right）在 RTL 包含块下会忽略 left，
   * 导致光标绘制/碰撞与正文物理坐标错位。正文命中只认 canvas 坐标。
   */
  public syncUiDirection() {
    const isRtl = this.options.direction === TextDirection.RTL
    this.container.removeAttribute('dir')
    this.container.classList.toggle(`${EDITOR_PREFIX}-ui-rtl`, isRtl)
    // 标尺是壳层 chrome，切换方向后需立即按新方向镜像重绘
    // （构造期 _formatContainer 早于 ruler 初始化，用可选链跳过）
    this.ruler?.refresh()
    this.fontDiagnostics?.refresh()
  }

  private _createPageContainer(): HTMLDivElement {
    const pageContainer = document.createElement('div')
    pageContainer.classList.add(`${EDITOR_PREFIX}-page-container`)
    // 锁定物理方向，避免祖先 dir 影响页内绝对定位与点击坐标
    pageContainer.setAttribute('dir', 'ltr')
    this.container.append(pageContainer)
    return pageContainer
  }

  private _createPage(pageNo: number) {
    const { width, height } = this.getPageSize(pageNo)
    const canvas = document.createElement('canvas')
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.style.display = 'block'
    canvas.style.backgroundColor = '#ffffff'
    // 混排横竖版时各页宽度可能不同，页 canvas 水平居中
    canvas.style.marginLeft = 'auto'
    canvas.style.marginRight = 'auto'
    canvas.style.marginBottom = `${this.getPageGap()}px`
    canvas.setAttribute('data-index', String(pageNo))
    this.pageContainer.append(canvas)
    // 调整分辨率
    const dpr = this.getPagePixelRatio()
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.cursor = 'text'
    const ctx = canvas.getContext('2d')!
    // 初始化上下文配置
    this._initPageContext(ctx)
    // 缓存上下文
    this.pageList.push(canvas)
    this.ctxList.push(ctx)
  }

  // 按各页实际尺寸（方向/缩放/DPR）校正页面 canvas 与容器宽度
  private _updatePageSizes() {
    const dpr = this.getPagePixelRatio()
    const isPagingMode = this.getIsPagingMode()
    this.container.style.width = `${this._getPageMaxWidth()}px`
    this.pageList.forEach((p, i) => {
      const { width, height } = this.getPageSize(i)
      p.style.width = `${width}px`
      p.style.marginBottom = `${this.getPageGap()}px`
      // 连续页模式高度由内容撑开（_computePageList 已按需调整），仅校正宽度
      if (isPagingMode) {
        p.style.height = `${height}px`
      }
      const canvasHeight = isPagingMode
        ? height
        : Number.parseFloat(p.style.height) || height
      const pixelWidth = Math.floor(width * dpr)
      const pixelHeight = Math.floor(canvasHeight * dpr)
      const isSizeChanged = p.width !== pixelWidth || p.height !== pixelHeight
      if (isSizeChanged) {
        p.width = pixelWidth
        p.height = pixelHeight
        this._initPageContext(this.ctxList[i])
      }
    })
  }

  private _initPageContext(ctx: CanvasRenderingContext2D) {
    const dpr = this.getPagePixelRatio()
    ctx.scale(dpr, dpr)
    // 重置以下属性是因部分浏览器(chrome)会应用css样式
    ctx.letterSpacing = '0px'
    ctx.wordSpacing = '0px'
    ctx.direction = 'ltr'
  }

  public getElementFont(el: IElement, scale = 1): string {
    const { defaultSize, defaultFont } = this.options
    const font = el.font || defaultFont
    const size = el.actualSize || el.size || defaultSize
    return `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${
      size * scale
    }px ${font}`
  }

  public getElementSize(el: IElement) {
    return el.actualSize || el.size || this.options.defaultSize
  }

  public getElementRowMargin(el: IElement) {
    return resolveRowMargin(el, this.options)
  }

  private getRowElementPosition(
    row: LayoutRow,
    positionList: import('../../interface/Element').IElementPosition[],
    _element: IElement,
    elementOffset: number
  ) {
    if (row.fragmentPosition) return row.fragmentPosition
    const sourceIndex = rowSourceIndex(row, elementOffset)
    const fallbackIndex = sourceIndex
    return (
      (sourceIndex !== undefined ? positionList[sourceIndex] : undefined) ||
      positionList[fallbackIndex] ||
      (sourceIndex !== undefined
        ? positionList.find(item => item?.index === sourceIndex)
        : undefined)
    )
  }

  /**
   * 弹层（超链接/下拉/日期/计算器）DOM 定位样式。
   * RTL（bidiLevel 为奇）时右对齐元素右缘，LTR 时左对齐元素左缘，
   * 与书写方向镜像；top 统一在元素基线下方。
   */
  public getPopupPositionStyle(
    position: import('../../interface/Element').IElementPosition,
    topOffset = 0,
    direction?: 'ltr' | 'rtl'
  ): { left?: number; right?: number; top: number } {
    const {
      coordinate: { leftTop, rightTop },
      lineHeight,
      pageNo,
      bidiLevel
    } = position
    const isRtl = direction ? direction === 'rtl' : ((bidiLevel ?? 0) & 1) === 1
    // 混合纸张方向：按页累计实际高度/宽度偏移（统一纸张时退化为 pageNo*(h+gap)）
    const currentPageNo = pageNo ?? this.getPageNo()
    const { x: pageLeft, y: preY } = this.getPageOffset(currentPageNo)
    const top = leftTop[1] + preY + lineHeight + topOffset
    if (isRtl) {
      const containerWidth = this._getPageMaxWidth()
      const right = containerWidth - pageLeft - rightTop[0]
      return { right, top }
    }
    return { left: leftTop[0] + pageLeft, top }
  }

  private getEngineHighlightRect(
    row: LayoutRow,
    _element: IElement,
    position: import('../../interface/Element').IElementPosition,
    positions = this.position.getPositionList(),
    pageNo = position.pageNo
  ): { x: number; width: number } | undefined {
    const placed = this.position.getNativeRow(row, positions, pageNo)
    if (!placed) return
    const rects = textRangeRects(placed, position.index, position.index + 1)
    if (!rects.length) return
    const x = Math.min(...rects.map(rect => rect.x))
    return { x, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x }
  }

  /**
   * Resolve a text-engine element to its visual highlight rectangle.
   * Search results use source indexes, while engine rows may reorder those
   * elements visually for bidi layout.
   */
  public getEngineHighlightRectByIndex(
    sourceIndex: number,
    position: import('../../interface/Element').IElementPosition,
    rowList: LayoutRow[] = this.getLayoutRows(),
    positions = this.position.getPositionList()
  ): { x: number; width: number } | undefined {
    for (const row of rowList) {
      if (!row.nativeLine || !row.sourceIndices?.includes(sourceIndex)) continue
      return this.getEngineHighlightRect(
        row,
        row.elementList[0],
        position,
        positions
      )
    }
    return
  }

  /**
   * GlyphRenderer 按整行绘制：跳过留痕软删与 hide（遵循 hide / 留痕规则）。
   * hide 须先在 ElementBridge 中零宽占位，再在此跳过绘制，避免只滤 paint 留下空白洞。
   */
  private isGlyphPaintSkipped(element: IElement | undefined): boolean {
    if (!element || this.isDesignMode()) return false
    return (
      !!element.hide ||
      !!element.control?.hide ||
      (!!element.area?.hide && !this.isAreaHideDisabled()) ||
      this.traceParticle.isTraceHidden(element)
    )
  }

  /** Paragraph list indent (marker width + nested level), same as legacy offsetX. */
  private _getEngineParagraphListOffset(
    paragraph: ParagraphSpan,
    elementList: IElement[],
    listStyleMap: Map<string, number>
  ): number {
    const { scale } = this.options
    const anchor = elementList[paragraph.startIndex]?.listId
      ? elementList[paragraph.startIndex]
      : elementList[paragraph.startIndex + 1]
    if (!anchor?.listId) return 0
    return resolveListOffset(
      anchor,
      listStyleMap.get(anchor.listId) || 0,
      this.listParticle.LIST_INDENT_WIDTH,
      scale
    )
  }

  /**
   * text-engine 行补齐列表元数据（isList/offsetX/listIndex），
   * 否则工具栏 setList 虽写入 listId，却不缩进、不绘项目符号。
   */
  private _applyEngineListMetaToRows(
    rows: LayoutRow[],
    listStyleMap: Map<string, number>,
    listIndexMap: Map<string, number>
  ) {
    const { scale } = this.options
    for (const row of rows) {
      const listAnchor =
        row.elementList.find(el => el.listId && el.value === ZERO) ||
        row.elementList.find(el => !!el.listId)
      if (!listAnchor?.listId) continue
      const listId = listAnchor.listId
      if (listAnchor.value === ZERO && !listAnchor.listWrap) {
        if (listIndexMap.has(listId)) {
          listIndexMap.set(listId, (listIndexMap.get(listId) ?? 0) + 1)
        } else {
          listIndexMap.set(listId, 0)
        }
      }
      const listOffset = resolveListOffset(
        listAnchor,
        listStyleMap.get(listId) || 0,
        this.listParticle.LIST_INDENT_WIDTH,
        scale
      )
      row.isList = true
      // RTL：左侧不再套 offsetX，gutter 留在内容区右侧（布局宽已减 listOffset）
      const isRtl =
        row.direction === 'rtl' || listAnchor.direction === TextDirection.RTL
      row.offsetX = isRtl
        ? 0
        : row.flow?.indent != null
          ? row.flow.indent * scale
          : listOffset
      row.listIndex = listIndexMap.get(listId) ?? 0
    }
  }

  private _appendParagraphEngineRows(
    rowList: LayoutRow[],
    paragraph: ParagraphSpan,
    elementList: IElement[],
    width: number,
    rowIndex: number,
    layoutScope: string,
    defaultAlign?: 'left' | 'right',
    nativeNodes?: LayoutNode[],
    nativeY = 0,
    nativeX = 0,
    markerGutter?: number
  ): number {
    const rows = this.layoutHostAdapter.layoutParagraphRows(
      paragraph,
      elementList,
      width,
      rowIndex,
      layoutScope,
      defaultAlign,
      nativeNodes
        ? result =>
            nativeNodes.push(...translateLayout(result.lines, nativeX, nativeY))
        : undefined,
      markerGutter
    )
    for (const row of rows) {
      row.rowIndex = rowIndex++
      rowList.push(row)
    }
    return rowIndex
  }

  private _computeRowListByTextEngine(
    elementList: IElement[],
    width: number,
    layoutScope: string,
    defaultDirection?: TextDirection,
    defaultAlign?: 'left' | 'right',
    startIndex = 0,
    endIndex = elementList.length,
    startRowIndex = 0,
    nativeNodes?: LayoutNode[],
    inheritedAreaId?: string,
    flow?: DocumentFlow
  ): LayoutRow[] {
    const paragraphs = this.layoutHostAdapter.scanParagraphs(
      elementList,
      defaultDirection,
      startIndex,
      endIndex
    )
    const paraByStart = new Map(paragraphs.map(p => [p.startIndex, p] as const))
    const listStyleMap = this.listParticle.computeNativeListStyle(elementList)
    const listIndexMap: Map<string, number> = new Map()
    const rowList: LayoutRow[] = []
    let rowIndex = startRowIndex
    const scopeNodes: LayoutNode[] = []
    let nativeY = 0
    const scale = this.options.scale
    let i = startIndex
    while (i < endIndex) {
      const el = elementList[i]
      if (flow)
        width = flow.page(flow.state.pageNo, flow.state.direction).width * scale
      const startY = nativeY
      const startRow = rowList.length
      const hidden = isElementLayoutHidden(el, {
        isDesignMode: this.isDesignMode(),
        isAreaHideDisabled: this.isAreaHideDisabled(),
        isTraceHidden: element => this.traceParticle.isTraceHidden(element)
      })
      const areaTop =
        !hidden &&
        el.areaId &&
        el.areaId !== inheritedAreaId &&
        el.areaId !== elementList[i - 1]?.areaId
          ? Math.max(0, el.area?.top || 0) * scale
          : 0
      nativeY += areaTop / scale
      const finish = () => {
        if (!flow && rowList.length > startRow && areaTop)
          rowList[startRow].offsetY = (rowList[startRow].offsetY || 0) + areaTop
        nativeY = startY + getHostRowsHeight(rowList.slice(startRow)) / scale
      }
      if (
        el.type === ElementType.SEPARATOR ||
        el.type === ElementType.PAGE_BREAK ||
        el.type === ElementType.BLOCK ||
        ((el.type === ElementType.IMAGE || el.type === ElementType.LATEX) &&
          isFloatingImage(el.imgDisplay))
      ) {
        this.objectContainerWidths.set(el, width / scale)
        const object = layoutHostObject({
          element: el,
          source: {
            scope: layoutScope,
            nodeId: el.id || layoutScope + ':object:' + i,
            start: i,
            end: i + 1
          },
          revision: {
            documentRevision: this.layoutHostAdapter.getRevision(),
            fontRevision: this.layoutHostAdapter.getFontManager().getRevision()
          },
          options: this.options,
          availableWidth: width,
          margin: this.getElementRowMargin(el),
          rowIndex: rowIndex++,
          hidden
        })
        if (flow) {
          const placement = flow.place(
            object.row.height / scale,
            (object.row.offsetY || 0) / scale + areaTop / scale,
            0,
            0,
            false,
            object.row.width / scale
          )
          object.row.flow = placement
          object.row.columnIndex =
            layoutScope === 'main' ? placement.columnIndex : undefined
          object.row.offsetX = placement.x * scale
          object.row.isSurround = placement.x !== 0
          object.row.offsetY = (object.row.offsetY || 0) + areaTop
          const page = flow.page(placement.pageNo, placement.direction)
          const node = translateLayout(
            [object.node],
            page.left + page.columns[placement.columnIndex] + placement.x,
            placement.y + (object.row.offsetY || 0) / scale
          )[0]
          node.placement = {
            pageNo: placement.pageNo,
            columnIndex: placement.columnIndex
          }
          scopeNodes.push(node)
          if (object.row.isPageBreak && flow.paged && layoutScope === 'main')
            flow.advance(
              object.row.paperDirection || this.options.paperDirection
            )
        } else scopeNodes.push(...translateLayout([object.node], 0, nativeY))
        rowList.push(object.row)
        finish()
        i++
        continue
      }
      if (el.type === ElementType.TABLE) {
        if (flow) {
          flow.clearExclusions()
          width =
            flow.page(flow.state.pageNo, flow.state.direction).width * scale
        }
        this.tableContainerWidths.set(el, width / scale)
        const table = layoutHostTable(
          {
            element: el,
            source: {
              scope: layoutScope,
              nodeId: el.id || layoutScope + ':table:' + i,
              start: i,
              end: i + 1
            },
            revision: {
              documentRevision: this.layoutHostAdapter.getRevision(),
              fontRevision: this.layoutHostAdapter
                .getFontManager()
                .getRevision()
            },
            options: this.options,
            availableWidth: width,
            rowMargin: this.getElementRowMargin(el),
            rowIndex: rowIndex++,
            nextIsTable: elementList[i + 1]?.type === ElementType.TABLE,
            hidden: isElementLayoutHidden(el, {
              isDesignMode: this.isDesignMode(),
              isAreaHideDisabled: this.isAreaHideDisabled(),
              isTraceHidden: element =>
                this.traceParticle.isTraceHidden(element)
            })
          },
          (elements, innerWidth, scope, direction, align) => {
            const nodes: LayoutNode[] = []
            const rows = this.computeRowList({
              elementList: elements,
              innerWidth,
              isFromTable: true,
              layoutScope: scope,
              defaultDirection: direction,
              defaultAlign: align,
              nativeNodes: nodes,
              inheritedAreaId: el.areaId
            })
            return { rows, nodes }
          }
        )
        this._applyEngineListMetaToRows([table.row], listStyleMap, listIndexMap)
        if (flow) {
          table.row.offsetY = (table.row.offsetY || 0) + areaTop
          if (!flow.paged)
            table.row.flow = flow.place(
              table.row.height / scale,
              (table.row.offsetY || 0) / scale
            )
          const fragments = flow.paged
            ? this.tablePaging.splitTableRowAcrossPages([table.row], flow)
            : [table.row]
          for (const row of fragments) {
            row.rowIndex = rowIndex - 1 + fragments.indexOf(row)
            rowList.push(row)
            const placement = row.flow!
            const page = flow.page(placement.pageNo, placement.direction)
            const fragment = row.tableFragment
            const window = fragment
              ? sliceTableFragment(table.fragment, {
                  startRow: fragment.startTrIndex,
                  endRow: fragment.endTrIndex,
                  startOffset: fragment.startSplitTrOffset || 0,
                  endOffset: fragment.endSplitTrHeight ?? null,
                  repeatedRows: fragment.repeatTrIndexes || [],
                  heights: el.trList!.map(row => row.height!),
                  height: rowElementMetrics(row, 0, scale).height / scale
                })
              : table.fragment
            row.node = window
            const node = translateLayout(
              [window],
              page.left + page.columns[placement.columnIndex],
              placement.y + (row.offsetY || 0) / scale
            )[0] as typeof table.fragment
            node.placement = {
              pageNo: placement.pageNo,
              columnIndex: placement.columnIndex
            }
            node.pageNo = placement.pageNo
            if (fragment) {
              node.id += ':fragment:' + fragments.indexOf(row)
              node.startRow = fragment.startTrIndex
              node.endRow = fragment.endTrIndex
              node.startRowOffset = fragment.startSplitTrOffset || 0
              node.endRowOffset = fragment.endSplitTrHeight ?? null
              node.repeatedRows = fragment.repeatTrIndexes || []
              node.rect.height = rowElementMetrics(row, 0, scale).height / scale
            }
            scopeNodes.push(node)
          }
          rowIndex += fragments.length - 1
        } else {
          rowList.push(table.row)
          scopeNodes.push(...translateLayout([table.fragment], 0, nativeY))
        }
        finish()
        i++
        continue
      }
      const paragraph = paraByStart.get(i)
      if (paragraph) {
        const listOffset = this._getEngineParagraphListOffset(
          paragraph,
          elementList,
          listStyleMap
        )
        const paraRowStart = rowList.length
        if (flow) {
          const result = layoutFlowParagraph({
            adapter: this.layoutHostAdapter,
            flow,
            paragraph,
            elements: elementList,
            scope: layoutScope,
            scale,
            rowIndex,
            listOffset: listOffset / scale,
            markerGutter:
              (listStyleMap.get(
                elementList[paragraph.startIndex]?.listId || ''
              ) || 0) / scale,
            areaTop: areaTop / scale,
            defaultFont: this.options.defaultFont,
            defaultSize: this.options.defaultSize,
            defaultAlign
          })
          rowList.push(...result.rows)
          scopeNodes.push(...result.nodes)
          rowIndex += result.rows.length
        } else {
          rowIndex = this._appendParagraphEngineRows(
            rowList,
            paragraph,
            elementList,
            Math.max(1, width - listOffset),
            rowIndex,
            layoutScope,
            defaultAlign,
            scopeNodes,
            nativeY,
            paragraph.direction === 'ltr' ? listOffset / scale : 0,
            (listStyleMap.get(
              elementList[paragraph.startIndex]?.listId || ''
            ) || 0) / scale
          )
        }
        const paragraphRows = rowList.slice(paraRowStart)
        this._applyEngineListMetaToRows(
          paragraphRows,
          listStyleMap,
          listIndexMap
        )
        finish()
        i = paragraph.endIndex + 1
        continue
      }
      i++
    }
    nativeNodes?.push(
      ...groupAreaLayouts(
        scopeNodes,
        elementList,
        width / scale,
        inheritedAreaId
      )
    )
    return rowList
  }

  public computeRowList(payload: IComputeRowListPayload) {
    // Measurement during first layout is allowed only after the engine exists.
    if (!this.layoutHostAdapter.isReady()) {
      this.lifecycle.assertReady()
      throw new Error('HarfBuzz layout is not ready')
    }
    const {
      innerWidth,
      elementList,
      isPagingMode = false,
      isFromTable = false,
      startX = 0,
      startY = 0,
      surroundElementList = [],
      layoutScope = 'main',
      defaultDirection,
      defaultAlign
    } = payload
    const isMainLayout =
      !isFromTable && layoutScope === 'main' && elementList === this.elementList
    // Native text, tables, objects and breaks use explicit layout nodes.
    // 分栏时按列宽排版，避免整段以整行宽换行后套栏偏移导致列间覆盖
    const layout =
      isPagingMode && !isFromTable ? this.columnManager.getLayout() : null
    const isColumnEnabled = !!layout && layout.count > 1
    const engineWidth = isColumnEnabled ? layout!.width : innerWidth
    const useFlow =
      !isFromTable &&
      ((layoutScope === 'main' && isPagingMode) ||
        surroundElementList.length > 0)
    const createFlow = () =>
      useFlow
        ? new DocumentFlow(
            this.options.paperDirection,
            (pageNo, direction) => {
              if (layoutScope !== 'main')
                return {
                  top: startY / this.options.scale,
                  bottom: Infinity,
                  left: startX / this.options.scale,
                  width: innerWidth / this.options.scale,
                  columns: [0]
                }
              const margins = this.getMargins(direction)
              const columns = isPagingMode
                ? this.columnManager.getLayout(direction)
                : null
              return {
                top:
                  (margins[0] +
                    (isPagingMode
                      ? this.header.getExtraHeight(pageNo, direction)
                      : 0)) /
                  this.options.scale,
                bottom: isPagingMode
                  ? (this.getHeight(direction) -
                      margins[2] -
                      this.footer.getExtraHeight(pageNo, direction)) /
                    this.options.scale
                  : Infinity,
                left: margins[3] / this.options.scale,
                width:
                  (columns?.width || this.getInnerWidth(direction)) /
                  this.options.scale,
                columns: columns?.offsets.map(x => x / this.options.scale) || [
                  0
                ]
              }
            },
            surroundElementList
              .filter(
                el =>
                  !isElementLayoutHidden(el, {
                    isDesignMode: this.isDesignMode(),
                    isAreaHideDisabled: this.isAreaHideDisabled(),
                    isTraceHidden: el => this.traceParticle.isTraceHidden(el)
                  })
              )
              .flatMap(el =>
                el.imgFloatPosition && el.width && el.height
                  ? [
                      {
                        pageNo: el.imgFloatPosition.pageNo || 0,
                        x: el.imgFloatPosition.x,
                        y: el.imgFloatPosition.y,
                        width: el.width,
                        height: el.height
                      }
                    ]
                  : []
              ),
            isPagingMode
          )
        : undefined
    const computeEngineRows = (
      from = 0,
      to = elementList.length,
      rowIndex = 0
    ) =>
      this._computeRowListByTextEngine(
        elementList,
        engineWidth,
        layoutScope,
        defaultDirection,
        defaultAlign,
        from,
        to,
        rowIndex,
        payload.nativeNodes,
        payload.inheritedAreaId,
        createFlow()
      )
    // Reuse native paragraphs inside the adapter. Flow and row projection
    // always run against current constraints, including pages and floats.
    this.layoutHostAdapter.replaceParagraphLayouts(layoutScope, [])
    if (!isMainLayout) this.dirtyRangeTracker.consumeDirtyRange(elementList)
    const flow = createFlow()
    const entries = isMainLayout && this.options.lab?.incrementalEditing &&
      this.options.lab?.incrementalFlow && flow && !surroundElementList.length &&
      this.textFrameDependencies() !== null &&
      !this.options.pageNumber.maxPageNo
      ? this.layoutHostAdapter.paragraphs.get(elementList).entries() : null
    if (entries && entries.length <= 2048 && entries.every(e => e.record.editable)) {
      this.usedIncrementalFlow = true
      const dependencies = JSON.stringify([
        this.options, this.layoutHostAdapter.getFontManager().getRevision(),
        this.layoutHostAdapter.getParagraphEpoch(), engineWidth,
        defaultDirection, defaultAlign, this.textFrameDependencies()
      ])
      this.incrementalFlow.begin()
      const rows: LayoutRow[] = []
      const compatibility: { startIndex: number; endIndex: number;
        layout: import('../text-engine/types').LayoutResult }[] = []
      for (const entry of entries) {
        const result = this.incrementalFlow.paragraph(
          entry.record, entry.start, rows.length, flow!, dependencies, () => {
            const nodes: LayoutNode[] = []
            const paragraphRows = this._computeRowListByTextEngine(
              elementList, engineWidth, layoutScope, defaultDirection,
              defaultAlign, entry.start, entry.end, rows.length, nodes,
              payload.inheritedAreaId, flow!
            )
            return { rows: paragraphRows, nodes, compatibility:
              this.layoutHostAdapter.findLayoutByElementIndex(entry.start, layoutScope)?.layout }
          },
          !!payload.dirtyRange && entry.end > payload.dirtyRange.startIndex &&
            entry.start < payload.dirtyRange.endIndex
        )
        rows.push(...result.rows)
        if (result.compatibility) compatibility.push({
          startIndex: entry.start, endIndex: entry.end - 1,
          layout: result.compatibility
        })
        payload.nativeNodes?.push(...result.nodes)
      }
      this.incrementalFlow.end()
      this.layoutHostAdapter.replaceParagraphLayouts(layoutScope, compatibility)
      return rows
    }
    if (isMainLayout) {
      this.usedIncrementalFlow = false
      this.incrementalFlow.clear()
    }
    return this.layoutHostAdapter.withListMarkers(elementList, () => computeEngineRows())
  }

  private truncateFlowRow(row: LayoutRow) {
    // Page limits mutate the authoritative model: publish a snapshot barrier.
    this.promoteSnapshotEdit()
    this.opaqueEditPending = true
    this.dirtyRangeTracker.markFullDirty()
    const table = this.elementList[row.startIndex]
    const keepTable =
      row.tableFragment &&
      table?.type === ElementType.TABLE &&
      this.tablePaging.truncateTableByFragment(
        table,
        row.tableFragment,
        this.elementList
      )
    this.elementList = this.elementList.slice(
      0,
      row.startIndex + (keepTable ? 1 : 0)
    )
    this.isElementListTruncated = true
  }

  private _computePageList(): LayoutRow[][] {
    const pageRowList: LayoutRow[][] = [[]]
    const {
      pageMode,
      pageNumber: { maxPageNo }
    } = this.options
    const height = this.getHeight()
    if (pageMode === PageMode.CONTINUITY) {
      this.pageDirectionList = [this.options.paperDirection]
      const marginHeight = this.getMainOuterHeight(0)
      let pageHeight = marginHeight
      pageRowList[0] = this.rowList
      // 重置高度
      pageHeight += this.rowList.reduce(
        (pre, cur) => pre + cur.height + (cur.offsetY || 0),
        0
      )
      for (const row of this.rowList)
        if (row.flow)
          pageHeight = Math.max(
            pageHeight,
            row.flow.y * this.options.scale +
              row.height +
              (row.offsetY || 0) +
              this.getMargins()[2]
          )
      const dpr = this.getPagePixelRatio()
      const pageDom = this.pageList[0]
      const pageDomHeight = Number(pageDom.style.height.replace('px', ''))
      if (pageHeight > pageDomHeight) {
        pageDom.style.height = `${pageHeight}px`
        pageDom.height = pageHeight * dpr
      } else {
        const reduceHeight = pageHeight < height ? height : pageHeight
        pageDom.style.height = `${reduceHeight}px`
        pageDom.height = reduceHeight * dpr
      }
      this._initPageContext(this.ctxList[0])
    } else if (this.rowList.length && this.rowList.every(row => !!row.flow)) {
      const directions = [this.options.paperDirection]
      for (let i = 0; i < this.rowList.length; i++) {
        const row = this.rowList[i]
        const placement = row.flow!
        if (Number.isInteger(maxPageNo) && placement.pageNo > maxPageNo!) {
          this.truncateFlowRow(row)
          this.rowList = this.rowList.slice(0, i)
          this.rawRowList = this.rowList
          break
        }
        while (pageRowList.length <= placement.pageNo) {
          directions[pageRowList.length] = placement.direction
          pageRowList.push([])
        }
        directions[placement.pageNo] = placement.direction
        pageRowList[placement.pageNo].push(row)
      }
      this.pageDirectionList = directions
    } else {
      if (this.rowList.length)
        throw new Error('Paged layout requires native flow placements')
      this.pageDirectionList = [this.options.paperDirection]
    }
    return pageRowList
  }

  private _drawHighlight(
    ctx: CanvasRenderingContext2D,
    payload: IDrawRowPayload
  ) {
    const { rowList, positionList, elementList } = payload
    const marginHeight = this.getDefaultBasicRowMarginHeight()
    const highlightMarginHeight = this.getHighlightMarginHeight()
    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      // 内容高度：不含段后间距
      const rowContentHeight = curRow.height - (curRow.spacingAfter || 0)
      let preHighlight = ''
      for (let j = 0; j < curRow.elementList.length; j++) {
        const element = curRow.elementList[j]
        // 高亮配置：元素 > 控件配置
        const highlight =
          element.highlight ||
          this.control.getControlHighlight(
            elementList,
            rowSourceIndex(curRow, j)
          )
        if (highlight) {
          // 高亮元素相连需立即绘制，并记录下一元素坐标
          if (preHighlight && preHighlight !== highlight) {
            this.highlight.render(ctx)
          }
          // 当前元素位置信息记录（表格跨页片段行优先使用片段位置）
          const position = this.getRowElementPosition(
            curRow,
            positionList,
            element,
            j
          )
          if (!position) continue
          const {
            coordinate: {
              leftTop: [x, y]
            }
          } = position
          // 元素向左偏移量
          const offsetX = position.left || 0
          const engineRect = this.getEngineHighlightRect(
            curRow,
            element,
            position,
            positionList,
            payload.pageNo
          )
          this.highlight.recordFillInfo(
            ctx,
            engineRect?.x ?? x - offsetX,
            y + marginHeight - highlightMarginHeight, // 先减去行margin，再加上高亮margin
            engineRect?.width ?? position.metrics.width + offsetX,
            rowContentHeight - 2 * marginHeight + 2 * highlightMarginHeight,
            highlight
          )
        } else if (preHighlight) {
          // 之前是高亮元素，当前不是需立即绘制
          this.highlight.render(ctx)
        }
        preHighlight = highlight
      }
      this.highlight.render(ctx)
    }
  }

  public drawRow(ctx: CanvasRenderingContext2D, payload: IDrawRowPayload) {
    // 优先绘制高亮元素
    this._drawHighlight(ctx, payload)
    // 绘制元素、下划线、删除线、选区
    const {
      scale,
      table: { tdPadding },
      group,
      lineBreak,
      whiteSpace
    } = this.options
    const {
      rowList,
      pageNo,
      elementList,
      positionList,
      startIndex,
      zone,
      isDrawLineBreak = !lineBreak.disabled,
      isDrawWhiteSpace = !whiteSpace.disabled,
      isDrawRange = true
    } = payload
    const isPrintMode = this.isPrintMode()
    const isGraffitiMode = this.isGraffitiMode()
    const { isCrossRowCol, tableId } = this.range.getRange()
    let index = startIndex
    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      // 内容高度：不含段后间距
      const rowContentHeight = curRow.height - (curRow.spacingAfter || 0)
      // Dedicated object rows use their object bounds for selection.
      const rangeRecord: IElementFillRect = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      }
      let tableRangeElement: IElement | null = null
      for (let j = 0; j < curRow.elementList.length; j++) {
        const model = curRow.elementList[j]
        // 表格跨页片段行：索引以行起始数据索引为基准，
        // 避免同页多片段时选区记录索引漂移
        if (curRow.tableFragment) {
          index = curRow.startIndex + j
        }
        // 当前元素位置信息（表格跨页片段行优先使用片段位置）
        const position = this.getRowElementPosition(
          curRow,
          positionList,
          model,
          j
        )
        if (!position) continue
        const metrics = position.metrics
        // Compatibility is emitted only at the particle paint boundary.
        const element = {
          ...model,
          metrics,
          left: position.left,
          style: this.getElementFont(model, scale)
        }
        const {
          ascent: offsetY,
          coordinate: {
            leftTop: [x, y]
          }
        } = position
        const preElement = curRow.elementList[j - 1]
        // 元素绘制
        if (
          (element.hide ||
            element.control?.hide ||
            (element.area?.hide && !this.isAreaHideDisabled()) ||
            this.traceParticle.isTraceHidden(element)) &&
          !this.isDesignMode()
        ) {
          // 控件隐藏时不绘制
        } else if (element.type === ElementType.IMAGE) {
          // 浮动图片单独绘制
          if (
            element.imgDisplay !== ImageDisplay.SURROUND &&
            element.imgDisplay !== ImageDisplay.FLOAT_TOP &&
            element.imgDisplay !== ImageDisplay.FLOAT_BOTTOM
          ) {
            this.imageParticle.render(ctx, element, x, y + offsetY)
          }
        } else if (element.type === ElementType.LATEX) {
          if (!isFloatingImage(element.imgDisplay))
            this.laTexParticle.render(ctx, element, x, y + offsetY)
        } else if (element.type === ElementType.TABLE) {
          if (isCrossRowCol) {
            rangeRecord.x = x
            rangeRecord.y = y
            tableRangeElement = element
          }
          this.tableParticle.render(ctx, element, x, y, curRow.tableFragment)
        } else if (element.type === ElementType.HYPERLINK) {
          this.hyperlinkParticle.ensureDefaults(element)
        } else if (element.type === ElementType.LABEL) {
          this.labelParticle.ensureDefaults(element)
          this.labelParticle.renderBackground(ctx, element, x, y + offsetY)
        } else if (element.type === ElementType.SEPARATOR) {
          this.separatorParticle.render(ctx, element, x, y, metrics.width)
        } else if (element.type === ElementType.PAGE_BREAK) {
          if (this.mode !== EditorMode.CLEAN && !isPrintMode) {
            this.pageBreakParticle.render(ctx, metrics.width, x, y)
          }
        } else if (
          element.type === ElementType.CHECKBOX ||
          element.controlComponent === ControlComponent.CHECKBOX
        ) {
          this.checkboxParticle.render({
            ctx,
            x,
            y: y + offsetY,
            index: j,
            row: curRow
          })
        } else if (
          element.type === ElementType.RADIO ||
          element.controlComponent === ControlComponent.RADIO
        ) {
          this.radioParticle.render({
            ctx,
            x,
            y: y + offsetY,
            index: j,
            row: curRow
          })
        } else if (element.type === ElementType.BLOCK) {
          this.blockParticle.render(ctx, pageNo, model, x, y + offsetY, metrics)
        }
        // 换行符绘制
        if (
          isDrawLineBreak &&
          !isPrintMode &&
          this.mode !== EditorMode.CLEAN &&
          !curRow.isWidthNotEnough &&
          j === curRow.elementList.length - 1
        ) {
          this.lineBreakParticle.render(
            ctx,
            element,
            x,
            y + rowContentHeight / 2
          )
        }
        // 空白符绘制
        if (isDrawWhiteSpace && WHITE_SPACE_REG.test(element.value)) {
          this.whiteSpaceParticle.render(
            ctx,
            element,
            x,
            y + rowContentHeight / 2
          )
        }
        // 边框绘制（目前仅支持控件）
        if (element.control?.border) {
          // 不同控件边框立刻绘制
          if (
            preElement?.control?.border &&
            preElement.controlId !== element.controlId
          ) {
            this.control.drawBorder(ctx)
          }
          // 当前元素位置信息记录
          const rowMargin = this.getElementRowMargin(element)
          this.control.recordBorderInfo(
            x,
            y + rowMargin,
            element.metrics.width,
            rowContentHeight - 2 * rowMargin
          )
        } else if (preElement?.control?.border) {
          this.control.drawBorder(ctx)
        }
        // 下划线记录
        if (element.underline || element.control?.underline) {
          // 下标元素下划线单独绘制
          if (
            preElement?.type === ElementType.SUBSCRIPT &&
            element.type !== ElementType.SUBSCRIPT
          ) {
            this.underline.render(ctx)
          }
          // 优先用 position.left：text-engine 的 position.x 已含 left，
          // 若 element.left 在定位后被清掉，用 element.left 会使 x-offsetX 失效、底线右漂
          const posItem = this.getRowElementPosition(
            curRow,
            positionList,
            element,
            j
          )
          const offsetX = posItem?.left || element.left || 0
          // 下标元素y轴偏移值
          let subOffsetY = 0
          if (element.type === ElementType.SUBSCRIPT) {
            subOffsetY = this.subscriptParticle.getOffsetY(element)
          }
          // 占位符不参与颜色计算
          const color = element.control?.underline
            ? this.options.underlineColor
            : element.color
          // text-engine：基线 + descent（Underline.render 会再 +2*lineWidth）
          const underlineY =
            y + offsetY + Math.max(0, metrics.boundingBoxDescent) + subOffsetY
          let underlineX = x - offsetX
          let underlineW = metrics.width + offsetX
          if (underlineW < 0) {
            underlineX = x
            underlineW = -underlineW
          }
          // minWidth 后缀空隙：从控件内上一内容右缘接到 postfix 位，避免输入后底线断层右漂
          if (
            curRow.nativeLine &&
            element.controlComponent === ControlComponent.POSTFIX &&
            offsetX !== 0 &&
            element.control?.minWidth
          ) {
            let gapStart = underlineX
            for (let k = j - 1; k >= 0; k--) {
              const prev = curRow.elementList[k]
              if (prev.controlId !== element.controlId) break
              if (
                prev.controlComponent === ControlComponent.VALUE ||
                prev.controlComponent === ControlComponent.PREFIX ||
                prev.controlComponent === ControlComponent.PLACEHOLDER
              ) {
                const prevPos = this.getRowElementPosition(
                  curRow,
                  positionList,
                  prev,
                  k
                )
                if (prevPos) {
                  gapStart =
                    prevPos.coordinate.leftTop[0] + (prevPos.metrics.width || 0)
                }
                break
              }
            }
            if (curRow.direction === 'rtl') {
              // RTL：postfix 已左移，空隙在标签左侧，底线从 postfix 向右接到内容
              underlineX = x
              underlineW = Math.max(0, gapStart - x)
            } else {
              underlineX = gapStart
              underlineW = Math.max(0, x - gapStart)
            }
          }
          this.underline.recordFillInfo(
            ctx,
            underlineX,
            underlineY,
            underlineW,
            0,
            color,
            element.textDecoration?.style
          )
        } else if (preElement?.underline || preElement?.control?.underline) {
          this.underline.render(ctx)
        }
        // 删除线记录
        if (element.strikeout) {
          // 仅文本类元素支持删除线
          if (!element.type || TEXTLIKE_ELEMENT_TYPE.includes(element.type)) {
            // 字体大小不同时需立即绘制
            if (
              preElement &&
              ((preElement.type === ElementType.SUBSCRIPT &&
                element.type !== ElementType.SUBSCRIPT) ||
                (preElement.type === ElementType.SUPERSCRIPT &&
                  element.type !== ElementType.SUPERSCRIPT) ||
                this.getElementSize(preElement) !==
                  this.getElementSize(element))
            ) {
              this.strikeout.render(ctx)
            }
            let adjustY = y + offsetY - metrics.height * 0.3
            // 上下标位置调整
            if (element.type === ElementType.SUBSCRIPT) {
              adjustY += this.subscriptParticle.getOffsetY(element)
            } else if (element.type === ElementType.SUPERSCRIPT) {
              adjustY += this.superscriptParticle.getOffsetY(element)
            }
            this.strikeout.recordFillInfo(ctx, x, adjustY, metrics.width)
          }
        } else if (preElement?.strikeout) {
          this.strikeout.render(ctx)
        }
        // 留痕装饰
        this.traceParticle.render({
          ctx,
          element,
          x,
          y,
          curRow,
          metrics,
          offsetY,
          scale
        })
        // 选区记录
        const {
          zone: currentZone,
          startIndex,
          endIndex
        } = this.range.getRange()
        if (
          !curRow.nativeLine &&
          isDrawRange &&
          currentZone === zone &&
          startIndex !== endIndex &&
          startIndex <= index &&
          index <= endIndex
        ) {
          const positionContext = this.position.getPositionContext()
          // 表格需限定上下文
          if (
            (!positionContext.isTable && !element.tdId) ||
            positionContext.tdId === element.tdId
          ) {
            if (startIndex === index) {
              // 从行尾开始-绘制最小宽度
              const nextElement = elementList[startIndex + 1]
              if (nextElement && nextElement.value === ZERO) {
                rangeRecord.x = x + metrics.width
                rangeRecord.y = y
                rangeRecord.height = rowContentHeight
                rangeRecord.width += this.options.rangeMinWidth
              }
            } else {
              let rangeWidth = metrics.width
              // 最小选区宽度
              if (rangeWidth === 0 && curRow.elementList.length === 1) {
                rangeWidth = this.options.rangeMinWidth
              }
              // 记录第一次位置、行高
              if (!rangeRecord.width) {
                rangeRecord.x = x
                rangeRecord.y = y
                rangeRecord.height = rowContentHeight
              }
              rangeRecord.width += rangeWidth
            }
          }
        }
        // 组信息记录
        if (!group.disabled && element.groupIds) {
          const engineRect = this.getEngineHighlightRect(
            curRow,
            element,
            {
              index: rowSourceIndex(curRow, j),
              coordinate: {
                leftTop: [x, y]
              }
            } as import('../../interface/Element').IElementPosition,
            positionList
          )
          this.group.recordFillInfo(
            element,
            engineRect?.x ?? x,
            y,
            engineRect?.width ?? metrics.width,
            rowContentHeight
          )
        }
        index++
        // 绘制表格内元素
        if (
          element.type === ElementType.TABLE &&
          !element.hide &&
          !this.traceParticle.isTraceHidden(element)
        ) {
          const tdPaddingWidth = tdPadding[1] + tdPadding[3]
          const fragment = curRow.tableFragment
          // 续页回显表头内容（使用一次性位置列表，不绘制选区）
          if (curRow.repeatTdPositionList?.length) {
            for (const {
              td,
              positionList: repeatPositionList
            } of curRow.repeatTdPositionList) {
              this.drawRow(ctx, {
                elementList: td.value,
                positionList: repeatPositionList,
                rowList: td.rowList!,
                pageNo,
                startIndex: 0,
                innerWidth: (td.width! - tdPaddingWidth) * scale,
                zone,
                isDrawLineBreak,
                isDrawRange: false
              })
            }
          }
          // 遍历片段范围行与进位合并单元格，仅绘制窗口内的内容行
          const fragmentTdList = fragment
            ? this.tableParticle.getFragmentTdList(element, fragment)
            : element.trList!.flatMap(tr => tr.tdList)
          for (const td of fragmentTdList) {
            let rowList = td.rowList!
            let startIndex = 0
            if (fragment) {
              const [windowStart, windowEnd] =
                this.tableParticle.getTdWindowInFragment(td, element, fragment)
              if (windowEnd <= windowStart) continue
              if (windowStart > 0 || windowEnd < td.height!) {
                const visible = this.tableParticle.getTdVisibleRowListByWindow(
                  td,
                  windowStart,
                  windowEnd
                )
                rowList = visible.rowList
                startIndex = visible.startIndex
              }
            }
            this.drawRow(ctx, {
              elementList: td.value,
              positionList: td.positionList!,
              rowList,
              pageNo,
              startIndex,
              innerWidth: (td.width! - tdPaddingWidth) * scale,
              zone,
              isDrawLineBreak
            })
          }
        }
      }
      // 绘制列表样式
      if (curRow.isList && curRow.height > 0) {
        this.listParticle.drawListStyle(
          ctx,
          curRow,
          positionList[rowSourceIndex(curRow, 0)]
        )
      }
      // 绘制文字、边框、下划线、删除线
      if (curRow.nativeLine) {
        const placed = this.position.getNativeRow(curRow, positionList, pageNo)
        if (placed)
          this.layoutHostAdapter
            .getGlyphRenderer()
            .drawNativeLine(
              ctx,
              curRow.nativeLine,
              placed.x,
              placed.y,
              placed.scale,
              indices => {
                const element = elementList[indices[0]]
                return {
                  hidden: indices.some(index =>
                    this.isGlyphPaintSkipped(elementList[index])
                  ),
                  color:
                    element?.color ||
                    (element?.type === ElementType.HYPERLINK
                      ? this.options.defaultHyperlinkColor
                      : element?.type === ElementType.LABEL
                        ? element.label?.color ||
                          this.options.label.defaultColor
                        : this.options.defaultColor)
                }
              }
            )
      }
      this.control.drawBorder(ctx)
      this.underline.render(ctx)
      this.strikeout.render(ctx)
      // 冲刷留痕累积
      this.traceParticle.flush(ctx)
      // 绘制批注样式
      this.group.render(ctx)
      // 绘制选区
      if (!isPrintMode && !isGraffitiMode) {
        const { startIndex: selStart, endIndex: selEnd } = this.range.getRange()
        const placed = this.position.getNativeRow(curRow, positionList, pageNo)
        const context = this.position.getPositionContext()
        const sameScope = !context.isTable
          ? !curRow.elementList[0]?.tdId
          : context.tdId === curRow.elementList[0]?.tdId
        if (
          placed &&
          isDrawRange &&
          this.zone.getZone() === zone &&
          sameScope &&
          selStart !== selEnd
        ) {
          const rects = textRangeRects(placed, selStart + 1, selEnd + 1)
          if (
            !rects.length &&
            placed.line.empty &&
            placed.line.source.start > selStart &&
            placed.line.source.start <= selEnd
          ) {
            rects.push({
              x: placed.x + placed.line.rect.x * scale,
              y: placed.y + placed.line.rect.y * scale,
              width: this.options.rangeMinWidth,
              height: placed.line.contentHeight * scale
            })
          }
          for (const rect of rects)
            this.range.render(ctx, rect.x, rect.y, rect.width, rect.height)
        } else if (rangeRecord.width && rangeRecord.height) {
          const { x, y, width, height } = rangeRecord
          this.range.render(ctx, x, y, width, height)
        }
        if (
          isDrawRange &&
          isCrossRowCol &&
          tableRangeElement &&
          tableRangeElement.id === tableId
        ) {
          const position = this.getRowElementPosition(
            curRow,
            positionList,
            tableRangeElement,
            0
          )
          if (!position) continue
          const {
            coordinate: {
              leftTop: [x, y]
            }
          } = position
          this.tableParticle.drawRange(
            ctx,
            tableRangeElement,
            x,
            y,
            curRow.tableFragment
          )
        }
      }
    }
  }

  private _drawFloat(
    ctx: CanvasRenderingContext2D,
    payload: IDrawFloatPayload
  ) {
    const floatPositionList = this.position.getFloatPositionList()
    const { imgDisplays, pageNo } = payload
    for (let e = 0; e < floatPositionList.length; e++) {
      const floatPosition = floatPositionList[e]
      const element = floatPosition.element
      if (
        (pageNo === floatPosition.pageNo ||
          floatPosition.zone === EditorZone.HEADER ||
          floatPosition.zone == EditorZone.FOOTER) &&
        element.imgDisplay &&
        imgDisplays.includes(element.imgDisplay) &&
        (element.type === ElementType.IMAGE ||
          element.type === ElementType.LATEX)
      ) {
        const { x, y } = this.position.getFloatPositionCoordinate(floatPosition)
        if (element.type === ElementType.LATEX)
          this.laTexParticle.render(ctx, element, x, y)
        else this.imageParticle.render(ctx, element, x, y)
      }
    }
  }

  private _clearPage(pageNo: number) {
    const ctx = this.ctxList[pageNo]
    const pageDom = this.pageList[pageNo]
    ctx.clearRect(
      0,
      0,
      Math.max(pageDom.width, this.getWidth()),
      Math.max(pageDom.height, this.getHeight())
    )
    this.blockParticle.clear()
  }

  private _drawPage(payload: IDrawPagePayload) {
    const { elementList, positionList, rowList, pageNo } = payload
    const {
      inactiveAlpha,
      pageMode,
      header,
      footer,
      pageNumber,
      lineNumber,
      pageBorder
    } = this.options
    const isPrintMode = this.mode === EditorMode.PRINT
    const isContinuityMode = pageMode === PageMode.CONTINUITY
    const { innerWidth } = this.getPageSize(pageNo)
    const ctx = this.ctxList[pageNo]
    // 判断当前激活区域-非正文区域时元素透明度降低
    ctx.globalAlpha = !this.zone.isMainActive() ? inactiveAlpha : 1
    this._clearPage(pageNo)
    // 绘制背景
    if (
      !isPrintMode ||
      !this.options.modeRule[EditorMode.PRINT]?.backgroundDisabled
    ) {
      this.background.render(ctx, pageNo)
    }
    // 绘制区域
    if (!isPrintMode) {
      this.area.render(ctx, pageNo)
    }
    // 绘制分栏分隔线
    this.columnManager.drawSeparator(ctx, pageNo)
    // 绘制水印（底层）
    if (
      !isContinuityMode &&
      this.options.watermark.data &&
      this.options.watermark.layer === WatermarkLayer.BOTTOM
    ) {
      this.waterMark.render(ctx, pageNo)
    }
    // 绘制页边距
    if (!isPrintMode) {
      this.margin.render(ctx, pageNo)
    }
    // 渲染衬于文字下方元素
    this._drawFloat(ctx, {
      pageNo,
      imgDisplays: [ImageDisplay.FLOAT_BOTTOM]
    })
    // 控件高亮
    if (!isPrintMode) {
      this.control.renderHighlightList(ctx, pageNo)
    }
    // 渲染元素
    const index = rowList[0]?.startIndex
    this.drawRow(ctx, {
      elementList,
      positionList,
      rowList,
      pageNo,
      startIndex: index,
      innerWidth,
      zone: EditorZone.MAIN
    })
    if (this.getIsPagingMode()) {
      // 绘制页眉
      if (!header.disabled) {
        this.header.render(ctx, pageNo)
      }
      // 绘制页码
      if (!pageNumber.disabled) {
        this.pageNumber.render(ctx, pageNo)
      }
      // 绘制页脚
      if (!footer.disabled) {
        this.footer.render(ctx, pageNo)
      }
    }
    // 渲染浮于文字上方元素
    this._drawFloat(ctx, {
      pageNo,
      imgDisplays: [ImageDisplay.FLOAT_TOP, ImageDisplay.SURROUND]
    })
    // 搜索匹配绘制
    if (!isPrintMode && this.search.getSearchKeyword()) {
      this.search.render(ctx, pageNo)
    }
    // 拼写检查错词绘制
    if (!isPrintMode && this.spellcheck.getSpellcheckRangeList().length) {
      this.spellcheck.render(ctx, pageNo)
    }
    // 绘制空白占位符
    if (this.elementList.length <= 1 && !this.elementList[0]?.listId) {
      this.placeholder.render(ctx)
    }
    // 渲染行数
    if (!lineNumber.disabled) {
      this.lineNumber.render(ctx, pageNo)
    }
    // 绘制页面边框
    if (!pageBorder.disabled) {
      this.pageBorder.render(ctx, pageNo)
    }
    // 绘制签章
    this.badge.render(ctx, pageNo)
    // 绘制涂鸦
    if (this.isGraffitiMode()) {
      this.graffiti.render(ctx, pageNo)
    }
    // 绘制水印（顶层）
    if (
      !isContinuityMode &&
      this.options.watermark.data &&
      this.options.watermark.layer === WatermarkLayer.TOP
    ) {
      this.waterMark.render(ctx, pageNo)
    }
  }

  private _disconnectLazyRender() {
    this.lazyRenderIntersectionObserver?.disconnect()
    this.lazyRenderIntersectionObserver = null
    this.observedPages.clear()
    this.visiblePages.clear()
  }

  private observedPages = new Set<HTMLCanvasElement>()
  private visiblePages = new Set<HTMLCanvasElement>()
  private dirtyPages = new Set<number>()

  private paintPage(pageNo: number) {
    if (!this.pageRowList[pageNo]) return
    this._drawPage({
      elementList: this.elementList,
      positionList: this.position.getOriginalMainPositionList(),
      rowList: this.pageRowList[pageNo], pageNo
    })
    this.dirtyPages.delete(pageNo)
  }

  private _lazyRender() {
    if (this.options.lab?.dirtyPagePaint) {
      if (!this.lazyRenderIntersectionObserver) {
        this.lazyRenderIntersectionObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            const page = entry.target as HTMLCanvasElement
            if (entry.isIntersecting) {
              this.visiblePages.add(page)
              const index = Number(page.dataset.index)
              if (this.dirtyPages.has(index)) this.paintPage(index)
            } else this.visiblePages.delete(page)
          }
        }, { rootMargin: '200px 0px' })
      }
      for (const page of this.observedPages) {
        if (!this.pageList.includes(page)) {
          this.lazyRenderIntersectionObserver.unobserve(page)
          this.observedPages.delete(page)
          this.visiblePages.delete(page)
        }
      }
      for (const page of this.pageList) {
        if (!this.observedPages.has(page)) {
          this.observedPages.add(page)
          this.dirtyPages.add(Number(page.dataset.index))
          this.lazyRenderIntersectionObserver.observe(page)
        }
      }
      for (const page of this.visiblePages) {
        const index = Number(page.dataset.index)
        if (this.dirtyPages.has(index)) this.paintPage(index)
      }
      return
    }
    const positionList = this.position.getOriginalMainPositionList()
    const elementList = this.getOriginalMainElementList()
    this._disconnectLazyRender()
    this.lazyRenderIntersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Number((<HTMLCanvasElement>entry.target).dataset.index)
          this._drawPage({
            elementList,
            positionList,
            rowList: this.pageRowList[index],
            pageNo: index
          })
        }
      })
    })
    this.pageList.forEach(el => {
      this.lazyRenderIntersectionObserver!.observe(el)
    })
  }

  private _immediateRender() {
    this.dirtyPages.clear()
    const positionList = this.position.getOriginalMainPositionList()
    const elementList = this.getOriginalMainElementList()
    for (let i = 0; i < this.pageRowList.length; i++) {
      this._drawPage({
        elementList,
        positionList,
        rowList: this.pageRowList[i],
        pageNo: i
      })
    }
  }

  private textFrameDependencies() {
    const frames = [this.header.getElementList(), this.footer.getElementList()]
    if (frames.some(elements => elements.some(element =>
      (element.type && element.type !== ElementType.TEXT) || element.controlId ||
      element.areaId || element.trList))) return null
    return frames.map(elements => getSlimCloneElementList(elements))
  }

  private layoutWorkerClient: LayoutWorkerClient | null = null
  private workerInitialization: Promise<void> | null = null
  private workerFontRevision = -1
  private workerNeedsResync = false
  private workerFaults = 0
  private workerGeneration = 0
  private pendingWorkerRender: IDrawOption | null = null
  private pendingWorkerHistory: EditSelection | null = null
  private trackedAsyncCommit = false
  private workerRenderPromise: Promise<void> = Promise.resolve()
  private workerGeometryStats = { committed: 0, stale: 0, fallbacks: 0 }
  private workerCommitTimer: ReturnType<typeof setTimeout> | null = null
  private workerRecoveryTimer: ReturnType<typeof setTimeout> | null = null

  private scheduleWorkerRecovery() {
    this.workerNeedsResync = true
    if (!this.isReady()) return
    if (this.workerRecoveryTimer !== null) clearTimeout(this.workerRecoveryTimer)
    // Do not repeatedly restart a snapshot while repeat events are still
    // changing it. Rebuild the mirror once the input burst becomes idle.
    this.workerRecoveryTimer = setTimeout(() => {
      this.workerRecoveryTimer = null
      this.ensureLayoutWorker()
    }, 100)
  }
  private workerFallbackReasons: Record<WorkerFallbackReason, number> = {
    dependencies: 0, unavailable: 0, composition: 0, scope: 0,
    edit: 0, size: 0, error: 0, deadline: 0
  }

  public getPerformanceDiagnostics(): EditorPerformanceDiagnostics {
    const { ready, pending, ...counters } = this.getLayoutWorkerStats()
    return {
      schemaVersion: 1,
      state: this.lifecycle.state,
      options: { ...this.options.lab },
      worker: { ready, pending, ...this.layoutWorkerClient?.getQueueStats(),
        requests: this.layoutWorkerClient?.getQueueStats().requests || 0,
        waiting: this.layoutWorkerClient?.getQueueStats().waiting || false,
        queuedBytes: this.layoutWorkerClient?.getQueueStats().queuedBytes || 0,
        bufferedEdits: this.layoutWorkerClient?.getQueueStats().bufferedEdits || 0,
        faults: this.workerFaults, needsResync: this.workerNeedsResync,
        counters, fallbackReasons: { ...this.workerFallbackReasons } },
      flow: { ...this.incrementalFlow.stats },
      placements: this.position.getPlacementStats(),
      paths: { ...this.layoutHostAdapter.getGlyphRenderer().stats },
      runs: { ...this.layoutHostAdapter.getRunStats() },
      utilityWorkers: { ...this.workerManager.stats },
      pages: { observed: this.observedPages.size,
        visible: this.visiblePages.size, dirty: this.dirtyPages.size }
    }
  }

  private cancelWorkerCommitTimer() {
    if (this.workerCommitTimer !== null) clearTimeout(this.workerCommitTimer)
    this.workerCommitTimer = null
  }

  private rejectWorkerEdit(reason: WorkerFallbackReason) {
    this.workerFallbackReasons[reason]++
    return false
  }

  public hasPendingWorkerGeometry() { return !!this.pendingWorkerRender }

  public async inspectLayoutWorker() {
    return this.layoutWorkerClient?.inspect()
  }

  public getLayoutWorkerStats() {
    return { ...this.workerGeometryStats, ...this.layoutWorkerClient?.stats,
      ready: !!this.layoutWorkerClient?.ready, pending: !!this.pendingWorkerRender }
  }

  public async waitForWorkerLayout() {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.workerRecoveryTimer !== null) {
        clearTimeout(this.workerRecoveryTimer)
        this.workerRecoveryTimer = null
      }
      this.ensureLayoutWorker()
      const render = this.workerRenderPromise
      await this.workerInitialization
      await render
      try { await this.layoutWorkerClient?.waitForIdle() } catch {
        this.workerNeedsResync = true
      }
      if (!this.workerNeedsResync && !this.workerInitialization &&
        render === this.workerRenderPromise) return
    }
  }

  private ensureLayoutWorker() {
    if (!this.options.lab?.layoutWorker || !this.options.lab?.incrementalEditing ||
      !this.options.lab?.incrementalFlow || !this.isReady() || this.workerFaults >= 3)
      return
    if (this.workerRecoveryTimer !== null) return
    const entries = this.layoutHostAdapter.paragraphs.get(this.elementList).entries()
    if (entries.length > 2048 || entries.some(entry => !entry.record.editable) ||
      this.textFrameDependencies() === null || !this.getIsPagingMode() ||
      this.options.pageNumber.maxPageNo || (this.getColumnLayout()?.count || 1) !== 1)
      return
    const fonts = this.layoutHostAdapter.getFontManager()
    if (this.workerInitialization || (this.layoutWorkerClient?.ready &&
      !this.workerNeedsResync && this.workerFontRevision === fonts.getRevision() &&
      this.layoutWorkerClient.getRevision() === this.getDocumentRevision())) return
    this.layoutWorkerClient ||= new LayoutWorkerClient(undefined, 5000,
      16 * 1024 * 1024, !!this.options.lab?.workerTransfer)
    const revision = this.getDocumentRevision()
    this.workerFontRevision = fonts.getRevision()
    this.workerNeedsResync = false
    this.workerInitialization = this.layoutWorkerClient.initialize(
      this.captureEditModel(), fonts.getFontManifest(), this.options.defaultFont,
      revision, this.workerFontRevision
    ).then(() => {
      if (revision !== this.getDocumentRevision()) this.scheduleWorkerRecovery()
    }).catch(() => {
      this.workerFaults++
      this.scheduleWorkerRecovery()
    }).finally(() => { this.workerInitialization = null })
  }

  private deferWorkerRender(payload: IDrawOption | undefined) {
    const edit = this.activeEdit
    const client = this.layoutWorkerClient
    if (!payload?.isDeferredPaint || !this.options.lab?.layoutWorker) return false
    if (!this.options.lab.incrementalEditing || !this.options.lab.incrementalFlow)
      return this.rejectWorkerEdit('dependencies')
    if (this.canvasEvent.isComposing) return this.rejectWorkerEdit('composition')
    if (!edit?.trusted || !edit.groupable) return this.rejectWorkerEdit('edit')
    // Visual deletion consumes current caret geometry at the next key. Commit
    // its incremental geometry now and coalesce paint; posting a layout only
    // to synchronously invalidate it on every repeat wastes both threads.
    if (edit.kind === 'backspace' || edit.kind === 'delete') return false
    if (!client?.ready || this.workerNeedsResync ||
      this.workerFontRevision !== this.layoutHostAdapter.getFontManager().getRevision())
      return this.rejectWorkerEdit('unavailable')
    if (!this.zone.isMainActive() || this.position.getPositionContext().isTable ||
      this.textFrameDependencies() === null ||
      !this.getIsPagingMode() || this.isPrintMode() ||
      !!this.options.pageNumber.maxPageNo ||
      (this.getColumnLayout()?.count || 1) !== 1 ||
      !['input', 'backspace', 'delete'].includes(edit.kind) ||
      edit.operations.some(operation => operation.kind !== 'splice' ||
        operation.scope !== 'main' || [...operation.before, ...operation.after]
          .some(element => element.value === ZERO)) ||
      !edit.operations.length) return this.rejectWorkerEdit('scope')
    const entries = this.layoutHostAdapter.paragraphs.get(this.elementList).entries()
    if (entries.length > 2048 || entries.some(entry => !entry.record.editable))
      return this.rejectWorkerEdit('scope')
    const operations = edit.operations.filter(operation => operation.kind === 'splice')
    const first = Math.max(0, Math.min(...operations.map(operation => operation.index)) - 1)
    const last = Math.max(...operations.map(operation => operation.index + operation.after.length)) + 1
    const dirty = entries.filter(entry => entry.start < last && entry.end > first)
    if (!dirty.length || dirty.some(entry => entry.record.elements.length > 2048) ||
      dirty.reduce((sum, entry) => sum + entry.record.elements.reduce(
        (units, element) => units + element.value.length, 0), 0) > 2048)
      return this.rejectWorkerEdit('size')
    edit.history ||= payload.isSubmitHistory !== false
    // Latest-only requests must not starve geometry under continuous input.
    // This is a scheduling deadline, not a hard bound on layout/presentation.
    if (!this.pendingWorkerRender) this.workerCommitTimer = setTimeout(() => {
      this.workerCommitTimer = null
      if (!this.isReady() || !this.pendingWorkerRender) return
      this.workerFallbackReasons.deadline++
      this.workerGeometryStats.fallbacks++
      this.flushGeometry()
    }, 100)
    this.pendingWorkerRender = { ...payload, isSubmitHistory: false }
    const generation = ++this.workerGeneration
    // Commit the journal/history in the input transaction before posting layout.
    this.workerRenderPromise = Promise.resolve().then(async () => {
      if (generation !== this.workerGeneration || !this.pendingWorkerRender) return
      const revision = this.getDocumentRevision()
      try {
        const inputs = dirty.flatMap(entry =>
          this.layoutHostAdapter.scanParagraphs(this.elementList, undefined,
            entry.start, entry.end).map(paragraph =>
            this.layoutHostAdapter.prepareParagraphInput(paragraph,
              this.elementList, this.getInnerWidth(), 'main')))
        const response = await client.layout(inputs, generation, true)
        if (!this.isReady() || generation !== this.workerGeneration ||
          response.documentRevision !== this.getDocumentRevision() ||
          response.fontRevision !== this.layoutHostAdapter.getFontManager().getRevision()) {
          this.workerGeometryStats.stale++
          return
        }
        if (revision !== this.getDocumentRevision()) return
        this.layoutHostAdapter.installWorkerLayouts(response.inputs!, response.layouts!)
        this.workerGeometryStats.committed++
        this.flushGeometry()
      } catch {
        if (generation === this.workerGeneration && this.isReady()) {
          this.workerGeometryStats.fallbacks++
          this.workerFallbackReasons.error++
          if (client.ready) this.workerFaults++
          this.scheduleWorkerRecovery()
          this.flushGeometry()
        }
      }
    })
    if (payload.isSubmitHistory !== false) nextTick(() => {
      if (!this.isReady()) return
      this.listener.contentChange?.()
      if (this.eventBus.isSubscribe('contentChange')) this.eventBus.emit('contentChange')
    })
    return true
  }

  private incrementalFlow = new IncrementalFlow()
  private usedIncrementalFlow = false
  private layoutChange: LayoutChangeSet | null = null
  public getLayoutChangeSet() { return this.layoutChange }
  public getFlowStats() { return this.incrementalFlow.stats }

  private modelRevision = 0
  private geometryRevision = 0
  private pendingPaint: number | null = null

  /** Synchronous mode coalesces paint; worker mode commits versioned geometry. */
  public requestPaint() {
    if (!this.isReady()) return
    if (!this.getIsPagingMode() || this.isPrintMode()) {
      this.cancelPaint()
      this.paintRender(false)
      return
    }
    if (this.pendingPaint !== null) return
    this.pendingPaint = requestAnimationFrame(() => {
      this.pendingPaint = null
      if (this.isReady()) this.paintRender(true)
    })
  }

  private cancelPaint() {
    if (this.pendingPaint !== null) cancelAnimationFrame(this.pendingPaint)
    this.pendingPaint = null
  }

  /** Pixel readers/exporters can force a scheduled paint immediately. */
  public flushPaint() {
    this.flushGeometry()
    if (this.options.lab?.dirtyPagePaint && this.dirtyPages.size) {
      this.cancelPaint()
      this._immediateRender()
      this.dirtyPages.clear()
      return
    }
    if (this.pendingPaint === null) return
    this.cancelPaint()
    if (this.isReady()) this.paintRender(false)
  }

  /** Geometry commands may explicitly assert the current synchronous commit. */
  public flushGeometry() {
    if (this.pendingWorkerRender) {
      this.cancelWorkerCommitTimer()
      const payload = this.pendingWorkerRender
      const selection = this.pendingWorkerHistory
      this.pendingWorkerRender = null
      this.pendingWorkerHistory = null
      this.workerGeneration++
      this.trackedAsyncCommit = true
      try {
        this.render({ ...payload, isCompute: true })
        if (selection) Object.assign(selection, this.captureEditState())
      } finally {
        this.trackedAsyncCommit = false
        this.layoutHostAdapter.clearWorkerLayouts()
      }
    }
    if (this.geometryRevision !== this.modelRevision)
      this.render({ isSubmitHistory: false, isSetCursor: false })
    return this.geometryRevision
  }

  private paintRender(isLazy: boolean) {
    if (isLazy && this.getIsPagingMode()) this._lazyRender()
    else this._immediateRender()
  }

  private computeRenderGeometry(innerWidth: number, isPagingMode: boolean) {
    const { header, footer } = this.options
    // 清空拼写检查错词信息
    this.spellcheck.setSpellcheckRangeList(null)
    // 清空浮动元素位置信息
    this.position.setFloatPositionList([])
    if (isPagingMode) {
      // 分栏信息
      this.columnManager.compute()
      // 页眉信息
      if (!header.disabled) {
        this.header.compute()
      }
      // 页脚信息
      if (!footer.disabled) {
        this.footer.compute()
      }
    }
    const previousPages = this.pageRowList
    // 行信息
    const margins = this.getMargins()
    const pageHeight = this.getHeight()
    const extraHeight = this.header.getExtraHeight()
    const startX = margins[3]
    const startY = margins[0] + extraHeight
    const surroundElementList = pickSurroundElementList(this.elementList)
    const rowComputePayload: IComputeRowListPayload = {
      startX,
      startY,
      pageHeight,
      isPagingMode,
      innerWidth,
      surroundElementList,
      elementList: this.elementList,
      layoutScope: 'main',
      dirtyRange: this.dirtyRangeTracker.consumeDirtyRange(this.elementList)
    }
    this.rawRowList = this.computeRowList(rowComputePayload)
    // 分页模式下跨页表格在渲染层拆分为按页片段行
    if (isPagingMode) {
      this.rowList = this.tablePaging.splitTableRowAcrossPages(
        this.rawRowList
      )
    } else {
      this.rowList = this.rawRowList
    }
    // 页面信息（maxPageNo 截断会重置该标志）
    this.isElementListTruncated = false
    this.pageRowList = this._computePageList()
    this.layoutChange = changedLayoutPages(previousPages, this.pageRowList,
      this.incrementalFlow.reused, !this.usedIncrementalFlow, {
        scope: 'main', changedParagraphs: [...this.incrementalFlow.changed],
        indexShifts: [...this.incrementalFlow.shifts],
        documentRevision: this.getDocumentRevision(),
        geometryRevision: this.modelRevision,
        fontRevision: this.layoutHostAdapter.getFontManager().getRevision(),
        constraintsRevision: this.workerGeneration
      })
    this.position.computePositionList({
      fromPageNo: this.usedIncrementalFlow ? this.layoutChange.firstPage : 0
    })
    // 区域信息
    this.area.compute()
    if (!this.isPrintMode()) {
      // 搜索信息
      const searchKeyword = this.search.getSearchKeyword()
      if (searchKeyword) {
        this.search.compute(searchKeyword)
      }
      // 控件关键词高亮
      this.control.computeHighlightList()
    }
    // 涂鸦信息
    if (this.isGraffitiMode()) {
      this.graffiti.compute()
    }
  }

  private commitRenderPages(oldPageDirectionList: typeof this.pageDirectionList) {
    // 创建纸张
    for (let i = 0; i < this.pageRowList.length; i++) {
      if (!this.pageList[i]) {
        this._createPage(i)
      }
    }
    // 移除多余页
    const curPageCount = this.pageRowList.length
    const prePageCount = this.pageList.length
    if (prePageCount > curPageCount) {
      const deleteCount = prePageCount - curPageCount
      this.ctxList.splice(curPageCount, deleteCount)
      this.pageList
        .splice(curPageCount, deleteCount)
        .forEach(page => {
          this.lazyRenderIntersectionObserver?.unobserve(page)
          this.observedPages.delete(page)
          this.visiblePages.delete(page)
          this.dirtyPages.delete(Number(page.dataset.index))
          page.remove()
        })
    }
    const isPageDirectionChanged =
      oldPageDirectionList.length !== this.pageDirectionList.length ||
      oldPageDirectionList.some(
        (direction, index) => direction !== this.pageDirectionList[index]
      )
    if (isPageDirectionChanged) {
      this._updatePageSizes()
    }
  }

  private commitRenderHistory(
    curIndex: number | undefined,
    isSubmitHistory: boolean,
    isFirstRender: boolean
  ) {
    // 历史记录用于undo、redo（非首次渲染内容变更 || 第一次存在光标时）
    if (
      (isSubmitHistory && !isFirstRender) ||
      (curIndex !== undefined && this.historyManager.isStackEmpty())
    ) {
      this.submitHistory(curIndex)
    }
  }

  private notifyRender(payload: IDrawOption, oldPageSize: number) {
    const {
      isCompute = true, isSubmitHistory = true,
      isSourceHistory = false, isInit = false
    } = payload
    // Each edit retains its own notification, even if its paint is merged.
    nextTick(() => {
      if (!this.isReady()) return
      // 选区样式
      this.range.setRangeStyle()
      // 重新唤起弹窗类控件
      if (isCompute && this.control.getActiveControl()) {
        this.control.reAwakeControl()
      }
      // 表格工具重新渲染
      if (
        isCompute &&
        !this.isReadonly() &&
        this.position.getPositionContext().isTable
      ) {
        this.tableTool.render()
      }
      // 页眉指示器重新渲染
      if (isCompute && !this.zone.isMainActive()) {
        this.zone.drawZoneIndicator()
      }
      // 标尺重新渲染
      if (isCompute) {
        this.ruler.render()
      }
      // 页数改变
      if (oldPageSize !== this.pageRowList.length) {
        if (this.listener.pageSizeChange) {
          this.listener.pageSizeChange(this.pageRowList.length)
        }
        if (this.eventBus.isSubscribe('pageSizeChange')) {
          this.eventBus.emit('pageSizeChange', this.pageRowList.length)
        }
      }
      // 文档内容改变
      if ((isSubmitHistory || isSourceHistory) && !isInit) {
        if (this.listener.contentChange) {
          this.listener.contentChange()
        }
        if (this.eventBus.isSubscribe('contentChange')) {
          this.eventBus.emit('contentChange')
        }
      }
    })
  }

  public render(payload?: IDrawOption) {
    if (this.historyReplayDepth) {
      this.deferredHistoryRender = payload || {}
      return
    }
    if (
      this.lifecycle.state === 'destroyed' ||
      this.lifecycle.state === 'failed'
    ) {
      return
    }
    if (!this.layoutHostAdapter.isReady()) return
    this.renderCount++
    const {
      isSubmitHistory = true,
      isSetCursor = true,
      isLazy = true,
      isFirstRender = false
    } = payload || {}
    const isCompute = payload?.isCompute !== false ||
      this.geometryRevision !== this.modelRevision
    if (isCompute && !this.trackedAsyncCommit && this.deferWorkerRender(payload)) return
    const pendingSelection = !this.trackedAsyncCommit ? this.pendingWorkerHistory : null
    if (!this.trackedAsyncCommit) {
      this.cancelWorkerCommitTimer()
      this.pendingWorkerRender = null
      this.pendingWorkerHistory = null
      this.workerGeneration++
    }
    let { curIndex } = payload || {}
    const innerWidth = this.getInnerWidth()
    const isPagingMode = this.getIsPagingMode()
    // 缓存当前页数信息
    const oldPageSize = this.pageRowList.length
    const oldPageDirectionList = this.pageDirectionList
    // 计算文档信息
    if (isCompute) {
      if (this.options.lab?.incrementalEditing && !this.activeEdit?.trusted &&
        !this.historyFinalizing && !this.trackedAsyncCommit)
        this.layoutHostAdapter.clearParagraphCache()
      this.modelRevision++
      this.computeRenderGeometry(innerWidth, isPagingMode)
      this.geometryRevision = this.modelRevision
    }
    // 清除光标等副作用
    this.imageObserver.clearAll()
    this.cursor.recoveryCursor()
    this.commitRenderPages(oldPageDirectionList)
    if (this.options.lab?.dirtyPagePaint) {
      const changed = isCompute && this.layoutChange &&
        oldPageSize === this.pageRowList.length && this.usedIncrementalFlow
        ? this.layoutChange.changedPages
        : this.pageRowList.map((_, index) => index)
      for (const page of changed) this.dirtyPages.add(page)
    }
    if (
      payload?.isDeferredPaint && isLazy && isPagingMode && !this.isPrintMode()
    ) {
      this.requestPaint()
    } else {
      this.cancelPaint()
      this.paintRender(isLazy)
    }
    // 光标重绘
    if (isSetCursor) {
      curIndex = this.setCursor(curIndex)
    } else if (this.range.getIsSelection()) {
      // 存在选区时仅定位避免事件无法捕获
      this.cursor.focus()
    }
    if (pendingSelection) {
      const state = this.captureEditState()
      if (this.range.getIsCollapsed()) {
        state.cursorIndex = state.range.endIndex
        state.hint = null
      }
      Object.assign(pendingSelection, state)
    }
    if (isCompute && !this.trackedAsyncCommit) this.publishEditAtRender()
    if (isCompute && this.layoutChange)
      this.layoutChange.documentRevision = this.getDocumentRevision()
    this.commitRenderHistory(curIndex, isSubmitHistory, isFirstRender)
    if (isCompute) {
      this.renderedFontRevision = this.layoutHostAdapter
        .getFontManager()
        .getRevision()
    }
    if (
      isCompute ||
      this.auxiliaryCoverageSignature !== this.getAuxiliaryCoverageSignature()
    )
      this.updateFontCoverage()
    if (isCompute && this.eventBus.isSubscribe('renderChange')) {
      if (this.lifecycle.state === 'initializing') {
        // Initial render callbacks may query geometry only after ready settles.
        nextTick(() => {
          if (this.isReady()) this.eventBus.emit('renderChange')
        })
      } else {
        this.eventBus.emit('renderChange')
      }
    }
    this.notifyRender({ ...payload, isCompute }, oldPageSize)
    this.ensureLayoutWorker()
  }

  public setCursor(curIndex: number | undefined) {
    if (curIndex !== undefined) {
      const normalized = this.position.normalizeNativeIndex(curIndex)
      if (normalized !== curIndex && this.range.getIsCollapsed())
        this.range.setRange(normalized, normalized)
      curIndex = normalized
    }
    const positionContext = this.position.getPositionContext()
    const positionList = this.position.getPositionList()
    if (positionContext.isTable) {
      const elementList = this.getOriginalElementList()
      const tablePositionList = this.position.getTableTdByContext(
        elementList,
        positionContext
      )?.positionList
      if (tablePositionList?.length) {
        if (curIndex === undefined) {
          curIndex = tablePositionList.length - 1
        } else if (curIndex > tablePositionList.length - 1) {
          // 光标索引超出单元格位置（如内容被截断）：收缩到末尾有效位置
          curIndex = tablePositionList.length - 1
        }
      }
      const tablePosition = tablePositionList?.[curIndex!]
      this.position.setCursorPosition(tablePosition || null)
      // 跨页表格光标所在片段可能变化，光标确定后重新锚定表格工具
      this.tableTool.render()
    } else {
      this.position.setCursorPosition(
        curIndex !== undefined ? positionList[curIndex] : null
      )
    }
    // 定位到图片元素并且位置发生变化
    let isShowCursor = true
    if (
      curIndex !== undefined &&
      positionContext.isImage &&
      positionContext.isDirectHit
    ) {
      const elementList = this.getElementList()
      const element = elementList[curIndex]
      if (IMAGE_ELEMENT_TYPE.includes(element.type!)) {
        isShowCursor = false
        const position = this.position.getCursorPosition()
        this.previewer.updateResizer(element, position)
      }
    }
    const caret =
      curIndex !== undefined ? this.position.getNativeCaret(curIndex) : null
    if (caret && this.zone.isMainActive()) this.setPageNo(caret.pageNo)
    this.cursor.drawCursor({
      isShow: isShowCursor
    })
    return curIndex
  }

  private derivedState = new DerivedState()
  private editJournal = new EditJournal<EditSelection>()
  private activeEdit: PendingEdit | null = null
  private opaqueEditPending = false
  private trackedMutationDepth = 0
  private journalModel: EditDocument | null = null
  private scopeLabels = new WeakMap<IElement[], string>()
  private resolvedScopes = new WeakMap<EditDocument, Map<string, IElement[]>>()
  private historyReplayDepth = 0
  private historyMaintenance = false
  private historyFinalizing = false
  private historyBatchOpaque = false
  private historyBatchOperations: EditOperation[] = []
  private historyPublication: {
    operations: EditOperation[]; opaque: boolean; maintenance: boolean
    before: EditSelection; after: EditSelection; source: 'undo' | 'redo' | 'rollback'
  } | null = null
  private deferredHistoryRender: IDrawOption | null = null

  public getDerivedState() { return this.derivedState }

  public getDerivedWordCount() {
    if (!this.options.lab?.incrementalEditing || !this.options.lab?.incrementalCoverage)
      return null
    return this.derivedState.wordCount(this.elementList, this.layoutHostAdapter.paragraphs)
  }

  public getDerivedCatalogSignature() {
    if (!this.options.lab?.incrementalEditing || !this.options.lab?.incrementalCoverage)
      return null
    return this.derivedState.catalogSignature(this.elementList,
      this.position.getOriginalMainPositionList(), this.layoutHostAdapter.paragraphs)
  }

  public getDocumentRevision() { return this.editJournal.getRevision() }
  public getEditJournal() { return this.editJournal }

  private captureEditState(): EditSelection {
    return { cursorIndex: this.pendingWorkerRender ? this.range.getRange().endIndex
      : this.position.getCursorPosition()?.index ?? this.range.getRange().endIndex,
      hint: this.pendingWorkerRender ? null : deepClone(this.position.getNativeCaretHint()),
      range: deepClone(this.range.getRange()),
      context: deepClone(this.position.getPositionContext()),
      zone: this.zone.getZone(), pageNo: this.pageNo }
  }

  private restoreEditState(state: EditSelection) {
    this.zone.setZone(state.zone)
    this.setPageNo(state.pageNo)
    this.position.setPositionContext(deepClone(state.context))
    this.range.replaceRange(deepClone(state.range))
    this.position.setNativeCaretHint(deepClone(state.hint))
  }

  private captureEditModel(): EditDocument {
    return { main: getSlimCloneElementList(this.elementList),
      header: getSlimCloneElementList(this.header.getElementList()),
      footer: getSlimCloneElementList(this.footer.getElementList()) }
  }

  private replaceEditModel(model: EditDocument) {
    this.elementList = model.main
    this.header.setElementList(model.header)
    this.footer.setElementList(model.footer)
  }

  private resolveEditScope(scope: string, model?: EditDocument): IElement[] {
    const roots = model || { main: this.elementList,
      header: this.header.getElementList(), footer: this.footer.getElementList() }
    if (scope === 'main' || scope === 'header' || scope === 'footer') return roots[scope]
    const cached = model && this.resolvedScopes.get(model)?.get(scope)
    if (cached) return cached
    const find = (elements: IElement[]): IElement[] | undefined => {
      for (const element of elements)
        for (const row of element.trList || [])
          for (const cell of row.tdList) {
            if (`td:${cell.id}` === scope) return cell.value
            const nested = find(cell.value)
            if (nested) return nested
          }
      return undefined
    }
    for (const elements of Object.values(roots)) {
      const found = find(elements)
      if (found) {
        if (model) {
          const scopes = this.resolvedScopes.get(model) || new Map<string, IElement[]>()
          scopes.set(scope, found)
          this.resolvedScopes.set(model, scopes)
        }
        return found
      }
    }
    throw new Error(`Transaction scope not found: ${scope}`)
  }

  private editScope(elements: IElement[]): string | undefined {
    if (elements === this.elementList) return 'main'
    if (elements === this.header.getElementList()) return 'header'
    if (elements === this.footer.getElementList()) return 'footer'
    const cached = this.scopeLabels.get(elements)
    if (cached) return cached
    const visit = (list: IElement[]): string | undefined => {
      for (const element of list)
        for (const row of element.trList || [])
          for (const cell of row.tdList) {
            if (cell.value === elements && cell.id) return `td:${cell.id}`
            const scope = visit(cell.value)
            if (scope) return scope
          }
      return undefined
    }
    const scope = visit(this.elementList) || visit(this.header.getElementList()) ||
      visit(this.footer.getElementList())
    if (scope) this.scopeLabels.set(elements, scope)
    return scope
  }

  private isPlainEdit(kind: string) {
    if (!['input', 'paste', 'backspace', 'delete', 'composition', 'attributes'].includes(kind) ||
      !this.options.trace.disabled) return false
    const range = this.range.getRange()
    if (range.isCrossRowCol || range.startIndex < 0) return false
    if (range.endIndex - range.startIndex > 4096) return false
    const elements = this.getElementList()
    const index = this.layoutHostAdapter.paragraphs.get(elements)
    return index.between(Math.max(0, range.startIndex - 1), range.endIndex + 3)
      .every(record => record.editable)
  }

  public beginEditTransaction(kind: string, groupable = true) {
    if (!this.options.lab?.incrementalEditing || this.historyReplayDepth) return
    if (this.activeEdit) { this.activeEdit.depth++; return }
    if (this.opaqueEditPending && this.journalModel) this.publishEditAtRender()
    if (!this.journalModel) this.journalModel = this.captureEditModel()
    if (this.options.historyMaxRecordCount && this.historyManager.isStackEmpty())
      this.historyManager.execute(this.createHistorySnapshot())
    const before = this.captureEditState()
    const trusted = this.isPlainEdit(kind)
    this.activeEdit = { kind, before, publishedState: before, operations: [],
      published: 0, publishedModel: false, trusted, history: false, groupable,
      started: performance.now(), depth: 1,
      snapshot: trusted ? undefined : this.captureEditModel() }
  }

  private promoteSnapshotEdit() {
    const edit = this.activeEdit
    if (!edit?.trusted || !this.journalModel) return
    const original = structuredClone(this.journalModel)
    for (const operation of edit.operations.slice(0, edit.published).reverse())
      applyOperation(inverseOperation(operation), scope => this.resolveEditScope(scope, original))
    edit.snapshot = original
    edit.trusted = false
  }

  private changeAttribute(element: IElement, key: keyof IElement,
    present: boolean, value?: unknown) {
    const owner = this.options.lab?.incrementalEditing
      ? this.layoutHostAdapter.paragraphs.owner(element) : undefined
    const location = owner?.location(element)
    const scope = owner && this.activeEdit ? this.editScope(owner.elements) : undefined
    const before = { present: Object.hasOwn(element, key), value: element[key] }
    if (scope && location) this.recordEdit({ kind: 'attributes', scope,
      index: location.start + location.record.elements.indexOf(element),
      before: { [key]: before }, after: { [key]: { present, value } } })
    if (present) Reflect.set(element, key, value)
    else Reflect.deleteProperty(element, key)
    this.modelRevision++
    if (this.activeEdit?.trusted && owner && location &&
      !['value', 'type', 'areaId', 'imgDisplay', 'listId', 'controlId',
        'titleId', 'title', 'area', 'control', 'groupIds', 'listType', 'listStyle',
        'listWrap', 'listLevel', 'trace', 'hide'].includes(key)) {
      owner.touch(element, ['color', 'highlight', 'underline', 'strikeout'].includes(key)
        ? 'paint' : 'metrics')
      this.markTrackedRange(owner.elements, location.start, 0, 0)
    } else this.dirtyRangeTracker.markFullDirty()
  }

  private recordEdit(operation: EditOperation) {
    if (this.activeEdit?.trusted && !this.historyReplayDepth)
      this.activeEdit.operations.push(structuredClone(operation))
  }

  private publishHistoryAtRender() {
    const pending = this.historyPublication
    if (!pending) return false
    this.historyPublication = null
    if (!this.options.lab?.incrementalEditing || !this.journalModel) return true
    const after = this.captureEditState()
    if (pending.maintenance) {
      this.journalModel = this.captureEditModel()
      this.derivedState.clear()
    } else if (pending.opaque) {
      const current = this.captureEditModel()
      this.editJournal.publish(pending.source, [{ kind: 'snapshot', scope: 'document',
        before: this.journalModel, after: current }], pending.before, after, pending.source)
      this.journalModel = current
    } else {
      for (const operation of pending.operations)
        applyOperation(operation, scope => this.resolveEditScope(scope, this.journalModel!),
          model => { this.journalModel = model })
      this.editJournal.publish(pending.source, pending.operations, pending.before, after, pending.source)
    }
    this.scopeLabels = new WeakMap()
    return true
  }

  private publishEditAtRender() {
    if (this.publishHistoryAtRender()) return
    if (!this.options.lab?.incrementalEditing || this.historyReplayDepth ||
      this.historyFinalizing) return
    if (this.historyMaintenance) {
      this.journalModel = this.captureEditModel()
      this.layoutHostAdapter.clearParagraphCache()
      return
    }
    if (!this.journalModel) this.journalModel = this.captureEditModel()
    const edit = this.activeEdit
    const after = this.captureEditState()
    if (edit?.trusted) {
      const operations = edit.operations.slice(edit.published)
      const before = edit.publishedState
      edit.published = edit.operations.length
      edit.publishedState = after
      if (operations.length) edit.publishedModel = true
      for (const operation of operations)
        applyOperation(operation, scope => this.resolveEditScope(scope, this.journalModel!),
          model => { this.journalModel = model })
      this.editJournal.publish(edit.kind, operations, before, after)
    } else {
      const current = this.captureEditModel()
      if (JSON.stringify(current) !== JSON.stringify(this.journalModel)) {
        if (edit) edit.publishedModel = true
        this.editJournal.publish(edit?.kind || 'snapshot', [{ kind: 'snapshot',
          scope: 'document', before: this.journalModel, after: current }],
          edit?.publishedState || after, after, 'snapshot')
        this.journalModel = current
        this.scopeLabels = new WeakMap()
      }
      if (edit) edit.publishedState = after
      this.opaqueEditPending = false
    }
  }

  public commitEditTransaction() {
    const edit = this.activeEdit
    if (!edit || --edit.depth > 0) return
    this.publishEditAtRender()
    this.activeEdit = null
    if (!edit.history || !this.options.historyMaxRecordCount) return
    const after = this.captureEditState()
    if (this.pendingWorkerRender) this.pendingWorkerHistory = after
    if (edit.trusted && edit.operations.length && this.options.lab?.transactionHistory) {
      const operations = edit.operations
      const scope = operations[0].scope
      this.historyManager.executeDelta({
        kind: edit.kind, scope, from: edit.before.range.endIndex,
        to: after.range.endIndex, time: edit.started,
        groupable: edit.groupable && edit.before.range.startIndex === edit.before.range.endIndex &&
          after.range.startIndex === after.range.endIndex &&
          operations.every(operation => operation.kind === 'splice' &&
            operation.scope === scope && ![...operation.before, ...operation.after]
              .some(element => element.value === ZERO)),
        bytes: JSON.stringify(operations).length * 2,
        undo: () => this.replayEdit(operations.slice().reverse().map(inverseOperation), edit.before, 'undo'),
        redo: () => this.replayEdit(operations, after, 'redo')
      })
    } else if (!edit.trusted || edit.operations.length)
      this.historyManager.execute(this.createHistorySnapshot())
  }

  public rollbackEditTransaction() {
    const edit = this.activeEdit
    if (!edit) return
    this.activeEdit = null
    let published: EditOperation[]
    if (edit.snapshot) {
      this.replaceEditModel(structuredClone(edit.snapshot))
      published = edit.publishedModel ? [{ kind: 'snapshot', scope: 'document',
        before: this.journalModel!, after: edit.snapshot }] : []
    } else {
      const inverse = edit.operations.slice().reverse().map(inverseOperation)
      for (const operation of inverse)
        applyOperation(operation, scope => this.resolveEditScope(scope))
      published = edit.operations.slice(0, edit.published).reverse().map(inverseOperation)
    }
    // Publish at the same atomic geometry commit point as undo/redo, not before it.
    this.historyPublication = { operations: published, opaque: false,
      maintenance: false, before: edit.publishedState, after: edit.before,
      source: 'rollback' }
    this.restoreEditState(edit.before)
    this.layoutHostAdapter.clearParagraphCache()
    this.modelRevision++
    this.render({ isSubmitHistory: false, curIndex: edit.before.cursorIndex })
  }

  public runEditTransaction<T>(kind: string, action: () => T, groupable = true): T {
    this.beginEditTransaction(kind, groupable)
    try {
      const result = action()
      this.commitEditTransaction()
      return result
    } catch (error) {
      this.rollbackEditTransaction()
      throw error
    }
  }

  private replayEdit(operations: EditOperation[], state: EditSelection,
    source: 'undo' | 'redo' | 'rollback') {
    const before = this.captureEditState()
    for (const operation of operations)
      applyOperation(operation, scope => this.resolveEditScope(scope),
        model => this.replaceEditModel(model))
    if (this.historyReplayDepth) this.historyBatchOperations.push(...operations)
    else {
      if (!this.historyMaintenance) this.editJournal.publish(source, operations, before, state, source)
      if (this.journalModel)
        for (const operation of operations)
          applyOperation(operation, scope => this.resolveEditScope(scope, this.journalModel!),
            model => { this.journalModel = model })
    }
    this.restoreEditState(state)
    this.layoutHostAdapter.clearParagraphCache()
    this.dirtyRangeTracker.markFullDirty()
    this.modelRevision++
    this.render({ isSubmitHistory: false, isSourceHistory: source !== 'rollback',
      curIndex: state.cursorIndex })
  }

  public replayHistoryBatch(action: () => void, maintenance = false,
    source: 'undo' | 'redo' = 'undo') {
    const outer = !this.historyReplayDepth
    const before = this.captureEditState()
    if (outer) {
      this.historyBatchOpaque = false
      this.historyBatchOperations = []
    }
    this.historyReplayDepth++
    const oldMaintenance = this.historyMaintenance
    this.historyMaintenance ||= maintenance
    try { action() } finally {
      this.historyReplayDepth--
      if (outer) {
        this.historyPublication = {
          operations: this.historyBatchOperations, opaque: this.historyBatchOpaque,
          before, after: this.captureEditState(), source, maintenance
        }
        this.historyBatchOperations = []
        this.historyFinalizing = true
        const payload = this.deferredHistoryRender
        this.deferredHistoryRender = null
        try {
          if (payload) this.render({ ...payload, isCompute: true,
            isSourceHistory: !maintenance })
          else this.publishHistoryAtRender()
        } finally {
          this.historyFinalizing = false
          this.opaqueEditPending = false
        }
      }
      this.historyMaintenance = oldMaintenance
    }
  }

  private markTrackedRange(elements: IElement[], start: number,
    count: number, inserted: number) {
    this.trackedMutationDepth++
    try { this.dirtyRangeTracker.markRangeDirty(elements, start, count, inserted) }
    finally { this.trackedMutationDepth-- }
  }

  private performElementInsert(elements: IElement[], start: number, items: IElement[]) {
    if (items.length > 4096 || items.some(element =>
      (element.type && element.type !== ElementType.TEXT) || element.controlId ||
      element.listId || element.titleId || element.areaId || element.trList))
      this.promoteSnapshotEdit()
    const scope = this.activeEdit?.trusted ? this.editScope(elements) : undefined
    const index = Math.min(Math.max(start, 0), elements.length)
    // Do not spread large pastes into splice's argument list.
    for (let i = 0; i < items.length; i++) elements.splice(start + i, 0, items[i])
    if (scope) this.recordEdit({ kind: 'splice', scope, index,
      before: [], after: getSlimCloneElementList(items) })
  }

  private performElementSplice(elements: IElement[], index: number,
    count: number, items: IElement[] = []) {
    const offset = index < 0 ? Math.max(0, elements.length + index) : Math.min(index, elements.length)
    const scope = this.activeEdit?.trusted ? this.editScope(elements) : undefined
    const before = scope ? getSlimCloneElementList(elements.slice(offset, offset + count)) : []
    if ([...before, ...items].some(element =>
      (element.type && element.type !== ElementType.TEXT) || element.controlId ||
      element.listId || element.titleId || element.areaId || element.trList))
      this.promoteSnapshotEdit()
    elements.splice(offset, count, ...items)
    if (scope && (before.length || items.length)) this.recordEdit({ kind: 'splice', scope,
      index: offset, before, after: getSlimCloneElementList(items) })
  }

  public submitHistory(curIndex: number | undefined) {
    if (this.options.historyMaxRecordCount === 0) return
    if (this.activeEdit) { this.activeEdit.history = true; return }
    this.historyManager.execute(this.createHistorySnapshot(curIndex))
  }

  public createHistorySnapshot(curIndex = this.range.getRange().endIndex) {
    const positionContext = this.position.getPositionContext()
    const oldElementList = getSlimCloneElementList(this.elementList)
    const oldHeaderElementList = getSlimCloneElementList(
      this.header.getElementList()
    )
    const oldFooterElementList = getSlimCloneElementList(
      this.footer.getElementList()
    )
    const oldRange = deepClone(this.range.getRange())
    const pageNo = this.pageNo
    const oldPositionContext = deepClone(positionContext)
    const zone = this.zone.getZone()
    const restore = () => {
      if (this.historyReplayDepth) this.historyBatchOpaque = true
      this.layoutHostAdapter.clearParagraphCache()
      this.dirtyRangeTracker.markFullDirty()
      this.zone.setZone(zone)
      this.setPageNo(pageNo)
      this.position.setPositionContext(deepClone(oldPositionContext))
      this.header.setElementList(getSlimCloneElementList(oldHeaderElementList))
      this.footer.setElementList(getSlimCloneElementList(oldFooterElementList))
      this.elementList = getSlimCloneElementList(oldElementList)
      this.range.replaceRange(deepClone(oldRange))
      this.render({
        curIndex,
        isSubmitHistory: false,
        isSourceHistory: true
      })
    }
    return Object.assign(restore, { estimatedBytes: JSON.stringify([
      oldElementList, oldHeaderElementList, oldFooterElementList
    ]).length * 2 })
  }

  public destroy() {
    if (!this.lifecycle.destroy()) return
    this.pendingFontCoverage = null
    this.coveragePublishedSignature = ''
    this.workerGeneration++
    this.layoutWorkerClient?.destroy()
    this.layoutWorkerClient = null
    if (this.workerRecoveryTimer !== null) clearTimeout(this.workerRecoveryTimer)
    this.workerRecoveryTimer = null
    this.cancelWorkerCommitTimer()
    this.pendingWorkerRender = null
    this.pendingWorkerHistory = null
    this.derivedState.clear()
    this.incrementalFlow.clear()
    this.editJournal.destroy()
    this.activeEdit = null
    this.journalModel = null
    this.scopeLabels = new WeakMap()
    this.resolvedScopes = new WeakMap()
    this.historyManager.recovery()
    this.fontDiagnostics.destroy()
    this.fontDownloadManager.destroy()
    this.fontCoverageTracker.destroy()
    this.layoutHostAdapter.destroy()
    this.cancelPaint()
    this.position.destroy()
    for (const event of this.guardedEvents) {
      this.container.removeEventListener(event, this.interactionGuard, true)
    }
    this.cursor.recoveryCursor()
    this.container.remove()
    this.globalEvent.removeEvent()
    this.scrollObserver.removeEvent()
    this.selectionObserver.removeEvent()
    this.workerManager.destroy()
    this.magnifier.destroy()
    this.accessibility.destroy()
    this.ruler.dispose()
    this._disconnectLazyRender()
    this.dirtyPages.clear()
  }

  public clearSideEffect() {
    // 预览工具组件
    this.getPreviewer().clearResizer()
    // 表格工具组件
    this.getTableTool().dispose()
    // 超链接弹窗
    this.getHyperlinkParticle().clearHyperlinkPopup()
    // 悬浮提示弹窗
    this.getHintParticle().clearHintPopup()
    // 留痕悬浮弹窗
    this.getTraceParticle().clearTracePopup()
    // 日期控件
    this.getDateParticle().clearDatePicker()
  }
}

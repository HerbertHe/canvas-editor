import { NativeQueryIndex } from '../layout/NativeQueryIndex'
import { getTextLineOrigin } from '../layout/relativeLayout'
import type { TextLine } from '../../interface/Layout'
import type { LayoutRow } from '../../interface/LayoutRow'
import { getHostRowsHeight } from '../layout/hostRowGeometry'
import {
  LineGeometryCache,
  NativeRowIndex
} from '../layout/LineGeometryIndex'
import {
  hitTextLine,
  intersectRect,
  lineCarets,
  lineSegments,
  pageRect,
  textRangeRects,
  type NativeCaret,
  type PlacedTextLine
} from '../layout/InteractionGeometry'
import { rowElementMetrics, rowSourceIndex } from '../layout/rowGeometry'
import { getCellVerticalOffset } from '../layout/TableLayout'
import { ElementType, ListStyle, RowFlex, VerticalAlign } from '../..'
import { ZERO } from '../../dataset/constant/Common'
import { ControlComponent, ControlType } from '../../dataset/enum/Control'
import { IEditorOption } from '../../interface/Editor'
import { IElement, IElementPosition } from '../../interface/Element'
import { ITd } from '../../interface/table/Td'
import {
  IComputePageRowPositionPayload,
  IComputePageRowPositionResult,
  IComputePositionListPayload,
  IComputeRowPositionPayload,
  ICurrentPosition,
  IFloatPosition,
  IGetFloatPositionByXYPayload,
  IGetPositionByXYPayload,
  IPositionContext,
  ITablePositionContext
} from '../../interface/Position'
import { Draw } from '../draw/Draw'
import { EditorMode, EditorZone } from '../../dataset/enum/Editor'
import { deepClone } from '../../utils'
import { ImageDisplay } from '../../dataset/enum/Common'
import { DeepRequired } from '../../interface/Common'
import { EventBus } from '../event/eventbus/EventBus'
import { EventBusMap } from '../../interface/EventBus'

// 单页新增位置信息的缓存切片
interface IPagePositionCache {
  nativeLines: PlacedTextLine[]
  positionList: IElementPosition[]
  floatPositionList: IFloatPosition[]
  tablePagingPositionList: IElementPosition[]
}

export class Position {
  private cursorPosition: IElementPosition | null
  private positionContext: IPositionContext
  private positionList: IElementPosition[]
  // 表格跨页片段位置列表（含全部片段；主列表仅保留首片段以维持下标对齐）
  private tablePagingPositionList: IElementPosition[]
  // 片段位置按页索引（命中与片段查找只扫当前页，避免全表线性扫描）
  private tablePagingPositionMap: Map<number, IElementPosition[]>
  private floatPositionList: IFloatPosition[]
  // 每页新增位置信息的缓存：行级增量计算后首个变动页之前的页可直接复用
  private pagePositionCacheList: IPagePositionCache[]

  private draw: Draw
  private eventBus: EventBus<EventBusMap>
  private options: DeepRequired<IEditorOption>

  private nativeLines = new WeakMap<IElementPosition[], PlacedTextLine[]>()
  private nativeRows = new WeakMap<IElementPosition[], NativeRowIndex>()
  private lineGeometry = new LineGeometryCache()
  private nativeQueries = new WeakMap<IElementPosition[], NativeQueryIndex>()
  private nativeCaretHint: NativeCaret | null = null
  private placementStats = { computedElements: 0, reusedElements: 0 }
  public getPlacementStats() { return { ...this.placementStats } }
  private rowPositions = new WeakMap<TextLine, {
    key: string
    delta: number
    rowIndex: number
    rowNo: number
    positions: IElementPosition[]
  }>()

  public getNativeLines(positions = this.getPositionList()): PlacedTextLine[] {
    return this.nativeLines.get(positions) || []
  }

  public getNativeRow(
    row: LayoutRow,
    positions: IElementPosition[],
    pageNo?: number
  ) {
    if (!row.nativeLine) return undefined
    return this.nativeRows.get(positions)?.find(row.nativeLine, pageNo)
  }

  public getNativeRangeRects(
    start: number,
    end: number,
    positions = this.getPositionList(),
    pageNo?: number
  ) {
    return this.getNativeLines(positions).flatMap(placed => {
      const frame = /^(header|footer):/.test(placed.line.source.scope)
      if (pageNo !== undefined && !frame && pageNo !== placed.pageNo) return []
      return textRangeRects(placed, start, end).map(rect => ({
        ...rect,
        pageNo: frame && pageNo !== undefined ? pageNo : placed.pageNo,
        lineId: placed.line.id
      }))
    })
  }

  public getNativeCaretHint() { return this.nativeCaretHint }

  public setNativeCaretHint(caret: NativeCaret | null) {
    this.nativeCaretHint = caret
  }

  private getNativeQuery(positions = this.getPositionList()) {
    let query = this.nativeQueries.get(positions)
    if (!query) {
      query = NativeQueryIndex.create(
        this.getNativeLines(positions), this.lineGeometry,
        !!this.options.lab?.incrementalFlow
      )
      this.nativeQueries.set(positions, query)
    }
    return query
  }

  public getNativeCaret(index: number, hitLineStartIndex?: number) {
    return this.getNativeQuery().caret(
      index, this.nativeCaretHint, hitLineStartIndex
    )
  }

  public normalizeNativeIndex(index: number, bias: 'before' | 'after' = 'after') {
    return this.getNativeQuery().normalize(index, bias)
  }

  public getNativeCaretAtX(
    positions: IElementPosition[], index: number, x: number, pageNo?: number
  ) {
    return this.getNativeQuery(positions).atX(index, x, pageNo)
  }

  public moveNativeCaret(
    index: number, delta: 1 | -1, visual = true, vertical = false
  ): NativeCaret | null {
    const query = this.getNativeQuery()
    const current = query.caret(index, this.nativeCaretHint)
    return current ? query.move(current, delta, visual, vertical) : null
  }

  public getNativeDeleteRange(index: number, backward: boolean, visual: boolean) {
    const query = this.getNativeQuery()
    const current = query.caret(index, this.nativeCaretHint)
    return current ? query.deleteRange(current, backward, visual) : null
  }

  private hitNativeText(
    x: number,
    y: number,
    pageNo: number,
    positions: IElementPosition[],
    elements: IElement[]
  ): ICurrentPosition | null {
    const lines = this.getNativeLines(positions).filter(placed => {
      const { line, scale } = placed
      const frame = /^(header|footer):/.test(line.source.scope)
      const rect = pageRect(placed, line.rect)
      if (
        placed.clip &&
        (x < placed.clip.x ||
          x > placed.clip.x + placed.clip.width ||
          y < placed.clip.y ||
          y > placed.clip.y + placed.clip.height)
      )
        return false
      return (
        !line.hidden &&
        (frame || placed.pageNo === pageNo) &&
        y >= rect.y - line.spacingBefore * scale &&
        y <= rect.y + rect.height + line.spacingAfter * scale
      )
    })
    if (!lines.length) return null
    const column = this._getColumnIndexByX(x, pageNo)
    const placed =
      lines.find(
        p => p.columnIndex === undefined || p.columnIndex === column
      ) || lines[0]
    const inside = (rect: import('../../interface/Layout').LayoutRect) => {
      const box = pageRect(placed, rect)
      return (
        x >= box.x &&
        x <= box.x + box.width &&
        y >= box.y &&
        y <= box.y + box.height
      )
    }
    const inline = placed.line.inlines.find(
      n =>
        n.kind === 'inlineObject' &&
        n.objectType !== 'controlSpace' &&
        !n.hidden &&
        inside(n.rect)
    )
    if (inline?.kind === 'inlineObject') {
      const element = elements[inline.source.start]
      return {
        index: inline.source.start,
        isDirectHit: true,
        isImage: inline.objectType === 'image' || inline.objectType === 'latex',
        isCheckbox: inline.objectType === 'checkbox',
        isRadio: inline.objectType === 'radio',
        isControl: !!element?.controlId
      }
    }
    const label = placed.line.labels?.find(n => inside(n.rect))
    if (label)
      return { index: label.source.start, isDirectHit: true, isLabel: true }
    let caret = hitTextLine(placed, x)
    if (!caret) return null
    const segment = lineSegments(placed).find(
      s => x >= s.rect.x && x <= s.rect.x + s.rect.width
    )
    const owner = segment ? elements[segment.start] : undefined
    // A checkbox/radio label is an action target, not a text caret. The
    // nearest caret may belong to the preceding box at the label's left edge.
    if (
      owner?.controlComponent === ControlComponent.VALUE &&
      (owner.control?.type === ControlType.CHECKBOX ||
        owner.control?.type === ControlType.RADIO)
    )
      return { index: segment!.start, isDirectHit: true, isControl: true }
    if (
      owner?.controlId &&
      elements[caret.index]?.controlId !== owner.controlId
    ) {
      const internal = lineCarets(placed).filter(
        c => elements[c.index]?.controlId === owner.controlId
      )
      caret =
        internal.reduce(
          (a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a),
          internal[0]
        ) || caret
    }
    return {
      index: caret.index,
      nativeCaret: caret,
      isDirectHit: !!segment,
      isControl: !!elements[caret.index]?.controlId,
      hitLineStartIndex:
        caret.index < placed.line.source.start
          ? placed.line.source.start
          : undefined
    }
  }

  constructor(draw: Draw) {
    this.positionList = []
    this.tablePagingPositionList = []
    this.tablePagingPositionMap = new Map()
    this.floatPositionList = []
    this.pagePositionCacheList = []
    this.cursorPosition = null
    this.positionContext = {
      isTable: false,
      isControl: false
    }

    this.draw = draw
    this.eventBus = draw.getEventBus()
    this.options = draw.getOptions()
  }

  public getFloatPositionList(): IFloatPosition[] {
    return this.floatPositionList
  }

  public getTablePagingPositionList(): IElementPosition[] {
    return this.tablePagingPositionList
  }

  // 按元素索引与页码查找表格跨页片段位置；
  // 同页存在多个片段（分栏）时按锚点坐标所属片段进一步区分
  public getTableFragmentPosition(
    index: number,
    pageNo: number,
    anchorPosition?: IElementPosition | null
  ): IElementPosition | null {
    const pagePositionList = this.tablePagingPositionMap.get(pageNo)
    if (!pagePositionList?.length) return null
    const fragmentPositionList = pagePositionList.filter(
      position => position.index === index
    )
    if (fragmentPositionList.length <= 1) {
      return fragmentPositionList[0] || null
    }
    if (anchorPosition) {
      const {
        coordinate: { leftTop, rightBottom }
      } = anchorPosition
      const matched = fragmentPositionList.find(position => {
        const {
          leftTop: fragLeftTop,
          rightTop: fragRightTop,
          leftBottom: fragLeftBottom
        } = position.coordinate
        return (
          leftTop[0] >= fragLeftTop[0] &&
          rightBottom[0] <= fragRightTop[0] &&
          leftTop[1] >= fragLeftTop[1] &&
          rightBottom[1] <= fragLeftBottom[1]
        )
      })
      if (matched) return matched
    }
    return fragmentPositionList[0]
  }

  public getTablePositionList(
    sourceElementList: IElement[]
  ): IElementPosition[] {
    const zone = this.draw.getZone()
    const direction = this.draw.getPageDirection(this.draw.getPageNo())
    if (zone.isHeaderActive()) this.draw.getHeader().getPositionList(direction)
    else if (zone.isFooterActive())
      this.draw.getFooter().getPositionList(direction)
    return (
      this.getTableTdByContext(sourceElementList, this.positionContext)
        ?.positionList || []
    )
  }

  public getTableTdByContext(
    sourceElementList: IElement[],
    context: IPositionContext
  ) {
    const tablePath = context.tablePath?.length
      ? context.tablePath
      : this._getTablePathByContext(context)
    let elementList = sourceElementList
    let td = null
    for (let p = 0; p < tablePath.length; p++) {
      const { index, trIndex, tdIndex } = tablePath[p]
      td = elementList[index]?.trList?.[trIndex]?.tdList[tdIndex] || null
      if (!td) return null
      elementList = td.value
    }
    return td
  }

  public buildTablePositionContext(
    context: IPositionContext,
    element: IElement,
    trIndex: number,
    tdIndex: number
  ): IPositionContext {
    const tr = element.trList![trIndex]
    const td = tr.tdList[tdIndex]
    const tablePath = context.tablePath?.length
      ? context.tablePath.map((item, itemIndex, tablePath) =>
          itemIndex === tablePath.length - 1
            ? {
                ...item,
                trIndex,
                tdIndex,
                tdId: td.id,
                trId: tr.id,
                tableId: element.id
              }
            : item
        )
      : undefined
    return {
      ...context,
      isTable: true,
      trIndex,
      tdIndex,
      tdId: td.id,
      trId: tr.id,
      tableId: element.id,
      tablePath
    }
  }

  public getTableElementByContext(
    sourceElementList: IElement[],
    context: IPositionContext
  ) {
    const tablePath = context.tablePath?.length
      ? context.tablePath
      : this._getTablePathByContext(context)
    let elementList = sourceElementList
    let tableElement = null
    for (let p = 0; p < tablePath.length; p++) {
      const { index, trIndex, tdIndex } = tablePath[p]
      tableElement = elementList[index] || null
      if (!tableElement) return null
      if (p === tablePath.length - 1) break
      const td = tableElement.trList?.[trIndex]?.tdList[tdIndex]
      if (!td) return null
      elementList = td.value
    }
    return tableElement
  }

  public getTableElementPositionByContext(
    sourceElementList: IElement[],
    sourcePositionList: IElementPosition[],
    context: IPositionContext
  ) {
    const tablePath = context.tablePath?.length
      ? context.tablePath
      : this._getTablePathByContext(context)
    let elementList = sourceElementList
    let positionList = sourcePositionList
    let tablePosition = null
    for (let p = 0; p < tablePath.length; p++) {
      const { index, trIndex, tdIndex } = tablePath[p]
      tablePosition = positionList[index] || null
      const tableElement = elementList[index]
      if (!tablePosition || !tableElement) return null
      if (p === tablePath.length - 1) break
      const td = tableElement.trList?.[trIndex]?.tdList[tdIndex]
      if (!td) return null
      elementList = td.value
      positionList = td.positionList || []
    }
    // 表格跨页拆分渲染时定位到光标所在片段
    if (tablePosition?.tableFragment) {
      const td = this.getTableTdByContext(sourceElementList, context)
      // 单元格可能跨页，优先取光标实际所在位置页码
      const cursorPosition = this.getCursorPosition()
      const isCursorInTd =
        !!td && !!cursorPosition && !!td.positionList?.includes(cursorPosition)
      const tdPageNo = isCursorInTd
        ? cursorPosition!.pageNo
        : td?.positionList?.[0]?.pageNo
      if (tdPageNo !== undefined) {
        const fragmentPosition = this.getTableFragmentPosition(
          tablePosition.index,
          tdPageNo,
          // 同页多栏片段按光标（或单元格首个位置）坐标区分所属片段
          isCursorInTd ? cursorPosition : td?.positionList?.[0]
        )
        if (fragmentPosition) return fragmentPosition
      }
    }
    return tablePosition
  }

  private _getTablePathByContext(
    context: IPositionContext
  ): ITablePositionContext[] {
    const { isTable, index, trIndex, tdIndex, tdId, trId, tableId } = context
    if (
      !isTable ||
      index === undefined ||
      trIndex === undefined ||
      tdIndex === undefined
    ) {
      return []
    }
    return [
      {
        index,
        trIndex,
        tdIndex,
        tdId,
        trId,
        tableId
      }
    ]
  }

  public getPositionList(): IElementPosition[] {
    return this.positionContext.isTable
      ? this.getTablePositionList(this.draw.getOriginalElementList())
      : this.getOriginalPositionList()
  }

  public getMainPositionList(): IElementPosition[] {
    return this.positionContext.isTable
      ? this.getTablePositionList(this.draw.getOriginalMainElementList())
      : this.positionList
  }

  public getOriginalPositionList(
    pageNo = this.draw.getPageNo()
  ): IElementPosition[] {
    const zoneManager = this.draw.getZone()
    // 混排横竖版：页眉/页脚按当前页方向取布局
    const direction = this.draw.getPageDirection(pageNo)
    if (zoneManager.isHeaderActive()) {
      const header = this.draw.getHeader()
      return header.getPositionList(direction)
    }
    if (zoneManager.isFooterActive()) {
      const footer = this.draw.getFooter()
      return footer.getPositionList(direction)
    }
    return this.positionList
  }

  public getOriginalMainPositionList(): IElementPosition[] {
    return this.positionList
  }

  public getSelectionPositionList(): IElementPosition[] | null {
    const { startIndex, endIndex } = this.draw.getRange().getRange()
    if (startIndex === endIndex) return null
    const positionList = this.getPositionList()
    return positionList.slice(startIndex + 1, endIndex + 1)
  }

  public setPositionList(payload: IElementPosition[]) {
    this.positionList = payload
  }

  public setFloatPositionList(payload: IFloatPosition[]) {
    this.floatPositionList = payload
  }

  public getFloatPositionByElement(element: IElement): IFloatPosition | null {
    return (
      this.floatPositionList.find(
        floatPosition => floatPosition.element === element
      ) || null
    )
  }

  public getFloatPositionCoordinate(floatPosition: IFloatPosition): {
    x: number
    y: number
  } {
    const { scale } = this.options
    const imgFloatPosition = floatPosition.element.imgFloatPosition!
    let x = imgFloatPosition.x * scale
    let y = imgFloatPosition.y * scale
    const { index, isTable, zone } = floatPosition
    if (isTable && index !== undefined) {
      let positionList: IElementPosition[]
      const zoneDirection = this.draw.getPageDirection(
        floatPosition.pageNo ?? this.draw.getPageNo()
      )
      if (zone === EditorZone.HEADER) {
        positionList = this.draw.getHeader().getPositionList(zoneDirection)
      } else if (zone === EditorZone.FOOTER) {
        positionList = this.draw.getFooter().getPositionList(zoneDirection)
      } else {
        positionList = this.positionList
      }
      let tablePosition = positionList[index]
      // 表格跨页时按浮动元素所在页定位片段（同页多栏按所在位置坐标区分）
      if (tablePosition?.tableFragment) {
        tablePosition =
          this.getTableFragmentPosition(
            index,
            floatPosition.pageNo,
            floatPosition.position
          ) || tablePosition
      }
      if (tablePosition) {
        const {
          coordinate: {
            leftTop: [tableX, tableY]
          }
        } = tablePosition
        x += tableX
        y += tableY
      }
    }
    return { x, y }
  }

  private pendingQueryLists: Set<IElementPosition[]> | null = null

  private withNativeQueryCommit<T>(compute: () => T): T {
    if (this.pendingQueryLists) return compute()
    this.pendingQueryLists = new Set()
    try {
      const result = compute()
      for (const positions of this.pendingQueryLists) {
        this.nativeQueries.set(positions, NativeQueryIndex.create(
          this.getNativeLines(positions), this.lineGeometry,
          !!this.options.lab?.incrementalFlow
        ))
      }
      return result
    } finally {
      this.pendingQueryLists = null
    }
  }

  public computePageRowPosition(
    payload: IComputePageRowPositionPayload
  ): IComputePageRowPositionResult {
    return this.withNativeQueryCommit(() => {
      this.pendingQueryLists!.add(payload.positionList)
      return this.computePageRowPositionInternal(payload)
    })
  }

  private computePageRowPositionInternal(
    payload: IComputePageRowPositionPayload
  ): IComputePageRowPositionResult {
    const {
      positionList,
      rowList,
      pageNo,
      startX,
      startY,
      startRowIndex,
      startIndex,
      innerWidth,
      zone,
      tablePosition
    } = payload
    const {
      scale,
      table: { tdPadding }
    } = this.options
    if (!positionList.length) {
      this.nativeQueries.delete(positionList)
      this.nativeLines.set(positionList, [])
      this.nativeRows.set(positionList, new NativeRowIndex())
    }
    let x = startX
    let y = startY
    let index = startIndex
    const traceParticle = this.draw.getTraceParticle()
    const columnLayout = this.draw.getColumnLayout(
      this.draw.getPageDirection(pageNo)
    )
    let prevColumnIndex: number | undefined = undefined
    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      if (curRow.flow) y = curRow.flow.y * scale
      // 分栏内栏切换：y 重置到栏顶
      if (
        !curRow.flow &&
        prevColumnIndex !== undefined &&
        curRow.columnIndex !== undefined &&
        curRow.columnIndex > 0 &&
        curRow.columnIndex !== prevColumnIndex
      ) {
        y = startY
      }
      prevColumnIndex = curRow.columnIndex
      // 分栏偏移与有效宽度
      const inColumn =
        columnLayout &&
        curRow.columnIndex !== undefined &&
        curRow.columnIndex >= 0
      const columnOffset =
        inColumn && columnLayout
          ? columnLayout.offsets[curRow.columnIndex!] || 0
          : 0
      const effectiveInnerWidth =
        inColumn && columnLayout ? columnLayout.width : innerWidth
      x += columnOffset
      // 行存在环绕的可能性均不设置行布局
      // Text rows already carry native alignment; object rows align here.
      const isTextEngineRow = !!curRow.nativeLine
      if (!curRow.isSurround && !isTextEngineRow) {
        // 计算行偏移量（行居中、居右）
        const curRowWidth = curRow.width + (curRow.offsetX || 0)
        const rowFlex = curRow.rowFlex
        const resolvedFlex =
          rowFlex === RowFlex.START
            ? curRow.direction === 'rtl'
              ? RowFlex.RIGHT
              : RowFlex.LEFT
            : rowFlex === RowFlex.END
              ? curRow.direction === 'rtl'
                ? RowFlex.LEFT
                : RowFlex.RIGHT
              : rowFlex
        if (resolvedFlex === RowFlex.CENTER) {
          x += (effectiveInnerWidth - curRowWidth) / 2
        } else if (resolvedFlex === RowFlex.RIGHT) {
          x += effectiveInnerWidth - curRowWidth
        } else if (!resolvedFlex && curRow.direction === 'rtl') {
          // RTL paragraph default: align to end (right) when no explicit rowFlex
          x += effectiveInnerWidth - curRowWidth
        }
      }
      // 当前行X/Y轴偏移量
      x += curRow.offsetX || 0
      y += curRow.offsetY || 0
      // Origin of row content after alignment
      const rowContentStartX = x
      let nativePlacement: PlacedTextLine | undefined
      if (curRow.nativeLine) {
        const lines = this.getNativeLines(positionList)
        nativePlacement = {
          line: curRow.nativeLine,
          pageNo,
          x,
          y: y - curRow.nativeLine.rect.y * scale,
          scale,
          columnIndex: curRow.columnIndex,
          clip: payload.clip
        }
        lines.push(nativePlacement)
        this.nativeQueries.delete(positionList)
        this.nativeLines.set(positionList, lines)
        let rows = this.nativeRows.get(positionList)
        if (!rows) {
          rows = new NativeRowIndex()
          this.nativeRows.set(positionList, rows)
        }
        rows.add(nativePlacement)
      }
      // Exact flow convergence preserves the immutable native line and its
      // placement. Source/row shifts only change the public position metadata.
      const origin = curRow.nativeLine && getTextLineOrigin(curRow.nativeLine)
      const cacheable = this.options.lab?.incrementalFlow && origin &&
        curRow.flow && !payload.isTable && !zone && !payload.clip &&
        !curRow.isSurround && !curRow.tableFragment
      const positionKey = cacheable ? JSON.stringify([
        x, y, pageNo, scale, curRow.width, curRow.height, curRow.ascent,
        curRow.columnIndex, curRow.direction, curRow.elementList.length
      ]) : ''
      const cached = cacheable ? this.rowPositions.get(origin.base) : undefined
      if (cached?.key === positionKey) {
        this.placementStats.reusedElements += cached.positions.length
        const shift = origin!.delta - cached.delta
        const rowIndex = startRowIndex + i
        for (const position of cached.positions) {
          const projected = !shift && cached.rowIndex === rowIndex &&
            cached.rowNo === i ? position : { ...position,
              index: position.index + shift, rowIndex, rowNo: i }
          positionList[projected.index] = projected
          index = Math.max(index, projected.index + 1)
        }
        x = startX
        y += curRow.height
        continue
      }
      const rowPositions: IElementPosition[] = []
      const nativeGeometry = nativePlacement
        ? this.lineGeometry.get(nativePlacement)
        : undefined
      // 当前td所在位置
      const tablePreX = x
      const tablePreY = y
      for (let j = 0; j < curRow.elementList.length; j++) {
        this.placementStats.computedElements++
        const model = curRow.elementList[j]
        const element = model
        // 表格跨页片段行：同一数据元素对应多个视觉片段（跨页/跨栏），
        // 索引以行起始数据索引为基准，避免同页多片段时后续元素索引整体错位
        if (curRow.tableFragment) {
          index = curRow.startIndex + j
        }
        const metrics = rowElementMetrics(
          curRow,
          j,
          scale,
          this.options.defaultSize
        )
        const offsetY =
          !element.hide &&
          !traceParticle.isTraceHidden(element) &&
          (((isTextEngineRow || element.imgDisplay !== ImageDisplay.INLINE) &&
            element.type === ElementType.IMAGE) ||
            element.type === ElementType.LATEX)
            ? curRow.ascent - metrics.height
            : curRow.ascent
        // 偏移量（内部计算使用）
        // 偏移量（外部传入）
        if (element.translateX) {
          x += element.translateX * scale
        }
        const source = rowSourceIndex(curRow, j)
        const nativeRects = nativeGeometry?.getElementRects(source) || []
        const nativeLeft = nativeRects.length
          ? Math.min(...nativeRects.map(rect => rect.x))
          : undefined
        const nativeCaret = nativeGeometry?.getCarets(source)[0]
        const drawX = nativePlacement
          ? (nativeLeft ?? nativeCaret?.x ?? rowContentStartX)
          : x
        const sourceIndex = curRow.sourceIndices?.[j]
        const elementIndex = sourceIndex ?? index
        const contentHeight = curRow.nativeLine
          ? curRow.nativeLine.contentHeight * scale
          : curRow.height
        const positionItem: IElementPosition = {
          pageNo,
          index: elementIndex,
          value: element.value,
          rowIndex: startRowIndex + i,
          // 表格单元格内行号为绝对序号（拆分窗口的续排位置与原窗口位置不冲突）；
          // 正文保持页内行号（页首行查找依赖 rowNo === 0）
          rowNo: payload.isTable ? startRowIndex + i : i,
          metrics,
          left: 0,
          ascent: offsetY,
          lineHeight: contentHeight,
          isFirstLetter: j === 0,
          isLastLetter: j === curRow.elementList.length - 1,
          columnIndex: curRow.columnIndex,
          bidiLevel:
            nativeCaret?.bidiLevel ??
            (curRow.direction === 'rtl' ? 1 : undefined),
          coordinate: {
            leftTop: [drawX, y],
            leftBottom: [drawX, y + contentHeight],
            rightTop: [drawX + metrics.width, y],
            rightBottom: [drawX + metrics.width, y + contentHeight]
          }
        }
        if (cacheable) rowPositions.push(positionItem)
        // 缓存浮动元素信息
        if (
          element.imgDisplay === ImageDisplay.SURROUND ||
          element.imgDisplay === ImageDisplay.FLOAT_TOP ||
          element.imgDisplay === ImageDisplay.FLOAT_BOTTOM
        ) {
          // 浮动元素使用上一位置信息
          const prePosition = positionList[positionList.length - 1]
          if (prePosition) {
            positionItem.metrics = prePosition.metrics
            positionItem.coordinate = prePosition.coordinate
          }
          // 兼容浮动元素初始坐标为空的情况-默认使用左上坐标
          if (!element.imgFloatPosition) {
            const tableLeftTop = tablePosition?.coordinate.leftTop
            element.imgFloatPosition = {
              x: tableLeftTop ? x - tableLeftTop[0] : x,
              y: tableLeftTop ? y - tableLeftTop[1] : y,
              pageNo
            }
          }
          this.floatPositionList.push({
            pageNo,
            element,
            position: positionItem,
            isTable: payload.isTable,
            index: payload.index,
            tdIndex: payload.tdIndex,
            trIndex: payload.trIndex,
            tdValueIndex: index,
            zone
          })
        }
        // 表格跨页片段：首个非续排片段位置入主列表（保持与元素列表一一对应），
        // 所有片段入侧边列表；元素索引始终递增
        const tableFragment = curRow.tableFragment
        if (tableFragment) {
          positionItem.tableFragment = tableFragment
          curRow.fragmentPosition = positionItem
          this.tablePagingPositionList.push(positionItem)
          // 按页索引
          const pagePositionList = this.tablePagingPositionMap.get(pageNo) || []
          pagePositionList.push(positionItem)
          this.tablePagingPositionMap.set(pageNo, pagePositionList)
          if (
            tableFragment.startTrIndex === 0 &&
            !tableFragment.startSplitTrOffset
          ) {
            if (sourceIndex !== undefined) {
              positionList[sourceIndex] = positionItem
            } else {
              positionList.push(positionItem)
            }
          }
        } else {
          if (sourceIndex !== undefined) {
            positionList[sourceIndex] = positionItem
          } else {
            positionList.push(positionItem)
          }
        }
        index = Math.max(index + 1, elementIndex + 1)
        x += metrics.width
        // 计算表格内元素位置
        if (
          element.type === ElementType.TABLE &&
          !element.hide &&
          !traceParticle.isTraceHidden(element)
        ) {
          const tdPaddingWidth = tdPadding[1] + tdPadding[3]
          // 遍历片段范围行与进位合并单元格，按窗口计算位置（跨页按页累积）
          const fragmentTdList = tableFragment
            ? this.draw
                .getTableParticle()
                .getFragmentTdList(element, tableFragment)
            : element.trList!.flatMap(tr => tr.tdList)
          for (const td of fragmentTdList) {
            let isSplitWindow = false
            let isContinuation = false
            let windowStart = 0
            let windowEnd = td.height!
            if (tableFragment) {
              ;[windowStart, windowEnd] = this.draw
                .getTableParticle()
                .getTdWindowInFragment(td, element, tableFragment)
              if (windowEnd <= windowStart) continue
              isSplitWindow = windowStart > 0 || windowEnd < td.height!
              isContinuation = windowStart > 0
            }
            // 拆分窗口：本片段仅计算窗口内的内容行位置
            let rowList = td.rowList!
            let startIndex = 0
            let startRowIndex = 0
            if (isSplitWindow) {
              const visible = this.draw
                .getTableParticle()
                .getTdVisibleRowListByWindow(td, windowStart, windowEnd)
              rowList = visible.rowList
              startIndex = visible.startIndex
              startRowIndex = visible.startRowIndex
            }
            // 续排片段追加位置而非清空（同一单元格跨页累积）
            if (!isContinuation) {
              td.positionList = []
            }
            const tdPositionList = td.positionList!
            // 片段内单元格内容纵坐标偏移（窗口顶部在片段内的位置）
            const drawnOffsetY = tableFragment
              ? this.draw
                  .getTableParticle()
                  .getTdWindowOffsetY(windowStart, tableFragment)
              : 0
            const cellClip = {
              x: td.x! * scale + tablePreX + (element.translateX || 0) * scale,
              y: td.y! * scale + tablePreY + drawnOffsetY,
              width: td.width! * scale,
              height: (windowEnd - windowStart) * scale
            }
            const drawRowResult = this.computePageRowPosition({
              positionList: tdPositionList,
              rowList,
              pageNo,
              startRowIndex,
              startIndex,
              startX:
                (td.x! + tdPadding[3]) * scale +
                tablePreX +
                (element.translateX || 0) * scale,
              startY: (td.y! + tdPadding[0]) * scale + tablePreY + drawnOffsetY,
              innerWidth: (td.width! - tdPaddingWidth) * scale,
              clip: payload.clip
                ? intersectRect(cellClip, payload.clip)
                : cellClip,
              isTable: true,
              index: index - 1,
              tdIndex: td.tdIndex!,
              trIndex: td.rowIndex!,
              zone,
              tablePosition: positionItem
            })
            // 垂直对齐方式（拆分窗口单元格按顶端对齐）
            if (!isSplitWindow) {
              this._offsetTdPositionByVerticalAlign(td, tdPositionList)
            }
            x = drawRowResult.x
            y = drawRowResult.y
          }
          // 续页回显表头：仅用于绘制的一次性位置，不参与命中
          if (tableFragment?.repeatTrIndexes?.length) {
            curRow.repeatTdPositionList = []
            let repeatAccHeight = 0
            for (const trIndex of tableFragment.repeatTrIndexes) {
              const tr = element.trList![trIndex]
              for (let d = 0; d < tr.tdList.length; d++) {
                const td = tr.tdList[d]
                const positionList: IElementPosition[] = []
                this.computePageRowPosition({
                  positionList,
                  rowList: td.rowList!,
                  pageNo,
                  startRowIndex: 0,
                  startIndex: 0,
                  startX:
                    (td.x! + tdPadding[3]) * scale +
                    tablePreX +
                    (element.translateX || 0) * scale,
                  startY: (repeatAccHeight + tdPadding[0]) * scale + tablePreY,
                  innerWidth: (td.width! - tdPaddingWidth) * scale,
                  isTable: true,
                  index: index - 1,
                  tdIndex: d,
                  trIndex,
                  zone,
                  tablePosition: positionItem
                })
                this._offsetTdPositionByVerticalAlign(td, positionList)
                curRow.repeatTdPositionList.push({ td, positionList })
              }
              repeatAccHeight += tr.height!
            }
          }
          // 恢复初始x、y
          x = tablePreX
          y = tablePreY
        }
      }
      if (cacheable) this.rowPositions.set(origin.base, {
        key: positionKey, delta: origin.delta,
        rowIndex: startRowIndex + i, rowNo: i, positions: rowPositions
      })
      x = startX
      y += curRow.height
    }
    return { x, y, index }
  }

  // 单元格内容按垂直对齐方式偏移位置
  private _offsetTdPositionByVerticalAlign(
    td: ITd,
    positionList: IElementPosition[]
  ) {
    if (
      td.verticalAlign !== VerticalAlign.MIDDLE &&
      td.verticalAlign !== VerticalAlign.BOTTOM
    ) {
      return
    }
    const {
      scale,
      table: { tdPadding }
    } = this.options
    const offsetHeight =
      getCellVerticalOffset(
        td.height!,
        getHostRowsHeight(td.rowList!) / scale,
        tdPadding,
        td.verticalAlign
      ) * scale
    if (offsetHeight > 0) {
      for (const placed of this.getNativeLines(positionList)) {
        placed.y += offsetHeight
        this.nativeQueries.delete(positionList)
        this.lineGeometry.invalidate(placed)
      }
      positionList.forEach(tdPosition => {
        const {
          coordinate: { leftTop, leftBottom, rightBottom, rightTop }
        } = tdPosition
        leftTop[1] += offsetHeight
        leftBottom[1] += offsetHeight
        rightBottom[1] += offsetHeight
        rightTop[1] += offsetHeight
        const element = td.value[tdPosition.index]
        const shiftNested = (elements: IElement[]) => {
          for (const child of elements)
            for (const row of child.trList || [])
              for (const cell of row.tdList) {
                for (const placed of this.getNativeLines(
                  cell.positionList || []
                )) {
                  placed.y += offsetHeight
                  if (placed.clip) {
                    const moved = {
                      ...placed.clip,
                      y: placed.clip.y + offsetHeight
                    }
                    const parentClip =
                      this.getNativeLines(positionList)[0]?.clip
                    placed.clip = parentClip
                      ? intersectRect(moved, parentClip)
                      : moved
                  }
                  if (cell.positionList)
                    this.nativeQueries.delete(cell.positionList)
                  this.lineGeometry.invalidate(placed)
                }
                for (const position of cell.positionList || []) {
                  for (const point of Object.values(position.coordinate))
                    point[1] += offsetHeight
                }
                shiftNested(cell.value)
              }
        }
        if (element?.trList) shiftNested([element])
      })
    }
  }

  public computePositionList(payload?: IComputePositionListPayload) {
    return this.withNativeQueryCommit(() =>
      this.computePositionListInternal(payload)
    )
  }

  private computePositionListInternal(payload?: IComputePositionListPayload) {
    // 按每页行计算（混排横竖版时每页宽度/边距可能不同，按页取值）
    const pageRowList = this.draw.getLayoutPages()
    const fromPageNo = payload?.fromPageNo ?? 0
    // 增量复用：首个变动页之前的页位置/浮动/跨页表格片段信息完全未变
    const cache = this.pagePositionCacheList
    const isResume =
      fromPageNo > 0 &&
      cache.length >= fromPageNo &&
      pageRowList.length >= fromPageNo
    if (isResume) {
      const keptCache = cache.slice(0, fromPageNo)
      this.positionList = keptCache.flatMap(c => c.positionList)
      const lines = keptCache.flatMap(c => c.nativeLines)
      this.nativeLines.set(this.positionList, lines)
      const rows = new NativeRowIndex()
      for (const line of lines) rows.add(line)
      this.nativeRows.set(this.positionList, rows)
      this.pendingQueryLists!.add(this.positionList)
      // 页眉页脚浮动信息已在本次渲染重新追加（当前列表前部），正文按页恢复
      this.floatPositionList = [
        ...this.floatPositionList,
        ...keptCache.flatMap(c => c.floatPositionList)
      ]
      this.tablePagingPositionList = keptCache.flatMap(
        c => c.tablePagingPositionList
      )
      for (const key of [...this.tablePagingPositionMap.keys()]) {
        if (key >= fromPageNo) {
          this.tablePagingPositionMap.delete(key)
        }
      }
      this.pagePositionCacheList = keptCache
    } else {
      // 置空原位置信息
      this.positionList = []
      this.tablePagingPositionList = []
      this.tablePagingPositionMap.clear()
      this.pagePositionCacheList = []
    }
    const startPageNo = isResume ? fromPageNo : 0
    // 起始位置受页眉影响
    const header = this.draw.getHeader()
    let startRowIndex = 0
    for (let i = 0; i < startPageNo; i++) {
      startRowIndex += pageRowList[i]?.length || 0
    }
    for (let i = startPageNo; i < pageRowList.length; i++) {
      const rowList = pageRowList[i]
      if (!rowList?.length) continue
      const startIndex = rowList[0].startIndex
      const { margins, innerWidth } = this.draw.getPageSize(i)
      const startX = margins[3]
      // 每页页眉禁用状态不同，startY 需按页计算
      const startY = margins[0] + header.getExtraHeight(i)
      const markLines = this.getNativeLines(this.positionList).length
      const markPosition = this.positionList.length
      const markFloat = this.floatPositionList.length
      const markTablePaging = this.tablePagingPositionList.length
      this.computePageRowPosition({
        positionList: this.positionList,
        rowList,
        pageNo: i,
        startRowIndex,
        startIndex,
        startX,
        startY,
        innerWidth
      })
      startRowIndex += rowList.length
      // 记录本页新增的位置信息，供增量复用
      this.pagePositionCacheList.push({
        nativeLines: this.getNativeLines(this.positionList).slice(markLines),
        positionList: this.positionList.slice(markPosition),
        floatPositionList: this.floatPositionList.slice(markFloat),
        tablePagingPositionList:
          this.tablePagingPositionList.slice(markTablePaging)
      })
    }
  }

  public computeRowPosition(
    payload: IComputeRowPositionPayload
  ): IElementPosition[] {
    const { row, innerWidth } = payload
    const positionList: IElementPosition[] = []
    this.computePageRowPosition({
      positionList,
      innerWidth,
      rowList: [row.node ? { ...row } : deepClone(row)],
      pageNo: 0,
      startX: 0,
      startY: 0,
      startIndex: 0,
      startRowIndex: 0
    })
    return positionList
  }

  public destroy() {
    this.pendingQueryLists = null
    // Drop the owner as well as its placement maps: query-block caches are
    // weakly keyed by this cache and must not survive a retained destroyed Draw.
    this.lineGeometry = new LineGeometryCache()
    this.nativeQueries = new WeakMap()
    this.nativeRows = new WeakMap()
    this.nativeLines = new WeakMap()
    this.nativeCaretHint = null
    this.rowPositions = new WeakMap()
    this.cursorPosition = null
    this.positionList = []
    this.pagePositionCacheList = []
    this.tablePagingPositionList = []
    this.tablePagingPositionMap.clear()
    this.floatPositionList = []
  }

  public setCursorPosition(position: IElementPosition | null) {
    this.cursorPosition = position
  }

  public getCursorPosition(): IElementPosition | null {
    return this.cursorPosition
  }

  public getPositionContext(): IPositionContext {
    return this.positionContext
  }

  public setPositionContext(payload: IPositionContext) {
    this.eventBus.emit('positionContextChange', {
      value: payload,
      oldValue: this.positionContext
    })
    this.positionContext = payload
  }

  // 根据 x 坐标推断点击位置所属的分栏索引；无分栏布局时返回 undefined
  private _getColumnIndexByX(
    x: number,
    pageNo = this.draw.getPageNo()
  ): number | undefined {
    const direction = this.draw.getPageDirection(pageNo)
    const layout = this.draw.getColumnLayout(direction)
    if (!layout) return
    const startX = this.draw.getMargins(direction)[3]
    const xRel = x - startX
    // 栏范围 [colStart, nextColStart)，gap 算入左侧栏，避免点击栏间空白时误判
    for (let i = 0; i < layout.count; i++) {
      const colStart = layout.offsets[i]
      const colEnd =
        i < layout.count - 1 ? layout.offsets[i + 1] : colStart + layout.width
      if (xRel >= colStart && xRel < colEnd) {
        return i
      }
    }
    // 超出最后一栏右边界时按最后一栏处理
    return layout.count - 1
  }

  // 表格被命中时下钻查找单元格内位置（未命中单元格返回 null）
  private _getTableChildPositionByXY(payload: {
    x: number
    y: number
    pageNo: number
    element: IElement
    index: number
    tablePosition: IElementPosition
  }): ICurrentPosition | null {
    const { x, y, pageNo, element, index, tablePosition } = payload
    const { scale } = this.options
    const fragment = tablePosition.tableFragment
    // 片段内仅枚举范围行与进位合并单元格，避免全表扫描
    const tdList = fragment
      ? this.draw.getTableParticle().getFragmentTdList(element, fragment)
      : element.trList!.flatMap(tr => tr.tdList)
    for (const td of tdList) {
      const t = td.rowIndex!
      const d = td.tdIndex!
      const tr = element.trList![t]
      const cellX = tablePosition.coordinate.leftTop[0] + td.x! * scale
      if (x < cellX || x > cellX + td.width! * scale) continue
      if (!fragment) {
        const cellY = tablePosition.coordinate.leftTop[1] + td.y! * scale
        if (y < cellY || y > cellY + td.height! * scale) continue
      }
      // 片段内按可见窗口过滤：拆分/进位窗口外的区域不参与命中
      if (fragment) {
        const [windowStart, windowEnd] = this.draw
          .getTableParticle()
          .getTdWindowInFragment(td, element, fragment)
        if (windowEnd <= windowStart) continue
        const tdTop =
          tablePosition.coordinate.leftTop[1] +
          td.y! * scale +
          this.draw.getTableParticle().getTdWindowOffsetY(windowStart, fragment)
        const tdBottom = tdTop + (windowEnd - windowStart) * scale
        if (y < tdTop || y > tdBottom) continue
      }
      const childPosition = this.getPositionByXY({
        x,
        y,
        td,
        pageNo,
        tablePosition,
        isTable: true,
        elementList: td.value,
        positionList: td.positionList
      })
      if (~childPosition.index) {
        const {
          index: childPositionIndex,
          isTable: isNestedTable,
          hitLineStartIndex,
          tablePath = []
        } = childPosition
        const tablePathItem = {
          index,
          trIndex: t,
          tdIndex: d,
          tdId: td.id,
          trId: tr.id,
          tableId: element.id
        }
        if (isNestedTable) {
          return {
            ...childPosition,
            index,
            tablePath: [tablePathItem, ...tablePath],
            hitLineStartIndex
          }
        }
        const tdValueElement = td.value[childPositionIndex]
        return {
          index,
          isCheckbox:
            childPosition.isCheckbox ||
            tdValueElement.type === ElementType.CHECKBOX ||
            tdValueElement.controlComponent === ControlComponent.CHECKBOX,
          isRadio:
            tdValueElement.type === ElementType.RADIO ||
            tdValueElement.controlComponent === ControlComponent.RADIO,
          isControl: !!tdValueElement.controlId,
          isImage: childPosition.isImage,
          isDirectHit: childPosition.isDirectHit,
          isTable: true,
          tdIndex: d,
          trIndex: t,
          tdValueIndex: childPositionIndex,
          nativeCaret: childPosition.nativeCaret,
          tdId: td.id,
          trId: tr.id,
          tableId: element.id,
          tablePath: [tablePathItem],
          hitLineStartIndex
        }
      }
    }
    return null
  }

  /** 留痕软删：非设计态不参与命中（与 GlyphRenderer 跳过一致） */
  private isTraceHitSkipped(element: IElement | undefined): boolean {
    if (!element || this.draw.isDesignMode()) return false
    return this.draw.getTraceParticle().isTraceHidden(element)
  }

  /** 行尾/空隙回落时避开留痕软删，落到最近可见元素 */
  private snapIndexFromTraceHidden(
    index: number,
    elementList: IElement[]
  ): number {
    if (!~index || !this.isTraceHitSkipped(elementList[index])) {
      return index
    }
    let i = index
    while (i >= 0 && this.isTraceHitSkipped(elementList[i])) {
      i--
    }
    return i >= 0 ? i : index
  }

  public getPositionByXY(payload: IGetPositionByXYPayload): ICurrentPosition {
    const { x, y, isTable } = payload
    let { elementList, positionList } = payload
    if (!elementList) {
      elementList = this.draw.getOriginalElementList()
    }
    if (!positionList) {
      positionList = this.getOriginalPositionList()
    }
    const zoneManager = this.draw.getZone()
    const curPageNo = payload.pageNo ?? this.draw.getPageNo()
    const isMainActive = zoneManager.isMainActive()
    const positionNo = curPageNo
    const validPositions = positionList.filter(
      (position): position is NonNullable<typeof position> => !!position
    )
    // 验证浮于文字上方元素
    if (!isTable) {
      const floatTopPosition = this.getFloatPositionByXY({
        ...payload,
        imgDisplays: [ImageDisplay.FLOAT_TOP, ImageDisplay.SURROUND]
      })
      if (floatTopPosition) return floatTopPosition
    }
    const nativeHit = this.hitNativeText(
      x,
      y,
      curPageNo,
      positionList,
      elementList
    )
    if (nativeHit) return nativeHit
    // 普通元素
    for (let j = 0; j < positionList.length; j++) {
      const position = positionList[j]
      if (!position) continue
      const {
        index,
        pageNo,
        left,
        isFirstLetter,
        coordinate: { leftTop, rightTop, leftBottom }
      } = position
      // 页眉/页脚的 positionList 跨页共享，坐标是页内的，按坐标命中即可
      if (isMainActive) {
        if (positionNo !== pageNo) continue
        if (pageNo > positionNo) break
      }
      // 命中元素
      if (
        leftTop[0] - left <= x &&
        rightTop[0] >= x &&
        leftTop[1] <= y &&
        leftBottom[1] >= y
      ) {
        let curPositionIndex = index
        const element = elementList[index]
        // 留痕软删：不占命中
        if (this.isTraceHitSkipped(element)) {
          continue
        }
        // 表格被命中
        if (element.type === ElementType.TABLE) {
          const tableChildPosition = this._getTableChildPositionByXY({
            x,
            y,
            pageNo: curPageNo,
            element,
            index,
            tablePosition: position
          })
          if (tableChildPosition) return tableChildPosition
        }
        // 图片区域均为命中
        if (
          element.type === ElementType.IMAGE ||
          element.type === ElementType.LATEX
        ) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isImage: true
          }
        }
        if (
          element.type === ElementType.CHECKBOX ||
          element.controlComponent === ControlComponent.CHECKBOX
        ) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isCheckbox: true
          }
        }
        // 标签元素检测
        if (element.type === ElementType.LABEL) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isLabel: true
          }
        }
        if (
          element.type === ElementType.TAB &&
          element.listStyle === ListStyle.CHECKBOX
        ) {
          // 向前找checkbox元素
          let index = curPositionIndex - 1
          while (index > 0) {
            const element = elementList[index]
            if (
              element.value === ZERO &&
              element.listStyle === ListStyle.CHECKBOX
            ) {
              break
            }
            index--
          }
          return {
            index,
            isDirectHit: true,
            isCheckbox: true
          }
        }
        if (
          element.type === ElementType.RADIO ||
          element.controlComponent === ControlComponent.RADIO
        ) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isRadio: true
          }
        }
        let hitLineStartIndex: number | undefined
        // 判断是否在文字中间前后（RTL：左半=之后，右半=之前）
        if (elementList[index].value !== ZERO) {
          const mid = (leftTop[0] + rightTop[0]) / 2
          const isRtlRun = ((position.bidiLevel ?? 0) & 1) === 1
          const wouldExitControl = (prevIndex: number) =>
            !!element.controlId &&
            elementList[prevIndex]?.controlId !== element.controlId
          if (isRtlRun) {
            // 控件首字右半若会落到控件外，仍停在控件内（否则「：|{」无法激活下拉）
            if (x >= mid && !wouldExitControl(curPositionIndex - 1)) {
              curPositionIndex = index - 1
              if (isFirstLetter) hitLineStartIndex = index
            }
          } else if (x < mid) {
            if (!wouldExitControl(curPositionIndex - 1)) {
              curPositionIndex = index - 1
              if (isFirstLetter) {
                hitLineStartIndex = index
              }
            }
          }
        }
        return {
          isDirectHit: true,
          hitLineStartIndex,
          index: curPositionIndex,
          // 半盒亲和可能把 index 挪到控件外；isControl 须跟最终 index 一致
          isControl: !!elementList[curPositionIndex]?.controlId
        }
      }
    }
    // 表格跨页片段命中（非首片段的位置记录不在主列表中）
    if (!isTable && isMainActive) {
      // 仅遍历当前页的片段位置，避免长文档全表线性扫描
      const pageFragmentPositionList =
        this.tablePagingPositionMap.get(curPageNo) || []
      for (const fragmentPosition of pageFragmentPositionList) {
        const {
          index,
          coordinate: { leftTop, rightTop, leftBottom }
        } = fragmentPosition
        if (
          leftTop[0] <= x &&
          rightTop[0] >= x &&
          leftTop[1] <= y &&
          leftBottom[1] >= y
        ) {
          const element = elementList[index]
          if (element?.type === ElementType.TABLE) {
            const tableChildPosition = this._getTableChildPositionByXY({
              x,
              y,
              pageNo: curPageNo,
              element,
              index,
              tablePosition: fragmentPosition
            })
            if (tableChildPosition) return tableChildPosition
          }
        }
      }
    }
    // 验证衬于文字下方元素
    if (!isTable) {
      const floatBottomPosition = this.getFloatPositionByXY({
        ...payload,
        imgDisplays: [ImageDisplay.FLOAT_BOTTOM]
      })
      if (floatBottomPosition) return floatBottomPosition
    }
    // 非命中区域
    let isLastArea = false
    let curPositionIndex = -1
    let hitLineStartIndex: number | undefined
    // 判断是否在表格内
    if (isTable) {
      const { scale } = this.options
      const { td, tablePosition } = payload
      if (td && tablePosition) {
        const { leftTop } = tablePosition.coordinate
        // 跨页片段内 td.y 相对整表，需按片段偏移；
        // 行内拆分续排行之后的行需额外减去续排行已消耗的高度
        const fragment = tablePosition.tableFragment
        let fragmentOffsetY = 0
        if (fragment) {
          const splitExtra =
            fragment.startSplitTrOffset && td.trIndex! > fragment.startTrIndex
              ? fragment.startSplitTrOffset
              : 0
          fragmentOffsetY =
            (fragment.repeatHeight - fragment.skipHeight - splitExtra) * scale
        }
        const tdX = td.x! * scale + leftTop[0]
        const tdY = td.y! * scale + leftTop[1] + fragmentOffsetY
        const tdWidth = td.width! * scale
        const tdHeight = td.height! * scale
        if (!(tdX < x && x < tdX + tdWidth && tdY < y && y < tdY + tdHeight)) {
          return {
            index: curPositionIndex
          }
        }
      }
    }
    // 判断所属行是否存在元素
    const matchedLastLetterList = isMainActive
      ? validPositions.filter(p => p.isLastLetter && p.pageNo === positionNo)
      : validPositions.filter(p => p.isLastLetter)
    // 分栏场景下，只保留与点击栏一致的行，避免误命中同 y 的其他栏
    const clickColumnIndex = isMainActive
      ? this._getColumnIndexByX(x, positionNo)
      : undefined
    const lastLetterList =
      clickColumnIndex === undefined
        ? matchedLastLetterList
        : matchedLastLetterList.filter(
            p =>
              p.columnIndex === undefined || clickColumnIndex === p.columnIndex
          )
    const zoneRowList = this.draw.getLayoutRows()
    for (let j = 0; j < lastLetterList.length; j++) {
      const {
        index,
        rowNo,
        rowIndex,
        coordinate: { leftTop, leftBottom }
      } = lastLetterList[j]
      // 段前间距等行偏移区域（行内容上方offsetY空白）归属当前行
      const rowOffsetY = zoneRowList[rowIndex]?.offsetY || 0
      if (y > leftTop[1] - rowOffsetY && y <= leftBottom[1]) {
        const headIndex = isMainActive
          ? validPositions.findIndex(
              p => p.pageNo === positionNo && p.rowNo === rowNo
            )
          : validPositions.findIndex(p => p.rowNo === rowNo)
        const headPosition = validPositions[headIndex]
        const headElement = headPosition
          ? elementList[headPosition.index]
          : undefined
        const rowPositions = isMainActive
          ? validPositions.filter(
              p => p.pageNo === positionNo && p.rowNo === rowNo
            )
          : validPositions.filter(p => p.rowNo === rowNo)
        const contentLeft = Math.min(
          ...rowPositions.map(p => p.coordinate.leftTop[0])
        )
        const contentRight = Math.max(
          ...rowPositions.map(p => p.coordinate.rightTop[0])
        )
        const row =
          this.draw.getLayoutRowList()[headPosition.rowIndex] ||
          this.draw.getLayoutRows()[headPosition.rowIndex]
        const isRtlRow = row?.direction === 'rtl'
        const placeAtLogicalStart = () => {
          if (headPosition) {
            if (headPosition.value === ZERO) {
              curPositionIndex = headPosition.index
            } else {
              curPositionIndex = headPosition.index - 1
              hitLineStartIndex = headPosition.index
            }
          } else {
            curPositionIndex = index
          }
        }
        if (y <= leftTop[1]) {
          placeAtLogicalStart()
        } else if (isRtlRow) {
          // RTL：段首在右、逻辑尾在左。左侧空白 → 逻辑尾；右侧空白 → 逻辑首
          if (x < contentLeft) {
            curPositionIndex = index
          } else if (x > contentRight) {
            placeAtLogicalStart()
          } else {
            // 落入字间空隙：靠近哪侧跟哪侧
            const mid = (contentLeft + contentRight) / 2
            if (x < mid) {
              curPositionIndex = index
            } else {
              placeAtLogicalStart()
            }
          }
        } else {
          // LTR：左侧空白 → 行首；否则 → 行尾（逻辑尾）
          const headStartX =
            headElement?.listStyle === ListStyle.CHECKBOX
              ? this.draw.getMargins()[3]
              : headPosition.coordinate.leftTop[0]
          if (x < headStartX) {
            placeAtLogicalStart()
          } else {
            if (
              headElement?.listStyle === ListStyle.CHECKBOX &&
              x < leftTop[0]
            ) {
              return {
                index: headPosition.index,
                isDirectHit: true,
                isCheckbox: true
              }
            }
            curPositionIndex = index
          }
        }
        isLastArea = true
        break
      }
    }
    if (!isLastArea) {
      // 页眉页脚正文切换
      if (this.draw.getIsPagingMode()) {
        // 页眉底部距离页面顶部距离
        const header = this.draw.getHeader()
        const headerDisabled = header.isDisabled(curPageNo)
        const headerBottomY = headerDisabled
          ? 0
          : header.getHeaderTop(curPageNo) + header.getHeight(curPageNo)
        // 页脚上部距离页面顶部距离
        const footer = this.draw.getFooter()
        const footerDisabled = footer.isDisabled(curPageNo)
        const { height: pageHeight } = this.draw.getPageSize(curPageNo)
        const footerTopY = footerDisabled
          ? pageHeight
          : pageHeight -
            (footer.getFooterBottom(curPageNo) + footer.getHeight(curPageNo))
        // 判断所属位置是否属于页眉页脚区域
        if (isMainActive) {
          // 页眉：当前位置小于页眉底部位置
          if (!headerDisabled && y < headerBottomY) {
            return {
              index: -1,
              zone: EditorZone.HEADER
            }
          }
          // 页脚：当前位置大于页脚顶部位置
          if (!footerDisabled && y > footerTopY) {
            return {
              index: -1,
              zone: EditorZone.FOOTER
            }
          }
        } else {
          // main区域：当前位置小于页眉底部位置 && 大于页脚顶部位置
          if (y <= footerTopY && y >= headerBottomY) {
            return {
              index: -1,
              zone: EditorZone.MAIN
            }
          }
        }
      }
      // 正文上-循环首行
      const margins = this.draw.getMargins()
      if (y <= margins[0]) {
        const firstRowPositions = validPositions.filter(
          position => position.pageNo === positionNo && position.rowNo === 0
        )
        for (let p = 0; p < firstRowPositions.length; p++) {
          const position = firstRowPositions[p]
          if (position.pageNo !== positionNo || position.rowNo !== 0) continue
          const { leftTop, rightTop } = position.coordinate
          // 小于左页边距 || 命中文字 || 首行最后元素
          if (
            x <= margins[3] ||
            (x >= leftTop[0] && x <= rightTop[0]) ||
            firstRowPositions[p + 1]?.rowNo !== 0
          ) {
            return {
              index: position.index
            }
          }
        }
      } else {
        // 正文下-循环尾行
        const lastLetter = lastLetterList[lastLetterList.length - 1]
        if (lastLetter) {
          const lastRowNo = lastLetter.rowNo
          const lastRowPositions = validPositions.filter(
            position =>
              (!isMainActive || position.pageNo === positionNo) &&
              position.rowNo === lastRowNo
          )
          for (let p = 0; p < lastRowPositions.length; p++) {
            const position = lastRowPositions[p]
            const { leftTop, rightTop } = position.coordinate
            // 小于左页边距 || 命中文字 || 尾行最后元素
            if (
              x <= margins[3] ||
              (x >= leftTop[0] && x <= rightTop[0]) ||
              lastRowPositions[p + 1]?.rowNo !== lastRowNo
            ) {
              return {
                index: position.index
              }
            }
          }
        }
      }
      // 当前页最后一行
      return {
        index:
          lastLetterList[lastLetterList.length - 1]?.index ||
          positionList.length - 1
      }
    }
    const snappedIndex = this.snapIndexFromTraceHidden(
      curPositionIndex,
      elementList
    )
    return {
      hitLineStartIndex,
      index: snappedIndex,
      isControl: !!elementList[snappedIndex]?.controlId
    }
  }

  public getFloatPositionByXY(
    payload: IGetFloatPositionByXYPayload
  ): ICurrentPosition | void {
    const { x, y } = payload
    const currentPageNo = payload.pageNo ?? this.draw.getPageNo()
    const currentZone = this.draw.getZone().getZone()
    const { scale } = this.options
    for (let f = 0; f < this.floatPositionList.length; f++) {
      const {
        position,
        element,
        isTable,
        index,
        trIndex,
        tdIndex,
        tdValueIndex,
        zone: floatElementZone,
        pageNo
      } = this.floatPositionList[f]
      if (
        currentPageNo === pageNo &&
        element.type === ElementType.IMAGE &&
        element.imgDisplay &&
        payload.imgDisplays.includes(element.imgDisplay) &&
        (!floatElementZone || floatElementZone === currentZone)
      ) {
        const { x: imgFloatPositionX, y: imgFloatPositionY } =
          this.getFloatPositionCoordinate(this.floatPositionList[f])
        const elementWidth = element.width! * scale
        const elementHeight = element.height! * scale
        if (
          x >= imgFloatPositionX &&
          x <= imgFloatPositionX + elementWidth &&
          y >= imgFloatPositionY &&
          y <= imgFloatPositionY + elementHeight
        ) {
          if (isTable) {
            return {
              index: index!,
              isDirectHit: true,
              isImage: true,
              isTable,
              trIndex,
              tdIndex,
              tdValueIndex,
              tdId: element.tdId,
              trId: element.trId,
              tableId: element.tableId
            }
          }
          return {
            index: position.index,
            isDirectHit: true,
            isImage: true
          }
        }
      }
    }
  }

  public adjustPositionContext(
    payload: IGetPositionByXYPayload
  ): ICurrentPosition | null {
    const positionResult = this.getPositionByXY(payload)
    if (!~positionResult.index) return null
    this.setNativeCaretHint(positionResult.nativeCaret || null)
    // 移动控件内光标
    if (
      positionResult.isControl &&
      this.draw.getMode() !== EditorMode.READONLY
    ) {
      const { index, isTable, trIndex, tdIndex, tdValueIndex } = positionResult
      const control = this.draw.getControl()
      // 半盒亲和可能把 index 推到控件外；命中控件时仍按控件入口吸附
      let moveIndex = isTable ? tdValueIndex! : index
      if (!isTable) {
        const elementList = this.draw.getOriginalElementList()
        if (!elementList[moveIndex]?.controlId) {
          const next = elementList[moveIndex + 1]
          if (
            next?.controlId &&
            (next.controlComponent === ControlComponent.PREFIX ||
              next.controlComponent === ControlComponent.PRE_TEXT ||
              next.controlComponent === ControlComponent.PLACEHOLDER ||
              next.controlComponent === ControlComponent.VALUE)
          ) {
            moveIndex = moveIndex + 1
          }
        }
      }
      const { newIndex } = control.moveCursor({
        index: isTable ? index : moveIndex,
        isTable,
        trIndex,
        tdIndex,
        tdValueIndex: isTable ? moveIndex : tdValueIndex
      })
      if (isTable) {
        positionResult.tdValueIndex = newIndex
      } else {
        positionResult.index = newIndex
      }
    }
    const {
      index,
      isCheckbox,
      isRadio,
      isControl,
      isImage,
      isLabel,
      isDirectHit,
      isTable,
      trIndex,
      tdIndex,
      tdId,
      trId,
      tableId,
      tablePath
    } = positionResult
    // 设置位置上下文
    this.setPositionContext({
      isTable: isTable || false,
      isCheckbox: isCheckbox || false,
      isRadio: isRadio || false,
      isControl: isControl || false,
      isImage: isImage || false,
      isLabel: isLabel || false,
      isDirectHit: isDirectHit || false,
      index,
      trIndex,
      tdIndex,
      tdId,
      trId,
      tableId,
      tablePath
    })
    return positionResult
  }
}

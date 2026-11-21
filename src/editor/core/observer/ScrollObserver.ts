import { IEditorOption } from '../../interface/Editor'
import { debounce, findScrollContainer } from '../../utils'
import { Draw } from '../draw/Draw'

export interface IPageVisibleInfo {
  intersectionPageNo: number
  visiblePageNoList: number[]
}

export interface PageZoomAnchor {
  container: Element | Document
  pageNo: number
  viewportX: number
  viewportY: number
  pageX: number
  pageY: number
}

export class ScrollObserver {
  private draw: Draw
  private options: Required<IEditorOption>
  private scrollContainer: Element | Document

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.scrollContainer = this.getScrollContainer()
    // 监听滚轮
    void draw.ready.then(
      () => {
        if (draw.isReady() && !window.scrollY) this._observer()
      },
      () => {}
    )
    this._addEvent()
  }

  public getScrollContainer(): Element | Document {
    return this.options.scrollContainerSelector
      ? document.querySelector(this.options.scrollContainerSelector) || document
      : document
  }

  private _addEvent() {
    this.scrollContainer.addEventListener('scroll', this._observer)
    window.addEventListener('scroll', this._paintViewport, true)
    window.addEventListener('resize', this._paintViewport)
  }

  public removeEvent() {
    this.scrollContainer.removeEventListener('scroll', this._observer)
    window.removeEventListener('scroll', this._paintViewport, true)
    window.removeEventListener('resize', this._paintViewport)
  }

  public getPageVisibleInfo(): IPageVisibleInfo {
    const { intersectionPageNo, visiblePageNoList } = this.getPaintPageInfo(0)
    return { intersectionPageNo, visiblePageNoList }
  }

  private getViewport(container: Element | Document) {
    let top = 0
    let left = 0
    let bottom = Math.max(
      document.documentElement.clientHeight,
      window.innerHeight
    )
    let right = Math.max(document.documentElement.clientWidth, window.innerWidth)
    if (container instanceof Element) {
      const rect = container.getBoundingClientRect()
      const containerTop = rect.top + container.clientTop
      const containerLeft = rect.left + container.clientLeft
      top = Math.max(top, containerTop)
      bottom = Math.min(bottom, containerTop + container.clientHeight)
      left = Math.max(left, containerLeft)
      right = Math.min(right, containerLeft + container.clientWidth)
    }
    return { top, left, bottom, right }
  }

  public captureZoomAnchor(
    point?: { x: number; y: number }
  ): PageZoomAnchor | undefined {
    const editor = this.draw.getContainer()
    const configured = this.getScrollContainer()
    const root = configured instanceof Element && configured.contains(editor)
      ? configured
      : findScrollContainer(editor)
    const container = root === document.scrollingElement ||
      root === document.documentElement ? document : root
    const viewport = this.getViewport(container)
    const { intersectionPageNo, visiblePageNoList } =
      this.getPaintPageInfo(0, viewport)
    if (!visiblePageNoList.length) return
    const pages = this.draw.getPageList()
    const pointedPage = point && point.x >= viewport.left && point.x <= viewport.right &&
      point.y >= viewport.top && point.y <= viewport.bottom
      ? visiblePageNoList.find(pageNo => {
        const rect = pages[pageNo].getBoundingClientRect()
        return point.x >= rect.left && point.x <= rect.right &&
          point.y >= rect.top && point.y <= rect.bottom
      }) : undefined
    const pageNo = pointedPage ?? intersectionPageNo
    const rect = pages[pageNo].getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const viewportX = pointedPage !== undefined && point
      ? point.x : (Math.max(rect.left, viewport.left) +
        Math.min(rect.right, viewport.right)) / 2
    const viewportY = pointedPage !== undefined && point
      ? point.y : Math.max(rect.top, viewport.top)
    return { container, pageNo, viewportX, viewportY,
      pageX: (viewportX - rect.left) / rect.width,
      pageY: (viewportY - rect.top) / rect.height }
  }

  public restoreZoomAnchor(anchor: PageZoomAnchor) {
    const pages = this.draw.getPageList()
    const rect = pages[Math.min(anchor.pageNo, pages.length - 1)]
      ?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    // Read the final bounds so the correction includes native scroll anchoring.
    const left = rect.left + anchor.pageX * rect.width - anchor.viewportX
    const top = rect.top + anchor.pageY * rect.height - anchor.viewportY
    if (Math.abs(left) < 0.5 && Math.abs(top) < 0.5) return
    const options: ScrollToOptions = { left, top, behavior: 'instant' }
    if (anchor.container instanceof Element) anchor.container.scrollBy(options)
    else window.scrollBy(options)
  }

  public getPaintPageInfo(prefetch: number,
    { top, left, bottom, right } = this.getViewport(this.getScrollContainer())) {
    const pageList = this.draw.getPageList()
    const visiblePageNoList: number[] = []
    const before: number[] = []
    const after: number[] = []
    let intersectionPageNo = 0
    let intersectionMaxHeight = 0
    const offset = top - (pageList[0]?.getBoundingClientRect().top || 0)
    const result = { intersectionPageNo, visiblePageNoList, before, after, offset }
    if (top >= bottom || left >= right) return result
    // Pages are stacked vertically. Skip pages above the viewport without
    // reading the bounds of every preceding canvas on each zoom step.
    let first = 0
    let end = pageList.length
    while (first < end) {
      const middle = Math.floor((first + end) / 2)
      if (pageList[middle].getBoundingClientRect().bottom <= top - prefetch)
        first = middle + 1
      else end = middle
    }
    for (let i = first; i < pageList.length; i++) {
      const rect = pageList[i].getBoundingClientRect()
      if (rect.top >= bottom + prefetch) break
      if (rect.right <= left || rect.left >= right) continue
      const intersectionHeight =
        Math.min(rect.bottom, bottom) - Math.max(rect.top, top)
      if (intersectionHeight > 0) {
        visiblePageNoList.push(i)
      } else if (rect.bottom <= top) before.push(i)
      else after.push(i)
      if (intersectionHeight > intersectionMaxHeight) {
        intersectionMaxHeight = intersectionHeight
        intersectionPageNo = i
      }
    }
    before.reverse()
    result.intersectionPageNo = intersectionPageNo
    return result
  }

  private _paintViewport = () => this.draw.requestViewportPaint()

  private _observer = debounce(() => {
    if (!this.draw.isReady()) return
    const { intersectionPageNo, visiblePageNoList } = this.getPageVisibleInfo()
    this.draw.setIntersectionPageNo(intersectionPageNo)
    this.draw.setVisiblePageNoList(visiblePageNoList)
  }, 150)
}

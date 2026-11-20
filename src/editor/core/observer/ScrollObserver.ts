import { IEditorOption } from '../../interface/Editor'
import { debounce } from '../../utils'
import { Draw } from '../draw/Draw'

export interface IPageVisibleInfo {
  intersectionPageNo: number
  visiblePageNoList: number[]
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
  }

  public removeEvent() {
    this.scrollContainer.removeEventListener('scroll', this._observer)
  }

  public getPageVisibleInfo(): IPageVisibleInfo {
    const pageList = this.draw.getPageList()
    const visiblePageNoList: number[] = []
    let intersectionPageNo = 0
    let intersectionMaxHeight = 0
    let top = 0
    let bottom = Math.max(
      document.documentElement.clientHeight,
      window.innerHeight
    )
    if (this.scrollContainer instanceof Element) {
      const containerTop =
        this.scrollContainer.getBoundingClientRect().top +
        this.scrollContainer.clientTop
      top = Math.max(top, containerTop)
      bottom = Math.min(bottom, containerTop + this.scrollContainer.clientHeight)
    }
    // Pages are stacked vertically. Skip pages above the viewport without
    // reading the bounds of every preceding canvas on each zoom step.
    let first = 0
    let end = pageList.length
    while (first < end) {
      const middle = Math.floor((first + end) / 2)
      if (pageList[middle].getBoundingClientRect().bottom <= top)
        first = middle + 1
      else end = middle
    }
    for (let i = first; i < pageList.length; i++) {
      const rect = pageList[i].getBoundingClientRect()
      if (rect.top >= bottom) break
      const intersectionHeight =
        Math.min(rect.bottom, bottom) - Math.max(rect.top, top)
      if (intersectionHeight > 0) {
        visiblePageNoList.push(i)
      }
      if (intersectionHeight > intersectionMaxHeight) {
        intersectionMaxHeight = intersectionHeight
        intersectionPageNo = i
      }
    }
    return {
      intersectionPageNo,
      visiblePageNoList
    }
  }

  private _observer = debounce(() => {
    if (!this.draw.isReady()) return
    const { intersectionPageNo, visiblePageNoList } = this.getPageVisibleInfo()
    this.draw.setIntersectionPageNo(intersectionPageNo)
    this.draw.setVisiblePageNoList(visiblePageNoList)
  }, 150)
}

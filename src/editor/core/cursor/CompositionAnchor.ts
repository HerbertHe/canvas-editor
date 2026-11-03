import type { DeepRequired } from '../../interface/Common'
import type { IEditorOption } from '../../interface/Editor'

export interface CompositionAnchorGeometry {
  left: number
  top: number
  height: number
  width: number
  color: string
  direction: 'ltr' | 'rtl' | 'auto'
  show: boolean
}

interface ScrollPort {
  element: HTMLElement
  left: number
  top: number
  right: number
  bottom: number
  xScale: number
  yScale: number
  x: boolean
  y: boolean
  document: boolean
  rtl: boolean
}

/** Shares one read phase between the visual caret, native IME anchor and scroll. */
export class CompositionAnchor {
  private pending = false
  private generation = 0
  private frame: number | null = null
  private viewportReveal = false
  private latest: CompositionAnchorGeometry | null = null
  private reveal = false
  private observer: ResizeObserver | null = null
  private placedColor: string | null = null
  private savedStyles: [string, string][] | null = null
  private destroyed = false
  private viewport = window.visualViewport

  constructor(
    private container: HTMLElement,
    private agent: HTMLTextAreaElement,
    private caret: HTMLElement,
    private options: DeepRequired<IEditorOption>,
    private active: () => boolean,
    private refresh: (reveal: boolean) => void
  ) {
    if (!options.lab?.imePreview) return
    document.addEventListener('scroll', this.onViewportChange, true)
    window.addEventListener('resize', this.onViewportChange)
    this.viewport?.addEventListener('resize', this.onViewportChange)
    this.viewport?.addEventListener('scroll', this.onViewportChange)
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.onViewportChange())
      for (let element: HTMLElement | null = container; element;
        element = element.parentElement) this.observer.observe(element)
    }
  }

  private onViewportChange = (event?: Event) => {
    if (this.destroyed || !this.active()) return
    this.viewportReveal ||= event?.type !== 'scroll'
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      const reveal = this.viewportReveal
      this.viewportReveal = false
      // Manual scrolling must not immediately scroll the user back.
      if (!this.destroyed && this.active()) this.refresh(reveal)
    })
  }

  update(geometry: CompositionAnchorGeometry, reveal: boolean) {
    if (this.destroyed) return
    this.latest = geometry
    this.reveal ||= reveal
    if (this.pending) return
    this.pending = true
    const generation = this.generation
    // The session already runs in rAF: a microtask keeps this in the same frame.
    queueMicrotask(() => {
      if (generation !== this.generation || this.destroyed) return
      this.pending = false
      if (!this.active() || !this.latest) return
      const geometry = this.latest
      const reveal = this.reveal
      this.reveal = false
      const scrolls = reveal && geometry.show ? this.measureScroll(geometry) : []
      this.place(geometry)
      for (const scroll of scrolls) scroll()
    })
  }

  private place(geometry: CompositionAnchorGeometry) {
    const { left, top, height, width, color, direction, show } = geometry
    if (!this.savedStyles) this.savedStyles =
      ['width', 'height', 'font-size', 'line-height', 'white-space'].map(
        property => [property, this.agent.style.getPropertyValue(property)])
    const write = (element: HTMLElement, key: keyof CSSStyleDeclaration,
      value: string) => {
      if (element.style[key] !== value) Reflect.set(element.style, key, value)
    }
    // A one-pixel, nonwrapping textarea keeps its native caret at the anchor,
    // even when the preedit string scrolls horizontally. Never change its value
    // or selection: those are owned by the active OS composition.
    write(this.agent, 'width', '1px')
    write(this.agent, 'height', `${height}px`)
    // Leave room for the browser font's ascent/descent inside the caret box.
    write(this.agent, 'fontSize', `${height * 0.75}px`)
    write(this.agent, 'lineHeight', `${height}px`)
    write(this.agent, 'whiteSpace', 'pre')
    write(this.agent, 'left', `${left}px`)
    write(this.agent, 'top', `${top}px`)
    if (this.agent.dir !== direction) this.agent.dir = direction
    write(this.caret, 'width', `${width}px`)
    if (this.placedColor !== color) {
      write(this.caret, 'backgroundColor', color)
      this.placedColor = color
    }
    write(this.caret, 'left', `${left}px`)
    write(this.caret, 'top', `${top}px`)
    write(this.caret, 'height', `${height}px`)
    write(this.caret, 'display', show ? 'block' : 'none')
  }

  private measureScroll(geometry: CompositionAnchorGeometry) {
    const box = this.container.getBoundingClientRect()
    const xScale = box.width / this.container.offsetWidth || 1
    const yScale = box.height / this.container.offsetHeight || 1
    let left = box.left + (this.container.clientLeft + geometry.left -
      this.container.scrollLeft) * xScale
    let top = box.top + (this.container.clientTop + geometry.top -
      this.container.scrollTop) * yScale
    const width = geometry.width * xScale
    const height = geometry.height * yScale
    const ports: ScrollPort[] = []
    const root = document.scrollingElement || document.documentElement
    // All ancestor ports matter: nested horizontal and vertical scrollers can
    // clip independently. Read their rectangles before writing any style/scroll.
    for (let element = this.container.parentElement; element && element !== root;
      element = element.parentElement) {
      const style = getComputedStyle(element)
      const x = /auto|scroll|overlay/.test(style.overflowX)
      const y = /auto|scroll|overlay/.test(style.overflowY)
      if (!x && !y) continue
      const rect = element.getBoundingClientRect()
      const sx = rect.width / element.offsetWidth || 1
      const sy = rect.height / element.offsetHeight || 1
      const portLeft = rect.left + element.clientLeft * sx
      const portTop = rect.top + element.clientTop * sy
      ports.push({ element, left: portLeft, top: portTop,
        right: portLeft + element.clientWidth * sx,
        bottom: portTop + element.clientHeight * sy,
        xScale: sx, yScale: sy, x, y, document: false,
        rtl: style.direction === 'rtl' })
    }
    const viewport = this.viewport
    ports.push({ element: root as HTMLElement,
      left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
      right: (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth),
      bottom: (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight),
      xScale: 1, yScale: 1, x: true, y: true, document: true,
      rtl: getComputedStyle(root).direction === 'rtl' })
    const scrolls: (() => void)[] = []
    const [marginTop, marginRight, marginBottom, marginLeft] = this.options.maskMargin
    for (const port of ports) {
      const minX = port.left + marginLeft
      const maxX = Math.max(minX, port.right - marginRight)
      const minY = port.top + marginTop
      const maxY = Math.max(minY, port.bottom - marginBottom)
      const dx = port.x ? left < minX ? left - minX :
        Math.max(0, left + Math.min(width, maxX - minX) - maxX) : 0
      const dy = port.y ? top < minY ? top - minY :
        Math.max(0, top + Math.min(height, maxY - minY) - maxY) : 0
      const element = port.element
      const oldX = port.document ? window.scrollX : element.scrollLeft
      const oldY = port.document ? window.scrollY : element.scrollTop
      const maxScrollX = Math.max(0, element.scrollWidth - element.clientWidth)
      const x = port.x ? Math.max(port.rtl ? -maxScrollX : 0,
        Math.min(port.rtl ? 0 : maxScrollX, oldX + dx / port.xScale)) : oldX
      const y = port.y ? Math.max(0,
        Math.min(Math.max(0, element.scrollHeight - element.clientHeight),
          oldY + dy / port.yScale)) : oldY
      if (x === oldX && y === oldY) continue
      left -= (x - oldX) * port.xScale
      top -= (y - oldY) * port.yScale
      scrolls.push(() => {
        const options: ScrollToOptions = { left: x, top: y, behavior: 'instant' }
        if (port.document) window.scrollTo(options)
        else element.scroll(options)
      })
    }
    return scrolls
  }

  cancel() {
    this.generation++
    this.pending = false
    this.latest = null
    this.reveal = false
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.viewportReveal = false
  }

  restore() {
    this.cancel()
    this.placedColor = null
    if (!this.savedStyles) return
    for (const [property, value] of this.savedStyles) {
      if (value) this.agent.style.setProperty(property, value)
      else this.agent.style.removeProperty(property)
    }
    this.savedStyles = null
  }

  destroy() {
    this.destroyed = true
    this.cancel()
    this.observer?.disconnect()
    document.removeEventListener('scroll', this.onViewportChange, true)
    window.removeEventListener('resize', this.onViewportChange)
    this.viewport?.removeEventListener('resize', this.onViewportChange)
    this.viewport?.removeEventListener('scroll', this.onViewportChange)
  }
}

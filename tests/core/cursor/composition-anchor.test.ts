import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompositionAnchor } from '@/editor/core/cursor/CompositionAnchor'
import type { CompositionAnchorGeometry } from '@/editor/core/cursor/CompositionAnchor'
import { mergeOption } from '@/editor/utils/option'

const anchors: CompositionAnchor[] = []
afterEach(() => {
  anchors.splice(0).forEach(anchor => anchor.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function dimensions(element: HTMLElement, values: Record<string, number>) {
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(element, key, { configurable: true, value })
}
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width,
    bottom: top + height, width, height, toJSON: () => ({}) }
}
function setup() {
  const port = document.createElement('div')
  port.style.overflowX = 'auto'
  port.style.overflowY = 'auto'
  const container = document.createElement('div')
  const agent = document.createElement('textarea')
  const caret = document.createElement('div')
  container.append(agent, caret)
  port.append(container)
  document.body.append(port)
  dimensions(container, { offsetWidth: 600, offsetHeight: 1000 })
  dimensions(port, { offsetWidth: 200, offsetHeight: 100, clientWidth: 200,
    clientHeight: 100, scrollWidth: 1000, scrollHeight: 2000 })
  const containerRect = vi.spyOn(container, 'getBoundingClientRect')
    .mockReturnValue(rect(100, 100, 600, 1000))
  const portRect = vi.spyOn(port, 'getBoundingClientRect')
    .mockReturnValue(rect(100, 100, 200, 100))
  const scroll = vi.spyOn(port, 'scroll').mockImplementation(() => {})
  const refresh = vi.fn()
  const active = vi.fn(() => true)
  const anchor = new CompositionAnchor(container, agent, caret,
    mergeOption({ maskMargin: [0, 0, 0, 0], lab: { imePreview: true } }), active, refresh)
  anchors.push(anchor)
  return { anchor, container, agent, caret, port, containerRect, portRect,
    scroll, refresh, active }
}
const geometry = (changes: Partial<CompositionAnchorGeometry> = {}): CompositionAnchorGeometry =>
  ({ left: 30, top: 20, height: 24, width: 1, color: '#000000',
    direction: 'ltr', show: true, ...changes })
const flush = () => Promise.resolve()

describe('composition anchor', () => {
  it('coalesces same-frame placement, shares viewport reads and preserves native input state', async () => {
    const { anchor, agent, caret, containerRect, portRect } = setup()
    agent.value = 'nihao'
    agent.setSelectionRange(2, 4)
    const focus = vi.spyOn(agent, 'focus')
    const selection = vi.spyOn(agent, 'setSelectionRange')
    anchor.update(geometry(), true)
    anchor.update(geometry({ left: 40, height: 36, direction: 'rtl' }), true)
    expect(caret.style.left).toBe('')
    await flush()
    expect(caret.style.left).toBe('40px')
    expect(agent.style.left).toBe('40px')
    expect(agent.style.top).toBe(caret.style.top)
    expect(agent.style.height).toBe(caret.style.height)
    expect(agent.style.width).toBe('1px')
    expect(agent.dir).toBe('rtl')
    expect(containerRect).toHaveBeenCalledOnce()
    expect(portRect).toHaveBeenCalledOnce()
    expect(agent.value).toBe('nihao')
    expect([agent.selectionStart, agent.selectionEnd]).toEqual([2, 4])
    expect(focus).not.toHaveBeenCalled()
    expect(selection).not.toHaveBeenCalled()
    const changes: MutationRecord[] = []
    const observer = new MutationObserver(records => changes.push(...records))
    observer.observe(agent, { attributes: true })
    observer.observe(caret, { attributes: true })
    anchor.update(geometry({ left: 40, height: 36, direction: 'rtl' }), false)
    await flush()
    await flush()
    observer.disconnect()
    expect(changes).toHaveLength(0)
  })

  it('reveals both axes using editor-relative rather than scroller-relative coordinates', async () => {
    const { anchor, scroll, containerRect } = setup()
    containerRect.mockReturnValue(rect(150, 130, 600, 1000))
    anchor.update(geometry({ left: 190, top: 90 }), true)
    await flush()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: 41, top: 44,
      behavior: 'instant' })
  })

  it('converts CSS transformed geometry to scroll units without applying DPR twice', async () => {
    const { anchor, scroll, containerRect, portRect } = setup()
    containerRect.mockReturnValue(rect(100, 100, 1200, 2000))
    portRect.mockReturnValue(rect(100, 100, 400, 200))
    anchor.update(geometry({ left: 210, top: 110 }), true)
    await flush()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: 11, top: 34,
      behavior: 'instant' })
  })

  it('projects an inner scroll before deciding whether an outer port needs scrolling', async () => {
    const { anchor, port, scroll } = setup()
    const outer = document.createElement('div')
    outer.style.overflowY = 'auto'
    port.before(outer)
    outer.append(port)
    dimensions(outer, { offsetWidth: 300, offsetHeight: 120,
      clientWidth: 300, clientHeight: 120, scrollHeight: 2000 })
    vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(rect(90, 90, 300, 120))
    const outerScroll = vi.spyOn(outer, 'scroll').mockImplementation(() => {})
    anchor.update(geometry({ top: 200 }), true)
    await flush()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 124,
      behavior: 'instant' })
    expect(outerScroll).not.toHaveBeenCalled()
  })

  it('supports negative scrollLeft in RTL scroll containers', async () => {
    const { anchor, port, scroll, containerRect } = setup()
    port.style.direction = 'rtl'
    containerRect.mockReturnValue(rect(50, 100, 600, 1000))
    anchor.update(geometry({ left: 0, direction: 'rtl' }), true)
    await flush()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: -50, top: 0,
      behavior: 'instant' })
  })

  it('does not fight manual scroll and merges viewport invalidations into one frame', async () => {
    const { anchor, port, scroll, refresh } = setup()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => {
      frames.push(callback)
      return frames.length
    }))
    port.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(1)
    frames[0](0)
    expect(refresh).toHaveBeenCalledExactlyOnceWith(true)
    anchor.update(geometry({ top: 500 }), false)
    await flush()
    expect(scroll).not.toHaveBeenCalled()
  })

  it('cancels stale placement on completion and restores preexisting inline styles', async () => {
    const { anchor, agent, caret } = setup()
    agent.style.width = '75px'
    anchor.update(geometry(), false)
    await flush()
    anchor.update(geometry({ left: 999 }), false)
    anchor.restore()
    await flush()
    expect(agent.style.width).toBe('75px')
    expect(agent.style.height).toBe('')
    expect(caret.style.left).toBe('30px')
  })

  it('uses the visual viewport and document scrolling when there is no clipping ancestor', async () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 50, offsetTop: 100, width: 300, height: 200
    })
    vi.stubGlobal('visualViewport', viewport)
    const { anchor, port } = setup()
    port.style.overflowX = 'visible'
    port.style.overflowY = 'visible'
    const root = document.scrollingElement || document.documentElement
    vi.spyOn(root, 'scrollHeight', 'get').mockReturnValue(4000)
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(768)
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    anchor.update(geometry({ top: 180 }), true)
    await flush()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 4,
      behavior: 'instant' })
  })

  it('does not place or schedule viewport callbacks after destruction', async () => {
    const { anchor, agent, refresh } = setup()
    anchor.update(geometry(), true)
    anchor.destroy()
    window.dispatchEvent(new Event('resize'))
    await flush()
    expect(agent.style.left).toBe('')
    expect(refresh).not.toHaveBeenCalled()
  })
})

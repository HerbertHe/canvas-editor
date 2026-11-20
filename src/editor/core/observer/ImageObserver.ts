interface PendingImage {
  pages: Map<HTMLCanvasElement, number>
  done: Promise<void>
}

export class ImageObserver {
  private assets = new Map<string, HTMLImageElement | null>()
  private pending = new Map<string, PendingImage>()
  private pageVersions = new WeakMap<HTMLCanvasElement, number>()
  private promiseList = new Set<Promise<unknown>>()
  private paintedVersion = 0
  private destroyed = false

  constructor(private invalidate: (page: HTMLCanvasElement) => void) {}

  public beginPage(page: HTMLCanvasElement) {
    this.pageVersions.set(page, ++this.paintedVersion)
  }

  public get(page: HTMLCanvasElement, source: string, fallback?: () => string) {
    if (!source || this.destroyed) return undefined
    const key = (fallback ? 'fallback:' : 'image:') + source
    if (this.assets.has(key)) return this.assets.get(key) || undefined
    let task = this.pending.get(key)
    if (!task) {
      const pages = new Map<HTMLCanvasElement, number>()
      const done = this.load(source).catch(() =>
        fallback ? this.load(fallback()) : null
      ).catch(() => null).then(image => {
        this.pending.delete(key)
        if (this.destroyed) return
        this.assets.set(key, image)
        if (image) {
          for (const [target, version] of pages) {
            if (this.pageVersions.get(target) === version) this.invalidate(target)
          }
        }
      })
      task = { pages, done }
      this.pending.set(key, task)
    }
    const version = this.pageVersions.get(page)
    if (version !== undefined) task.pages.set(page, version)
    this.add(task.done)
    return undefined
  }

  private load(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'Anonymous'
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = source
    })
  }

  public forgetPage(page: HTMLCanvasElement) {
    this.pageVersions.delete(page)
    for (const task of this.pending.values()) task.pages.delete(page)
  }

  public add(payload: Promise<unknown>) {
    this.promiseList.add(payload)
  }

  public clearAll() {
    this.promiseList.clear()
  }

  public allSettled() {
    return Promise.allSettled(this.promiseList)
  }

  public destroy() {
    this.destroyed = true
    this.assets.clear()
    for (const task of this.pending.values()) task.pages.clear()
    this.pending.clear()
    this.clearAll()
  }
}

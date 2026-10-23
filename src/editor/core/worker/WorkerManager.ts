import { WorkerRequestRegistry } from './WorkerRequestRegistry'
import { version } from '../../../../package.json'
import { Draw } from '../draw/Draw'
import WordCountWorker from './works/wordCount?worker&inline'
import CatalogWorker from './works/catalog?worker&inline'
import GroupWorker from './works/group?worker&inline'
import ValueWorker from './works/value?worker&inline'
import { ICatalog } from '../../interface/Catalog'
import { IEditorResult } from '../../interface/Editor'
import { IGetValueOption } from '../../interface/Draw'
import { deepClone } from '../../utils'
import { countWords } from './works/wordCountModel'
import { getCatalog } from './works/catalogModel'
import { getGroupIds } from './works/groupModel'
import { serializeValue } from './works/valueModel'

export class WorkerManager {
  private requests = new WorkerRequestRegistry()
  private catalogCache: { signature: string; promise: Promise<ICatalog | null> } | null = null
  private draw: Draw
  private wordCountWorker: Worker | null
  private catalogWorker: Worker | null
  private groupWorker: Worker | null
  private valueWorker: Worker | null
  private destroyed = false
  private failed = new WeakSet<Worker>()
  readonly stats = { unavailable: 0, fallbacks: 0 }

  constructor(draw: Draw) {
    this.draw = draw
    const create = (factory: () => Worker) => {
      try {
        const worker = factory()
        this.requests.attach(worker)
        return worker
      }
      catch { this.stats.unavailable++; return null }
    }
    this.wordCountWorker = create(() => new WordCountWorker())
    this.catalogWorker = create(() => new CatalogWorker())
    this.groupWorker = create(() => new GroupWorker())
    this.valueWorker = create(() => new ValueWorker())
  }

  private request<T, P>(worker: Worker | null, payload: P,
    compute: (payload: P) => T): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error('Worker manager destroyed'))
    // Keep the request snapshot even if CSP fails asynchronously after posting.
    const snapshot = deepClone(payload)
    const fallback = () => {
      if (this.destroyed) throw new Error('Worker manager destroyed')
      this.stats.fallbacks++
      return compute(snapshot)
    }
    if (!worker || this.failed.has(worker)) return Promise.resolve().then(fallback)
    return this.requests.request<T>(worker, snapshot, this.revision()).catch(error => {
      if (this.destroyed) throw error
      this.failed.add(worker)
      return fallback()
    })
  }

  private revision() {
    return this.draw.getDocumentRevision?.() || 0
  }

  public getWordCount(): Promise<number> {
    const count = this.draw.getDerivedWordCount?.() ?? null
    if (count !== null) return Promise.resolve(count)
    return this.request(this.wordCountWorker,
      this.draw.getOriginalMainElementList(), countWords)
  }

  public getCatalog(): Promise<ICatalog | null> {
    const signature = this.draw.getDerivedCatalogSignature?.() ?? null
    if (signature !== null && this.catalogCache?.signature === signature)
      return this.catalogCache.promise.then(value => deepClone(value))
    const promise = this.request(this.catalogWorker, {
      elementList: this.draw.getOriginalMainElementList(),
      positionList: this.draw.getPosition().getOriginalMainPositionList()
    }, getCatalog)
    if (signature !== null) {
      const entry = { signature, promise }
      this.catalogCache = entry
      promise.catch(() => { if (this.catalogCache === entry) this.catalogCache = null })
    }
    return promise.then(value => deepClone(value))
  }

  public getGroupIds(): Promise<string[]> {
    return this.request(this.groupWorker,
      this.draw.getOriginalMainElementList(), getGroupIds)
  }

  public async getValue(options?: IGetValueOption): Promise<IEditorResult> {
    const snapshotOptions = deepClone(this.draw.getOptions())
    const data = await this.request(
      this.valueWorker, { data: this.draw.getOriginValue(options), options },
      serializeValue)
    return { version, data, options: snapshotOptions }
  }

  public destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.catalogCache = null
    // Also attach unused workers so all four are terminated exactly once.
    for (const worker of [this.wordCountWorker, this.catalogWorker,
      this.groupWorker, this.valueWorker]) if (worker) this.requests.attach(worker)
    this.requests.destroy()
  }
}

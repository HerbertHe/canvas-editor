interface Response {
  requestId: number
  revision: number
  result?: unknown
  error?: string
}
interface Pending {
  worker: Worker
  revision: number
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** One listener per worker, one owned completion per request. */
export class WorkerRequestRegistry {
  private sequence = 0
  private pending = new Map<number, Pending>()
  private workers = new Set<Worker>()
  private failures = new WeakMap<Worker, Error>()
  private destroyed = false

  constructor(private timeoutMs = 30000) {}

  attach(worker: Worker) {
    if (this.destroyed || this.workers.has(worker)) return
    this.workers.add(worker)
    worker.onmessage = (event: MessageEvent<Response>) => {
      const response = event.data
      const pending = this.pending.get(response?.requestId)
      if (!pending || pending.worker !== worker) return
      if (response.revision !== pending.revision)
        this.finish(response.requestId, new Error('Worker revision mismatch'))
      else if (response.error)
        this.finish(response.requestId, new Error(response.error))
      else this.finish(response.requestId, undefined, response.result)
    }
    worker.onerror = event => {
      event.preventDefault?.()
      this.fail(worker, new Error(event.message || 'Worker error'))
    }
    worker.onmessageerror = () => this.fail(worker, new Error('Worker message decode failed'))
  }

  request<T>(worker: Worker, payload: unknown, revision: number): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error('Worker manager destroyed'))
    this.attach(worker)
    const failure = this.failures.get(worker)
    if (failure) return Promise.reject(failure)
    const requestId = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() =>
        this.finish(requestId, new Error('Worker request timed out')), this.timeoutMs)
      this.pending.set(requestId, { worker, revision, resolve, reject, timer })
      try {
        worker.postMessage({ requestId, revision, payload })
      } catch (error) {
        this.finish(requestId, error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private finish(id: number, error?: Error, value?: unknown) {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (error) pending.reject(error)
    else pending.resolve(value)
  }

  private fail(worker: Worker, error: Error) {
    this.failures.set(worker, error)
    for (const [id, pending] of this.pending)
      if (pending.worker === worker) this.finish(id, error)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const id of this.pending.keys())
      this.finish(id, new Error('Worker manager destroyed'))
    for (const worker of this.workers) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    this.workers.clear()
  }
}

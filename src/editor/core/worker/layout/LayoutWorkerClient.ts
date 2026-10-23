import { decodeLayout, layoutTransferBuffers } from './layoutCodec'
import LayoutWorker from './layout.worker?worker&inline'
import type { EditDocument, EditTransaction } from '../../history/EditTransaction'
import type { IEditorFontFace } from '../../../interface/TextEngine'
import type { NativeParagraphInput } from '../../text-engine/layout/TextLayoutService'
import type { LayoutRequest, LayoutResponse, LayoutVersion } from './protocol'

interface Pending {
  version: LayoutVersion
  resolve: (response: LayoutResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  bytes: number
  expected: LayoutResponse['type']
}
type Payload = LayoutRequest extends infer R
  ? R extends LayoutRequest ? Omit<R, keyof LayoutVersion> : never : never

/** One in-flight layout, one latest waiting layout; edits are never coalesced. */
export class LayoutWorkerClient {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private sessionId = 0
  private sequence = 0
  private bytes = 0
  private revision = 0
  private fontRevision = 0
  private constraintsRevision = 0
  private destroyed = false
  ready = false
  private busy = false
  private latest: { run: () => void; reject: (error: Error) => void } | null = null
  private edits: { transaction: EditTransaction; bytes: number;
    resolve: (response: LayoutResponse) => void; reject: (error: Error) => void }[] = []
  private editBytes = 0
  private editing: Promise<void> | null = null
  private layoutWork: Promise<void> | null = null
  readonly stats = { sent: 0, received: 0, rejected: 0, stale: 0,
    postMs: 0, prepareMs: 0, roundTripMs: 0, layoutMs: 0, workerComputeMs: 0, maxPending: 0, maxBytes: 0, maxWaitingBytes: 0, restarts: 0,
    decodeMs: 0, maxPoolBytes: 0, transferredBytes: 0, recycledBuffers: 0,
    packedResponses: 0, editBatches: 0, batchedEdits: 0, maxBufferedEdits: 0 }

  constructor(
    private create: () => Worker = () => new LayoutWorker(),
    private timeoutMs = 5000,
    private byteBudget = 16 * 1024 * 1024,
    private transferResults = false
  ) {}

  async initialize(model: EditDocument, fonts: IEditorFontFace[],
    defaultFont: string, revision: number, fontRevision: number) {
    if (this.destroyed) throw new Error('Layout worker destroyed')
    this.reset(new Error('Layout session replaced'))
    this.sessionId++
    this.stats.restarts++
    this.revision = revision
    this.fontRevision = fontRevision
    const session = this.sessionId
    const worker = this.worker = this.create()
    worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
      const response = event.data
      if (response.sessionId !== session || session !== this.sessionId) {
        this.stats.stale++
        return
      }
      if (response.poolBytes !== undefined)
        this.stats.maxPoolBytes = Math.max(this.stats.maxPoolBytes, response.poolBytes)
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      if (response.type !== pending.expected || response.documentRevision !== pending.version.documentRevision ||
        response.fontRevision !== pending.version.fontRevision ||
        response.constraintsRevision !== pending.version.constraintsRevision) {
        this.finish(response.requestId, new Error(response.error || 'Layout version mismatch'))
        if (response.needsResync) this.ready = false
      } else {
        try {
          if (response.packed) {
            const started = performance.now()
            const buffers = layoutTransferBuffers(response.packed)
            response.layouts = response.packed.map(decodeLayout)
            delete response.packed
            this.stats.decodeMs += performance.now() - started
            this.stats.packedResponses++
            this.stats.transferredBytes += buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0)
            worker.postMessage({ type: 'recycle', ...pending.version, requestId: 0,
              buffers }, buffers)
            this.stats.recycledBuffers += buffers.length
          }
          this.finish(response.requestId, undefined, response)
        } catch (error) { this.reset(new Error('Layout decode failed: ' + error)) }
      }
    }
    worker.onerror = event => {
      event.preventDefault?.()
      this.reset(new Error(event.message || 'Layout worker crashed'))
    }
    worker.onmessageerror = () => this.reset(new Error('Layout worker decode failed'))
    await this.request({ type: 'init', model, fonts, defaultFont })
    if (session === this.sessionId && !this.destroyed) this.ready = true
  }

  edit(transaction: EditTransaction) {
    if (!this.ready || transaction.baseRevision !== this.revision)
      return Promise.reject(new Error('Layout edits require resynchronization'))
    const bytes = JSON.stringify(transaction).length * 2
    if (this.editBytes + bytes > this.byteBudget / 4 || this.edits.length >= 128) {
      this.ready = false
      return Promise.reject(new Error('Layout edit queue requires resynchronization'))
    }
    this.revision = transaction.targetRevision
    const result = new Promise<LayoutResponse>((resolve, reject) => {
      this.edits.push({ transaction, bytes, resolve, reject })
      this.editBytes += bytes
      this.stats.maxBufferedEdits = Math.max(this.stats.maxBufferedEdits,
        this.edits.length)
    })
    // One acknowledged batch in flight. Preserve every transaction in order;
    // a busy main thread no longer creates one transport request per key.
    queueMicrotask(() => this.flushEdits())
    return result
  }

  private flushEdits() {
    if (this.editing || !this.edits.length || !this.ready) return
    const batch = this.edits.splice(0)
    this.editBytes = 0
    this.stats.editBatches++
    this.stats.batchedEdits += batch.length
    const session = this.sessionId
    const pending = this.request({ type: 'edits',
      transactions: batch.map(edit => edit.transaction) },
      batch.at(-1)!.transaction.targetRevision).then(response => {
      batch.forEach(edit => edit.resolve(response))
    }, error => {
      batch.forEach(edit => edit.reject(error))
      if (session !== this.sessionId) return
      this.ready = false
      for (const edit of this.edits.splice(0)) edit.reject(error)
      this.editBytes = 0
    }).finally(() => {
      if (this.editing !== pending) return
      this.editing = null
      this.flushEdits()
    })
    this.editing = pending
  }

  async waitForEdits() {
    this.flushEdits()
    while (this.editing) await this.editing
    if (!this.ready) throw new Error('Layout edits require resynchronization')
  }

  async waitForIdle() {
    await this.waitForEdits()
    while (this.layoutWork) await this.layoutWork
    await this.waitForEdits()
  }

  getRevision() { return this.revision }
  getSession() { return this.sessionId }

  getQueueStats() {
    return { requests: this.pending.size, waiting: !!this.latest,
      queuedBytes: this.bytes + this.editBytes, bufferedEdits: this.edits.length }
  }

  async inspect() {
    if (this.destroyed || !this.worker) throw new Error('Layout worker unavailable')
    await this.waitForEdits()
    return this.request({ type: 'inspect' })
  }

  layout(inputs: NativeParagraphInput[], constraintsRevision: number, simpleFlow = false) {
    const waitingBytes = JSON.stringify(inputs).length * 2
    if (waitingBytes > this.byteBudget / 4)
      return Promise.reject(new Error('Layout input exceeds waiting queue budget'))
    const revision = this.revision
    const session = this.sessionId
    return new Promise<LayoutResponse>((resolve, reject) => {
      const run = () => {
        if (revision !== this.revision || session !== this.sessionId) {
          reject(new Error('Layout superseded by a newer model'))
          return
        }
        this.busy = true
        this.constraintsRevision = constraintsRevision
        const post = () => {
          if (revision !== this.revision || session !== this.sessionId)
            return Promise.reject(new Error('Layout superseded by a newer model'))
          return this.request({ type: 'layout', inputs, simpleFlow,
            transferResults: this.transferResults })
        }
        const response = this.editing || this.edits.length
          ? this.waitForEdits().then(post) : post()
        const work = response.then(resolve, reject).finally(() => {
          if (session !== this.sessionId) return
          this.busy = false
          this.layoutWork = null
          const next = this.latest
          this.latest = null
          next?.run()
        })
        this.layoutWork = work
      }
      if (!this.busy) run()
      else {
        this.latest?.reject(new Error('Layout superseded by a newer request'))
        this.latest = { run, reject }
        this.stats.maxWaitingBytes = Math.max(this.stats.maxWaitingBytes, waitingBytes)
      }
    })
  }

  private request(payload: Payload, revision = this.revision): Promise<LayoutResponse> {
    if (this.destroyed || !this.worker)
      return Promise.reject(new Error('Layout worker unavailable'))
    const version = { sessionId: this.sessionId, requestId: ++this.sequence,
      documentRevision: revision, fontRevision: this.fontRevision,
      constraintsRevision: this.constraintsRevision }
    // This conservative limit includes JSON DTOs and font bytes; no detached ownership.
    const prepareStart = performance.now()
    const bytes = JSON.stringify(payload).length * 2 + (payload.type === 'init'
      ? payload.fonts.reduce((sum, font) => sum + (font.data?.byteLength || 0), 0) : 0)
    this.stats.prepareMs += performance.now() - prepareStart
    if (bytes + this.bytes > this.byteBudget || this.pending.size >= 128) {
      this.ready = false
      return Promise.reject(new Error('Layout queue budget requires resynchronization'))
    }
    return new Promise((resolve, reject) => {
      const started = performance.now()
      const timer = setTimeout(() => this.reset(new Error('Layout worker timed out')), this.timeoutMs)
      this.pending.set(version.requestId, { version, bytes, timer,
        expected: payload.type === 'layout' ? 'layout' : payload.type === 'inspect' ? 'mirror' : 'ack',
        resolve: response => {
        const elapsed = performance.now() - started
        this.stats.roundTripMs += elapsed
        if (payload.type === 'layout') {
          let index = 0
          response.inputs = payload.inputs.flatMap(input => {
            if (!payload.simpleFlow) { index++; return [input] }
            const initial = response.layouts![index]
            index += 2
            return [input, { ...input,
              lineWidths: initial.lines.map(() => input.availableWidth),
              lineOffsets: initial.lines.map(() => 0) }]
          })
          this.stats.layoutMs += elapsed
          this.stats.workerComputeMs += response.computeMs || 0
        }
        resolve(response)
      }, reject })
      this.bytes += bytes
      this.stats.maxBytes = Math.max(this.stats.maxBytes, this.bytes)
      this.stats.maxPending = Math.max(this.stats.maxPending, this.pending.size)
      try {
        this.worker!.postMessage({ ...payload, ...version })
        this.stats.sent++
        this.stats.postMs += performance.now() - started
      } catch (error) {
        this.finish(version.requestId, new Error(String(error)))
      }
    })
  }

  private finish(id: number, error?: Error, response?: LayoutResponse) {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    this.bytes -= pending.bytes
    if (error) { this.stats.rejected++; pending.reject(error) }
    else { this.stats.received++; pending.resolve(response!) }
  }

  private reset(error: Error) {
    this.ready = false
    this.busy = false
    this.latest?.reject(error)
    this.latest = null
    for (const edit of this.edits.splice(0)) edit.reject(error)
    this.editBytes = 0
    this.editing = null
    this.layoutWork = null
    for (const id of this.pending.keys()) this.finish(id, error)
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null
      this.worker.terminate()
      this.worker = null
    }
  }

  destroy() {
    this.destroyed = true
    this.reset(new Error('Layout worker destroyed'))
  }
}

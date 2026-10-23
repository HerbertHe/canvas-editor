import { TransferBufferPool } from './TransferBufferPool'
import { encodeLayout } from './layoutCodec'
import { LayoutKernel } from '../../text-engine/layout/LayoutKernel'
import { applyOperation } from '../../history/EditTransaction'
import type { EditDocument } from '../../history/EditTransaction'
import type { LayoutRequest, LayoutResponse } from './protocol'

/** The worker adapter serializes calls; this class is also testable without DOM. */
export class LayoutWorkerServer {
  private pool = new TransferBufferPool()
  private kernel: LayoutKernel | null = null
  private model: EditDocument | null = null
  private session = -1
  private revision = 0
  private fontRevision = 0

  async handle(message: LayoutRequest): Promise<LayoutResponse> {
    const { sessionId, requestId, documentRevision, fontRevision,
      constraintsRevision } = message
    const version = { sessionId, requestId, documentRevision, fontRevision,
      constraintsRevision }
    try {
      if (message.type === 'init') {
        this.destroy()
        this.session = message.sessionId
        this.revision = message.documentRevision
        this.fontRevision = message.fontRevision
        this.kernel = new LayoutKernel(undefined, () => true)
        await this.kernel.initialize(message.fonts, message.defaultFont)
        this.model = structuredClone(message.model)
        return { ...version, type: 'ack' }
      }
      if (!this.kernel || !this.model || message.sessionId !== this.session)
        throw new Error('Layout session requires resynchronization')
      if (message.fontRevision !== this.fontRevision)
        throw new Error('Layout fonts require resynchronization')
      if (message.type === 'recycle') {
        message.buffers.forEach(buffer => this.pool.release(buffer))
        return { ...version, type: 'ack', poolBytes: this.pool.stats.retainedBytes }
      }
      if (message.type === 'dispose') {
        this.destroy()
        return { ...version, type: 'ack' }
      }
      if (message.type === 'edit' || message.type === 'edits') {
        const transactions = message.type === 'edit'
          ? [message.transaction] : message.transactions
        for (const transaction of transactions) {
          if (transaction.baseRevision !== this.revision ||
            transaction.targetRevision !== this.revision + 1)
            throw new Error('Layout edit revision requires resynchronization')
          for (const operation of transaction.operations)
            applyOperation(operation, scope => {
              if (scope !== 'main' && scope !== 'header' && scope !== 'footer')
                throw new Error('Unsupported worker scope requires resynchronization')
              return this.model![scope]
            }, model => { this.model = model })
          this.revision = transaction.targetRevision
        }
        if (this.revision !== documentRevision)
          throw new Error('Layout batch revision requires resynchronization')
        return { ...version, type: 'ack', documentRevision: this.revision }
      }
      if (message.documentRevision !== this.revision)
        throw new Error('Layout model requires resynchronization')
      if (message.type === 'inspect')
        return { ...version, type: 'mirror', model: structuredClone(this.model) }
      if (message.type !== 'layout') throw new Error('Unknown layout request')
      const layouts = []
      const inputs = []
      let computeMs = 0
      let estimatedBytes = 0
      for (const input of message.inputs) {
        const scope = input.source.scope
        if (scope !== 'main' && scope !== 'header' && scope !== 'footer')
          throw new Error('Unsupported worker text scope')
        if (input.source.start < 0 || input.source.end > this.model[scope].length)
          throw new Error('Layout source is outside mirrored model')
        const started = performance.now()
        const initial = this.kernel.layout({ schemaVersion: 1, input }).layout
        inputs.push(input)
        layouts.push(initial)
        if (message.simpleFlow) {
          const constrained = { ...input,
            lineWidths: initial.lines.map(() => input.availableWidth),
            lineOffsets: initial.lines.map(() => 0) }
          inputs.push(constrained)
          layouts.push(this.kernel.layout({ schemaVersion: 1, input: constrained }).layout)
        }
        computeMs += performance.now() - started
        estimatedBytes += layouts.slice(inputs.length - (message.simpleFlow ? 2 : 1))
          .reduce((bytes, layout) => bytes + layout.lines.reduce((n, line) => n + 512 +
            line.glyphs.length * 256 + line.clusters.length * 512 +
            line.carets.length * 256 + line.inlines.length * 512, 0) +
            layout.shaped.lines.reduce((n, line) => n + line.glyphs.length * 1024, 0), 0)
        if (estimatedBytes > 16 * 1024 * 1024)
          throw new Error('Layout result exceeds transport budget')
        // Cancellation cannot interrupt synchronous HB; yield between paragraphs.
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      if (message.transferResults && estimatedBytes > 256 * 1024) {
        const packed = layouts.map(layout => encodeLayout(layout, this.pool).packed)
        return { ...version, type: 'layout', packed, computeMs, estimatedBytes,
          poolBytes: this.pool.stats.retainedBytes }
      }
      return { ...version, type: 'layout', layouts, computeMs, estimatedBytes,
        poolBytes: this.pool.stats.retainedBytes }
    } catch (error) {
      return { ...version, type: 'error', error: String(error), needsResync: true }
    }
  }

  destroy() {
    this.pool.clear()
    this.kernel?.destroy()
    this.kernel = null
    this.model = null
    this.session = -1
  }
}

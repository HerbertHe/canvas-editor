/** Only returned, attached buffers are retained. Transferred buffers stay owned
 * by the receiver until it explicitly recycles them. */
export class TransferBufferPool {
  private buffers = new Set<ArrayBuffer>()
  private bytes = 0
  readonly stats = { allocations: 0, reuses: 0, retainedBytes: 0 }

  constructor(private budget = 8 * 1024 * 1024, private limit = 16) {}

  acquire(bytes: number) {
    for (const buffer of this.buffers) {
      if (buffer.byteLength >= bytes && buffer.byteLength <= Math.max(bytes * 2, 128)) {
        this.buffers.delete(buffer)
        this.bytes -= buffer.byteLength
        this.stats.retainedBytes = this.bytes
        this.stats.reuses++
        return buffer
      }
    }
    this.stats.allocations++
    return new ArrayBuffer(bytes)
  }

  release(buffer: ArrayBuffer) {
    if (!buffer.byteLength || this.buffers.has(buffer) ||
      this.bytes + buffer.byteLength > this.budget || this.buffers.size >= this.limit)
      return
    this.buffers.add(buffer)
    this.bytes += buffer.byteLength
    this.stats.retainedBytes = this.bytes
  }

  clear() {
    this.buffers.clear()
    this.bytes = this.stats.retainedBytes = 0
  }
}

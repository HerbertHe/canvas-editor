/** Latest-state scheduling only. The consumer owns document and geometry rules. */
export class CompositionSession {
  readonly stats = { received: 0, merged: 0, flushed: 0, previews: 0, fallbacks: 0 }
  value = ''
  sequence = 0
  applying = false
  local = true
  private pending = false
  private closed = false
  private frame: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private consume: (value: string, local: boolean) => void) {}

  update(value: string, scheduled: boolean) {
    if (this.closed) return
    this.stats.received++
    if (this.pending) this.stats.merged++
    this.value = value
    this.sequence++
    this.pending = true
    if (!scheduled) { this.flush(); return }
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => this.flush())
    // A suspended rAF must not leave a geometry consumer or hidden tab stranded.
    this.timer = setTimeout(() => this.flush(), 50)
  }

  flush(materialize = false) {
    if (this.closed || this.applying) return
    this.cancel()
    if (materialize && this.local) {
      this.local = false
      if (this.stats.received) this.pending = true
    }
    if (!this.pending) return
    this.pending = false
    this.applying = true
    try {
      this.consume(this.value, this.local)
      this.stats.flushed++
    } finally { this.applying = false }
  }

  close() {
    this.closed = true
    this.pending = false
    this.cancel()
  }

  private cancel() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    if (this.timer !== null) clearTimeout(this.timer)
    this.frame = null
    this.timer = null
  }
}

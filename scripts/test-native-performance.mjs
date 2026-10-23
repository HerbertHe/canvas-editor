// Preserve the historical kernel suite; opt into PERF-01 real keyboard QA.
const mode = process.env.MODE || 'kernel'
if (mode === 'interaction') {
  await import('./test-interaction-performance.mjs')
} else if (mode === 'kernel') {
  await import('./test-kernel-performance.mjs')
} else {
  throw new Error(`Unknown performance MODE: ${mode}`)
}

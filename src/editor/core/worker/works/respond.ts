/** Keep request identity even when requests finish out of order or fail. */
export function respond<T>(compute: (payload: T) => unknown) {
  onmessage = event => {
    const { requestId, revision, payload } = event.data
    try {
      postMessage({ requestId, revision, result: compute(payload) })
    } catch (error) {
      postMessage({ requestId, revision,
        error: error instanceof Error ? error.message : String(error) })
    }
  }
}

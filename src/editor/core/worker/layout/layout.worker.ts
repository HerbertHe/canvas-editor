import { layoutTransferBuffers } from './layoutCodec'
import { LayoutWorkerServer } from './LayoutWorkerServer'
import type { LayoutRequest } from './protocol'

const server = new LayoutWorkerServer()
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  queue = queue.then(async () => {
    const response = await server.handle(event.data)
    self.postMessage(response, {
      transfer: response.packed ? layoutTransferBuffers(response.packed) : []
    })
  }).catch(error => {
    self.postMessage({ ...event.data, type: 'error', error: String(error),
      needsResync: true })
  })
}

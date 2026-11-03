import { CanvasEvent } from '../CanvasEvent'

function compositionstart(host: CanvasEvent) {
  host.isComposing = true
}

export default {
  compositionstart
}

import type { DocumentFlow, FlowState } from './DocumentFlow'

export interface FlowCheckpoint {
  schemaVersion: 1
  nodeId: string
  dependencies: string
  state: FlowState
  page: ReturnType<DocumentFlow['page']>
  exclusions: DocumentFlow['exclusions']
  paged: boolean
}

export function captureFlow(
  flow: DocumentFlow,
  nodeId: string,
  dependencies: string
): FlowCheckpoint {
  const page = flow.page(flow.state.pageNo, flow.state.direction)
  return {
    schemaVersion: 1, nodeId, dependencies,
    state: { ...flow.state }, page: { ...page, columns: [...page.columns] },
    exclusions: flow.exclusions.map(rect => ({ ...rect })), paged: flow.paged
  }
}

export function checkpointMismatch(
  checkpoint: FlowCheckpoint,
  flow: DocumentFlow,
  dependencies: string
): 'dependencies' | 'exclusions' | 'page' | null {
  if (checkpoint.dependencies !== dependencies || checkpoint.paged !== flow.paged)
    return 'dependencies'
  if (JSON.stringify(checkpoint.exclusions) !== JSON.stringify(flow.exclusions))
    return 'exclusions'
  const page = flow.page(checkpoint.state.pageNo, checkpoint.state.direction)
  if (Object.keys(page).some(key => {
    const field = key as keyof typeof page
    const a = page[field]
    const b = checkpoint.page[field]
    return Array.isArray(a) ? JSON.stringify(a) !== JSON.stringify(b) : a !== b
  })) return 'page'
  return null
}

export function restoreFlow(
  flow: DocumentFlow,
  checkpoint: FlowCheckpoint,
  dependencies: string
) {
  const mismatch = checkpointMismatch(checkpoint, flow, dependencies)
  if (mismatch) throw new Error(`Unsafe flow checkpoint: ${mismatch}`)
  flow.state = { ...checkpoint.state }
}

export function sameFlow(a: FlowState, b: FlowState) {
  return a.pageNo === b.pageNo && a.columnIndex === b.columnIndex &&
    a.direction === b.direction && a.y === b.y
}

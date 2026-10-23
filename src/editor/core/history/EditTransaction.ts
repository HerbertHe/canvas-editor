import type { IEditorData } from '../../interface/Editor'
import type { IElement } from '../../interface/Element'

export type EditDocument = Pick<Required<IEditorData>, 'main' | 'header' | 'footer'>

export interface AttributeValue { present: boolean; value?: unknown }
export type EditOperation = {
  kind: 'snapshot'
  scope: 'document'
  before: EditDocument
  after: EditDocument
} | {
  kind: 'splice'
  scope: string
  index: number
  before: IElement[]
  after: IElement[]
} | {
  kind: 'attributes'
  scope: string
  index: number
  before: Record<string, AttributeValue>
  after: Record<string, AttributeValue>
}
export interface EditTransaction<State = unknown> {
  baseRevision: number
  targetRevision: number
  kind: string
  before: State
  after: State
  operations: EditOperation[]
  dirtyScopes: string[]
  source: 'edit' | 'undo' | 'redo' | 'rollback' | 'snapshot'
}

export function inverseOperation(operation: EditOperation): EditOperation {
  if (operation.kind === 'snapshot')
    return { ...operation, before: operation.after, after: operation.before }
  if (operation.kind === 'splice')
    return { ...operation, before: operation.after, after: operation.before }
  return { ...operation, before: operation.after, after: operation.before }
}

export function applyOperation(
  operation: EditOperation,
  resolve: (scope: string) => IElement[],
  replace?: (model: EditDocument) => void
) {
  if (operation.kind === 'snapshot') {
    if (!replace) throw new Error('Snapshot replay requires a document owner')
    replace(structuredClone(operation.after))
    return
  }
  const elements = resolve(operation.scope)
  if (operation.kind === 'splice') {
    elements.splice(operation.index, operation.before.length,
      ...structuredClone(operation.after))
  } else {
    const element = elements[operation.index]
    if (!element) throw new Error('Transaction attribute target no longer exists')
    for (const [key, attribute] of Object.entries(operation.after)) {
      if (attribute.present) Reflect.set(element, key, structuredClone(attribute.value))
      else Reflect.deleteProperty(element, key)
    }
  }
}

/** Revisions belong to committed model edits, never to render calls. */
export class EditJournal<State = unknown> {
  private revision = 0
  private listeners = new Set<(transaction: EditTransaction<State>) => void>()

  getRevision() { return this.revision }

  subscribe(listener: (transaction: EditTransaction<State>) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(
    kind: string,
    operations: EditOperation[],
    before: State,
    after: State,
    source: EditTransaction['source'] = 'edit'
  ): EditTransaction<State> | null {
    if (!operations.length) return null
    const transaction: EditTransaction<State> = {
      baseRevision: this.revision,
      targetRevision: ++this.revision,
      kind, operations: structuredClone(operations),
      before: structuredClone(before), after: structuredClone(after),
      dirtyScopes: [...new Set(operations.map(operation => operation.scope))], source
    }
    for (const listener of this.listeners) listener(transaction)
    return transaction
  }

  destroy() { this.listeners.clear() }
}

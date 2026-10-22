# Event Listening(eventBus)

## Usage

```typescript
import Editor from '@herberthe/canvas-editor'

const instance = await Editor.create(container, data, options)
const onContentChange = () => console.log('Document changed')
instance.eventBus.on('contentChange', onContentChange)
// On unmount, remove the same callback:
instance.eventBus.off('contentChange', onContentChange)
```

EventBus supports multiple subscribers. `on()` returns void, not an unsubscribe function. Read a current snapshot for stateful reports after subscribing. The signatures below describe callback payloads; import their types from the package root.

## rangeChange

Feature: The selection changes

Usage:

```javascript
instance.eventBus.on('rangeChange', (payload: IRange) => void)
```

## rangeStyleChange

Feature: The selection style changes

Usage:

```javascript
instance.eventBus.on('rangeStyleChange', (payload: IRangeStyle) => void)
```

## visiblePageNoListChange

Feature: The visible page changes

Usage:

```javascript
instance.eventBus.on('visiblePageNoListChange', (payload: number[]) => void)
```

## intersectionPageNoChange

Feature: The current page changes

Usage:

```javascript
instance.eventBus.on('intersectionPageNoChange', (payload: number) => void)
```

## pageSizeChange

Feature: The current number of pages has changed

Usage:

```javascript
instance.eventBus.on('pageSizeChange', (payload: number) => void)
```

## pageScaleChange

Feature: The current page scaling has changed

Usage:

```javascript
instance.eventBus.on('pageScaleChange', (payload: number) => void)
```

## contentChange

Feature: The current content has changed

Usage:

```javascript
instance.eventBus.on('contentChange', () => void)
```

## controlChange

Feature: The control where the current cursor is located changes

Usage:

```javascript
instance.eventBus.on('controlChange', (payload: IControlChangeResult) => void)
```

## controlContentChange

Feature: The control content changes

Usage:

```javascript
instance.eventBus.on('controlContentChange', (payload: IControlContentChangeResult) => void)
```

## pageModeChange

Feature: The page mode changes

Usage:

```javascript
instance.eventBus.on('pageModeChange', (payload: PageMode) => void)
```

## saved

Feature: Document saved

Usage:

```javascript
instance.eventBus.on('saved', (payload: IEditorResult) => void)
```

## zoneChange

Feature: The zone changes

Usage:

```javascript
instance.eventBus.on('zoneChange', (payload: EditorZone) => void)
```

## mousemove

Feature: Editor mousemove event

Usage:

```javascript
instance.eventBus.on('mousemove', (evt: MouseEvent) => void)
```

## mouseenter

Feature: Editor mouseenter event

Usage:

```javascript
instance.eventBus.on('mouseenter', (evt: MouseEvent) => void)
```

## mouseleave

Feature: Editor mouseleave event

Usage:

```javascript
instance.eventBus.on('mouseleave', (evt: MouseEvent) => void)
```

## mousedown

Feature: Editor mousedown event

Usage:

```javascript
instance.eventBus.on('mousedown', (evt: MouseEvent) => void)
```

## mouseup

Feature: Editor mouseup event

Usage:

```javascript
instance.eventBus.on('mouseup', (evt: MouseEvent) => void)
```

## click

Feature: Editor click event

Usage:

```javascript
instance.eventBus.on('click', (evt: MouseEvent) => void)
```

## input

Feature: Editor input event

Usage:

```javascript
instance.eventBus.on('input', (evt: Event) => void)
```

## positionContextChange

Feature: The position context change

Usage:

```javascript
instance.eventBus.on('positionContextChange', (payload: IPositionContextChangePayload) => void)
```

## imageSizeChange

Feature: The image size change

Usage:

```javascript
instance.eventBus.on('imageSizeChange', (payload: { element: IElement }) => void)
```

## imageMousedown

Feature: The image mousedown event

Usage:

```javascript
instance.eventBus.on('imageMousedown', (payload: {
  evt: MouseEvent
  element: IElement
}) => void)
```

## imageDblclick

Feature: The image double click event

Usage:

```javascript
instance.eventBus.on('imageDblclick', (payload: {
  evt: MouseEvent
  element: IElement
}) => void)
```

## labelMousedown

Feature: The label mousedown event

Usage:

```javascript
instance.eventBus.on('labelMousedown', (payload: {
  evt: MouseEvent
  element: IElement
}) => void)
```

## renderChange

Emitted for layout-compute render passes. The initial event is deferred until ready; ordinary events precede subsequent nextTick tool updates. It does not mean all fonts, images and offscreen pages have finished. See [render timing](./rendering-pipeline.md).

```typescript
instance.eventBus.on('renderChange', () => {})
```

## spellcheckClick

Feature: The spell check misspelled word click event

Usage:

```javascript
instance.eventBus.on('spellcheckClick', (payload: {
  evt: MouseEvent
  range: ISpellcheckRange
}) => void)
```

## fontCoverageChange

Receives the current `FontCoverageReport` when coverage/download state changes;
resolved issues are removed. Query once after subscribing to avoid depending on
initial event timing. Built-in hints need no subscription.

```typescript
import type { FontCoverageReport } from '@herberthe/canvas-editor'

const onCoverage = (report: FontCoverageReport) => console.log(report.issues)
instance.eventBus.on('fontCoverageChange', onCoverage)
// instance.eventBus.off('fontCoverageChange', onCoverage)
const current = instance.getFontCoverageReport()
```

[Font APIs and coverage limits](./font-and-esm-migration.md).

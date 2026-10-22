# 事件监听(eventBus)

## 使用方式

```typescript
import Editor from '@herberthe/canvas-editor'

const instance = await Editor.create(container, data, options)
const onContentChange = () => console.log('Document changed')
instance.eventBus.on('contentChange', onContentChange)
// 卸载时用同一个函数取消订阅：
instance.eventBus.off('contentChange', onContentChange)
```

EventBus 支持多订阅者，`on()` 返回 void，不返回取消订阅函数。状态类报告在订阅后可主动读取当前快照。下方签名示意回调参数，类型从包根导入。

## rangeChange

功能：选区发生改变

用法：

```javascript
instance.eventBus.on('rangeChange', (payload: IRange) => void)
```

## rangeStyleChange

功能：选区样式发生改变

用法：

```javascript
instance.eventBus.on('rangeStyleChange', (payload: IRangeStyle) => void)
```

## visiblePageNoListChange

功能：可见页发生改变

用法：

```javascript
instance.eventBus.on('visiblePageNoListChange', (payload: number[]) => void)
```

## intersectionPageNoChange

功能：当前页发生改变

用法：

```javascript
instance.eventBus.on('intersectionPageNoChange', (payload: number) => void)
```

## pageSizeChange

功能：当前页数发生改变

用法：

```javascript
instance.eventBus.on('pageSizeChange', (payload: number) => void)
```

## pageScaleChange

功能：当前页面缩放比例发生改变

用法：

```javascript
instance.eventBus.on('pageScaleChange', (payload: number) => void)
```

## contentChange

功能：当前内容发生改变

用法：

```javascript
instance.eventBus.on('contentChange', () => void)
```

## controlChange

功能：当前光标所在控件发生改变

用法：

```javascript
instance.eventBus.on('controlChange', (payload: IControlChangeResult) => void)
```

## controlContentChange

功能：控件内容发生改变

用法：

```javascript
instance.eventBus.on('controlContentChange', (payload: IControlContentChangeResult) => void)
```

## pageModeChange

功能：页面模式发生改变

用法：

```javascript
instance.eventBus.on('pageModeChange', (payload: PageMode) => void)
```

## saved

功能：文档执行保存

用法：

```javascript
instance.eventBus.on('saved', (payload: IEditorResult) => void)
```

## zoneChange

功能：区域发生改变

用法：

```javascript
instance.eventBus.on('zoneChange', (payload: EditorZone) => void)
```

## mousemove

功能：编辑器 mousemove 事件监听

用法：

```javascript
instance.eventBus.on('mousemove', (evt: MouseEvent) => void)
```

## mouseenter

功能：编辑器 mouseenter 事件监听

用法：

```javascript
instance.eventBus.on('mouseenter', (evt: MouseEvent) => void)
```

## mouseleave

功能：编辑器 mouseleave 事件监听

用法：

```javascript
instance.eventBus.on('mouseleave', (evt: MouseEvent) => void)
```

## mousedown

功能：编辑器 mousedown 事件监听

用法：

```javascript
instance.eventBus.on('mousedown', (evt: MouseEvent) => void)
```

## mouseup

功能：编辑器 mouseup 事件监听

用法：

```javascript
instance.eventBus.on('mouseup', (evt: MouseEvent) => void)
```

## click

功能：编辑器 click 事件监听

用法：

```javascript
instance.eventBus.on('click', (evt: MouseEvent) => void)
```

## input

功能：编辑器 input 事件监听

用法：

```javascript
instance.eventBus.on('input', (evt: Event) => void)
```

## positionContextChange

功能：上下文内容发生改变

用法：

```javascript
instance.eventBus.on('positionContextChange', (payload: IPositionContextChangePayload) => void)
```

## imageSizeChange

功能：图片尺寸发生改变事件

用法：

```javascript
instance.eventBus.on('imageSizeChange', (payload: { element: IElement }) => void)
```

## imageMousedown

功能：图片 mousedown 事件

用法：

```javascript
instance.eventBus.on('imageMousedown', (payload: {
  evt: MouseEvent
  element: IElement
}) => void)
```

## imageDblclick

功能：图片双击事件

用法：

```javascript
instance.eventBus.on('imageDblclick', (payload: {
  evt: MouseEvent
  element: IElement
}) => void)
```

## labelMousedown

功能：标签 mousedown 事件

用法：

```javascript
instance.eventBus.on('labelMousedown', (payload: {
  evt: MouseEvent
  element: IElement
}) => void)
```

## renderChange

仅在计算布局的渲染轮次触发；首次延后到 ready 后，普通轮次在后续 nextTick 工具更新前触发。不是所有字体、图片或屏外页绘制已完成的通知。详见[渲染时序](./rendering-pipeline.md)。

用法：

```javascript
instance.eventBus.on('renderChange', () => void)
```

## spellcheckClick

功能：拼写检查错词点击事件

用法：

```javascript
instance.eventBus.on('spellcheckClick', (payload: {
  evt: MouseEvent
  range: ISpellcheckRange
}) => void)
```

## fontCoverageChange

字体覆盖或下载状态变化时发送当前 `FontCoverageReport` 快照；已解决项移除。
首次订阅后主动读取快照，避免依赖首次事件时序。内建页面提示无需订阅。

```typescript
import type { FontCoverageReport } from '@herberthe/canvas-editor'

const onCoverage = (report: FontCoverageReport) => console.log(report.issues)
instance.eventBus.on('fontCoverageChange', onCoverage)
// instance.eventBus.off('fontCoverageChange', onCoverage)
const current = instance.getFontCoverageReport()
```

[完整字体接口与覆盖边界](./font-and-esm-migration.md)。

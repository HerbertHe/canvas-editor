# 实验特性

优化机制和限制见[性能优化原理](performance-principles.md)，
基线与最新实测见 [Benchmark](benchmark.md)。

实验项在 `lab` 下逐项默认关闭。当前统一使用 HarfBuzz，开启开关不会切换引擎。

```typescript
const editor = await Editor.create(container, data, {
  lab: { performanceProfile: 'sync' }
})
```

## 输入性能分级配置

配置在构造时解析，不提供运行中切换 profile 的公共合同。显式开关覆盖 profile。
要回到对照配置，请销毁实例后用 `baseline` 重建，并去掉原先显式开启的开关。

| profile | 行为 | 启用建议 |
| --- | --- | --- |
| `baseline` | 默认值，保留现有同步路径，实验优化全部关闭 | 发布默认与排查对照 |
| `sync` | 路径/run 缓存、事务编辑/历史/覆盖、flow 范围接续/未变断行重放、行块位置/查询复用、脏页和绘制合并 | 在自身文档验证后按应用启用 |
| `worker` | `sync` 加上简单正文的异步文本内核 | 实验；复杂范围、IME、几何消费者同步刷新 |

三个 profile 都不自动开启 `workerTransfer` 或 `incrementalCompute`。
Worker/同步增量尚未在全部目标文档达到 8ms/32ms 预算，保持 opt-in。
显式设置 `lab: { performanceProfile: 'worker', layoutWorker: false }`
可以关闭异步内核，同时保留该档的同步优化。

普通正文单栏、分页模式、可序列化的简单页眉页脚和受支持编辑才可异步。
至多 2048 段、脏段批次至多 2048 UTF-16 单元；超限、复杂对象、浮动、表格、
IME、打印及 maxPageNo 等走同步内核。视觉删除、移动、点击和依赖几何的 API
会刷新当前几何。连续输入等待超过 100ms 后安排一次同步刷新，防止旧布局被持续
替代而无法提交；主线程忙碌或同步布局本身较慢时仍会超过 100ms，此值不是上屏保证。
Backspace/Delete 直接提交同步增量几何并合并绘制，避免下一次视觉删除立即作废异步布局。
镜像编辑有序批量确认；队列超限或故障后，在空闲时重同步，排空等待也会触发恢复。

## 诊断与回退

```typescript
const diagnostics = editor.getPerformanceDiagnostics()
console.log(diagnostics.worker.fallbackReasons)
console.log(diagnostics.worker.requests, diagnostics.worker.queuedBytes)
```

该 API 在 ready 前和 destroy 后也可读取，返回独立快照，不包含正文或字体二进制。
它提供生效配置、Worker readiness/pending/请求队列、累计计数、回退原因、路径/run/flow
缓存计数与观察页数量。`deadline` 表示提交等待保护，`size`/`scope`/`composition`
表示不支持的范围，`unavailable`/`error` 表示初始化、字体/版本或后台故障。
这些计数有助定位原因，不是性能达标证明；显式关闭依赖时可出现 `dependencies`。
`placements` 给出位置元素的计算/复用工作量；`worker.bufferedEdits` 与
`worker.counters.editBatches/batchedEdits/maxBufferedEdits` 区分缓冲事务和传输请求。
实现范围见[当前架构](architecture.md)，测量结果见 [Benchmark](benchmark.md)。

浏览器禁止或无法创建 Worker 时，排版保留同步回退；统计、目录、分组及序列化使用
相同纯函数在主线程处理其请求快照。相关计数见 `utilityWorkers`，返回值仍为 Promise。
此路径可能更慢。禁止 WebAssembly 或缺少所需字体时仍按原初始化/字体错误合同处理，
不会切换到浏览器文字排版。已销毁实例的编辑命令继续拒绝。
为保证异步出错后仍使用请求当时的数据，发送前保留私有克隆；未命中衍生缓存的
大型异步查询因此增加一次克隆成本。诊断可用于确认是否持续触发后台回退。

最新指标见 [Benchmark](benchmark.md)，剩余验收项及复现命令见[测试与验收](engineering-records.md)。

## incrementalCompute：原生段落增量复用

编辑会完整重排受影响段落，因为 BiDi 与上下文整形可能影响整段。
未变化段落可复用原生布局；缓存使用段内相对索引，返回时映射当前 source、glyph、
cluster、caret 及对象锚点。表格单元格有独立 scope，列表序号按当前文档重新生成。

仅开启 `incrementalCompute` 时，每轮仍扫描文档、计算容器流、分页、分栏、环绕、表格分片与位置；不复用旧行对象、
行恢复快照或部分页面坐标。单个超长段落仍需整段重排，不承诺 1–3 行收敛或数量级提速。

缓存键包括文字/样式、来源身份、字体 revision、间距、可用宽度及逐行 flow 约束。
样式、字体或约束变化会失效；字段修改、历史恢复、字体补充触发相应全量失效。
缓存关闭或未命中时仍进行完整 HarfBuzz 排版，不存在浏览器或旧引擎回退。
T23/T24 已完成；[最终验收](./native-release-acceptance.md)记录了布局一致性及实际性能成本，增量不一定更快。

内部二次开发应通过 `spliceElementList` / `deleteElementList` 记录脏区，
通过 `setElementProperty` / `deleteElementProperty` 修改字段，避免绕过失效追踪。
外部集成使用公开 command，不依赖内部 Draw 或快照结构。

段落缓存与 profile 相互独立，实际收益应按同环境、同文档复测。


## 中文输入法局部预览（实验）

```typescript
const editor = await Editor.create(container, data, {
  lab: { performanceProfile: 'sync', imePreview: true }
})
```

`imePreview` 默认 false，独立于 profile 和段落缓存。开启后按帧消费最新合成文本；
简单 LTR 正文单行、行高和基线不变时，使用 HarfBuzz 临时几何在原页面绘制预览，
选字结束才写入最终文本。`sync` / `worker` profile 还启用 `imeWindowPreview`：
长段落只重排编辑行及前后校验行，窗口最多三行、2048 个元素；断点、行高、
基线和邻行绘制/光标几何完全一致才接受预览，其余行沿用正式几何。
段落可跨页，但预编辑本身改变断行或分页时回退。
显式设置 `imeWindowPreview: false` 可单独关闭此能力；baseline 默认关闭。
表格采用下文的单元格缓存，仍同步更新正式模型。
暂不支持的换行/跨页变化、控件、复杂方向、
装饰等路径采用按帧的同步回退，不能据此宣称这些范围已局部布局。

长段窗口要求单一度量样式、LTR、安全的整词/字素边界；Arabic、BiDi、
字体/字号切换、两端对齐、浮动排除等保留完整布局。窗口建立仍需扫描段落，
最终提交也仍走正式布局，不能将连续预览的工作量当作整个编辑流程为常量成本。
`composition.previewWork` 的 `windowElements` / `laidOutLines` 记录实际重排范围，
`checkedLines` 记录校验行，`skippedLines` 才是本次没有参与临时布局的行数；
`reusedLines` 含重排后丢弃临时结果、继续沿用正式几何的校验行。

### 表格内合成与 Worker 预览

`imeTableLayout` 随 sync/worker profile 开启，baseline 关闭，需同时开启 `imePreview`。
未变的安全文本单元格复用规范布局；内容高度和表格依赖不变时沿用网格/行高。
高度变化仍重新解算表格行高、合并跨度和后续分页，但保留其他单元格内容缓存。
嵌套表格的父单元格仍递归检查其叶单元格；列宽、字体或全局样式变化使缓存失效。
缓存最多 512 项、估算 16 MiB；`imeTableLayout: false` 可独立回退。
超过容量时优先保留本轮及上轮的热条目，新候选无法入缓存就直接使用本次计算结果，
不连续淘汰接下来将用到的单元格。闲置一个完整布局周期后可接纳新文档。
`tables.entries` / `admissionSkips` / `evictions` 可用于检查容量行为。

`tables.computedCells` 统计子布局回调，`reusedCells` 统计跳过的回调；
`computedRows` / `reusedRows` 统计表格行高/网格的解算或复用。
`inputElements` 包含所有进入检查的单元格内容，不等于实际扫描次数或分配量；
位置、页装配、语义签名检查仍可能遍历全表。超高嵌套内容的既有分页/光标边界未被扩展。

`imeWorkerPreview` 在所有 profile 中**默认 false**。仅在明确需要实验时设置：

```typescript
lab: {
  performanceProfile: 'worker',
  imePreview: true,
  imeWorkerPreview: true
}
```

它只迁移原 Worker 镜像与局部预览共同支持的正文范围；表格、复杂对象等保留同步路径。
临时输入不进入 Worker 正式模型。客户端保留一个在途和一个最新等待布局，
回复同时验证会话、序号、模型/字体/约束及几何版本，校验通过才更新预览和候选锚点。
查询/导出、结束或取消仍同步落实最新输入，并取消尚未发出的旧预览。
50ms 调度后备不会被过期更新重置；失败/超限/超时会转为同步路径。
这不是硬实时上限，已经开始的 Worker 计算还要等待正常完成或客户端超时后排空。
`workerTransfer` 不由此自动开启，预览仍使用有界的结构化克隆。

`composition.previewWorker` 提供 submitted、committed、stale、fallbacks、deadlines 和 pending。
submitted 是客户端调用数，stale 含未发出即被合并的等待更新，不能当作实际传输统计。
当前实测 handler 变短，但几何就绪和部分下一帧指标变慢，且两档均未产生可改善的长任务；
**不满足默认启用条件，建议保留同步预览**。参见 [性能报告](benchmark.md)。

IME-14 提供 `npm run test:performance:ime:release`，把三浏览器正确性、三轮性能、
构建/包消费及真实输入法人工证据分开检查。源码或测试改变、预算未达成、证据缺失都会
保持 hold（退出码 2），不会自动开启 imePreview/imeWorkerPreview。
本轮没有人工记录，真实 macOS/Windows/移动端候选窗及可见刷新仍未验收。
复现和证据格式见 [IME-14](ime-performance-tasks.md)。

预编辑期间局部检查缺字，完整覆盖报告、搜索与控件高亮、标尺和工具更新延后到
结束或公开查询/导出屏障；延后期间暂停绘制旧搜索/控件高亮。辅助技术输入提示保留，
简单预览也能更新 live region，合成提示去重且不强制读取 DOM 布局。
字体加载改变版本时仍立即更新完整覆盖。

读取公开内容/几何 API 时先同步落实当前预编辑，后续合成转入保守路径；
执行公开修改命令先结束会话；四个 `executePageScale*` 缩放命令在实验开启时
保留活跃会话，先落实预编辑再更新缩放。取消恢复合成前内容，最终提交可撤销。
合成期间 textarea 和可见光标共用 caret 几何与高度，按帧合并定位、滚动和视口更新；
不重设原生输入内容/选区或反复聚焦，手动滚动不会立即拉回。
结束后恢复普通输入区样式，具体边界与复现见 [IME-08](ime-performance-tasks.md#ime-08-光标、候选窗锚点与滚动同步)。
无 DOM 焦点目标的原生候选窗 blur 不强制结束；候选窗和滚动的完整系统验收仍待完成。
仅用 rAF 和 geometry 代理指标不能证明实际屏幕刷新率。

Demo 对照可在 URL 增加 `?performance=sync&paragraphCache=off&imePreview=on`，
替换 profile 或开关值后重载。专项工具、支持范围和任务状态见
[IME 性能任务](ime-performance-tasks.md)。


合成闭环（IME-09）会在最终历史和会话状态落定后发布最终同步回调；
查询期间可读取最新预编辑，异步查询返回请求时快照。取消恢复原始内容、范围与
输入样式，最终修改是一条独立历史；安全的文本替换历史只保留原始片段与最终片段。
控件占位符不再改写活跃事务之前的历史。实现和回放见
[IME-09](ime-performance-tasks.md#ime-09-最终提交、取消、历史与查询闭环)。


`lab.incrementalCommit` 默认随 `sync` / `worker` profile 开启，baseline 默认关闭，
需要已有的 `incrementalEditing` / `incrementalFlow` 才能使用范围提交。
显式设置 `incrementalCommit: false` 保留此前逐段检查与逐元素位置提交，
不关闭原有的排版、整形、路径或查询缓存，可用于同代码对照与单独回退。

范围提交先定位脏段落，验证全部依赖后接续前缀/收敛后缀；文本及断行约束未变时，
后续段落只重新放置行。可用宽度变化、字体/样式变化或复杂对象等保持原有排版回退。
未变几何使用按行的惰性位置视图；大量几何变化时改用普通数组提交，并安全复用字形度量。
内部位置视图不会替代诊断用的普通数组快照；显式读取完整位置数据仍会支付全文成本。

新增诊断 `flow.checkpointChecks` / `batchChecked` / `reflowed` 区分几何检查、
目录元数据访问和缓存断行重放；`placements.visitedElements` 统计显式位置提交遍历，
`projectedElements` 统计按需生成的位置对象，`reusedMetrics` 统计新位置沿用的字形度量。
后者属于 `computedElements` 内部的复用，不应相加。`flow.reused`、查询块与字形缓存
已有的复用不计为本项新实现。页/行目录、对象分类及覆盖聚合等仍可能遍历全文，
不承诺常数时间编辑。实测与限制见 [IME-10 报告](benchmark.md)。

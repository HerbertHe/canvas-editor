# 实验特性

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
| `sync` | 路径/run 缓存、事务编辑/历史/覆盖、flow、前缀与未变行位置/查询复用、脏页和绘制合并 | 在自身文档验证后按应用启用 |
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

# 测试与验收

当前接入合同以[快速上手](start.md)、[字体与迁移](font-and-esm-migration.md)、[渲染管线](rendering-pipeline.md)和 API 为准。已完成任务的拆分清单与重复实施稿已合并清理；最新性能结论统一见 [Benchmark](benchmark.md)，初始、修复前和最终优化 JSON 保存在 `performance-baselines/`。

## 质量与功能回归

使用 Node ≥24.13.1。在仓库根目录执行：

```sh
rtk npm run lib
rtk npm run docs:build
rtk npm run test:package -- --serve
```

`lib` 包含 ESLint、TypeScript、Vitest 与库构建。最后一条启动包消费服务，需在另一个终端执行消费端浏览器检查。
测试使用固定的真实字体，单测默认禁止网络，并拒绝 Canvas 浏览器文字测量/绘制绕行。公开字体示例、离线下载、初始化失败、Unicode 删除、RTL、表格和历史均需回归。

浏览器 QA 需要独立安装的 Playwright 与匹配的浏览器；必要时设置 `PLAYWRIGHT_MODULE` 和 `BROWSER_EXECUTABLE`。它们不属于编辑器库的运行依赖。

```sh
rtk npm run dev -- --host 127.0.0.1 --port 3014 --strictPort
```

另一个终端执行，先完成正确性检查，再串行采集性能，避免构建和多个浏览器争用资源：

```sh
BASE_URL=http://127.0.0.1:3014 BROWSER=chromium RANDOM_EDITS=12 SEED=21 \
OUTPUT=cypress/results/acceptance/chromium-differential.json \
rtk node scripts/test-advanced-layout.mjs

BASE_URL=http://127.0.0.1:3014 BROWSER=chromium PROFILES=baseline,sync,worker \
rtk node scripts/test-native-browsers.mjs

BASE_URL=http://127.0.0.1:3014 rtk node scripts/test-performance-lifecycle.mjs

rtk node scripts/test-layout-package.mjs
```

差分、兼容和包消费端还需分别在 Firefox/WebKit 执行；不要为其他浏览器指定 Chrome 的可执行文件。包消费脚本使用前述 `--serve` 服务，验证原生 ESM、bundler、离线字体、实际编辑/导出以及允许/禁止 Worker 的 CSP。允许 WASM 是初始化前提；Worker 回退不代表任意 CSP 均可运行。

原有 Cypress 功能回归与公网字体独立烟测的命令，以及 2026-10-22 的迁移验收，保留在[原生回归](native-regression.md#复跑)和[迁移最终验收](native-release-acceptance.md)。这些历史结果不代替最新性能测试。

## 复现输入 Benchmark

以下标准命令固定中部、分页、历史开启、段落缓存关闭、DPR 1、预热 1、2Hz × 10 秒、三轮；每个配置 20 次操作：

```sh
MODE=interaction BASE_URL=http://127.0.0.1:3014 \
SAMPLES=paragraphs-100,paragraphs-1000,single-long-paragraph,large-table \
POSITIONS=middle ACTIONS=input,backspace,delete PAGE_MODES=paging \
HISTORY=on INCREMENTAL=off DPRS=1 WARMUP_KEYS=1 \
INPUT_RATE=2 DURATION_MS=10000 TRIALS=3 \
TRACKED_EDITS=on ADVANCED_LAYOUT=on VERIFY_HISTORY=off \
OUTPUT=cypress/results/benchmark/sync.json \
rtk npm run test:migration:performance
```

同一命令去掉 `TRACKED_EDITS`、`ADVANCED_LAYOUT` 得到当前代码的 baseline 对照；增加 `LAYOUT_WORKER=on` 测 Worker，增加 `WORKER_TRANSFER=on` 测 transfer。所有对照必须保持文档、编辑区容量、字体、浏览器、DPR、历史和预热一致。它们不能重建历史版本的初始基线；历史结果直接引用保留 JSON。

持续压力将 `INPUT_RATE=30`，百段长压力用 `DURATION_MS=30000`、`TRIALS=1`、`SAMPLES=paragraphs-100`；千段和 transfer 压力用 10 秒。压力输入/删除分别记录，报告必须保留所有发送操作直到排空及完整文本/选区和 Worker 最终状态；另加 `VERIFY_HISTORY=on` 验证 undo/redo。标准最终 JSON 的该选项为 off，历史闭环在定向与长压力测试中另验。

`INSTRUMENTATION=off` 用于独立的无方法插桩对照；`TRACE=1` 仅用于 Chromium 的截图/CPU 诊断，不混入主耗时样本。默认 `MODE=kernel` 的历史内核套件采用不同负载，不能与上述真实键盘套件直接比较。

结果保存原始事件、阶段与工作量、队列、P50/P95/P99/max、长任务和可用的 JS heap。报告的 geometry、offer→geometry、rAF 都是代理观察，不能代替硬件按键至屏幕呈现延迟。

## 发布门禁

```sh
rtk npm run test:performance:acceptance -- \
  docs/guide/performance-baselines/perf21-manifest-2026-10-23.json
```

门禁输出 `pass`、`hold` 或 `fail`。仅 `pass` 默认返回 0；`--report-only` 可为合法但未达标的 `hold` 输出报告，证据损坏、源码过期或操作遗漏仍非零。不得降低预算或删慢样本来通过门禁。

固定预算为 handler P95 ≤8ms、DOM→geometry P95 ≤32ms。当前结果仍为 **hold**：部分延迟超预算，真实系统 IME/长按、实际呈现和长期原生/WASM/GPU 内存尚需人工验收。默认仍为 `baseline`，`sync` 按应用验证后 opt-in，Worker 实验，transfer 暂缓。

保留的 manifest 引用最终性能数据；为清理临时产物，其 `automated` 当前为空。重跑时需生成并填入质量、构建、生命周期和三浏览器差分/兼容/包消费证据。条目使用 `{ "kind": "quality", "path": "..." }` 等格式，浏览器证据额外提供 `engine`；完整校验由 `scripts/performanceAcceptance.ts` 定义。源码哈希必须匹配，后续修改运行时代码需重新测量。不能根据历史摘要填写 pass。

临时日志、截图、trace 和中间数据输出到 Git 忽略的 `cypress/results/`，只将有效基线、最终数据和更新后的 Benchmark 纳入文档。

## 后续可选方向

优先减少超长段落整段排版和全局 flow/元数据遍历，再补系统输入与呈现验收。Tile 缓存、OffscreenCanvas 绘制 Worker 和 WebGL/WebGPU 字形绘制仍为候选；只有 CPU profile 显示绘制成为主要瓶颈时再实现，GPU API 不能直接消除 BiDi、整形与文档流成本。

尚有参考价值的专项设计保留：[RTL 设计](rtl-layout-design.md)、[RTL 后续事项](rtl-deferred-todo.md)、[SVG 评估](harfbuzz-svg-assessment.md)。SVG 页面与独立 SVG 导出目前不可用。

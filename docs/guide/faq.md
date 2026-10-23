# 常见问题

## 为什么安装包后没有完整工具栏？

包提供编辑器和公开 API，仓库 Demo 负责组装菜单和工具栏。先运行 `npm run dev` 查看 `src/main.ts` 的日常场景，再按业务选择需要的控件。不要导入内部 Draw 实现来替代公开 command。

## ready 之后为什么仍有缺字方框？

ready 等待运行时、显式字体和首次布局，不等待后台补字体。查看页面提示、`getFontCoverageReport()` 与 `fontCoverageChange`，确认缺字类别、所需样式和下载状态。Bunny 基本字体不是全 Unicode 字库；失败或无候选时仍需提供适合的字体文件。详细示例见[字体指南](./font-and-esm-migration.md)。

## 系统明明有这个字体，为什么不能显示？

HarfBuzz 需要可读取的字体字节。只设置 `font`、CSS 或系统字体不等于已经注册。使用构造选项 `fonts` 或 `register.fonts()`，检查每项结果并再次检查覆盖。粗体、斜体和地区字形需要对应真实 face。

## 离线部署为什么仍有网络请求？

`autoDownloadFonts: false` 关闭自动 Bunny 下载和下载缓存注册，不禁止宿主主动传入的字体 URL、图片、公式等资源。将所需文件随应用部署，检查显式 URL 和宿主逻辑。默认开关为 true，运行期关闭不会移除已经注册的字体。

## 如何处理初始化失败或组件快速卸载？

优先使用 `await Editor.create(...)` 并捕获异常，它会清理失败实例。同步构造需自行捕获 ready 拒绝并 destroy。异步创建期间卸载组件时使用取消标记，create 返回后立即销毁已经失效的实例。业务事件、工具栏和外部变量由宿主清理。

## 迁移后分页和行宽为什么不同？

排版使用实际字体 face、HarfBuzz 上下文整形及统一几何。浏览器系统字体回退、合成字重与旧测量方式不再决定文字宽度。固定相同字体、字重、宽度和配置重新验收；后台字体注册也会使分页变化。

## 增量模式一定更快吗？

不一定，默认关闭。脏段落完整重排，文档流、分页和位置仍计算；单长段落和缓存克隆可能更慢。参见[增量说明](./lab.md)及[最终验收数据](./native-release-acceptance.md)，不要仅凭开关名判断性能。

## 可以切换 SVG 或导出矢量 PDF 吗？

当前只能绘制 Canvas 页面，独立 SVG 导出暂缓。`renderer`、旧 `renderMode` 和 `textEngine` 不是可用开关。插入 SVG 图片或公式不代表启用了 SVG 页面引擎。打印走 Canvas 图片链路。

## 生产环境资源 404 怎么排查？

保留完整构建输出，在 HTTP(S) 环境检查 chunk、Worker、WASM 与字体请求的路径、CORS 和 CSP。不要只复制入口 JS，不能通过 `file://` 打开运行。文档站另需保证 `DOCS_BASE` 与 GitHub Pages 路径一致，见[部署指南](./docs-deployment.md)。

## 上游插件和问题应该去哪里反馈？

本 fork 的问题反馈到 [HerbertHe/canvas-editor](https://github.com/HerbertHe/canvas-editor/issues)，附浏览器、字体来源、开关、最小文档和复现步骤。提交诊断报告前检查其中的文档字符与位置信息。上游插件需单独验证兼容，不应将本 fork 的问题默认交给上游维护者。

最新输入性能优化使用独立的 `lab.performanceProfile`；配置与边界见[实验特性](lab.md)，实测前后对比见 [Benchmark](benchmark.md)。

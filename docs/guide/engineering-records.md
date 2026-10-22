# 验收与历史记录

日常接入以[快速上手](./start.md)、[当前架构](./architecture.md)、[渲染管线](./rendering-pipeline.md)和 API 参考为准。本页保留设计与分阶段验收的出处；这些记录中可能描述当时尚未完成的迁移状态，不能直接当成当前公开接口。

## 当前结论

T1–T24 的 legacy 移除与 HarfBuzz-only 迁移已完成；T23/T24 于 2026-10-22 完成最终回归。Canvas-only 与 ESM-only 是当前发布约束。原生增量布局仍有明显成本，不承诺提速，剩余性能问题不会因测试通过自动关闭。

- [最终验收](./native-release-acceptance.md)：环境、用例、包消费、跨浏览器、内存和性能结果。
- [原生回归说明](./native-regression.md)：测试入口与定向覆盖。
- [迁移任务表](./legacy-removal-tasks.md)、[最初移除方案](./legacy-removal-plan.md)：阶段范围和验收索引。
- [原始基线](./legacy-removal-baseline.md)：对照数据，保留历史，不代表当前功能。

## 排版与字体实施记录

- [HarfBuzz 整形](./harfbuzz-shaping.md)、[字形绘制](./harfbuzz-glyph-rendering.md)、[布局协议](./layout-protocol.md)、[几何](./layout-geometry.md)。
- [字体解析](./font-resolver.md)、[覆盖诊断](./font-coverage.md)、[字体下载](./font-download.md)、[Bunny 适配](./bunny-font-provider.md)、[ready](./editor-ready.md)。
- [原生段落](./native-paragraph-layout.md)、[对象](./native-object-layout.md)、[表格](./native-table-layout.md)、[文档流](./native-document-flow.md)。
- [页眉页脚](./native-chrome-layout.md)、[辅助文字](./native-auxiliary-layout.md)、[交互几何](./native-interaction-geometry.md)、[模型分离](./native-model-separation.md)、[原生增量](./native-incremental-layout.md)、[唯一引擎](./native-only-engine.md)。
- [公开 API 迁移](./public-api-migration.md)、[RTL 设计](./rtl-layout-design.md)、[RTL 后续事项](./rtl-deferred-todo.md)、[主干功能整合记录](./main-integration-2026-10-16.md)。

## SVG 暂缓方案

[HarfBuzz 到 SVG 的评估](./harfbuzz-svg-assessment.md)是未来方案，不是当前实现。SVG-01～12 尚未启动；用户当前应使用 Canvas。不要根据历史图或设计稿添加不存在的 renderer 配置。

## 维护文档

中英文首页和主指南保持同步；中文验收原始数据作为工程证据保留，英文页面会明确链接过去。修改实现时同步更新对应主指南；历史测量、版本和提交基线不应为了匹配现状而重写。新图表使用 Mermaid，构建时检查语法，站点客户端渲染。发布方法见[文档部署](./docs-deployment.md)。

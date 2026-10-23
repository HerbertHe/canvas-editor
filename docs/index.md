---
layout: home
title: Canvas Editor
titleTemplate: HarfBuzz typography and Canvas pages
hero:
  name: '@herberthe/canvas-editor'
  text: HarfBuzz 排版 · Canvas 页面
  tagline: 'Herbert He · Independent fork · 0.1.0 · ESM only'
  actions:
    - theme: brand
      text: 在线体验
      link: /guide/playground
    - theme: brand
      text: 快速上手
      link: /guide/start
    - theme: alt
      text: 查看渲染管线
      link: /guide/rendering-pipeline
features:
  - title: 从第一个文档开始
    details: 异步创建编辑器，管理字体，保存日常场景文档。
    link: /guide/start
  - title: 看懂渲染管线
    details: 通过流程图和时序图理解整形、断行、分页与 Canvas 绘制。
    link: /guide/rendering-pipeline
  - title: 了解项目关系
    details: 独立维护的 fork，按固定上游基线对比，保留 MIT 原始署名。
    link: /guide/fork-and-differences
  - title: 字体与离线接入
    details: 默认 Bunny 基本字体下载、手动注册和缺字诊断。
    link: /guide/font-and-esm-migration
  - title: 能力与边界
    details: 仅 Canvas 页面、仅 ESM 分发，公开增量排版的实际限制。
    link: /guide/features
  - title: 性能基准与收益
    details: 查看优化前后耗时、三轮波动、持续输入与删除结果及复现方法。
    link: /guide/benchmark
---

当前默认且仅支持 Canvas 文档页面，SVG 页面绘制与独立 SVG 导出暂缓。本项目基于 [Hufe921/canvas-editor](https://github.com/Hufe921/canvas-editor) 独立维护，并非上游官方发行。

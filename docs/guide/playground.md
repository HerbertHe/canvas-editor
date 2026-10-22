---
layout: page
sidebar: false
title: 在线体验
---

<div class="playground-page">

# 编辑器在线体验

直接在下方编辑周末生活计划：填写控件、修改表格、尝试文字格式、搜索及撤销重做。这里使用与仓库一致的日常多语种 Demo，包含完整工具栏。

点击 **独立窗口打开** 可获得更大的编辑空间，手机上也建议使用独立窗口。**重置示例** 会重新加载初始文档并丢弃当前文档修改。体验页不会自动将文档保存到服务器，重置或离开前请自行保留需要的内容。

<EditorPlayground />

## 字体与接入说明

本示例使用 HarfBuzz 排版和 Canvas 页面绘制，默认开启 Bunny 基本字体下载，基础中文、拉丁及部分文种字体随站点分发，先加载再显示文档。补字体期间可能短暂出现方框；网络失败或未覆盖字符会保留缺字提示。ready 不等待后台下载。开始集成时请阅读[快速上手](./start.md)和[字体、离线配置](./font-and-esm-migration.md)。

</div>

<style scoped>
.playground-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 32px 24px;
}
.playground-page h1 { font-size: 28px; font-weight: 700; margin-bottom: 16px; }
.playground-page h2 { font-size: 22px; font-weight: 600; margin: 32px 0 16px; }
.playground-page p { line-height: 1.8; margin: 16px 0; }
.playground-page a { color: var(--vp-c-brand-1); text-decoration: underline; }
</style>

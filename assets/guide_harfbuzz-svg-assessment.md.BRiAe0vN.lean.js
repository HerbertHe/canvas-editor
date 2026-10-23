import{_ as d,C as r,o,c as l,ag as e,E as n}from"./chunks/framework.Drp2S_UI.js";const f=JSON.parse('{"title":"HarfBuzz 原生管线完整接入 SVG：评估与实施方案","description":"","frontmatter":{},"headers":[],"relativePath":"guide/harfbuzz-svg-assessment.md","filePath":"guide/harfbuzz-svg-assessment.md","lastUpdated":1792752159000}'),i={name:"guide/harfbuzz-svg-assessment.md"};function c(s,t,p,h,g,S){const a=r("MermaidDiagram");return o(),l("div",null,[t[0]||(t[0]=e("",14)),n(a,{code:`flowchart TD
  A[文档模型 / 控件状态 / 字体配置] --> B[字体解析与覆盖检测]
  B --> C[HarfBuzz 整形与原生布局]
  C --> D[页面绘制场景 PageScene]
  D --> E[CanvasRenderer]
  D --> F[SvgRenderer]
  C --> G[InteractionGeometry]
  H[PageSurface 事件归一化] --> G
  G --> I[选区 / 光标 / IME / 命令]
  I --> A
  D --> J[SvgExporter / PrintDocument]
`}),t[1]||(t[1]=e("",78))])}const G=d(i,[["render",c]]);export{f as __pageData,G as default};

import{_ as a,C as o,o as d,c,ag as t,E as n}from"./chunks/framework.Drp2S_UI.js";const _=JSON.parse('{"title":"架构与模块职责","description":"","frontmatter":{},"headers":[],"relativePath":"guide/architecture.md","filePath":"guide/architecture.md","lastUpdated":1792752159000}'),i={name:"guide/architecture.md"};function s(l,e,h,u,p,m){const r=o("MermaidDiagram");return d(),c("div",null,[e[0]||(e[0]=t("",3)),n(r,{code:`flowchart TB
  Host[宿主应用：工具栏、存储、业务表单] --> API[Editor / Command / Register / EventBus]
  API --> Lifecycle[EditorLifecycle：异步初始化与状态保护]
  API --> Model[文档元素 / Range / History]
  Model --> Draw[Draw：渲染调度、脏区与页面管理]
  Draw --> HostLayout[LayoutHostAdapter / 原生容器布局]
  HostLayout --> Text[TextLayoutService / TextLayoutEngine]
  Text --> Bidi[BiDi、脚本与样式分段]
  Bidi --> HB[HarfBuzzTextShaper]
  HB --> Fonts[FontManager / HarfBuzzRuntime]
  HostLayout --> Geometry[TextLine / Cluster / Caret / 对象与页面几何]
  Geometry --> Paint[GlyphRenderer / 对象绘制 / Canvas]
  Geometry --> Interaction[命中测试、选区、光标与键盘导航]
  Fonts --> Coverage[覆盖诊断 / FontDownloadManager]
  Coverage --> Draw
`}),e[1]||(e[1]=t("",17))])}const g=a(i,[["render",s]]);export{_ as __pageData,g as default};

import{_ as e,C as n,o as a,c as l,ag as o,E as i}from"./chunks/framework.Drp2S_UI.js";const f=JSON.parse('{"title":"HarfBuzz-only 迁移：24 个主任务与 2 个字体下载子任务","description":"","frontmatter":{},"headers":[],"relativePath":"guide/legacy-removal-tasks.md","filePath":"guide/legacy-removal-tasks.md","lastUpdated":1792653875000}'),s={name:"guide/legacy-removal-tasks.md"};function d(g,t,p,c,h,u){const r=n("MermaidDiagram");return a(),l("div",null,[t[0]||(t[0]=o("",86)),i(r,{code:`flowchart LR
  A[T01 基线] --> B[T02 ESM / T03 协议]
  B --> C[T04-T06 运行时与字体诊断]
  C --> X[T06A-T06B Bunny 下载与格式适配]
  X --> Y[T07 下载状态与手动提示]
  Y --> D[T08-T09 整形与绘制]
  B --> E[T10 拆出有效布局]
  D --> F[T11-T16 新布局与测量]
  E --> F
  F --> G[T17-T19 几何与增量迁移]
  G --> H[T20-T21 删除与接口迁移]
  H --> I[T22-T24 验收与交付]
`}),t[1]||(t[1]=o("",4))])}const m=e(s,[["render",d]]);export{f as __pageData,m as default};

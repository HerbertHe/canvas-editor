import{_ as o,C as a,o as i,c as l,ag as t,E as r}from"./chunks/framework.Drp2S_UI.js";const g=JSON.parse('{"title":"彻底移除 legacy、统一 HarfBuzz 排版的实施方案","description":"","frontmatter":{},"headers":[],"relativePath":"guide/legacy-removal-plan.md","filePath":"guide/legacy-removal-plan.md","lastUpdated":1792653875000}'),c={name:"guide/legacy-removal-plan.md"};function n(s,e,u,p,h,m){const d=a("MermaidDiagram");return i(),l("div",null,[e[0]||(e[0]=t("",14)),r(d,{code:`flowchart TD
  A[文档模型 / 命令 / 控件状态] --> B[DocumentNormalizer]
  B --> C[DocumentLayoutEngine]
  C --> D[ParagraphLayoutEngine]
  D --> E[FontResolver + BiDi + HarfBuzz]
  C --> F[TableLayout / BlockLayout / InlineObjectLayout]
  F --> D
  E --> G[统一布局树]
  F --> G
  G --> H[分页 / 分栏 / 环绕布局]
  H --> I[GlyphRenderer + ObjectRenderer]
  H --> J[命中 / 光标 / 选区 / 搜索 / 批注]
`}),e[1]||(e[1]=t("",70))])}const b=o(c,[["render",n]]);export{g as __pageData,b as default};

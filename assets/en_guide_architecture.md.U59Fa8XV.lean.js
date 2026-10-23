import{_ as r,C as n,o,c as i,ag as t,E as s}from"./chunks/framework.Drp2S_UI.js";const y=JSON.parse('{"title":"Architecture and responsibilities","description":"","frontmatter":{},"headers":[],"relativePath":"en/guide/architecture.md","filePath":"en/guide/architecture.md","lastUpdated":1792752159000}'),d={name:"en/guide/architecture.md"};function c(l,e,p,u,h,m){const a=n("MermaidDiagram");return o(),i("div",null,[e[0]||(e[0]=t("",3)),s(a,{code:`flowchart TB
  App[Application: toolbar, storage, forms] --> API[Editor / Command / Register / EventBus]
  API --> Lifecycle[EditorLifecycle: readiness and state guards]
  API --> Model[Document elements / Range / History]
  Model --> Draw[Draw: dirty ranges and page scheduling]
  Draw --> Host[LayoutHostAdapter / container layout]
  Host --> Text[TextLayoutService / TextLayoutEngine]
  Text --> Bidi[BiDi, script and style runs]
  Bidi --> HB[HarfBuzzTextShaper]
  HB --> Fonts[FontManager / HarfBuzzRuntime]
  Host --> Geometry[TextLine / Cluster / Caret / object geometry]
  Geometry --> Paint[GlyphRenderer / object painters / Canvas]
  Geometry --> Input[Hit testing, selection and navigation]
  Fonts --> Coverage[Coverage diagnostics / FontDownloadManager]
  Coverage --> Draw
`}),e[1]||(e[1]=t("",17))])}const b=r(d,[["render",c]]);export{y as __pageData,b as default};

import{_ as n,C as i,o as r,c as o,ag as t,E as s}from"./chunks/framework.Drp2S_UI.js";const f=JSON.parse('{"title":"Performance optimization principles","description":"","frontmatter":{},"headers":[],"relativePath":"en/guide/performance-principles.md","filePath":"en/guide/performance-principles.md","lastUpdated":1794213193000}'),d={name:"en/guide/performance-principles.md"};function c(l,e,p,h,m,u){const a=i("MermaidDiagram");return r(),o("div",null,[e[0]||(e[0]=t("",13)),s(a,{code:`flowchart TD
  Input[Latest composing input] --> Pending[Replace pending value and sequence]
  Pending --> Frame[rAF consumer]
  Pending --> Timer[50ms scheduling fallback]
  Frame --> Eligible{Eligible for local preview}
  Timer --> Eligible
  Eligible -->|yes| Preview[Temporary HarfBuzz row or window]
  Preview --> Valid{Surrounding breaks and metrics converge}
  Valid -->|yes| Paint[Replace target row and paint page]
  Valid -->|no| Full[Authoritative synchronous layout]
  Eligible -->|no| Full
  Paint --> Anchor[Update caret and native input anchor]
  Full --> Anchor
  End[End or public query command] --> Barrier[Materialize latest state and invalidate old work]
  Barrier --> Commit[Commit or restore cancellation]
`}),e[1]||(e[1]=t("",23))])}const b=n(d,[["render",c]]);export{f as __pageData,b as default};

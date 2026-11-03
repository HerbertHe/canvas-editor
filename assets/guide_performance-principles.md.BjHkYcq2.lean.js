import{_ as o,C as r,o as d,c as i,ag as a,E as n}from"./chunks/framework.Drp2S_UI.js";const b=JSON.parse('{"title":"性能优化原理","description":"","frontmatter":{},"headers":[],"relativePath":"guide/performance-principles.md","filePath":"guide/performance-principles.md","lastUpdated":1793689268000}'),c={name:"guide/performance-principles.md"};function l(p,e,s,h,m,u){const t=r("MermaidDiagram");return d(),i("div",null,[e[0]||(e[0]=a("",13)),n(t,{code:`flowchart TD
  Input[收到最新 composing input] --> Pending[替换待消费值并递增序号]
  Pending --> Frame[rAF 消费最新值]
  Pending --> Timer[50ms 调度后备]
  Frame --> Eligible{满足局部预览约束}
  Timer --> Eligible
  Eligible -->|是| Preview[临时 HarfBuzz 行或窗口布局]
  Preview --> Valid{行高与周边断行收敛}
  Valid -->|是| Paint[替换目标行并重绘所在页]
  Valid -->|否| Full[同步权威布局]
  Eligible -->|否| Full
  Paint --> Anchor[更新光标与原生输入锚点]
  Full --> Anchor
  End[结束或公开查询命令] --> Barrier[落实最新预编辑并失效旧请求]
  Barrier --> Commit[正式提交或取消恢复]
`}),e[1]||(e[1]=a("",27))])}const f=o(c,[["render",l]]);export{b as __pageData,f as default};

import{_ as a,C as e,o as n,c as d,ag as s,E as r}from"./chunks/framework.Drp2S_UI.js";const y=JSON.parse('{"title":"实例、生命周期与字体 API","description":"","frontmatter":{},"headers":[],"relativePath":"guide/api-instance.md","filePath":"guide/api-instance.md","lastUpdated":1792752159000}'),o={name:"guide/api-instance.md"};function h(l,i,p,k,c,g){const t=e("MermaidDiagram");return n(),d("div",null,[i[0]||(i[0]=s("",6)),r(t,{code:`stateDiagram-v2
  [*] --> initializing
  initializing --> ready: 初始化和首次布局成功
  initializing --> failed: 初始化失败
  initializing --> destroyed: 提前销毁
  ready --> destroyed: 销毁
  failed --> destroyed: 清理
  destroyed --> [*]
`}),i[1]||(i[1]=s("",8))])}const F=a(o,[["render",h]]);export{y as __pageData,F as default};

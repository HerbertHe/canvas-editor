import{_ as e,C as a,o as n,c as o,ag as i,E as r}from"./chunks/framework.Drp2S_UI.js";const y=JSON.parse('{"title":"Editor lifecycle and font APIs","description":"","frontmatter":{},"headers":[],"relativePath":"en/guide/api-instance.md","filePath":"en/guide/api-instance.md","lastUpdated":1792752159000}'),d={name:"en/guide/api-instance.md"};function l(h,s,p,c,k,g){const t=a("MermaidDiagram");return n(),o("div",null,[s[0]||(s[0]=i("",5)),r(t,{code:`stateDiagram-v2
  [*] --> initializing
  initializing --> ready: Runtime and first layout succeed
  initializing --> failed: Initialization fails
  initializing --> destroyed: Early destruction
  ready --> destroyed: Destroy
  failed --> destroyed: Cleanup
  destroyed --> [*]
`}),s[1]||(s[1]=i("",8))])}const u=e(d,[["render",l]]);export{y as __pageData,u as default};

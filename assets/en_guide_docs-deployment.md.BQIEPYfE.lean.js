import{_ as a,C as i,o as n,c as s,ag as t,E as d}from"./chunks/framework.Drp2S_UI.js";const b=JSON.parse('{"title":"Deploy documentation to GitHub Pages","description":"","frontmatter":{},"headers":[],"relativePath":"en/guide/docs-deployment.md","filePath":"en/guide/docs-deployment.md","lastUpdated":1792653875000}'),r={name:"en/guide/docs-deployment.md"};function l(c,e,h,p,u,g){const o=i("MermaidDiagram");return n(),s("div",null,[e[0]||(e[0]=t("",7)),d(o,{code:`flowchart TD
  PR[Documentation-related PR targeting main] --> Build[Frozen install, Mermaid validation, VitePress build]
  Main[Push main, including merges] --> Build
  Manual[Manual run on main] --> Build
  Build --> Gate{Main and not a PR?}
  Gate -->|No| Check[Build verification only]
  Gate -->|Yes| Artifact[Upload github-pages artifact]
  Artifact --> Branch[Extract the same artifact and update gh-pages]
  Branch --> Deploy[Official deploy-pages publishes the same artifact]
  Deploy --> Site[github-pages environment / documentation site]
`}),e[1]||(e[1]=t("",14))])}const f=a(r,[["render",l]]);export{b as __pageData,f as default};

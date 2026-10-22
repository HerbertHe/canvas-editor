import{_ as a,C as d,o as i,c as s,ag as t,E as n}from"./chunks/framework.Drp2S_UI.js";const b=JSON.parse('{"title":"GitHub Pages 文档部署","description":"","frontmatter":{},"headers":[],"relativePath":"guide/docs-deployment.md","filePath":"guide/docs-deployment.md","lastUpdated":1792653875000}'),c={name:"guide/docs-deployment.md"};function r(l,e,p,h,g,u){const o=d("MermaidDiagram");return i(),s("div",null,[e[0]||(e[0]=t("",7)),n(o,{code:`flowchart TD
  PR[针对 main 的文档相关 PR] --> Build[冻结安装、Mermaid 校验、VitePress 构建]
  Main[push main：包含合并提交] --> Build
  Manual[手动运行：选择 main] --> Build
  Build --> Gate{main 且不是 PR}
  Gate -->|否| Check[仅验证构建，不发布]
  Gate -->|是| Artifact[上传 github-pages artifact]
  Artifact --> Branch[解包同一产物并更新 gh-pages]
  Branch --> Deploy[官方 deploy-pages 发布同一 artifact]
  Deploy --> Site[github-pages environment / 文档站]
`}),e[1]||(e[1]=t("",15))])}const k=a(c,[["render",r]]);export{b as __pageData,k as default};

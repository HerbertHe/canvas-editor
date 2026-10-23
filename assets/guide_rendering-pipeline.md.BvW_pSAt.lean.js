import{_ as i,C as o,o as l,c as s,j as e,a as t,E as r,ag as d}from"./chunks/framework.Drp2S_UI.js";const b=JSON.parse('{"title":"渲染管线与时序","description":"","frontmatter":{},"headers":[],"relativePath":"guide/rendering-pipeline.md","filePath":"guide/rendering-pipeline.md","lastUpdated":1792752159000}'),p={name:"guide/rendering-pipeline.md"};function c(h,a,u,m,g,f){const n=o("MermaidDiagram");return l(),s("div",null,[a[0]||(a[0]=e("h1",{id:"渲染管线与时序",tabindex:"-1"},[t("渲染管线与时序 "),e("a",{class:"header-anchor",href:"#渲染管线与时序","aria-label":'Permalink to "渲染管线与时序"'},"​")],-1)),a[1]||(a[1]=e("p",null,"本文按当前源码解释从 JSON 到 Canvas，以及编辑、补字体、交互和导出的过程。所有文字走同一套 HarfBuzz 排版与字形轮廓绘制。图中的“原生布局”指本项目的 TextLine/cluster/caret 模型，不是浏览器 DOM 排版，也不是操作系统原生组件。",-1)),a[2]||(a[2]=e("h2",{id:"_1-初始化-ready-究竟等待什么",tabindex:"-1"},[t("1. 初始化：ready 究竟等待什么 "),e("a",{class:"header-anchor",href:"#_1-初始化-ready-究竟等待什么","aria-label":'Permalink to "1. 初始化：ready 究竟等待什么"'},"​")],-1)),r(n,{code:`sequenceDiagram
  participant App as 宿主应用
  participant Editor as Editor / Lifecycle
  participant Adapter as LayoutHostAdapter
  participant Font as FontManager / HarfBuzzRuntime
  participant Draw as Draw
  App->>Editor: await Editor.create(container, data, options)
  Editor->>Editor: 合并配置、克隆和标准化文档、组装模块
  Editor->>Adapter: ensureReady()
  Adapter->>Font: 初始化 HarfBuzz WASM、加载显式 fonts
  Font-->>Adapter: 字体与运行时就绪
  Adapter->>Adapter: 创建 shaper、engine 和 service
  Adapter-->>Editor: 排版服务就绪
  Editor->>Draw: 首次 render（不设置光标）
  Draw->>Draw: 布局、分页、位置与绘制调度
  Draw-->>Editor: 首次布局完成
  Editor->>Editor: state = ready
  Editor-->>App: 返回可用实例
  Note over Draw,Font: 覆盖扫描和自动补字体在后台继续，不属于 ready 屏障
`}),a[3]||(a[3]=e("p",null,[e("code",null,"Editor.create()"),t(" 是推荐入口。初始化期间修改/几何命令不排队，调用会失败；少数只读查询和显式异步测高有专门规则，见"),e("a",{href:"./font-and-esm-migration.html"},"字体与初始化迁移"),t("。同步构造时必须等待 "),e("code",null,"editor.ready"),t("。")],-1)),a[4]||(a[4]=e("p",null,[t("WASM、显式字体初始化或首次布局错误使 ready 拒绝，"),e("code",null,"initializationError"),t(" 保留原因，create 会清理失败实例。缺字本身不会阻止 ready。首次 render 完成也不保证后台字体、图片或所有屏外页面都已绘制完毕：分页模式可以延迟绘制屏外页。")],-1)),a[5]||(a[5]=e("h2",{id:"_2-从文档到页面的主流程",tabindex:"-1"},[t("2. 从文档到页面的主流程 "),e("a",{class:"header-anchor",href:"#_2-从文档到页面的主流程","aria-label":'Permalink to "2. 从文档到页面的主流程"'},"​")],-1)),r(n,{code:`flowchart TD
  Input[编辑命令 / 首次文档 / 字体或配置变化] --> Dirty[标准化数据与记录脏区]
  Dirty --> Compute{本轮是否需要重新计算布局}
  Compute -->|是| Frame[页宽、分栏、页眉页脚等容器约束]
  Frame --> Host[原生文档流：段落、表格和对象宿主]
  Host --> Paragraph[ElementBridge 提取段落与样式 span]
  Paragraph --> Runs[BiDi 分析、脚本与样式分段、实际字体选择]
  Runs --> Shape[HarfBuzz 上下文整形]
  Shape --> Break[候选断行与行边界重新整形]
  Break --> Stable{断行是否稳定}
  Stable -->|否| Break
  Stable -->|是| Lines[视觉顺序、对齐、基线、cluster 和 caret]
  Lines --> Flow[容器文档流与表格跨页分片]
  Flow --> Pages[分页与 Position 位置重建]
  Pages --> Overlay[搜索、区域、控件高亮等几何更新]
  Overlay --> Schedule[创建或调整页面 Canvas]
  Compute -->|否：内部仅重绘| Schedule
  Schedule --> Lazy{分页且允许懒绘制}
  Lazy -->|是| Observer[IntersectionObserver 调度可见页面]
  Lazy -->|否| Paint[立即绘制页面]
  Observer --> Paint
  Paint --> Finish[光标、历史提交条件、事件与工具层更新]
`}),a[6]||(a[6]=d("",12)),r(n,{code:`flowchart TD
  A[清空与背景] --> B[区域、分栏线、底层水印、页边距]
  B --> C[底层浮图与控件高亮]
  C --> D[正文：字形、装饰、内联对象]
  D --> E[分页模式的页眉、页码、页脚]
  E --> F[上层与环绕浮图]
  F --> G[搜索、拼写、占位、行号、页边框]
  G --> H[徽标、涂鸦、顶层水印]
`}),a[7]||(a[7]=e("p",null,"打印模式会省略编辑用的部分区域提示、搜索和高亮等装饰。工具栏、输入代理和外部浮层属于 DOM 层，不能由这张页面叠放图推导其层级。",-1)),a[8]||(a[8]=e("h2",{id:"_5-一次编辑的时序",tabindex:"-1"},[t("5. 一次编辑的时序 "),e("a",{class:"header-anchor",href:"#_5-一次编辑的时序","aria-label":'Permalink to "5. 一次编辑的时序"'},"​")],-1)),r(n,{code:`sequenceDiagram
  participant User as 用户 / 宿主
  participant Cmd as Command / 输入事件
  participant Model as 文档 / 脏区
  participant Layout as Draw / 布局宿主
  participant Canvas as Canvas 页面
  participant UI as 位置 / 事件 / 工具层
  User->>Cmd: 输入、修改格式或调用命令
  Cmd->>Model: 修改内容、维护选区并记录脏区
  Model->>Layout: render()
  Layout->>Layout: 重排脏段落或全量布局，重建流与分页
  Layout->>UI: 重建 Position、搜索和控件几何
  Layout->>Canvas: 调度绘制；屏外页可延迟
  Layout->>UI: 更新光标，按条件提交历史
  Layout->>UI: renderChange（仅计算布局的轮次）
  Layout->>UI: nextTick 更新范围样式、工具与页面统计
`}),a[9]||(a[9]=e("p",null,[t("初次 "),e("code",null,"renderChange"),t(" 会延后到 ready 后；普通计算轮次的 renderChange 在后续 nextTick 工具层更新前触发。因此事件不是“所有异步资源和屏外页已完成”的通知。交互命中、选区矩形、箭头移动和删除使用同一份原生行/cluster/caret 几何，避免画面位置与鼠标位置各用一套文字度量。")],-1)),a[10]||(a[10]=e("h2",{id:"_6-缺字与自动下载的闭环",tabindex:"-1"},[t("6. 缺字与自动下载的闭环 "),e("a",{class:"header-anchor",href:"#_6-缺字与自动下载的闭环","aria-label":'Permalink to "6. 缺字与自动下载的闭环"'},"​")],-1)),r(n,{code:`sequenceDiagram
  participant Coverage as 覆盖扫描 / 提示
  participant Manager as FontDownloadManager
  participant Bunny as Bunny Fonts / 缓存
  participant Fonts as FontManager
  participant Draw as 布局与绘制
  Draw->>Coverage: 当前文字、样式、来源和字体版本
  Coverage->>Coverage: 生成缺字报告，显示页面和控制台提示
  alt autoDownloadFonts 为 true 且存在候选
    Coverage->>Manager: 按脚本和真实样式调度
    Manager->>Bunny: 获取 CSS 元数据和匹配的字体子集
    Bunny-->>Manager: 字体二进制（或缓存命中）
    Manager->>Fonts: 解码并注册实际字体 face
    Fonts-->>Draw: 字体 revision 变化，失效缓存
    Draw->>Draw: 全量重排并重绘
    Draw->>Coverage: 重新扫描并更新报告
  else 关闭、无候选或下载失败
    Coverage->>Coverage: 保留原文、占位与缺字提醒
  end
`}),a[11]||(a[11]=d("",12))])}const C=i(p,[["render",c]]);export{b as __pageData,C as default};

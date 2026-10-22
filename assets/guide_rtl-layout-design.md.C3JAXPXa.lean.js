import{_ as o,C as r,o as i,c as n,ag as t,E as d}from"./chunks/framework.Drp2S_UI.js";const f=JSON.parse('{"title":"RTL 排版与渲染引擎设计","description":"","frontmatter":{},"headers":[],"relativePath":"guide/rtl-layout-design.md","filePath":"guide/rtl-layout-design.md","lastUpdated":1792653875000}'),l={name:"guide/rtl-layout-design.md"};function s(c,e,h,p,u,g){const a=r("MermaidDiagram");return i(),n("div",null,[e[0]||(e[0]=t("",8)),d(a,{code:`flowchart LR
  flatList["IElement flat list"] --> computeRow["Draw.computeRowList"]
  computeRow --> rows["IRow[]"]
  rows --> pos["Position.computePageRowPosition"]
  pos --> posList["IElementPosition[]"]
  posList --> textDraw["TextParticle.fillText"]
  posList --> cursor["Cursor.drawCursor"]
  posList --> rangeDraw["Range fillRect"]
`}),e[1]||(e[1]=t("",17)),d(a,{code:`flowchart TB
  subgraph existing [现有宿主少改]
    Editor
    Command
    Draw
    Position
    Cursor
    ParticlesNonText["Image/Table/LaTeX"]
  end

  subgraph adapter [薄适配层]
    ElementBridge
    LayoutHostAdapter
    HitTestAdapter
    DecorMerge["mergeVisualRects"]
  end

  subgraph engine [text-engine 零依赖 Draw]
    TextLayoutEngine
    BidiResolver
    HarfBuzzShaper
    FontManager
    GlyphRenderer
    LayoutCache
  end

  Draw --> LayoutHostAdapter
  LayoutHostAdapter --> ElementBridge
  LayoutHostAdapter --> TextLayoutEngine
  TextLayoutEngine --> BidiResolver
  TextLayoutEngine --> HarfBuzzShaper
  TextLayoutEngine --> FontManager
  Draw --> GlyphRenderer
  Position --> HitTestAdapter
  HitTestAdapter --> TextLayoutEngine
  Draw --> DecorMerge
  ParticlesNonText --> Draw
`}),e[2]||(e[2]=t("",8)),d(a,{code:`flowchart TB
  spans["TextSpan[]"] --> resolveDir["resolveDirection"]
  resolveDir --> bidi["BidiResolver"]
  bidi --> styleRuns["StyleRunSplitter"]
  styleRuns --> shape["HarfBuzzTextShaper"]
  shape --> lineBreak["LineBreaker"]
  lineBreak --> align["Alignment"]
  align --> result["LayoutResult"]
`}),e[3]||(e[3]=t("",38)),d(a,{code:`flowchart LR
  P0["P0 文档"] --> P1["P1 模型与命令"]
  P1 --> P2["P2 text-engine + HB"]
  P2 --> P3["P3 RTL 光标删除装饰"]
  P3 --> P4["P4 混排对齐 surround"]
  P4 --> P5["P5 表格页眉"]
  P4 --> P6["P6 性能"]
  P4 --> P7["P7 增量历史"]
`}),e[4]||(e[4]=t("",3))])}const m=o(l,[["render",s]]);export{f as __pageData,m as default};

import{_ as o,C as s,o as d,c as l,ag as r,E as i,j as a,a as n}from"./chunks/framework.Drp2S_UI.js";const b=JSON.parse('{"title":"Rendering pipeline and timing","description":"","frontmatter":{},"headers":[],"relativePath":"en/guide/rendering-pipeline.md","filePath":"en/guide/rendering-pipeline.md","lastUpdated":1792752159000}'),c={name:"en/guide/rendering-pipeline.md"};function p(u,e,g,h,m,y){const t=s("MermaidDiagram");return d(),l("div",null,[e[0]||(e[0]=r("",3)),i(t,{code:`sequenceDiagram
  participant App as Application
  participant Editor as Editor / Lifecycle
  participant Adapter as LayoutHostAdapter
  participant Font as FontManager / HarfBuzzRuntime
  participant Draw as Draw
  App->>Editor: await Editor.create(container, data, options)
  Editor->>Editor: Merge options, clone and normalize data, assemble modules
  Editor->>Adapter: ensureReady()
  Adapter->>Font: Initialize HarfBuzz WASM and explicit fonts
  Font-->>Adapter: Runtime and fonts ready
  Adapter->>Adapter: Create shaper, engine and service
  Adapter-->>Editor: Layout service ready
  Editor->>Draw: First render without setting the caret
  Draw->>Draw: Layout, pagination, positions and paint scheduling
  Draw-->>Editor: First layout completed
  Editor->>Editor: state = ready
  Editor-->>App: Usable editor
  Note over Draw,Font: Coverage scanning and automatic font downloads continue in the background
`}),e[1]||(e[1]=a("p",null,[a("code",null,"Editor.create()"),n(" is recommended. Mutation and geometry commands during initialization are rejected rather than queued. A small read-only allowlist and explicit asynchronous height measurement have special rules; see "),a("a",{href:"./font-and-esm-migration.html"},"migration"),n(". With the synchronous constructor, await "),a("code",null,"editor.ready"),n(" yourself.")],-1)),e[2]||(e[2]=a("p",null,[n("Runtime, explicit-font initialization or first-layout errors reject ready; "),a("code",null,"initializationError"),n(" retains the cause and create cleans up the failed instance. Missing glyphs do not fail initialization. Ready does not wait for background fonts, every image, or every offscreen page: paginated painting can be lazy.")],-1)),e[3]||(e[3]=a("h2",{id:"_2-document-to-page-flow",tabindex:"-1"},[n("2. Document-to-page flow "),a("a",{class:"header-anchor",href:"#_2-document-to-page-flow","aria-label":'Permalink to "2. Document-to-page flow"'},"​")],-1)),i(t,{code:`flowchart TD
  Input[Command / first document / font or option change] --> Dirty[Normalize data and record dirty ranges]
  Dirty --> Compute{Recompute layout?}
  Compute -->|Yes| Frame[Page, column and header/footer constraints]
  Frame --> Host[Native document flow: paragraph, table and object hosts]
  Host --> Paragraph[ElementBridge extracts paragraphs and styled spans]
  Paragraph --> Runs[BiDi, script/style runs and actual face selection]
  Runs --> Shape[HarfBuzz contextual shaping]
  Shape --> Break[Candidate breaks and reshaping at line boundaries]
  Break --> Stable{Breaks stable?}
  Stable -->|No| Break
  Stable -->|Yes| Lines[Visual order, alignment, baseline, clusters and carets]
  Lines --> Flow[Container flow and table page fragments]
  Flow --> Pages[Pagination and Position rebuild]
  Pages --> Overlay[Search, areas and control-highlight geometry]
  Overlay --> Schedule[Create or resize page canvases]
  Compute -->|No: internal repaint| Schedule
  Schedule --> Lazy{Paginated and lazy paint allowed?}
  Lazy -->|Yes| Observer[IntersectionObserver schedules visible pages]
  Lazy -->|No| Paint[Paint pages immediately]
  Observer --> Paint
  Paint --> Finish[Caret, conditional history, events and tools]
`}),e[4]||(e[4]=r("",11)),i(t,{code:`flowchart TD
  A[Clear and background] --> B[Areas, column rules, bottom watermark, margins]
  B --> C[Bottom floating images and control highlights]
  C --> D[Body glyphs, decorations and inline objects]
  D --> E[Header, page number and footer in paginated mode]
  E --> F[Top and surrounding floating images]
  F --> G[Search, spelling, placeholder, line numbers, page border]
  G --> H[Badges, graffiti and top watermark]
`}),e[5]||(e[5]=a("p",null,"Each layer is conditional. Print mode omits some editing decorations. DOM toolbars, input proxies and overlays have their own stacking context outside this page-paint sequence.",-1)),e[6]||(e[6]=a("h2",{id:"_5-editing-sequence",tabindex:"-1"},[n("5. Editing sequence "),a("a",{class:"header-anchor",href:"#_5-editing-sequence","aria-label":'Permalink to "5. Editing sequence"'},"​")],-1)),i(t,{code:`sequenceDiagram
  participant User as User / application
  participant Cmd as Commands / input
  participant Model as Document / dirty ranges
  participant Layout as Draw / layout hosts
  participant Canvas as Canvas pages
  participant UI as Positions / events / tools
  User->>Cmd: Type, format or invoke a command
  Cmd->>Model: Mutate content, update range and dirty state
  Model->>Layout: render()
  Layout->>Layout: Reflow dirty paragraphs or full document and rebuild flow/pages
  Layout->>UI: Rebuild Position, search and control geometry
  Layout->>Canvas: Schedule painting, offscreen pages may wait
  Layout->>UI: Update caret and conditionally submit history
  Layout->>UI: renderChange for layout-compute passes
  Layout->>UI: nextTick range styles, tools and page statistics
`}),e[7]||(e[7]=a("p",null,"The initial renderChange is deferred until ready; normal layout-compute events occur before subsequent nextTick tool updates. The event is not proof that all asynchronous resources and offscreen pages are complete. Hit testing, selection rectangles, visual navigation and logical deletion consume the same native line/cluster/caret geometry as painting.",-1)),e[8]||(e[8]=a("h2",{id:"_6-missing-font-recovery",tabindex:"-1"},[n("6. Missing-font recovery "),a("a",{class:"header-anchor",href:"#_6-missing-font-recovery","aria-label":'Permalink to "6. Missing-font recovery"'},"​")],-1)),i(t,{code:`sequenceDiagram
  participant Coverage as Coverage / warnings
  participant Manager as FontDownloadManager
  participant Bunny as Bunny Fonts / cache
  participant Fonts as FontManager
  participant Draw as Layout and paint
  Draw->>Coverage: Current text, styles, sources and font revision
  Coverage->>Coverage: Report missing glyphs in page UI and console
  alt Automatic downloads enabled and a candidate exists
    Coverage->>Manager: Schedule by script and actual style
    Manager->>Bunny: Request CSS metadata and matching font subsets
    Bunny-->>Manager: Font bytes or cached resources
    Manager->>Fonts: Decode and register actual font faces
    Fonts-->>Draw: Revision changes and invalidates layout
    Draw->>Draw: Full reflow and repaint
    Draw->>Coverage: Rescan and update the report
  else Disabled, unsupported or failed
    Coverage->>Coverage: Keep original text, placeholders and warnings
  end
`}),e[9]||(e[9]=r("",12))])}const v=o(c,[["render",p]]);export{b as __pageData,v as default};

import{_ as o,C as s,o as d,c as l,ag as r,E as i,j as a,a as n}from"./chunks/framework.Drp2S_UI.js";const b=JSON.parse('{"title":"Rendering pipeline and timing","description":"","frontmatter":{},"headers":[],"relativePath":"en/guide/rendering-pipeline.md","filePath":"en/guide/rendering-pipeline.md","lastUpdated":1792653875000}'),c={name:"en/guide/rendering-pipeline.md"};function p(u,e,g,h,m,y){const t=s("MermaidDiagram");return d(),l("div",null,[e[0]||(e[0]=r('<h1 id="rendering-pipeline-and-timing" tabindex="-1">Rendering pipeline and timing <a class="header-anchor" href="#rendering-pipeline-and-timing" aria-label="Permalink to &quot;Rendering pipeline and timing&quot;">​</a></h1><p>All text uses HarfBuzz shaping and Canvas glyph-outline painting. “Native layout” below means this project&#39;s TextLine/cluster/caret model, not DOM text layout or native OS widgets. Source responsibilities are listed in <a href="./architecture.html">Architecture</a>.</p><h2 id="_1-initialization-and-the-ready-boundary" tabindex="-1">1. Initialization and the ready boundary <a class="header-anchor" href="#_1-initialization-and-the-ready-boundary" aria-label="Permalink to &quot;1. Initialization and the ready boundary&quot;">​</a></h2>',3)),i(t,{code:`sequenceDiagram
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
`}),e[4]||(e[4]=r(`<p>This is a conceptual expansion of internal calls. Table cells recursively enter paragraph/object layout; text is not laid out independently of all tables first. Internal <code>isCompute: false</code> repaints existing geometry and is not a shortcut after content, width or font changes. Applications should use public commands instead of calling internal render methods.</p><h2 id="_3-paragraph-shaping-and-line-breaking" tabindex="-1">3. Paragraph shaping and line breaking <a class="header-anchor" href="#_3-paragraph-shaping-and-line-breaking" aria-label="Permalink to &quot;3. Paragraph shaping and line breaking&quot;">​</a></h2><p>ElementBridge combines normalized runtime elements into paragraphs and styled spans while preserving logical sources. Bidirectional analysis determines levels; script and style segmentation forms runs, and FontManager selects actual faces by coverage. A CSS family name alone does not provide HarfBuzz with font bytes.</p><p>HarfBuzz returns glyph IDs, clusters, advances and offsets. A glyph may represent multiple characters and one character may contribute to several glyphs. The engine shapes a paragraph to estimate breaks, then reshapes at actual line boundaries and refines the breaks until stable. This matters when Arabic joining or ligatures change at a boundary. Visual ordering, alignment and justification follow.</p><p>TextLayoutService combines real font metrics and ink bounds to produce ascent, descent, baseline, line content height, clusters and carets, including control minimum widths and inline object boxes. Paragraph spacing before/after remains separate from glyph baselines and content line height, then enters document flow. Uniformly increasing text height cannot model empty paragraphs or page-boundary spacing correctly.</p><table tabindex="0"><thead><tr><th>Result</th><th>Consumer</th></tr></thead><tbody><tr><td>Glyph</td><td>Face, glyph ID, position and outline painter</td></tr><tr><td>Cluster</td><td>Source-to-glyph mapping, selection and deletion boundaries</td></tr><tr><td>Caret</td><td>Logical/visual positions, direction and keyboard movement</td></tr><tr><td>TextLine</td><td>Line box, baseline, direction, spacing and object references</td></tr><tr><td>Container/page positions</td><td>Pagination, cells, columns and final hit coordinates</td></tr></tbody></table><h2 id="_4-painting-a-canvas-page" tabindex="-1">4. Painting a Canvas page <a class="header-anchor" href="#_4-painting-a-canvas-page" aria-label="Permalink to &quot;4. Painting a Canvas page&quot;">​</a></h2><p>GlyphRenderer obtains and caches outline commands from the real font face, then fills Canvas paths. Body text, page chrome, page numbers, list markers, placeholders and auxiliary labels do not fall back to browser <code>fillText</code>, <code>strokeText</code> or <code>measureText</code>. Missing glyphs remain explicit placeholders with diagnostics.</p><p>Native coordinates use CSS pixels before host scale and device pixel ratio. Conceptually:</p><div class="language-text vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">text</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>x = line.rect.x + glyph.x + glyph.offsetX</span></span>
<span class="line"><span>y = line.rect.y + line.baseline + glyph.y + glyph.offsetY</span></span></code></pre></div><p>Outline paths already use downward-positive Y. The host applies zoom/DPR once; font, layout and painter code must not each apply the same scale. Colors and decorations come from source/cluster styles. Objects retain dedicated painters.</p>`,11)),i(t,{code:`flowchart TD
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
`}),e[9]||(e[9]=r('<p>Scanning covers body, header/footer, tables and auxiliary text. In-flight requests are deduplicated; memory/IndexedDB cache hits still require actual face registration. Disabling automatic downloads also disables automatic registration from the shared download cache, while explicit URLs and manual registration remain available.</p><p>Basic Bunny fonts do not guarantee all Unicode, regional forms, emoji or styles. Network failure never switches to legacy text layout. Preload required fonts and disable background downloads when stable first pagination, offline use or deterministic export matters. Candidate and diagnostic details are in <a href="./font-and-esm-migration.html">font migration</a>.</p><h2 id="_7-incremental-reuse-and-invalidation" tabindex="-1">7. Incremental reuse and invalidation <a class="header-anchor" href="#_7-incremental-reuse-and-invalidation" aria-label="Permalink to &quot;7. Incremental reuse and invalidation&quot;">​</a></h2><p><code>lab.incrementalCompute: true</code> reuses unchanged native paragraphs. Dirty paragraphs are still fully shaped because contextual shaping and BiDi can affect the entire paragraph. Cached relative indexes are remapped to current sources. Document scanning, container flow, pagination, table fragments and positions still run; complex constraints invalidate conservatively.</p><table tabindex="0"><thead><tr><th>Cache</th><th>Current limit</th><th>Relevant keys</th></tr></thead><tbody><tr><td>Paragraph layouts</td><td>256 entries</td><td>Content, styles, source identity, font revision, width and line constraints</td></tr><tr><td>Glyph outlines</td><td>1024 entries / 4 MiB</td><td>Face, glyph and size</td></tr><tr><td>Coverage queries</td><td>2048 entries</td><td>Font and query</td></tr><tr><td>Font instances</td><td>256 entries</td><td>Instance keys and font lifecycle</td></tr></tbody></table><p>These are internal limits, not stable APIs. There is no promise of convergence within 1–3 lines. T23 stress runs measured full/incremental at about 348/383 ms for many paragraphs and 447/803 ms for one long paragraph. Those tests force all pages to paint and do not measure normal visible-page production typing latency. See <a href="./../../guide/native-release-acceptance.html">acceptance details</a>.</p><h2 id="_8-image-export-and-printing" tabindex="-1">8. Image export and printing <a class="header-anchor" href="#_8-image-export-and-printing" aria-label="Permalink to &quot;8. Image export and printing&quot;">​</a></h2><p><code>command.getImage()</code> prepares temporary drawing state/pixel ratio, paints target pages, waits for the image observer, returns PNG data URLs, then restores state. Printing creates a temporary editor, awaits ready and uses page images plus an iframe to invoke browser printing.</p><p>This is neither standalone SVG export nor native vector PDF. HTML/iframe blocks, external images, background font downloads and browser print settings have additional constraints. Ready is not a frozen-resource export barrier; preload fonts, manage image availability and validate real business documents.</p><h2 id="_9-further-reading" tabindex="-1">9. Further reading <a class="header-anchor" href="#_9-further-reading" aria-label="Permalink to &quot;9. Further reading&quot;">​</a></h2><ul><li><a href="./architecture.html">Architecture</a>: responsibilities and source locations.</li><li><a href="./start.html">Quick start</a>: initialization, fonts, persistence and cleanup.</li><li><a href="./../../guide/native-release-acceptance.html">Final acceptance</a>: T23/T24 browser/performance evidence.</li><li><a href="./engineering-records.html">Engineering records</a>: staged designs and deferred SVG plans.</li></ul>',11))])}const v=o(c,[["render",p]]);export{b as __pageData,v as default};

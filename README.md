# @herberthe/canvas-editor

A HarfBuzz-powered rich text editor with **Canvas-only page rendering**,
maintained by **Herbert He**. The independent package release line starts at
**0.1.0** and distributes **ES modules and TypeScript declarations only**.

## Project origin and relationship

This project is an independently maintained fork of
[Hufe921/canvas-editor](https://github.com/Hufe921/canvas-editor), originally
created by Hufe and its contributors. Thank you to the upstream community for
the original editor and its document features.

- Fork repository: [HerbertHe/canvas-editor](https://github.com/HerbertHe/canvas-editor)
- Fork npm package: `@herberthe/canvas-editor`
- Upstream npm package: `@hufe921/canvas-editor`
- This is not an official upstream release and is not endorsed by or affiliated
  with the upstream maintainers. Versions, releases, support and roadmap are independent.
- `0.1.0` starts the fork's version series; it is not an upstream downgrade or a
  promise of drop-in compatibility. The upstream package is not a dependency.

## Differences from upstream

The comparison below is scoped to upstream **1.0.5**, at
[main commit 1d7cd1a7](https://github.com/Hufe921/canvas-editor/tree/1d7cd1a7742f3e8af1f67536a5157d03b2945de7).
It does not assert that future upstream versions will lack these features.

| Capability                                                   | Upstream baseline                             | This fork 0.1.0                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Text layout and painting                                     | Browser Canvas text measurement/painting      | HarfBuzz-only shaping and native layout; Canvas glyph outlines                                   |
| Font files used by layout                                    | Browser font selection                        | Explicit TTF/OTF/WOFF/WOFF2 registration and actual font-face tracking                           |
| Missing-font handling                                        | Browser fallback                              | Coverage reports/events, explicit missing-glyph boxes and page/console hints                     |
| Automatic basic fonts                                        | No equivalent Bunny download pipeline         | Default-enabled Bunny downloads, runtime switch, retry and manual/offline mode                   |
| Bidirectional and complex-script geometry                    | No equivalent HarfBuzz cluster/caret pipeline | Native glyph/cluster/caret geometry, visual navigation and logical deletion                      |
| Initialization                                               | Synchronous editor construction               | `Editor.create()` or `await editor.ready`, with failure/cleanup states                           |
| Incremental layout                                           | Row-level incremental layout already exists   | Opt-in bounded flow, unchanged-line position/query reuse and experimental layout Worker |
| Distribution                                                 | ESM and UMD                                   | ESM-only root exports and declarations; no UMD/CommonJS                                          |
| SVG pages                                                    | Separate upstream experimental branch         | Deferred and unavailable; Canvas is the only page renderer                                       |
| Rich text, tables, controls, pagination, annotations, macros | Existing upstream capabilities                | Inherited and adapted; not claimed as fork inventions                                            |

See [项目关系与差异（中文）](docs/guide/fork-and-differences.md) /
[full comparison and migration notes](docs/en/guide/fork-and-differences.md).
The font pipeline still has limits: basic downloads do not guarantee rare
characters, every language/style or color emoji support. See the
[testing and acceptance guide](docs/en/guide/engineering-records.md) and
[current benchmark](docs/en/guide/benchmark.md) for validation and limits.

## Benchmark

Measured on Apple M1 Pro (8 logical CPUs, 16 GiB), Node 24.19.0, Chrome
155, with fixed fonts, paging, history enabled, DPR 1 and middle edits at
2Hz for 10 seconds. Values below are handler P50 in milliseconds, fixed
trial 0; the final optimized configuration uses synchronous opt-in features.

| Document / action | Initial baseline | Optimized | Reduction |
| --- | ---: | ---: | ---: |
| 100 paragraphs / input | 339.6 | 6.3 | 98.1% |
| 100 paragraphs / Backspace | 357.1 | 7.5 | 97.9% |
| 1000 paragraphs / input | 5296.0 | 34.8 | 99.3% |
| 1000 paragraphs / Backspace | 5349.9 | 32.1 | 99.4% |
| One long paragraph / input | 471.1 | 189.8 | 59.7% |
| Large table / input | 42.4 | 20.0 | 52.8% |

These are historical same-machine trends: Chrome changed from
155.0.8059.85 to .86, so they are not a strict same-browser A/B.
Compared with the immediately preceding optimization, thousand-paragraph
position work fell 97.0% and query-index work fell 95.8%. In the 100-paragraph,
30-second Worker Backspace test, offer-to-geometry P95 fell from 6718.4ms
to 72.4ms and the mirror finished ready with no pending requests or edits.

The default remains `baseline`; enable `lab.performanceProfile: 'sync'`
only after validating your documents. Worker remains experimental and transfer
is deferred. Long paragraphs, large tables and thousand-paragraph pressure
still have expensive cases; handler/geometry budgets are not universally met.
Geometry is a latency proxy, not measured screen presentation.
Read the [full benchmark, three-trial ranges and raw data](docs/en/guide/benchmark.md)
([中文](docs/guide/benchmark.md)) and [configuration](docs/en/guide/lab.md).

## Rendering support

**Canvas is the default and only supported document page renderer.** There is
no renderer selector. SVG page rendering and standalone SVG document export
are deferred; the SVG assessment is a future design, not a shipped feature.
SVG images, formula resources, glyph path data and UI icons remain usable as
resources and do not constitute an SVG page backend.

All editor text uses HarfBuzz. The removed `textEngine` / `renderMode` options
and their enums are unsupported. Do not configure `renderer: 'svg'`.

## Installation

```sh
npm install @herberthe/canvas-editor@0.1.0
# or
pnpm add @herberthe/canvas-editor@0.1.0
# or
yarn add @herberthe/canvas-editor@0.1.0
```

The metadata in this repository prepares the 0.1.0 release; it does not by
itself confirm npm publication. To try the prepared package before publication,
run `npm run lib` and `npm pack`, then install the generated tarball.

## Quick start

```html
<div class="canvas-editor"></div>
```

```typescript
import Editor from '@herberthe/canvas-editor'

const container = document.querySelector<HTMLDivElement>('.canvas-editor')!
const editor = await Editor.create(container, {
  main: [{ value: 'Weekend plans · 周末计划 · خطة نهاية الأسبوع' }]
})
```

Alternatively, construct with `new Editor(...)` and then `await editor.ready`.
Mutation and geometry commands require readiness. Initialization states are
`initializing`, `ready`, `failed` and `destroyed`; `initializationError` retains
the failure cause. Destroying a pending editor rejects readiness and cleans up.

`autoDownloadFonts` defaults to `true`: uncovered text triggers basic-font
requests to Bunny Fonts. Set it to `false` for offline/manual integration.
Readiness waits for WASM, explicitly configured fonts and first layout, but
not background font downloads. Missing-font placeholders and hints remain if
coverage is incomplete or a download fails.

```typescript
await editor.register.fonts([
  { family: 'My Font', data: fontBytes, weight: 400, style: 'normal' }
])
const coverage = editor.getFontCoverageReport()
editor.eventBus.on('fontCoverageChange', report => console.log(report))
await editor.retryFontDownloads()
```

`fontBytes` must contain actual TTF/OTF/WOFF/WOFF2 font bytes. See the runnable
[ESM font example](examples/esm-fonts/README.md) and
[font/migration guide](docs/en/guide/font-and-esm-migration.md)
([中文](docs/guide/font-and-esm-migration.md)).

## Package and migration contract

Import from `@herberthe/canvas-editor`. `require()`, UMD scripts and internal
`dist/*` / `src/*` imports are unsupported. The only public subpath is
`@herberthe/canvas-editor/package.json`.

Use a browser with WebAssembly, Web Workers and top-level await. Preserve
top-level await in your bundler (for Vite, use `build.target: 'esnext'`) and
deploy all generated chunks together, including workers and HarfBuzz WASM.

When migrating, replace the upstream package dependency and imports, remove
old engine options, await readiness and provide fonts for the required text.
Revalidate pagination and plugins: font metrics and initialization differ from
upstream. Upstream Word/Excel and other plugins are external projects whose
compatibility with this fork must be tested individually.

## Features and development

Inherited document features include rich text, tables, images, links, LaTeX,
form controls, headers/footers, pagination, watermarks, comments, search,
track changes, macros and plugins. Printing uses the Canvas image pipeline;
standalone SVG and native PDF export are not provided by this package.

Use Node.js `>=24.13.1` and pnpm 10:

```sh
pnpm install
npm run dev           # local everyday multilingual demo
npm run lib           # lint, types, unit tests and ESM library build
npm run build         # demo build with checks
npm run docs:dev      # local bilingual documentation
npm run docs:build
npm run test:package  # packed ESM consumer and documented example checks
```

Documentation: [中文指南](docs/guide/start.md) / [English guide](docs/en/guide/start.md).
Run the local demo and documentation rather than using the upstream hosted
sites, which describe a different package. Report fork issues at
[HerbertHe/canvas-editor/issues](https://github.com/HerbertHe/canvas-editor/issues).
See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution instructions.

## AI-assisted repository guides

[DeepWiki](https://deepwiki.com/HerbertHe/canvas-editor) ·
[Zread](https://zread.ai/HerbertHe/canvas-editor)

## License and attribution

[MIT](LICENSE). Fork modifications: Copyright © 2026–present **Herbert He**.
Original project: Copyright © 2021–present **hufe**; the original notice and MIT
permission are retained. See [NOTICE](NOTICE) for provenance. Dependencies,
fonts and other third-party assets retain their respective licenses.

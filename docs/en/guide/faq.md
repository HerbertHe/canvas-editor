# Troubleshooting

## Where is the complete toolbar?

The library provides the editor and APIs; the repository demo assembles menus and toolbars. Run `npm run dev` and inspect `src/main.ts`, then select the controls your application needs. Use public commands instead of internal Draw methods.

## Why are glyphs missing after ready?

Ready waits for runtime initialization, explicit fonts and first layout, not background downloads. Inspect page warnings, `getFontCoverageReport()` and `fontCoverageChange` for script, style and download status. Bunny basic fonts are not a complete Unicode collection. Unsupported or failed cases still need explicit files; see [font guidance](./font-and-esm-migration.md).

## Why does an installed system font not work?

HarfBuzz requires accessible font bytes. Family names, CSS and OS installation do not register those bytes. Use initial `fonts` or `register.fonts()`, check individual results and then coverage. Bold, italic and regional forms need suitable actual faces.

## Why does offline mode still make requests?

`autoDownloadFonts: false` disables automatic Bunny requests and automatic registration from that cache. It does not prohibit explicit font URLs, images or other application resources. Host required files with the app and inspect explicit URLs. Turning the switch off does not remove registered fonts.

## How should initialization failure or rapid unmount work?

Use `await Editor.create(...)` inside try/catch; failed instances are cleaned up. With synchronous construction, catch ready rejection and destroy the instance yourself. If unmount occurs before create resolves, use a cancellation flag and destroy the late result immediately. Your application owns external listeners, toolbars and resources.

## Why did pagination change after migration?

Actual font faces and HarfBuzz shaping now determine widths rather than browser fallback or synthetic styles. Revalidate using fixed fonts, weights, widths and options. Background font registration can also change pagination.

## Is incremental mode always faster?

No. It defaults to off. Dirty paragraphs are fully shaped and document flow, pagination and positions still run. Long paragraphs and cloning may be slower. See [experimental options](./lab.md) and [acceptance measurements](../../guide/native-release-acceptance.md).

## Can I switch to SVG or vector PDF?

Only Canvas pages are available. Standalone SVG export is deferred. `renderer`, removed `renderMode` and `textEngine` are not usable switches. SVG images/formulas do not constitute an SVG page engine; printing uses Canvas images.

## How do I diagnose production 404s?

Serve the full output over HTTP(S). Check chunk, worker, WASM and font paths, CORS and CSP. Do not copy just the entry JS or open with `file://`. The docs site's `DOCS_BASE` must match its Pages path; see [deployment](./docs-deployment.md).

## Where should I report issues?

Use [HerbertHe/canvas-editor issues](https://github.com/HerbertHe/canvas-editor/issues) with browser, fonts, configuration, a minimal document and reproduction steps. Coverage reports can contain document characters/locations; review them before sharing. Verify upstream plugins individually, and do not assume upstream maintainers support this fork.

# Testing and acceptance

Use [quick start](start.md), [fonts and migration](font-and-esm-migration.md), [rendering pipeline](rendering-pipeline.md) and API references for the current contract. Completed task lists and duplicate implementation notes have been consolidated. Current measurements are in [Benchmark](benchmark.md); initial, pre-fix and final JSON evidence remains in `docs/guide/performance-baselines/`.

## Quality and browser checks

Use Node ≥24.13.1. Run from the repository root:

```sh
rtk npm run lib
rtk npm run docs:build
rtk npm run test:package -- --serve
```

`lib` runs ESLint, TypeScript, Vitest and the library build. The last command serves package consumers for browser QA. Tests use real fixture fonts, disable network by default and reject browser Canvas text measurement/painting.

Browser checks use an independent Playwright installation and matching browsers. Set `PLAYWRIGHT_MODULE` and optionally `BROWSER_EXECUTABLE` for your environment. Start the fixture server with `rtk npm run dev -- --host 127.0.0.1 --port 3014 --strictPort`.

In another terminal:

```sh
BASE_URL=http://127.0.0.1:3014 BROWSER=chromium RANDOM_EDITS=12 SEED=21 \
OUTPUT=cypress/results/acceptance/chromium-differential.json \
rtk node scripts/test-advanced-layout.mjs

BASE_URL=http://127.0.0.1:3014 BROWSER=chromium PROFILES=baseline,sync,worker \
rtk node scripts/test-native-browsers.mjs

BASE_URL=http://127.0.0.1:3014 rtk node scripts/test-performance-lifecycle.mjs

rtk node scripts/test-layout-package.mjs
```

Repeat differential, compatibility and package checks with Firefox/WebKit and matching executables. Package checks require the consumer server above. Worker fallback does not bypass the requirement for WebAssembly or make arbitrary CSP policies compatible.

## Reproducing performance and release gates

The [Chinese reproducibility guide](../../guide/engineering-records.md) provides the full standard/pressure commands, environment variables and evidence format. Run measurements serially with the same browser, fonts, document capacity, history, DPR and warmup. Keep instrumented and uninstrumented runs separate. Preserve slow events and drain every accepted edit; verify final text, selection, history and Worker state.

```sh
rtk npm run test:performance:acceptance -- \
  docs/guide/performance-baselines/perf21-manifest-2026-10-23.json
```

The gate emits `pass`, `hold` or `fail`; only `pass` exits zero by default. `--report-only` accepts a valid `hold`, but damaged, incomplete or stale evidence still fails. Fixed budgets remain handler P95 ≤8ms and DOM-to-geometry P95 ≤32ms. Geometry/rAF observations do not prove actual screen presentation latency.

Current status is **hold**. The retained manifest references final performance data, but its `automated` list was cleared when disposable logs were removed. Regenerate quality, build, lifecycle and all three browsers' differential/compatibility/package evidence before a release decision. Source hashes must match. System IME, OS key repeat, actual presentation and long-term native/WASM/GPU memory still need manual evidence.

Keep temporary logs, screenshots, traces and intermediate output in ignored `cypress/results/`. Retain valid baseline/final JSON and the updated Benchmark. Historical migration results remain in [final migration acceptance](../../guide/native-release-acceptance.md).

## Optional future work

Prioritize long-paragraph layout and global flow/metadata traversal. Consider tile caching, OffscreenCanvas workers or WebGL/WebGPU glyph painting only when profiling identifies painting as the limiting cost. These do not eliminate CPU shaping or document flow.

Retained design references: [RTL design](rtl-layout-design.md), [RTL follow-ups](rtl-deferred-todo.md), and [deferred SVG assessment](../../guide/harfbuzz-svg-assessment.md). SVG pages and standalone SVG document export remain unavailable.

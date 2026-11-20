# Performance benchmark

On 2026-11-20, the same Apple M1 Pro (16 GiB) and headless Chrome 158.0.8127.36 ran
all three targets. Each target and workload used three fresh page sessions.
Target order rotated between trials.

| Target | Tested build |
| --- | --- |
| Upstream playground | The page reported 1.2.0. Entry asset `index-VPntKjiG.js` had SHA-256 prefix `de04b0fea892`. [Live upstream playground](https://hufe.club/canvas-editor/) |
| Initial migration | Production playground rebuilt from the initial documentation-site revision `c5a00d38`, with its original defaults. |
| Current build | Production playground built from `bb315ee9` plus working-tree changes, with the default `sync` preset and IME preview. Asset hashes and the source diff fingerprint are in the raw log. |

## Built-in playgrounds

Each playground kept its own document. The driver inserted a test lane at the
start of the body and replayed the same actions. Upstream had 2
pages and 729 UTF-16 units. Both migration builds had 5
pages and 1,994 UTF-16 units. This comparison reflects the shipped
playgrounds and includes differences in their document workloads.

Each cell shows pooled **P50 / P95 (ms)** across three trials.

| Metric | Upstream playground | Initial migration | Current build |
| --- | ---: | ---: | ---: |
| Typing handler | 2.2 / 4.3 | 107.6 / 134.9 | 44.3 / 89.3 |
| Backspace handler | 1.9 / 4.3 | 106.4 / 122.1 | 43.3 / 48.2 |
| Delete handler | 2.4 / 5.2 | 107.9 / 123.1 | 43.9 / 63.2 |
| IME preedit handler | 2.1 / 3.9 | 104.5 / 122.8 | 0.0 / 0.1 |
| IME preedit to second rAF | 23.4 / 30.8 | 109.0 / 128.4 | 84.1 / 283.8 |

## Shared 100-paragraph document

All three pages loaded the same mixed English and Arabic document
and edited near the middle. Paper size was 480 × 640 CSS px, margins were
32 px on each side, font size was 16 and zoom was 100%. The body contained
7,699 UTF-16 units before the test lane. Upstream, initial migration
and current produced 13, 19 and 19 pages
respectively. Each version used its own font resolution and layout pipeline.

| Metric | Upstream playground | Initial migration | Current build |
| --- | ---: | ---: | ---: |
| Typing handler | 3.4 / 5.3 | 403.2 / 469.4 | 6.7 / 9.0 |
| Backspace handler | 3.3 / 5.4 | 418.2 / 482.9 | 6.6 / 7.8 |
| Delete handler | 3.4 / 5.1 | 411.7 / 473.4 | 7.2 / 9.6 |
| IME preedit handler | 3.4 / 4.0 | 402.8 / 444.7 | 0.0 / 0.1 |
| IME preedit to second rAF | 24.8 / 31.9 | 414.9 / 460.4 | 22.3 / 36.3 |

On the shared workload, Backspace handler P95 fell from **482.9 ms**
in the initial migration to **7.8 ms** in the current build. Upstream
recorded **5.4 ms**. In the built-in playgrounds, IME preedit to second rAF
P95 was **30.8 ms** upstream, **128.4 ms** in the initial migration
and **283.8 ms** in the current build. The current playground improved
the median while its slowest updates took longer. A short handler can leave
layout and painting work for later browser frames.

## Method and reproduction

- Viewport 1366 × 720, DPR 1. Each trial warmed up one insertion and deletion,
  then replayed 12 events each for typing, Backspace and Delete and
  7 pinyin preedits before committing “你好”. The driver waited
  for each keyboard dispatch with at least 50 ms between operations and
  at least 40 ms between Chrome composition updates.
- Handler duration comes from the `input` event for typing and preedit and
  `keydown` for deletion. Time to the second `requestAnimationFrame` measures
  browser scheduling. This run covers automated Chrome composition, with no
  measurement of hardware key repeat, system candidate windows or display timing.
- All 18 trials checked event counts, final text and caret positions. Each
  workload and target contributed 36 events per keyboard metric
  and 21 preedit events.

[Raw logs for all three targets](../../guide/performance-baselines/playground-comparison-2026-11-20.json) ·
[October 22 initial-migration archive](../../guide/performance-baselines/perf01-2026-10-22.json)

Build the current playground with `npm run docs:build`. Export the initial
revision into a temporary directory with `git archive c5a00d38`, reuse the
project dependencies and build it with
`DOCS_BASE=/initial/ node scripts/build-docs-demo.mjs`. Serve both production
builds at their configured base paths and run:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
INITIAL_URL=http://127.0.0.1:3027/initial/playground/ \
CURRENT_URL=http://127.0.0.1:3027/canvas-editor/playground/ \
node scripts/test-playground-benchmark.mjs
```

# Performance benchmark

On 2026-11-20, the same Apple M1 Pro (16 GiB) and headless Chrome 158.0.8127.36 ran
all three targets. Each target and workload used three fresh page sessions.
Target order rotated between trials.

| Target | Tested build |
| --- | --- |
| Upstream playground | The page reported 1.2.0. Entry asset `index-VPntKjiG.js` had SHA-256 prefix `de04b0fea892`. [Live upstream playground](https://hufe.club/canvas-editor/) |
| Initial migration | Production playground rebuilt from the initial documentation-site revision `c5a00d38`, with its original defaults. |
| Current build | Production playground built from `dd3cfccf` plus the P0/P1 working-tree changes, with the default `sync` preset and IME preview. Asset hashes and the source diff fingerprint are in the raw log. |

## Built-in playgrounds

Each playground kept its own document. The driver inserted a test lane at the
start of the body and replayed the same actions. Upstream had 2
pages and 729 UTF-16 units. Both migration builds had 5
pages and 1,994 UTF-16 units. This comparison reflects the shipped
playgrounds and includes differences in their document workloads.

Each cell shows pooled **P50 / P95 (ms)** across three trials.

| Metric | Upstream playground | Initial migration | Current build |
| --- | ---: | ---: | ---: |
| Typing handler | 2.5 / 3.9 | 109.5 / 131.1 | 7.4 / 48.0 |
| Backspace handler | 2.0 / 4.7 | 106.6 / 121.3 | 6.6 / 49.7 |
| Delete handler | 2.4 / 4.1 | 107.8 / 116.9 | 5.9 / 7.2 |
| IME preedit handler | 1.9 / 3.8 | 104.8 / 130.5 | 0.0 / 0.1 |
| IME preedit to second rAF | 26.3 / 32.4 | 111.5 / 135.1 | 29.4 / 31.6 |

## Shared 100-paragraph document

All three pages loaded the same mixed English and Arabic document
and edited near the middle. Paper size was 480 × 640 CSS px, margins were
32 px on each side, font size was 16 and zoom was 100%. The body contained
7,699 UTF-16 units before the test lane. Upstream, initial migration
and current produced 13, 19 and 19 pages
respectively. Each version used its own font resolution and layout pipeline.

| Metric | Upstream playground | Initial migration | Current build |
| --- | ---: | ---: | ---: |
| Typing handler | 3.2 / 5.3 | 418.2 / 573.8 | 7.0 / 8.3 |
| Backspace handler | 3.7 / 5.2 | 412.4 / 460.2 | 6.5 / 8.3 |
| Delete handler | 3.0 / 6.6 | 417.5 / 503.7 | 6.9 / 9.1 |
| IME preedit handler | 3.1 / 3.8 | 418.4 / 473.2 | 0.0 / 0.1 |
| IME preedit to second rAF | 26.8 / 31.2 | 430.8 / 493.9 | 28.9 / 31.2 |

On the shared workload, Backspace handler P95 fell from **460.2 ms**
in the initial migration to **8.3 ms** in the current build. Upstream
recorded **5.2 ms**. In the built-in playgrounds, IME preedit to second rAF
P95 was **32.4 ms** upstream, **135.1 ms** in the initial migration
and **31.6 ms** in the current build. The current built-in playground’s
Backspace handler had a median of **6.6 ms** and a P95 of
**49.7 ms**, showing a wider spread in the slowest samples.

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
builds at their configured base paths and set the URLs below.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
INITIAL_URL=http://127.0.0.1:3027/initial/playground/ \
CURRENT_URL=http://127.0.0.1:3027/canvas-editor/playground/ \
node scripts/test-playground-benchmark.mjs
```

# Benchmark: typing and sustained deletion

Updated November 3, 2026. See the [latest three-engine IME rerun](#final-automated-results)
and [performance principles](performance-principles.md) for mechanisms and tradeoffs.
The ordinary typing/deletion figures below are historical October 23 measurements;
later dated IME studies have separate workloads and must not be pooled with them.
All optimized results use explicit experimental configuration; the default remains
`baseline`. See [configuration and fallback](lab.md).

## Method

Apple M1 Pro, 8 logical CPUs, 16 GiB, Darwin 25.4.0, Node 24.19.0. Fixed NotoNaskhArabic-Regular.ttf SHA256: `67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f`.

Chrome changed from 155.0.8059.85 in historical runs to 155.0.8059.86 in the final runs. These are same-machine historical trends, **not a strict same-browser A/B**; timing differences cannot be attributed entirely to code changes.

Standard cases use middle edits, paging, history on, paragraph cache off, DPR 1, one warmup and 2Hz for 10 seconds (20 operations per configuration). The initial baseline has one trial; preceding and final results have three. Tables compare fixed trial 0, rather than selecting the fastest trial. Units are milliseconds. Input uses the input handler; deletion uses the keydown handler.

Geometry commit is an event-to-geometry proxy. Offer-to-geometry also includes driver queueing. Neither measures screen presentation. Inclusive stages overlap and must not be added together.

## Standard handler P50

| Document | Action | Initial | Preceding | Final | Reduction vs preceding |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 paragraphs | input | 339.6 | 30.1 | 6.3 | 79.1% |
| 100 paragraphs | backspace | 357.1 | 30.7 | 7.5 | 75.6% |
| 100 paragraphs | delete | 352.6 | 31.2 | 7.2 | 76.9% |
| 1000 paragraphs | input | 5296.0 | 287.3 | 34.8 | 87.9% |
| 1000 paragraphs | backspace | 5349.9 | 277.8 | 32.1 | 88.4% |
| 1000 paragraphs | delete | 5358.3 | 267.0 | 35.3 | 86.8% |
| One long paragraph | input | 471.1 | 197.1 | 189.8 | 3.7% |
| One long paragraph | backspace | 480.2 | 194.0 | 194.7 | -0.4% |
| One long paragraph | delete | 469.7 | 190.5 | 191.9 | -0.7% |
| Large table | input | 42.4 | 19.9 | 20.0 | -0.5% |
| Large table | backspace | 39.5 | 19.1 | 21.7 | -13.6% |
| Large table | delete | 43.1 | 20.8 | 20.7 | 0.5% |

Negative reduction means slower. Final three-trial P50 ranges for input are 6.3–8.0ms (100 paragraphs), 34.0–35.3ms (1000), 189.8–190.5ms (long paragraph), and 19.9–23.5ms (large table). The full [three-trial tail table](../../guide/benchmark.md#本次三轮波动及尾延迟) retains all outliers: thousand-paragraph Backspace/Delete max reached 1491.8/1435.5ms, and table input P95 reached 127.3ms. These tails must not be hidden by median improvements.

## Position and query work

Thousand-paragraph input, trial 0, mean inclusive cost per key:

| Stage | Preceding | Final | Reduction |
| --- | ---: | ---: | ---: |
| positions | 281.64 | 8.43 | 97.0% |
| queryIndexBuild (inside positions) | 54.41 | 2.29 | 95.8% |
| flow | 15.87 | 17.31 | -9.1% |

Across 20 edits, 2730 position elements were computed and 776180 reused, excluding restored prefix references. Global metadata and row/paragraph directories still require traversal; this is not constant-time editing.

## Sustained Worker editing

All pressure cases run at 30Hz. Hundred-paragraph long pressure uses 30 seconds/900 edits; thousand-paragraph and transfer cases use 10 seconds/300 edits. Do not combine different capacities or durations into one percentage.

| Case / action | handler P95 | geometry P95 | offer-to-geometry P95 | Drain time |
| --- | ---: | ---: | ---: | ---: |
| 100 paragraphs / 30s / input | 5.8 | 179.3 | 217.1 | 30021.0 |
| 100 paragraphs / 30s / backspace | 25.5 | 25.4 | 72.4 | 30351.1 |
| 1000 paragraphs / input / trial 0 | 2.6 | 148.7 | 1356.6 | 11392.0 |
| 1000 paragraphs / input / trial 1 | 2.5 | 1308.2 | 2214.5 | 10958.3 |
| 1000 paragraphs / input / trial 2 | 2.4 | 1313.5 | 2177.6 | 10906.7 |

Hundred-paragraph 30s Backspace improved from handler P95 67.5 to 25.5ms, offer-to-geometry P95 6718.4 to 72.4ms, and drain time 36.13 to 30.35s. The mirror changed from ready=false / needsResync=true to ready=true / needsResync=false. Final requests and buffered edits were zero; no backend fault was recorded, one session start includes initialization, and peak buffered edits were 25. Full undo/redo matched with one history group.

Deletion commits synchronous incremental geometry and coalesces paint. Input can still use asynchronous layout; mirror edits are acknowledged in ordered batches. Faults/budget overflow rebuild from the authoritative model after idle or explicit draining.

Transfer input geometry P95 was 138.2/144.3/143.3ms; transfer Backspace was 11.5/12.3/12.1ms. All final pressure mirrors were ready without pending requests or edits. See the [complete pressure matrix](../../guide/benchmark.md#持续输入删除和-worker) and raw data below. Thousand-paragraph flow windows still consumed about 8.2–8.5 seconds, with two geometry P95 results around 1.3 seconds.

## Validation and release status

The full Vitest run passed 169 files/1072 tests; after final geometry, destruction and idle-boundary fixes, four targeted files/50 tests passed again. TypeScript, ESLint and the final library build passed. Final Chrome differential checks covered six groups/four modes, 348 structural comparisons and exact exported RGBA equality, including Unicode, RTL, tables, history and crash/budget recovery, with no page errors. Final benchmark data covers 50 cases/5280 operations.

Six create/edit/destroy cycles cleared workers, canvases, observers, pending requests and path caches. Forced-GC JS heap ranged from 14223020 to 14232228 bytes (about 13.56–13.57MiB). This supports short-term JS cleanup only, not long-term native/WASM/GPU memory stability.

Release status remains **hold** against fixed handler P95 ≤8ms and geometry P95 ≤32ms budgets. Keep `baseline` as default, `sync` opt-in, Worker experimental and transfer deferred. OS IME/key repeat, actual presentation, long-term memory and fresh Firefox/WebKit checks remain required. Historical browser results do not validate the latest fixes. Follow [testing and acceptance](engineering-records.md) to regenerate evidence.

## Retained evidence

- [Initial standard baseline](../../guide/performance-baselines/perf01-2026-10-22.json), [initial pressure](../../guide/performance-baselines/perf01-pressure-2026-10-22.json)
- [Pre-fix sync](../../guide/performance-baselines/perf21-sync-2026-10-23.json), [pre-fix sustained editing](../../guide/performance-baselines/perf21-worker-long-pressure-2026-10-23.json)
- [Final sync, three trials](../../guide/performance-baselines/perf-position-worker-sync-2026-10-23.json)
- [Final sustained editing](../../guide/performance-baselines/perf-position-worker-long-2026-10-23.json)
- [Final thousand-paragraph Worker](../../guide/performance-baselines/perf-position-worker-1000-2026-10-23.json)
- [Final transfer](../../guide/performance-baselines/perf-position-worker-transfer-2026-10-23.json)
- [Final uninstrumented control](../../guide/performance-baselines/perf-position-worker-uninstrumented-2026-10-23.json)

The [complete Chinese report](../../guide/benchmark.md) includes all three-trial percentiles and pressure rows. Raw evidence retains environment, source hashes, events, stages, queues and correctness results. Intermediate/failed runs, traces, screenshots and disposable build logs are excluded from version control.


## 2026-10-30: experimental IME preview

The same-revision comparison covers five documents, baseline/sync profiles,
preview off/on and three trials: 60 cases/420 preedit updates, plus a separate
uninstrumented control with 12 cases/84 updates. Environment: M1 Pro, 16 GiB,
Darwin 25.4.0, Node 24.22.1, Chrome 156.0.8078.76, fixed Latin/CJK fonts, DPR 1.
These are synthetic, untrusted events. The browser requests a 33ms timer interval;
blocking increases actual spacing, so this is not a fixed-rate external input test.
Only seven updates per trial means P95 equals the maximum in each trial.

For 1000 short paragraphs under baseline, handler P95 ranges changed from
206.1–308.7ms to 0.1–0.2ms, and geometry-completion proxy P95 from
206.0–308.7ms to 12.8–18.0ms. Under sync, the geometry proxy changed from
19.6–21.3ms to 9.4–9.8ms. Preedit whole-document geometry calls fell from
seven to zero per trial in supported simple single-line paragraphs.

Short cases incur frame waiting: sync geometry proxy rose from 2.9–3.5ms to
12.8–17.8ms. Long paragraphs and tables retain the synchronous fallback, with
seven full computations per trial; these paths retain layout costs and can add frame waiting.
A small handler alone does not prove smoother presentation. Final commits and
history restoration retain layout costs. Geometry and next-rAF timings are
proxies, not actual pixel presentation. Whole-session frame gaps also contain
final commit/history work; filter raw frames by composition boundaries for preedit analysis.

All 12 pixel comparisons matched the synchronous reference, including glyphs
and composition underlines. Full quality/build checks passed 172 files/1089 tests;
final boundary checks passed another six targeted files/28 tests, followed by 15 tests after the consecutive-session fix. Real OS IME,
candidate-window placement and presentation remain pending. `imePreview` stays
opt-in and is not enabled by profiles. Historical October 23 hashes remain unchanged.

See the [complete Chinese results](../../guide/benchmark.md),
[three-trial evidence](../../guide/performance-baselines/ime-2026-10-30.json),
[uninstrumented control](../../guide/performance-baselines/ime-uninstrumented-2026-10-30.json),
and [IME tasks and reproduction](../../guide/ime-performance-tasks.md).

Filtering rAF callbacks to composition boundaries, thousand-paragraph frame-gap P95 ranges changed from 205.4–229.3ms to 17.3–17.5ms under baseline and from 25.0–29.7ms to 16.9–17.5ms under sync. These are callback-cadence observations, not actual display FPS or OS IME measurements.


## IME-07 derived work

The 2026-10-30 deterministic regression uses 50 paragraphs and three consumed
preedits (`n`, `ni`, `nih`). Coverage collector input drops from 1062 elements
to 27 (97.5%) with `imePreview` enabled. Search/control highlight rebuilds and
tool refreshes are deferred until completion or a public query/export barrier.
Composition accessibility feedback retains live-region updates without reading
`offsetHeight`. Missing-glyph download checks remain local; font arrivals and
final/query barriers refresh complete reports. These are work counts, not new
latency or FPS measurements. The IME-01–06 timing files retain their historical
source hashes. Actual screen-reader and OS IME behavior still needs manual testing.
See the [Chinese work-count report](../../guide/benchmark.md#ime-07-派生工作专项).


## IME-08 anchor geometry

The composition textarea and visible caret now share current HarfBuzz caret
geometry, page offsets and height. Placement is coalesced before paint; ancestor
scroll-port reads precede style/scroll writes. Native composition text, selection
and focus remain owned by the IME. Zoom commands retain the active session.
Chrome checks cover DPR 1/2, local preview, pagination, RTL and tables, including
nested scrolling, editor zoom and CSS transforms. These are DOM geometry checks,
not OS candidate-window or FPS measurements. Real IME recordings remain pending.
See the [IME-08 implementation and manual procedure](../../guide/ime-performance-tasks.md#ime-08-光标、候选窗锚点与滚动同步).


## IME-09 composition closure

November 2, 2026: final synchronous callbacks now follow history commit and old
session cleanup. Cancellation restores complex content, selection and typing
style without altering prior history. Safe text replacement history retains
only original and final fragments, while mirrors still receive every committed
revision. Async export includes graffiti and owns its request-time snapshot.
The semantic browser matrix covers baseline/sync/worker, five document shapes,
worker-denied fallback and a delayed real Worker layout response. Tables retain
synchronous layout. These are synthetic correctness checks, not new latency/FPS
measurements or real OS IME acceptance. Historical timing evidence is unchanged.
See [IME-09](../../guide/ime-performance-tasks.md#ime-09-最终提交、取消、历史与查询闭环).


## IME-10 range flow commits

November 2, 2026: same-code comparison switches only `incrementalCommit`, retaining
all earlier sync-profile optimizations. Three trials × 20 samples give 60 samples
per mode/scenario. Thousand-paragraph synchronous final-commit P95 changed from
17.2→14.7ms without wrapping, 225.0→42.2ms with added wrapping, and 272.5→144.4ms
with added pages. Nonwrapping max did not improve (22.9→23.2ms).

Cached-break re-placement removes 499 repeated paragraph callbacks in the two
reflow cases. Their position stage gets slower (P95 15.8→27.5ms and 16.5→36.3ms),
even though total commit time drops substantially. Existing geometry/run/query
reuse is not credited as new work. Directory, page assembly and full position
snapshot costs remain global. These are core compositionend timings, excluding
DOM dispatch and later paint/notifications; they are not actual presentation or
OS IME FPS. All slow samples of the final three-trial implementation are retained
as summaries/traces. Historical timing evidence remains unchanged.

See [full methodology, limitations and work counts](../../guide/benchmark.md),
[baseline/optimized summary and source hashes](../../guide/performance-baselines/ime-flow-2026-11-02.json),
and [implementation/reproduction](../../guide/ime-performance-tasks.md).

## IME-11 long-paragraph preview windows

November 2, 2026: same-code `imeWindowPreview` comparison, three alternating trials,
105 updates per mode/scenario. P95 was 83.2→2.1ms for the final row of a 3506-element
CJK/Latin paragraph, 223.8→6.4ms for an 8056-element Latin paragraph, and
84.5→76.2ms for a middle-row replacement. The middle case retains 45/105 full-layout
fallbacks; its P95 benefit is only 9.8%. Max values are respectively 98.9→3.9ms,
309.6→17.8ms and 102.9→89.5ms.

The successful final-row windows layout two rows, skipping 57/115 other rows.
Separate profiling records scanning, shaping/cache projection, breaking, native
measurement and geometry-item counts. Warm CJK runs already have no HarfBuzz
misses in either mode; the benefit is less scanning, cache projection and geometry
creation. Object counters cover named allocation sites, not total heap bytes.
Window creation can still scan the full paragraph. Final commits remain formal
layout, and changes to wrapping still fall back.

These are synchronous input + explicit preedit-flush timings from a Vite
development fixture, including synchronous paint but excluding scheduled later
paint, DOM dispatch and presentation. Chrome headless software rendering is fixed
for 35 exact pixel/caret comparisons, including combining marks, ZWJ emoji missing
boxes and actual-font Arabic fallback. Minor placeholder antialiasing differences
were observed with the default GPU backend; GPU, real OS IME and cross-browser
acceptance remain pending. These results are not measured IME FPS.

See [methodology, stage costs and limitations](../../guide/benchmark.md) and
[retained baseline/optimized summaries and hashes](../../guide/performance-baselines/ime-long-2026-11-02.json).

## IME-12/13 tables and Worker composition

November 2, 2026: same-code comparisons, three alternating trials, 720 measured
updates in a fixed-font Vite development fixture with Chrome headless software
rendering. Table modes switch only `imeTableLayout`; body modes both use the
worker preset and switch only `imeWorkerPreview`.

For a stable 24×4 table, child-layout callbacks drop 96→1 and grid rows solved
24→0. Geometry P95 is 6.8→4.7ms. With merged-cell growth/shrink, callbacks drop
94→1 while an average 16 rows still require solving; geometry P95 is
10.2→8.9ms. Aggregate tails improve, but two stable-table trials get slightly
slower P95, and growth max is 10.3→10.6ms. Signature checks, positions and page
assembly can remain global. These counters are not HarfBuzz calls or heap bytes.

Worker preview lowers handler P95, short line 1.3→0.6ms and wide-line stress
9.1→1.7ms, but geometry P95 worsens 1.5→4.1ms and 9.1→13.9ms. Wide-line next-rAF
P95 worsens 17.2→23.0ms. Both modes have zero observed long tasks in the measured
intervals, so no long-task reduction is demonstrated. Post-cancel synchronization
P95 is ≤0.1ms after already waiting for each preview; this does not describe a
hung Worker's drain time. **Keep `imeWorkerPreview` disabled by default.**

59 pixel/geometry/caret comparisons, five Worker recovery boundaries and two
input bursts pass, including merged/nested/paged/repeated-header/RTL tables.
The wide rapid-input burst reaches the deadline and safely switches to sync.
Existing extreme nested overflow/caret limits remain; real OS IME candidate
windows, GPU presentation and cross-browser release acceptance are pending.
These are synthetic core/next-rAF measurements, not presented FPS.

See [full distributions, work counts and the enablement decision](../../guide/benchmark.md),
[retained evidence and hashes](../../guide/performance-baselines/ime-table-worker-2026-11-02.json),
and [implementation/reproduction](../../guide/ime-performance-tasks.md).

## IME-14 acceptance gate and cache capacity

November 3, 2026: over-capacity scans now protect hot cells from the current and
previous layout pass. Failed admissions leave them intact; idle old documents
can be reclaimed. A real 600-cell fixture reuses 512 cells and computes 88, while
reusing 150 grid rows. Input checks still touch 2400 elements; this is not O(1).

The unified acceptance command serializes quality/build/package checks,
Chrome/Firefox/WebKit correctness and three-trial timing. Pixel checks compare
decoded RGBA rather than PNG encoding; cancellation checks drain older history
notifications. Unsupported long-task APIs remain unavailable, never zero.
Source fingerprints, required phases and handler/geometry budgets are checked
separately from native OS IME evidence. Missing/unmet requirements keep hold and
do not enable experimental features.

The user confirmed no native records are available. Real macOS/Windows candidate
windows, visible refresh and mobile acceptance therefore remain pending.
See [the final aggregate and release decision](../../guide/performance-baselines/ime-release-2026-11-03.json)
and [evidence/reproduction instructions](../../guide/ime-performance-tasks.md).

### Final automated results

Fresh rerun on November 3, 2026, replacing the previous same-day aggregate without selecting fastest trials.
Window: 2026-11-03T06:00:30.016Z → 2026-11-03T06:17:05.590Z (includes quality/correctness).
Apple M1 Pro / 16 GiB, Darwin 25.4.0, Node 24.22.1; Chrome 156.0.8078.76, Firefox 153.0, WebKit 26.5.
WebKit means the Playwright runtime, not a Safari product version. All seven quality stages passed,
including **179 files / 1169 tests**, app/library/docs builds and offline package consumption.
All 21 correctness stages passed; source/font/tool/ESLint fingerprints remained unchanged:
`ce13864e57d7e97cfe76965ef92d00dbd530be73685f557e8637b62968f1474a`.

Each mode/scenario has three alternating, warmed trials at 1366×720, DPR 1. Ordinary scenes
have 21 inputs each; large has 63. The sequence is `n → ni → nih → niha → nihao → niha → nihao`,
final text `你好`. 33ms is a requested interval; blocking can stretch actual delivery. Stage timing
is disabled while event/session/rAF sampling remains. These are synthetic, headless measurements.
Firefox's optimized small table merges one of 21 inputs, producing 20 geometry samples;
merged input is not counted as displayed or removed from the input denominator.

Short is one `中文 abcdef` paragraph; 100/1000 edit the document middle; long repeats
`中文 abcdef ` 300 times and edits near its beginning, unlike IME-11 final-row windows.
Table is one text cell; large is 150×4 cells edited in the last cell.

P95 in ms, pooled across three trials. For ordinary scenes baseline→sync combines several changes;
large holds sync constant and compares cell cache off→on, not the old LRU. Geometry is consumption
latency and next rAF observes the callback after consumption; neither is actual presentation FPS.

| Browser | Scenario | Handler | Geometry | Next rAF |
| --- | --- | ---: | ---: | ---: |
| Chrome | short | 3.2→0.1 | 3.2→17.0 | 15.2→32.4 |
| Chrome | 100 | 23.7→0.1 | 23.7→17.7 | 24.2→33.2 |
| Chrome | 1000 | 222.9→0.1 | 222.9→16.9 | 224.0→33.2 |
| Chrome | long | 83.1→0.1 | 83.1→79.7 | 83.5→82.5 |
| Chrome | table | 3.7→0.1 | 3.7→18.0 | 16.1→32.4 |
| Chrome | large | 54.5→31.1 | 54.8→31.3 | 61.3→32.5 |
| Firefox | short | 5.0→0.0 | 5.0→9.0 | 8.0→15.0 |
| Firefox | 100 | 44.0→0.0 | 44.0→9.0 | 44.0→16.0 |
| Firefox | 1000 | 474.0→0.0 | 474.0→40.0 | 474.0→41.0 |
| Firefox | long | 285.0→0.0 | 285.0→133.0 | 285.0→141.0 |
| Firefox | table | 7.0→0.0 | 7.0→14.0 | 11.0→17.0 |
| Firefox | large | 103.0→90.0 | 103.0→90.0 | 107.0→93.0 |
| WebKit | short | 3.0→0.0 | 3.0→14.0 | 15.0→30.0 |
| WebKit | 100 | 32.0→0.0 | 32.0→10.0 | 34.0→26.0 |
| WebKit | 1000 | 226.0→0.0 | 226.0→17.0 | 241.0→32.0 |
| WebKit | long | 77.0→0.0 | 77.0→85.0 | 80.0→90.0 |
| WebKit | table | 3.0→0.0 | 3.0→16.0 | 15.0→31.0 |
| WebKit | large | 46.0→37.0 | 46.0→37.0 | 51.0→41.0 |

1000-paragraph geometry P95 improved by 92.4%/91.6%/92.5%.
Frame waiting can regress short-text/small-table geometry despite shorter handlers. Timer resolution
can produce 0ms values without zero computation. Long-paragraph and table checks must be assessed
against the original 8ms handler / 32ms geometry budgets, not only relative speedup.

All three large-table runs retain 512 cells, compute 88, reuse 150 grid rows and evict none.
They still check 600 cells/2400 elements; estimated cache size is 2878464 bytes, not actual heap.
Large-table geometry P95 reductions are 42.9%/12.6%/19.6%.

<details>
<summary>Full distributions: P50 / P95 / P99 / max in ms</summary>

| Browser | Scenario | Mode | Handler | Geometry | Next rAF |
| --- | --- | --- | ---: | ---: | ---: |
| Chrome | short | baseline | 1.4 / 3.2 / 3.4 / 3.4 | 1.4 / 3.2 / 3.4 / 3.4 | 8.9 / 15.2 / 16.1 / 16.1 |
| Chrome | short | sync preview | 0.0 / 0.1 / 0.2 / 0.2 | 14.3 / 17.0 / 17.4 / 17.4 | 29.7 / 32.4 / 33.1 / 33.1 |
| Chrome | 100 | baseline | 21.6 / 23.7 / 25.5 / 25.5 | 21.6 / 23.7 / 25.5 / 25.5 | 22.0 / 24.2 / 25.7 / 25.7 |
| Chrome | 100 | sync preview | 0.0 / 0.1 / 0.1 / 0.1 | 7.7 / 17.7 / 17.8 / 17.8 | 23.0 / 33.2 / 33.5 / 33.5 |
| Chrome | 1000 | baseline | 198.9 / 222.9 / 242.6 / 242.6 | 198.8 / 222.9 / 242.6 / 242.6 | 199.2 / 224.0 / 246.9 / 246.9 |
| Chrome | 1000 | sync preview | 0.0 / 0.1 / 0.1 / 0.1 | 7.6 / 16.9 / 21.4 / 21.4 | 23.0 / 33.2 / 36.2 / 36.2 |
| Chrome | long | baseline | 69.3 / 83.1 / 90.1 / 90.1 | 69.3 / 83.1 / 90.1 / 90.1 | 69.7 / 83.5 / 90.5 / 90.5 |
| Chrome | long | sync preview | 0.0 / 0.1 / 0.1 / 0.1 | 66.3 / 79.7 / 104.8 / 104.8 | 69.2 / 82.5 / 118.0 / 118.0 |
| Chrome | table | baseline | 1.8 / 3.7 / 4.0 / 4.0 | 1.7 / 3.7 / 4.0 / 4.0 | 12.3 / 16.1 / 16.2 / 16.2 |
| Chrome | table | sync preview | 0.0 / 0.1 / 0.1 / 0.1 | 16.5 / 18.0 / 18.1 / 18.1 | 30.8 / 32.4 / 32.6 / 32.6 |
| Chrome | large | cache off | 42.8 / 54.5 / 95.0 / 95.0 | 43.1 / 54.8 / 101.0 / 101.0 | 44.7 / 61.3 / 106.4 / 106.4 |
| Chrome | large | cache on | 24.1 / 31.1 / 91.8 / 91.8 | 24.3 / 31.3 / 94.1 / 94.1 | 25.9 / 32.5 / 95.7 / 95.7 |
| Firefox | short | baseline | 3.0 / 5.0 / 6.0 / 6.0 | 3.0 / 5.0 / 6.0 / 6.0 | 5.0 / 8.0 / 9.0 / 9.0 |
| Firefox | short | sync preview | 0.0 / 0.0 / 1.0 / 1.0 | 5.0 / 9.0 / 10.0 / 10.0 | 13.0 / 15.0 / 15.0 / 15.0 |
| Firefox | 100 | baseline | 38.0 / 44.0 / 52.0 / 52.0 | 38.0 / 44.0 / 52.0 / 52.0 | 39.0 / 44.0 / 52.0 / 52.0 |
| Firefox | 100 | sync preview | 0.0 / 0.0 / 0.0 / 0.0 | 6.0 / 9.0 / 11.0 / 11.0 | 12.0 / 16.0 / 18.0 / 18.0 |
| Firefox | 1000 | baseline | 375.0 / 474.0 / 483.0 / 483.0 | 375.0 / 474.0 / 483.0 / 483.0 | 376.0 / 474.0 / 483.0 / 483.0 |
| Firefox | 1000 | sync preview | 0.0 / 0.0 / 0.0 / 0.0 | 7.0 / 40.0 / 46.0 / 46.0 | 13.0 / 41.0 / 46.0 / 46.0 |
| Firefox | long | baseline | 151.0 / 285.0 / 322.0 / 322.0 | 151.0 / 285.0 / 322.0 / 322.0 | 152.0 / 285.0 / 323.0 / 323.0 |
| Firefox | long | sync preview | 0.0 / 0.0 / 1.0 / 1.0 | 104.0 / 133.0 / 138.0 / 138.0 | 112.0 / 141.0 / 145.0 / 145.0 |
| Firefox | table | baseline | 2.0 / 7.0 / 61.0 / 61.0 | 2.0 / 7.0 / 61.0 / 61.0 | 4.0 / 11.0 / 62.0 / 62.0 |
| Firefox | table | sync preview | 0.0 / 0.0 / 0.0 / 0.0 | 7.0 / 14.0 / 21.0 / 21.0 | 13.0 / 17.0 / 25.0 / 25.0 |
| Firefox | large | cache off | 63.0 / 103.0 / 237.0 / 237.0 | 63.0 / 103.0 / 237.0 / 237.0 | 66.0 / 107.0 / 239.0 / 239.0 |
| Firefox | large | cache on | 47.0 / 90.0 / 111.0 / 111.0 | 48.0 / 90.0 / 111.0 / 111.0 | 50.0 / 93.0 / 125.0 / 125.0 |
| WebKit | short | baseline | 2.0 / 3.0 / 3.0 / 3.0 | 2.0 / 3.0 / 3.0 / 3.0 | 9.0 / 15.0 / 16.0 / 16.0 |
| WebKit | short | sync preview | 0.0 / 0.0 / 1.0 / 1.0 | 12.0 / 14.0 / 14.0 / 14.0 | 27.0 / 30.0 / 30.0 / 30.0 |
| WebKit | 100 | baseline | 25.0 / 32.0 / 35.0 / 35.0 | 25.0 / 32.0 / 35.0 / 35.0 | 25.0 / 34.0 / 35.0 / 35.0 |
| WebKit | 100 | sync preview | 0.0 / 0.0 / 0.0 / 0.0 | 6.0 / 10.0 / 11.0 / 11.0 | 21.0 / 26.0 / 26.0 / 26.0 |
| WebKit | 1000 | baseline | 203.0 / 226.0 / 228.0 / 228.0 | 203.0 / 226.0 / 228.0 / 228.0 | 206.0 / 241.0 / 243.0 / 243.0 |
| WebKit | 1000 | sync preview | 0.0 / 0.0 / 1.0 / 1.0 | 11.0 / 17.0 / 18.0 / 18.0 | 26.0 / 32.0 / 33.0 / 33.0 |
| WebKit | long | baseline | 69.0 / 77.0 / 81.0 / 81.0 | 69.0 / 77.0 / 81.0 / 81.0 | 70.0 / 80.0 / 83.0 / 83.0 |
| WebKit | long | sync preview | 0.0 / 0.0 / 0.0 / 0.0 | 74.0 / 85.0 / 95.0 / 95.0 | 79.0 / 90.0 / 101.0 / 101.0 |
| WebKit | table | baseline | 2.0 / 3.0 / 3.0 / 3.0 | 2.0 / 3.0 / 3.0 / 3.0 | 9.0 / 15.0 / 16.0 / 16.0 |
| WebKit | table | sync preview | 0.0 / 0.0 / 0.0 / 0.0 | 12.0 / 16.0 / 16.0 / 16.0 | 27.0 / 31.0 / 35.0 / 35.0 |
| WebKit | large | cache off | 35.0 / 46.0 / 66.0 / 66.0 | 35.0 / 46.0 / 66.0 / 66.0 | 37.0 / 51.0 / 69.0 / 69.0 |
| WebKit | large | cache on | 23.0 / 37.0 / 65.0 / 65.0 | 24.0 / 37.0 / 65.0 / 65.0 | 26.0 / 41.0 / 67.0 / 67.0 |

</details>

Per-trial P95 with seven samples equals the maximum; pooled P99 with 21 samples also equals max.
These limited samples do not establish stable production tails. The JSON retains each trial, merged/
submitted/finalized counts, variability and long tasks. Finalized counts pending updates handled at end,
not final selections. Long tasks/frame gaps include commit/history; unsupported APIs are unavailable, not zero.

**Decision: completed / hold**. 7 performance budget entries failed:
chromium:long, chromium:large, firefox:1000, firefox:long, firefox:large, webkit:long, webkit:large.
Native macOS/Windows IME evidence remains pending, mobile is uncovered, and both preview flags stay false.
Synthetic results do not replace manual evidence or prove long-term memory stability.

Prioritize long-paragraph fallback/full layout and large-table checking/remaining child layout/commit;
evaluate frame waiting versus direct synchronous updates for short text and small tables.
See [performance principles](performance-principles.md), the [full Chinese result and reproduction command](../../guide/benchmark.md#本轮最终自动验收结果)
and [retained baseline/optimized JSON](../../guide/performance-baselines/ime-release-2026-11-03.json).

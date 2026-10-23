# Benchmark: typing and sustained deletion

Updated 2026-10-23. These results cover the original baseline, the preceding optimization and the final position/query reuse and Worker recovery fixes. All optimized results use explicit experimental configuration; the default remains `baseline`. See [configuration and fallback](lab.md).

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

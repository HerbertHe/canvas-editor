# Lab

See [performance principles](performance-principles.md) for mechanisms/limits and
[Benchmark](benchmark.md) for baseline comparisons and the latest measurements.

Experimental options live under `lab` and are disabled by default. All text uses
HarfBuzz; enabling an experimental option never selects a different engine.

```typescript
const editor = await Editor.create(container, data, {
  lab: { performanceProfile: 'sync' }
})
```

## Performance rollout profiles

Profiles are constructor presets; explicit switches override them. Recreate an
editor with `baseline` and remove explicit opt-ins to return to the control path.

| Profile | Behavior | Rollout |
| --- | --- | --- |
| `baseline` | Existing synchronous behavior, experimental optimizations off | Default |
| `sync` | Path/run caches, tracked edits/history/coverage, range flow commits, cached-break re-placement, row-block position/query reuse, dirty pages and deferred painting | Application opt-in after validation |
| `worker` | `sync` plus asynchronous simple-body text layout | Experimental |

No preset enables `workerTransfer` or `incrementalCompute`. The 8ms main-thread
and 32ms visible-update goals have not been met across the target workloads.
Defaults remain unchanged. `lab: { performanceProfile: 'worker', layoutWorker:
false }` retains that preset's synchronous optimizations while disabling layout
offloading.

Worker layout supports simple single-column paginated body text, at most 2048
paragraphs and 2048 UTF-16 units in the dirty paragraph batch. Complex objects,
tables, floats, composition, print and unsupported constraints use synchronous
layout. Visual deletion, navigation, pointer input and geometry-dependent public
commands flush current geometry. A pending commit schedules synchronous recovery
after 100ms to prevent continuous input from starving commits. Busy main threads
and layout cost can exceed that interval; it is not a presentation guarantee.
Backspace/Delete commit synchronous incremental geometry and coalesce painting,
avoiding asynchronous layouts that the next visual deletion would invalidate.
Mirror edits are acknowledged in ordered batches. Queue pressure or failures
schedule an idle resynchronization; draining also triggers recovery.

## Diagnostics and fallback

```typescript
const diagnostics = editor.getPerformanceDiagnostics()
console.log(diagnostics.worker.fallbackReasons)
console.log(diagnostics.worker.requests, diagnostics.worker.queuedBytes)
```

The API returns a detached snapshot, including before readiness and after
destruction. It contains configuration, worker readiness/queues/counters,
fallback reasons, cache counters and observed-page counts; no document text or
font binaries. `deadline` denotes commit recovery; `size`, `scope` and
`composition` denote unsupported work; `unavailable` and `error` denote backend
or revision/font failures. Counts do not prove performance acceptance.
`placements` counts computed/reused position elements. `worker.bufferedEdits`
and `worker.counters.editBatches/batchedEdits/maxBufferedEdits` distinguish
buffered transactions from transport requests. See the [current architecture](architecture.md) and [benchmark](benchmark.md).

When workers are unavailable or blocked by CSP, layout stays synchronous and
utility requests (word count, catalog, groups and serialization) run the same
pure functions against owned request snapshots. Their APIs still return promises
and `utilityWorkers` reports fallbacks. This may be slower.
Request snapshots are cloned before posting so asynchronous failures can recover
the original request data; uncached large queries incur an additional clone.
WebAssembly/font initialization failures retain the existing error contracts and never select a
browser text engine. Real system IME, presentation latency and long-term native
memory still require release evidence.

See the [current benchmark](benchmark.md).

## incrementalCompute: native paragraph reuse

The edited paragraph is recomputed in full because BiDi/contextual shaping may
affect its whole content. Unchanged paragraphs can reuse native results with
relative source indices, rebased glyphs, clusters, carets and object anchors.
Table cells have separate scopes; list numbering is regenerated from current data.

With only `incrementalCompute` enabled, every pass still scans content and recomputes flow, pagination, columns, floats,
table fragments and positions. It does not reuse old row objects, resume
snapshots or partial page-position slices. Editing a single very long paragraph
still requires full paragraph layout; no 1–3-row convergence or order-of-magnitude
speedup is promised.

Cache keys include content/styles, source identity, font revision, spacing,
available width and per-line flow constraints. Changed inputs invalidate reuse;
field writes, history restoration and font registration cause appropriate full
invalidation. Cache misses or disabling the option use full HarfBuzz layout.
There is no browser/legacy fallback. T23/T24 are complete; the [acceptance record](../../guide/native-release-acceptance.md) documents consistency and measured costs. Incremental mode is not necessarily faster.

Internal contributors should mutate through spliceElementList/deleteElementList
and setElementProperty/deleteElementProperty so dirty ranges and invalidation
remain accurate. External integrations should use public commands rather than
internal Draw objects or snapshot structures.


## Experimental IME preview

Opt in with `lab: { performanceProfile: 'sync', imePreview: true }`.
`imePreview` defaults to false and is independent of profiles and paragraph caching.
It consumes the latest preedit state once per frame. Supported simple LTR body
paragraphs use a temporary HarfBuzz line when line count, height and baseline remain
unchanged; final text is committed when composition ends. The sync/worker presets
also enable `imeWindowPreview`: long paragraphs re-layout at most three rows and
2048 elements, accepting a replacement only when surrounding breaks and native
paint/caret geometry converge. Set it explicitly to false for rollback; baseline
leaves it off. Existing pages may be reused, but changes to wrapping/pagination,
controls, complex directions and decorations retain a
frame-coalesced synchronous fallback.
Tables keep synchronous model updates with the cell cache described below.

The window requires a uniform metric style, safe word/grapheme boundaries and
LTR flow. Arabic, BiDi, font changes and justification retain full layout.
Window creation scans the paragraph; final commits still use formal layout.
`composition.previewWork.skippedLines` counts lines not laid out in the temporary
window. `reusedLines` also includes validated neighbour rows whose temporary
geometry is discarded. These are distinct from shaping-cache hits.

Public content/geometry queries materialize the current preedit and switch the
remaining session to the conservative path. Public commands finish composition.
Cancellation restores the original content; final edits support undo.
Native candidate-window blur without a DOM focus destination does not force a
commit. Real OS IME, candidate placement and presentation validation remain pending.

The demo accepts `?performance=sync&paragraphCache=off&imePreview=on` on reload.
See the [Chinese implementation tasks and QA instructions](../../guide/ime-performance-tasks.md).


`lab.incrementalCommit` is enabled by the sync/worker presets and disabled by
baseline. It needs incremental editing/flow. Set it explicitly to false for the
previous per-paragraph/per-element commit path while retaining earlier caches.
Exact flow ranges are validated before reuse. Unchanged text can re-place cached
breaks only while every line interval keeps its width. Changed widths, fonts,
styles and unsupported objects retain layout fallbacks. Small geometry changes
use lazy row-position blocks; broad changes use ordinary arrays and safe metric
reuse. Diagnostic position snapshots remain ordinary arrays. Directory, object
classification and coverage work may still be global; editing is not constant time.
See the [IME-10 measurements](../../guide/benchmark.md).

## Table composition and experimental Worker previews

With `imePreview` enabled, sync/worker presets enable `imeTableLayout`; baseline
leaves it off. Unchanged safe text cells reuse canonical rows, and unchanged
content heights reuse grid geometry. Changed heights re-solve table row heights
and propagate through spans/pagination while reusing other cell contents.
Nested containers still recurse into their leaves. Width/font/style dependencies
invalidate the cache, bounded to 512 entries and an estimated 16 MiB.
Set `imeTableLayout: false` to roll back independently. Table signatures, position
commits and page assembly may still scan the whole table. Existing extreme nested
overflow/caret limitations are not extended by this optimization.
Over-capacity scans protect current/previous-pass hot cells and skip admission
instead of evicting cells needed later in the same scan. Idle entries can be
reclaimed after a complete pass without access. `tables.entries`, `admissionSkips`
and `evictions` expose the bounded-cache behavior.

`tables.computedCells` counts child-layout callbacks, not HarfBuzz calls.
`computedRows`/`reusedRows` distinguish grid solving from reuse; `inputElements`
counts inputs presented to checks, not actual allocations or unique visits.

`imeWorkerPreview` defaults to **false in every preset**. Explicit experiments use
`lab: { performanceProfile: 'worker', imePreview: true, imeWorkerPreview: true }`.
Only supported body previews move to the Worker; tables remain synchronous.
Transient text never enters its formal mirror. One active and one latest waiting
layout are bounded; session/sequence, model/font/constraint and geometry versions
are checked before painting or moving the candidate anchor. Queries and final
commits remain synchronous barriers. Failure or the 50ms scheduling deadline
materializes the latest input and switches the session to synchronous layout.
Active Worker computation drains separately; this is not a hard real-time bound.
Transfer is not enabled automatically.

`composition.previewWorker.submitted` counts client calls; `stale` also includes
waiting updates merged before posting. Current measurements show shorter handlers
but slower geometry completion, with no measured long-task reduction. Keep the
default synchronous preview. See [the measurements and limits](../../guide/benchmark.md).

IME-14 adds `npm run test:performance:ime:release`: browser correctness, three-trial
timing, build/package checks and native IME evidence are separate gates. Changed
sources, unmet budgets or missing evidence produce hold (exit 2), never automatic
feature enablement. Native macOS/Windows/mobile evidence is currently unavailable;
OS candidate windows and actual visible refresh remain pending. See
[the implementation and evidence format](../../guide/ime-performance-tasks.md).

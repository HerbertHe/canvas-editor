# Lab

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
| `sync` | Path/run caches, tracked edits/history/coverage, incremental flow, prefix and unchanged-line position/query reuse, dirty pages and deferred painting | Application opt-in after validation |
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

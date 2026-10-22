# Engineering records and acceptance

Use [quick start](./start.md), [current architecture](./architecture.md), [rendering pipeline](./rendering-pipeline.md) and API references for integration. Staged designs below preserve provenance and may describe incomplete states at the time they were written; they are not the current API contract.

## Current conclusions

T1–T24 legacy removal and HarfBuzz-only migration are complete. Final T23/T24 regression finished on 2026-10-22. Canvas-only pages and ESM-only distribution are current constraints. Native incremental layout still has significant costs; passing regression does not close unresolved performance work.

Original acceptance evidence is maintained in Chinese:

- [Final acceptance](../../guide/native-release-acceptance.md): environment, package consumption, browsers, memory and performance.
- [Native regression](../../guide/native-regression.md): test entry points and coverage.
- [Task plan](../../guide/legacy-removal-tasks.md), [removal design](../../guide/legacy-removal-plan.md) and [historical baseline](../../guide/legacy-removal-baseline.md).

## Implementation records

These original staged records are in Chinese unless an English page exists.

- [Shaping](../../guide/harfbuzz-shaping.md), [glyph painting](../../guide/harfbuzz-glyph-rendering.md), [layout protocol](../../guide/layout-protocol.md), [geometry](../../guide/layout-geometry.md).
- [Font resolution](../../guide/font-resolver.md), [coverage](../../guide/font-coverage.md), [downloads](../../guide/font-download.md), [Bunny](../../guide/bunny-font-provider.md), [readiness](../../guide/editor-ready.md).
- Chinese native-model records: [paragraphs](../../guide/native-paragraph-layout.md), [objects](../../guide/native-object-layout.md), [tables](../../guide/native-table-layout.md), [document flow](../../guide/native-document-flow.md), [page chrome](../../guide/native-chrome-layout.md), [auxiliary text](../../guide/native-auxiliary-layout.md), [interaction](../../guide/native-interaction-geometry.md), [model separation](../../guide/native-model-separation.md), [incremental layout](../../guide/native-incremental-layout.md) and [sole engine](../../guide/native-only-engine.md).
- [Public API migration](../../guide/public-api-migration.md), [RTL design](./rtl-layout-design.md), [RTL follow-ups](./rtl-deferred-todo.md) and [main integration](../../guide/main-integration-2026-10-16.md).

## Deferred SVG design

The [HarfBuzz-to-SVG assessment](../../guide/harfbuzz-svg-assessment.md) is a future proposal. SVG-01 through SVG-12 have not started. Use Canvas today; diagrams in a proposal do not introduce a supported renderer option.

## Maintaining documentation

Keep primary Chinese/English guides aligned. Original Chinese measurements remain engineering evidence with explicit links from English. Update current guides with implementation changes, but do not rewrite historical measurements or baseline commits to match the present. Mermaid syntax is checked at build time and diagrams render in the browser. See [deployment](./docs-deployment.md).

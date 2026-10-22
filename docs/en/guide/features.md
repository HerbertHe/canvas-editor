# Supported features and boundaries

This independent fork retains the document capabilities described below. Consult [options](./option.md) and command references for exact fields, and [upstream differences](./fork-and-differences.md) to distinguish inherited features from the new typography pipeline.

| Area           | Available                                                                                                             | Boundary                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Typography     | HarfBuzz shaping, BiDi, complex scripts, actual face coverage and outlines                                            | Not all scripts, styles or emoji are fully validated; font bytes are required |
| Rich text      | Font/size, bold/italic, colors, highlights, scripts, decorations, headings, alignment, lists, indentation and spacing | Real style faces and metrics affect layout                                    |
| Pages          | Paginated/continuous modes, margins, columns, header/footer, numbers, borders and watermarks                          | Canvas pages only; DOM tools still exist                                      |
| Tables         | Row/column changes, merged cells, borders, backgrounds, alignment and page fragments                                  | Validate complex business tables                                              |
| Objects        | Images, floating images, links, formulas, dates, tabs, page breaks and blocks                                         | Loading, CORS and export constraints apply                                    |
| Form controls  | Text, numbers, select, radio, checkbox, date, nesting, disabling, cascades and validation                             | Application supplies tool UI; see control APIs                                |
| Interaction    | Selection, caret, undo/redo, search/replace, shortcuts, menus and drag/drop                                           | UI direction and content direction are distinct                               |
| Document tools | Comments, traces, areas, outline, macros, localization and modes                                                      | Verify external plugins individually                                          |
| Fonts          | TTF/OTF/WOFF/WOFF2, reports/events and automatic Bunny basic fonts                                                    | Enabled by default; offline/manual support, not full Unicode coverage         |
| Export/print   | JSON, HTML/text queries, Canvas PNG pages and browser image printing                                                  | No standalone SVG or native vector PDF guarantee                              |
| Distribution   | Root ESM exports, TypeScript declarations and async readiness                                                         | No UMD, require or internal deep imports                                      |

## Performance and experimental options

`lab.incrementalCompute` defaults to false and reuses clean paragraphs, while flow, pagination and positions still run. It is not a general partial-pixel update optimization. T23/T24 regression is complete, but performance work remains and incremental mode is not necessarily faster. See [lab options](./lab.md) and [acceptance](../../guide/native-release-acceptance.md).

## Deferred or unavailable

SVG pages and standalone SVG export remain deferred; the [assessment](../../guide/harfbuzz-svg-assessment.md) is a future design. There is no engine selector or legacy fallback. The package does not provide a backend server, collaborative CRDT or native Word/PDF layout engine, and it does not automatically install upstream plugins. Historical plans and future designs are not current public APIs.

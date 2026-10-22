# Document model

Persist business content as `IEditorData`, not glyphs, page coordinates or internal row objects. Runtime elements and native geometry are derived layers; see [architecture](./architecture.md). All types/enums in this page are public root exports.

## Document, elements and paragraphs

```typescript
import { RowFlex, TextDirection, ElementType } from '@herberthe/canvas-editor'
import type { IEditorData } from '@herberthe/canvas-editor'

const data: IEditorData = {
  header: [{ value: 'Weekend plans', rowFlex: RowFlex.CENTER }],
  main: [
    { value: 'Shopping list', bold: true, spacingAfter: 8 },
    { value: '\n' },
    { value: 'مرحبا بالعائلة', direction: TextDirection.RTL },
    { value: '\n' },
    {
      type: ElementType.HYPERLINK,
      value: '',
      url: 'https://example.com',
      valueList: [{ value: 'Community calendar' }]
    }
  ],
  footer: [{ value: 'Bring a reusable bag.', size: 12 }]
}
```

`main` is required in structured data; header/footer and graffiti are optional. A body-only `IElement[]` is also accepted by Editor.create. `value` stores text or an element-specific payload; composite structures can use `valueList`. Newline input is normalized into internal paragraph markers. Do not manufacture internal compensation markers or assume one runtime element equals one UTF-16 code unit.

Paragraph direction is `element.direction`; alignment is `rowFlex`. Paragraph properties are carried by elements and normalized by the editor. Use paragraph commands for runtime changes. `options.direction` mirrors UI chrome and is distinct from content direction. Paragraph before/after spacing does not replace line height.

## Element field groups

| Group                | Common fields                                                                                   | Notes                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Identity             | id, externalId, extension, type, value                                                          | Application metadata belongs in extension; validate external content |
| Text style           | font, size, bold, italic, color, highlight, underline, strikeout, letterSpacing, textDecoration | A font family must have usable registered bytes                      |
| Paragraph            | rowFlex, direction, rowMargin, spacingBefore, spacingAfter                                      | Context affects shaping and pagination                               |
| Headings/lists       | level, title, listType, listStyle, listLevel, listWrap, valueList                               | Runtime IDs are editor-managed                                       |
| Tables               | colgroup, trList, borderType, borderColor, borderWidth                                          | Cell value arrays recursively contain elements                       |
| Links                | url, valueList                                                                                  | Validate URLs from untrusted content                                 |
| Images               | width, height, imgDisplay, imgFloatPosition, imgCrop, imgCaption                                | Resource URLs and dimensions affect paint/export                     |
| Controls             | control, valueList                                                                              | See control configuration and cascade references                     |
| Other objects        | block, dateFormat, laTexSVG, dashArray, lineWidth                                               | SVG formula/image data is not an SVG page renderer                   |
| Business annotations | groupIds, trace, area, label, hide, hint                                                        | See the corresponding commands and configuration                     |

Exact optional fields and enum members are defined by the package's exported `IElement` type. The table is a navigation aid, not a replacement declaration.

## Nested table example

```typescript
import { ElementType } from '@herberthe/canvas-editor'
import type { IElement } from '@herberthe/canvas-editor'

const table: IElement = {
  type: ElementType.TABLE,
  value: '',
  colgroup: [{ width: 220 }, { width: 220 }],
  trList: [
    {
      height: 40,
      tdList: [
        { colspan: 1, rowspan: 1, value: [{ value: 'Saturday' }] },
        { colspan: 1, rowspan: 1, value: [{ value: 'Visit the library' }] }
      ]
    }
  ]
}
```

Tables, controls, links and composite objects have their own schema constraints. Use public commands for edits so IDs, ranges, dirty tracking and layout invalidation stay consistent. See [control configuration](./control/option.md) and [mutation commands](./command-execute.md).

## Serialization and restoration

`command.getValue()` returns `{ version, data, options }`. Restore document content with `command.executeSetValue(saved.data)` after ready. Initial creation can also receive `saved.data`. Keep application configuration and font assets under your control rather than blindly restoring untrusted options. Font bytes, caches and native geometry are not a portable document format. See [quick start](./start.md) for persistence examples.

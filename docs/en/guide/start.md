# Quick start

`@herberthe/canvas-editor` is Herbert He's independently maintained [fork of Hufe921/canvas-editor](./fork-and-differences.md), with repository version **0.1.0**. It uses HarfBuzz shaping, Canvas glyph-outline painting and ESM packaging. **Canvas is the only page renderer. SVG page rendering and standalone SVG export are deferred; there is no renderer selector.**

You can first [try the online editor](./playground.md) without installing anything.

## Requirements and installation

Use Node.js `>=24.13.1` for development and a modern browser/bundler supporting ESM, WebAssembly, Worker and top-level await. These examples use Vite with an `esnext` target. Create the editor only after client-side mounting in an SSR application.

```sh
npm install @herberthe/canvas-editor@0.1.0
```

This consumes a published version; the repository version does not prove that an npm release exists. If it is unavailable in the registry, run `npm run lib` and `npm pack` in this repository, then install the generated `.tgz` in your application. The original npm package has an independent release line.

```typescript
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'esnext' }
})
```

UMD globals, CommonJS `require()` and internal deep imports are unsupported. Serve the complete output directory, including relative chunks, workers and WASM resources, over HTTP(S).

## Create an everyday document

Prepare a container and buttons:

```html
<button id="save">Save weekend plans</button>
<button id="print">Print</button>
<div id="editor"></div>
```

In Vite's `main.ts`:

```typescript
import Editor, { RowFlex } from '@herberthe/canvas-editor'

const container = document.querySelector<HTMLDivElement>('#editor')
if (!container) throw new Error('Missing editor container')

try {
  const editor = await Editor.create(
    container,
    {
      header: [
        { value: 'Weekend plans · 家庭周末安排', rowFlex: RowFlex.CENTER }
      ],
      main: [
        {
          value: 'Saturday morning: buy fruit and bread at the market.',
          bold: true
        },
        { value: '\n' },
        {
          value:
            'Afternoon: help our neighbors in the garden. مرحبا · नमस्ते · สวัสดี'
        },
        { value: '\n' },
        {
          value: 'Sunday: visit the library and prepare lunches for next week.'
        }
      ],
      footer: [{ value: 'Bring a shopping bag and a water bottle.', size: 12 }]
    },
    { autoDownloadFonts: true }
  )

  const save = () => {
    localStorage.setItem(
      'weekend-plan',
      JSON.stringify(editor.command.getValue())
    )
  }
  const print = () => {
    void editor.command.executePrint().catch(console.error)
  }
  document.querySelector('#save')?.addEventListener('click', save)
  document.querySelector('#print')?.addEventListener('click', print)

  // Use the same cleanup on framework unmount. Also release during Vite HMR.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      document.querySelector('#save')?.removeEventListener('click', save)
      document.querySelector('#print')?.removeEventListener('click', print)
      editor.destroy()
    })
  }
} catch (error) {
  console.error('Editor initialization failed', error)
  container.textContent =
    'Initialization failed. Check browser and font resources.'
}
```

The complete everyday multilingual demo, including controls, tables and images, is in `src/main.ts`; run `npm run dev`. Toolbars are application integration code, not automatically created by installing the editor library.

## Ready and missing glyphs

`await Editor.create(...)` waits for HarfBuzz WASM, explicit fonts and first layout. You can then execute mutation and geometry commands. With `new Editor(...)`, await `editor.ready`; commands during initialization are not queued.

**Ready does not wait for background font downloads.** Missing boxes do not necessarily indicate initialization failure. `autoDownloadFonts: true` is the default: missing text triggers basic font downloads from `fonts.bunny.net`, followed by registration and reflow. Failures, rare characters, emoji or unavailable styles continue to produce page/console warnings. Coverage is not guaranteed for every language, regional form or style.

Subscribe to coverage reports rather than assuming a fixed timeout means fonts are ready. Empty issues means the current scan found no missing glyphs; it says nothing about external images. See [font migration](./font-and-esm-migration.md) for candidates and cache/network behavior.

## Offline and explicit fonts

OS-installed fonts, CSS `font-family` and `@font-face` alone do not provide HarfBuzz with font bytes. Host actual font files with your application; replace this example path with a real file:

```typescript
const editor = await Editor.create(
  container,
  [{ value: 'A walk in the park.' }],
  {
    autoDownloadFonts: false,
    defaultFont: 'Local Sans',
    fonts: [
      {
        family: 'Local Sans',
        url: `${import.meta.env.BASE_URL}fonts/LocalSans-Regular.ttf`,
        weight: 400,
        style: 'normal'
      }
    ]
  }
)
```

Disabling automatic downloads also disables automatic registration from the download cache. Missing-font warnings remain. Explicit URLs and manual binaries still work. TTF/OTF/WOFF/WOFF2 are supported; cross-origin URLs need CORS and resources must satisfy your CSP. Supply appropriately licensed fonts and actual bold/italic faces.

Register runtime additions through the API, not by mutating the options array:

```typescript
const results = await editor.register.fonts([
  { family: 'Local Sans', data: await file.arrayBuffer(), weight: 400 }
])
for (const result of results) {
  if (result.status === 'failed') console.warn(result.failure)
}
console.log(editor.getFontCoverageReport())
```

Here `file` comes from your file picker. Per-face registration success does not mean all document characters are covered.

## Save, restore and export

```typescript
// { version, data: { header, main, footer, ... }, options }
const snapshot = editor.command.getValue()
const raw = localStorage.getItem('weekend-plan')
if (raw) {
  const saved = JSON.parse(raw) // Validate data and handle parse errors in production
  editor.command.executeSetValue(saved.data)
}
const pngPages: string[] = await editor.command.getImage()
```

Restore `saved.data`, not the entire result as a body array. Validate external JSON and manage configuration yourself: stored options may include obsolete engine keys or inappropriate URLs. Serialized content does not replace font assets distributed with your application.

Image export returns Canvas PNG pages and printing uses page images. Standalone SVG/native vector PDF is unavailable. For stable pagination/export, explicitly supply all required fonts and manage images so background font downloads cannot change layout. See [query APIs](./command-get.md).

## Framework lifecycle

Create only after the container is mounted. Asynchronous create may resolve after unmount: keep a cancellation flag and immediately destroy the returned editor in that case. Do not store it in an unmounted component. On unmount, remove your EventBus callbacks and DOM handlers, release toolbars and call `editor.destroy()`. Synchronous construction also requires handling ready rejection and cleaning up failed instances.

## Repository development

```sh
npm install
npm run dev
npm run docs:dev
npm run docs:build
```

CI uses pnpm 10.32.1 with the committed `pnpm-lock.yaml`. You can use `pnpm install --frozen-lockfile` locally too; avoid committing additional lockfiles from mixed package managers.

Continue with [pipeline diagrams](./rendering-pipeline.md), [instance APIs](./api-instance.md), [options](./option.md), [commands](./command-execute.md), [upstream differences](./fork-and-differences.md) and [troubleshooting](./faq.md).

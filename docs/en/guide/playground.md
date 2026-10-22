---
layout: page
sidebar: false
title: Online playground
---

<div class="playground-page">

# Try Canvas Editor

Edit the document below straight away: update weekend plans, fill in controls, edit a table or try formatting, search and undo. This is the same everyday multilingual demo as the repository, including its toolbar. The shared demo UI is primarily Chinese.

Use **Open in a separate window** for more editing space, especially on a phone. **Reset demo** reloads the initial document and discards current document edits. The experience does not automatically save your document to a server; keep anything you need before resetting or leaving.

<EditorPlayground />

## Fonts and getting started

The demo uses HarfBuzz and Canvas pages. Basic Bunny font downloads are enabled by default; missing fonts may briefly appear as boxes, and network failures or unsupported characters leave a visible warning. Basic Chinese/Latin and several script fonts ship with the site and load before first layout. Background downloads are not part of the ready barrier. For your own integration, follow [quick start](./start.md) and [offline/font configuration](./font-and-esm-migration.md).

</div>

<style scoped>
.playground-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 32px 24px;
}
.playground-page h1 { font-size: 28px; font-weight: 700; margin-bottom: 16px; }
.playground-page h2 { font-size: 22px; font-weight: 600; margin: 32px 0 16px; }
.playground-page p { line-height: 1.8; margin: 16px 0; }
.playground-page a { color: var(--vp-c-brand-1); text-decoration: underline; }
</style>

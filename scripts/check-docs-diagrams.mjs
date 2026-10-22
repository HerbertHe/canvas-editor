import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'

// Mermaid's text sanitization uses DOMPurify even during syntax validation.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
const { default: mermaid } = await import('mermaid')
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
let count = 0
async function validate(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await validate(path)
    else if (path.endsWith('.md')) {
      const source = await readFile(path, 'utf8')
      for (const match of source.matchAll(
        /^```mermaid[^\n]*\n([\s\S]*?)^```\s*$/gm
      )) {
        try {
          await mermaid.parse(match[1])
          count++
        } catch (cause) {
          throw new Error(`Invalid Mermaid in ${path}`, { cause })
        }
      }
    }
  }
}
try {
  await validate('docs')
  console.log(`PASS: ${count} Mermaid diagrams parsed`)
} finally {
  dom.window.close()
}

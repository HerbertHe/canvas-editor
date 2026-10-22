import { spawnSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const configuredBase = process.env.DOCS_BASE || '/canvas-editor/'
if (
  !configuredBase.startsWith('/') ||
  configuredBase.startsWith('//') ||
  /[?#]/.test(configuredBase)
) {
  throw new Error('DOCS_BASE must be a site path such as /canvas-editor/ or /')
}
const base = `${configuredBase.replace(/\/?$/, '/')}playground/`
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
    'build',
    '--mode',
    'app',
    '--target',
    'esnext',
    '--base',
    base,
    '--outDir',
    'docs/public/playground',
    '--emptyOutDir'
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DOCS_PLAYGROUND: 'true' }
  }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

// Preload existing, licensed basic faces for a readable first visit. Other
// scripts and styles still use the demo's normal font download pipeline.
const fontOutput = new URL('../docs/public/playground/fonts/', import.meta.url)
await mkdir(fontOutput, { recursive: true })
for (const name of [
  'NotoSans-Latin-Regular.woff2',
  'NotoSansSC-Regular.woff2',
  'OFL-NotoSans.txt',
  'OFL-NotoSansSC.txt'
]) {
  await copyFile(
    new URL(`../tests/fixtures/fonts/${name}`, import.meta.url),
    new URL(name, fontOutput)
  )
}

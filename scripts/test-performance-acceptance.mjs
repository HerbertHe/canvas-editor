import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { assessPerformance } from './performanceAcceptance.ts'

const args = process.argv.slice(2)
const manifestPath = args.find(arg => arg.endsWith('.json'))
if (!manifestPath) throw new Error('Provide an acceptance manifest JSON')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const reports = []
const errors = []
const holds = []
for (const { path, matrix } of [
  ...(manifest.performance || []).map(path => ({ path, matrix: true })),
  ...(manifest.supplemental || []).map(path => ({ path, matrix: false }))
]) {
  const data = JSON.parse(await readFile(path, 'utf8'))
  const assessment = assessPerformance(data, matrix)
  for (const [source, expected] of Object.entries(data.sourceHashes || {})) {
    const current = createHash('sha256').update(await readFile(source)).digest('hex')
    if (current !== expected) errors.push(`${path}: stale source ${source}`)
  }
  if (!Object.keys(data.sourceHashes || {}).length) errors.push(`${path}: no source hashes`)
  reports.push({ path, matrix, ...assessment })
  errors.push(...assessment.errors)
  holds.push(...assessment.holds)
}
if (!manifest.performance?.length) errors.push('No standard performance evidence')
for (const evidence of manifest.automated || []) {
  const { path } = evidence
  const data = JSON.parse(await readFile(path, 'utf8'))
  if (data.passed !== true) errors.push(`${path}: automated check failed`)
  for (const [source, expected] of Object.entries(data.sourceHashes || {})) {
    const current = createHash('sha256').update(await readFile(source)).digest('hex')
    if (current !== expected) errors.push(`${path}: stale source ${source}`)
  }
  for (const [artifact, expected] of Object.entries(data.artifactHashes || {})) {
    const current = createHash('sha256').update(await readFile(artifact)).digest('hex')
    if (current !== expected) errors.push(`${path}: stale artifact ${artifact}`)
  }
}
for (const kind of ['quality', 'build', 'lifecycle'])
  if (!manifest.automated?.some(item => item.kind === kind))
    holds.push(`Missing automated evidence: ${kind}`)
for (const engine of ['chromium', 'firefox', 'webkit'])
  for (const kind of ['differential', 'compatibility', 'package'])
    if (!manifest.automated?.some(item => item.kind === kind && item.engine === engine))
      holds.push(`Missing automated evidence: ${engine}/${kind}`)
for (const key of ['systemIME', 'systemKeyRepeat', 'presentation', 'longTermMemory'])
  if (manifest.manual?.[key]?.status !== 'passed' || !manifest.manual[key].evidence)
    holds.push(`Manual evidence pending: ${key}`)
const output = manifest.output || 'cypress/results/perf21/acceptance.json'
const result = { schemaVersion: 1, date: new Date().toISOString(),
  manifest: resolve(manifestPath), status: errors.length ? 'fail' : holds.length ? 'hold' : 'pass',
  rollout: { baseline: 'unchanged', sync: 'opt-in', worker: 'experimental',
    transfer: 'deferred' }, errors, holds, reports, evidence: manifest }
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(result, null, 2))
console.log(`${result.status.toUpperCase()}: ${output}`)
if (result.status === 'fail' || (!args.includes('--report-only') && result.status !== 'pass'))
  process.exitCode = 1

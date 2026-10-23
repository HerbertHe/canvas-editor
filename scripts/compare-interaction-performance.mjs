import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const [beforePath, afterPath, output] = process.argv.slice(2)
assert.ok(beforePath && afterPath && output,
  'Usage: node scripts/compare-interaction-performance.mjs before after output')
const before = JSON.parse(await readFile(beforePath, 'utf8'))
const after = JSON.parse(await readFile(afterPath, 'utf8'))
for (const key of ['machine', 'node', 'browser', 'fonts', 'viewport'])
  assert.deepEqual(after[key], before[key], `Different environment: ${key}`)
for (const key of Object.keys(before.settings).filter(k => !['deferredPaint', 'trackedEdits', 'advancedLayout', 'workerLayout', 'workerTransfer'].includes(k)))
  assert.deepEqual(after.settings[key], before.settings[key],
    `Different workload: ${key}`)
const oldResults = new Map(before.results.map(row => [row.name, row]))
assert.equal(after.results.length, oldResults.size)
for (const row of [...before.results, ...after.results]) {
  assert.equal(row.passed, true, row.name)
  assert.equal(row.driver.pendingAfterDrain, 0, row.name)
  assert.ok(Object.values(row.checks).every(Boolean), row.name)
}
const report = {
  before: beforePath,
  after: afterPath,
  beforeSource: before.sourceHashes,
  afterSource: after.sourceHashes,
  deferredPaintBefore: before.settings.deferredPaint ?? false,
  deferredPaintAfter: after.settings.deferredPaint ?? false,
  trackedEditsBefore: before.settings.trackedEdits ?? false,
  trackedEditsAfter: after.settings.trackedEdits ?? false,
  advancedLayoutBefore: before.settings.advancedLayout ?? false,
  advancedLayoutAfter: after.settings.advancedLayout ?? false,
  workerLayoutBefore: before.settings.workerLayout ?? false,
  workerLayoutAfter: after.settings.workerLayout ?? false,
  workerTransferBefore: before.settings.workerTransfer ?? false,
  workerTransferAfter: after.settings.workerTransfer ?? false,
  sameEnvironment: true,
  results: []
}
for (const row of after.results) {
  const old = oldResults.get(row.name)
  assert.ok(old, row.name)
  assert.equal(row.sent, old.sent)
  const key = row.config.action === 'input' ? 'inputHandlerMs' : 'keydownHandlerMs'
  const stages = ['positions', 'deleteQuery', 'queryIndexBuild', 'flow', 'history',
    'coverage', 'paint']
  const perKey = (value, stage) =>
    (value.stages.interaction[stage]?.ms || 0) / value.sent
  report.results.push({
    name: row.name,
    sent: row.sent,
    geometryP95Before: old.timings.geometryCommitMs?.p95 ?? null,
    geometryP95After: row.timings.geometryCommitMs?.p95 ?? null,
    handlerP50Before: old.timings[key].p50,
    handlerP50After: row.timings[key].p50,
    handlerP95Before: old.timings[key].p95,
    handlerP95After: row.timings[key].p95,
    drainedMsBefore: old.driver.drainedMs,
    drainedMsAfter: row.driver.drainedMs,
    elapsedMsBefore: old.elapsedMs,
    elapsedMsAfter: row.elapsedMs,
    paintCallsBefore: old.stages.interaction.paint?.calls || 0,
    paintCallsAfter: row.stages.interaction.paint?.calls || 0,
    stages: Object.fromEntries(stages.map(stage => [stage, {
      beforeMsPerKey: perKey(old, stage), afterMsPerKey: perKey(row, stage)
    }]))
  })
}
report.afterMatchesWorkspace = {}
report.afterMatchesExceptTrailingWhitespace = {}
for (const [path, hash] of Object.entries(after.sourceHashes)) {
  const contents = await readFile(path, 'utf8')
  const current = createHash('sha256').update(contents).digest('hex')
  report.afterMatchesWorkspace[path] = current === hash
  if (current !== hash) {
    const normalized = createHash('sha256')
      .update(contents.replace(/[ \t]+$/gm, '')).digest('hex')
    assert.equal(normalized, after.sourceHashesIgnoringTrailingWhitespace?.[path],
      `Measured source changed: ${path}`)
    report.afterMatchesExceptTrailingWhitespace[path] = true
  }
}
report.postMeasurementChanges = after.postMeasurementChanges || []
await writeFile(output, JSON.stringify(report, null, 2))
console.log(`PASS: ${report.results.length} comparable cases; source hashes verified (documented trailing whitespace normalization allowed)`)

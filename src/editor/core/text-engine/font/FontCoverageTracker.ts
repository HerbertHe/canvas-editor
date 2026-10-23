import type {
  FontCoverageIssue,
  FontCoverageLocation,
  FontCoverageReport
} from '../../../interface/FontCoverage'
import type { FontRegistrationFailure } from '../../../interface/TextEngine'
import type { TextStyleProps } from '../types'
import {
  fontContextUnits,
  isCoverageIgnorable,
  textScript
} from './fontCoverage'
import type { FontManager } from './FontManager'

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })

export interface FontCoverageInput {
  text: string
  style: TextStyleProps
  direction: 'ltr' | 'rtl'
  /** Per UTF-16 unit, in the original element rather than visual order. */
  positions: FontCoverageLocation[]
}

export interface FontCoverageContribution {
  id: string
  revision: string
  base: number
  inputs: FontCoverageInput[]
}
interface ContributionState {
  revision: string
  base: number
  tracker: FontCoverageTracker
  report: FontCoverageReport
  contexts: Map<string, string[]>
  unique: Map<string, Set<string>>
}

export function coverageIssueId(
  family: string,
  style: Pick<TextStyleProps, 'bold' | 'italic'>,
  script: string,
  reason: FontCoverageIssue['reason']
): string {
  return JSON.stringify([
    family,
    style.bold ? 700 : 400,
    style.italic ? 'italic' : 'normal',
    script,
    reason
  ])
}

/** Owns current state only. Revisions are checked again when committing scans. */
export class FontCoverageTracker {
  private report: FontCoverageReport = {
    documentRevision: 0,
    fontRevision: 0,
    autoDownloadFonts: false,
    issues: []
  }
  private contexts = new Map<string, string[]>()
  private signature = ''
  private failuresSignature = ''
  private inputSignature = ''
  private generation = 0
  private destroyed = false
  private uniqueItems = new Map<string, Set<string>>()
  private contributions = new Map<string, ContributionState>()
  private references = new Map<string, {
    members: number; occurrences: number; unique: Map<string, number>
  }>()
  readonly incrementalStats = { updated: 0, reused: 0, removed: 0 }


  constructor(private onChange?: (report: FontCoverageReport) => void) {}

  getReport(): FontCoverageReport {
    return structuredClone(this.report)
  }

  getContexts(id: string): string[] {
    return [...(this.contexts.get(id) || [])]
  }

  /** A token prevents an older asynchronous caller from publishing after a new scan. */
  begin(): number {
    return ++this.generation
  }

  update(
    token: number,
    inputs: FontCoverageInput[],
    manager: FontManager,
    autoDownloadFonts = false
  ): boolean {
    if (this.destroyed || token !== this.generation) return false
    if (this.contributions.size) {
      for (const state of this.contributions.values()) state.tracker.destroy()
      this.contributions.clear()
      this.references.clear()
    }
    const inputSignature = JSON.stringify(inputs)
    const failures = manager.getFailures()
    const failuresSignature = JSON.stringify(failures)
    if (
      inputSignature === this.inputSignature &&
      failuresSignature === this.failuresSignature &&
      manager.getRevision() === this.report.fontRevision &&
      autoDownloadFonts === this.report.autoDownloadFonts
    )
      return false
    const documentRevision =
      this.report.documentRevision +
      (inputSignature !== this.inputSignature ? 1 : 0)
    const contexts = new Map<string, Set<string>>()
    const issues = new Map<string, FontCoverageIssue>()
    const uniqueItems = new Map<string, Set<string>>()
    const makeIssue = (
      family: string,
      style: TextStyleProps,
      script: string,
      reason: FontCoverageIssue['reason'],
      failure?: FontRegistrationFailure
    ) => {
      const id =
        coverageIssueId(family, style, script, reason) +
        (failure ? JSON.stringify([failure.stage, failure.message]) : '')
      let issue = issues.get(id)
      if (!issue) {
        const base = {
          id,
          script,
          categoryLabel: `fontCoverage.script.${script}`,
          requestedFamily: family,
          requestedWeight: style.bold ? 700 : 400,
          requestedStyle: style.italic
            ? ('italic' as const)
            : ('normal' as const),
          attemptedFaces: [],
          missingCharacters: [],
          missingSequences: [],
          codePoints: [],
          samples: [],
          uniqueCount: 0,
          occurrenceCount: 0,
          locations: [],
          downloadStatus: autoDownloadFonts
            ? ('idle' as const)
            : ('disabled' as const),
          attemptedDownloads: []
        }
        issue =
          reason === 'loadFailed'
            ? {
                ...base,
                reason,
                failure: {
                  stage: failure!.stage,
                  message: failure!.message
                }
              }
            : { ...base, reason }
        issues.set(id, issue)
      }
      return issue
    }
    for (const input of inputs) {
      if (input.style.objectWidth != null) continue
      for (const unit of fontContextUnits(input.text)) {
        if (isCoverageIgnorable(unit.text)) continue
        const script = textScript(unit.text)
        const result = manager.resolve(input.style, unit.text, {
          direction: input.direction,
          script
        })
        if (!result.reason) continue
        const issue = makeIssue(
          input.style.fontFamily,
          input.style,
          script,
          result.reason
        )
        const context = contexts.get(issue.id) || new Set<string>()
        context.add(unit.text)
        contexts.set(issue.id, context)
        const graphemes = [...graphemeSegmenter.segment(unit.text)].map(
          item => item.segment
        )
        const missingItems =
          result.reason === 'missingSequence'
            ? [unit.text]
            : graphemes.filter(
                text =>
                  !isCoverageIgnorable(text) &&
                  (result.reason === 'missingStyle' ||
                    !result.missingCharacters.length ||
                    [...text].some(scalar =>
                      result.missingCharacters.includes(scalar)
                    ))
              )
        issue.occurrenceCount += missingItems.length
        const distinct = uniqueItems.get(issue.id) || new Set<string>()
        if (result.reason !== 'missingStyle')
          missingItems.forEach(text => distinct.add(text))
        uniqueItems.set(issue.id, distinct)
        issue.attemptedFaces.push(...result.attemptedFaces)
        const characters =
          result.reason === 'missingStyle' ? [] : result.missingCharacters
        issue.missingCharacters.push(...characters)
        issue.missingSequences.push(...result.missingSequences)
        if (result.status === 'missing') {
          for (const { segment } of graphemeSegmenter.segment(unit.text)) {
            if ([...segment].length > 1 && !isCoverageIgnorable(segment))
              issue.missingSequences.push(segment)
          }
        }
        if (
          !characters.length &&
          !result.missingSequences.length &&
          result.reason !== 'missingStyle'
        ) {
          issue.missingSequences.push(unit.text)
        }
        // Samples are bounded graphemes, even when a joining context is a word.
        for (const { segment } of graphemeSegmenter.segment(unit.text)) {
          if (issue.samples.length < 16 && !issue.samples.includes(segment))
            issue.samples.push(segment)
        }
        for (const position of input.positions.slice(unit.start, unit.end)) {
          const previous = issue.locations.at(-1)
          if (
            previous &&
            previous.nodeId === position.nodeId &&
            previous.scope === position.scope &&
            previous.textEnd === position.textStart
          ) {
            previous.textEnd = position.textEnd
          } else if (
            !previous ||
            JSON.stringify(previous) !== JSON.stringify(position)
          ) {
            issue.locations.push({ ...position })
          }
        }
      }
    }
    for (const failure of failures) {
      makeIssue(
        failure.family,
        { fontFamily: failure.family, fontSize: 16 },
        'zzzz',
        failure.reason === 'unsupportedGlyphFormat'
          ? 'unsupportedGlyphFormat'
          : 'loadFailed',
        failure
      )
    }
    for (const issue of issues.values()) {
      issue.attemptedFaces = [...new Set(issue.attemptedFaces)].sort()
      issue.missingCharacters = [...new Set(issue.missingCharacters)].sort()
      issue.missingSequences = [...new Set(issue.missingSequences)].sort()
      issue.uniqueCount = uniqueItems.get(issue.id)?.size || 0
      issue.codePoints = [
        ...new Set(
          [...issue.missingCharacters, ...issue.missingSequences].flatMap(
            text =>
              [...text].map(
                scalar =>
                  `U+${scalar.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` as const
              )
          )
        )
      ].sort()
    }
    const report: FontCoverageReport = {
      documentRevision,
      fontRevision: manager.getRevision(),
      autoDownloadFonts,
      issues: [...issues.values()].sort((a, b) => a.id.localeCompare(b.id))
    }
    // Recheck after resolution: a caller may have superseded this generation.
    if (this.destroyed || token !== this.generation) return false
    const signature = JSON.stringify(report)
    this.failuresSignature = failuresSignature
    this.inputSignature = inputSignature
    this.contexts = new Map(
      [...contexts].map(([id, texts]) => [id, [...texts]])
    )
    this.uniqueItems = uniqueItems
    this.report = report
    if (signature === this.signature) return false
    this.signature = signature
    this.onChange?.(this.getReport())
    return true
  }

  updateContributions(
    token: number,
    inputs: FontCoverageContribution[],
    manager: FontManager,
    autoDownloadFonts = false
  ) {
    if (this.destroyed || token !== this.generation) return false
    const fontKey = JSON.stringify([manager.getRevision(), manager.getFailures(), autoDownloadFonts])
    const desired = [...inputs, { id: '__font_failures__', revision: fontKey,
      base: 0, inputs: [] }]
    const adjust = (state: ContributionState, delta: 1 | -1) => {
      for (const issue of state.report.issues) {
        const ref = this.references.get(issue.id) || {
          members: 0, occurrences: 0, unique: new Map<string, number>()
        }
        ref.members += delta
        ref.occurrences += delta * issue.occurrenceCount
        for (const text of state.unique.get(issue.id) || []) {
          const count = (ref.unique.get(text) || 0) + delta
          if (count) ref.unique.set(text, count)
          else ref.unique.delete(text)
        }
        if (ref.members) this.references.set(issue.id, ref)
        else this.references.delete(issue.id)
      }
    }
    const ids = new Set(desired.map(input => input.id))
    for (const [id, state] of this.contributions)
      if (!ids.has(id)) {
        adjust(state, -1)
        state.tracker.destroy()
        this.contributions.delete(id)
        this.incrementalStats.removed++
      }
    for (const input of desired) {
      const revision = input.revision + fontKey
      let state = this.contributions.get(input.id)
      if (state?.revision === revision) {
        state.base = input.base
        this.incrementalStats.reused++
        continue
      }
      if (state) adjust(state, -1)
      const tracker = state?.tracker || new FontCoverageTracker()
      tracker.update(tracker.begin(), input.inputs, manager, autoDownloadFonts)
      state = { revision, base: input.base, tracker, report: tracker.getReport(),
        contexts: tracker.contexts, unique: tracker.uniqueItems }
      this.contributions.set(input.id, state)
      adjust(state, 1)
      this.incrementalStats.updated++
    }
    const issues = new Map<string, FontCoverageIssue>()
    const contexts = new Map<string, Set<string>>()
    for (const input of desired) {
      const state = this.contributions.get(input.id)!
      for (const item of state.report.issues) {
        let issue = issues.get(item.id)
        if (!issue) {
          const ref = this.references.get(item.id)!
          issue = { ...structuredClone(item), occurrenceCount: ref.occurrences,
            uniqueCount: ref.unique.size, attemptedFaces: [], missingCharacters: [],
            missingSequences: [], samples: [], codePoints: [], locations: [] }
          issues.set(item.id, issue)
        }
        issue.attemptedFaces.push(...item.attemptedFaces)
        issue.missingCharacters.push(...item.missingCharacters)
        issue.missingSequences.push(...item.missingSequences)
        issue.codePoints.push(...item.codePoints)
        for (const sample of item.samples)
          if (issue.samples.length < 16 && !issue.samples.includes(sample)) issue.samples.push(sample)
        for (const location of item.locations) {
          const position = { ...location,
            start: location.start + state.base, end: location.end + state.base }
          const previous = issue.locations.at(-1)
          if (previous && previous.nodeId === position.nodeId &&
            previous.scope === position.scope && previous.textEnd === position.textStart)
            previous.textEnd = position.textEnd
          else if (!previous || JSON.stringify(previous) !== JSON.stringify(position))
            issue.locations.push(position)
        }
        const context = contexts.get(item.id) || new Set<string>()
        for (const text of state.contexts.get(item.id) || []) context.add(text)
        contexts.set(item.id, context)
      }
    }
    for (const issue of issues.values()) {
      issue.attemptedFaces = [...new Set(issue.attemptedFaces)].sort()
      issue.missingCharacters = [...new Set(issue.missingCharacters)].sort()
      issue.missingSequences = [...new Set(issue.missingSequences)].sort()
      issue.codePoints = [...new Set(issue.codePoints)].sort()
    }
    const inputSignature = JSON.stringify(desired.filter(input => input.inputs.length)
      .map(input => [input.id, this.contributions.get(input.id)!.report.documentRevision, input.base]))
    const report: FontCoverageReport = {
      documentRevision: this.report.documentRevision + (inputSignature !== this.inputSignature ? 1 : 0),
      fontRevision: manager.getRevision(), autoDownloadFonts,
      issues: [...issues.values()].sort((a, b) => a.id.localeCompare(b.id))
    }
    if (this.destroyed || token !== this.generation) return false
    this.contexts = new Map([...contexts].map(([id, texts]) => [id, [...texts]]))
    this.inputSignature = inputSignature
    this.report = report
    const signature = JSON.stringify(report)
    if (signature === this.signature) return false
    this.signature = signature
    this.onChange?.(this.getReport())
    return true
  }

  destroy() {
    this.destroyed = true
    this.generation++
    this.report.issues = []
    this.contexts.clear()
    for (const state of this.contributions.values()) state.tracker.destroy()
    this.contributions.clear()
    this.references.clear()
    this.uniqueItems.clear()
    this.signature = ''
    this.inputSignature = ''
    this.failuresSignature = ''
    this.onChange = undefined
  }
}

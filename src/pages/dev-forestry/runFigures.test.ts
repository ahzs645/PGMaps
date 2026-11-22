import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  READINESS_NOT_RECORDED,
  captureSightline,
  capturedSightline,
  runFigures,
  withheldText,
  type RunFigureSource,
} from './runFigures'
import type { AlterationBreakdown, RunGap } from './types'

const breakdown = (cumulativePercent: number): AlterationBreakdown => ({
  existingPercent: 1,
  disturbancePercent: 0,
  proposedPercent: cumulativePercent - 1,
  cumulativePercent,
})

const run = (ready: boolean, gaps?: RunGap[]): RunFigureSource => ({
  perspectiveAlteration: breakdown(6),
  planimetricAlteration: breakdown(4),
  perspectiveByStation: [breakdown(5), breakdown(6), null],
  assessmentStationIndex: 1,
  quality: {
    numericalReady: ready,
    warnings: ready ? [] : ['Green-area coverage is unverified.'],
    ...(gaps ? { gaps } : {}),
  },
})

describe('runFigures', () => {
  it('reads none with no run and stale when the page dropped a stale run', () => {
    const none = runFigures(null)
    expect(none.state).toBe('none')
    expect(none.perspective).toBeNull()
    expect(none.gaps[0].id).toBe('not-run')
    const stale = runFigures(null, { stale: true })
    expect(stale.state).toBe('stale')
    expect(stale.gaps[0].id).toBe('stale')
    expect(withheldText(stale)).toMatch(/^Withheld — Out of date/)
  })

  it('gives the figures only when the run is ready', () => {
    const ready = runFigures(run(true))
    expect(ready.state).toBe('ready')
    expect(ready.perspective?.cumulativePercent).toBe(6)
    expect(ready.planimetric?.cumulativePercent).toBe(4)
    expect(ready.atStation(0)?.cumulativePercent).toBe(5)
    expect(ready.atStation(2)).toBeNull()
    expect(ready.gaps).toEqual([])
  })

  it('withholds a provisional run’s figures, names its first gap and keeps the raw values as diagnostic', () => {
    const provisional = runFigures(
      run(false, [
        { id: 'existing-disturbance', text: 'Existing disturbance coverage has not been confirmed.', editor: 'run' },
        { id: 'green-area', text: 'Green-area coverage is unverified.', editor: 'run' },
      ]),
    )
    expect(provisional.state).toBe('provisional')
    expect(provisional.perspective).toBeNull()
    expect(provisional.planimetric).toBeNull()
    expect(provisional.atStation(0)).toBeNull()
    expect(provisional.gaps.map((gap) => gap.id)).toEqual(['existing-disturbance', 'green-area'])
    expect(withheldText(provisional)).toBe('Withheld — Existing disturbance coverage has not been confirmed.')
    expect(provisional.diagnostic.perspective?.cumulativePercent).toBe(6)
    expect(provisional.diagnostic.atStation(0)?.cumulativePercent).toBe(5)
  })

  it('names the first warning of a run saved before gaps were recorded', () => {
    const old = runFigures(run(false))
    expect(old.gaps).toEqual([{ id: 'provisional', text: 'Green-area coverage is unverified.', editor: 'run' }])
  })

  it('treats a current-looking run passed as stale as stale', () => {
    const stale = runFigures(run(true), { stale: true })
    expect(stale.state).toBe('stale')
    expect(stale.perspective).toBeNull()
    expect(stale.diagnostic.perspective?.cumulativePercent).toBe(6)
  })
})

describe('captured sightline figures', () => {
  it('stamps the figure only from a ready run, else why not', () => {
    expect(captureSightline(runFigures(run(true)), 0)).toEqual({ sightlinePercent: 5, sightlineReadiness: 'ready' })
    const withheld = captureSightline(
      runFigures(run(false, [{ id: 'green-area', text: 'Green-area coverage is unverified.' }])),
      0,
    )
    expect(withheld).toEqual({
      sightlinePercent: null,
      sightlineReadiness: 'withheld',
      sightlineWithheld: 'Green-area coverage is unverified.',
    })
  })

  it('reads a capture as the assessment’s only when its readiness was recorded', () => {
    expect(capturedSightline({ sightlinePercent: 5, sightlineReadiness: 'ready' })).toEqual({ percent: 5, note: null })
    expect(
      capturedSightline({ sightlinePercent: null, sightlineReadiness: 'withheld', sightlineWithheld: 'Gap.' }),
    ).toEqual({ percent: null, note: 'Withheld — Gap.' })
    // Saved before the check: never the assessment's figure.
    expect(capturedSightline({ sightlinePercent: 7.2 })).toEqual({ percent: null, note: READINESS_NOT_RECORDED })
    expect(capturedSightline({ sightlinePercent: null })).toEqual({ percent: null, note: null })
  })
})

/**
 * Every surface reads a run's alteration figures through `runFigures`. These files may read the raw fields: the run
 * that makes them, the rule itself, and the replay that compares them byte for byte. In `assessmentTools.ts` only the
 * saved-summary copy and its shape check may (`summarizeRun`, `validateRunSummary`): they keep the record whole and
 * print nothing.
 */
const RAW_READERS = new Set([
  'src/pages/dev-forestry/analysis.ts',
  'src/pages/dev-forestry/analysisReplay.ts',
  'src/pages/dev-forestry/runFigures.ts',
])
const RAW_READ_FUNCTIONS: Record<string, string[]> = {
  'src/pages/dev-forestry/assessmentTools.ts': ['summarizeRun', 'validateRunSummary'],
}

/**
 * A read of one of `fields`: `.field`, `x['field']` (a value, not a type's indexed access such as
 * `AnalysisResult['field']`), or destructuring, `{ field }`, `{ field: name } =` or `{ a, field } =`.
 */
function readsOf(fields: readonly string[]): RegExp {
  const name = `(?:${fields.join('|')})`
  return new RegExp(
    [
      `\\.${name}\\b`,
      `(?<!\\b[A-Z]\\w*)\\[\\s*['"\`]${name}['"\`]\\s*\\]`,
      // Shorthand destructuring (`{ field }`, `{ a, field, b }`): the name with no colon after it, inside braces.
      `\\{[^{}]*\\b${name}\\b(?!\\s*[:?(])[^{}]*\\}`,
      // Renamed or defaulted destructuring assigned from a value: `{ field: name } = …`.
      `\\{[^{}]*\\b${name}\\s*:[^{}]*\\}\\s*=(?![=>])`,
    ].join('|'),
  )
}
const RAW_READ = readsOf(['perspectiveAlteration', 'planimetricAlteration', 'perspectiveByStation'])

/**
 * A saved view's sightline figure is the assessment's only through `capturedSightline`, and is stamped once from the
 * run (`captureSightline`). These read a `sightlinePercent` that is already that answer, not a saved record's raw field:
 * the figure sheet's input (`FigureSheetPanel.tsx` resolves it), the VIA document's and report's facts (`facts.ts`
 * resolves them), and the reference comparison, whose own rule (`comparisonSightline`) and shape check read the
 * capture's. The page reads it once more, at the stamp site, off `captureSightline`'s record.
 */
const SIGHTLINE_READERS = new Set([
  'src/pages/dev-forestry/runFigures.ts',
  'src/lib/forestry/viaFigure/composeFigure.ts',
  'src/pages/dev-forestry/viaReport/parts.ts',
  'src/pages/dev-forestry/viaReport/partsDistrict.ts',
  'src/pages/dev-forestry/viaDocument/markdown.ts',
  'src/pages/dev-forestry/referenceComparison.ts',
  // Builds a stamp from a ready run (`captureSightline`): a stamp site, not a reader of a saved figure.
  'src/pages/dev-forestry/sightlineStamp.ts',
])
const SIGHTLINE_STAMP_SITES: Record<string, RegExp> = {
  'src/pages/DevForestryVisuals.tsx': /^const percent = sightline\.sightlinePercent$/,
}
const SIGHTLINE_READ = readsOf(['sightlinePercent'])

/** The lines of each named top-level function in `source`, from its declaration to its closing brace. */
function functionLines(source: string[], names: readonly string[]): Set<number> {
  const lines = new Set<number>()
  for (const name of names) {
    const start = source.findIndex((line) => new RegExp(`^(export )?(async )?function ${name}\\b`).test(line))
    if (start < 0) throw new Error(`No function ${name}`)
    for (let i = start; i < source.length; i++) {
      lines.add(i)
      if (i > start && source[i] === '}') break
    }
  }
  return lines
}

describe('one readiness rule', () => {
  const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
  const files = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path)
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
    })
  const sources = files(join(ROOT, 'src')).map((file) => {
    const name = relative(ROOT, file).split('\\').join('/')
    return { name, lines: readFileSync(file, 'utf8').split('\n') }
  })

  it('finds a read however it is written, and not a type’s indexed access', () => {
    for (const line of [
      'const x = result.perspectiveAlteration',
      "const x = result['planimetricAlteration']",
      'const { perspectiveByStation } = result',
      'const { quality, perspectiveAlteration: pa } = result',
      'function f({ planimetricAlteration }: AnalysisResult) {',
    ])
      expect(RAW_READ.test(line), line).toBe(true)
    for (const line of [
      "type B = AnalysisResult['perspectiveAlteration']",
      '  perspectiveAlteration: AlterationBreakdown | null',
      "  | 'perspectiveByStation'",
    ])
      expect(RAW_READ.test(line), line).toBe(false)
    expect(SIGHTLINE_READ.test('{record.capture.sightlinePercent == null')).toBe(true)
    expect(SIGHTLINE_READ.test('const { sightlinePercent } = figure')).toBe(true)
  })

  it('reads the run’s figures only through runFigures outside the allowlist', () => {
    const offenders = sources
      .filter(({ name }) => !RAW_READERS.has(name))
      .flatMap(({ name, lines }) => {
        const allowed = RAW_READ_FUNCTIONS[name] ? functionLines(lines, RAW_READ_FUNCTIONS[name]) : new Set<number>()
        return lines.flatMap((line, i) =>
          !allowed.has(i) && RAW_READ.test(line) ? [`${name}:${i + 1}: ${line.trim()}`] : [],
        )
      })
    expect(offenders).toEqual([])
  })

  it('reads a saved view’s sightline figure only through capturedSightline outside the allowlist', () => {
    const offenders = sources
      .filter(({ name }) => !SIGHTLINE_READERS.has(name))
      .flatMap(({ name, lines }) =>
        lines.flatMap((line, i) =>
          SIGHTLINE_READ.test(line) && !SIGHTLINE_STAMP_SITES[name]?.test(line.trim())
            ? [`${name}:${i + 1}: ${line.trim()}`]
            : [],
        ),
      )
    expect(offenders).toEqual([])
  })
})

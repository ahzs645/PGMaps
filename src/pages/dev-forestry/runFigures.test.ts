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
 * that makes them, the rule itself, the replay that compares them byte for byte, and the saved-summary copy and
 * shape check (`summarizeRun`, `validateRunSummary`), which keep the record whole and print nothing.
 */
const RAW_READERS = new Set([
  'src/pages/dev-forestry/analysis.ts',
  'src/pages/dev-forestry/analysisReplay.ts',
  'src/pages/dev-forestry/runFigures.ts',
  'src/pages/dev-forestry/assessmentTools.ts',
])
const RAW_READ = /\.(perspectiveAlteration|planimetricAlteration|perspectiveByStation)\b/

describe('one readiness rule', () => {
  const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
  const files = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path)
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
    })

  it('reads the run’s figures only through runFigures outside the allowlist', () => {
    const offenders = files(join(ROOT, 'src'))
      .map((file) => relative(ROOT, file).split('\\').join('/'))
      .filter((file) => !RAW_READERS.has(file))
      .flatMap((file) =>
        readFileSync(join(ROOT, file), 'utf8')
          .split('\n')
          .flatMap((line, i) => (RAW_READ.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
      )
    expect(offenders).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'

import {
  EMPTY_REVISION,
  describeRevision,
  designSignature,
  matchingDesignName,
  nextRevision,
  runHeadline,
  type RunHeadline,
} from './runRevision'
import type { AlterationBreakdown, AnalysisInput, AnalysisResult, TargetPolygon } from './types'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS } from './vqo'

const square = (x: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
      [x, 0],
    ],
  ],
})

const breakdown = (cumulativePercent: number): AlterationBreakdown => ({
  proposedPercent: cumulativePercent,
  disturbancePercent: 0,
  existingPercent: 0,
  cumulativePercent,
})

const landform: Pick<TargetPolygon, 'id' | 'name' | 'objectiveId' | 'vac'> = {
  id: 'land',
  name: 'Tabor Mountain',
  objectiveId: 'partial-retention',
  vac: null,
}

/** Only what the headline reads: the two cumulative figures, readiness and the input snapshot. */
function run(perspective: number, planimetric: number, blockX = 0, patch: Partial<AnalysisResult> = {}) {
  const inputSnapshot = {
    viewpoint: { mode: 'spot', coordinates: [[0, 0]] },
    targets: [
      { id: 'land', name: 'Tabor Mountain', role: 'landscape', geometry: square(10) },
      { id: 'b1', name: 'Block', role: 'block', geometry: square(blockX) },
    ],
    settings: { sampleBudget: 900 },
    assessmentYear: 2026,
  } as unknown as AnalysisInput
  return {
    activeLandformId: 'land',
    perspectiveAlteration: breakdown(perspective),
    planimetricAlteration: breakdown(planimetric),
    quality: { numericalReady: true, warnings: [] },
    inputSnapshot,
    inputSignature: JSON.stringify(inputSnapshot),
    ...patch,
  } as unknown as AnalysisResult
}

const headline = (result: AnalysisResult, design: string | null = null) =>
  runHeadline(result, landform, DEFAULT_VISUAL_QUALITY_THRESHOLDS, design)

describe('runHeadline', () => {
  it('reads each scale against its own range and keeps the run’s own figures', () => {
    // No VAC: the planimetric range is Table 4's medium mid-point, 10% for partial retention.
    const head = headline(run(9.8, 8.4))!
    expect(head.scales).toEqual([
      { basis: 'perspective', percent: 9.8, classId: 'modification', met: false, floorPercent: 1.5, maxPercent: 7 },
      { basis: 'planimetric', percent: 8.4, classId: 'partial-retention', met: true, floorPercent: 3, maxPercent: 10 },
    ])
  })

  it('withholds a provisional run’s figures, as the Results panel does', () => {
    const head = headline(run(3, 4, 0, { quality: { numericalReady: false, warnings: [] } as never }))!
    expect(head.scales.map((s) => [s.percent, s.met])).toEqual([
      [null, null],
      [null, null],
    ])
  })

  it('needs the landform the run measured', () => {
    expect(runHeadline(run(3, 4), null, DEFAULT_VISUAL_QUALITY_THRESHOLDS)).toBeNull()
    expect(runHeadline(run(3, 4), { ...landform, id: 'other' }, DEFAULT_VISUAL_QUALITY_THRESHOLDS)).toBeNull()
  })
})

describe('nextRevision', () => {
  const first = headline(run(14.2, 20))!
  const second = headline(run(6.1, 12, 2))!

  it('keeps the previous run beside the new one, and nothing more', () => {
    let state = nextRevision(EMPTY_REVISION, first)
    expect(describeRevision(state)).toBeNull()
    state = nextRevision(state, second)
    expect(state).toEqual({ previous: first, current: second })
  })

  it('keeps the comparison when the same inputs run again', () => {
    const state = nextRevision(nextRevision(EMPTY_REVISION, first), second)
    const again = headline(run(6.1, 12, 2))!
    expect(nextRevision(state, again)).toEqual({ previous: first, current: again })
  })

  it('starts over when the landform or objective changes', () => {
    const state = nextRevision(EMPTY_REVISION, first)
    const retention = runHeadline(
      run(6.1, 12, 2),
      { ...landform, objectiveId: 'retention' },
      DEFAULT_VISUAL_QUALITY_THRESHOLDS,
    )
    expect(nextRevision(state, retention)).toEqual({ previous: null, current: retention })
    const elsewhere: RunHeadline = { ...second, comparisonKey: 'another landform' }
    expect(nextRevision(state, elsewhere).previous).toBeNull()
    expect(nextRevision(state, null)).toEqual(EMPTY_REVISION)
  })
})

describe('describeRevision', () => {
  it('says the edit brought the landform within the objective, naming the scale', () => {
    const state = nextRevision(
      nextRevision(EMPTY_REVISION, headline(run(14.2, 20))),
      headline(run(6.1, 12, 2), 'Option B'),
    )
    const readout = describeRevision(state)!
    expect(readout.lines[0]).toMatchObject({
      scale: 'Perspective',
      before: 14.2,
      after: 6.1,
      movement: 'now-within',
      change: 'Modification 14.2% → Partial retention 6.1%',
      verdict: 'now within partial retention (≤ 7%)',
    })
    expect(readout.lines[1].scale).toBe('Planimetric')
    expect(readout.changed).toEqual(['proposed blocks'])
    expect(readout.currentDesign).toBe('Option B')
  })

  it('says when an edit pushes it over, or leaves it where it was', () => {
    const over = describeRevision(
      nextRevision(nextRevision(EMPTY_REVISION, headline(run(5, 10))), headline(run(8.2, 10, 3))),
    )!
    expect(over.lines[0].movement).toBe('now-over')
    expect(over.lines[0].verdict).toBe('now over partial retention (≤ 7%)')
    expect(over.lines[1].movement).toBe('still-within')
  })

  it('does not compare a withheld figure', () => {
    const provisional = headline(run(3, 4, 1, { quality: { numericalReady: false, warnings: [] } as never }))
    const readout = describeRevision(nextRevision(nextRevision(EMPTY_REVISION, headline(run(9, 20))), provisional))!
    expect(readout.lines[0]).toMatchObject({ movement: 'withheld', change: 'Modification 9.0% → withheld' })
  })
})

describe('matchingDesignName', () => {
  it('names the saved alternative whose blocks the scene carries', () => {
    const block = (x: number) => ({ id: 'b1', role: 'block' as const, geometry: square(x) })
    const options = [
      { name: 'Option A', scene: { targets: [block(0)] } },
      { name: 'Option B', scene: { targets: [block(2)] } },
    ]
    expect(
      matchingDesignName(options, { targets: [block(2), { id: 'land', role: 'landscape', geometry: square(9) }] }),
    ).toBe('Option B')
    expect(matchingDesignName(options, { targets: [block(5)] })).toBeNull()
    expect(designSignature({ targets: [block(0)] })).not.toBe(
      designSignature({ targets: [block(0)], masks: [{ kind: 'retained', geometry: square(0) }] }),
    )
  })
})

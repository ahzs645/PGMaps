import { describe, expect, it } from 'vitest'

import type { AlterationBreakdown, AnalysisResult } from './types'
import {
  adjustedPercent,
  assessVia,
  existingOpeningContribution,
  finalRating,
  fs1252ReviewFromVia,
  initialAlterationPercent,
  measuredDesignRatings,
  measuredRetention,
  ocularClass,
  parseViaReview,
  percentStanding,
  retentionLevelFor,
  table2Class,
  viaStepStatuses,
  type OcularResult,
  type ViaReview,
} from './via'

function breakdown(proposedPercent: number, disturbancePercent = 0, existingPercent = 0): AlterationBreakdown {
  return {
    proposedPercent,
    disturbancePercent,
    existingPercent,
    cumulativePercent: proposedPercent + disturbancePercent + existingPercent,
  }
}

/** One station at lat 54 and one block whose visible ground sits `offsetDegrees` east of it. */
function fakeResult({
  x = 4,
  numericalReady = true,
  offsetDegrees = 0.05,
  openings = 1,
}: { x?: number; numericalReady?: boolean; offsetDegrees?: number; openings?: number } = {}): AnalysisResult {
  const block = (id: string) => ({
    targetId: id,
    role: 'block' as const,
    sampleCount: 1,
    positions: new Float64Array([-122 + offsetDegrees, 54]),
    anyVisible: new Uint8Array([1]),
    visibleAreaMeters: 1000,
  })
  return {
    stations: [{ lng: -122, lat: 54, groundElevationMeters: 700, distanceAlongMeters: 0 }],
    assessmentStationIndex: 0,
    targets: Array.from({ length: openings }, (_, index) => block(`b${index}`)),
    perspectiveAlteration: breakdown(x),
    quality: { numericalReady },
  } as unknown as AnalysisResult
}

const FULL_REVIEW: ViaReview = {
  ocular: { visibleness: 'easy', scale: 'medium', shape: 'natural' },
  design: { 'force-lines': 0, 'natural-character': 0, 'edge-treatment': 0, position: 0 },
  roads: 0,
  retention: 'low',
  rationale: 'Opening follows the hollow.',
}

describe('ocular assessment (Table 1)', () => {
  it('waits for all three criteria', () => {
    expect(ocularClass({ visibleness: 'easy', scale: 'small' })).toBeNull()
    expect(ocularClass(null)).toBeNull()
  })

  it('reads each FPPR definition back to its class', () => {
    expect(
      ocularClass({ visibleness: 'not-easily-distinguishable', scale: 'very-small', shape: 'natural' })?.classId,
    ).toBe('preservation')
    expect(ocularClass({ visibleness: 'difficult', scale: 'small', shape: 'natural' })?.classId).toBe('retention')
    expect(ocularClass({ visibleness: 'easy', scale: 'medium', shape: 'natural' })?.classId).toBe('partial-retention')
    expect(ocularClass({ visibleness: 'very-easy', scale: 'large', shape: 'natural' })?.classId).toBe('modification')
    expect(ocularClass({ visibleness: 'very-easy', scale: 'very-large', shape: 'geometric' })?.classId).toBe(
      'maximum-modification',
    )
  })

  it('places the handbook worked case in M, leaning toward PR', () => {
    // "easy to see, medium in scale, and have some angular characteristics …
    // you would circle M, but perhaps closer to the boundary with PR."
    const result = ocularClass({ visibleness: 'easy', scale: 'medium', shape: 'angular' })
    expect(result).toMatchObject({ classId: 'modification', mixed: true, leansTowardId: 'partial-retention' })
  })

  it('treats rectilinear or geometric shape as maximum modification whatever the scale', () => {
    expect(ocularClass({ visibleness: 'very-easy', scale: 'small', shape: 'rectilinear' })?.classId).toBe(
      'maximum-modification',
    )
  })

  it('does not call agreeing criteria mixed because the shape is natural', () => {
    expect(ocularClass({ visibleness: 'difficult', scale: 'small', shape: 'natural' })?.mixed).toBe(false)
  })
})

describe('numerical assessment (Table 2 and 3.4.2)', () => {
  it('uses the handbook ranges with inclusive upper bounds', () => {
    expect(table2Class(0)?.id).toBe('preservation')
    expect(table2Class(1.5)?.id).toBe('retention')
    expect(table2Class(1.55)?.id).toBe('partial-retention')
    expect(table2Class(7)?.id).toBe('partial-retention')
    expect(table2Class(18)?.id).toBe('modification')
    expect(table2Class(30)?.id).toBe('maximum-modification')
    expect(table2Class(30.1)).toBeNull()
  })

  it('reproduces the partial green-up example: 15% at 70% green-up adds 4.5%', () => {
    expect(existingOpeningContribution(15, 70)).toBeCloseTo(4.5, 10)
  })

  it('sums lines a, b and c into X', () => {
    // Handbook Step 5: (1.8 + 4.7) / 37.5 = 17.3%.
    const x = initialAlterationPercent(breakdown((4.7 / 37.5) * 100, 0, (1.8 / 37.5) * 100))
    expect(x).toBeCloseTo(17.3, 1)
    expect(initialAlterationPercent(null)).toBeNull()
  })
})

describe('adjustments (3.4.3)', () => {
  it('applies X * (1 + 0.14 * Y)', () => {
    expect(adjustedPercent(10, 0)).toBe(10)
    expect(adjustedPercent(10, 2)).toBeCloseTo(12.8, 10)
    expect(adjustedPercent(10, -3)).toBeCloseTo(5.8, 10)
  })

  it('never reports a negative alteration at the bottom of the Y range', () => {
    expect(adjustedPercent(10, -8)).toBe(0)
  })

  it('bands measured retention by Table 5', () => {
    expect(retentionLevelFor(14.9)).toBe('low')
    expect(retentionLevelFor(15)).toBe('moderate')
    expect(retentionLevelFor(22)).toBe('moderate')
    expect(retentionLevelFor(22.1)).toBe('high')
    expect(retentionLevelFor(Number.NaN)).toBeNull()
  })
})

describe('final rating (Table 7)', () => {
  const achieved: OcularResult = { classId: 'partial-retention', mixed: false, leansTowardId: null, onBoundary: false }
  const failed: OcularResult = { ...achieved, classId: 'modification' }

  it('calls the top fifth of the objective range near the boundary', () => {
    expect(percentStanding(5.9, 'partial-retention')).toBe('well-within')
    expect(percentStanding(6.5, 'partial-retention')).toBe('near-boundary')
    expect(percentStanding(7.1, 'partial-retention')).toBe('over')
    expect(percentStanding(0, 'preservation')).toBe('well-within')
    expect(percentStanding(0.1, 'preservation')).toBe('over')
  })

  it('rates each row of Table 7', () => {
    expect(finalRating({ objectiveId: 'partial-retention', ocular: achieved, adjustedPercent: 4 }).id).toBe('well-met')
    expect(finalRating({ objectiveId: 'partial-retention', ocular: achieved, adjustedPercent: 6.8 }).id).toBe('met')
    expect(
      finalRating({ objectiveId: 'partial-retention', ocular: { ...achieved, onBoundary: true }, adjustedPercent: 9 })
        .id,
    ).toBe('inconclusive')
    expect(finalRating({ objectiveId: 'partial-retention', ocular: failed, adjustedPercent: 6 }).id).toBe('not-met')
    expect(finalRating({ objectiveId: 'partial-retention', ocular: failed, adjustedPercent: 12 }).id).toBe(
      'clearly-not-met',
    )
  })

  it('lets the ocular class decide when the two measures disagree', () => {
    const rating = finalRating({ objectiveId: 'partial-retention', ocular: achieved, adjustedPercent: 12 })
    expect(rating).toMatchObject({ id: 'met', measuresDisagree: true })
    expect(
      finalRating({ objectiveId: 'partial-retention', ocular: achieved, adjustedPercent: 4 }).measuresDisagree,
    ).toBe(false)
  })

  it('counts a better class than the objective as achieving it', () => {
    expect(finalRating({ objectiveId: 'modification', ocular: achieved, adjustedPercent: 4 }).id).toBe('well-met')
  })
})

describe('measured design ratings', () => {
  it('rates distance from the assessment station to the visible proposal', () => {
    // 0.05° of longitude at 54° N is about 3.3 km: Moderate.
    expect(measuredDesignRatings(fakeResult()).distance?.rating).toBe(0)
    expect(measuredDesignRatings(fakeResult({ offsetDegrees: 0.005 })).distance?.rating).toBe(1)
    expect(measuredDesignRatings(fakeResult({ offsetDegrees: 0.2 })).distance?.rating).toBe(-1)
  })

  it('rates one or two openings Moderate and leaves three or more to the reviewer', () => {
    expect(measuredDesignRatings(fakeResult({ openings: 2 }))['number-size-spacing']?.rating).toBe(0)
    expect(measuredDesignRatings(fakeResult({ openings: 3 }))['number-size-spacing']).toBeUndefined()
  })

  it('has nothing to offer without a run', () => {
    expect(measuredDesignRatings(null)).toEqual({})
  })
})

describe('assessVia', () => {
  it('carries a complete review through to a rating', () => {
    const assessment = assessVia({
      objectiveId: 'partial-retention',
      result: fakeResult({ x: 4 }),
      review: FULL_REVIEW,
    })
    expect(assessment.initialPercent).toBe(4)
    expect(assessment.design.distance).toMatchObject({ rating: 0 })
    expect(assessment.y).toBe(0)
    expect(assessment.adjusted).toEqual({ percent: 4, classId: 'partial-retention' })
    expect(assessment.rating?.id).toBe('well-met')
    expect(assessment.missing).toEqual([])
  })

  it('prefers the reviewer’s rating over a measured one', () => {
    const review = { ...FULL_REVIEW, design: { ...FULL_REVIEW.design, distance: 1 as const } }
    const assessment = assessVia({ objectiveId: 'partial-retention', result: fakeResult(), review })
    expect(assessment.design.distance.rating).toBe(1)
    expect(assessment.y).toBe(1)
  })

  it('zeroes retention that was already netted out of the geometry', () => {
    const review: ViaReview = { ...FULL_REVIEW, retention: 'high', retentionNetted: true }
    expect(assessVia({ objectiveId: 'partial-retention', result: fakeResult(), review }).retentionFactor).toBe(0)
  })

  it('withholds X while the run is provisional', () => {
    const assessment = assessVia({
      objectiveId: 'partial-retention',
      result: fakeResult({ numericalReady: false }),
      review: FULL_REVIEW,
    })
    expect(assessment).toMatchObject({ initialPercent: null, numericalProvisional: true, adjusted: null, rating: null })
    expect(assessment.missing[0]).toMatch(/provisional/)
  })

  it('lists what is missing in handbook order', () => {
    const assessment = assessVia({ objectiveId: 'retention', result: null, review: {} })
    expect(assessment.missing).toEqual([
      'Run the simulation',
      'Describe the alteration by eye',
      'Rate every design element',
      'Rate road visibility',
      'Rate tree retention',
    ])
  })

  it('asks for a rationale once a rating exists', () => {
    const assessment = assessVia({
      objectiveId: 'partial-retention',
      result: fakeResult(),
      review: { ...FULL_REVIEW, rationale: ' ' },
    })
    expect(assessment.rating).not.toBeNull()
    expect(assessment.missing).toEqual(['Write the rationale'])
  })
})

describe('foreground caveat and saved review', () => {
  it('flags a proposal under 1 km as a foreground view', () => {
    const review = {}
    expect(
      assessVia({ objectiveId: 'partial-retention', result: fakeResult({ offsetDegrees: 0.005 }), review }).foreground,
    ).toBe(true)
    expect(assessVia({ objectiveId: 'partial-retention', result: fakeResult(), review }).foreground).toBe(false)
    expect(assessVia({ objectiveId: 'partial-retention', result: null, review }).foreground).toBe(false)
  })

  it('knows a review has been started even with no run to rate it against', () => {
    expect(assessVia({ objectiveId: 'partial-retention', result: null, review: {} }).reviewStarted).toBe(false)
    expect(assessVia({ objectiveId: 'partial-retention', result: null, review: FULL_REVIEW }).reviewStarted).toBe(true)
  })
})

describe('viaStepStatuses', () => {
  const base = {
    hasViewpoint: true,
    blockCount: 1,
    hasLandform: true,
    hasResult: false,
    visited: false,
    numericalReady: false,
    assessment: null,
  }

  it('makes the first unfinished step current', () => {
    expect(viaStepStatuses({ ...base, hasLandform: false })).toEqual({
      identify: 'current',
      visit: 'todo',
      design: 'todo',
      assess: 'todo',
      rate: 'todo',
    })
    expect(viaStepStatuses(base).visit).toBe('current')
  })

  it('marks later steps done out of order', () => {
    const statuses = viaStepStatuses({ ...base, hasResult: true, numericalReady: true })
    expect(statuses).toMatchObject({ identify: 'done', visit: 'current', design: 'done' })
  })

  it('finishes with a rating and a rationale', () => {
    const assessment = assessVia({ objectiveId: 'partial-retention', result: fakeResult(), review: FULL_REVIEW })
    const statuses = viaStepStatuses({ ...base, hasResult: true, visited: true, numericalReady: true, assessment })
    expect(Object.values(statuses)).toEqual(['done', 'done', 'done', 'done', 'done'])
  })
})

describe('review storage and FS1252 hand-off', () => {
  it('drops anything it does not recognise', () => {
    const parsed = parseViaReview({
      ocular: { visibleness: 'glaring', scale: 'small', shape: 'natural', onBoundary: 'yes' },
      design: { 'force-lines': -1, position: 7 },
      roads: 5,
      retention: 'moderate',
      viewpointType: 4,
      rationale: 42,
    })
    expect(parsed).toEqual({
      ocular: { visibleness: null, scale: 'small', shape: 'natural', onBoundary: false },
      design: { 'force-lines': -1 },
      roads: null,
      retention: 'moderate',
      retentionNetted: false,
      viewpointType: 4,
      rationale: '',
    })
    expect(parseViaReview('nope')).toBeUndefined()
  })

  it('fills the five FS1252 design rows and leaves number, size and spacing off the form', () => {
    const assessment = assessVia({ objectiveId: 'partial-retention', result: fakeResult(), review: FULL_REVIEW })
    const form = fs1252ReviewFromVia(assessment, FULL_REVIEW)
    expect(form.design).toEqual([0, 0, 0, 0, 0])
    expect(form).toMatchObject({
      roads: 0,
      retention: 0,
      retentionAlreadyNetted: false,
      notes: 'Opening follows the hollow.',
    })
  })

  it('still gives FS1252 a retention row when netting made it irrelevant', () => {
    const review: ViaReview = { ...FULL_REVIEW, retention: null, retentionNetted: true }
    const assessment = assessVia({ objectiveId: 'partial-retention', result: fakeResult(), review })
    expect(fs1252ReviewFromVia(assessment, review)).toMatchObject({ retention: 0, retentionAlreadyNetted: true })
  })
})

describe('harvest systems (3.4.3.3 and 3.4.4)', () => {
  const withBlocks = (visible: Record<string, boolean>, area: Record<string, number> = {}) => {
    const result = fakeResult({ x: 3, openings: 2 })
    result.targets.forEach((target, index) => {
      const id = index === 0 ? 'b0' : 'p1'
      Object.assign(target, { targetId: id, visibleAreaMeters: visible[id] === false ? 0 : 1000, areaMeters: area[id] ?? 100000 })
    })
    return result
  }
  const clearcut = { id: 'b0', name: 'Block A' }
  const partial = { id: 'p1', name: 'Block B', harvestSystem: 'partial' as const, volumeRemovedPercent: 40, residualHeightMeters: 25 }

  it('adds a visible partial cut’s Table 6 figure to the cleared ground', () => {
    const assessment = assessVia({ objectiveId: 'partial-retention', result: withBlocks({}), review: FULL_REVIEW, blocks: [clearcut, partial] })
    // 40% removed among 25 m residuals reads as a 3.4% clearcut.
    expect(assessment.clearedPercent).toBe(3)
    expect(assessment.partialCuts).toEqual([{ id: 'p1', name: 'Block B', visible: true, equivalentPercent: 3.4 }])
    expect(assessment.initialPercent).toBeCloseTo(6.4, 10)
  })

  it('adds nothing for a partial cut the viewpoint cannot see', () => {
    const assessment = assessVia({ objectiveId: 'partial-retention', result: withBlocks({ p1: false }), review: FULL_REVIEW, blocks: [clearcut, partial] })
    expect(assessment.initialPercent).toBe(3)
  })

  it('withholds X until a visible partial cut has its volume and residual height', () => {
    const assessment = assessVia({
      objectiveId: 'partial-retention',
      result: withBlocks({}),
      review: FULL_REVIEW,
      blocks: [clearcut, { ...partial, residualHeightMeters: null }],
    })
    expect(assessment.initialPercent).toBeNull()
    expect(assessment.missing).toContain('Enter each visible partial cut’s volume removed and residual height')
  })

  it('reads Table 5 from the blocks’ retention, weighted by area, until the reviewer chooses', () => {
    const result = withBlocks({}, { b0: 100000, p1: 300000 })
    // 0% on 10 ha and 24% on 30 ha: 18% retained, moderate (−1).
    const blocks = [clearcut, { id: 'p1', name: 'Block B', harvestSystem: 'retention' as const, retentionPercent: 24 }]
    const review = { ...FULL_REVIEW, retention: null }
    const assessment = assessVia({ objectiveId: 'partial-retention', result, review, blocks })
    expect(assessment.retentionMeasured).toEqual({ percent: 18, level: 'moderate' })
    expect(assessment.retentionFactor).toBe(-1)
    expect(assessVia({ objectiveId: 'partial-retention', result, review: FULL_REVIEW, blocks }).retentionFactor).toBe(0)
  })

  it('offers no measured retention when no block records any', () => {
    expect(measuredRetention([clearcut], () => 1000)).toBeNull()
  })
})


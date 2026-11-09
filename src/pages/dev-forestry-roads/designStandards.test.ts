import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESIGN_STANDARDS,
  gradeRule,
  gradeRuleText,
  isGradeBreachFlag,
  parseDesignStandards,
  reviewGrades,
  type DesignStandards,
} from './designStandards'

const stations = (grades: (number | null)[], spacing = 10) =>
  grades.map((gradePercent, i) => ({ chainage: i * spacing, gradePercent }))
const standards = (patch: Partial<DesignStandards>): DesignStandards => ({ ...DEFAULT_DESIGN_STANDARDS, ...patch })
const settings = { maxGradePercent: 12 }

describe('gradeRule', () => {
  it('judges both directions on the road-wide limit when nothing else is entered', () => {
    const rule = gradeRule(settings)
    expect(rule).toEqual({ favourablePercent: 12, adversePercent: 12, loadedDirection: null, shortPitch: null })
    expect(gradeRuleText(rule)).toBe('12%')
  })

  it('needs a loaded direction before an adverse limit applies', () => {
    expect(gradeRule(settings, standards({ adverseGradePercent: 8 })).adversePercent).toBe(12)
    const rule = gradeRule(settings, standards({ adverseGradePercent: 8, loadedDirection: 'end-to-start' }))
    expect(rule.adversePercent).toBe(8)
    expect(gradeRuleText(rule)).toBe('12% favourable, 8% adverse')
  })

  it('never lets an adverse limit loosen the road-wide limit, or a pitch allowance sit below it', () => {
    const rule = gradeRule(
      settings,
      standards({
        adverseGradePercent: 15,
        loadedDirection: 'start-to-end',
        shortPitchGradePercent: 10,
        shortPitchMaxLengthM: 100,
      }),
    )
    expect(rule.adversePercent).toBe(12)
    expect(rule.shortPitch).toBeNull()
  })
})

describe('reviewGrades', () => {
  it('flags every station over the road-wide limit when there is no allowance', () => {
    const review = reviewGrades(stations([5, 13, 14, 6, -15, 4]), gradeRule(settings))
    expect(review.breaches.map((run) => [run.start, run.end, run.verdict])).toEqual([
      [10, 20, 'over-limit'],
      [40, 40, 'over-limit'],
    ])
    expect([...review.flags.entries()]).toEqual([
      [1, 'Grade exceeds 12%'],
      [2, 'Grade exceeds 12%'],
      [4, 'Grade exceeds 12%'],
    ])
    expect(review.steepest).toEqual({ percent: -15, chainage: 40 })
    expect(review.breachLengthM).toBe(30)
  })

  it('permits a pitch that is no steeper and no longer than the allowance', () => {
    const rule = gradeRule(settings, standards({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 50 }))
    // 12 %, 18 % for pitches up to 50 m: four stations at 10 m are a 40 m pitch.
    const review = reviewGrades(stations([8, 14, 17, 16, 13, 9]), rule)
    expect(review.breaches).toEqual([])
    expect(review.pitches).toHaveLength(1)
    expect(review.pitches[0]).toMatchObject({ start: 10, end: 40, lengthM: 40, worstPercent: 17 })
    expect(review.flags.size).toBe(0)
    expect(gradeRuleText(rule)).toBe('12%; 18% for pitches up to 50 m')
  })

  it('flags the whole pitch when it runs longer than the allowance', () => {
    const rule = gradeRule(settings, standards({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 30 }))
    const review = reviewGrades(stations([8, 14, 17, 16, 13, 9]), rule)
    expect(review.breaches[0].verdict).toBe('pitch-too-long')
    expect(review.breachStationCount).toBe(4)
    expect(review.flags.get(1)).toBe('Pitch over 12% runs 40 m; the allowance is 30 m')
  })

  it('flags only the stations past the allowance grade in a pitch that is short enough', () => {
    const rule = gradeRule(settings, standards({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 50 }))
    const review = reviewGrades(stations([8, 14, 20, 16, 9]), rule)
    expect(review.breaches[0].verdict).toBe('pitch-too-steep')
    expect([...review.flags.entries()]).toEqual([[2, 'Grade exceeds the 18% short-pitch limit']])
    expect(review.breachLengthM).toBe(10)
  })

  it('holds loaded uphill to the adverse limit and loaded downhill to the favourable one', () => {
    // Loaded trucks travel end to start, so a road climbing up-station is descended loaded.
    const rule = gradeRule(settings, standards({ adverseGradePercent: 8, loadedDirection: 'end-to-start' }))
    const review = reviewGrades(stations([10, 11, 2, -9, -10, 0]), rule)
    expect(review.breaches).toHaveLength(1)
    expect(review.breaches[0]).toMatchObject({ start: 30, end: 40, side: 'adverse', limitPercent: 8 })
    expect(review.flags.get(3)).toBe('Grade exceeds the 8% adverse limit')
    expect([...review.flags.values()].every(isGradeBreachFlag)).toBe(true)
  })

  it('ends a run at a station with no grade and at a change of direction', () => {
    const review = reviewGrades(stations([14, null, 14, -14]), gradeRule(settings))
    expect(review.runs.map((run) => [run.start, run.end])).toEqual([
      [0, 0],
      [20, 20],
      [30, 30],
    ])
  })
})

describe('parseDesignStandards', () => {
  it('round-trips a confirmed record', () => {
    const record = standards({
      adverseGradePercent: 8,
      loadedDirection: 'end-to-start',
      shortPitchGradePercent: 18,
      shortPitchMaxLengthM: 100,
      designVehicle: 'log-truck-pole-trailer',
      designSpeedKmh: 30,
      runningSurfaceWidthM: 5,
      maxClearingWidthM: 20,
      maxCrossDrainSpacingM: 150,
      source: 'Company road standard, class 3',
      confirmedOn: '2026-11-09',
    })
    expect(parseDesignStandards(JSON.parse(JSON.stringify(record)))).toEqual(record)
  })

  it('refuses half a short-pitch allowance and out-of-range limits', () => {
    expect(() => parseDesignStandards(standards({ shortPitchGradePercent: 18 }))).toThrow(/both/)
    expect(() => parseDesignStandards(standards({ adverseGradePercent: 0 }))).toThrow(/Adverse grade limit/)
    expect(() => parseDesignStandards({ ...DEFAULT_DESIGN_STANDARDS, loadedDirection: 'uphill' })).toThrow(/direction/)
  })
})

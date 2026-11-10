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

  it('keeps a pitch allowance that sits between the adverse limit and the road-wide limit', () => {
    // 18 % road-wide, 8 % loaded uphill, and 12 % for pitches up to 100 m.
    const rule = gradeRule(
      { maxGradePercent: 18 },
      standards({
        adverseGradePercent: 8,
        loadedDirection: 'start-to-end',
        shortPitchGradePercent: 12,
        shortPitchMaxLengthM: 100,
      }),
    )
    expect(rule.shortPitch).toEqual({ gradePercent: 12, maxLengthM: 100 })
    // It relaxes the adverse limit only, and the text says which side it is for.
    expect(gradeRuleText(rule)).toBe('18% favourable, 8% adverse; 12% for adverse pitches up to 100 m')
    // An allowance at or below every sustained limit still allows nothing.
    const none = gradeRule(
      { maxGradePercent: 18 },
      standards({
        adverseGradePercent: 8,
        loadedDirection: 'start-to-end',
        shortPitchGradePercent: 8,
        shortPitchMaxLengthM: 100,
      }),
    )
    expect(none.shortPitch).toBeNull()
  })
})

describe('reviewGrades', () => {
  it('flags every station over the road-wide limit when there is no allowance', () => {
    const review = reviewGrades(stations([5, 13, 14, 6, -15, 4]), gradeRule(settings), 'ahead')
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
    const review = reviewGrades(stations([8, 14, 17, 16, 13, 9]), rule, 'ahead')
    expect(review.breaches).toEqual([])
    expect(review.pitches).toHaveLength(1)
    expect(review.pitches[0]).toMatchObject({ start: 10, end: 40, lengthM: 40, worstPercent: 17 })
    expect(review.flags.size).toBe(0)
    expect(gradeRuleText(rule)).toBe('12%; 18% for pitches up to 50 m')
  })

  it('flags the whole pitch when it runs longer than the allowance', () => {
    const rule = gradeRule(settings, standards({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 30 }))
    const review = reviewGrades(stations([8, 14, 17, 16, 13, 9]), rule, 'ahead')
    expect(review.breaches[0].verdict).toBe('pitch-too-long')
    expect(review.breachStationCount).toBe(4)
    expect(review.flags.get(1)).toBe('Pitch over 12% runs 40 m; the allowance is 30 m')
  })

  it('flags only the stations past the allowance grade in a pitch that is short enough', () => {
    const rule = gradeRule(settings, standards({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 50 }))
    const review = reviewGrades(stations([8, 14, 20, 16, 9]), rule, 'ahead')
    expect(review.breaches[0].verdict).toBe('pitch-too-steep')
    expect([...review.flags.entries()]).toEqual([[2, 'Grade exceeds the 18% short-pitch limit']])
    expect(review.breachLengthM).toBe(10)
  })

  it('holds loaded uphill to the adverse limit and loaded downhill to the favourable one', () => {
    // Loaded trucks travel end to start, so a road climbing up-station is descended loaded.
    const rule = gradeRule(settings, standards({ adverseGradePercent: 8, loadedDirection: 'end-to-start' }))
    const review = reviewGrades(stations([10, 11, 2, -9, -10, 0]), rule, 'ahead')
    expect(review.breaches).toHaveLength(1)
    expect(review.breaches[0]).toMatchObject({ start: 30, end: 40, side: 'adverse', limitPercent: 8 })
    expect(review.flags.get(3)).toBe('Grade exceeds the 8% adverse limit')
    expect([...review.flags.values()].every(isGradeBreachFlag)).toBe(true)
  })

  it('applies an allowance between the two limits to loaded-uphill pitches only', () => {
    const rule = gradeRule(
      { maxGradePercent: 18 },
      standards({
        adverseGradePercent: 8,
        loadedDirection: 'start-to-end',
        shortPitchGradePercent: 12,
        shortPitchMaxLengthM: 100,
      }),
    )
    // 50 m at +10 %, loaded uphill: over the 8 % adverse limit, inside the 12 % allowance.
    const uphill = reviewGrades(stations([2, 2, 10, 10, 10, 10, 10, 2, 2]), rule, 'ahead')
    expect(uphill.breaches).toEqual([])
    expect(uphill.pitches).toHaveLength(1)
    expect(uphill.pitches[0]).toMatchObject({ side: 'adverse', limitPercent: 8, lengthM: 50, verdict: 'short-pitch' })
    expect(uphill.flags.size).toBe(0)
    // Past the allowance's grade on the same side, only those stations are flagged.
    const steep = reviewGrades(stations([2, 10, 13, 10, 2]), rule, 'ahead')
    expect([...steep.flags.entries()]).toEqual([[2, 'Grade exceeds the 12% short-pitch limit']])
    // Loaded downhill is held to 18 %, which the 12 % allowance cannot relax: a plain breach.
    const downhill = reviewGrades(stations([-2, -19, -19, -2]), rule, 'ahead')
    expect(downhill.breaches[0]).toMatchObject({ side: 'favourable', limitPercent: 18, verdict: 'over-limit' })
    expect([...downhill.flags.values()]).toEqual([
      'Grade exceeds the 18% favourable limit',
      'Grade exceeds the 18% favourable limit',
    ])
    // -15 % loaded downhill is inside 18 %: no run at all.
    expect(reviewGrades(stations([-2, -15, -15, -2]), rule, 'ahead').runs).toEqual([])
  })

  it('ends a run at a station with no grade and at a change of direction', () => {
    const review = reviewGrades(stations([14, null, 14, -14]), gradeRule(settings), 'ahead')
    expect(review.runs.map((run) => [run.start, run.end])).toEqual([
      [0, 0],
      [20, 20],
      [30, 30],
    ])
  })
})

describe('reviewGrades: the length of a pitch', () => {
  const rule = gradeRule(settings, standards({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 50 }))
  /**
   * A designed profile on a 300 m road at 10 m stations, 16 % from `from` to `to` and 5 % elsewhere.
   * A station carries the grade of the road ahead of it; the last one repeats the grade behind.
   */
  const designed = (from: number, to: number) =>
    stations(
      Array.from({ length: 31 }, (_, i) => {
        const s = i * 10
        return (s >= from && s < to) || (s === 300 && to === 300) ? 16 : 5
      }),
    )
  /** A ground-following road: a station carries the grade of the interval behind it, and station 0 repeats the first. */
  const ground = (from: number, to: number) =>
    stations(
      Array.from({ length: 31 }, (_, i) => {
        const end = Math.max(10, i * 10)
        return end > from && end <= to ? 16 : 5
      }),
    )
  const lengths = (review: ReturnType<typeof reviewGrades>) =>
    review.runs.map((run) => [run.start, run.end, run.lengthM, run.verdict])

  it('measures a designed 50 m pitch as 50 m at mid-road, at the start and at the end', () => {
    expect(lengths(reviewGrades(designed(100, 150), rule, 'ahead'))).toEqual([[100, 140, 50, 'short-pitch']])
    expect(lengths(reviewGrades(designed(0, 50), rule, 'ahead'))).toEqual([[0, 40, 50, 'short-pitch']])
    // At the road end the last station repeats the pitch's grade; it adds no length of its own.
    const atEnd = reviewGrades(designed(250, 300), rule, 'ahead')
    expect(lengths(atEnd)).toEqual([[250, 300, 50, 'short-pitch']])
    expect(atEnd.flags.size).toBe(0)
  })

  it('still refuses a designed pitch longer than the allowance, wherever it is', () => {
    for (const [from, to] of [
      [100, 160],
      [0, 60],
      [240, 300],
    ]) {
      const review = reviewGrades(designed(from, to), rule, 'ahead')
      expect(review.runs[0]).toMatchObject({ lengthM: 60, verdict: 'pitch-too-long' })
      expect(review.flags.get(review.runs[0].stationIndexes[0])).toBe('Pitch over 12% runs 60 m; the allowance is 50 m')
      expect(review.breachLengthM).toBe(60)
    }
  })

  it('measures a ground pitch by the intervals behind its stations', () => {
    // 40 m at the start: stations 0 to 40 carry it, and station 0 repeats the first interval.
    expect(lengths(reviewGrades(ground(0, 40), rule, 'behind'))).toEqual([[0, 40, 40, 'short-pitch']])
    expect(lengths(reviewGrades(ground(100, 150), rule, 'behind'))).toEqual([[110, 150, 50, 'short-pitch']])
    // 60 m at the end is over a 50 m allowance, and reads 60 m.
    expect(lengths(reviewGrades(ground(240, 300), rule, 'behind'))).toEqual([[250, 300, 60, 'pitch-too-long']])
    expect(lengths(reviewGrades(ground(250, 300), rule, 'behind'))).toEqual([[260, 300, 50, 'short-pitch']])
  })

  it('gives a lone over-limit station at a road end the interval beside it', () => {
    // The last station of a designed profile and the first of a ground road have no interval of their own.
    const last = reviewGrades(stations([5, 5, 5, 16]), rule, 'ahead')
    expect(lengths(last)).toEqual([[30, 30, 10, 'short-pitch']])
    const only = reviewGrades(stations([16]), rule, 'behind')
    expect(lengths(only)).toEqual([[0, 0, 0, 'short-pitch']])
  })

  it('flags the same stations as before when there are no standards', () => {
    const plain = gradeRule(settings)
    for (const span of ['ahead', 'behind'] as const)
      for (const [from, to] of [
        [100, 150],
        [0, 50],
        [250, 300],
      ]) {
        const profile = span === 'ahead' ? designed(from, to) : ground(from, to)
        const review = reviewGrades(profile, plain, span)
        const over = profile.flatMap((station, i) => (Math.abs(station.gradePercent!) > 12 ? [i] : []))
        expect([...review.flags.keys()]).toEqual(over)
        expect([...review.flags.values()].every((flag) => flag === 'Grade exceeds 12%')).toBe(true)
      }
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

  it('refuses a confirmation date that is not a real day', () => {
    for (const confirmedOn of ['2026-13-45', '2026-02-31', '2026-11-9', 'today'])
      expect(() => parseDesignStandards(standards({ confirmedOn }))).toThrow(
        'The design standards confirmation date must be a real date, written YYYY-MM-DD.',
      )
    expect(parseDesignStandards(standards({ confirmedOn: '2026-11-09' })).confirmedOn).toBe('2026-11-09')
  })

  it('refuses half a short-pitch allowance and out-of-range limits', () => {
    expect(() => parseDesignStandards(standards({ shortPitchGradePercent: 18 }))).toThrow(/both/)
    expect(() => parseDesignStandards(standards({ adverseGradePercent: 0 }))).toThrow(/Adverse grade limit/)
    expect(() => parseDesignStandards({ ...DEFAULT_DESIGN_STANDARDS, loadedDirection: 'uphill' })).toThrow(/direction/)
  })
})

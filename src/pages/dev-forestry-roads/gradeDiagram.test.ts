import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN_STANDARDS, gradeRule, reviewGrades } from './designStandards'
import {
  DEFAULT_GRADE_AVERAGE,
  GRADE_AVERAGE_LIMITS,
  GROUND_GRADE_CHORD_M,
  gradeDiagram,
  groundGradeChords,
  groundGradeIntervals,
  parseGradeAverage,
  rollingGrade,
  steepestAverage,
} from './gradeDiagram'

const designed = { vertical: [{ id: 'a', chainage: 0, elevation: 0 }] } as never
const groundFollowing = { vertical: [] }
const rule = gradeRule({ maxGradePercent: 12 })

const stations = (grades: (number | null)[], spacing = 10, ground?: (number | null)[]) =>
  grades.map((gradePercent, i) => ({
    chainage: i * spacing,
    gradePercent,
    groundElevation: ground ? ground[i] : i * spacing * 0.05,
  }))

describe('groundGradeChords', () => {
  it('reads each chord between stations at least the chord length apart, plotted at its middle', () => {
    const points = groundGradeChords(
      [0, 5, 10, 20].map((chainage) => ({ chainage, groundElevation: chainage * 0.1 })),
      10,
    )
    expect(points).toEqual([
      { start: 0, end: 10, chainage: 5, gradePercent: 10 },
      { start: 10, end: 20, chainage: 15, gradePercent: 10 },
    ])
  })

  it('does not read a short interval beside an event station as a pitch', () => {
    // A 0.5 m interval with 0.3 m of micro-relief is 60 % on its own; over the chord it is not.
    const points = groundGradeChords([
      { chainage: 0, groundElevation: 100 },
      { chainage: 12, groundElevation: 101 },
      { chainage: 12.5, groundElevation: 101.3 },
      { chainage: 24, groundElevation: 102 },
    ])
    expect(GROUND_GRADE_CHORD_M).toBe(12)
    expect(points.every((p) => p.end - p.start >= 12)).toBe(true)
    expect(Math.max(...points.map((p) => Math.abs(p.gradePercent!)))).toBeCloseTo(10.4, 6)
  })

  it('leaves a chord over missing terrain unknown, never zero', () => {
    const points = groundGradeChords(
      [0, 10, 20, 30].map((chainage, i) => ({ chainage, groundElevation: i === 1 ? null : 50 })),
      10,
    )
    expect(points.map((p) => p.gradePercent)).toEqual([null, null, 0])
  })

  it('gives a road shorter than the chord one chord, end to end', () => {
    const points = groundGradeChords([
      { chainage: 0, groundElevation: 0 },
      { chainage: 6, groundElevation: 0.6 },
    ])
    expect(points).toEqual([{ start: 0, end: 6, chainage: 3, gradePercent: 10 }])
  })
})

describe('gradeDiagram', () => {
  it('holds each design grade over the interval ahead of its station', () => {
    const diagram = gradeDiagram(stations([4, 4, -6, -6]), designed, rule)
    expect(diagram.design).toEqual([
      { start: 0, end: 10, gradePercent: 4, station: 0 },
      { start: 10, end: 20, gradePercent: 4, station: 1 },
      { start: 20, end: 30, gradePercent: -6, station: 2 },
    ])
    expect(diagram.groundFollowing).toBe(false)
  })

  it('shades exactly the road the grade standard flags', () => {
    const road = stations([5, 14, 15, 5, -13, 5])
    const diagram = gradeDiagram(road, designed, rule)
    expect(diagram.spans).toEqual([
      { start: 10, end: 30, kind: 'breach' },
      { start: 40, end: 50, kind: 'breach' },
    ])
    const review = reviewGrades(road, rule, 'ahead')
    expect(diagram.breachLengthM).toBe(review.breachLengthM)
    expect(diagram.steepest).toEqual({ percent: 15, chainage: 20 })
  })

  it('marks a permitted short pitch apart from a breach', () => {
    const pitchRule = gradeRule(
      { maxGradePercent: 12 },
      { ...DEFAULT_DESIGN_STANDARDS, shortPitchGradePercent: 16, shortPitchMaxLengthM: 30 },
    )
    const diagram = gradeDiagram(stations([5, 14, 14, 5]), designed, pitchRule)
    expect(diagram.spans).toEqual([{ start: 10, end: 30, kind: 'pitch' }])
    expect(diagram.shortPitch).toEqual({ percent: 16, maxLengthM: 30 })
  })

  it('draws the directional limits on their own side of zero', () => {
    const directional = gradeRule(
      { maxGradePercent: 12 },
      { ...DEFAULT_DESIGN_STANDARDS, adverseGradePercent: 8, loadedDirection: 'end-to-start' },
    )
    // Loaded from the end towards the start climbs where the grade falls up-station.
    const { limits } = gradeDiagram(stations([1, 1]), designed, directional)
    expect(limits.rising).toEqual({ percent: 12, side: 'favourable' })
    expect(limits.falling).toEqual({ percent: -8, side: 'adverse' })
  })

  it('draws no design steps for a road that follows the ground, and still judges its grade', () => {
    const diagram = gradeDiagram(stations([20, 20, 2]), groundFollowing, rule)
    expect(diagram.design).toEqual([])
    expect(diagram.groundFollowing).toBe(true)
    expect(diagram.spans).toEqual([{ start: 0, end: 10, kind: 'breach' }])
  })

  it('judges nothing on a terrain profile', () => {
    const diagram = gradeDiagram(stations([20, 20, 2]), groundFollowing, rule, { terrainOnly: true })
    expect(diagram.spans).toEqual([])
    expect(diagram.steepest).toBeNull()
    expect(diagram.ground.length).toBeGreaterThan(0)
  })
})

describe('rollingGrade', () => {
  const steps = (grades: (number | null)[], spacing = 10) =>
    grades.map((gradePercent, i) => ({ start: i * spacing, end: (i + 1) * spacing, gradePercent }))

  it('is the length-weighted mean over a window centred on each interval', () => {
    const points = rollingGrade(steps([0, 10, 20, 10, 0]), 30)
    expect(points.map((p) => p.chainage)).toEqual([5, 15, 25, 35, 45])
    expect(points[2].gradePercent).toBeCloseTo((10 + 20 + 10) / 3, 9)
    // A window that takes half an interval weights it by half.
    expect(rollingGrade(steps([0, 10, 20]), 20)[1].gradePercent).toBeCloseTo((0 * 5 + 10 * 10 + 20 * 5) / 20, 9)
  })

  it('equals the rise across the window divided by its length over complete ground', () => {
    const ground = [100, 101, 103, 103.5, 106, 107].map((z, i) => ({ chainage: i * 10, groundElevation: z }))
    const point = rollingGrade(groundGradeIntervals(ground), 40)[2]
    // Centred on 25 m: from 5 m (100.5) to 45 m (106.5).
    expect(point.gradePercent).toBeCloseTo(((106.5 - 100.5) / 40) * 100, 9)
  })

  it('cuts the window to the road at its ends rather than padding it', () => {
    const [first] = rollingGrade(steps([10, 0, 0, 0]), 40)
    expect([first.start, first.end]).toEqual([0, 25])
    expect(first.gradePercent).toBeCloseTo((10 * 10) / 25, 9)
  })

  it('leaves out unknown ground, and is unknown when too little of the window is known', () => {
    const road = steps([10, null, null, 10, 10])
    // At 25 m a 20 m window (15–35) knows 5 m of 20; at 35 m a 30 m window (20–50) knows 20 m of 30.
    expect(rollingGrade(road, 20, 0.5)[2].gradePercent).toBeNull()
    expect(rollingGrade(road, 30, 0.5)[3].gradePercent).toBeCloseTo(10, 9)
    expect(rollingGrade(road, 30, 1)[3].gradePercent).toBeNull()
  })

  it('names the steepest average either way', () => {
    expect(steepestAverage(rollingGrade(steps([2, -9, -9, 3]), 10))).toEqual({ percent: -9, chainage: 15 })
  })
})

describe('parseGradeAverage', () => {
  it('keeps what it can read, clamps lengths into the limits and defaults the rest', () => {
    expect(parseGradeAverage(null)).toEqual(DEFAULT_GRADE_AVERAGE)
    expect(parseGradeAverage({ enabled: true, windowM: 5, series: 'both', minCoveragePercent: 'x' })).toEqual({
      ...DEFAULT_GRADE_AVERAGE,
      enabled: true,
      windowM: GRADE_AVERAGE_LIMITS.windowM.min,
      series: 'both',
    })
    expect(parseGradeAverage({ windowM: 5000, series: 'sideways' }).windowM).toBe(GRADE_AVERAGE_LIMITS.windowM.max)
  })
})

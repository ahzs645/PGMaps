import { describe, expect, it } from 'vitest'
import { gradeRule, DEFAULT_DESIGN_STANDARDS } from './designStandards'
import { profileGradeSpans } from './EngineeringBands'
import { analyzeRoad, designProfileAt, offsetCoordinate } from './engine'
import { DEFAULT_CULVERT_SEARCH_M } from './hydrology'
import {
  curvePointDetail,
  curvePointLabel,
  curvePoints,
  earthworkText,
  isGradeTrouble,
  placeLabels,
  pviDragReadout,
  SAG_CULVERT_SEARCH_M,
  tangentGrades,
} from './profileAnnotations'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, VerticalPoint } from './types'

const origin: Coordinate = [-122.8, 53.9]
const road = (vertical: VerticalPoint[], extra: Partial<Alignment> = {}): Alignment => ({
  id: 'r',
  name: 'Road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 90, 800), radiusM: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  vertical,
  overrides: [],
  ...extra,
})
// +10 % to a crest at 200 m (100 m curve), −5 % to a sharp sag at 400 m, then +1 % to 600 m and on.
const vertical: VerticalPoint[] = [
  { id: 'p0', chainage: 0, elevation: 800, curveLength: 0 },
  { id: 'p1', chainage: 200, elevation: 820, curveLength: 100 },
  { id: 'p2', chainage: 400, elevation: 810, curveLength: 0 },
  { id: 'p3', chainage: 600, elevation: 812, curveLength: 0 },
  { id: 'p4', chainage: 800, elevation: 812, curveLength: 0 },
]
const rule = (maxGradePercent: number, standards = {}) =>
  gradeRule({ maxGradePercent }, { ...DEFAULT_DESIGN_STANDARDS, ...standards })

describe('tangent grades on the profile', () => {
  it('runs PVI to PVI with the ids and extents of the grade band', () => {
    const alignment = road(vertical)
    const tangents = tangentGrades(alignment, 800)
    const spans = profileGradeSpans({ length: 800, stations: [] } as never, alignment)
    expect(tangents.map((t) => [t.id, t.start, t.end])).toEqual(spans.map((s) => [s.id, s.start, s.end]))
    expect(tangents.map((t) => t.gradePercent)).toEqual([10, -5, 1, 0])
    expect(tangents.every((t) => t.verdict === 'ok')).toBe(true)
    expect(tangentGrades(road([vertical[0]]), 800)).toEqual([])
    expect(tangentGrades(alignment, 0)).toEqual([])
  })

  it('flags tangents over the grade limit, and keeps a short pitch the allowance permits', () => {
    const alignment = road(vertical)
    const [climb, descent] = tangentGrades(alignment, 800, { rule: rule(8) })
    expect(climb.verdict).toBe('over-limit')
    expect(climb.limitPercent).toBe(8)
    expect(climb.message).toBe('Tangent 0+000.0–0+200.0 at +10.0% is over the 8% grade limit.')
    expect(isGradeTrouble(climb)).toBe(true)
    expect(descent.verdict).toBe('ok')
    // A 12 % allowance for 250 m covers the 200 m climb; for 150 m it does not.
    const allowed = tangentGrades(alignment, 800, {
      rule: rule(8, { shortPitchGradePercent: 12, shortPitchMaxLengthM: 250 }),
    })[0]
    expect(allowed.verdict).toBe('short-pitch')
    expect(isGradeTrouble(allowed)).toBe(false)
    expect(
      tangentGrades(alignment, 800, { rule: rule(8, { shortPitchGradePercent: 12, shortPitchMaxLengthM: 150 }) })[0]
        .verdict,
    ).toBe('over-limit')
  })

  it('holds a loaded climb to the adverse limit only', () => {
    const limits = { rule: rule(12, { adverseGradePercent: 4, loadedDirection: 'end-to-start' }) }
    // Loaded trucks travel toward the start: the −5 % descent is their climb.
    const [climb, descent] = tangentGrades(road(vertical), 800, limits)
    expect(climb.verdict).toBe('ok')
    expect(descent.verdict).toBe('over-limit')
    expect(descent.message).toContain('adverse 4% grade limit')
  })

  it('judges the signed windows of the vertical standards over the length they share', () => {
    const alignment = road(vertical, {
      verticalStandards: {
        gradeRanges: [
          { id: 'g1', start: 300, end: null, minGradePercent: -4, maxGradePercent: null },
          // Only touches the first tangent's end, so it does not hold it.
          { id: 'g2', start: 200, end: 200, minGradePercent: null, maxGradePercent: 2 },
          { id: 'g3', start: 600, end: 800, minGradePercent: 0.5, maxGradePercent: null },
        ],
        minSagK: null,
        minCrestK: null,
        minCurveLengthM: null,
        minTangentLengthM: null,
      },
    })
    const tangents = tangentGrades(alignment, 800)
    expect(tangents.map((t) => t.verdict)).toEqual(['ok', 'under-range', 'ok', 'under-range'])
    expect(tangents[1].message).toBe(
      "Tangent 0+200.0–0+400.0 at −5.0% is below the −4.0% minimum of the road's vertical standards.",
    )
    expect(tangents[3].limitPercent).toBe(0.5)
  })
})

describe('curve points', () => {
  it('labels BVC, EVC and the crest high point on the fitted curve', () => {
    const alignment = road(vertical)
    const points = curvePoints(alignment, 800, [{ chainage: 405 }])
    const crest = points.filter((p) => p.pviId === 'p1')
    expect(crest.map((p) => p.kind)).toEqual(['bvc', 'high', 'evc'])
    const [bvc, high, evc] = crest
    expect(bvc.chainage).toBe(150)
    expect(bvc.elevation).toBeCloseTo(815, 9)
    expect(evc.chainage).toBe(250)
    expect(evc.elevation).toBeCloseTo(817.5, 9)
    // x = −g1·L/(g2 − g1) = 0.10 × 100 / 0.15 from the BVC.
    expect(high.chainage).toBeCloseTo(150 + 200 / 3, 9)
    const design = designProfileAt(alignment, high.chainage)!
    expect(high.elevation).toBeCloseTo(design.elevation, 9)
    expect(design.grade).toBeCloseTo(0, 9)
    expect(high.curve!.lengthM).toBe(100)
    expect(high.curve!.k).toBeCloseTo(100 / 15, 9)
    expect(curvePointLabel(bvc)).toBe('BVC 0+150.0 · 815.00')
    expect(curvePointDetail(high)).toContain('Crest high point 0+216.7, elevation 818.33 m. Curve L 100.0 m, K 6.7.')
  })

  it('puts a sharp sag at its PVI and flags it when no culvert is near', () => {
    const alignment = road(vertical)
    const sag = (culverts: { chainage: number }[]) =>
      curvePoints(alignment, 800, culverts).find((p) => p.kind === 'low')!
    expect(sag([]).chainage).toBe(400)
    expect(sag([]).elevation).toBe(810)
    expect(sag([]).curve).toBeUndefined()
    expect(sag([])).toMatchObject({ nearestCulvertM: null, noCulvert: true })
    expect(curvePointLabel(sag([]))).toBe('LP 0+400.0 · 810.00 · no culvert')
    expect(curvePointDetail(sag([]))).toContain('No culvert entered on this road')
    expect(sag([{ chainage: 400 + SAG_CULVERT_SEARCH_M }])).toMatchObject({ noCulvert: false })
    expect(sag([{ chainage: 420 }, { chainage: 900 }])).toMatchObject({ nearestCulvertM: 20, noCulvert: true })
    // The flat tangent past 600 m has no single high point, and road ends are never marked.
    expect(curvePoints(alignment, 800).map((p) => p.kind)).toEqual(['bvc', 'high', 'evc', 'low'])
  })

  it('uses the drainage check’s culvert distance', () => {
    expect(SAG_CULVERT_SEARCH_M).toBe(DEFAULT_CULVERT_SEARCH_M)
  })

  it('marks the high point at the PVI when the entered curve cannot be fitted', () => {
    const alignment = road(vertical.map((p) => (p.id === 'p1' ? { ...p, curveLength: 500 } : p)))
    const points = curvePoints(alignment, 800).filter((p) => p.pviId === 'p1')
    expect(points).toEqual([
      { id: 'p1-high', kind: 'high', chainage: 200, elevation: 820, pviId: 'p1', curve: undefined },
    ])
  })
})

describe('label placement', () => {
  it('keeps the most important labels and drops the ones that would overlap', () => {
    const items = [
      { id: 'a', x: 10, priority: 1 },
      { id: 'b', x: 15, priority: 3 },
      { id: 'c', x: 30, priority: 1 },
      { id: 'd', x: 31, priority: 2 },
      { id: 'e', x: Number.NaN, priority: 9 },
    ]
    expect(placeLabels(items, 10).map((i) => i.id)).toEqual(['b', 'd'])
    // Two rows stagger instead of dropping.
    expect(placeLabels(items, 10, 2).map((i) => [i.id, i.row])).toEqual([
      ['a', 1],
      ['b', 0],
      ['c', 1],
      ['d', 0],
    ])
  })
})

describe('PVI drag readout', () => {
  it('gives the grade in and out and the deepest cut and fill each side, unknown where ground is missing', () => {
    const alignment = road(vertical)
    // Ground falls 1 m per 100 m east; a gap between 520 and 560 m.
    const metresEast = (lng: number) =>
      ((lng - origin[0]) * Math.PI * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)) / 180
    const analysis = analyzeRoad(
      alignment,
      {
        elevationAt: (lng) => {
          const x = metresEast(lng)
          return x > 515 && x < 565 ? Number.NaN : 812 - x / 100
        },
      },
      DEFAULT_ROAD_SETTINGS,
    )
    const readout = pviDragReadout(analysis, alignment, 'p2')!
    expect(readout.gradeInPercent).toBeCloseTo(-5, 9)
    expect(readout.gradeOutPercent).toBeCloseTo(1, 9)
    const expected = (start: number, end: number) => {
      const depths = analysis.stations
        .filter((s) => s.chainage >= start && s.chainage <= end && s.groundElevation !== null)
        .map((s) => ({ chainage: s.chainage, depthM: s.groundElevation! - s.designElevation! }))
      const deepest = (sign: 1 | -1) =>
        depths
          .filter((d) => sign * d.depthM > 0)
          .reduce<{
            chainage: number
            depthM: number
          } | null>(
            (best, d) =>
              !best || sign * d.depthM > best.depthM ? { chainage: d.chainage, depthM: sign * d.depthM } : best,
            null,
          )
      return { cut: deepest(1), fill: deepest(-1) }
    }
    const back = expected(200, 400)
    // From 812 m ground at the start, the crest and the −5 % descent run above it: all fill.
    expect(back.cut).toBeNull()
    expect(readout.back!.deepestCut).toBeNull()
    expect(readout.back!.deepestFill).toEqual(back.fill)
    expect(readout.back!.deepestFill!.depthM).toBeGreaterThan(5)
    expect(readout.back!.unknownStations).toBe(0)
    expect(readout.ahead!.start).toBe(400)
    expect(readout.ahead!.end).toBe(600)
    expect(readout.ahead!.unknownStations).toBeGreaterThan(0)
    expect(earthworkText(readout.ahead!, 'fill')).toMatch(/^F ≥ \d+\.\d\d @ 0\+\d{3}\.\d$/)
    // Ground at 816 m: cut at the start, fill where the climb rises over it.
    const level = analyzeRoad(alignment, { elevationAt: () => 816 }, DEFAULT_ROAD_SETTINGS)
    const crest = pviDragReadout(level, alignment, 'p1')!
    expect(crest.back!.deepestCut).toEqual({ chainage: 0, depthM: 16 })
    expect(crest.back!.deepestFill!.depthM).toBeGreaterThan(0)
    expect(earthworkText(crest.back!, 'cut')).toBe('C 16.00 @ 0+000.0')
    expect(pviDragReadout(analysis, alignment, 'missing')).toBeNull()
    const first = pviDragReadout(analysis, alignment, 'p0')!
    expect(first.gradeInPercent).toBeNull()
    expect(first.back).toBeNull()
    expect(
      earthworkText(
        { start: 0, end: 1, gradePercent: 0, deepestCut: null, deepestFill: null, unknownStations: 0 },
        'cut',
      ),
    ).toBe('no cut')
  })
})

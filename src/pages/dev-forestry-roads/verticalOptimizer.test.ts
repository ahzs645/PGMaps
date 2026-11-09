import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate, verticalCurveSummary } from './engine'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import {
  designElevationAt,
  optimizeVerticalProfile,
  optimizeVerticalProfileAsync,
  verticalOptimizationLog,
} from './verticalOptimizer'
import type { Alignment, Coordinate, RoadSettings, TerrainSource } from './types'
import type { VerticalControl } from './verticalStandards'

const ORIGIN: Coordinate = [-122.8, 53.9]
const settings: RoadSettings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 18 }
/** Metres east and north of the origin, on the sphere the engine measures with. */
const local = (lon: number, lat: number) => [
  (lon - ORIGIN[0]) * 111_194.93 * Math.cos((ORIGIN[1] * Math.PI) / 180),
  (lat - ORIGIN[1]) * 111_194.93,
]
/** A hillside falling 6 % to the east with a gentle roll; `shape` adds to it or cuts a hole in it. */
const hillside = (shape: (x: number, y: number) => number = () => 0): TerrainSource => ({
  elevationAt: (lon, lat) => {
    const [x, y] = local(lon, lat)
    return 798.791548 - 0.06 * x + 2 * Math.sin(x / 45) + 0.08 * y + shape(x, y)
  },
})
/** A straight road running east from the origin. */
const road = (lengthM: number, patch: Partial<Alignment> = {}): Alignment => ({
  id: 'road',
  name: 'Test road',
  color: '#d97706',
  points: [
    { id: 'a', coordinate: ORIGIN, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(ORIGIN, 90, lengthM), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
  ...patch,
})
const control = (patch: Partial<VerticalControl>): VerticalControl => ({
  id: 'c',
  chainage: 0,
  elevation: null,
  toleranceAboveM: 0,
  toleranceBelowM: 0,
  gradePercent: null,
  gradeTolerancePercent: 0,
  ...patch,
})
const standards = {
  gradeRanges: [{ id: 'g', start: null, end: null, minGradePercent: -12, maxGradePercent: 18 }],
  minSagK: 4,
  minCrestK: 3,
  minCurveLengthM: null,
  minTangentLengthM: null,
}

describe('profile optimizer controls', () => {
  it('holds a start control at the ground elevation the workspace filled in', () => {
    const terrain = hillside()
    const ground = terrain.elevationAt(...ORIGIN)
    // The reported case: not a whole millimetre, zero tolerance, both ends tied.
    expect(ground).toBeCloseTo(798.791548, 6)
    const alignment = road(600, {
      verticalStandards: standards,
      verticalControls: [control({ elevation: ground })],
    })
    const result = optimizeVerticalProfile(alignment, 600, terrain, settings, { k: 4 })
    expect(result.vertical[0].elevation).toBe(ground)
    const checked = analyzeRoad({ ...alignment, vertical: result.vertical }, terrain, settings)
    expect(checked.verticalChecks ?? []).toEqual([])
    expect(result.report.ends).toEqual({ start: 'control', end: 'ground' })
    expect(result.report.controls).toEqual([
      expect.objectContaining({ chainage: 0, elevation: ground, achievedElevation: ground }),
    ])
  })

  it('holds a grade read off the current profile, with no tolerance', () => {
    const terrain = hillside()
    const before = optimizeVerticalProfile(road(600), 600, terrain, settings, { k: 4 })
    const designed = road(600, { vertical: before.vertical })
    const at = 300
    const grade =
      (100 * (designElevationAt(before.vertical, at + 0.01) - designElevationAt(before.vertical, at - 0.01))) / 0.02
    const alignment = {
      ...designed,
      verticalControls: [
        control({ chainage: at, elevation: designElevationAt(before.vertical, at), gradePercent: grade }),
      ],
    }
    const result = optimizeVerticalProfile(alignment, 600, terrain, settings, { k: 4 })
    const checked = analyzeRoad({ ...alignment, vertical: result.vertical }, terrain, settings)
    expect(checked.verticalChecks ?? []).toEqual([])
    expect(result.report.controls[0].achievedGradePercent).toBeCloseTo(grade, 6)
  })

  it('names the control and the limit it breaks when its grade cannot be met', () => {
    const alignment = road(600, { verticalControls: [control({ chainage: 300, gradePercent: 25 })] })
    expect(() => optimizeVerticalProfile(alignment, 600, hillside(), settings)).toThrow(
      /No profile meets the limits between 0\+250\.0 and 0\+300\.0\. Control 1 at 0\+300\.0 asks for a grade of 25\.0% \(±0\.0%\), outside the −18\.0% to 18\.0% grade limit there/,
    )
  })

  it('names the stretch and the grade limit when the ground is too steep for the search band', () => {
    // A 30 m bench drop between 200 m and 250 m: 60 % against an 18 % limit, with ±5 m to work in.
    const terrain = hillside((x) => -30 * Math.max(0, Math.min(1, (x - 200) / 50)))
    expect(() => optimizeVerticalProfile(road(600), 600, terrain, settings)).toThrow(
      /No profile meets the limits between 0\+200\.0 and 0\+250\.0\. Every line within ±5 m of the ground would run at −\d+\.\d% to −\d+\.\d% there, outside the −18\.0% to 18\.0% grade limit\. Widen “Search ±”/,
    )
  })

  it('says a tied end holds the line when that is what breaks the grade limit', () => {
    // The last 50 m falls 15 m: the end is tied to the bottom of it.
    const terrain = hillside((x) => -15 * Math.max(0, Math.min(1, (x - 550) / 50)))
    expect(() => optimizeVerticalProfile(road(600), 600, terrain, settings)).toThrow(
      /between 0\+550\.0 and 0\+600\.0\..*the road end is tied to ground at \d+\.\d\d m\. Widen “Search ±” so the line can cut or fill more, loosen what holds it/,
    )
  })
})

describe('profile optimizer vertical curves', () => {
  /** Rolling ground: three sine waves on a slope. Each set is one where simplifying used to cost a curve. */
  const rolling = (a: number[], w: number[], p: number[], slope: number): TerrainSource => ({
    elevationAt: (lon, lat) => {
      const [x, y] = local(lon, lat)
      return (
        800 +
        slope * x +
        a[0] * Math.sin(x / w[0] + p[0]) +
        a[1] * Math.sin(x / w[1] + p[1]) +
        a[2] * Math.sin(x / w[2] + p[2]) +
        0.05 * y
      )
    },
  })
  const cases: [number, TerrainSource][] = [
    [
      10,
      rolling(
        [1.5787274539470673, 1.2537609338760376, 1.1088279366493226],
        [113.95418167114258, 27.102200984954834, 20.317282497882843],
        [2.0312726497650146, 5.767273664474487, 4.834645986557007],
        -0.017499828338623048,
      ),
    ],
    [
      10,
      rolling(
        [3.9386297166347504, 0.9776630401611328, 0.6954344093799592],
        [71.86892509460449, 33.87234419584274, 18.333301067352295],
        [5.3988518714904785, 3.686558246612549, 0.7174515724182129],
        0.019006772041320803,
      ),
    ],
    [
      20,
      rolling(
        [1.672194480895996, 1.3490734696388245, 1.2357494115829468],
        [74.52536582946777, 52.007581889629364, 17.26402711868286],
        [3.3360114097595215, 4.163608074188232, 2.0718398094177246],
        0.05041034698486328,
      ),
    ],
    [
      20,
      rolling(
        [3.0122143030166626, 2.2239692211151123, 1.005656886100769],
        [104.11463737487793, 51.55938744544983, 13.305221319198608],
        [2.300839841365814, 1.25059175491333, 2.8181979060173035],
        -0.007541179656982422,
      ),
    ],
  ]

  it('returns only profiles whose curves the engine builds, at the K asked for', () => {
    for (const [k, terrain] of cases) {
      const result = optimizeVerticalProfile(road(400), 400, terrain, settings, { k })
      const designed = { ...road(400), vertical: result.vertical }
      const curves = verticalCurveSummary(designed)
      // Simplifying these lines left two curves overlapping, which the engine dropped without a word.
      expect(curves.filter((curve) => !curve.valid)).toEqual([])
      expect(curves.every((curve) => curve.k === null || curve.k >= k - 1e-6)).toBe(true)
      // Every grade break has its curve: none is left unrounded.
      const breaks = result.vertical.slice(1, -1).filter((p, i) => {
        const before = result.vertical[i],
          after = result.vertical[i + 2]
        const g1 = (p.elevation - before.elevation) / (p.chainage - before.chainage),
          g2 = (after.elevation - p.elevation) / (after.chainage - p.chainage)
        return Math.abs(g2 - g1) * 100 > 0.05
      })
      expect(breaks.every((p) => p.curveLength > 0)).toBe(true)
      const warnings = analyzeRoad(designed, terrain, settings).warnings
      expect(warnings.filter((warning) => /tangent grades are retained/.test(warning))).toEqual([])
    }
  })

  it('still simplifies where a finer tolerance keeps every curve', () => {
    const [k, terrain] = cases[0]
    const result = optimizeVerticalProfile(road(400), 400, terrain, settings, { k })
    const unsimplified = optimizeVerticalProfile(road(400), 400, terrain, settings, { k, simplifyToleranceM: 0 })
    expect(result.vertical.length).toBeLessThanOrEqual(unsimplified.vertical.length)
    expect(result.message).toMatch(/K ≥ 10/)
  })
})

describe('profile optimizer on terrain with gaps', () => {
  /** No ground in a strip across the road from `from` to `to` metres along it. */
  const gap = (from: number, to: number) => hillside((x) => (x > from && x < to ? NaN : 0))

  it('moves a PVI off a gap instead of refusing the road', () => {
    // 600 m at 50 m spacing puts a PVI at 250 m, in the middle of this gap.
    const terrain = gap(247, 254)
    const result = optimizeVerticalProfile(road(600), 600, terrain, settings)
    expect(result.report.pvis.movedOffGaps).toBe(1)
    const checked = analyzeRoad({ ...road(600), vertical: result.vertical }, terrain, settings)
    expect(checked.maxGradePercent).toBeLessThanOrEqual(settings.maxGradePercent + 1e-6)
    expect(checked.coveragePercent).toBeLessThan(100)
    expect(result.report.result.incompleteLengthM).toBeGreaterThan(5)
    expect(result.report.notes.join(' ')).toMatch(/m of the road has no complete section/)
    expect(result.report.notes.join(' ')).toMatch(/1 PVI was moved off a gap in the terrain/)
  })

  it('searches around the ground either side when a gap is wider than the PVI spacing', () => {
    const terrain = gap(220, 290)
    const result = optimizeVerticalProfile(road(600), 600, terrain, settings)
    // Nothing within half a spacing of 250 m has ground, so that PVI stays and reads across the gap.
    expect(result.report.pvis.movedOffGaps).toBe(0)
    const z = designElevationAt(result.vertical, 250)
    const either = (terrain.elevationAt(...offsetCoordinate(ORIGIN, 90, 219)) + 798.791548 - 0.06 * 291) / 2
    expect(Math.abs(z - either)).toBeLessThan(8)
  })

  it('refuses to tie an end to ground that is not there, and says which end', () => {
    expect(() => optimizeVerticalProfile(road(600), 600, gap(-5, 4), settings)).toThrow(
      /The road start \(0\+000\.0\) is on a gap in the terrain, so it cannot be tied to ground\. Move that end onto mapped ground, set a control point there, or untick “Tie both ends to ground”\./,
    )
    // Untied, or held by a control, the same road is designed.
    expect(
      optimizeVerticalProfile(road(600), 600, gap(-5, 4), settings, { tieEndsToGround: false }).vertical.length,
    ).toBeGreaterThan(1)
    const held = road(600, { verticalControls: [control({ elevation: 799 })] })
    expect(optimizeVerticalProfile(held, 600, gap(-5, 4), settings).vertical[0].elevation).toBe(799)
  })
})

describe('profile optimizer result log', () => {
  it('reports what was sampled, the limits used and the earthwork it left unbalanced', () => {
    // Fill costs far more than cut here, so the cheapest line cuts and leaves spoil.
    const terrain = hillside((x) => 6 * Math.exp(-(((x - 300) / 60) ** 2)))
    const rates = { ...settings, cutRate: 4, fillRate: 30 }
    const alignment = road(600, { verticalStandards: standards })
    const result = optimizeVerticalProfile(alignment, 600, terrain, rates, { k: 4 })
    const checked = analyzeRoad({ ...alignment, vertical: result.vertical }, terrain, rates)
    const { report } = result
    expect(report.sections).toEqual({ count: 61, spacingM: 10, solves: result.sectionSolves })
    expect(report.pvis).toMatchObject({ searched: 13, spacingM: 50, kept: result.vertical.length })
    expect(report.band).toEqual({ centre: 'ground', depthM: 5, levelStepM: 0.5, levelsPerPvi: 21 })
    expect(report.limits).toMatchObject({ maxGradePercent: 18, gradeRanges: 1, curveK: 4, minSagK: 4, minCrestK: 3 })
    expect(report.result.cutM3).toBeCloseTo(checked.cutVolumeM3, 6)
    expect(report.result.fillM3).toBeCloseTo(checked.fillVolumeM3, 6)
    expect(report.result.estimatedCost).toBeCloseTo(checked.estimatedCost, 6)
    // Waste is usable cut left after filling, as bank volume: the figure the haul table shows.
    expect(report.result.wasteBankM3).toBeCloseTo(
      (checked.cutVolumeM3 * rates.shrinkFactor - checked.fillVolumeM3) / rates.shrinkFactor,
      6,
    )
    expect(report.result.wasteBankM3).toBeGreaterThan(50)
    expect(report.result.borrowM3).toBe(0)
    const log = Object.fromEntries(verticalOptimizationLog(report).map((row) => [row.label, row.value]))
    expect(log).toMatchObject({
      'Sections sampled': '61, at most 10 m apart',
      'Search band': '±5 m around ground, 0.5 m steps',
      'Grade limit': '18% and 1 station range',
      'Vertical curves': 'K ≥ 4, sag K ≥ 4, crest K ≥ 3',
      'Road ends': 'Start tied to ground; end tied to ground',
      Objective: 'Cut and fill',
      Waste: `${Math.round(report.result.wasteBankM3).toLocaleString('en-CA')} m³ (bank)`,
    })
    expect(log.PVIs).toMatch(/^13 searched, 50 m apart; \d+ kept/)
    expect(report.notes.join(' ')).toMatch(
      /Cut and fill do not balance: [\d,]+ m³ of cut \(bank\) is left over as waste/,
    )
  })
})

describe('profile optimizer in slices', () => {
  it('returns the same line as the one-go search and reports progress', async () => {
    const terrain = hillside()
    const direct = optimizeVerticalProfile(road(600), 600, terrain, settings, { objective: 'total' })
    const fractions: number[] = []
    const sliced = await optimizeVerticalProfileAsync(
      road(600),
      600,
      terrain,
      settings,
      { objective: 'total' },
      { sliceMs: 0, onProgress: ({ fraction }) => fractions.push(fraction) },
    )
    expect(sliced.vertical).toEqual(direct.vertical)
    expect(fractions.length).toBeGreaterThan(10)
    expect(Math.max(...fractions)).toBeLessThanOrEqual(1)
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions)
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    let slices = 0
    const run = optimizeVerticalProfileAsync(
      road(600),
      600,
      hillside(),
      settings,
      { objective: 'total' },
      {
        signal: controller.signal,
        sliceMs: 0,
        onProgress: () => {
          if (++slices === 3) controller.abort()
        },
      },
    )
    await expect(run).rejects.toMatchObject({ name: 'AbortError', message: 'Profile optimization cancelled.' })
    expect(slices).toBe(3)
  })
})

import { describe, expect, it } from 'vitest'
import { alignmentLength, analyzeRoad, designProfileAt, offsetCoordinate, verticalCurveSummary } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import {
  designElevationAt,
  materialPlanNote,
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

  /** What the road engine reads at each control of a returned line, and any curve it would drop. */
  const engineAt = (alignment: Alignment, vertical: Alignment['vertical'], terrain: TerrainSource) => {
    const designed = { ...alignment, vertical }
    return {
      checks: analyzeRoad(designed, terrain, settings).verticalChecks ?? [],
      dropped: verticalCurveSummary(designed).filter((curve) => !curve.valid),
      at: (alignment.verticalControls ?? []).map((c) => designProfileAt(designed, c.chainage)!),
    }
  }

  it('meets a control held to ±0 that is not at a search PVI', () => {
    // Flat ground at 800 m. Each of these used to end in "no profile": the curve at the control moved
    // the line off it and the correction that followed diverged or ran the curve past its tangent.
    const flat: TerrainSource = { elevationAt: () => 800 }
    for (const [station, elevation] of [
      [12.3, 800.337],
      [587.7, 801.2345],
      [275, 801.2345],
      [262.5, 801.2345],
    ]) {
      const alignment = road(600, { verticalControls: [control({ chainage: station, elevation })] })
      const result = optimizeVerticalProfile(alignment, 600, flat, settings)
      const engine = engineAt(alignment, result.vertical, flat)
      expect(engine.checks).toEqual([])
      expect(engine.dropped).toEqual([])
      expect(Math.abs(engine.at[0].elevation - elevation)).toBeLessThan(1e-6)
    }
    // On the hillside, wherever the control falls between the 50 m search PVIs.
    const terrain = hillside()
    for (let station = 61.3; station < 560; station += 93.7) {
      const ground = terrain.elevationAt(...offsetCoordinate(ORIGIN, 90, station))
      const elevation = ground + ((station * 7) % 2) - 1
      const alignment = road(600, {
        verticalStandards: standards,
        verticalControls: [control({ chainage: station, elevation })],
      })
      const result = optimizeVerticalProfile(alignment, 600, terrain, settings, { k: 4 })
      const engine = engineAt(alignment, result.vertical, terrain)
      expect(engine.checks).toEqual([])
      expect(engine.dropped).toEqual([])
      expect(Math.abs(engine.at[0].elevation - elevation)).toBeLessThan(1e-6)
    }
  }, 30_000)

  it('meets a control a metre from a search PVI instead of reporting grades of hundreds of percent', () => {
    const flat: TerrainSource = { elevationAt: () => 800 }
    for (const station of [251, 250.5, 149.2]) {
      const alignment = road(600, { verticalControls: [control({ chainage: station, elevation: 800.25 })] })
      const result = optimizeVerticalProfile(alignment, 600, flat, settings)
      const engine = engineAt(alignment, result.vertical, flat)
      expect(engine.checks).toEqual([])
      expect(Math.abs(engine.at[0].elevation - 800.25)).toBeLessThan(1e-6)
      // The spacing PVI beside the control gave way to it.
      const beside = Math.round(station / 50) * 50
      expect(result.vertical.some((p) => p.chainage === beside)).toBe(false)
    }
  })

  it('meets a grade-only control beside a tied end or an elevation control', () => {
    const terrain = hillside()
    const z250 = terrain.elevationAt(...offsetCoordinate(ORIGIN, 90, 250))
    for (const controls of [
      // −4 % from the tied start is 0.79 m below ground at 50 m: inside the band, but on no ladder.
      [control({ chainage: 50, gradePercent: -4 })],
      [control({ chainage: 550, gradePercent: -4 })],
      [
        control({ id: 'level', chainage: 250, elevation: z250 }),
        control({ id: 'grade', chainage: 300, gradePercent: -5 }),
      ],
    ]) {
      const alignment = road(600, { verticalControls: controls })
      const result = optimizeVerticalProfile(alignment, 600, terrain, settings)
      const engine = engineAt(alignment, result.vertical, terrain)
      expect(engine.checks).toEqual([])
      controls.forEach((c, i) => {
        if (c.gradePercent !== null) expect(Math.abs(engine.at[i].grade - c.gradePercent)).toBeLessThan(1e-6)
        if (c.elevation !== null) expect(Math.abs(engine.at[i].elevation - c.elevation)).toBeLessThan(1e-6)
      })
    }
  })

  it('still refuses controls no profile can meet, and says which', () => {
    const flat: TerrainSource = { elevationAt: () => 800 }
    // 3 m of rise in 10 m between two held levels is 30 %.
    const alignment = road(600, {
      verticalControls: [
        control({ id: 'a', chainage: 300, elevation: 800 }),
        control({ id: 'b', chainage: 310, elevation: 803 }),
      ],
    })
    expect(() => optimizeVerticalProfile(alignment, 600, flat, settings)).toThrow(
      /No profile meets the limits between 0\+300\.0 and 0\+310\.0\. Every line .* would run at 30\.0% to 30\.0% there, outside the −18\.0% to 18\.0% grade limit; Control 1 at 0\+300\.0 holds the line at 800\.00 m and Control 2 at 0\+310\.0 holds the line at 803\.00 m/,
    )
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

describe('profile optimizer and the material plan', () => {
  // A control 2.5 m above the ground at mid-road forces a fill the cut cannot supply.
  const terrain = hillside()
  const raised = (allocation: 'nearest' | 'economic') => {
    const engineering = createEngineeringDesign()
    Object.assign(engineering.haul, { enabled: true, allocation })
    engineering.sites = [
      {
        id: 'spoil',
        name: 'Spoil',
        kind: 'waste',
        chainage: 50,
        accessDistanceM: 20,
        capacityM3: null,
        unitRate: 2,
        fixedCost: 0,
      },
    ]
    const ground = terrain.elevationAt(...offsetCoordinate(ORIGIN, 90, 300))
    return road(600, {
      engineering,
      verticalControls: [
        control({ chainage: 300, elevation: ground + 2.5, toleranceAboveM: 0.5, toleranceBelowM: 0.5 }),
      ],
    })
  }

  it('returns a valid profile whose haul plan cannot close, and says what the earthwork needs', () => {
    for (const objective of ['earthwork', 'total'] as const) {
      const alignment = raised('economic')
      // Borrow is needed and only a waste site is entered. This used to be refused, with advice to adjust Curve K.
      const result = optimizeVerticalProfile(alignment, 600, terrain, settings, { objective })
      const checked = analyzeRoad({ ...alignment, vertical: result.vertical }, terrain, settings)
      expect(checked.engineering!.haul.optimizationStatus).toBe('infeasible')
      expect(checked.verticalChecks ?? []).toEqual([])
      expect(checked.maxGradePercent).toBeLessThanOrEqual(settings.maxGradePercent)
      const borrow = Math.round(-checked.balanceM3).toLocaleString('en-CA')
      expect(result.report.notes).toContain(
        `The material plan for this profile cannot be met as entered, so its estimate leaves out haul, borrow and waste. It needs ${borrow} m³ of borrow and no borrow site is entered: add one under Engineering → Haul. The profile itself meets its grade, curve and control limits.`,
      )
      expect(result.report.notes.join(' ')).not.toMatch(/Curve K/)
    }
  })

  it('adds no plan note when the plan stands or haul is off', () => {
    const nearest = raised('nearest')
    expect(
      optimizeVerticalProfile(nearest, 600, terrain, settings).report.notes.filter((note) =>
        /material plan/i.test(note),
      ),
    ).toEqual([])
    expect(materialPlanNote({ balanceM3: -800, engineering: undefined }, road(600))).toBe('')
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

  it('runs straight across a wide gap, between the ground at its two edges', () => {
    // 250 m with no ground. Every level costs the same there, and the lowest used to win: the line
    // dropped 5 m below the far side and pitched −16.9 % into the gap.
    const terrain = gap(200.5, 449.5)
    const result = optimizeVerticalProfile(road(600), 600, terrain, settings)
    const ground = (s: number) => 798.791548 - 0.06 * s + 2 * Math.sin(s / 45)
    const across = (s: number) => ground(200) + ((ground(450) - ground(200)) * (s - 200)) / 250
    for (let s = 200; s <= 450; s += 10)
      expect(Math.abs(designElevationAt(result.vertical, s) - across(s))).toBeLessThan(0.75)
    // It joins the ground on each side inside the search band, at grades the ground itself has.
    for (const p of result.vertical.filter((p) => p.chainage <= 200 || p.chainage >= 450))
      expect(Math.abs(p.elevation - ground(p.chainage))).toBeLessThanOrEqual(5)
    const checked = analyzeRoad({ ...road(600), vertical: result.vertical }, terrain, settings)
    expect(checked.maxGradePercent).toBeLessThan(12)
    expect(result.report.notes.join(' ')).toMatch(/250 m of the road has no complete section/)
  })

  it('holds the line level past the last ground when a gap runs to an untied end', () => {
    const terrain = gap(300.5, 700)
    const result = optimizeVerticalProfile(road(600), 600, terrain, settings, { tieEndsToGround: false })
    const edge = terrain.elevationAt(...offsetCoordinate(ORIGIN, 90, 300))
    expect(Math.abs(result.vertical[result.vertical.length - 1].elevation - edge)).toBeLessThan(0.75)
  })

  it('says which gap cannot be bridged when the ground at its edges is too far apart', () => {
    // 35 m lower past the gap: 31 % straight across 150 m, under an 18 % limit.
    const cliff = hillside((x) => (x > 100.5 && x < 250.5 ? NaN : x >= 250.5 ? -35 : 0))
    expect(() => optimizeVerticalProfile(road(600), 600, cliff, settings)).toThrow(
      /^The gap in the terrain from 0\+099\.\d to 0\+25\d\.\d cannot be bridged inside the limits: no profile meets them between 0\+\d+\.0 and 0\+\d+\.0\. With no ground there, the line is held near the straight line between the ground at its edges, 794\.\d\d m and 747\.\d\d m, −31\.\d% across\. Every line within ±5 m of the line across that gap would run at .* outside the −18\.0% to 18\.0% grade limit\./,
    )
  })

  it('refuses a road that is mostly off the terrain, after reading its ground once', () => {
    let reads = 0
    const base = gap(100.5, 499.5)
    const counted: TerrainSource = {
      elevationAt: (lon, lat) => {
        reads++
        return base.elevationAt(lon, lat)
      },
    }
    expect(() => optimizeVerticalProfile(road(600), 600, counted, settings)).toThrow(
      /^Only 34% of this road has ground under it \(202 m of 600 m\), and a profile search needs at least 50%\. The widest gap, 0\+(099\.\d|100\.0) to 0\+(500\.\d|499\.\d), is too wide to bridge\. Load or import terrain for it, or shorten the road to the mapped ground\.$/,
    )
    // One reading a metre and no search: nothing was solved before the refusal.
    expect(reads).toBeLessThanOrEqual(610)
  })

  it('hands the page a turn while it reads a long road, so Cancel is answered at once', async () => {
    // 2 km of bends with ground under the first 1,100 m. Each PVI past the ground used to walk the
    // road a metre at a time to find it, all before the first turn: 17 s at 5 km, 146 s at 10 km.
    const count = 40
    const points = Array.from({ length: count + 1 }, (_, i) => ({
      id: `p${i}`,
      coordinate: offsetCoordinate(offsetCoordinate(ORIGIN, 90, i * 50), 0, i % 2 ? 6 : -6),
      radiusM: i === 0 || i === count ? 0 : 60,
    }))
    const alignment = road(2000, { points })
    const base = hillside((x) => (x > 1100 ? NaN : 0))
    let reads = 0
    const counted: TerrainSource = {
      elevationAt: (lon, lat) => {
        reads++
        return base.elevationAt(lon, lat)
      },
    }
    const controller = new AbortController()
    const run = optimizeVerticalProfileAsync(
      alignment,
      alignmentLength(alignment),
      counted,
      settings,
      { tieEndsToGround: false },
      { signal: controller.signal, sliceMs: 0 },
    )
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    // Cancelled at the first turn, a few hundred readings in; it used to take thousands to get there.
    expect(reads).toBeLessThan(600)
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

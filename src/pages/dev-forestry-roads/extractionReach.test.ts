/**
 * The extraction-reach model against synthetic planes. The expected numbers come from reference
 * runs of Sylvaccess 3.6, unmodified, on 5 m grids of the same planes (10 November 2026): the
 * transects and counts are copied here as small fixtures, not the runs' output files.
 *
 * Sylvaccess reports skid distances as centimetre steps truncated to the metre and winch lengths
 * rounded to the metre; PGMaps keeps metres unrounded, so distances are compared to within 1 m.
 */
import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import {
  asSkidReachResult,
  compareExtraction,
  comparisonMapFeatures,
  DEFAULT_EXTRACTION_SETTINGS,
  extractionMapFeatures,
  extractionOnGrid,
  extractionReachSteps,
  extractionSpurModel,
  M_CRANE,
  M_GROUND,
  M_ROAD,
  M_RUN,
  M_WINCH_EDGE,
  M_WINCH_ROAD,
  maskPolygons,
  parseClassBounds,
  prepareExtractionGrid,
  X_BEYOND,
  X_COVERED,
  X_EXCLUDED,
  X_STEEP,
  X_UNFELLABLE,
  X_UNKNOWN,
  type ExtractionArea,
  type ExtractionResult,
  type ExtractionSettings,
} from './extractionReach'
import { DEFAULT_FORWARDER_RULE, widestRunAngleDeg } from './forwarderReach'
import { lineCells, skidReachSteps, type SkidRoad } from './skidReach'
import { suggestSpursSteps } from './skidSpurs'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import type { Coordinate } from './types'
import { DEFAULT_WINCH_RULE, maxWinchLengthM, winchCoefficients } from './winchReach'

// A local equirectangular frame, so grid metres are exact.
const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const ground = (z: (x: number, y: number) => number) => ({
  elevationAt: (lon: number, lat: number) => z(...toGrid([lon, lat])),
})
const rect = (x0: number, y0: number, x1: number, y1: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    (
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ] as [number, number][]
    ).map(toLonLat),
  ],
})
const road = (id: string, points: [number, number][], use: SkidRoad['use'] = 'truck'): SkidRoad => ({
  id,
  name: id,
  kind: 'existing',
  coordinates: points.map(toLonLat),
  use,
})
/** A plane rising north at `slope` (a fraction). */
const plane = (slope: number) => (_x: number, y: number) => 1000 + slope * y

/**
 * Sylvaccess's settings for the reference runs: no total distance limit (the skid reach is set to
 * its maximum and made level), 30 % drivable limit, 50 m up at 75 % / 100 m down at 20 % winching.
 */
const SYLVACCESS: ExtractionSettings = {
  ...DEFAULT_EXTRACTION_SETTINGS,
  skid: { flatReachM: 2000, adverseReachM: 2000, adverseSlopePercent: 30, maxGroundSlopePercent: 30 },
  winch: DEFAULT_WINCH_RULE,
  winchFrom: 'roads',
  forwarder: { ...DEFAULT_FORWARDER_RULE, reachM: 2000 },
  classBoundsM: [0, 500, 1000, 1500],
}

/** The reference grid: 60 × 60 cells of 5 m over a 300 m square, all of it harvest block. */
const run = (
  z: (x: number, y: number) => number,
  roads: SkidRoad[],
  settings: Partial<ExtractionSettings> = {},
  areas: ExtractionArea[] = [],
): ExtractionResult =>
  runToCompletion(
    extractionReachSteps({
      block: rect(0, 0, 300, 300),
      roads,
      ground: ground(z),
      toGrid,
      toLonLat,
      cellM: 5,
      offBlockM: 0,
      settings: { ...SYLVACCESS, ...settings },
      areas,
    }),
  )
/** A road along the second row, 12.5 m from the south edge, as in the reference runs. */
const southRoad = road('south', [
  [1, 12.5],
  [299, 12.5],
])
const northRoad = road('north', [
  [1, 287.5],
  [299, 287.5],
])
const pointRoad = road('point', [[152.5, 152.5]])

const cellAt = (result: ExtractionResult, x: number, y: number) => {
  const { grid } = result.grid.sg
  const col = Math.round((x - grid.origin[0]) / grid.cellM),
    row = Math.round((grid.origin[1] - y) / grid.cellM)
  return row * grid.width + col
}
/** The middle column's cells, keyed by distance north of the grid's south edge. */
const at = (result: ExtractionResult, y: number, x = 152.5) => {
  const i = cellAt(result, x, y)
  const cells = result.state.cells[0]
  return {
    state: result.state.states[i],
    method: cells.method[i],
    totalM: cells.totalM[i],
    forestM: cells.forestM[i],
    winchM: cells.winchM[i],
    trackM: cells.trackM[i],
  }
}
const coveredCount = (result: ExtractionResult) => {
  let n = 0
  for (const i of result.grid.sg.blockCells) if (result.state.states[i] === X_COVERED) n++
  return n
}
const ys = (from: number, to: number) => Array.from({ length: Math.round((to - from) / 5) + 1 }, (_, k) => from + 5 * k)

describe('winch reach rule', () => {
  it('matches the calibration and the reach table of the 50/100 m, 75/20 % defaults', () => {
    const k = winchCoefficients(DEFAULT_WINCH_RULE)
    expect(k.c).toBeCloseTo(-1.007829, 5)
    expect(k.l0).toBeCloseTo(80.2349, 3)
    const table: [number, number][] = [
      [-1, 100],
      [-0.4, 100],
      [-0.2, 100],
      [-0.1, 89.18],
      [0, 80.23],
      [0.1, 72.92],
      [0.2, 66.99],
      [0.3, 62.22],
      [0.4, 58.38],
      [0.6, 52.84],
      [0.75, 50],
      [1, 50],
    ]
    for (const [p, reach] of table) expect(maxWinchLengthM(p, DEFAULT_WINCH_RULE)).toBeCloseTo(reach, 1)
  })
  it('holds a constant reach when both lengths are equal', () => {
    const rule = { ...DEFAULT_WINCH_RULE, upReachM: 60, downReachM: 60 }
    for (const p of [-1, -0.1, 0, 0.3, 2]) expect(maxWinchLengthM(p, rule)).toBeCloseTo(60, 9)
  })
})

describe('skidder on the reference planes', () => {
  it('20 % plane, roads first: winches to 65 m north, skids from 70 m', () => {
    const r = run(plane(0.2), [southRoad])
    // Reference run: Winching_distance 5…66 from 17.5 to 77.5 m, then skidding 71, 76, 81, 86 m.
    const winch = [5, 10, 15, 20, 25, 31, 36, 41, 46, 51, 56, 61, 66]
    ys(17.5, 77.5).forEach((y, k) => {
      expect(at(r, y).method).toBe(M_WINCH_ROAD)
      expect(Math.abs(at(r, y).winchM - winch[k])).toBeLessThanOrEqual(0.5)
    })
    const skid = [71, 76, 81, 86, 91, 96, 102, 107]
    ys(82.5, 117.5).forEach((y, k) => {
      expect(at(r, y).method).toBe(M_GROUND)
      expect(Math.abs(at(r, y).totalM - skid[k])).toBeLessThanOrEqual(1)
    })
    // Below the road, timber 10 m down is winched (reference 10 and 5 m).
    expect(Math.round(at(r, 2.5).winchM)).toBe(10)
    expect(Math.round(at(r, 7.5).winchM)).toBe(5)
    expect(coveredCount(r)).toBe(3600)
  })

  it('20 % plane, drive to the timber: skids everywhere', () => {
    const r = run(plane(0.2), [southRoad], { winchFrom: 'edge' })
    // Reference (option 2): 25 m north reads 25 m, 50 m reads 51 m, no winching.
    const skid = [5, 10, 15, 20, 25, 30, 35, 40, 45, 51, 56, 61, 66, 71]
    ys(17.5, 82.5).forEach((y, k) => {
      expect(at(r, y).method).toBe(M_GROUND)
      expect(Math.abs(at(r, y).totalM - skid[k])).toBeLessThanOrEqual(1)
    })
    for (const i of r.grid.sg.blockCells) expect(r.state.cells[0].winchM[i] || 0).toBe(0)
  })

  it('40 % plane, road below: winches uphill to 50 m (54 m along the line), not 55 m', () => {
    for (const winchFrom of ['roads', 'edge'] as const) {
      const r = run(plane(0.4), [southRoad], { winchFrom })
      const expected = [5, 11, 16, 22, 27, 32, 38, 43, 48, 54]
      ys(17.5, 62.5).forEach((y, k) => expect(Math.abs(at(r, y).winchM - expected[k])).toBeLessThanOrEqual(0.5))
      expect(at(r, 67.5).state).toBe(X_STEEP)
      expect(Math.round(at(r, 2.5).winchM)).toBe(11)
      // Reference: 779 accessible cells (13 rows of 60 less one corner cell).
      expect(Math.abs(coveredCount(r) - 779)).toBeLessThanOrEqual(2)
    }
  })

  it('40 % plane, road above: winches downhill to 90 m (97 m along the line), not 95 m', () => {
    const r = run(plane(0.4), [northRoad])
    expect(Math.round(at(r, 197.5).winchM)).toBe(97)
    expect(Math.round(at(r, 207.5).winchM)).toBe(86)
    expect(at(r, 192.5).state).toBe(X_STEEP)
    expect(Math.abs(coveredCount(r) - 1259)).toBeLessThanOrEqual(2)
  })

  it('40 % plane, one road cell: the winch envelope round a single source', () => {
    const r = run(plane(0.4), [pointRoad])
    // Reference: 54 m at 50 m upslope, 80 m at 80 m across, 97 m at 90 m downslope, nothing at 100 m down.
    expect(Math.round(at(r, 202.5).winchM)).toBe(54)
    expect(at(r, 207.5).state).toBe(X_STEEP)
    expect(Math.round(at(r, 152.5, 232.5).winchM)).toBe(80)
    expect(Math.round(at(r, 152.5, 72.5).winchM)).toBe(80)
    expect(at(r, 152.5, 237.5).state).toBe(X_STEEP)
    expect(Math.round(at(r, 62.5).winchM)).toBe(97)
    expect(at(r, 52.5).state).toBe(X_STEEP)
    // Reference: 797 cells. The ray table differs in detail at the envelope's edge.
    expect(Math.abs(coveredCount(r) - 797) / 797).toBeLessThan(0.03)
  })

  it('a strip closed to machines is winched across from the edge of the skidded ground', () => {
    const strip: ExtractionArea = { polygon: rect(-20, 100, 320, 130), treatment: 'no-machines' }
    const r = run(plane(0.2), [southRoad], {}, [strip])
    // Reference: skidding stops at 97.5 m (86 m); 102.5 m reads 86 + 5, 162.5 m reads 86 + 66; 167.5 m unreached.
    expect(at(r, 97.5).method).toBe(M_GROUND)
    expect(Math.floor(at(r, 97.5).totalM)).toBe(86)
    for (const [y, winch] of [
      [102.5, 5],
      [127.5, 31],
      [162.5, 66],
    ] as const) {
      expect(at(r, y).method).toBe(M_WINCH_EDGE)
      expect(Math.floor(at(r, y).forestM)).toBe(86)
      expect(Math.round(at(r, y).winchM)).toBe(winch)
    }
    expect(at(r, 167.5).state).toBe(X_BEYOND)
    expect(Math.abs(coveredCount(r) - 1979)).toBeLessThanOrEqual(2)
  })

  it('a strip closed to extraction stops winching too', () => {
    const strip: ExtractionArea = { polygon: rect(-20, 100, 320, 130), treatment: 'no-extraction' }
    const r = run(plane(0.2), [southRoad], {}, [strip])
    expect(at(r, 97.5).state).toBe(X_COVERED)
    expect(at(r, 102.5).state).toBe(X_EXCLUDED)
    expect(at(r, 132.5).state).toBe(X_BEYOND)
    // Reference: 1,199 accessible cells, nothing at or beyond 102.5 m.
    expect(Math.abs(coveredCount(r) - 1199)).toBeLessThanOrEqual(2)
  })

  it('a winch line may not drag over a hump or swing over a hollow deeper than the fixed limits', () => {
    // A 40 % plane (no driving) with a 15 m wide step across it 20 m north of the road; its edges
    // are steep, so hand-falling is allowed to 300 % here.
    const ridge = (height: number) => (x: number, y: number) => plane(0.4)(x, y) + (y > 30 && y < 45 ? height : 0)
    const fellable = { fellableSlopePercent: 300 }
    const low = run(ridge(8), [southRoad], fellable)
    expect(at(low, 52.5).state).toBe(X_COVERED)
    const high = run(ridge(16), [southRoad], fellable)
    expect(at(high, 32.5).state).toBe(X_COVERED)
    expect(at(high, 52.5).state).toBe(X_STEEP)
  })
})

describe('forwarder on the reference planes', () => {
  const forwarder = (z: (x: number, y: number) => number, roads: SkidRoad[], rule = {}) =>
    run(z, roads, { machine: 'forwarder', forwarder: { ...SYLVACCESS.forwarder, ...rule } })

  it('drives freely below every limit (10 %) and in straight runs above the side limit (20 %, 30 %)', () => {
    // Reference: 286, 291 and 298 m at 297.5 m north of the south edge.
    const cases: [number, number, number][] = [
      [0.1, 286, M_GROUND],
      [0.2, 291, M_RUN],
      [0.3, 298, M_RUN],
    ]
    for (const [slope, far, method] of cases) {
      const r = forwarder(plane(slope), [southRoad])
      expect(Math.abs(at(r, 297.5).totalM - far)).toBeLessThanOrEqual(1)
      expect(at(r, 297.5).method).toBe(method)
      expect(coveredCount(r)).toBe(3600)
    }
  })

  it('fans out from one road cell within the side-slope angle, narrower on steeper ground', () => {
    expect(widestRunAngleDeg(20, DEFAULT_FORWARDER_RULE)).toBeCloseTo(48.59, 2)
    expect(widestRunAngleDeg(25, DEFAULT_FORWARDER_RULE)).toBeCloseTo(36.87, 2)
    const p20 = forwarder(plane(0.2), [pointRoad])
    const p25 = forwarder(plane(0.25), [pointRoad])
    // Up and down the fall line to the grid's edges (reference 148 m north, 153 m south).
    expect(Math.abs(at(p20, 297.5).totalM - 148)).toBeLessThanOrEqual(1)
    expect(Math.abs(at(p20, 2.5).totalM - 153)).toBeLessThanOrEqual(1)
    // Across the slope: the next cell by a run that clips its corner, then the 8 m crane from the
    // fan's first cells. Reference: 5, 10 and 15 m east and nothing west (Sylvaccess is not
    // symmetric here).
    for (const x of [137.5, 142.5, 147.5, 157.5, 162.5, 167.5]) expect(at(p20, 152.5, x).state).toBe(X_COVERED)
    expect(at(p20, 152.5, 162.5).method).toBe(M_CRANE)
    for (const x of [132.5, 172.5]) expect(at(p20, 152.5, x).state).toBe(X_BEYOND)
    // Reference: 2,181 and 1,650 cells. Sylvaccess applies the side rule to slope angles (48.96° and
    // 37.43°) and has a first-reach quirk in its second pass; this model uses the tangent form.
    expect(Math.abs(coveredCount(p20) - 2181) / 2181).toBeLessThan(0.08)
    expect(Math.abs(coveredCount(p25) - 1650) / 1650).toBeLessThan(0.08)
    expect(coveredCount(p25)).toBeLessThan(coveredCount(p20))
    // Row 145 m north of the source: reference fan spans 47 cells on 25 %.
    let width = 0
    for (let x = 2.5; x < 300; x += 5) if (at(p25, 297.5, x).state === X_COVERED) width++
    expect(Math.abs(width - 47)).toBeLessThanOrEqual(3)
  })

  it('stops runs at the steep-ground budget', () => {
    const r = forwarder(plane(0.2), [pointRoad], { steepBudgetM: 100 })
    // 100 m along a 20 % fall line is 98.1 m level: the run ends at 95 m, the crane loads 100 m.
    expect(at(r, 247.5).state).toBe(X_COVERED)
    expect(at(r, 252.5).method).toBe(M_CRANE)
    expect(at(r, 257.5).state).toBe(X_BEYOND)
    expect(at(r, 57.5).state).toBe(X_COVERED)
    expect(at(r, 47.5).state).toBe(X_BEYOND)
    // Reference: 1,040 cells, reaching about 110 m up and down; Sylvaccess checks the budget only
    // when it improves a cell, so its fan runs past the budget. This model enforces it on first reach.
    expect(coveredCount(r)).toBeLessThan(1040)
    expect(coveredCount(r)).toBeGreaterThan(800)
  })
})

describe('road classes', () => {
  // Gentle ground: a truck road along the south, a skid trail up the middle and an orphan trail.
  const trail = road(
    'Trail',
    [
      [152.5, 12.5],
      [152.5, 250],
    ],
    'track',
  )
  const orphan = road(
    'Orphan',
    [
      [20, 200],
      [80, 200],
    ],
    'track',
  )

  it('carries logs along a trail to the truck road, and leaves out a trail that joins none', () => {
    const r = run(plane(0.1), [southRoad, trail, orphan], { winchFrom: 'none' })
    const near = at(r, 240, 162.5)
    expect(near.method).toBe(M_GROUND)
    expect(near.trackM).toBeGreaterThan(200)
    expect(near.forestM).toBeLessThan(15)
    expect(r.summary.disconnectedTrails).toEqual(['Orphan'])
    expect(r.summary.viaTrailHa).toBeGreaterThan(0)
    // The orphan trail's own cells are not landings.
    expect(at(r, 202.5, 52.5).method).not.toBe(M_ROAD)
  })

  it('without trails and winching, matches the skid-reach model cell for cell', () => {
    const z = (x: number, y: number) => 1000 + 0.15 * y + 8 * Math.sin(x / 40) + (y > 150 ? 0.4 * (y - 150) : 0)
    const settings = { ...DEFAULT_EXTRACTION_SETTINGS, winchFrom: 'none' as const }
    const input = {
      block: rect(0, 0, 400, 500),
      roads: [
        road('main', [
          [-100, -5],
          [500, -5],
        ]),
      ],
      ground: ground(z),
      toGrid,
      toLonLat,
    }
    const extraction = runToCompletion(extractionReachSteps({ ...input, settings }))
    const skid = runToCompletion(skidReachSteps({ ...input, rule: settings.skid }))
    expect(Array.from(extraction.state.status)).toEqual(Array.from(skid.status))
  })
})

describe('missing ground', () => {
  it('reports ground reached only across a gap as unknown, never beyond reach', () => {
    const gap = (x: number, y: number) => (y > 40 && y < 60 ? NaN : plane(0.4)(x, y))
    const r = run(gap, [southRoad])
    expect(at(r, 37.5).state).toBe(X_COVERED)
    expect(at(r, 47.5).state).toBe(X_UNKNOWN)
    // Beyond the gap the winch would reach in the optimistic run only.
    expect(at(r, 62.5).state).toBe(X_UNKNOWN)
    expect(at(r, 72.5).state).toBe(X_STEEP)
  })
})

describe('felling and classes', () => {
  it('reports ground too steep to fell by hand, whatever reaches it', () => {
    const r = run(plane(0.4), [southRoad], { fellableSlopePercent: 35 })
    expect(at(r, 22.5).state).toBe(X_UNFELLABLE)
    expect(r.summary.stateHa.unfellable).toBeGreaterThan(0)
  })

  it('parses distance classes and sums them to the covered area', () => {
    expect(parseClassBounds('0;100; 200,300')).toEqual([0, 100, 200, 300])
    expect(() => parseClassBounds('100;200')).toThrow(/Start/)
    expect(() => parseClassBounds('0;200;100')).toThrow(/increasing/)
    const r = run(plane(0.1), [southRoad], { classBoundsM: [0, 100, 200] })
    const total = r.summary.classes.reduce((sum, row) => sum + row.ha, 0)
    expect(total).toBeCloseTo(r.summary.stateHa.covered, 9)
    expect(r.summary.classes.at(-1)!.cumulativeShare).toBeCloseTo(r.summary.coveredShare, 9)
    expect(r.summary.classes.map((row) => row.label)).toEqual(['0–100 m', '100–200 m', '200 m and over'])
  })

  it('draws distance classes as filled polygons and the rest as outlines', () => {
    const r = run(plane(0.4), [pointRoad])
    const features = extractionMapFeatures(r)
    expect(features.some((f) => f.geometry.type === 'Polygon' && f.properties?.fill)).toBe(true)
    expect(features.some((f) => f.properties?.role === 'steep')).toBe(true)
    expect(features.some((f) => f.properties?.role === 'winched')).toBe(true)
  })

  it('groups a ring of covered cells round an uncovered hole into one polygon', () => {
    const r = run(plane(0.05), [pointRoad])
    const sg = r.grid.sg
    const centre = cellAt(r, 152.5, 152.5)
    const polygons = maskPolygons(sg, (i) => {
      const dr = Math.abs(Math.floor(i / sg.grid.width) - Math.floor(centre / sg.grid.width)),
        dc = Math.abs((i % sg.grid.width) - (centre % sg.grid.width))
      return Math.max(dr, dc) <= 3 && Math.max(dr, dc) >= 2
    })
    expect(polygons).toHaveLength(1)
    expect(polygons[0]).toHaveLength(2)
  })
})

describe('before and after a road project', () => {
  it('reports newly accessible ground and distances shortened', () => {
    const settings = { ...DEFAULT_EXTRACTION_SETTINGS }
    const eg = runToCompletion(
      prepareExtractionGrid({
        block: rect(0, 0, 400, 800),
        roads: [
          road('main', [
            [-100, -5],
            [500, -5],
          ]),
          {
            ...road('spur', [
              [200, -5],
              [200, 500],
            ]),
            kind: 'design',
          },
        ],
        ground: ground(() => 700),
        toGrid,
        toLonLat,
        settings,
      }),
    )
    const before = runToCompletion(extractionOnGrid(eg, (r) => r.kind === 'existing'))
    const after = runToCompletion(extractionOnGrid(eg))
    const change = compareExtraction(before, after)
    expect(change.newlyHa).toBeCloseTo(after.summary.stateHa.covered - before.summary.stateHa.covered, 9)
    expect(change.newlyHa).toBeGreaterThan(5)
    expect(change.shortenedHa).toBeGreaterThan(5)
    expect(change.lostHa).toBe(0)
    expect(change.shortenedBy.reduce((sum, bin) => sum + bin.ha, 0)).toBeCloseTo(change.shortenedHa, 9)
    expect(comparisonMapFeatures(after, change).some((f) => f.properties?.role === 'newly')).toBe(true)
  })
})

describe('spurs on the extraction model', () => {
  it('extends winching from a new road and suggests spurs judged by the extraction reach', () => {
    // Steep ground (no driving): only winching reaches it.
    const r = run(plane(0.4), [southRoad])
    const model = extractionSpurModel(r)
    const before = model.covered(model.start)
    const line = lineCells(r.grid.sg.grid, [toGrid(toLonLat([1, 150])), toGrid(toLonLat([299, 150]))])
    const after = runToCompletion(model.withRoad(model.start, line))
    expect(model.covered(after)).toBeGreaterThan(before + 1000)
    // The base state is not changed.
    expect(model.covered(model.start)).toBe(before)
  })

  it('runs the spur suggester with the forwarder model', () => {
    const flat = { elevationAt: () => 500 }
    const result = runToCompletion(
      extractionReachSteps({
        block: rect(-200, 10, 200, 1210),
        roads: [
          road('main', [
            [-900, 5],
            [900, 5],
          ]),
        ],
        ground: flat,
        toGrid,
        toLonLat,
        settings: { ...DEFAULT_EXTRACTION_SETTINGS, machine: 'forwarder' },
      }),
    )
    expect(result.summary.coveredShare).toBeLessThan(0.5)
    const spurs = runToCompletion(
      suggestSpursSteps(asSkidReachResult(result), {
        terrain: flat,
        ground: flat,
        settings: DEFAULT_ROAD_SETTINGS,
        context: [],
        routeOptions: {},
        options: { targetShare: 0.98, maxSpurs: 3 },
        model: extractionSpurModel(result),
      }),
    )
    expect(spurs.spurs.length).toBeGreaterThan(0)
    expect(spurs.after.coveredOfSkiddable).toBeGreaterThan(spurs.before.coveredOfSkiddable)
  })
})

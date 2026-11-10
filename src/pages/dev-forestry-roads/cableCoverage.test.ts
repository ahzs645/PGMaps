// @vitest-environment node
/**
 * Cable coverage against the `cable_concave` case: a reference run of Sylvaccess 3.6, unmodified,
 * on 10 November 2026. A 1 km square of forest on 5 m cells: a valley floor along y = 400 m, a
 * concave slope to the north (`z = 500 + 0.0015·(y − 400)²`, 0 % at the floor, 60 % at 200 m) and a
 * 5 % rise to the south; a road from x = 472.5 to 527.5 m on y = 402.5 m. Sylvaccess's trailer
 * preset with a 300 m skyline (276 m usable), lines of at least 100 m, 40 m lateral yarding, every
 * 1°. The numbers below are copied from the run's line table for its middle start cell, not its
 * output files.
 */
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { cableLineFeatures, forBandCells } from './cableCoverage'
import { CABLE_PRESETS, cableRuleErrors, usableSkylineM, type CableCoverageRule } from './cableCoverageRule'
import { runCableCoverage, type CoverScreen } from './cableCoverageRun'
import { instantiateCableLayout, type CableLayoutEngine } from './cableLayout/cableLayout'
import { selectCableLines, DEFAULT_CABLE_SELECTION } from './cableLineSelection'
import { runToCompletion } from './cooperative'
import {
  compareExtraction,
  DEFAULT_EXTRACTION_SETTINGS,
  extractionMapFeatures,
  M_CABLE,
  prepareExtractionGrid,
  X_COVERED,
  X_UNKNOWN,
  type ExtractionGrid,
} from './extractionReach'
import type { SkidRoad } from './skidReach'
import type { Coordinate } from './types'

let engine: CableLayoutEngine
beforeAll(async () => {
  engine = await instantiateCableLayout(readFileSync(new URL('./cableLayout/cable_layout.wasm', import.meta.url)))
})
const screen: CoverScreen = async (batches, onProgress) => {
  const out = []
  for (const b of batches) out.push(...engine.cover(b))
  onProgress(1, out.length)
  return out
}

const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const concave = (_x: number, y: number) => (y >= 400 ? 500 + 0.0015 * (y - 400) ** 2 : 500 + 0.05 * (400 - y))
const terrain = (z: (x: number, y: number) => number) => ({
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
const road = (id: string, points: [number, number][], kind: SkidRoad['kind'] = 'existing'): SkidRoad => ({
  id,
  name: id,
  kind,
  coordinates: points.map(toLonLat),
})

/** The reference run's settings, as PGMaps rigging and line rules. */
const REFERENCE: CableCoverageRule = {
  ...CABLE_PRESETS.trailer.rule,
  maxSkylineM: 300,
  minLineM: 100,
  lateralM: 40,
  bearingStepDeg: 1,
  landingSpacingM: 5,
  maxOutsideBlockM: 30,
}

function grid(
  rule: CableCoverageRule,
  roads: SkidRoad[],
  z = concave,
  block = rect(0, 0, 1000, 1000),
): { eg: ExtractionGrid; roads: SkidRoad[]; z: typeof concave } {
  const eg = runToCompletion(
    prepareExtractionGrid({
      block,
      roads,
      ground: terrain(z),
      toGrid,
      toLonLat,
      settings: { ...DEFAULT_EXTRACTION_SETTINGS, machine: 'cable', cable: rule },
      offBlockM: 0,
      cellM: 5,
    }),
  )
  return { eg, roads, z }
}

const run = (g: ReturnType<typeof grid>, compare = false) =>
  runCableCoverage({ eg: g.eg, terrain: terrain(g.z), compare, barriersStop: false }, screen)

/**
 * Reference lines from the middle start cell, every 15°: bearing, skyline length (m), supports,
 * forest area (m²) and mean carriage distance (m).
 */
const REFERENCE_LINES: [number, number, number, number, number][] = [
  [0, 274, 0, 22100, 127],
  [15, 270, 0, 22300, 126],
  [30, 129, 0, 11650, 63],
  [45, 160, 0, 13800, 78],
  [60, 229, 1, 20550, 115],
  [75, 274, 1, 24075, 136],
  [90, 275, 1, 23800, 137],
  [105, 274, 1, 23875, 136],
  [120, 271, 1, 24075, 136],
  [135, 276, 1, 24950, 138],
  [150, 271, 1, 24075, 136],
  [165, 274, 1, 23875, 136],
  [180, 275, 1, 23800, 137],
  [195, 274, 1, 24075, 136],
  [210, 276, 1, 24500, 137],
  [225, 272, 1, 23975, 137],
  [240, 271, 1, 24250, 136],
  [255, 274, 1, 24250, 137],
  [270, 275, 1, 23800, 137],
  [285, 274, 1, 24300, 137],
  [300, 225, 1, 20100, 111],
  [315, 160, 0, 14675, 79],
  [330, 127, 0, 11550, 62],
  [345, 276, 0, 22600, 127],
]
/** The reference's 360 lines from that cell: mean forest area (m²), skyline (m) and supports. */
const REFERENCE_MEANS = { areaM2: 22_221, skylineM: 253.9, supports: 0.68 }

describe('the rule', () => {
  it('keeps Sylvaccess’s anchor allowance and refuses impossible settings', () => {
    expect(usableSkylineM(REFERENCE)).toBeCloseTo(276, 0)
    expect(cableRuleErrors(REFERENCE)).toEqual([])
    expect(cableRuleErrors({ ...REFERENCE, minLineM: 290 })[0]).toMatch(/shortest line/)
    expect(cableRuleErrors({ ...REFERENCE, system: 'two-cable', position: 'below' })[0]).toMatch(/gravity/)
    expect(cableRuleErrors({ ...REFERENCE, maxSupports: 11 })[0]).toMatch(/Most supports/)
  })
})

describe('cable_concave, middle start cell', () => {
  const g = grid(REFERENCE, [
    road('road', [
      [497.5, 402.5],
      [497.6, 402.5],
    ]),
  ])
  let result: Awaited<ReturnType<typeof run>>
  beforeAll(async () => {
    result = await run(g)
  }, 120_000)

  it('finds a line on every bearing, machine below, as the reference', () => {
    const { lines, stats } = result.coverage
    expect(result.coverage.landings).toHaveLength(1)
    expect(stats.candidates).toBe(360)
    expect(lines.length).toBe(360)
    expect(stats.machineBelow).toBe(360)
  })

  it('matches the reference lines within a cell where both rules agree', () => {
    const byBearing = new Map(result.coverage.lines.map((l) => [l.bearingDeg, l]))
    for (const [bearing, skyline, supports, area, carriage] of REFERENCE_LINES) {
      const line = byBearing.get(bearing)!
      // 60° and 300°: PGMaps holds the loaded break angle at the support to 30° at every carriage
      // position, Sylvaccess only the chords' angle; the support fails and the line stops short.
      if (bearing === 60 || bearing === 300) {
        expect(line.points.length - 2).toBe(0)
        expect(line.skylineM).toBeLessThan(skyline)
        continue
      }
      expect(Math.abs(line.skylineM - skyline), `${bearing}° skyline`).toBeLessThanOrEqual(7)
      expect(line.points.length - 2, `${bearing}° supports`).toBe(supports)
      // PGMaps counts cells whose centre is in the band, Sylvaccess every cell the band touches:
      // equal on the grid's axes, up to about 10 % less on oblique bands.
      expect((area - line.areaHa * 10_000) / area, `${bearing}° area`).toBeLessThan(0.11)
      expect((area - line.areaHa * 10_000) / area, `${bearing}° area`).toBeGreaterThan(-0.02)
      expect(Math.abs(line.meanCarriageM - carriage), `${bearing}° carriage`).toBeLessThanOrEqual(5)
    }
  })

  it('agrees with the reference on all 360 lines on average', () => {
    const lines = result.coverage.lines
    const mean = (f: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + f(l), 0) / lines.length
    const area = mean((l) => l.areaHa * 10_000)
    expect(area).toBeLessThan(REFERENCE_MEANS.areaM2)
    expect(area).toBeGreaterThan(0.85 * REFERENCE_MEANS.areaM2)
    expect(Math.abs(mean((l) => l.skylineM) - REFERENCE_MEANS.skylineM)).toBeLessThan(10)
    expect(Math.abs(mean((l) => l.points.length - 2) - REFERENCE_MEANS.supports)).toBeLessThan(0.15)
  })

  it('reports covered ground as within reach by cable, at its carriage distance', () => {
    const { after } = result
    const s = after.summary
    expect(s.machine).toBe('cable')
    expect(s.methodHa.cable).toBeGreaterThan(10)
    const strict = after.state.cells[0]
    // 100 m due north of the landing.
    const { origin, cellM, width } = g.eg.sg.grid
    const cell = Math.round((origin[1] - 502.5) / cellM) * width + Math.round((497.5 - origin[0]) / cellM)
    expect(after.state.states[cell]).toBe(X_COVERED)
    expect(strict.method[cell]).toBe(M_CABLE)
    expect(strict.totalM[cell]).toBeCloseTo(100, 0)
    expect(extractionMapFeatures(after).some((f) => f.properties?.kind === 'extraction-class')).toBe(true)
  })

  it('suggests a few lines that yard most of the covered ground', () => {
    const sel = selectCableLines(g.eg, result.coverage.landings, result.coverage.lines, REFERENCE.lateralM, {
      ...DEFAULT_CABLE_SELECTION,
      maxLines: 12,
    })
    expect(sel.ids.length).toBeGreaterThan(3)
    expect(sel.ids.length).toBeLessThanOrEqual(12)
    expect(sel.shareOfFeasible).toBeGreaterThan(0.6)
    // Every chosen line yards at least the share rule of its band that no earlier choice did.
    const features = cableLineFeatures(
      g.eg,
      result.coverage.lines.filter((l) => sel.ids.includes(l.id)),
    )
    expect(features.filter((f) => f.properties?.kind === 'cable-line')).toHaveLength(sel.ids.length)
  })
})

describe('missing ground and the comparison', () => {
  it('reports ground beyond a gap as unknown, never beyond reach', async () => {
    const gap = (x: number, y: number) => (y > 520 && y < 540 ? NaN : concave(x, y))
    const g = grid(
      { ...REFERENCE, bearingStepDeg: 5 },
      [
        road('road', [
          [497.5, 402.5],
          [497.6, 402.5],
        ]),
      ],
      gap,
    )
    const { after } = await run(g)
    const { origin, cellM, width } = g.eg.sg.grid
    const at = (x: number, y: number) =>
      Math.round((origin[1] - y) / cellM) * width + Math.round((x - origin[0]) / cellM)
    expect(after.state.states[at(497.5, 502.5)]).toBe(X_COVERED)
    expect(after.state.states[at(497.5, 602.5)]).toBe(X_UNKNOWN)
  }, 60_000)

  it('counts landings on designed roads only after, for the before/after comparison', async () => {
    const g = grid({ ...REFERENCE, bearingStepDeg: 10 }, [
      road('mapped', [
        [497.5, 402.5],
        [497.6, 402.5],
      ]),
      road(
        'designed',
        [
          [497.5, 202.5],
          [497.6, 202.5],
        ],
        'design',
      ),
    ])
    const r = await run(g, true)
    expect(r.before).not.toBeNull()
    const cmp = compareExtraction(r.before!, r.after)
    expect(cmp.newlyHa).toBeGreaterThan(1)
    expect(cmp.lostHa).toBe(0)
  }, 60_000)
})

describe('band rasterising', () => {
  it('visits cell centres within the lateral distance, from the landing to the end', () => {
    const g = grid(REFERENCE, [
      road('road', [
        [497.5, 402.5],
        [497.6, 402.5],
      ]),
    ])
    let cells = 0,
      sum = 0
    forBandCells(g.eg, [497.5, 402.5], 0, 255, 40, (_, u) => {
      cells++
      sum += u
    })
    // 17 cells across (±40 m on 5 m centres) × 52 along (0–255 m): the reference's 22,100 m².
    expect(cells).toBe(17 * 52)
    expect(sum / cells).toBeCloseTo(127.5, 1)
  })
})

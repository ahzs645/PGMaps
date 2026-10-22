import { describe, expect, it } from 'vitest'
import {
  alignmentLength,
  analyzeRoad,
  curveDesignAt,
  distance,
  horizontalGeometry,
  offsetCoordinate,
  positionAt,
  spiralTangent,
} from './engine'
import { landXml } from './designExports'
import { fitHorizontalRadii } from './horizontalTools'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const ip = offsetCoordinate(origin, 0, 300)
const end = offsetCoordinate(ip, 90, 300)
const road = (spiralM: number, radiusM = 80): Alignment => ({
  id: 'r',
  name: 'Spiral road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: ip, radiusM, spiralM },
    { id: 'c', coordinate: end, radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
})

describe('clothoid transitions', () => {
  it('joins tangent, spiral, arc, spiral and tangent without gaps or heading jumps', () => {
    const pieces = horizontalGeometry(road(40))
    expect(pieces.map((p) => p.kind)).toEqual(['line', 'spiral', 'arc', 'spiral', 'line'])
    for (let i = 1; i < pieces.length; i++) expect(distance(pieces[i - 1].end, pieces[i].start)).toBeLessThan(0.002)
    const a = road(40)
    for (const p of pieces.slice(0, -1)) {
      const before = positionAt(a, p.station + p.length - 0.01).bearing,
        after = positionAt(a, p.station + p.length + 0.01).bearing
      expect(Math.abs(((after - before + 540) % 360) - 180)).toBeLessThan(0.05)
    }
  })

  it('puts TS and ST at the closed-form tangent distance from the PI', () => {
    const { trim, thetaS } = spiralTangent(80, Math.PI / 2, 40)
    expect(thetaS).toBeCloseTo(0.25, 9)
    const pieces = horizontalGeometry(road(40))
    expect(distance(pieces[0].end, ip)).toBeCloseTo(trim, 2)
    expect(distance(pieces[4].start, ip)).toBeCloseTo(trim, 2)
    // Arc angle = Δ − 2θs; the total length adds two spirals to the shorter arc.
    expect(pieces[2].length).toBeCloseTo(80 * (Math.PI / 2 - 0.5), 6)
    expect(alignmentLength(road(40))).toBeCloseTo(600 - 2 * trim + 80 + 80 * (Math.PI / 2 - 0.5), 2)
  })

  it('runs superelevation in along the spiral and analyzes without fit warnings', () => {
    const a = {
      ...road(40),
      curveDesign: {
        designSpeedKmh: 50,
        maxSuperelevationPercent: 8,
        sideFrictionFactor: 0.15,
        runoffLengthM: 10,
        wideningVehicleLengthM: null,
      },
    }
    const spiralIn = horizontalGeometry(a)[1]
    expect(curveDesignAt(a, spiralIn.station + spiralIn.length / 2)!.ratio).toBeCloseTo(0.5, 6)
    expect(curveDesignAt(a, spiralIn.station + spiralIn.length / 2)!.inside).toBe('right')
    const result = analyzeRoad(a, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    expect(result.warnings.some((w) => /does not fit|overlaps|Spirals at point/.test(w))).toBe(false)
  })

  it('keeps the runoff continuous and non-decreasing into the spiral, full at SC, symmetric out', () => {
    const designed = (spiralM: number, runoffLengthM: number): Alignment => ({
      ...road(spiralM),
      curveDesign: {
        designSpeedKmh: 50,
        maxSuperelevationPercent: 8,
        sideFrictionFactor: 0.15,
        runoffLengthM,
        wideningVehicleLengthM: 12,
      },
    })
    const ratio = (a: Alignment, s: number) => curveDesignAt(a, s)?.ratio ?? 0
    // R 80 m, 20 m spirals, 30 m runoff: the extra 10 m runs on the tangent, a third in by the TS.
    const long = designed(20, 30)
    const [, entry, arc, exit] = horizontalGeometry(long)
    const ts = entry.station,
      sc = arc.station,
      cs = arc.station + arc.length,
      st = exit.station + exit.length
    expect(ratio(long, ts - 10.01)).toBe(0)
    expect(ratio(long, ts - 0.01)).toBeCloseTo(1 / 3, 3)
    expect(ratio(long, ts + 0.01)).toBeCloseTo(1 / 3, 3)
    expect(ratio(long, sc)).toBe(1)
    expect(ratio(long, cs)).toBe(1)
    expect(ratio(long, st + 0.01)).toBeCloseTo(1 / 3, 3)
    expect(curveDesignAt(long, ts + 0.01)!.extraWidth).toBeCloseTo(
      (144 / 160) * curveDesignAt(long, ts + 0.01)!.ratio,
      9,
    )
    // A runoff shorter than the spiral: the spiral is the runoff, following its curvature from 0 at TS.
    const short = designed(40, 10)
    const [, shortEntry, shortArc] = horizontalGeometry(short)
    expect(curveDesignAt(short, shortEntry.station - 0.01)).toBeNull()
    expect(ratio(short, shortEntry.station + 10)).toBeCloseTo(0.25, 6)
    expect(ratio(short, shortArc.station)).toBe(1)
    for (const a of [long, short]) {
      const [, inSpiral, curve, outSpiral] = horizontalGeometry(a)
      const start = inSpiral.station - 40,
        middle = curve.station + curve.length / 2,
        stop = outSpiral.station + outSpiral.length + 40
      let previous = 0
      for (let s = start; s <= middle; s += 0.05) {
        const r = ratio(a, s)
        expect(r).toBeGreaterThanOrEqual(previous - 1e-9)
        // 0.05 m steps over at least a 20 m transition never move the ratio more than 0.0025.
        expect(r - previous).toBeLessThan(0.003)
        // The exit mirrors the entry about the middle of the symmetric curve.
        expect(ratio(a, 2 * middle - s)).toBeCloseTo(r, 6)
        previous = r
      }
      expect(ratio(a, stop)).toBe(0)
    }
  })

  it('recompiles the curve when only a spiral length changes on the same alignment', () => {
    const a = {
      ...road(20),
      curveDesign: {
        designSpeedKmh: 50,
        maxSuperelevationPercent: 8,
        sideFrictionFactor: 0.15,
        runoffLengthM: 0,
        wideningVehicleLengthM: null,
      },
    }
    const sc = horizontalGeometry(a)[2].station
    expect(curveDesignAt(a, sc - 1)!.ratio).toBeCloseTo(19 / 20, 6)
    a.points[1].spiralM = 40
    // At the old SC − 1 m the longer spiral, starting earlier, is (sc − 1 − ts′) / 40 developed.
    const ts = horizontalGeometry(a)[1].station
    expect(curveDesignAt(a, sc - 1)!.ratio).toBeCloseTo((sc - 1 - ts) / 40, 6)
  })

  it('falls back to a simple curve when two spirals would exceed the deflection', () => {
    const warnings = analyzeRoad(road(200, 60), { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS).warnings
    expect(warnings.some((w) => w.startsWith('Spirals at point 2'))).toBe(true)
  })

  it('exports clothoids to LandXML and fits radii around their longer tangents', () => {
    const analysis = analyzeRoad(road(40), { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const terrain = { kind: 'demo' as const, name: 'Flat', resolutionM: 1, verticalReference: 'CGVD2013' }
    const xml = landXml({ name: 'S', alignment: road(40), analysis, terrain, ...exportGrid(terrain, origin) })
    // Grid lengths and radii: each clothoid is scaled by its grid chord ÷ chainage chord.
    const spirals = [
      ...xml.matchAll(
        /<Spiral spiType="clothoid" rot="cw" length="([\d.]+)" radiusStart="([^"]+)" radiusEnd="([^"]+)"/g,
      ),
    ]
    expect(spirals).toHaveLength(2)
    expect(spirals[0][2]).toBe('INF')
    for (const [, length] of spirals) expect(Number(length)).toBeCloseTo(40, 0)
    expect(Number(spirals[0][3])).toBeCloseTo(80, 0)
    const fitted = fitHorizontalRadii(road(40, 0).points, { kind: 'radius', radiusM: 500 }).points[1].radiusM
    expect(spiralTangent(fitted, Math.PI / 2, 40).trim).toBeLessThanOrEqual(300 * 0.98 + 1e-6)
  })
})

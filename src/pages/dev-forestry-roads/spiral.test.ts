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

  it('falls back to a simple curve when two spirals would exceed the deflection', () => {
    const warnings = analyzeRoad(road(200, 60), { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS).warnings
    expect(warnings.some((w) => w.startsWith('Spirals at point 2'))).toBe(true)
  })

  it('exports clothoids to LandXML and fits radii around their longer tangents', () => {
    const analysis = analyzeRoad(road(40), { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const terrain = { kind: 'demo' as const, name: 'Flat', resolutionM: 1, verticalReference: 'CGVD2013' }
    const xml = landXml({ name: 'S', alignment: road(40), analysis, terrain, ...exportGrid(terrain, origin) })
    expect(xml.match(/<Spiral spiType="clothoid" rot="cw" length="40.000"/g)).toHaveLength(2)
    expect(xml).toContain('radiusStart="INF" radiusEnd="80.000"')
    const fitted = fitHorizontalRadii(road(40, 0).points, { kind: 'radius', radiusM: 500 }).points[1].radiusM
    expect(spiralTangent(fitted, Math.PI / 2, 40).trim).toBeLessThanOrEqual(300 * 0.98 + 1e-6)
  })
})

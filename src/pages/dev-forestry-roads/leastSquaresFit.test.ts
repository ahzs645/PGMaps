import { describe, expect, it } from 'vitest'
import { centrelineSamples, horizontalCurveSummary, offsetCoordinate, spiralTangent } from './engine'
import {
  fitLine,
  fitRoadGeometry,
  geometricCircle,
  kasaCircle,
  POORLY_DETERMINED_SHARE,
  type XY,
} from './leastSquaresFit'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

// Reference numbers: RFLTools functional specification §13.4 and §13.6 (textbook formulas).

const onCircle = (cx: number, cy: number, radii: number[], degrees: number[]): XY[] =>
  degrees.map((d, i) => [cx + radii[i] * Math.cos((d * Math.PI) / 180), cy + radii[i] * Math.sin((d * Math.PI) / 180)])

describe('circle fits', () => {
  const angles = [10, 35, 60, 80, 115]
  it('recovers an exact circle', () => {
    const points = onCircle(100, 200, [50, 50, 50, 50, 50], angles)
    for (const fit of [kasaCircle(points)!, geometricCircle(points)!]) {
      expect(fit.centre[0]).toBeCloseTo(100, 6)
      expect(fit.centre[1]).toBeCloseTo(200, 6)
      expect(fit.radiusM).toBeCloseTo(50, 6)
      expect(fit.maxResidualM).toBeLessThan(1e-6)
    }
  })
  it('matches the reference noisy fit, algebraic and geometric', () => {
    const points: XY[] = [
      [149.3389, 208.6998],
      [140.8757, 228.6215],
      [125.05, 243.3879],
      [108.665, 249.1419],
      [78.8268, 245.406],
    ]
    const kasa = kasaCircle(points)!
    expect(kasa.centre[0]).toBeCloseTo(99.8523, 3)
    expect(kasa.centre[1]).toBeCloseTo(199.738, 3)
    expect(kasa.radiusM).toBeCloseTo(50.2647, 3)
    expect(kasa.maxResidualM).toBeCloseTo(0.1361, 3)
    expect(kasa.rmsM).toBeCloseTo(0.0832, 3)
    const geometric = geometricCircle(points)!
    expect(geometric.centre[0]).toBeCloseTo(99.8499, 3)
    expect(geometric.centre[1]).toBeCloseTo(199.7336, 3)
    expect(geometric.radiusM).toBeCloseTo(50.2687, 3)
    expect(geometric.maxResidualM).toBeCloseTo(0.1371, 3)
    expect(geometric.rmsM).toBeCloseTo(0.0832, 3)
  })
  it('fits points symmetric about an axis through their centroid', () => {
    // Σuv = 0 here: a fit that divides by the cross-moment fails on this set.
    const points = onCircle(0, 0, [40, 40, 40, 40, 40], [30, 60, 90, 120, 150])
    const fit = kasaCircle(points)!
    expect(fit.radiusM).toBeCloseTo(40, 9)
    expect(fit.centre[0]).toBeCloseTo(0, 9)
    expect(geometricCircle(points)!.radiusM).toBeCloseTo(40, 9)
  })
  it('refuses points on a line', () => {
    expect(
      kasaCircle([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ).toBeNull()
  })
  it('flags a short noisy arc as poorly determined', () => {
    const degrees = Array.from({ length: 7 }, (_, i) => (i * 28.65) / 6)
    const points = onCircle(
      0,
      0,
      degrees.map((_, i) => (i % 2 ? 59.7 : 60.3)),
      degrees,
    )
    expect(kasaCircle(points)!.radiusM).toBeCloseTo(57.99, 1)
    const geometric = geometricCircle(points)!
    expect(geometric.radiusM).toBeCloseTo(69.52, 1)
    expect(geometric.radiusSigmaM! / geometric.radiusM).toBeGreaterThan(POORLY_DETERMINED_SHARE)
  })
})

describe('line fit', () => {
  it('is the principal axis, pointing first to last', () => {
    const fit = fitLine([
      [0, 0.1],
      [10, -0.1],
      [20, 0.1],
      [30, -0.1],
    ])!
    expect(Math.abs(fit.direction[1])).toBeLessThan(0.01)
    expect(fit.direction[0]).toBeGreaterThan(0)
    expect(fit.maxResidualM).toBeLessThan(0.13)
  })
})

describe('road geometry by least squares', () => {
  const origin: Coordinate = [-122.75, 53.917]
  const at = (east: number, north: number) =>
    offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
  const traced = (points: Alignment['points']) => {
    const alignment: Alignment = {
      id: 'r',
      name: 'r',
      color: '#000000',
      points,
      vertical: [],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
    }
    const line = centrelineSamples(alignment, 1)
    return line.samples.map((s) => line.toCoordinate(s.x, s.y))
  }
  // North 300 m to the PI, then 60° to the right for 300 m.
  const pi = at(0, 300)
  const end = at(300 * Math.sin(Math.PI / 3), 300 + 300 * Math.cos(Math.PI / 3))
  it('finds two tangents and the simple curve between them', () => {
    const line = traced([
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'b', coordinate: pi, radiusM: 80 },
      { id: 'c', coordinate: end, radiusM: 0 },
    ])
    const fit = fitRoadGeometry(line, { toleranceM: 0.1, minTangentM: 30, spirals: false })
    expect(fit.tangents).toHaveLength(2)
    expect(fit.bends).toHaveLength(1)
    const corner = fit.bends[0].corner!
    expect(corner.radiusM).toBeCloseTo(80, 0)
    expect((Math.abs(corner.deflection) * 180) / Math.PI).toBeCloseTo(60, 1)
    expect(corner.deflection).toBeLessThan(0)
    expect(corner.poorlyDetermined).toBe(false)
    expect(fit.points).toHaveLength(3)
    expect(fit.points[1].radiusM).toBeCloseTo(80, 0)
    expect(fit.maxDeviationM).toBeLessThan(0.1)
  })
  it('recovers a spiral–curve–spiral: R 100, Ls 40, Δ 60°, Ts 78.0927 m', () => {
    expect(spiralTangent(100, Math.PI / 3, 40).trim).toBeCloseTo(78.0927, 4)
    const line = traced([
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'b', coordinate: pi, radiusM: 100, spiralM: 40 },
      { id: 'c', coordinate: end, radiusM: 0 },
    ])
    const fit = fitRoadGeometry(line, { toleranceM: 0.05, minTangentM: 50, spirals: true })
    const corner = fit.bends[0].corner!
    expect(corner.radiusM).toBeCloseTo(100, 0)
    expect(corner.spiralM).toBeGreaterThan(38)
    expect(corner.spiralM).toBeLessThan(42)
    expect(corner.tangentM).toBeCloseTo(78.09, 0)
    expect(corner.maxResidualM).toBeLessThan(0.05)
    // The fitted points are a road the engine builds with the same curve.
    const adopted: Alignment = {
      id: 'f',
      name: 'f',
      color: '#000000',
      points: fit.points.map((p, i) => ({ id: `p${i}`, ...p })),
      vertical: [],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
    }
    const [curve] = horizontalCurveSummary(adopted)
    expect(curve.radius).toBeCloseTo(100, 0)
    expect(curve.deflectionDegrees).toBeCloseTo(60, 0)
  }, 30_000)
  it('reports a reverse bend with no tangent between its curves as not fitted', () => {
    const line = traced([
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'b', coordinate: at(0, 200), radiusM: 60 },
      { id: 'c', coordinate: at(40, 240), radiusM: 60 },
      { id: 'd', coordinate: at(40, 440), radiusM: 0 },
    ])
    const fit = fitRoadGeometry(line, { toleranceM: 0.1, minTangentM: 60, spirals: false })
    expect(fit.bends.some((bend) => bend.status === 'not-fitted')).toBe(true)
    expect(fit.points[0].coordinate).toEqual(line[0])
    expect(fit.points[fit.points.length - 1].coordinate).toEqual(line[line.length - 1])
  })
  it('refuses tolerances outside its limits', () => {
    expect(() => fitRoadGeometry([at(0, 0), at(0, 10)], { toleranceM: 0, minTangentM: 30, spirals: false })).toThrow(
      /tolerance/,
    )
  })
})

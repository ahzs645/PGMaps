import { describe, expect, it } from 'vitest'
import { corridorFrame } from './corridorOptimizer'
import { analyzeRoad, centrelineSamples, horizontalCurveSummary } from './engine'
import { describePolylineFit, fitPolylineAlignment, SMALLEST_CURVE_M } from './polylineFit'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const ORIGIN: Coordinate = [-122.8, 53.9]
const frame = corridorFrame(ORIGIN)
const at = (x: number, y: number) => frame.fromXY([x, y])
const road = (points: { coordinate: Coordinate; radiusM: number }[]): Alignment => ({
  id: 'fitted',
  name: 'Fitted',
  color: '#2563eb',
  points: points.map((point, i) => ({ id: `p${i}`, ...point })),
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
})
const toSegment = (p: number[], a: number[], b: number[]) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
/** How far the road the engine builds from the fit sits from the source line, and the source from it. */
function engineDeviation(source: Coordinate[], fitted: Alignment) {
  const line = source.map(frame.toXY)
  const centre = centrelineSamples(fitted, 1)
  const built = centre.samples.map((sample) => frame.toXY(centre.toCoordinate(sample.x, sample.y)))
  const far = (from: number[][], to: number[][]) =>
    Math.max(...from.map((p) => Math.min(...to.slice(1).map((b, i) => toSegment(p, to[i], b)))))
  return Math.max(far(built, line), far(line, built))
}

describe('polyline to alignment', () => {
  it('recovers the tangents and one curve from a line sampled along them', () => {
    // 200 m east, a 60 m radius curve through 50°, then 200 m on: a vertex every 5 m.
    const turn = (50 * Math.PI) / 180,
      radius = 60
    const source: Coordinate[] = []
    for (let s = 0; s <= 200; s += 5) source.push(at(s, 0))
    for (let a = 0.1; a < turn; a += 0.1) source.push(at(200 + radius * Math.sin(a), radius * (1 - Math.cos(a))))
    const end = [200 + radius * Math.sin(turn), radius * (1 - Math.cos(turn))]
    for (let s = 0; s <= 200; s += 5) source.push(at(end[0] + s * Math.cos(turn), end[1] + s * Math.sin(turn)))
    const fit = fitPolylineAlignment(source, { maxDeviationM: 1, minRadiusM: 35 })
    expect(fit.sourcePoints).toBe(source.length)
    expect(fit.sourcePoints).toBeGreaterThan(80)
    expect(fit.fittedPoints).toBe(3)
    expect(fit.curves).toBe(1)
    expect(fit.sharpCorners).toBe(0)
    expect(fit.smallestRadiusM).toBeGreaterThan(50)
    expect(fit.smallestRadiusM).toBeLessThan(72)
    expect(fit.maxDeviationM).toBeLessThanOrEqual(1.05)
    expect(fit.points[0].coordinate).toEqual(source[0])
    expect(fit.points[2].coordinate).toEqual(source[source.length - 1])
    // The engine builds the same road: the curve fits its tangents, and the line stays inside the limit.
    const fitted = road(fit.points)
    expect(horizontalCurveSummary(fitted).map((curve) => curve.radius)).toEqual([fit.smallestRadiusM])
    expect(engineDeviation(source, fitted)).toBeLessThanOrEqual(1.1)
    expect(fit.fittedLengthM).toBeCloseTo(centrelineSamples(fitted, 1).length, 0)
  })

  it('turns a grid route of 45° steps into a few curved corners inside the deviation', () => {
    // What the terrain-cost search returns: 20 m legs east and north-east, in runs.
    const xy: [number, number][] = [[0, 0]]
    const step = (dx: number, dy: number, times: number) => {
      for (let i = 0; i < times; i++) xy.push([xy[xy.length - 1][0] + dx, xy[xy.length - 1][1] + dy])
    }
    step(20, 0, 8)
    step(20, 20, 6)
    step(20, 0, 5)
    step(20, -20, 7)
    step(20, 0, 9)
    const source = xy.map(([x, y]) => at(x, y))
    const limits = { maxDeviationM: 6, minRadiusM: 35 }
    const fit = fitPolylineAlignment(source, limits)
    expect(fit.sourcePoints).toBe(36)
    expect(fit.fittedPoints).toBe(6)
    expect(fit.curves).toBe(4)
    expect(fit.sharpCorners).toBe(0)
    expect(fit.smallestRadiusM).toBeGreaterThanOrEqual(35)
    expect(fit.maxDeviationM).toBeLessThanOrEqual(6.05)
    const fitted = road(fit.points)
    const analysis = analyzeRoad(
      fitted,
      { elevationAt: () => 700 },
      { ...DEFAULT_ROAD_SETTINGS, minRadius: limits.minRadiusM },
    )
    expect(analysis.warnings.filter((warning) => /does not fit|overlaps/.test(warning))).toEqual([])
    expect(
      analysis.stations.flatMap((station) => station.flags).filter((flag) => /Sharp|Radius below/.test(flag)),
    ).toEqual([])
    expect(engineDeviation(source, fitted)).toBeLessThanOrEqual(6.1)
    expect(describePolylineFit(fit, limits)).toMatch(
      /^36 points reduced to 6 with 4 curves, the tightest \d+\.\d m\. The line moved at most \d\.\d m \(limit 6 m\); length 808 → 79\d m\.$/,
    )
  })

  it('keeps a point at each of two corners that turn opposite ways', () => {
    // A dog-leg: 45° left, 60 m on, then 45° right. There is no single curve for a reverse bend.
    const source = [at(0, 0), at(200, 0), at(242.4, 42.4), at(442.4, 42.4)]
    const fit = fitPolylineAlignment(source, { maxDeviationM: 10, minRadiusM: 35 })
    expect(fit.fittedPoints).toBe(4)
    expect(fit.curves).toBe(2)
    expect(fit.sharpCorners).toBe(0)
    expect(fit.smallestRadiusM).toBeGreaterThanOrEqual(35)
  })

  it('merges a corner cut in two into one curve where the tangents meet', () => {
    // A right angle drawn with a 30 m chamfer: one point at the corner and a curve through the chamfer.
    const source = [at(0, 0), at(200, 0), at(221.2, 21.2), at(221.2, 221.2)]
    const fit = fitPolylineAlignment(source, { maxDeviationM: 3, minRadiusM: 35 })
    expect(fit.fittedPoints).toBe(3)
    expect(fit.curves).toBe(1)
    expect(fit.sharpCorners).toBe(0)
    const [x, y] = frame.toXY(fit.points[1].coordinate)
    expect(x).toBeCloseTo(221.2, 1)
    expect(y).toBeCloseTo(0, 1)
    expect(fit.smallestRadiusM).toBeGreaterThanOrEqual(35)
    expect(fit.smallestRadiusM).toBeLessThan(40)
    expect(fit.maxDeviationM).toBeLessThan(3)
  })

  it('leaves a corner sharp, and says so, rather than fit a curve below the minimum radius', () => {
    // 120° of turn: a 50 m curve would sit 50 m inside the corner.
    const source = [at(0, 0), at(200, 0), at(100, 173.2)]
    const limits = { maxDeviationM: 2, minRadiusM: 50 }
    const fit = fitPolylineAlignment(source, limits)
    expect(fit).toMatchObject({ fittedPoints: 3, curves: 0, sharpCorners: 1, smallestRadiusM: null })
    expect(fit.points.map((point) => point.radiusM)).toEqual([0, 0, 0])
    expect(fit.maxDeviationM).toBeLessThan(0.01)
    expect(describePolylineFit(fit, limits)).toMatch(
      /with no curves\..*1 corner could not take a 50 m curve within 2 m and stays sharp: allow more deviation or a smaller radius\.$/,
    )
  })

  it('reads a minimum radius of 0 as no minimum, and still fits no curve tighter than 5 m', () => {
    // A right angle: within 4 m a 9.6 m curve fits; within 1 m only a 2.4 m one would.
    const source = [at(0, 0), at(200, 0), at(200, 200)]
    const roomy = fitPolylineAlignment(source, { maxDeviationM: 4, minRadiusM: 0 })
    expect(roomy).toMatchObject({ fittedPoints: 3, curves: 1, sharpCorners: 0 })
    expect(roomy.smallestRadiusM).toBeGreaterThanOrEqual(SMALLEST_CURVE_M)
    const tight = fitPolylineAlignment(source, { maxDeviationM: 1, minRadiusM: 0 })
    expect(tight).toMatchObject({ curves: 0, sharpCorners: 1 })
    expect(describePolylineFit(tight, { maxDeviationM: 1, minRadiusM: 0 })).toMatch(
      /1 corner could not take a 5 m curve within 1 m and stays sharp: allow more deviation\.$/,
    )
    // A minimum above the usual 1,000 m ceiling is fitted at, not refused.
    const gentle = [at(0, 0), at(3000, 0), at(6000, 200)]
    expect(fitPolylineAlignment(gentle, { maxDeviationM: 5, minRadiusM: 2000 }).smallestRadiusM).toBeGreaterThanOrEqual(
      2000,
    )
  })

  it('counts as sharp every point the engine flags, however slight its turn', () => {
    // Long tangents with bends of 0.4°, 0.3° and 0.45° on 2,000 m curves, and one 30° curve of 80 m.
    const xy: [number, number][] = [[0, 0]]
    let heading = 0
    for (const [leg, turn] of [
      [900, 0.4],
      [900, -0.3],
      [700, 30],
      [800, 0.45],
      [900, 0],
    ]) {
      const last = xy[xy.length - 1]
      xy.push([last[0] + Math.cos(heading) * leg, last[1] + Math.sin(heading) * leg])
      heading += (turn * Math.PI) / 180
    }
    const radii = [0, 2000, 2000, 80, 2000, 0]
    const curved = road(xy.map((point, i) => ({ coordinate: at(...point), radiusM: radii[i] })))
    const settings = { ...DEFAULT_ROAD_SETTINGS, minRadius: 35 }
    const flagged = (alignment: Alignment) =>
      new Set(
        analyzeRoad(alignment, { elevationAt: () => 700 }, settings, []).stations.flatMap((station) =>
          station.flags.some((flag) => /Sharp horizontal PI/.test(flag)) ? [station.chainage] : [],
        ),
      ).size
    expect(flagged(curved)).toBe(0)
    // As "Reduce points, fit curves" reads a road with curves: along its centreline, every 2 m.
    const centre = centrelineSamples(curved, 2)
    const line = centre.samples.map((sample) => centre.toCoordinate(sample.x, sample.y))
    for (const maxDeviationM of [5, 2, 1, 0.5]) {
      const fit = fitPolylineAlignment(line, { maxDeviationM, minRadiusM: settings.minRadius })
      // At 2 m and under, a bend of under 0.5° used to be kept with no curve and reported as 0 sharp.
      expect(fit.sharpCorners).toBe(flagged(road(fit.points)))
      expect(fit.sharpCorners).toBe(0)
      expect(fit.maxDeviationM).toBeLessThanOrEqual(maxDeviationM + 0.05)
    }
  })

  it('never rounds a fitted radius below a minimum that is not a whole tenth', () => {
    // A right angle with room for more than the minimum on one corner, and exactly the minimum on a merged one.
    const source = [at(0, 0), at(200, 0), at(200, 200)]
    for (const minRadiusM of [41.25, 37.77]) {
      const fit = fitPolylineAlignment(source, { maxDeviationM: 20, minRadiusM, maxRadiusM: minRadiusM })
      expect(fit.curves).toBe(1)
      expect(fit.smallestRadiusM).toBe(minRadiusM)
    }
  })

  it('drops points that do not turn the line', () => {
    const source = Array.from({ length: 41 }, (_, i) => at(i * 10, i * 2.5))
    const fit = fitPolylineAlignment(source, { maxDeviationM: 0.5, minRadiusM: 25 })
    expect(fit).toMatchObject({ sourcePoints: 41, fittedPoints: 2, curves: 0, sharpCorners: 0 })
    expect(fit.fittedLengthM).toBeCloseTo(fit.sourceLengthM, 6)
  })

  it('refuses limits it cannot work to', () => {
    const line = [at(0, 0), at(100, 0)]
    expect(() => fitPolylineAlignment(line, { maxDeviationM: 0, minRadiusM: 25 })).toThrow(
      /maximum deviation of 0\.1–500 m/,
    )
    expect(() => fitPolylineAlignment(line, { maxDeviationM: 5, minRadiusM: -1 })).toThrow(
      /minimum radius of 0 m or more/,
    )
    expect(() => fitPolylineAlignment(line, { maxDeviationM: 5, minRadiusM: 50, maxRadiusM: 40 })).toThrow(
      /largest radius/,
    )
    expect(() => fitPolylineAlignment([at(0, 0)], { maxDeviationM: 5, minRadiusM: 25 })).toThrow(/at least two points/)
  })
})

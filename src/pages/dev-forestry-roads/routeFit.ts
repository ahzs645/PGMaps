/**
 * Turns a searched route into road points, and checks the result where the search did not. A
 * terrain-cost grid route is verified along its own straight legs; fitting curves to it moves the
 * line off those legs, across ground and constraints nothing has looked at.
 *
 * Pure: takes terrain and constraints as arguments and touches neither the DOM nor the network.
 */
import { centrelineSamples } from './engine'
import { fitHorizontalRadii } from './horizontalTools'
import { fitPolylineAlignment, fittedMinimumRadius, SMALLEST_CURVE_M, type PolylineFitResult } from './polylineFit'
import { constraintRouteIssues } from './riparian'
import type { Alignment, ContextFeature, Coordinate, RoadTemplate, TerrainSource } from './types'

/**
 * How far a road built from a route may sit from it, tightest first. The route's ground grades were
 * checked along the route, so the fit that stays nearest it is preferred; a looser one is taken only
 * when it rounds a corner the tighter ones leave sharp. 16 m is what a right-angle corner needs for
 * a 35 m curve.
 */
export const ROUTE_FIT_DEVIATIONS_M = [2, 4, 8, 16]
/** Curves are fitted between the minimum radius and this many times it: wider ones wander from the route. */
const ROUTE_FIT_RADIUS_FACTOR = 2
export { SMALLEST_CURVE_M }
const CHECK_STEP_M = 1

export type RoutePoint = { coordinate: Coordinate; radiusM: number }
export interface CentrelineCheck {
  lengthM: number
  /** Length of centreline with no ground under it, to the nearest sample. */
  offTerrainM: number
  /** One sentence per blocked area the centreline enters or touches. */
  blocked: string[]
}

/** Ground under every metre of a centreline, and every blocked area in its way. */
export function checkCentreline(
  points: readonly RoutePoint[],
  terrain: TerrainSource,
  context: readonly ContextFeature[],
): CentrelineCheck {
  // Only the points shape a centreline; the rest of a road is not read.
  const road: Alignment = {
    id: 'route-fit',
    name: '',
    color: '',
    points: points.map((point, i) => ({ id: `route-fit-${i}`, ...point })),
    vertical: [],
    overrides: [],
    template: {} as RoadTemplate,
  }
  const centre = centrelineSamples(road, CHECK_STEP_M)
  const line = centre.samples.map((sample) => centre.toCoordinate(sample.x, sample.y))
  const spacing = centre.length / Math.max(1, line.length - 1)
  return {
    lengthM: centre.length,
    offTerrainM: line.filter((at) => !Number.isFinite(terrain.elevationAt(...at))).length * spacing,
    blocked: constraintRouteIssues(line, context),
  }
}

export interface RouteRoad {
  points: RoutePoint[]
  /** The fit that was kept; null when no fit stayed clear and the route is returned as found. */
  fit: PolylineFitResult | null
  /** The deviation limit the kept fit was held to, m. */
  maxDeviationM: number | null
  /** Corners given the largest curve their tangents hold, which is tighter than the minimum radius. */
  tightCurves: number
  /** Corners with no curve at all. */
  sharpCorners: number
}

/**
 * The route with fewer points and a curve at each corner, taking the fit with the fewest sharp
 * corners among those whose whole centreline stays on the terrain and off blocked areas. When none
 * does, the route is taken as found.
 *
 * A corner the minimum radius does not fit then gets the largest curve its tangents hold, of at
 * least `SMALLEST_CURVE_M`, if the road still stays clear with it: a tight curve is flagged against
 * the minimum radius and can be driven round, where a sharp corner is no road at all.
 *
 * A minimum radius of 0 means none was entered. Curves are then fitted from `SMALLEST_CURVE_M` up,
 * and none is counted as tight.
 */
export function roadFromRoute(
  route: Coordinate[],
  terrain: TerrainSource,
  context: readonly ContextFeature[],
  minRadiusM: number,
  deviationsM: readonly number[] = ROUTE_FIT_DEVIATIONS_M,
): RouteRoad {
  const fitted = fittedMinimumRadius(minRadiusM)
  let best: { points: RoutePoint[]; fit: PolylineFitResult; maxDeviationM: number } | null = null
  for (const maxDeviationM of deviationsM) {
    const fit = fitPolylineAlignment(route, {
      maxDeviationM,
      minRadiusM,
      maxRadiusM: fitted * ROUTE_FIT_RADIUS_FACTOR,
    })
    if (best && fit.sharpCorners >= best.fit.sharpCorners) continue
    const check = checkCentreline(fit.points, terrain, context)
    if (check.offTerrainM || check.blocked.length) continue
    best = { points: fit.points, fit, maxDeviationM }
    if (!fit.sharpCorners) break
  }
  const kept = best?.points ?? route.map((coordinate) => ({ coordinate: [...coordinate] as Coordinate, radiusM: 0 }))
  const tightened = fitHorizontalRadii(
    kept.map((point, i) => ({ id: `route-fit-${i}`, ...point })),
    { kind: 'radius', radiusM: fitted },
    { minRadiusM, onlySharp: true },
  )
  const tight = new Set(
    tightened.report.filter((corner) => corner.radiusM >= SMALLEST_CURVE_M).map((corner) => corner.index),
  )
  const curved = kept.map((point, i) => (tight.has(i) ? { ...point, radiusM: tightened.points[i].radiusM } : point))
  const clear = (points: RoutePoint[]) => {
    const check = checkCentreline(points, terrain, context)
    return !check.offTerrainM && !check.blocked.length
  }
  let points = kept
  if (tight.size && clear(curved)) points = curved
  // One curve that leaves the terrain should not cost the others theirs: take them a corner at a time.
  else
    for (const i of tight) {
      const trial = points.map((point, k) => (k === i ? curved[k] : point))
      if (clear(trial)) points = trial
    }
  return {
    points,
    fit: best?.fit ?? null,
    maxDeviationM: best?.maxDeviationM ?? null,
    tightCurves: points.filter((point) => point.radiusM > 0 && point.radiusM < minRadiusM - 1e-6).length,
    // The engine flags every interior point without a curve, as this does.
    sharpCorners: points.slice(1, -1).filter((point) => !(point.radiusM > 0)).length,
  }
}

/** "3 curves tighter than 35 m, 1 sharp corner": what a road made from a route still breaks, or ''. */
export function routeRoadFlags(road: Pick<RouteRoad, 'tightCurves' | 'sharpCorners'>, minRadiusM: number) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return [
    road.tightCurves > 0 && `${plural(road.tightCurves, 'curve')} tighter than ${minRadiusM} m`,
    road.sharpCorners > 0 && plural(road.sharpCorners, 'sharp corner'),
  ]
    .filter(Boolean)
    .join(', ')
}

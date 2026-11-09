/**
 * Roads made from a terrain-cost route search, and what becomes of the ones a later search replaces.
 *
 * Each found route becomes a road with curves fitted where they stay on the terrain, a name that is
 * only an identifier, and a record of the search's own figures. A road still exactly as the search
 * made it is an alternative nobody has taken up, and the next search replaces it; one that has been
 * renamed, moved or given a profile is the designer's and stays.
 *
 * Pure: takes terrain and constraints as arguments and touches neither the DOM nor the network.
 */
import { derivedRoadName } from './roadNames'
import { roadFromRoute, SMALLEST_CURVE_M } from './routeFit'
import type { RouteCandidate } from './routing'
import type { Alignment, ContextFeature, Coordinate, RoadPoint, RouteSearchRecord, TerrainSource } from './types'

export const ROUTE_ALTERNATIVE_SUFFIX = 'terrain-cost route'

/** A short fingerprint of a road's horizontal points, to tell whether they have been edited. */
export function routePointsKey(points: readonly Pick<RoadPoint, 'coordinate' | 'radiusM'>[]) {
  let a = 0xdeadbeef,
    b = 0x41c6ce57
  for (const point of points)
    for (const value of [...point.coordinate, point.radiusM]) {
      const text = value.toFixed(7)
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        a = Math.imul(a ^ code, 2654435761)
        b = Math.imul(b ^ code, 1597334677)
      }
    }
  return `${points.length}-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

/** Still as the search made it: same points and name, and nothing designed on it. */
export function isUntouchedRouteAlternative(road: Alignment) {
  const record = road.routeSearch
  return (
    !!record &&
    record.name === road.name &&
    record.pointsKey === routePointsKey(road.points) &&
    !road.vertical.length &&
    !road.overrides.length &&
    !road.verticalAlternatives?.length &&
    !road.verticalControls?.length &&
    !road.verticalStandards &&
    !road.engineering &&
    !road.crossingRecords?.length &&
    !road.fullCostRecord
  )
}

export interface RouteAlternativesInput {
  /** The road the search ran between the ends of. It is never replaced. */
  source: Alignment
  /** What the new roads are named after, when that is not the source's own name. */
  baseName?: string
  roads: readonly Alignment[]
  routes: readonly RouteCandidate[]
  terrain: TerrainSource
  context: readonly ContextFeature[]
  minRadiusM: number
  /** A new road along these points, with its own id, colour and template. */
  make: (coordinates: Coordinate[], name: string) => Alignment
}
export interface RouteAlternatives {
  /** The project's roads after the search: earlier untouched alternatives out, the new ones in. */
  roads: Alignment[]
  created: Alignment[]
  replaced: number
  /** What a designer should know about the new roads beyond the search's own message. */
  notes: string[]
}

/** Untouched alternatives of earlier searches, other than the road now being searched from. */
export const replaceableRouteAlternatives = (roads: readonly Alignment[], sourceId: string) =>
  roads.filter((road) => road.id !== sourceId && isUntouchedRouteAlternative(road))

export function terrainCostAlternatives(input: RouteAlternativesInput): RouteAlternatives {
  const { source, routes, terrain, context, minRadiusM } = input
  const replaced = new Set(replaceableRouteAlternatives(input.roads, source.id).map((road) => road.id))
  const kept = input.roads.filter((road) => !replaced.has(road.id))
  const taken = kept.map((road) => road.name)
  let sharp = 0,
    tight = 0,
    asFound = 0
  const created = routes.map((route, i) => {
    const road = roadFromRoute(route.coordinates, terrain, context, minRadiusM)
    sharp += road.sharpCorners
    tight += road.tightCurves
    if (!road.fit) asFound++
    // The number is an identifier, the lowest one free. Rank and score are in the record, not the name.
    let number = 1
    const named = (n: number) => derivedRoadName(input.baseName ?? source.name, `${ROUTE_ALTERNATIVE_SUFFIX} ${n}`)
    while (taken.includes(named(number))) number++
    const name = named(number)
    taken.push(name)
    const made = input.make(
      road.points.map((point) => point.coordinate),
      name,
    )
    const points = made.points.map((point, k) => ({ ...point, radiusM: road.points[k].radiusM }))
    const record: RouteSearchRecord = {
      kind: 'terrain-cost',
      rank: i + 1,
      of: routes.length,
      searchScore: route.searchScore,
      lengthM: route.lengthM,
      crossings: route.crossings,
      name,
      pointsKey: routePointsKey(points),
    }
    return { ...made, points, routeSearch: record }
  })
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const notes: string[] = []
  if (replaced.size)
    notes.push(
      `Replaced ${plural(replaced.size, 'route')} from an earlier search that had not been changed; Undo brings ${replaced.size === 1 ? 'it' : 'them'} back.`,
    )
  if (tight)
    notes.push(
      `${plural(tight, 'corner')} had no room for a ${minRadiusM} m curve and took the largest that fits; ${tight === 1 ? 'it is' : 'they are'} flagged as below the minimum radius.`,
    )
  if (sharp)
    notes.push(
      `${plural(sharp, 'corner')} ${sharp === 1 ? 'stays' : 'stay'} sharp: no curve of ${SMALLEST_CURVE_M} m or more fits there on the terrain and off blocked areas.`,
    )
  if (asFound)
    notes.push(
      `${plural(asFound, 'route')} ${asFound === 1 ? 'keeps' : 'keep'} every point of the grid route: no simpler line stays on the terrain and off blocked areas.`,
    )
  return { roads: [...kept, ...created], created, replaced: replaced.size, notes }
}

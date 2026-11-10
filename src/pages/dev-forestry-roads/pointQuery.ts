/**
 * Point query on the plan: the station and offset of any point against the nearest road, the ground
 * and design levels there and the cut or fill depth between them; and the reverse, a typed station
 * and offset located on a road. Offsets are negative to the left looking up-station. A level that
 * cannot be read stays unknown and says why. No DOM.
 */
import { centrelineSamples, createRoadStationSampler, distance, offsetCoordinate, positionAt } from './engine'
import { pegBearing } from './pegging'
import { sectionSampleAt } from './sectionGeometry'
import type { SectionReferenceSources } from './sectionReferences'
import type { Alignment, Coordinate, RoadSettings, RoadStation, TerrainSource } from './types'

/** The centreline is read every metre to find the nearest station: about 6 mm off on a 20 m curve. */
export const POINT_QUERY_STEP_M = 1
/** …but a long road is read in at most this many pieces. */
export const MAX_POINT_QUERY_SAMPLES = 20000
/** A typed offset of at most this much either side. */
export const MAX_QUERY_OFFSET_M = 1000
/** Within this of the design or ground line, the point is on grade. */
export const ON_GRADE_M = 0.005

/** A point more than this before the start or past the end is beyond the road. */
const BEYOND_M = 0.01
const RAD = Math.PI / 180
const METRES_PER_DEGREE = 111_194.93

export interface RoadProjection {
  chainage: number
  /** Signed: negative left of the centreline looking up-station. */
  offset: number
  /** The centreline point at `chainage`. */
  centre: Coordinate
  /** Up-station bearing of the centreline there, degrees from north. */
  bearing: number
  /** The point lies before the road's start or past its end, so the offset is not square to it. */
  beyond: 'start' | 'end' | null
}

/** The nearest centreline point to `point`, or null when the road cannot be compiled. */
export function projectOntoRoad(alignment: Alignment, point: Coordinate): RoadProjection | null {
  let line: ReturnType<typeof centrelineSamples>
  try {
    if (alignment.points.length < 2) return null
    const length = centrelineSamples(alignment, 1e9).length
    line = centrelineSamples(alignment, Math.max(POINT_QUERY_STEP_M, length / MAX_POINT_QUERY_SAMPLES))
  } catch {
    return null
  }
  // A local metric frame at the query point: x east, y north.
  const cos = Math.cos(point[1] * RAD)
  const local = (c: Coordinate) => [(c[0] - point[0]) * METRES_PER_DEGREE * cos, (c[1] - point[1]) * METRES_PER_DEGREE]
  const vertices = line.samples.map((sample) => ({ s: sample.s, coordinate: line.toCoordinate(sample.x, sample.y) }))
  const xy = vertices.map((vertex) => local(vertex.coordinate))
  let best = { d2: Infinity, i: 0, t: 0, past: 0 }
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1],
      [bx, by] = xy[i]
    const dx = bx - ax,
      dy = by - ay
    const span = dx * dx + dy * dy
    const raw = span > 0 ? -(ax * dx + ay * dy) / span : 0
    const t = Math.max(0, Math.min(1, raw))
    const px = ax + dx * t,
      py = ay + dy * t
    const d2 = px * px + py * py
    // How far before or past the segment the foot falls, in metres.
    if (d2 < best.d2) best = { d2, i, t, past: span > 0 ? (raw < 0 ? raw : Math.max(0, raw - 1)) * Math.sqrt(span) : 0 }
  }
  if (!Number.isFinite(best.d2)) return null
  const a = vertices[best.i - 1],
    b = vertices[best.i]
  const chainage = a.s + (b.s - a.s) * best.t
  const centre: Coordinate = [
    a.coordinate[0] + (b.coordinate[0] - a.coordinate[0]) * best.t,
    a.coordinate[1] + (b.coordinate[1] - a.coordinate[1]) * best.t,
  ]
  const bearing = pegBearing(a.coordinate, b.coordinate)
  const [ax, ay] = xy[best.i - 1],
    [bx, by] = xy[best.i]
  // To the point from the centre, crossed with the direction of travel: positive is to the left.
  const cx = ax + (bx - ax) * best.t,
    cy = ay + (by - ay) * best.t
  const cross = (bx - ax) * -cy - (by - ay) * -cx
  const size = distance(centre, point)
  const beyond =
    best.i === 1 && best.past < -BEYOND_M ? 'start' : best.i === xy.length - 1 && best.past > BEYOND_M ? 'end' : null
  return { chainage, offset: cross > 0 ? -size : size, centre, bearing, beyond }
}

/** The point at a station and offset on a road, the station held to the road; null if it cannot compile. */
export function locateStationOffset(
  alignment: Alignment,
  chainage: number,
  offset: number,
): { coordinate: Coordinate; centre: Coordinate; bearing: number; chainage: number } | null {
  if (!Number.isFinite(chainage) || !Number.isFinite(offset)) return null
  try {
    const length = centrelineSamples(alignment, 1e9).length
    const at = Math.max(0, Math.min(length, chainage))
    const place = positionAt(alignment, at)
    // Negative offsets are to the left: a quarter turn anticlockwise from the bearing.
    const coordinate = offset === 0 ? place.coordinate : offsetCoordinate(place.coordinate, place.bearing + 90, offset)
    return { coordinate, centre: place.coordinate, bearing: place.bearing, chainage: at }
  } catch {
    return null
  }
}

export type DesignUnknown = 'no-section' | 'outside-footprint' | 'no-design'

export interface PointQueryResult {
  roadId: string
  roadName: string
  /** The point queried: the clicked point, or the typed station and offset located. */
  coordinate: Coordinate
  centre: Coordinate
  chainage: number
  offset: number
  beyond: 'start' | 'end' | null
  /** Ground under the point, from the source terrain. */
  ground: number | null
  /** The design surface at this station and offset: formation, ditch or batter. */
  design: number | null
  /** Design minus ground: positive is fill, negative is cut. Null when either level is unknown. */
  depth: number | null
  designUnknown: DesignUnknown | null
}

/**
 * Levels at a station and offset on one road. `sectionAt` evaluates that road's section exactly at
 * the station (a `createRoadStationSampler`), or returns null when it cannot.
 */
export function levelsAt(
  station: RoadStation | null,
  offset: number,
  ground: number | null,
): Pick<PointQueryResult, 'design' | 'depth' | 'designUnknown'> {
  if (!station) return { design: null, depth: null, designUnknown: 'no-section' }
  const designed = station.section.filter((sample) => sample.design !== null && Number.isFinite(sample.design))
  const design = sectionSampleAt(station, offset).design
  if (design === null) {
    const inside =
      designed.length > 0 &&
      offset >= Math.min(...designed.map((sample) => sample.offset)) &&
      offset <= Math.max(...designed.map((sample) => sample.offset))
    return { design: null, depth: null, designUnknown: inside ? 'no-design' : 'outside-footprint' }
  }
  return { design, depth: ground === null ? null : design - ground, designUnknown: null }
}

const groundAt = (terrain: TerrainSource, point: Coordinate) => {
  const z = terrain.elevationAt(...point)
  return Number.isFinite(z) ? z : null
}

function evaluate(
  road: Alignment,
  sectionAt: (road: Alignment, chainage: number) => RoadStation | null,
  chainage: number,
): RoadStation | null {
  try {
    return sectionAt(road, chainage)
  } catch {
    return null
  }
}

/** Query a clicked point against the nearest of `roads`; null when none can be compiled. */
export function queryPoint(
  roads: readonly Alignment[],
  point: Coordinate,
  terrain: TerrainSource,
  sectionAt: (road: Alignment, chainage: number) => RoadStation | null,
): PointQueryResult | null {
  let nearest: { road: Alignment; projection: RoadProjection; distance: number } | null = null
  for (const road of roads) {
    const projection = projectOntoRoad(road, point)
    if (!projection) continue
    const size = Math.abs(projection.offset)
    if (!nearest || size < nearest.distance) nearest = { road, projection, distance: size }
  }
  if (!nearest) return null
  const { road, projection } = nearest
  const ground = groundAt(terrain, point)
  return {
    roadId: road.id,
    roadName: road.name,
    coordinate: point,
    centre: projection.centre,
    chainage: projection.chainage,
    offset: projection.offset,
    beyond: projection.beyond,
    ground,
    ...levelsAt(evaluate(road, sectionAt, projection.chainage), projection.offset, ground),
  }
}

/** Query a typed station and offset on one road, the station evaluated where it was typed. */
export function queryStationOffset(
  road: Alignment,
  chainage: number,
  offset: number,
  terrain: TerrainSource,
  sectionAt: (road: Alignment, chainage: number) => RoadStation | null,
): PointQueryResult | null {
  if (!Number.isFinite(offset) || Math.abs(offset) > MAX_QUERY_OFFSET_M) return null
  const located = locateStationOffset(road, chainage, offset)
  if (!located) return null
  const ground = groundAt(terrain, located.coordinate)
  return {
    roadId: road.id,
    roadName: road.name,
    coordinate: located.coordinate,
    centre: located.centre,
    chainage: located.chainage,
    offset,
    beyond: null,
    ground,
    ...levelsAt(evaluate(road, sectionAt, located.chainage), offset, ground),
  }
}

/** "Cut 1.20 m", "Fill 0.80 m", "On grade" or null when the depth is unknown. */
export function depthLabel(depth: number | null): string | null {
  if (depth === null || !Number.isFinite(depth)) return null
  if (Math.abs(depth) < ON_GRADE_M) return 'On grade'
  return `${depth < 0 ? 'Cut' : 'Fill'} ${Math.abs(depth).toFixed(2)} m`
}

export const DESIGN_UNKNOWN_TEXT: Record<DesignUnknown, string> = {
  'no-section': 'No section could be evaluated at this station',
  'outside-footprint': 'Outside the road’s footprint: beyond the catch point',
  'no-design': 'No design line here: the section has a gap',
}

/**
 * Sections evaluated exactly at a station, one sampler per road built on the first query that
 * needs it. A road that cannot be compiled has no section: the lookup returns null for it.
 */
export function roadSectionLookup(
  terrain: TerrainSource,
  settings: RoadSettings,
  references: SectionReferenceSources,
): (road: Alignment, chainage: number) => RoadStation | null {
  const samplers = new Map<Alignment, ReturnType<typeof createRoadStationSampler> | null>()
  return (road, chainage) => {
    if (!samplers.has(road)) {
      try {
        samplers.set(road, createRoadStationSampler(road, terrain, settings, references))
      } catch {
        samplers.set(road, null)
      }
    }
    return samplers.get(road)?.at(chainage) ?? null
  }
}

/**
 * Locking a drawn corridor onto a real road.
 *
 * A hand-drawn line is a guess at where the road goes, and the guess shows up
 * in the numbers: a vertex that lands in a gully or on the far bank puts a
 * viewing station somewhere no driver ever is, and that station reports seeing
 * nothing. Snapping to the road the basemap already draws removes that whole
 * class of artefact.
 *
 * Roads come from the rendered basemap rather than a separate service, so this
 * works wherever the map has roads and costs no extra request. (The province's
 * own Digital Road Atlas view is published with a null object-id field and its
 * spatial queries return nothing, so it is not a usable source here.)
 */

import { haversineMeters, lineLengthMeters, type GeoPoint } from './visibility'

export type RoadCandidate = {
  id: string
  name: string
  /** Basemap road class: `motorway`, `trunk`, `primary`, `track`, and so on. */
  roadClass: string | null
  coordinates: Array<[number, number]>
}

/** Road classes worth snapping to. Footpaths and ferries are not driven. */
const SNAPPABLE_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  'unclassified',
  'road',
])

/** Endpoints closer than this are treated as the same node when chaining. */
const JOIN_TOLERANCE_METERS = 25

/** The vector-tile layer the basemap draws roads from. */
export const ROAD_SOURCE_LAYER = 'transportation'

function positionsOf(geometry: GeoJSON.Geometry | null | undefined): Array<Array<[number, number]>> {
  if (geometry?.type === 'LineString') return [geometry.coordinates as Array<[number, number]>]
  if (geometry?.type === 'MultiLineString') return geometry.coordinates as Array<Array<[number, number]>>
  return []
}

/** Identity of a line, to six decimal places — about 10 cm. */
function partKey(part: Array<[number, number]>): string {
  return part.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
}

/** An endpoint, to about a metre — fine enough to tell junctions apart. */
function nodeKey(position: [number, number]): string {
  return `${position[0].toFixed(5)},${position[1].toFixed(5)}`
}

/** Union-find over endpoints, for chaining roads that carry no name. */
function makeUnionFind() {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    let root = parent.get(key) ?? key
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root
    // Flatten, so a long road does not walk its whole chain on every lookup.
    let walk = key
    while (walk !== root) {
      const next = parent.get(walk) ?? root
      parent.set(walk, root)
      walk = next
    }
    parent.set(key, root)
    return root
  }
  return {
    find,
    union(a: string, b: string) {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parent.set(rootB, rootA)
    },
  }
}

/** Sentence case for a basemap road class, for roads with no name of their own. */
function classLabel(roadClass: string | null): string {
  if (!roadClass) return 'Unnamed road'
  const words: Record<string, string> = {
    motorway: 'Unnamed motorway',
    trunk: 'Unnamed highway',
    primary: 'Unnamed primary road',
    secondary: 'Unnamed secondary road',
    tertiary: 'Unnamed tertiary road',
    minor: 'Unnamed side road',
    service: 'Unnamed service road',
    track: 'Unnamed resource road',
    unclassified: 'Unnamed road',
    road: 'Unnamed road',
  }
  return words[roadClass] ?? 'Unnamed road'
}

/**
 * Turns rendered basemap features into snap candidates, merging the segments a
 * vector tile splits a road into so a highway is one line rather than forty.
 *
 * Styles draw a road as a casing under a fill, so the same geometry arrives
 * twice; duplicates are dropped rather than chained end to end into a road that
 * doubles back on itself.
 */
export function roadsFromFeatures(features: Array<GeoJSON.Feature | null | undefined>): RoadCandidate[] {
  const seen = new Set<string>()
  type Piece = { name: string; roadClass: string | null; part: Array<[number, number]> }
  const pieces: Piece[] = []
  const nodes = makeUnionFind()

  features.forEach((feature) => {
    const properties = (feature?.properties ?? {}) as Record<string, unknown>
    const roadClass = typeof properties.class === 'string' ? properties.class : null
    if (roadClass && !SNAPPABLE_CLASSES.has(roadClass)) return

    // A highway number is a name as far as a person reading the list is concerned.
    const named = [properties.name, properties.ref].find((value) => typeof value === 'string' && value.trim()) as
      | string
      | undefined
    const name = named?.trim() ?? ''

    for (const part of positionsOf(feature?.geometry)) {
      if (part.length < 2) continue
      // A reversed copy of a line is the same line, so both directions count.
      const forward = partKey(part)
      const backward = partKey([...part].reverse())
      if (seen.has(forward) || seen.has(backward)) continue
      seen.add(forward)

      // Unnamed roads are most of the resource network, and a vector tile hands
      // them over in fragments. Chaining them by shared endpoints turns forty
      // nameless slivers into the one road a person would point at.
      if (!name) nodes.union(nodeKey(part[0]), nodeKey(part[part.length - 1]))
      pieces.push({ name, roadClass, part })
    }
  })

  const groups = new Map<string, { name: string; roadClass: string | null; parts: Array<Array<[number, number]>> }>()
  for (const piece of pieces) {
    const key = piece.name
      ? `${piece.name}::${piece.roadClass ?? ''}`
      : `unnamed:${piece.roadClass ?? ''}:${nodes.find(nodeKey(piece.part[0]))}`
    const existing = groups.get(key)
    if (existing) existing.parts.push(piece.part)
    else
      groups.set(key, {
        name: piece.name || classLabel(piece.roadClass),
        roadClass: piece.roadClass,
        parts: [piece.part],
      })
  }

  return [...groups.entries()].map(([key, group]) => ({
    id: key,
    name: group.name,
    roadClass: group.roadClass,
    coordinates: chainSegments(group.parts),
  }))
}

/**
 * Joins line segments into one path by walking from whichever end is free,
 * matching endpoints within a tolerance. Segments that never connect are
 * appended so nothing is silently dropped.
 */
export function chainSegments(segments: Array<Array<[number, number]>>): Array<[number, number]> {
  const remaining = segments.filter((segment) => segment.length >= 2).map((segment) => [...segment])
  if (remaining.length === 0) return []

  // Start from the longest piece: it anchors the chain on the main road rather
  // than on a stub that happens to come first.
  remaining.sort((a, b) => lineLengthMeters(b) - lineLengthMeters(a))
  const chain = remaining.shift()!

  let joined = true
  while (joined && remaining.length > 0) {
    joined = false
    const head = chain[0]
    const tail = chain[chain.length - 1]

    for (let index = 0; index < remaining.length; index += 1) {
      const segment = remaining[index]
      const start = segment[0]
      const end = segment[segment.length - 1]
      const near = (a: [number, number], b: [number, number]) =>
        haversineMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] }) <= JOIN_TOLERANCE_METERS

      if (near(tail, start)) chain.push(...segment.slice(1))
      else if (near(tail, end)) chain.push(...[...segment].reverse().slice(1))
      else if (near(head, end)) chain.unshift(...segment.slice(0, -1))
      else if (near(head, start)) chain.unshift(...[...segment].reverse().slice(0, -1))
      else continue

      remaining.splice(index, 1)
      joined = true
      break
    }
  }

  // Anything left is a disconnected piece of the same road; keep it rather than
  // pretend the road stops where the tile split it.
  for (const segment of remaining) chain.push(...segment)
  return chain
}

export type PointOnLine = {
  position: [number, number]
  /** Distance from the start of the line, in metres. */
  distanceAlongMeters: number
  /** Perpendicular distance from the queried point, in metres. */
  offsetMeters: number
}

/**
 * Nearest point on a polyline, measured in a local planar frame. Over the few
 * kilometres a snap covers, the error from ignoring curvature is far below the
 * width of the road.
 */
export function nearestPointOnLine(
  line: ReadonlyArray<readonly [number, number]>,
  point: GeoPoint,
): PointOnLine | null {
  if (line.length === 0) return null
  if (line.length === 1) {
    return {
      position: [line[0][0], line[0][1]],
      distanceAlongMeters: 0,
      offsetMeters: haversineMeters(point, { lng: line[0][0], lat: line[0][1] }),
    }
  }

  const scaleLng = Math.cos((point.lat * Math.PI) / 180)
  const planar = (position: readonly [number, number]) => [position[0] * scaleLng, position[1]] as const
  const target = planar([point.lng, point.lat])

  let best: PointOnLine | null = null
  let travelled = 0

  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1]
    const to = line[index]
    const segmentLength = haversineMeters({ lng: from[0], lat: from[1] }, { lng: to[0], lat: to[1] })

    const a = planar(from)
    const b = planar(to)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lengthSquared = dx * dx + dy * dy
    const t =
      lengthSquared > 0
        ? Math.max(0, Math.min(1, ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / lengthSquared))
        : 0

    const position: [number, number] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
    const offsetMeters = haversineMeters(point, { lng: position[0], lat: position[1] })

    if (!best || offsetMeters < best.offsetMeters) {
      best = { position, distanceAlongMeters: travelled + segmentLength * t, offsetMeters }
    }
    travelled += segmentLength
  }

  return best
}

/** The stretch of a line between two distances along it, endpoints included. */
export function sliceLine(
  line: ReadonlyArray<readonly [number, number]>,
  fromMeters: number,
  toMeters: number,
): Array<[number, number]> {
  const start = Math.min(fromMeters, toMeters)
  const end = Math.max(fromMeters, toMeters)
  const slice: Array<[number, number]> = []
  let travelled = 0

  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1]
    const to = line[index]
    const segmentLength = haversineMeters({ lng: from[0], lat: from[1] }, { lng: to[0], lat: to[1] })
    const segmentEnd = travelled + segmentLength

    if (segmentEnd >= start && travelled <= end && segmentLength > 0) {
      const at = (distance: number): [number, number] => {
        const t = Math.max(0, Math.min(1, (distance - travelled) / segmentLength))
        return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
      }
      if (slice.length === 0) slice.push(at(start))
      slice.push(at(Math.min(end, segmentEnd)))
    }
    travelled = segmentEnd
  }

  return slice
}

export type SnapResult = {
  road: RoadCandidate
  coordinates: Array<[number, number]>
  /** Mean distance the drawn line sat from the road, in metres. */
  meanOffsetMeters: number
}

export type SnapOptions = {
  /** A drawn line further than this from every road is left alone. */
  maxOffsetMeters?: number
}

/**
 * Replaces a drawn corridor with the real road it was tracing.
 *
 * The best road is the one the drawn vertices sit closest to on average, and
 * the result is that road trimmed to the stretch the drawing covered — so a
 * short sketch along a highway does not return the whole highway.
 */
export function snapCorridorToRoad(
  drawn: ReadonlyArray<readonly [number, number]>,
  roads: RoadCandidate[],
  { maxOffsetMeters = 250 }: SnapOptions = {},
): SnapResult | null {
  if (drawn.length === 0 || roads.length === 0) return null

  let best: SnapResult | null = null

  for (const road of roads) {
    if (road.coordinates.length < 2) continue

    let offsetTotal = 0
    let counted = 0
    let minAlong = Number.POSITIVE_INFINITY
    let maxAlong = Number.NEGATIVE_INFINITY

    for (const vertex of drawn) {
      const nearest = nearestPointOnLine(road.coordinates, { lng: vertex[0], lat: vertex[1] })
      if (!nearest) continue
      offsetTotal += nearest.offsetMeters
      counted += 1
      minAlong = Math.min(minAlong, nearest.distanceAlongMeters)
      maxAlong = Math.max(maxAlong, nearest.distanceAlongMeters)
    }
    if (counted === 0) continue

    const meanOffsetMeters = offsetTotal / counted
    if (meanOffsetMeters > maxOffsetMeters) continue
    if (best && meanOffsetMeters >= best.meanOffsetMeters) continue

    // A single dropped point has no extent, so take a short run of road around it.
    const span = maxAlong - minAlong
    const [from, to] = span > 1 ? [minAlong, maxAlong] : [minAlong - 500, minAlong + 500]
    const coordinates = sliceLine(road.coordinates, from, to)
    if (coordinates.length < 2) continue

    best = { road, coordinates, meanOffsetMeters }
  }

  return best
}

/**
 * The part of a map this module needs, so the collector can be tested without
 * standing up MapLibre.
 */
export type RoadQueryMap = {
  getStyle: () => { layers?: Array<{ id: string; type?: string; 'source-layer'?: string }> } | undefined
  queryRenderedFeatures: (options: { layers: string[] }) => Array<GeoJSON.Feature | null | undefined>
}

/**
 * Style layer ids that draw roads.
 *
 * Casings are skipped: they carry the same geometry as the fill above them, so
 * querying both doubles the work for nothing.
 */
export function roadLayerIds(map: RoadQueryMap): string[] {
  const layers = map.getStyle()?.layers ?? []
  return layers
    .filter(
      (layer) => layer.type === 'line' && layer['source-layer'] === ROAD_SOURCE_LAYER && !layer.id.endsWith('_case'),
    )
    .map((layer) => layer.id)
}

/**
 * Roads currently drawn on the map, as snap and reverse-viewshed candidates.
 *
 * Only what is rendered is available, so this answers for the current view at
 * the current zoom: zoomed out past where the basemap draws forest roads, they
 * are not there to be found.
 */
export function collectRoadsFromMap(map: RoadQueryMap): RoadCandidate[] {
  const layers = roadLayerIds(map)
  if (layers.length === 0) return []
  return roadsFromFeatures(map.queryRenderedFeatures({ layers })).filter((road) => road.coordinates.length >= 2)
}

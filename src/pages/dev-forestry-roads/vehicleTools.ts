/**
 * Glue between the plan and the vehicle tools: which drawn or imported features can be driven
 * (lines), used as a footprint (areas) or used to place a turning template (points); the road
 * formations near a path as footprint polygons; and plan features and export files for the
 * results. A feature is used only when the reviewer picks it in the vehicle tools; nothing is
 * classified by its geometry. Pure: no DOM or network access.
 *
 * Written for PGMaps from the QuickTurn functional specification (clean-specs/quickturn.md §11,
 * gaps G1, G2, G4); no code from QuickTurn (GNU GPL v2) was used.
 */
import { centrelineSamples, effectiveWidths } from './engine'
import type { MapNote } from './mapNotes'
import type { ReferenceFeature } from './referenceFeatures'
import type { Alignment, Coordinate } from './types'
import type { MultiPolygon } from './vehiclePath'
import type { VehicleOutline, XY } from './vehicleKinematics'

export interface VehicleToolSource {
  id: string
  label: string
  kind: 'path' | 'area' | 'point'
  /** A path's vertices, an area's outer ring (open or closed), or a point. */
  coordinates: Coordinate[]
  /** An area's holes. */
  holes?: Coordinate[][]
  /** A freehand sketch: its vertices are simplified before driving. */
  freehand?: boolean
}

/** Freehand sketches are simplified to this tolerance before their corners are filleted. */
export const SKETCH_SIMPLIFY_M = 0.5
/** Most formation strips one footprint takes from the roads near a path. */
export const MAX_FORMATION_STRIPS = 4000
/** Roads are read this far beyond the path's extent for the footprint. */
export const FORMATION_MARGIN_M = 60

/** The map notes and reference features a vehicle tool can use, by shape. */
export function vehicleToolSources(notes: readonly MapNote[] = [], reference: readonly ReferenceFeature[] = []) {
  const sources: VehicleToolSource[] = []
  for (const note of notes) {
    const name = note.text.trim().split('\n')[0].slice(0, 60)
    const label = (kind: string) => `${kind}${name ? `: ${name}` : ''}`
    if (note.kind === 'line' || note.kind === 'sketch')
      sources.push({
        id: `note:${note.id}`,
        label: label(note.kind === 'line' ? 'Drawn line' : 'Sketch'),
        kind: 'path',
        coordinates: note.points,
        ...(note.kind === 'sketch' ? { freehand: true } : {}),
      })
    else if (note.kind === 'area')
      sources.push({ id: `note:${note.id}`, label: label('Drawn area'), kind: 'area', coordinates: note.points })
    else sources.push({ id: `note:${note.id}`, label: label('Pin'), kind: 'point', coordinates: note.points })
  }
  for (const feature of reference) {
    if (feature.sheet || feature.classGrid) continue
    const g = feature.geometry
    const label = `Reference: ${feature.name}`
    if (g.type === 'LineString')
      sources.push({ id: `ref:${feature.id}`, label, kind: 'path', coordinates: g.coordinates as Coordinate[] })
    else if (g.type === 'Polygon')
      sources.push({
        id: `ref:${feature.id}`,
        label,
        kind: 'area',
        coordinates: g.coordinates[0] as Coordinate[],
        holes: g.coordinates.slice(1) as Coordinate[][],
      })
    else if (g.type === 'Point')
      sources.push({ id: `ref:${feature.id}`, label, kind: 'point', coordinates: [g.coordinates as Coordinate] })
  }
  return sources
}

/** Douglas–Peucker simplification of a polyline to `tolerance` metres. */
export function simplifyPath(points: readonly XY[], tolerance: number): XY[] {
  if (points.length < 3) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = points[a],
      [bx, by] = points[b]
    const dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy)
    let worst = -1,
      index = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      const d = len > 1e-12 ? Math.abs(dx * (py - ay) - dy * (px - ax)) / len : Math.hypot(px - ax, py - ay)
      if (d > worst) {
        worst = d
        index = i
      }
    }
    if (worst > tolerance) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

const closedRing = (ring: XY[]): XY[] =>
  ring.length && (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ? [...ring, ring[0]] : ring

/** An area source as a local polygon. */
export function areaPolygon(source: VehicleToolSource, toLocal: (c: Coordinate) => XY): MultiPolygon {
  return [[closedRing(source.coordinates.map(toLocal)), ...(source.holes ?? []).map((h) => closedRing(h.map(toLocal)))]]
}

/**
 * The formation of every road near a box, as strips between consecutive metre stations, each the
 * road's left and right formation half-widths there.
 */
export function formationFootprint(
  alignments: readonly Alignment[],
  toLocal: (c: Coordinate) => XY,
  box: [number, number, number, number],
): MultiPolygon {
  const [minX, minY, maxX, maxY] = [
    box[0] - FORMATION_MARGIN_M,
    box[1] - FORMATION_MARGIN_M,
    box[2] + FORMATION_MARGIN_M,
    box[3] + FORMATION_MARGIN_M,
  ]
  const strips: MultiPolygon = []
  for (const alignment of alignments) {
    let centre: ReturnType<typeof centrelineSamples>
    try {
      centre = centrelineSamples(alignment, 1)
    } catch {
      continue
    }
    const points = centre.samples.map((p) => toLocal(centre.toCoordinate(p.x, p.y)))
    const near = (p: XY) => p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY
    const edges = points.map((p, i) => {
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(points.length - 1, i + 1)]
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        d = Math.hypot(dx, dy) || 1
      const w = effectiveWidths(alignment, centre.samples[i].s)
      const nx = -dy / d,
        ny = dx / d
      return {
        left: [p[0] + nx * w.leftWidth, p[1] + ny * w.leftWidth] as XY,
        right: [p[0] - nx * w.rightWidth, p[1] - ny * w.rightWidth] as XY,
      }
    })
    for (let i = 1; i < points.length; i++) {
      if (!near(points[i - 1]) && !near(points[i])) continue
      if (strips.length >= MAX_FORMATION_STRIPS)
        throw Error('Too many roads near this path for a footprint; leave the road formations out.')
      const a = edges[i - 1],
        b = edges[i]
      strips.push([[a.left, b.left, b.right, a.right, a.left]])
    }
  }
  return strips
}

/** Bounding box of local points. */
export function bounds(points: readonly XY[]): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return [minX, minY, maxX, maxY]
}

// ---------------------------------------------------------------------------------------------
// Plan features. Roles: 'swept-area' (filled), 'swept-wheels' (wheel area outline),
// 'vehicle-outline', 'vehicle-trace', 'vehicle-template', 'vehicle-lock'.

type ToCoordinate = (p: XY) => Coordinate

export function lineFeature(
  points: readonly XY[],
  toCoordinate: ToCoordinate,
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.LineString>[] {
  return points.length > 1
    ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: points.map(toCoordinate) }, properties }]
    : []
}

export function polygonFeatures(
  shape: MultiPolygon,
  toCoordinate: ToCoordinate,
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.Polygon>[] {
  return shape.map((polygon) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: polygon.map((ring) => ring.map(toCoordinate)) },
    properties,
  }))
}

/** Each unit, load and axle of a vehicle at one pose as plan lines. */
export function outlineFeatures(
  outline: VehicleOutline,
  toCoordinate: ToCoordinate,
  label: string,
  pinned = false,
): GeoJSON.Feature<GeoJSON.LineString>[] {
  const color = pinned ? '#64748b' : '#0f172a'
  return [
    ...outline.bodies.flatMap((b) =>
      lineFeature(b.ring, toCoordinate, { role: 'vehicle-outline', color, label: `${label}: ${b.label}` }),
    ),
    ...outline.loads.flatMap((b) =>
      lineFeature(b.ring, toCoordinate, { role: 'vehicle-outline', color: '#b45309', label: `${label}: ${b.label}` }),
    ),
    ...outline.axles.flatMap((axle) =>
      lineFeature(axle, toCoordinate, { role: 'vehicle-outline', color, label: `${label}: axle` }),
    ),
  ]
}

export const featureCollection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features,
})

/** True for a vehicle-tool plan feature. */
export const isVehicleToolFeature = (feature: GeoJSON.Feature) =>
  ['swept-area', 'vehicle-outline', 'vehicle-trace', 'vehicle-template', 'vehicle-lock'].includes(
    String(feature.properties?.role),
  )

// ---------------------------------------------------------------------------------------------
// Export files

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A KML document of the features' polygons and lines (lon/lat, WGS 84). */
export function featuresToKml(name: string, features: readonly GeoJSON.Feature[]): string {
  const coordinates = (points: GeoJSON.Position[]) => points.map((p) => `${p[0]},${p[1]}`).join(' ')
  const placemarks = features.flatMap((f) => {
    const label = xml(String(f.properties?.label ?? f.properties?.role ?? 'Feature'))
    const g = f.geometry
    if (g.type === 'LineString')
      return [
        `<Placemark><name>${label}</name><LineString><coordinates>${coordinates(g.coordinates)}</coordinates></LineString></Placemark>`,
      ]
    if (g.type === 'Polygon')
      return [
        `<Placemark><name>${label}</name><Polygon>${g.coordinates
          .map(
            (ring, i) =>
              `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${coordinates(ring)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`,
          )
          .join('')}</Polygon></Placemark>`,
      ]
    return []
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>${placemarks.join('')}</Document></kml>\n`
}

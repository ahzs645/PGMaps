/**
 * Reference features: imported points, lines and areas that the plan draws and the sidebar lists.
 * They live in their own project collection and no calculation reads them, so a property boundary
 * or a landing can sit under a design without becoming a stream or a constraint. No DOM or network
 * access.
 */
import type { Coordinate } from './types'

export interface ReferenceFeature {
  id: string
  name: string
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon
  /** The file the feature was imported from. */
  source?: string
}
export type ReferenceShape = 'point' | 'line' | 'area'

export const MAX_REFERENCE_FEATURES = 500
export const MAX_REFERENCE_VERTICES = 50_000
const MAX_NAME = 200

export const referenceShape = (feature: Pick<ReferenceFeature, 'geometry'>): ReferenceShape =>
  feature.geometry.type === 'Point' ? 'point' : feature.geometry.type === 'LineString' ? 'line' : 'area'

function fail(message: string): never {
  throw Error(message)
}

function position(value: unknown, label: string): Coordinate {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    Math.abs(value[0]) > 180 ||
    Math.abs(value[1]) >= 85
  )
    fail(`${label} must be a WGS84 longitude/latitude pair.`)
  return [value[0] as number, value[1] as number]
}

function path(value: unknown, label: string, minimum: number): Coordinate[] {
  if (!Array.isArray(value) || value.length < minimum) fail(`${label} needs at least ${minimum} vertices.`)
  return (value as unknown[]).map((p) => position(p, label))
}

function geometry(raw: unknown, label: string): ReferenceFeature['geometry'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${label} needs a geometry.`)
  const g = raw as { type?: unknown; coordinates?: unknown }
  if (g.type === 'Point') return { type: 'Point', coordinates: position(g.coordinates, label) }
  if (g.type === 'LineString') return { type: 'LineString', coordinates: path(g.coordinates, label, 2) }
  if (g.type === 'Polygon') {
    if (!Array.isArray(g.coordinates) || !g.coordinates.length || g.coordinates.length > 100)
      fail(`${label} needs 1–100 polygon rings.`)
    const rings = (g.coordinates as unknown[]).map((ring) => {
      const points = path(ring, label, 4)
      const first = points[0],
        last = points[points.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) fail(`${label} polygon rings must be closed.`)
      return points
    })
    return { type: 'Polygon', coordinates: rings }
  }
  return fail(`${label} must be a point, a line or a polygon.`)
}

export const referenceVertexCount = (feature: Pick<ReferenceFeature, 'geometry'>): number =>
  feature.geometry.type === 'Point'
    ? 1
    : feature.geometry.type === 'LineString'
      ? feature.geometry.coordinates.length
      : feature.geometry.coordinates.reduce((count, ring) => count + ring.length, 0)

/** Validates reference features read from a project file; anything malformed is rejected, never repaired. */
export function parseReferenceFeatures(raw: unknown): ReferenceFeature[] {
  if (!Array.isArray(raw)) fail('Reference features must be a list.')
  if (raw.length > MAX_REFERENCE_FEATURES)
    fail(`A project holds at most ${MAX_REFERENCE_FEATURES} reference features. Crop the file or import fewer layers.`)
  const ids = new Set<string>()
  let vertices = 0
  const features = (raw as unknown[]).map((entry, index): ReferenceFeature => {
    const label = `Reference feature ${index + 1}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${label} must be an object.`)
    const r = entry as Record<string, unknown>
    if (typeof r.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(r.id)) fail(`${label} needs an ID.`)
    if (ids.has(r.id)) fail(`Reference feature IDs must be unique: ${r.id}.`)
    ids.add(r.id)
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > MAX_NAME)
      fail(`${label} needs a name of at most ${MAX_NAME} characters.`)
    if (r.source !== undefined && (typeof r.source !== 'string' || r.source.length > MAX_NAME))
      fail(`${label} source must be text of at most ${MAX_NAME} characters.`)
    const feature: ReferenceFeature = {
      id: r.id,
      name: r.name.trim(),
      geometry: geometry(r.geometry, label),
      ...(typeof r.source === 'string' && r.source ? { source: r.source } : {}),
    }
    vertices += referenceVertexCount(feature)
    return feature
  })
  if (vertices > MAX_REFERENCE_VERTICES)
    fail(`Reference features hold at most ${MAX_REFERENCE_VERTICES.toLocaleString('en-CA')} vertices. Crop the file.`)
  return features
}

/** The features as GeoJSON, tagged `kind: 'reference'` so an export imports back as what it was. */
export function referenceGeoJson(features: readonly ReferenceFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((feature) => ({
      type: 'Feature',
      id: feature.id,
      properties: {
        kind: 'reference',
        id: feature.id,
        name: feature.name,
        shape: referenceShape(feature),
        ...(feature.source ? { source: feature.source } : {}),
      },
      geometry: feature.geometry,
    })),
  }
}

/** [west, south, east, north] of one feature. */
export function referenceBounds(feature: Pick<ReferenceFeature, 'geometry'>): [number, number, number, number] {
  const points: number[][] =
    feature.geometry.type === 'Point'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat()
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x)
    box[1] = Math.min(box[1], y)
    box[2] = Math.max(box[2], x)
    box[3] = Math.max(box[3], y)
  }
  return box
}

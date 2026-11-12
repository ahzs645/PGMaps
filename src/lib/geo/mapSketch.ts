/**
 * Drawing a shape on a map by clicking its vertices: the rules behind `/dev/interact`'s measure
 * tool, shared so every page that measures or asks for a drawn polygon reads the same.
 *
 * - A polygon closes on a click on its first vertex (within `CLOSE_SNAP_PX`), a double-click, or
 *   Finish, once it has three points.
 * - A line finishes on a double-click or Finish once it has two.
 * - A circle takes its centre, then a point on its edge.
 * - Undo takes the last point back (reopening a finished shape) and Redo returns it; a new point
 *   clears what Redo would return.
 *
 * DOM-free: `map-sketch.tsx` is the map side.
 */
import area from '@turf/area'
import { distanceKm } from '@/lib/geo'
import { formatNumber, formatSquareKm } from '@/lib/format'

export type LngLat = [number, number]
export type SketchShape = 'polygon' | 'line' | 'circle'
export type SketchMode = 'idle' | 'drawing' | 'complete'

export interface SketchState {
  mode: SketchMode
  shape: SketchShape
  points: LngLat[]
  /** Points Undo took back, most recent first. */
  redo: LngLat[]
}

export type SketchAction =
  | { type: 'start'; shape: SketchShape }
  | { type: 'add'; point: LngLat }
  | { type: 'finish' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  /** Moves a circle's edge, on a phone's drag handle; it finishes the circle. */
  | { type: 'radius'; point: LngLat }

/** A click this close to the first vertex, in screen pixels, closes the polygon. */
export const CLOSE_SNAP_PX = 18

export const IDLE_SKETCH: SketchState = { mode: 'idle', shape: 'polygon', points: [], redo: [] }

const EMPTY = <G extends GeoJSON.Geometry>(): GeoJSON.FeatureCollection<G> => ({
  type: 'FeatureCollection',
  features: [],
})

export function minimumSketchPoints(shape: SketchShape): number {
  return shape === 'polygon' ? 3 : 2
}

export function canFinishSketch(shape: SketchShape, points: readonly LngLat[]): boolean {
  return points.length >= minimumSketchPoints(shape)
}

export function sketchReducer(state: SketchState, action: SketchAction): SketchState {
  switch (action.type) {
    case 'start':
      return { mode: 'drawing', shape: action.shape, points: [], redo: [] }
    case 'clear':
      return IDLE_SKETCH
    case 'add':
      if (state.shape === 'circle') {
        if (state.mode === 'idle') return state
        if (state.points.length === 0) return { ...state, mode: 'drawing', points: [action.point], redo: [] }
        return { ...state, mode: 'complete', points: [state.points[0], action.point], redo: [] }
      }
      if (state.mode !== 'drawing') return state
      return { ...state, points: [...state.points, action.point], redo: [] }
    case 'radius':
      if (state.shape !== 'circle' || state.points.length === 0) return state
      return { ...state, mode: 'complete', points: [state.points[0], action.point], redo: [] }
    case 'finish':
      if (state.mode !== 'drawing' || !canFinishSketch(state.shape, state.points)) return state
      return { ...state, mode: 'complete', redo: [] }
    case 'undo': {
      if (state.points.length === 0) return state
      const removed = state.points[state.points.length - 1]
      return {
        ...state,
        mode: state.mode === 'complete' ? 'drawing' : state.mode,
        points: state.points.slice(0, -1),
        redo: [removed, ...state.redo],
      }
    }
    case 'redo': {
      if (state.redo.length === 0 || state.mode !== 'drawing') return state
      const [restored, ...redo] = state.redo
      const points = [...state.points, restored]
      // A circle with its edge back is finished again.
      return { ...state, mode: state.shape === 'circle' && points.length >= 2 ? 'complete' : 'drawing', points, redo }
    }
  }
}

export function closeRing(points: readonly LngLat[]): LngLat[] {
  if (points.length === 0) return []
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return [...points]
  return [...points, first]
}

/** The drawn ring as a GeoJSON polygon, or null below three distinct points. */
export function sketchPolygon(points: readonly LngLat[]): GeoJSON.Polygon | null {
  const ring = closeRing(points)
  if (ring.length < 4) return null
  return { type: 'Polygon', coordinates: [ring] }
}

export function lineLengthKm(coordinates: readonly LngLat[]): number {
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1)
    total += distanceKm(coordinates[index - 1], coordinates[index])
  return total
}

export interface SketchStats {
  /** A line's length, a polygon's perimeter (open while drawing) or a circle's circumference, in km. */
  length: number
  /** Square metres; 0 for a line. */
  area: number
  /** A circle's radius in km. */
  radius?: number
}

/**
 * What the shape measures. A circle reads its edge from `cursor` until the second click, so the
 * readout follows the pointer; a polygon's area is of its points closed back to the first.
 */
export function sketchStats(
  shape: SketchShape,
  points: readonly LngLat[],
  complete: boolean,
  cursor: LngLat | null = null,
): SketchStats | null {
  if (shape === 'circle') {
    const center = points[0] ?? null
    const edge = points[1] ?? cursor
    if (!center || !edge) return null
    const radius = distanceKm(center, edge)
    return { radius, length: 2 * Math.PI * radius, area: Math.PI * (radius * 1000) ** 2 }
  }
  if (points.length < 2) return null
  if (shape === 'line') return { length: lineLengthKm(points), area: 0 }
  const polygon = sketchPolygon(points)
  return {
    length: lineLengthKm(complete ? closeRing(points) : points),
    area: polygon ? area({ type: 'Feature', properties: {}, geometry: polygon }) : 0,
  }
}

export interface SketchFeatures {
  fill: GeoJSON.FeatureCollection<GeoJSON.Polygon>
  outline: GeoJSON.FeatureCollection<GeoJSON.LineString>
  /** The rubber band from the last point to the pointer (and back to the first, for a polygon). */
  preview: GeoJSON.FeatureCollection<GeoJSON.LineString>
  circle: GeoJSON.FeatureCollection<GeoJSON.Polygon>
}

export function sketchFeatures(
  shape: SketchShape,
  mode: SketchMode,
  points: readonly LngLat[],
  cursor: LngLat | null,
): SketchFeatures {
  const drawing = mode === 'drawing'
  if (shape === 'circle') {
    const center = points[0] ?? null
    const edge = points[1] ?? (drawing ? cursor : null)
    return { fill: EMPTY(), outline: EMPTY(), preview: EMPTY(), circle: circleCollection(center, edge) }
  }
  const polygon = shape === 'polygon' ? sketchPolygon(points) : null
  const closed = shape === 'polygon' && mode === 'complete'
  const last = points[points.length - 1]
  const previewCoordinates =
    drawing && last && cursor
      ? shape === 'polygon' && canFinishSketch(shape, points)
        ? [last, cursor, points[0]]
        : [last, cursor]
      : null
  return {
    fill: polygon ? collection(polygon) : EMPTY(),
    outline:
      points.length > 1
        ? collection({ type: 'LineString', coordinates: closed ? closeRing(points) : [...points] })
        : EMPTY(),
    preview: previewCoordinates ? collection({ type: 'LineString', coordinates: previewCoordinates }) : EMPTY(),
    circle: EMPTY(),
  }
}

/** Whether a click lands on the first vertex, in screen pixels. */
export function nearFirstVertex(first: { x: number; y: number }, click: { x: number; y: number }): boolean {
  return Math.hypot(first.x - click.x, first.y - click.y) <= CLOSE_SNAP_PX
}

export function formatSketchDistance(km: number): string {
  if (km >= 1) return `${formatNumber(km, { maximumFractionDigits: 2 })} km`
  return `${formatNumber(Math.round(km * 1000))} m`
}

export function formatSketchArea(squareMeters: number): string {
  const squareKm = squareMeters / 1_000_000
  if (squareKm >= 1) return formatSquareKm(squareKm, { digits: 2 })
  return `${formatNumber(squareMeters / 10_000, { maximumFractionDigits: 1 })} ha`
}

const EARTH_RADIUS_KM = 6371.0088

function collection<G extends GeoJSON.Geometry>(geometry: G): GeoJSON.FeatureCollection<G> {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] }
}

function circleCollection(center: LngLat | null, edge: LngLat | null): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!center || !edge) return EMPTY()
  const radiusKm = distanceKm(center, edge)
  if (radiusKm === 0) return EMPTY()
  return collection({ type: 'Polygon', coordinates: [circleRing(center, radiusKm)] })
}

function circleRing(center: LngLat, radiusKm: number, steps = 96): LngLat[] {
  const [lng, lat] = center
  const centerLat = (lat * Math.PI) / 180
  const centerLng = (lng * Math.PI) / 180
  const angular = radiusKm / EARTH_RADIUS_KM
  const points = Array.from({ length: steps }, (_, index): LngLat => {
    const bearing = (index / steps) * Math.PI * 2
    const pointLat = Math.asin(
      Math.sin(centerLat) * Math.cos(angular) + Math.cos(centerLat) * Math.sin(angular) * Math.cos(bearing),
    )
    const pointLng =
      centerLng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(centerLat),
        Math.cos(angular) - Math.sin(centerLat) * Math.sin(pointLat),
      )
    return [(((pointLng * 180) / Math.PI + 540) % 360) - 180, (pointLat * 180) / Math.PI]
  })
  return closeRing(points)
}

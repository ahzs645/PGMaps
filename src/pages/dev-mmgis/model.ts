import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import area from '@turf/area'
import type { DataLayer, WorkspaceAction } from '../dev-data/model'
import { workspaceReducer } from '../dev-data/model'
import { layerFromUpload } from '../dev-data/layerFactory'
import { haversineMeters } from '../dev-forestry/visibility'

export type Coordinate = [number, number]
export type Tool = 'inspect' | 'point' | 'line' | 'polygon' | 'measure' | 'viewshed'
export type Panel = 'layers' | 'search' | 'draw' | 'terrain' | 'raster' | 'workspace'
export interface MissionLayer extends DataLayer {
  data: FeatureCollection
  timeProperty: string
  editable: boolean
}
export interface TileOverlay {
  id: string
  name: string
  tiles: string[]
  visible: boolean
  opacity: number
  attribution: string
  /** A COG and TiTiler base used for raw-value queries, not inferred tile colors. */
  cog?: { url: string; service: string; band: number }
}
export interface Camera {
  center: Coordinate
  zoom: number
  bearing: number
  pitch: number
}
export interface Bookmark {
  id: string
  name: string
  camera: Camera
}
export interface Mission {
  schema: 'pgmaps-mission-v1'
  id: string
  name: string
  description: string
  layers: MissionLayer[]
  tiles: TileOverlay[]
  bookmarks: Bookmark[]
  camera: Camera
  view: 'map' | 'split' | 'globe'
  terrain: boolean
  time: { enabled: boolean; start: string; end: string }
}
export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
export const uid = () => crypto.randomUUID()
export const coordinate = (p: Position): Coordinate => [p[0], p[1]]
export function makeLayer(name: string, data: FeatureCollection, group = 'Your layers'): MissionLayer {
  return {
    ...layerFromUpload(uid(), name, { name, collection: data, skipped: 0 }),
    group,
    data,
    timeProperty: '',
    editable: false,
  }
}
export function updateLayers(mission: Mission, action: WorkspaceAction): Mission {
  return {
    ...mission,
    layers: workspaceReducer({ layers: mission.layers, groups: [] }, action).layers as MissionLayer[],
  }
}
export function moveLayer(mission: Mission, id: string, offset: number): Mission {
  const layers = [...mission.layers],
    index = layers.findIndex((l) => l.id === id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= layers.length) return mission
  ;[layers[index], layers[target]] = [layers[target], layers[index]]
  return { ...mission, layers }
}
export function featureTime(feature: Feature, property: string): number | null {
  const value = feature.properties?.[property]
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const utc =
    typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && !/(Z|[+-]\d\d:?\d\d)$/i.test(value)
      ? `${value}Z`
      : value
  const time = typeof utc === 'number' ? utc : Date.parse(utc)
  return Number.isFinite(time) ? time : null
}
export function inTime(feature: Feature, property: string, time: Mission['time']): boolean {
  if (!time.enabled || !property) return true
  const value = featureTime(feature, property)
  return value !== null && value >= Date.parse(time.start) && value <= Date.parse(time.end) + 86_399_999
}
export function matchesSearch(feature: Feature, query: string): boolean {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const text = Object.entries(feature.properties ?? {})
    .filter(([k]) => !k.startsWith('__'))
    .map(([, v]) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')))
    .join(' ')
    .toLocaleLowerCase()
  return terms.every((term) => text.includes(term))
}
/** Expand collection geometry for rendering while retaining the original feature identity. */
export function renderableCollection<P>(collection: FeatureCollection<Geometry, P>): FeatureCollection<Geometry, P> {
  const leaves = (geometry: Geometry): Geometry[] =>
    geometry.type === 'GeometryCollection' ? geometry.geometries.flatMap(leaves) : [geometry]
  return {
    ...collection,
    features: collection.features.flatMap((feature) =>
      leaves(feature.geometry).map((geometry) => ({ ...feature, geometry })),
    ),
  }
}
export function drawingGeometry(tool: Tool, points: Coordinate[], closed = true): Geometry | null {
  if (tool === 'point') return points.length ? { type: 'Point', coordinates: points[0] } : null
  if (points.length < (tool === 'polygon' && closed ? 3 : 2)) return null
  if (tool === 'polygon' && closed) return { type: 'Polygon', coordinates: [[...points, points[0]]] }
  return { type: 'LineString', coordinates: points }
}
export function measurement(points: Coordinate[], isArea: boolean) {
  let length = 0
  for (let i = 1; i < points.length; i++)
    length += haversineMeters(
      { lng: points[i - 1][0], lat: points[i - 1][1] },
      { lng: points[i][0], lat: points[i][1] },
    )
  return {
    length,
    area:
      isArea && points.length >= 3
        ? area({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [[...points, points[0]]] },
          })
        : null,
  }
}
export function geometryVertices(geometry: Geometry | null): Coordinate[] {
  if (geometry?.type === 'Point') return [coordinate(geometry.coordinates)]
  if (geometry?.type === 'LineString') return geometry.coordinates.map(coordinate)
  if (geometry?.type === 'Polygon') return geometry.coordinates[0].slice(0, -1).map(coordinate)
  return []
}
/** Preserve interior rings and untouched ordinates when moving a vertex. */
export function moveVertex(geometry: Geometry, index: number, point: Coordinate): Geometry {
  const next = structuredClone(geometry)
  const replace = (old: Position) => [...point, ...old.slice(2)]
  if (next.type === 'Point') next.coordinates = replace(next.coordinates)
  if (next.type === 'LineString') next.coordinates[index] = replace(next.coordinates[index])
  if (next.type === 'Polygon') {
    next.coordinates[0][index] = replace(next.coordinates[0][index])
    if (index === 0) next.coordinates[0][next.coordinates[0].length - 1] = [...next.coordinates[0][0]]
  }
  return next
}

import sfData from './data.json'
import pgData from './data-pg.json'
import type { GraphMeta, Manifest } from './engine.js'

export type CityId = 'sf' | 'pg'
export type FlattenData = {
  manifest: Manifest
  meta: GraphMeta
  labels: { n: string; lon: number; lat: number }[]
  default: { label: string; lon: number; lat: number }[]
  bundle_url: string
  bundle_bytes: number
  hillshade: { bounds: number[][]; url: string }
  addr?: { origin: number[]; step: number } | null
}
export type CityConfig = {
  id: CityId; name: string; title: string; path: string; data: FlattenData
  bounds: [number, number, number, number]; center: [number, number]; zoom: number
  defaultUnits: 'mi' | 'km'; searchPlaceholder: string; attribution: string
  dataDescription: string; note?: string
}
export const CITIES: Record<CityId, CityConfig> = {
  sf: {
    id: 'sf', name: 'San Francisco', title: 'Flatten SF', path: '/dev/flatten', data: sfData,
    bounds: [-122.53, 37.69, -122.32, 37.84], center: [-122.44, 37.765], zoom: 12,
    defaultUnits: 'mi', searchPlaceholder: 'Address, place, or 24th & Mission',
    attribution: 'Streets © <a href="https://overturemaps.org">Overture</a> / <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Elevation USGS 3DEP',
    dataDescription: 'USGS lidar elevations and Overture / OpenStreetMap streets. Search uses the bundled places, addresses and intersections.',
  },
  pg: {
    id: 'pg', name: 'Prince George', title: 'Flatten PG', path: '/dev/flatten/pg', data: pgData,
    bounds: [-122.92, 53.81, -122.62, 54.02], center: [-122.773, 53.916], zoom: 12,
    defaultUnits: 'km', searchPlaceholder: 'Place or intersection, e.g. UNBC',
    attribution: 'Streets © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>',
    dataDescription: 'OpenStreetMap streets and regional Terrain Tiles elevations. Search includes local places and named intersections.',
    note: 'Terrain-based climbing and grades are estimates. Bridges use endpoint elevations; short steep pitches and unmapped paths may be missed. Access and turn restrictions may be incomplete.',
  },
}
export function assetBase(city: CityId) { return `${import.meta.env.BASE_URL}data/flatten-${city}/` }

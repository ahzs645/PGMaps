import type { MapFeatureTableColumnType } from '@/components/map/MapFeatureTable'

export const DEV_DATA_CENTER: [number, number] = [-122.7497, 53.9171]
export const DEV_DATA_ZOOM = 11.1

export type DataLayerId =
  | 'community-boundaries'
  | 'subdivisions'
  | 'civic-facilities'
  | 'park-facilities'
  | 'cycle-network'
  | 'sidewalks'
  | 'snow-removal'

export interface DataLayerColumn {
  /** Key in the source GeoJSON `properties` object. */
  key: string
  header: string
  type: MapFeatureTableColumnType
  width?: number
}

export interface DataLayerDef {
  id: DataLayerId
  label: string
  description: string
  color: string
  shape: 'fill' | 'line'
  path: string
  /** Property used as the row/feature label. */
  nameKey: string
  columns: DataLayerColumn[]
  /** Row count from the shipped snapshot, shown before the layer is fetched. */
  approxCount: number
}

/**
 * City of Prince George open-data snapshots under `public/data/citypg`. Kept to
 * polygon and line layers so every layer renders through MapFillLayer/MapLineLayer.
 */
export const DEV_DATA_LAYERS: DataLayerDef[] = [
  {
    id: 'community-boundaries',
    label: 'Community boundaries',
    description: 'Named community areas used for city reporting.',
    color: '#6366f1',
    shape: 'fill',
    path: '/data/citypg/community_boundaries.geojson',
    nameKey: 'CommunityName',
    approxCount: 31,
    columns: [
      { key: 'CommunityName', header: 'Community', type: 'text', width: 200 },
      { key: 'Shape__Area', header: 'Area (m²)', type: 'numeric', width: 140 },
      { key: 'OBJECTID', header: 'OBJECTID', type: 'numeric', width: 110 },
      { key: 'GlobalID', header: 'Global ID', type: 'text', width: 300 },
    ],
  },
  {
    id: 'subdivisions',
    label: 'Subdivision boundaries',
    description: 'Subdivisions nested inside each community.',
    color: '#8b5cf6',
    shape: 'fill',
    path: '/data/citypg/subdivision_boundaries.geojson',
    nameKey: 'SubdivisionName',
    approxCount: 72,
    columns: [
      { key: 'SubdivisionName', header: 'Subdivision', type: 'text', width: 200 },
      { key: 'CommunityName', header: 'Community', type: 'text', width: 170 },
      { key: 'Shape__Area', header: 'Area (m²)', type: 'numeric', width: 140 },
      { key: 'OBJECTID', header: 'OBJECTID', type: 'numeric', width: 110 },
      { key: 'GlobalID', header: 'Global ID', type: 'text', width: 300 },
    ],
  },
  {
    id: 'civic-facilities',
    label: 'Civic facility buildings',
    description: 'City-owned buildings with type, area, and expected life.',
    color: '#0ea5e9',
    shape: 'fill',
    path: '/data/citypg/civic_facility_buildings.geojson',
    nameKey: 'LongName',
    approxCount: 62,
    columns: [
      { key: 'LongName', header: 'Facility', type: 'text', width: 200 },
      { key: 'ShortName', header: 'Short name', type: 'text', width: 160 },
      { key: 'SubType_TEXT', header: 'Facility type', type: 'text', width: 150 },
      { key: 'Location', header: 'Address', type: 'text', width: 200 },
      { key: 'BldgArea', header: 'Building area (m²)', type: 'numeric', width: 150 },
      { key: 'ExpectedLife', header: 'Expected life (yr)', type: 'numeric', width: 150 },
      { key: 'InstallDate', header: 'Installed', type: 'datetime', width: 150 },
      { key: 'barcode', header: 'Barcode', type: 'text', width: 150 },
    ],
  },
  {
    id: 'park-facilities',
    label: 'Park facilities',
    description: 'Park structures with construction type and servicing.',
    color: '#22c55e',
    shape: 'fill',
    path: '/data/citypg/parks_facilities.geojson',
    nameKey: 'Location',
    approxCount: 73,
    columns: [
      { key: 'Location', header: 'Park', type: 'text', width: 220 },
      { key: 'ConstructionType', header: 'Construction', type: 'text', width: 170 },
      { key: 'LifeCycleStatus', header: 'Status', type: 'text', width: 110 },
      { key: 'Height_m', header: 'Height (m)', type: 'numeric', width: 120 },
      { key: 'Accessibility', header: 'Accessible', type: 'numeric', width: 120 },
      { key: 'InstallDate', header: 'Installed', type: 'datetime', width: 150 },
      { key: 'barcode', header: 'Barcode', type: 'text', width: 150 },
    ],
  },
  {
    id: 'cycle-network',
    label: 'Cycle network',
    description: 'Active-transportation cycling segments.',
    color: '#0891b2',
    shape: 'line',
    path: '/data/citypg/active_transportation_cycle_network.geojson',
    nameKey: 'OBJECTID',
    approxCount: 121,
    columns: [
      { key: 'OBJECTID', header: 'OBJECTID', type: 'numeric', width: 120 },
      { key: 'NetworkType', header: 'Network type', type: 'numeric', width: 140 },
      { key: 'LifeCycleStatus', header: 'Status', type: 'text', width: 120 },
      { key: 'GlobalID', header: 'Global ID', type: 'text', width: 300 },
    ],
  },
  {
    id: 'sidewalks',
    label: 'Sidewalks',
    description: '1,700 sidewalk segments — exercises the virtualized grid.',
    color: '#64748b',
    shape: 'line',
    path: '/data/citypg/sidewalks.geojson',
    nameKey: 'Location',
    approxCount: 1701,
    columns: [
      { key: 'Location', header: 'Location', type: 'text', width: 210 },
      { key: 'SurfaceMaterial', header: 'Surface', type: 'text', width: 120 },
      { key: 'Width', header: 'Width (m)', type: 'numeric', width: 120 },
      { key: 'Shape__Length', header: 'Length (m)', type: 'numeric', width: 130 },
      { key: 'LifeCycleStatus', header: 'Status', type: 'text', width: 110 },
      { key: 'InstallDate', header: 'Installed', type: 'datetime', width: 150 },
      { key: 'barcode', header: 'Barcode', type: 'text', width: 150 },
      { key: 'OBJECTID', header: 'OBJECTID', type: 'numeric', width: 110 },
    ],
  },
  {
    id: 'snow-removal',
    label: 'Snow removal routes',
    description: '5,400 road segments by removal priority — the largest layer.',
    color: '#38bdf8',
    shape: 'line',
    path: '/data/citypg/snow_removal.geojson',
    nameKey: 'StrName',
    approxCount: 5449,
    columns: [
      { key: 'StrName', header: 'Street', type: 'text', width: 180 },
      { key: 'StrType', header: 'Type', type: 'text', width: 100 },
      { key: 'RemovalPriority', header: 'Priority', type: 'numeric', width: 110 },
      { key: 'RoadClass', header: 'Road class', type: 'numeric', width: 120 },
      { key: 'LifeCycleStatus', header: 'Status', type: 'text', width: 110 },
      { key: 'AssetID', header: 'Asset ID', type: 'text', width: 120 },
      { key: 'barcode', header: 'Barcode', type: 'text', width: 150 },
      { key: 'OBJECTID', header: 'OBJECTID', type: 'numeric', width: 110 },
    ],
  },
]

export const DEV_DATA_LAYER_BY_ID = new Map(DEV_DATA_LAYERS.map((layer) => [layer.id, layer]))

/** Layers loaded on first paint. The two large ones stay lazy until enabled. */
export const DEV_DATA_INITIAL_LAYERS: DataLayerId[] = [
  'community-boundaries',
  'civic-facilities',
  'park-facilities',
  'cycle-network',
]

/** Stable per-feature id, injected on load so the map and table agree on identity. */
export const FEATURE_ID_KEY = '__devDataId'

export type DataFeatureProperties = Record<string, unknown> & { [FEATURE_ID_KEY]: string }
export type DataFeature = GeoJSON.Feature<GeoJSON.Geometry, DataFeatureProperties>
export type DataFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, DataFeatureProperties>

export const EMPTY_COLLECTION: DataFeatureCollection = { type: 'FeatureCollection', features: [] }

export function layerLabel(id: DataLayerId): string {
  return DEV_DATA_LAYER_BY_ID.get(id)?.label ?? id
}

/**
 * City GIS exports store dates as epoch milliseconds and use sentinel values far
 * outside any plausible range, so anything outside 1900–2100 is treated as blank.
 */
export function formatCellValue(value: unknown, type: MapFeatureTableColumnType): string {
  if (value == null || value === '' || (typeof value === 'string' && value.trim() === '')) return ''

  if (type === 'datetime') {
    const epoch = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(epoch)) return ''
    const date = new Date(epoch)
    const year = date.getUTCFullYear()
    if (Number.isNaN(date.getTime()) || year < 1900 || year > 2100) return ''
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${year}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }

  if (type === 'numeric') {
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) return String(value)
    return numeric.toLocaleString('en-CA', { maximumFractionDigits: 2 })
  }

  return String(value)
}

export function featureLabel(feature: DataFeature, layer: DataLayerDef): string {
  const raw = feature.properties[layer.nameKey]
  const label = formatCellValue(raw, 'text').trim()
  return label || `${layer.label} ${feature.properties[FEATURE_ID_KEY].split(':').pop()}`
}

/** Rough centre of a feature's coordinates, good enough for flying the map to a row. */
export function featureCenter(feature: DataFeature): [number, number] | null {
  let sumLng = 0
  let sumLat = 0
  let count = 0

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      sumLng += coords[0]
      sumLat += coords[1]
      count += 1
      return
    }
    for (const entry of coords) walk(entry)
  }

  walk((feature.geometry as { coordinates?: unknown }).coordinates)
  return count === 0 ? null : [sumLng / count, sumLat / count]
}

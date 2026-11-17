/**
 * The features check's own read: mapped features for the ground an own photo shows, read live from DataBC's WFS.
 * Lakes should sit on water, roads on roads and recent cutblocks on clearings; drawn into the photo
 * (`photoOverlay.ts`) they are the strongest test of a camera from the air. See
 * docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, section 2.3.
 *
 * The read is bounded by what the camera sees (`photoSeenBounds`), not by the scene: from an aircraft the photo looks
 * many kilometres past the scene's own data. As everywhere on the page, the box goes in `CQL_FILTER` longitude first,
 * never the WFS `bbox` parameter, and `propertyName` stays narrow and names the geometry field. A layer that could not
 * be read is an error that reads *Not read*, never an empty layer that reads as *None*.
 *
 * `fetch` is passed in; no DOM or network access of its own.
 */
import type { HitBuffer } from './photoHitBuffer'

const RAD = Math.PI / 180
const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos(lat * RAD)

export const PHOTO_FEATURES_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'

/** Most features one layer's read returns; a fuller layer is flagged as cut short. */
export const MAX_PHOTO_FEATURES = 2000

/** Harvests this many years back or newer count as recent: older openings have mostly greened up and do not show. */
export const RECENT_HARVEST_YEARS = 30

export type PhotoFeatureSourceId = 'lakes' | 'rivers' | 'wetlands' | 'streams' | 'roads' | 'cutblocks'

export type PhotoFeatureSource = {
  id: PhotoFeatureSourceId
  label: string
  typeName: string
  /** The geometry field: `GEOMETRY` on most BCGW layers, `SHAPE` on consolidated cutblocks. */
  geometryField: string
  fields: readonly string[]
  /** The photo layer (`photoLayers.ts`) its features draw on. */
  photoLayer: 'lakes' | 'streams' | 'roads' | 'openings'
}

export const PHOTO_FEATURE_SOURCES: readonly PhotoFeatureSource[] = [
  {
    id: 'lakes',
    label: 'FWA lakes',
    typeName: 'WHSE_BASEMAPPING.FWA_LAKES_POLY',
    geometryField: 'GEOMETRY',
    fields: ['WATERBODY_POLY_ID', 'GNIS_NAME_1'],
    photoLayer: 'lakes',
  },
  {
    id: 'rivers',
    label: 'FWA rivers',
    typeName: 'WHSE_BASEMAPPING.FWA_RIVERS_POLY',
    geometryField: 'GEOMETRY',
    fields: ['WATERBODY_POLY_ID', 'GNIS_NAME_1'],
    photoLayer: 'lakes',
  },
  {
    id: 'wetlands',
    label: 'FWA wetlands',
    typeName: 'WHSE_BASEMAPPING.FWA_WETLANDS_POLY',
    geometryField: 'GEOMETRY',
    fields: ['WATERBODY_POLY_ID', 'GNIS_NAME_1'],
    photoLayer: 'lakes',
  },
  {
    id: 'streams',
    label: 'FWA streams (order 2 and up)',
    typeName: 'WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP',
    geometryField: 'GEOMETRY',
    fields: ['LINEAR_FEATURE_ID', 'GNIS_NAME', 'STREAM_ORDER'],
    photoLayer: 'streams',
  },
  {
    id: 'roads',
    label: 'FTEN roads',
    typeName: 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW',
    geometryField: 'GEOMETRY',
    fields: ['ROAD_SECTION_ID', 'ROAD_SECTION_NAME', 'FILE_TYPE_DESCRIPTION', 'LIFE_CYCLE_STATUS_CODE'],
    photoLayer: 'roads',
  },
  {
    id: 'cutblocks',
    label: 'Consolidated cutblocks',
    typeName: 'WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP',
    geometryField: 'SHAPE',
    fields: ['VCCB_SYSID', 'OPENING_ID', 'HARVEST_START_YEAR_CALENDAR'],
    photoLayer: 'openings',
  },
]

export type Box = [west: number, south: number, east: number, north: number]

/**
 * The box of ground the camera sees: every hit in the buffer, padded by `padMeters` so a lake whose shore is just in
 * frame is read whole. Null when the buffer has no ground.
 */
export function photoSeenBounds(buf: HitBuffer, padMeters = 250): Box | null {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (let i = 0; i < buf.lng.length; i++) {
    const lng = buf.lng[i],
      lat = buf.lat[i]
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  if (!(east >= west && north >= south)) return null
  const padLat = padMeters / METRES_PER_DEGREE_LAT,
    padLng = padMeters / metresPerDegreeLng((south + north) / 2)
  return [west - padLng, south - padLat, east + padLng, north + padLat]
}

/** The CQL condition a source adds to its box: stream order, recent harvests. */
function sourceFilter(source: PhotoFeatureSource, sinceYear: number): string {
  if (source.id === 'streams') return 'STREAM_ORDER >= 2'
  if (source.id === 'cutblocks') return `HARVEST_START_YEAR_CALENDAR >= ${Math.floor(sinceYear)}`
  return ''
}

export function photoFeatureUrl(source: PhotoFeatureSource, bounds: Box, sinceYear: number): string {
  const [w, s, e, n] = bounds.map((value) => Number(value.toFixed(6)))
  if (!(e > w && n > s)) throw new Error('The photo shows no ground to read features for.')
  // Longitude first: CQL's BBOX, unlike WFS 2.0's bbox parameter with EPSG:4326.
  const box = `BBOX(${source.geometryField},${w},${s},${e},${n},'EPSG:4326')`
  const filter = sourceFilter(source, sinceYear)
  return `${PHOTO_FEATURES_WFS}?${new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: source.typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(MAX_PHOTO_FEATURES),
    propertyName: [...source.fields, source.geometryField].join(','),
    CQL_FILTER: filter ? `${filter} AND ${box}` : box,
  }).toString()}`
}

export type PhotoFeatureRead =
  | { status: 'ready'; collection: GeoJSON.FeatureCollection; truncated: boolean }
  | { status: 'error'; error: string }

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const POLYGON = new Set(['Polygon', 'MultiPolygon'])
const LINE = new Set(['LineString', 'MultiLineString'])

/**
 * A source's reply as features the overlay draws: geometry of the kind the layer expects, an id, a label, and the
 * properties its symbol and summary read (`kind` for water, `harvestYear`, `forestServiceRoad`).
 */
export function parsePhotoFeatures(
  source: PhotoFeatureSource,
  payload: unknown,
): { collection: GeoJSON.FeatureCollection; truncated: boolean } {
  const reply = payload as { features?: unknown; numberMatched?: unknown }
  if (!Array.isArray(reply?.features)) throw new Error('DataBC sent no features list.')
  const wanted = source.photoLayer === 'streams' || source.photoLayer === 'roads' ? LINE : POLYGON
  const features = reply.features.flatMap((entry, index): GeoJSON.Feature[] => {
    const feature = entry as { id?: unknown; geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> }
    const geometry = feature.geometry
    if (!geometry || !wanted.has(geometry.type)) return []
    const p = feature.properties ?? {}
    const id = text(feature.id) ?? `${source.id}-${index}`
    const properties: Record<string, unknown> = { source: source.id, layer: source.photoLayer }
    switch (source.id) {
      case 'lakes':
      case 'rivers':
      case 'wetlands':
        properties.kind = source.id === 'lakes' ? 'lake' : source.id === 'rivers' ? 'river' : 'wetland'
        properties.label = text(p.GNIS_NAME_1)
        break
      case 'streams':
        properties.label = text(p.GNIS_NAME)
        properties.streamOrder = number(p.STREAM_ORDER)
        break
      case 'roads':
        properties.label = text(p.ROAD_SECTION_NAME)
        properties.fileType = text(p.FILE_TYPE_DESCRIPTION)
        properties.forestServiceRoad = /forest service road/i.test(text(p.FILE_TYPE_DESCRIPTION) ?? '')
        properties.lifeCycle = text(p.LIFE_CYCLE_STATUS_CODE)
        break
      case 'cutblocks': {
        const year = number(p.HARVEST_START_YEAR_CALENDAR)
        properties.harvestYear = year
        properties.openingId = text(p.OPENING_ID)
        properties.label = year === null ? null : `Harvested ${year}`
        break
      }
    }
    return [{ type: 'Feature', id, properties, geometry }]
  })
  const matched = number(reply.numberMatched)
  return {
    collection: { type: 'FeatureCollection', features },
    truncated: reply.features.length >= MAX_PHOTO_FEATURES || (matched !== null && matched > reply.features.length),
  }
}

/** Reads one source for the box. Throws with a reason the summary prints. */
export async function readPhotoFeatureSource(
  source: PhotoFeatureSource,
  bounds: Box,
  fetcher: typeof fetch,
  { signal, sinceYear }: { signal?: AbortSignal; sinceYear: number },
): Promise<{ collection: GeoJSON.FeatureCollection; truncated: boolean }> {
  const response = await fetcher(photoFeatureUrl(source, bounds, sinceYear), { signal })
  if (!response.ok) throw new Error(`DataBC answered ${response.status}.`)
  const payload: unknown = await response.json()
  if ((payload as { exceptions?: unknown })?.exceptions) throw new Error('DataBC refused the query.')
  return parsePhotoFeatures(source, payload)
}

export type PhotoFeatureReads = Record<PhotoFeatureSourceId, PhotoFeatureRead>

/**
 * Reads every source for the box at once. One failing source fails only itself, as an error; an aborted read throws,
 * so a superseded camera's answers never land.
 */
export async function readPhotoFeatures(
  bounds: Box,
  fetcher: typeof fetch,
  {
    signal,
    year = new Date().getUTCFullYear(),
    recentYears = RECENT_HARVEST_YEARS,
  }: { signal?: AbortSignal; year?: number; recentYears?: number } = {},
): Promise<PhotoFeatureReads> {
  const sinceYear = year - recentYears
  const entries = await Promise.all(
    PHOTO_FEATURE_SOURCES.map(async (source): Promise<[PhotoFeatureSourceId, PhotoFeatureRead]> => {
      try {
        const { collection, truncated } = await readPhotoFeatureSource(source, bounds, fetcher, { signal, sinceYear })
        return [source.id, { status: 'ready', collection, truncated }]
      } catch (error) {
        if (signal?.aborted) throw error
        return [source.id, { status: 'error', error: error instanceof Error ? error.message : String(error) }]
      }
    }),
  )
  return Object.fromEntries(entries) as PhotoFeatureReads
}

/** A source's row in the features check: *Not read* for a failure or a read not made, never *None*. */
export function photoFeatureSummary(source: PhotoFeatureSource, read: PhotoFeatureRead | undefined | null) {
  if (!read) return { value: 'Not read', tone: 'warning' as const, note: `${source.label} has not been read.` }
  if (read.status === 'error')
    return { value: 'Not read', tone: 'warning' as const, note: `${source.label} could not be read: ${read.error}` }
  const count = read.collection.features.length
  if (read.truncated)
    return {
      value: `${count}+`,
      tone: 'warning' as const,
      note: `${source.label}: more than one read returns; the farthest ground may be missing some.`,
    }
  return {
    value: count ? String(count) : 'None',
    tone: 'muted' as const,
    note: count ? `${source.label} in the photo's view.` : `No ${source.label.toLowerCase()} in the photo's view.`,
  }
}

/** The ready sources' features as overlay features (`photoOverlay.ts`), each on its photo layer. */
export function photoFeaturesForOverlay(reads: Partial<PhotoFeatureReads>) {
  return PHOTO_FEATURE_SOURCES.flatMap((source) => {
    const read = reads[source.id]
    if (read?.status !== 'ready') return []
    return read.collection.features.map((feature) => ({
      layer: source.photoLayer,
      ...(feature.id !== undefined ? { id: feature.id } : {}),
      ...(typeof feature.properties?.label === 'string' ? { label: feature.properties.label } : {}),
      properties: feature.properties ?? {},
      geometry: feature.geometry,
    }))
  })
}

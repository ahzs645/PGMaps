/**
 * Provincial layers the outdoors planner reads live, all under the Open Government Licence - British
 * Columbia. Forest roads, cutblocks and stands come from the same sources, through the same shared
 * modules, as the road designer and the visual quality tool; the rest are read from DataBC's WFS.
 *
 * - **Forest roads**: tenure road sections, `BC_ROADS_SERVICE` (`src/lib/forestry/bcForestRoads.ts`).
 *   "Forest Service Road" is one file type among several; road permits are most of the rest. A
 *   RETIRED section is a tenure fact, not proof the road is gone, and an ACTIVE one is not proof it
 *   is passable.
 * - **Cutblocks**: BC's consolidated cutblocks, `BC_HARVEST_SERVICE`, aged by the road designer's
 *   rule (`src/lib/forestry/bcHarvest.ts`): a block whose recorded years straddle a class break is
 *   "unknown", never put in the nearer class.
 * - **Forest stands** (`VEG_COMP_LYR_R1_POLY`, read through `src/lib/forestry/bcVegetationWfs.ts`'s
 *   limits): crown closure, projected height, age and leading species, read here as a rough guide to
 *   how far a person can see.
 * - **Boat launches**: recreation sites whose listed structures include a boat launch
 *   (`FTEN_REC_SITE_POINTS_SVW`), and coastal launches from the 1990s coastal resource atlas
 *   (`CHRA_BOAT_LAUNCHES_POINT`). Neither lists municipal or private ramps.
 * - **Lake depth charts** (`BATH_SURVEY_MAP_SHEETS_SVW`): outlines of lakes with a scanned chart, and
 *   **depth contours** (`BATH_LAKE_BATHYMETRIC_SP`) for the few lakes digitized.
 * - **Limited entry hunting zones** (`WAA_LTD_HNT_ZONE_CURR_YEAR_SVW`): one set per species; "Zone A of
 *   7-25" for moose is not the same ground as an elk zone there.
 * - **Rail lines** (`GBA_RAILWAY_TRACKS_SP`, in `railways.ts`).
 *
 * Everything here is free of DOM access, and every read takes its `fetch`. The bounding box of a WFS
 * read goes in `CQL_FILTER`, never the `bbox` parameter: WFS 2.0 with EPSG:4326 is latitude-first and
 * CQL's `BBOX` is longitude-first.
 */
import { readBoundedText } from '@/lib/boundedText'
import {
  BC_HARVEST_FIELDS,
  BC_HARVEST_SERVICE,
  bcHarvestEvidence,
  harvestAgeSummary,
  harvestHistoryStyle,
} from '@/lib/forestry/bcHarvest'
import { BC_ROADS_SERVICE, FSR_FILE_TYPE_CODE, tenureRoadClass } from '@/lib/forestry/bcForestRoads'
import {
  BC_VEGETATION_WFS,
  clampVegetationBounds,
  MAX_VEGETATION_FEATURES,
  MAX_VEGETATION_QUERY_DEGREES,
} from '@/lib/forestry/bcVegetationWfs'

export const BC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
export const BC_OPEN_LICENCE = 'Contains information licensed under the Open Government Licence - British Columbia'

/** [west, south, east, north] in WGS84 degrees. */
export type Bounds = [number, number, number, number]
type Fetch = typeof fetch

/** The most one read of a layer may carry; a larger answer is refused, not drawn in part. */
export const MAX_LAYER_RESPONSE_BYTES = 16 * 1024 * 1024
/** Widest box a WFS layer asks for at once, so a stray call cannot ask for the province. */
export const MAX_BC_QUERY_DEGREES = 12

// ---------------------------------------------------------------------------
// WFS layers

export type WfsLayerId = 'recLaunches' | 'coastalLaunches' | 'depthCharts' | 'depthContours' | 'huntZones' | 'stands'

interface WfsSource {
  endpoint: string
  typeName: string
  geometryColumn: string
  fields: string[]
  /** Below this zoom nothing is asked for. Absent, the layer is small enough to read whole. */
  minZoom?: number
  maxFeatures: number
  /** Widest box asked for at once, in degrees. */
  maxDegrees?: number
  /** Extra CQL, ANDed with the box. */
  filter?: string
}

const STRUCTURE_COLUMNS = Array.from({ length: 10 }, (_, index) => `STRUCTURE_DESC${index + 1}`)

export const WFS_SOURCES: Record<WfsLayerId, WfsSource> = {
  recLaunches: {
    endpoint: BC_WFS,
    typeName: 'WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW',
    geometryColumn: 'GEOMETRY',
    fields: ['FOREST_FILE_ID', 'PROJECT_NAME', 'SITE_LOCATION', 'MAINTAIN_STD_DESC', ...STRUCTURE_COLUMNS],
    maxFeatures: 2000,
    filter: STRUCTURE_COLUMNS.map((column) => `${column} LIKE 'Boat Launch%'`).join(' OR '),
  },
  coastalLaunches: {
    endpoint: BC_WFS,
    typeName: 'WHSE_ENVIRONMENTAL_MONITORING.CHRA_BOAT_LAUNCHES_POINT',
    geometryColumn: 'GEOMETRY',
    fields: ['BOAT_LAUNCH_ID', 'LOCATION', 'COMMENTS'],
    maxFeatures: 1000,
  },
  depthCharts: {
    endpoint: BC_WFS,
    typeName: 'WHSE_FISH.BATH_SURVEY_MAP_SHEETS_SVW',
    geometryColumn: 'GEOMETRY',
    fields: [
      'OBJECTID',
      'GAZETTED_NAME',
      'MAP_TITLE',
      'DRAFT_DATE',
      'MAP_SCALE',
      'SHEET_NO',
      'NUMBER_OF_MAP_SHEETS',
      'PDF_FILE_URL',
    ],
    minZoom: 7,
    maxFeatures: 3000,
  },
  depthContours: {
    endpoint: BC_WFS,
    typeName: 'WHSE_FISH.BATH_LAKE_BATHYMETRIC_SP',
    geometryColumn: 'SHAPE',
    fields: ['OBJECTID', 'LAKE_GAZETTED_NAME', 'CONTOUR_DEPTH_M', 'LAKE_MAX_DEPTH_M', 'LAKE_SURVEY_DATE'],
    maxFeatures: 1000,
  },
  huntZones: {
    endpoint: BC_WFS,
    typeName: 'WHSE_WILDLIFE_MANAGEMENT.WAA_LTD_HNT_ZONE_CURR_YEAR_SVW',
    geometryColumn: 'GEOMETRY',
    fields: [
      'LEHZ_SYSID',
      'LIMITED_ENTRY_HUNTING_ZONE',
      'MANAGEMENT_UNITS',
      'LTD_ENTRY_HUNTING_ZONE_TYPE',
      'LTD_ENTRY_HUNTING_ZONE_LABEL',
      'LEH_HUNT_AREA_ID',
    ],
    // Zone outlines are detailed: one species near the Tachie River is about 4 MB.
    minZoom: 8,
    maxFeatures: 400,
  },
  stands: {
    endpoint: BC_VEGETATION_WFS,
    typeName: 'WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY',
    geometryColumn: 'GEOMETRY',
    // The layer has 189 attributes; these seven are what a sightline guess needs.
    fields: [
      'FEATURE_ID',
      'BCLCS_LEVEL_1',
      'BCLCS_LEVEL_2',
      'SPECIES_CD_1',
      'PROJ_HEIGHT_1',
      'CROWN_CLOSURE',
      'PROJ_AGE_1',
    ],
    // GeoServer does not generalise geometry: a 13 km by 10 km view is about 2 MB.
    minZoom: 13,
    maxFeatures: MAX_VEGETATION_FEATURES,
    maxDegrees: MAX_VEGETATION_QUERY_DEGREES,
  },
}

/** Keeps a box centred and no wider than `limit` degrees either way. */
export function clampBounds(bounds: Bounds, limit = MAX_BC_QUERY_DEGREES): Bounds {
  const [west, south, east, north] = bounds
  const lng = (west + east) / 2
  const lat = (south + north) / 2
  const half = (span: number) => Math.min(Math.max(span, 0), limit) / 2
  return [lng - half(east - west), lat - half(north - south), lng + half(east - west), lat + half(north - south)]
}

/** The box a layer really asks for: VRI through the shared VRI clamp, the rest through `clampBounds`. */
export function layerQueryBounds(layer: WfsLayerId, bounds: Bounds): Bounds {
  if (layer === 'stands') return clampVegetationBounds(bounds)
  return clampBounds(bounds, WFS_SOURCES[layer].maxDegrees)
}

/** The query for a layer; `bounds` is required for a layer with a `minZoom` and ignored otherwise. */
export function wfsLayerUrl(layer: WfsLayerId, bounds?: Bounds, extraFilter?: string): string {
  const source = WFS_SOURCES[layer]
  const clauses: string[] = []
  if (source.minZoom != null) {
    if (!bounds) throw new Error(`${layer} needs a bounding box`)
    const [west, south, east, north] = layerQueryBounds(layer, bounds).map((value) => value.toFixed(5))
    clauses.push(`BBOX(${source.geometryColumn},${west},${south},${east},${north},'EPSG:4326')`)
  }
  for (const filter of [source.filter, extraFilter]) if (filter) clauses.push(`(${filter})`)
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: source.typeName,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
    propertyName: [...source.fields, source.geometryColumn].join(','),
    count: String(source.maxFeatures),
  })
  if (clauses.length > 0) params.set('CQL_FILTER', clauses.join(' AND '))
  return `${source.endpoint}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// ArcGIS layers: forest roads and cutblocks, from the designer's sources

/** One ArcGIS page; the services answer at most 1,000 features a request. */
export const ARCGIS_PAGE_SIZE = 1000

export interface ArcgisRead {
  service: string
  where: string
  fields: readonly string[]
  orderBy: string
  /** Pages asked for at most; an answer still over after the last is drawn and called truncated. */
  maxPages: number
}

/** Forest Service Roads show from this zoom; they are the main lines and few enough to read wide. */
export const FSR_MIN_ZOOM = 8
/** Every other tenure road (permits, special use) joins from this zoom. */
export const ALL_ROADS_MIN_ZOOM = 11
export const CUTBLOCK_MIN_ZOOM = 12
/** Past this zoom a road or block is read at the same detail, so a window is reused. */
export const MAX_READ_DETAIL_ZOOM = 14

const ROAD_FIELDS = [
  'OBJECTID',
  'ROAD_SECTION_NAME',
  'FOREST_FILE_ID',
  'FILE_TYPE_CODE',
  'FILE_TYPE_DESCRIPTION',
  'LIFE_CYCLE_STATUS_CODE',
  'CLIENT_NAME',
] as const

/** The reads for forest roads at a zoom: Forest Service Roads first, then the rest from `ALL_ROADS_MIN_ZOOM`. */
export function forestRoadReads(zoom: number): ArcgisRead[] {
  const fsr = `FILE_TYPE_CODE='${FSR_FILE_TYPE_CODE}'`
  const reads: ArcgisRead[] = [
    { service: BC_ROADS_SERVICE, where: fsr, fields: ROAD_FIELDS, orderBy: 'OBJECTID', maxPages: 2 },
  ]
  if (zoom >= ALL_ROADS_MIN_ZOOM)
    reads.push({
      service: BC_ROADS_SERVICE,
      where: `FILE_TYPE_CODE<>'${FSR_FILE_TYPE_CODE}'`,
      fields: ROAD_FIELDS,
      orderBy: 'OBJECTID',
      maxPages: 3,
    })
  return reads
}

/** Cutblocks, newest harvest first, so a view with more than the cap keeps the youngest blocks. */
export const CUTBLOCK_READ: ArcgisRead = {
  service: BC_HARVEST_SERVICE,
  where: '1=1',
  fields: BC_HARVEST_FIELDS,
  orderBy: 'HARVEST_START_YEAR_CALENDAR DESC,OBJECTID',
  maxPages: 3,
}

/**
 * How far the service may move a vertex to simplify a line: half a pixel at `zoom`, in degrees. A
 * provincial road read at zoom 9 is a fraction of its full detail and looks the same.
 */
export function generalisationDegrees(zoom: number): number {
  return 180 / (256 * 2 ** Math.min(zoom, MAX_READ_DETAIL_ZOOM))
}

export function arcgisPageUrl(read: ArcgisRead, bounds: Bounds, zoom: number, page: number): string {
  const [west, south, east, north] = clampBounds(bounds).map((value) => Number(value.toFixed(5)))
  const params = new URLSearchParams({
    where: read.where,
    geometry: [west, south, east, north].join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: read.fields.join(','),
    returnGeometry: 'true',
    maxAllowableOffset: generalisationDegrees(zoom).toPrecision(3),
    geometryPrecision: '6',
    orderByFields: read.orderBy,
    resultOffset: String(page * ARCGIS_PAGE_SIZE),
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
    f: 'geojson',
  })
  return `${read.service}/query?${params.toString()}`
}

/** One page of an ArcGIS GeoJSON answer: its features, and whether the service holds more. */
export function parseArcgisPage(payload: unknown): { features: unknown[]; more: boolean } {
  const page = payload as {
    error?: { message?: unknown }
    features?: unknown
    exceededTransferLimit?: unknown
    properties?: { exceededTransferLimit?: unknown } | null
  } | null
  if (page?.error) {
    const message = typeof page.error.message === 'string' ? page.error.message : 'the query was refused'
    throw new Error(`DataBC: ${message}`)
  }
  if (!Array.isArray(page?.features)) throw new Error('DataBC returned no feature collection')
  return {
    features: page.features,
    more: page.exceededTransferLimit === true || page.properties?.exceededTransferLimit === true,
  }
}

/** One read of a layer: bounded, and refused when DataBC answers with an exception. */
export async function readLayerJson(fetcher: Fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { signal })
  if (!response.ok) throw new Error(`DataBC answered ${response.status}`)
  const text = await readBoundedText(response, {
    maxBytes: MAX_LAYER_RESPONSE_BYTES,
    tooLarge: 'The answer was too large to draw; zoom in.',
    signal,
  })
  const payload: unknown = JSON.parse(text)
  if ((payload as { exceptions?: unknown } | null)?.exceptions) throw new Error('DataBC refused the query')
  return payload
}

/** Every page of the reads, in order, up to each read's page limit. */
export async function readArcgis(
  reads: readonly ArcgisRead[],
  bounds: Bounds,
  zoom: number,
  signal: AbortSignal,
  fetcher: Fetch = fetch,
): Promise<{ features: unknown[]; truncated: boolean }> {
  const features: unknown[] = []
  let truncated = false
  for (const read of reads) {
    for (let page = 0; page < read.maxPages; page += 1) {
      const answer = parseArcgisPage(await readLayerJson(fetcher, arcgisPageUrl(read, bounds, zoom, page), signal))
      features.push(...answer.features)
      if (!answer.more) break
      if (page === read.maxPages - 1) truncated = true
    }
  }
  return { features, truncated }
}

/** One WFS layer, read for a box (or whole, for a layer without a `minZoom`). */
export async function readWfs(
  layer: WfsLayerId,
  bounds: Bounds | undefined,
  signal: AbortSignal,
  extraFilter?: string,
  fetcher: Fetch = fetch,
): Promise<unknown> {
  return readLayerJson(fetcher, wfsLayerUrl(layer, bounds, extraFilter), signal)
}

// ---------------------------------------------------------------------------
// Reading an answer

type Row = { geometry: GeoJSON.Geometry; properties: Record<string, unknown> }

const GEOMETRY_KINDS = {
  line: ['LineString', 'MultiLineString'],
  polygon: ['Polygon', 'MultiPolygon'],
  point: ['Point'],
} as const

function rowsOf(features: readonly unknown[], kind: keyof typeof GEOMETRY_KINDS): Row[] {
  const allowed: readonly string[] = GEOMETRY_KINDS[kind]
  const rows: Row[] = []
  for (const feature of features) {
    const record = feature as {
      geometry?: { type?: unknown; coordinates?: unknown } | null
      properties?: unknown
    } | null
    const geometry = record?.geometry
    if (!geometry || typeof geometry.type !== 'string' || !allowed.includes(geometry.type)) continue
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) continue
    const properties =
      typeof record?.properties === 'object' && record.properties != null
        ? (record.properties as Record<string, unknown>)
        : {}
    rows.push({ geometry: geometry as GeoJSON.Geometry, properties })
  }
  return rows
}

function wfsFeatures(payload: unknown): unknown[] {
  const features = (payload as { features?: unknown } | null)?.features
  return Array.isArray(features) ? features : []
}

/** GeoServer reports the full match count even when `count` cut the answer short. */
function wfsTruncated(payload: unknown, layer: WfsLayerId): boolean {
  const returned = wfsFeatures(payload).length
  const matched = (payload as { numberMatched?: unknown } | null)?.numberMatched
  return returned >= WFS_SOURCES[layer].maxFeatures || (typeof matched === 'number' && matched > returned)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function year(value: unknown): number | null {
  const match = typeof value === 'string' ? /^(\d{4})/.exec(value) : null
  const parsed = match ? Number(match[1]) : number(value)
  return parsed != null && parsed >= 1800 && parsed <= 2100 ? Math.trunc(parsed) : null
}

function key(value: unknown, fallback: string): string {
  return typeof value === 'number' || (typeof value === 'string' && value) ? String(value) : fallback
}

/** "PINCHI SOUTH EAST" → "Pinchi South East"; the inventories shout their names. */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s\-/(])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
}

export interface LayerAnswer<P> {
  collection: GeoJSON.FeatureCollection<GeoJSON.Geometry, P>
  truncated: boolean
}

function collect<P>(
  features: readonly unknown[],
  kind: keyof typeof GEOMETRY_KINDS,
  read: (properties: Record<string, unknown>, index: number) => P | null,
): GeoJSON.FeatureCollection<GeoJSON.Geometry, P> {
  const out: Array<GeoJSON.Feature<GeoJSON.Geometry, P>> = []
  rowsOf(features, kind).forEach((row, index) => {
    const properties = read(row.properties, index)
    if (properties) out.push({ type: 'Feature', geometry: row.geometry, properties })
  })
  return { type: 'FeatureCollection', features: out }
}

function wfsAnswer<P>(
  payload: unknown,
  layer: WfsLayerId,
  kind: keyof typeof GEOMETRY_KINDS,
  read: (properties: Record<string, unknown>, index: number) => P | null,
): LayerAnswer<P> {
  return { collection: collect(wfsFeatures(payload), kind, read), truncated: wfsTruncated(payload, layer) }
}

export interface CardText {
  title: string
  lines: string[]
  caution?: string
}

// ---------------------------------------------------------------------------
// Forest roads

export interface ForestRoadProperties {
  id: string
  name: string | null
  /** The tenure file type as recorded: "Forest Service Road", "Road Permit"… */
  tenure: string | null
  /** A Forest Service Road, as opposed to a permit or other tenure road. */
  fsr: boolean
  /** ACTIVE, RETIRED, PENDING: the tenure's status, not the road's condition. */
  tenureStatus: string | null
  retired: boolean
  holder: string | null
}

export function parseForestRoads(
  features: readonly unknown[],
): GeoJSON.FeatureCollection<GeoJSON.Geometry, ForestRoadProperties> {
  return collect(features, 'line', (properties, index) => {
    const status = text(properties.LIFE_CYCLE_STATUS_CODE)
    const name = text(properties.ROAD_SECTION_NAME)
    const file = text(properties.FOREST_FILE_ID)
    return {
      id: key(properties.OBJECTID, `road-${index}`),
      // A section "name" is often just its file number again; keep real names only.
      name: name && name !== file && /[A-Za-z]{3}/.test(name) ? titleCase(name) : null,
      tenure: text(properties.FILE_TYPE_DESCRIPTION),
      fsr: tenureRoadClass(properties.FILE_TYPE_CODE) === 'fsr',
      tenureStatus: status,
      retired: status?.toUpperCase() === 'RETIRED',
      holder: text(properties.CLIENT_NAME),
    }
  })
}

export function describeForestRoad(properties: Partial<ForestRoadProperties>): CardText {
  const kind = properties.fsr ? 'Forest Service Road' : (properties.tenure ?? 'Forest road')
  const status = properties.tenureStatus ? titleCase(properties.tenureStatus) : 'not recorded'
  return {
    title: properties.name ? `${properties.name} (${kind})` : kind,
    lines: [`Tenure status: ${status}`, ...(properties.holder ? [titleCase(properties.holder)] : [])],
    caution: properties.retired
      ? 'Retired tenure: the road may be deactivated, overgrown or bridged out.'
      : 'Tenure status is not road condition. Check for washouts and closures.',
  }
}

// ---------------------------------------------------------------------------
// Cutblocks

/** The road designer's harvest age classes (`harvestHistoryStyle`), in legend order. */
export const CUTBLOCK_CLASSES = [
  { key: 'recent', label: '0–10 years since harvest', color: '#d97706' },
  { key: 'medium', label: '11–30 years', color: '#0d9488' },
  { key: 'older', label: 'Over 30 years', color: '#166534' },
  { key: 'unknown', label: 'Age unknown or uncertain', color: '#64748b' },
] as const

export interface CutblockProperties {
  id: string
  /** `harvestHistoryStyle`'s key and colour for the visit's year. */
  age: string
  color: string
  /** `harvestAgeSummary`'s sentence for the visit's year. */
  summary: string
  areaHa: number | null
  source: string | null
}

export function parseCutblocks(
  features: readonly unknown[],
  currentYear: number,
): GeoJSON.FeatureCollection<GeoJSON.Geometry, CutblockProperties> {
  return collect(features, 'polygon', (properties, index) => {
    let evidence
    try {
      evidence = bcHarvestEvidence(properties)
    } catch {
      // A record the designer's rule cannot read is drawn as unknown, never guessed at.
      evidence = undefined
    }
    const style = harvestHistoryStyle(evidence, currentYear)
    const area = number(properties.AREA_HA)
    return {
      id: key(properties.VCCB_SYSID ?? properties.OBJECTID, `block-${index}`),
      age: style.key,
      color: style.color,
      summary: harvestAgeSummary(evidence, currentYear),
      areaHa: area != null ? Math.round(area * 10) / 10 : null,
      source: text(properties.DATA_SOURCE),
    }
  })
}

export function describeCutblock(properties: Partial<CutblockProperties>): CardText {
  const lines = [properties.summary ?? 'Harvest date unknown']
  if (properties.areaHa != null) lines.push(`${properties.areaHa.toLocaleString()} ha`)
  if (properties.source) lines.push(`Source: ${properties.source}`)
  return { title: 'Cutblock', lines }
}

// ---------------------------------------------------------------------------
// Boat launches

export interface BoatLaunchProperties {
  id: string
  name: string
  /** Where the record comes from, in words. */
  source: 'Recreation site' | 'Coastal atlas'
  /** "Gravel", "Concrete"… when the record says. */
  surface: string | null
  detail: string | null
}

export function parseRecLaunches(payload: unknown): LayerAnswer<BoatLaunchProperties> {
  return wfsAnswer(payload, 'recLaunches', 'point', (properties, index) => {
    const launch = STRUCTURE_COLUMNS.map((column) => text(properties[column])).find((value) =>
      value?.toLowerCase().startsWith('boat launch'),
    )
    // The server filter already asks for this; a row without one is not a launch.
    if (!launch) return null
    const surface = /-\s*(.+)$/.exec(launch)?.[1] ?? null
    const name = text(properties.PROJECT_NAME)
    const location = text(properties.SITE_LOCATION)
    return {
      id: `rec-${key(properties.FOREST_FILE_ID, String(index))}`,
      name: name ? `${titleCase(name)} recreation site` : 'Recreation site',
      source: 'Recreation site',
      surface,
      detail: [location ? `Near ${titleCase(location)}` : null, text(properties.MAINTAIN_STD_DESC)]
        .filter(Boolean)
        .join(' · '),
    }
  })
}

export function parseCoastalLaunches(payload: unknown): LayerAnswer<BoatLaunchProperties> {
  return wfsAnswer(payload, 'coastalLaunches', 'point', (properties, index) => ({
    id: `coast-${key(properties.BOAT_LAUNCH_ID, String(index))}`,
    name: text(properties.LOCATION) ?? 'Coastal boat launch',
    source: 'Coastal atlas',
    surface: null,
    detail: text(properties.COMMENTS),
  }))
}

export function describeBoatLaunch(properties: Partial<BoatLaunchProperties>): CardText {
  const coastal = properties.source === 'Coastal atlas'
  return {
    title: properties.name ?? 'Boat launch',
    lines: [
      properties.surface ? `Boat launch, ${properties.surface.toLowerCase()}` : 'Boat launch',
      ...(properties.detail ? [properties.detail] : []),
    ],
    caution: coastal
      ? 'From a 1990s coastal atlas. Confirm the launch still exists.'
      : 'Listed at a provincial recreation site. Confirm access and water level.',
  }
}

// ---------------------------------------------------------------------------
// Lake depth

export interface DepthChartProperties {
  id: string
  lake: string
  surveyYear: number | null
  scale: number | null
  sheet: number | null
  sheets: number | null
  /** The scanned chart. Always https: the inventory lists http, which a secure page cannot open. */
  pdfUrl: string | null
  /**
   * Every sheet of the chart this one belongs to, as JSON (`[{ sheet, url }]`), filled once the
   * answer is read: a map feature's properties cannot hold an array.
   */
  chartSheets: string
}

export function secureUrl(value: unknown): string | null {
  const url = text(value)
  if (!url || !/^https?:\/\/a100\.gov\.bc\.ca\//i.test(url)) return null
  return url.replace(/^http:/i, 'https:')
}

export interface ChartSheet {
  sheet: number
  url: string
}

/**
 * The sheets of each chart in an answer. A large lake is charted on several sheets, each its own
 * polygon; they share a lake name and survey year, which is what groups them here.
 */
export function chartSheetsByLake(
  charts: ReadonlyArray<Pick<DepthChartProperties, 'lake' | 'surveyYear' | 'sheet' | 'pdfUrl'>>,
): Map<string, ChartSheet[]> {
  const groups = new Map<string, Map<number, string>>()
  for (const chart of charts) {
    if (!chart.pdfUrl) continue
    const group = `${chart.lake}|${chart.surveyYear ?? ''}`
    const sheets = groups.get(group) ?? new Map<number, string>()
    sheets.set(chart.sheet ?? sheets.size + 1, chart.pdfUrl)
    groups.set(group, sheets)
  }
  return new Map(
    [...groups.entries()].map(([group, sheets]) => [
      group,
      [...sheets.entries()].sort(([a], [b]) => a - b).map(([sheet, url]) => ({ sheet, url })),
    ]),
  )
}

export function parseDepthCharts(payload: unknown): LayerAnswer<DepthChartProperties> {
  const answer = wfsAnswer<DepthChartProperties>(payload, 'depthCharts', 'polygon', (properties, index) => {
    const name = text(properties.GAZETTED_NAME) ?? text(properties.MAP_TITLE)
    return {
      id: key(properties.OBJECTID, `chart-${index}`),
      lake: name ? titleCase(name) : 'Unnamed lake',
      surveyYear: year(properties.DRAFT_DATE),
      scale: number(properties.MAP_SCALE),
      sheet: number(properties.SHEET_NO),
      sheets: number(properties.NUMBER_OF_MAP_SHEETS),
      pdfUrl: secureUrl(properties.PDF_FILE_URL),
      chartSheets: '[]',
    }
  })
  const groups = chartSheetsByLake(answer.collection.features.map((feature) => feature.properties))
  for (const feature of answer.collection.features) {
    const { lake, surveyYear } = feature.properties
    feature.properties.chartSheets = JSON.stringify(groups.get(`${lake}|${surveyYear ?? ''}`) ?? [])
  }
  return answer
}

/** The sheets a clicked chart lists, read back from its feature's properties. */
export function chartSheetsOf(properties: Record<string, unknown>): ChartSheet[] {
  try {
    const parsed: unknown = JSON.parse(typeof properties.chartSheets === 'string' ? properties.chartSheets : '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry: unknown) => {
      const sheet = entry as { sheet?: unknown; url?: unknown }
      const url = secureUrl(sheet.url)
      return typeof sheet.sheet === 'number' && url ? [{ sheet: sheet.sheet, url }] : []
    })
  } catch {
    return []
  }
}

export function describeDepthChart(properties: Partial<DepthChartProperties>): CardText {
  const lines: string[] = []
  const facts = [
    properties.surveyYear != null ? `Charted ${properties.surveyYear}` : null,
    properties.scale != null ? `1:${properties.scale.toLocaleString()}` : null,
    properties.sheets != null && properties.sheets > 1 && properties.sheet != null
      ? `sheet ${properties.sheet} of ${properties.sheets}`
      : null,
  ].filter(Boolean)
  if (facts.length > 0) lines.push(facts.join(' · '))
  lines.push(properties.pdfUrl ? 'Click for the scanned depth chart' : 'No chart file is listed')
  return {
    title: `${properties.lake ?? 'Lake'} depth chart`,
    lines,
    caution: 'Not for navigation. Water levels and bottoms change.',
  }
}

/**
 * Depth bands for the digitized lakes, shallow to deep. A contour polygon is "everything at least
 * this deep", so it takes the colour of the band its own depth starts.
 */
export const DEPTH_BANDS = [
  { fromM: 0, label: '0–3 m', color: '#bae6fd' },
  { fromM: 3, label: '3–10 m', color: '#7dd3fc' },
  { fromM: 10, label: '10–20 m', color: '#38bdf8' },
  { fromM: 20, label: '20–40 m', color: '#0284c7' },
  { fromM: 40, label: '40–60 m', color: '#1d4ed8' },
  { fromM: 60, label: 'Over 60 m', color: '#1e1b4b' },
] as const

/** The inventory marks islands with a depth of 99999. */
const MAX_REAL_DEPTH_M = 2000

export function depthBandColor(depthM: number): string {
  let color: string = DEPTH_BANDS[0].color
  for (const band of DEPTH_BANDS) if (depthM >= band.fromM) color = band.color
  return color
}

export interface DepthContourProperties {
  id: string
  lake: string
  depthM: number
  maxDepthM: number | null
  surveyYear: number | null
}

export function parseDepthContours(payload: unknown): LayerAnswer<DepthContourProperties> {
  const parsed = wfsAnswer<DepthContourProperties>(payload, 'depthContours', 'polygon', (properties, index) => {
    const depth = number(properties.CONTOUR_DEPTH_M)
    if (depth == null || depth < 0 || depth > MAX_REAL_DEPTH_M) return null
    const name = text(properties.LAKE_GAZETTED_NAME)
    return {
      id: key(properties.OBJECTID, `contour-${index}`),
      lake: name ? titleCase(name) : 'Unnamed lake',
      depthM: depth,
      maxDepthM: number(properties.LAKE_MAX_DEPTH_M),
      surveyYear: year(properties.LAKE_SURVEY_DATE),
    }
  })
  // Each polygon is "everything at least this deep"; drawn shallow first, the deeper ones land on
  // top, so each band shows only where the next has not begun.
  parsed.collection.features.sort((a, b) => a.properties.depthM - b.properties.depthM)
  return parsed
}

export function describeDepthContour(properties: Partial<DepthContourProperties>): CardText {
  return {
    title: properties.lake ?? 'Lake',
    lines: [
      properties.depthM ? `At least ${properties.depthM} m deep here` : 'Shallows, to the first contour',
      ...(properties.maxDepthM != null ? [`Deepest point ${properties.maxDepthM} m`] : []),
      ...(properties.surveyYear != null ? [`Surveyed ${properties.surveyYear}`] : []),
    ],
    caution: 'Not for navigation. Water levels and bottoms change.',
  }
}

// ---------------------------------------------------------------------------
// Limited entry hunting zones

/** The species the zone layer carries, as it spells them. */
export const HUNT_ZONE_SPECIES = [
  'MOOSE',
  'ELK',
  'MULE DEER',
  'WHITE-TAILED DEER',
  'MOUNTAIN GOAT',
  'MOUNTAIN SHEEP',
  'CARIBOU',
  'BISON',
  'BLACK BEAR',
  'TURKEY',
] as const
export type HuntZoneSpecies = (typeof HUNT_ZONE_SPECIES)[number]

/** CQL for one species. The value comes from the fixed list above, never from free text. */
export function huntZoneFilter(species: HuntZoneSpecies): string {
  return `LTD_ENTRY_HUNTING_ZONE_TYPE='${species}'`
}

export interface HuntZoneProperties {
  id: string
  species: string
  /** "Zone A of 7-25", or the unit number alone when the zone is the whole unit. */
  label: string
  /** "7-25" or "6-05, 6-06" as recorded. */
  units: string | null
  /** Joins to the draw report's "LEH Hunt Area", e.g. "725A". */
  huntAreaId: string | null
}

export function parseHuntZones(payload: unknown): LayerAnswer<HuntZoneProperties> {
  return wfsAnswer(payload, 'huntZones', 'polygon', (properties, index) => {
    const species = text(properties.LTD_ENTRY_HUNTING_ZONE_TYPE)
    const label = text(properties.LTD_ENTRY_HUNTING_ZONE_LABEL) ?? text(properties.LIMITED_ENTRY_HUNTING_ZONE)
    if (!species || !label) return null
    return {
      id: key(properties.LEHZ_SYSID, `zone-${index}`),
      species: titleCase(species),
      label,
      units: text(properties.MANAGEMENT_UNITS),
      huntAreaId: text(properties.LEH_HUNT_AREA_ID),
    }
  })
}

// ---------------------------------------------------------------------------
// Forest openness

/**
 * How far a person on foot is likely to see through a stand, guessed from the forest inventory. The
 * classes and their thresholds are a screening rule made for this planner, not a published standard
 * and not checked on the ground:
 *
 * - `open`: no tree cover recorded, trees under 2 m, or crown closure under 10%.
 * - `sparse`: crown closure 10 to 25%, trees 2 m or taller.
 * - `brush`: trees 2 to 6 m with crown closure over 25%. Regrowth at eye height, which blocks sight
 *   more than mature timber does.
 * - `timber`: trees over 6 m, crown closure 26 to 55%.
 * - `dense`: trees over 6 m, crown closure over 55%.
 */
export type Openness = 'open' | 'sparse' | 'brush' | 'timber' | 'dense'

export const OPENNESS_LABELS: Record<Openness, string> = {
  open: 'Open ground',
  sparse: 'Sparse trees',
  brush: 'Eye-height regrowth',
  timber: 'Timber',
  dense: 'Dense timber',
}

export const OPENNESS_COLORS: Record<Openness, string> = {
  open: '#fde047',
  sparse: '#bef264',
  brush: '#c2410c',
  timber: '#16a34a',
  dense: '#14532d',
}

export const OPENNESS_SIGHT: Record<Openness, string> = {
  open: 'Long sightlines likely',
  sparse: 'Good sightlines between trees',
  brush: 'Sight blocked at eye height',
  timber: 'Sight under the canopy varies',
  dense: 'Short sightlines',
}

export const BRUSH_MAX_HEIGHT_M = 6
export const LOW_COVER_MAX_HEIGHT_M = 2

export function opennessOf(stand: { treed: boolean; heightM: number | null; crownClosure: number | null }): Openness {
  const { treed, heightM, crownClosure } = stand
  if (!treed) return 'open'
  if (heightM != null && heightM < LOW_COVER_MAX_HEIGHT_M) return 'open'
  // A treed stand with no closure figure is treated as timber: the cautious reading for a sightline.
  const closure = crownClosure ?? 40
  if (closure < 10) return 'open'
  if (closure <= 25) return 'sparse'
  if (heightM != null && heightM <= BRUSH_MAX_HEIGHT_M) return 'brush'
  return closure > 55 ? 'dense' : 'timber'
}

export interface StandProperties {
  id: string
  openness: Openness
  treed: boolean
  crownClosure: number | null
  heightM: number | null
  ageYears: number | null
  /** The inventory's leading species code, e.g. "PLI" (lodgepole pine), "SX" (spruce). */
  species: string | null
}

/** Water is left out: a lake is open, but it is not ground to hunt across. */
export function parseStands(payload: unknown): LayerAnswer<StandProperties> {
  return wfsAnswer(payload, 'stands', 'polygon', (properties, index) => {
    const level2 = text(properties.BCLCS_LEVEL_2)?.toUpperCase() ?? null
    if (level2 === 'W') return null
    // No land-cover call at all means the inventory did not describe the polygon.
    if (!text(properties.BCLCS_LEVEL_1) && level2 == null) return null
    const treed = level2 === 'T'
    const heightM = number(properties.PROJ_HEIGHT_1)
    const crownClosure = number(properties.CROWN_CLOSURE)
    return {
      id: key(properties.FEATURE_ID, `stand-${index}`),
      openness: opennessOf({ treed, heightM, crownClosure }),
      treed,
      crownClosure,
      heightM,
      ageYears: number(properties.PROJ_AGE_1),
      species: text(properties.SPECIES_CD_1),
    }
  })
}

export function describeStand(properties: Partial<StandProperties>): CardText {
  const openness = properties.openness ?? 'timber'
  const facts = [
    properties.crownClosure != null ? `Crown closure ${properties.crownClosure}%` : null,
    properties.heightM != null ? `trees about ${Math.round(properties.heightM)} m` : null,
    properties.ageYears != null ? `${properties.ageYears} years old` : null,
    properties.species ? `leading species ${properties.species}` : null,
  ].filter(Boolean)
  return {
    title: OPENNESS_LABELS[openness],
    lines: [
      OPENNESS_SIGHT[openness],
      facts.length > 0 ? facts.join(', ') : properties.treed ? 'No stand figures recorded' : 'No tree cover recorded',
    ],
    caution: 'An estimate from the forest inventory, which can be years out of date. Check the imagery.',
  }
}

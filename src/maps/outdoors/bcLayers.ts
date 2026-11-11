/**
 * Provincial layers the trip planner reads live from DataBC's WFS, all under
 * the Open Government Licence - British Columbia:
 *
 * - **Forest roads** (`FTEN_ROAD_SECTION_LINES_SVW`): tenure road sections.
 *   "Forest Service Road" is one file type among several; road permits are
 *   the rest. A RETIRED section is a tenure fact, not proof the road is gone,
 *   and an ACTIVE one is not proof it is passable.
 * - **Cutblocks** (`VEG_CONSOLIDATED_CUT_BLOCKS_SP`): harvested areas with the
 *   year harvest started, from tenure records and satellite change detection.
 * - **Boat launches**: recreation sites whose listed structures include a boat
 *   launch (`FTEN_REC_SITE_POINTS_SVW`), and coastal launches from the 1990s
 *   coastal resource atlas (`CHRA_BOAT_LAUNCHES_POINT`). Neither is a complete
 *   list of launches; municipal and private ramps are not in either.
 * - **Lake depth charts** (`BATH_SURVEY_MAP_SHEETS_SVW`): outlines of lakes
 *   that have a scanned depth chart, with the chart's PDF. Most surveys date
 *   from the 1950s to 1990s.
 * - **Lake depth contours** (`BATH_LAKE_BATHYMETRIC_SP`): the few lakes whose
 *   charts were digitized into depth polygons.
 * - **Limited entry hunting zones** (`WAA_LTD_HNT_ZONE_CURR_YEAR_SVW`): the
 *   zones a management unit is split into for a draw, one set per species.
 *   "Zone A of 7-25" for moose is not the same ground as an elk zone there.
 * - **Forest stands** (`VEG_COMP_LYR_R1_POLY`, the Vegetation Resources
 *   Inventory): crown closure, projected height, age and leading species per
 *   stand, read here as a rough guide to how far a person can see.
 *
 * Everything here is pure except `fetchBcLayer`. The bounding box goes in
 * `CQL_FILTER`, never the WFS `bbox` parameter: WFS 2.0 with EPSG:4326 is
 * latitude-first and CQL's `BBOX` is longitude-first.
 */

export const BC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
export const BC_OPEN_LICENCE = 'Contains information licensed under the Open Government Licence - British Columbia'

/** [west, south, east, north] in WGS84 degrees. */
export type Bounds = [number, number, number, number]

export type BcLayerId =
  | 'forestRoads'
  | 'cutblocks'
  | 'recLaunches'
  | 'coastalLaunches'
  | 'depthCharts'
  | 'depthContours'
  | 'huntZones'
  | 'stands'

interface BcLayerSource {
  typeName: string
  geometryColumn: string
  fields: string[]
  /** Below this zoom nothing is asked for. Absent, the layer is small enough to read whole. */
  minZoom?: number
  maxFeatures: number
  /** Extra CQL, ANDed with the box. */
  filter?: string
}

const STRUCTURE_COLUMNS = Array.from({ length: 10 }, (_, index) => `STRUCTURE_DESC${index + 1}`)

export const BC_LAYER_SOURCES: Record<BcLayerId, BcLayerSource> = {
  forestRoads: {
    typeName: 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW',
    geometryColumn: 'GEOMETRY',
    fields: [
      'FOREST_FILE_ID',
      'ROAD_SECTION_ID',
      'ROAD_SECTION_NAME',
      'FILE_TYPE_DESCRIPTION',
      'LIFE_CYCLE_STATUS_CODE',
      'CLIENT_NAME',
      'OBJECTID',
    ],
    minZoom: 9,
    maxFeatures: 6000,
  },
  cutblocks: {
    typeName: 'WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP',
    geometryColumn: 'SHAPE',
    fields: ['VCCB_SYSID', 'HARVEST_START_YEAR_CALENDAR', 'PERCENT_CLEARCUT', 'DATA_SOURCE', 'FEATURE_AREA_SQM'],
    minZoom: 10,
    maxFeatures: 4000,
  },
  recLaunches: {
    typeName: 'WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW',
    geometryColumn: 'GEOMETRY',
    fields: ['FOREST_FILE_ID', 'PROJECT_NAME', 'SITE_LOCATION', 'MAINTAIN_STD_DESC', ...STRUCTURE_COLUMNS],
    maxFeatures: 2000,
    filter: STRUCTURE_COLUMNS.map((column) => `${column} LIKE 'Boat Launch%'`).join(' OR '),
  },
  coastalLaunches: {
    typeName: 'WHSE_ENVIRONMENTAL_MONITORING.CHRA_BOAT_LAUNCHES_POINT',
    geometryColumn: 'GEOMETRY',
    fields: ['BOAT_LAUNCH_ID', 'LOCATION', 'COMMENTS'],
    maxFeatures: 1000,
  },
  depthCharts: {
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
  stands: {
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
    minZoom: 12,
    maxFeatures: 5000,
  },
  huntZones: {
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
  depthContours: {
    typeName: 'WHSE_FISH.BATH_LAKE_BATHYMETRIC_SP',
    geometryColumn: 'SHAPE',
    fields: ['OBJECTID', 'LAKE_GAZETTED_NAME', 'CONTOUR_DEPTH_M', 'LAKE_MAX_DEPTH_M', 'LAKE_SURVEY_DATE'],
    maxFeatures: 1000,
  },
}

/** Widest box asked for at once, degrees, so a stray call cannot ask for the province. */
export const MAX_BC_QUERY_DEGREES = 12

export function clampBounds(bounds: Bounds, limit = MAX_BC_QUERY_DEGREES): Bounds {
  const [west, south, east, north] = bounds
  const lng = (west + east) / 2
  const lat = (south + north) / 2
  const half = (span: number) => Math.min(Math.max(span, 0), limit) / 2
  return [lng - half(east - west), lat - half(north - south), lng + half(east - west), lat + half(north - south)]
}

/** The query for a layer; `bounds` is required for a layer with a `minZoom` and ignored otherwise. */
export function bcLayerUrl(layer: BcLayerId, bounds?: Bounds, extraFilter?: string): string {
  const source = BC_LAYER_SOURCES[layer]
  const clauses: string[] = []
  if (source.minZoom != null) {
    if (!bounds) throw new Error(`${layer} needs a bounding box`)
    const [west, south, east, north] = clampBounds(bounds).map((value) => value.toFixed(5))
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
  return `${BC_WFS}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Reading an answer

type Row = { geometry: GeoJSON.Geometry; properties: Record<string, unknown> }

const GEOMETRY_KINDS = {
  line: ['LineString', 'MultiLineString'],
  polygon: ['Polygon', 'MultiPolygon'],
  point: ['Point'],
} as const

function rowsOf(payload: unknown, kind: keyof typeof GEOMETRY_KINDS): { rows: Row[]; returned: number } {
  const source = payload as { features?: unknown } | null
  const features = Array.isArray(source?.features) ? source.features : []
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
  return { rows, returned: features.length }
}

function truncatedAnswer(payload: unknown, returned: number, layer: BcLayerId): boolean {
  const matched = (payload as { numberMatched?: unknown } | null)?.numberMatched
  return returned >= BC_LAYER_SOURCES[layer].maxFeatures || (typeof matched === 'number' && matched > returned)
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

function answer<P>(
  payload: unknown,
  layer: BcLayerId,
  kind: keyof typeof GEOMETRY_KINDS,
  read: (properties: Record<string, unknown>, index: number) => P | null,
): LayerAnswer<P> {
  const { rows, returned } = rowsOf(payload, kind)
  const features: Array<GeoJSON.Feature<GeoJSON.Geometry, P>> = []
  rows.forEach((row, index) => {
    const properties = read(row.properties, index)
    if (properties) features.push({ type: 'Feature', geometry: row.geometry, properties })
  })
  return { collection: { type: 'FeatureCollection', features }, truncated: truncatedAnswer(payload, returned, layer) }
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

export function parseForestRoads(payload: unknown): LayerAnswer<ForestRoadProperties> {
  return answer(payload, 'forestRoads', 'line', (properties, index) => {
    const tenure = text(properties.FILE_TYPE_DESCRIPTION)
    const status = text(properties.LIFE_CYCLE_STATUS_CODE)
    const name = text(properties.ROAD_SECTION_NAME)
    const file = text(properties.FOREST_FILE_ID)
    return {
      id: key(properties.OBJECTID, `road-${index}`),
      // A section "name" is often just its file number again; keep real names only.
      name: name && name !== file && /[A-Za-z]{3}/.test(name) ? titleCase(name) : null,
      tenure,
      fsr: tenure?.toLowerCase() === 'forest service road',
      tenureStatus: status,
      retired: status?.toUpperCase() === 'RETIRED',
      holder: text(properties.CLIENT_NAME),
    }
  })
}

export interface CardText {
  title: string
  lines: string[]
  caution?: string
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

/** Years since harvest started. Young blocks are open forage; older ones have closed in. */
export type CutblockAge = 'fresh' | 'young' | 'regrowing' | 'old' | 'unknown'

export const CUTBLOCK_AGE_LABELS: Record<CutblockAge, string> = {
  fresh: '0–5 years',
  young: '6–15 years',
  regrowing: '16–30 years',
  old: 'Over 30 years',
  unknown: 'Year unknown',
}

export const CUTBLOCK_AGE_COLORS: Record<CutblockAge, string> = {
  fresh: '#dc2626',
  young: '#f59e0b',
  regrowing: '#84cc16',
  old: '#15803d',
  unknown: '#64748b',
}

export function cutblockAge(harvestYear: number | null, currentYear: number): CutblockAge {
  if (harvestYear == null) return 'unknown'
  const age = currentYear - harvestYear
  if (age <= 5) return 'fresh'
  if (age <= 15) return 'young'
  if (age <= 30) return 'regrowing'
  return 'old'
}

export interface CutblockProperties {
  id: string
  harvestYear: number | null
  age: CutblockAge
  areaHa: number | null
  clearcutPercent: number | null
  source: string | null
}

export function parseCutblocks(payload: unknown, currentYear: number): LayerAnswer<CutblockProperties> {
  return answer(payload, 'cutblocks', 'polygon', (properties, index) => {
    const harvestYear = year(properties.HARVEST_START_YEAR_CALENDAR)
    const area = number(properties.FEATURE_AREA_SQM)
    return {
      id: key(properties.VCCB_SYSID, `block-${index}`),
      harvestYear,
      age: cutblockAge(harvestYear, currentYear),
      areaHa: area != null ? Math.round(area / 1000) / 10 : null,
      clearcutPercent: number(properties.PERCENT_CLEARCUT),
      source: text(properties.DATA_SOURCE),
    }
  })
}

export function describeCutblock(properties: Partial<CutblockProperties>, currentYear: number): CardText {
  const harvestYear = properties.harvestYear ?? null
  const lines: string[] = []
  if (harvestYear != null) {
    const age = currentYear - harvestYear
    lines.push(age <= 0 ? 'Harvested this year' : `${age} year${age === 1 ? '' : 's'} since harvest started`)
  }
  if (properties.areaHa != null) lines.push(`${properties.areaHa.toLocaleString()} ha`)
  if (properties.clearcutPercent != null && properties.clearcutPercent < 100)
    lines.push(`${properties.clearcutPercent}% clearcut`)
  if (properties.source) lines.push(`Source: ${properties.source}`)
  return { title: harvestYear != null ? `Cutblock, harvested ${harvestYear}` : 'Cutblock, year unknown', lines }
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
  return answer(payload, 'recLaunches', 'point', (properties, index) => {
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
  return answer(payload, 'coastalLaunches', 'point', (properties, index) => ({
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
}

export function secureUrl(value: unknown): string | null {
  const url = text(value)
  if (!url || !/^https?:\/\/a100\.gov\.bc\.ca\//i.test(url)) return null
  return url.replace(/^http:/i, 'https:')
}

export function parseDepthCharts(payload: unknown): LayerAnswer<DepthChartProperties> {
  return answer(payload, 'depthCharts', 'polygon', (properties, index) => {
    const name = text(properties.GAZETTED_NAME) ?? text(properties.MAP_TITLE)
    return {
      id: key(properties.OBJECTID, `chart-${index}`),
      lake: name ? titleCase(name) : 'Unnamed lake',
      surveyYear: year(properties.DRAFT_DATE),
      scale: number(properties.MAP_SCALE),
      sheet: number(properties.SHEET_NO),
      sheets: number(properties.NUMBER_OF_MAP_SHEETS),
      pdfUrl: secureUrl(properties.PDF_FILE_URL),
    }
  })
}

/** One lake's scanned chart, sheet by sheet, for the in-app viewer. */
export interface DepthChartSet {
  lake: string
  surveyYear: number | null
  sheets: Array<{ sheet: number; url: string }>
}

/**
 * Every sheet of the chart a clicked sheet belongs to. A large lake is charted
 * on several sheets, each its own polygon; they share a lake name and survey
 * year, which is what groups them here.
 */
export function depthChartSet(charts: DepthChartProperties[], clickedId: string): DepthChartSet | null {
  const clicked = charts.find((chart) => chart.id === clickedId)
  if (!clicked) return null
  const sheets = new Map<number, string>()
  for (const chart of charts) {
    if (chart.lake !== clicked.lake || chart.surveyYear !== clicked.surveyYear || !chart.pdfUrl) continue
    sheets.set(chart.sheet ?? sheets.size + 1, chart.pdfUrl)
  }
  if (sheets.size === 0) return null
  return {
    lake: clicked.lake,
    surveyYear: clicked.surveyYear,
    sheets: [...sheets.entries()].sort(([a], [b]) => a - b).map(([sheet, url]) => ({ sheet, url })),
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
  lines.push(properties.pdfUrl ? 'Click to view the depth chart' : 'No chart file is listed')
  return {
    title: `${properties.lake ?? 'Lake'} depth chart`,
    lines,
    caution: 'Not for navigation. Water levels and bottoms change.',
  }
}

/**
 * Depth bands for the digitized lakes, shallow to deep. A contour polygon is
 * "everything at least this deep", so it takes the colour of the band its own
 * depth starts.
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
  const parsed = answer<DepthContourProperties>(payload, 'depthContours', 'polygon', (properties, index) => {
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
  // Each polygon is "everything at least this deep"; drawn shallow first, the
  // deeper ones land on top, so each band shows only where the next has not begun.
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
  return answer(payload, 'huntZones', 'polygon', (properties, index) => {
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
 * How far a person on foot is likely to see through a stand, guessed from the
 * forest inventory. The classes and their thresholds are a screening rule made
 * for this planner, not a published standard and not checked on the ground:
 *
 * - `open`: no tree cover recorded, trees under 2 m, or crown closure under 10%.
 * - `sparse`: crown closure 10 to 25%, trees 2 m or taller.
 * - `brush`: trees 2 to 6 m with crown closure over 25%. Regrowth at eye
 *   height, which blocks sight more than mature timber does.
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
  return answer(payload, 'stands', 'polygon', (properties, index) => {
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

// ---------------------------------------------------------------------------
// The one network call

export async function fetchBcLayer(
  layer: BcLayerId,
  bounds: Bounds | undefined,
  signal?: AbortSignal,
  extraFilter?: string,
): Promise<unknown> {
  const response = await fetch(bcLayerUrl(layer, bounds, extraFilter), { signal })
  return readWfsResponse(response)
}

async function readWfsResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`DataBC answered ${response.status}`)
  const payload: unknown = await response.json()
  if ((payload as { exceptions?: unknown } | null)?.exceptions) throw new Error('DataBC refused the query')
  return payload
}

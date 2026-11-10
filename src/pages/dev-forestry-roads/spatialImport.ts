/**
 * One reader for every spatial import in the road workspace, and the rules for what an imported
 * feature becomes.
 *
 * `readSpatialImport` turns GeoJSON, a zipped shapefile, KML or KMZ into WGS84 features, reprojecting
 * from the file's own CRS and keeping each feature's name. `proposeRoles` says what the features can
 * be without asking; anything it cannot settle is the user's choice. `buildSpatialImport` then makes
 * roads, context features and reference features through the same validators a project file passes.
 *
 * No DOM access. shpjs and JSZip are imported when a file first needs them.
 */
import proj4 from 'proj4'
import { CSRS_TOWGS84, crsDefinition, csrsUtmZone } from '@/lib/geo/projectedCrs'
import { importExistingRoads } from './existingRoads'
import { importHarvestHistory } from './harvestHistory'
import { withAddedAlignments } from './investigationWorkspace'
import { importAlignmentGeoJson, importContextGeoJson, parseProject } from './project'
import { parseReferenceFeatures, type ReferenceFeature } from './referenceFeatures'
import { kmzDocument, parseKml } from './surveyInterchange'
import type { Alignment, ContextFeature, RoadProject } from './types'

/** The `accept` list of every spatial file picker. */
export const SPATIAL_ACCEPT = '.geojson,.json,.zip,.kml,.kmz,application/geo+json,application/json'
/** The formats, as a message names them. */
export const SPATIAL_FORMATS = 'GeoJSON (.geojson or .json), a zipped shapefile (.zip), KML or KMZ'
export const MAX_SPATIAL_FILE_BYTES = 120_000_000
export const MAX_SPATIAL_FEATURES = 500
export const MAX_SPATIAL_VERTICES = 50_000
const MAX_ROADS = 20
const MAX_NAME = 200

export type SpatialShape = 'point' | 'line' | 'polygon'
export type SpatialFormat = 'GeoJSON' | 'zipped shapefile' | 'KML' | 'KMZ'
export interface SpatialFile {
  fileName: string
  format: SpatialFormat
  /** The CRS the coordinates were read in, for the person to check: "EPSG:3157 (NAD83(CSRS) / UTM zone 10N)". */
  crs: string
  /** WGS84 longitude/latitude features; `properties.name` holds each feature's name when it has one. */
  collection: GeoJSON.FeatureCollection
}

/** A message for the person importing: it names the file and says what to do. */
export class SpatialImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpatialImportError'
  }
}
function fail(message: string): never {
  throw new SpatialImportError(message)
}

// --- coordinate reference systems -----------------------------------------------------------------

type ToWgs84 = (xy: [number, number]) => [number, number]
interface SourceCrs {
  label: string
  /** Null when the coordinates already are WGS84 longitude/latitude. */
  toWgs84: ToWgs84 | null
}
const WGS84: SourceCrs = { label: 'WGS84 longitude/latitude', toWgs84: null }

const EPSG_NAMES = (epsg: number): string => {
  if (epsg === 3005) return 'NAD83 / BC Albers'
  if (epsg === 3857) return 'Web Mercator'
  const csrs = csrsUtmZone(epsg)
  if (csrs !== null) return `NAD83(CSRS) / UTM zone ${csrs}N`
  if (epsg >= 26901 && epsg <= 26923) return `NAD83 / UTM zone ${epsg - 26900}N`
  if (epsg >= 32601 && epsg <= 32660) return `WGS84 / UTM zone ${epsg - 32600}N`
  if (epsg >= 32701 && epsg <= 32760) return `WGS84 / UTM zone ${epsg - 32700}S`
  return ''
}

/** A CRS the workspace has its own definition for, so imports and terrain share one transformation. */
function knownCrs(epsg: number): SourceCrs | null {
  // NAD83 and NAD83(CSRS) longitude/latitude: within about 2 m of WGS84; CSRS takes the pinned shift.
  if (epsg === 4326 || epsg === 4269) return WGS84
  const definition = epsg === 4617 ? `+proj=longlat +ellps=GRS80 ${CSRS_TOWGS84} +no_defs` : crsDefinition(epsg)
  if (!definition) return null
  const projection = proj4(definition, 'EPSG:4326')
  const name = epsg === 4617 ? 'NAD83(CSRS) longitude/latitude' : EPSG_NAMES(epsg)
  return {
    label: `EPSG:${epsg}${name ? ` (${name})` : ''}`,
    toWgs84: (xy) => projection.forward(xy) as [number, number],
  }
}

const CSRS_UTM_EPSG = (zone: number): number | null =>
  zone >= 7 && zone <= 10
    ? 3147 + zone
    : zone >= 11 && zone <= 13
      ? 2944 + zone
      : zone >= 14 && zone <= 16
        ? 3144 + zone
        : null

/** The EPSG code a projection file means, from its authority tag or from its UTM/Albers parameters. */
export function epsgFromPrj(wkt: string): number | null {
  const tagged = /(?:AUTHORITY\["EPSG",\s*"?(\d+)"?\]|ID\["EPSG",\s*(\d+)\])\s*\]\s*$/i.exec(wkt.trim())
  if (tagged) return Number(tagged[1] ?? tagged[2])
  let p: Record<string, unknown>
  try {
    p = proj4.Proj(wkt) as unknown as Record<string, unknown>
  } catch {
    return null
  }
  const number = (key: string) => (typeof p[key] === 'number' ? (p[key] as number) : NaN)
  const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance
  const datum = `${String(p.datumCode ?? '')} ${String(p.datumName ?? '')} ${String(p.name ?? '')}`.toLowerCase()
  const csrs = /csrs/.test(datum),
    nad83 = /north_american_1983|nad_?83|nad83/.test(datum),
    wgs84 = /wgs_?84|wgs_1984/.test(datum)
  const projection = String(p.projName ?? '').toLowerCase()
  const degrees = (number('long0') * 180) / Math.PI
  if (
    /transverse_mercator|tmerc|utm/.test(projection) &&
    near(number('k0'), 0.9996) &&
    near(number('x0'), 500000, 1e-3)
  ) {
    const zone = (degrees + 183) / 6
    if (!near(zone, Math.round(zone), 1e-6) || !near(number('lat0'), 0)) return null
    const north = near(number('y0'), 0, 1e-3)
    if (csrs && north) return CSRS_UTM_EPSG(Math.round(zone))
    if (nad83 && north) return 26900 + Math.round(zone)
    if (wgs84) return (north ? 32600 : 32700) + Math.round(zone)
    return null
  }
  if (
    /albers/.test(projection) &&
    nad83 &&
    !csrs &&
    near(degrees, -126) &&
    near((number('lat0') * 180) / Math.PI, 45) &&
    near(number('x0'), 1_000_000, 1e-3)
  )
    return 3005
  return null
}

function crsFromPrj(wkt: string, fileName: string): SourceCrs {
  const epsg = epsgFromPrj(wkt)
  const known = epsg === null ? null : knownCrs(epsg)
  if (known) return known
  const name = /^\s*[A-Z_]+\["([^"]+)"/.exec(wkt)?.[1] ?? 'unnamed CRS'
  try {
    if (/^\s*GEOG(CS|CRS)\[/i.test(wkt) && !/CSRS/i.test(wkt)) return { ...WGS84, label: `${name} longitude/latitude` }
    const projection = proj4(wkt, 'EPSG:4326')
    return { label: name, toWgs84: (xy) => projection.forward(xy) as [number, number] }
  } catch {
    return fail(
      `${fileName} uses a coordinate system this import cannot read (${name}). Save it in WGS84 or a UTM zone and import it again.`,
    )
  }
}

function crsFromGeoJson(root: Record<string, unknown>, fileName: string): SourceCrs {
  if (root.crs == null) return WGS84
  const crs = root.crs as { type?: unknown; properties?: { name?: unknown } }
  const name = typeof crs.properties?.name === 'string' ? crs.properties.name : ''
  if (/CRS84$/i.test(name)) return WGS84
  const code = /EPSG:{1,2}(\d+)$/i.exec(name)
  const known = code ? knownCrs(Number(code[1])) : null
  return (
    known ??
    fail(
      `${fileName} is in a coordinate system this import cannot read (${name || 'unnamed CRS'}). Save it in WGS84 (EPSG:4326), BC Albers or a UTM zone and import it again.`,
    )
  )
}

// --- reading --------------------------------------------------------------------------------------

type Readable = { name?: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

const SHAPES: Record<string, SpatialShape> = {
  Point: 'point',
  MultiPoint: 'point',
  LineString: 'line',
  MultiLineString: 'line',
  Polygon: 'polygon',
  MultiPolygon: 'polygon',
}
export const shapeOf = (feature: GeoJSON.Feature): SpatialShape => SHAPES[feature.geometry.type]

const NAME_KEYS = ['name', 'label', 'title', 'gnis_name']
/**
 * The feature's own name: a `name`, `NAME` or `Name` attribute first, then a label or title. A
 * feature with none of those and exactly one text attribute (a lot number, say) is named by it.
 */
export function spatialFeatureName(properties: Record<string, unknown> | null | undefined): string | null {
  if (!properties) return null
  const keys = Object.keys(properties)
  for (const wanted of NAME_KEYS) {
    // An exact `name` wins over `NAME` when a file carries both.
    const key = keys.find((k) => k === wanted) ?? keys.find((k) => k.toLowerCase() === wanted)
    if (!key) continue
    const value = properties[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, MAX_NAME)
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  if (keys.some((k) => NAME_KEYS.includes(k.toLowerCase()))) return null
  const texts = keys.filter((k) => typeof properties[k] === 'string' && (properties[k] as string).trim())
  return texts.length === 1 && keys.length === 1 ? (properties[texts[0]] as string).trim().slice(0, MAX_NAME) : null
}

/**
 * A feature whose heights are measurements in a named datum: the project's own GeoJSON export
 * writes `referenceVerticalDatum` on a 3D line or area. A section component anchored to it takes
 * its level from those heights, so they are kept; a height that names no datum is not.
 */
const statesVerticalDatum = (feature: GeoJSON.Feature) => {
  const datum = (feature.properties as Record<string, unknown> | null)?.referenceVerticalDatum
  return typeof datum === 'string' && datum.trim() !== ''
}

/**
 * Every position of a geometry, mapped through `change`. Heights and measures are dropped unless
 * `keepHeights` asks for the third coordinate, which passes through untouched.
 */
function mapPositions(
  geometry: GeoJSON.Geometry,
  change: (xy: [number, number]) => number[],
  keepHeights = false,
): GeoJSON.Geometry {
  const walk = (value: unknown): unknown =>
    Array.isArray(value) && typeof value[0] === 'number'
      ? [
          ...change([value[0] as number, value[1] as number]),
          ...(keepHeights && typeof value[2] === 'number' && Number.isFinite(value[2]) ? [value[2] as number] : []),
        ]
      : Array.isArray(value)
        ? value.map(walk)
        : value
  return { ...geometry, coordinates: walk((geometry as GeoJSON.Point).coordinates) } as GeoJSON.Geometry
}

/** Every position of a geometry, in order. */
function positions(geometry: GeoJSON.Geometry): number[][] {
  const out: number[][] = []
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number') out.push(value as number[])
    else value.forEach(walk)
  }
  walk((geometry as GeoJSON.Point).coordinates)
  return out
}
const isLonLat = (xy: number[], maxLatitude: number) =>
  Number.isFinite(xy[0]) && Number.isFinite(xy[1]) && Math.abs(xy[0]) <= 180 && Math.abs(xy[1]) <= maxLatitude

/** Features with drawable geometry from any GeoJSON root; geometry collections become one feature per part. */
function flatten(input: unknown): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = []
  const visit = (node: unknown, properties: Record<string, unknown>, id: unknown) => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, {}, undefined))
    if (!node || typeof node !== 'object') return
    const item = node as Record<string, unknown>
    if (item.type === 'FeatureCollection' && Array.isArray(item.features))
      item.features.forEach((feature) => visit(feature, {}, undefined))
    else if (item.type === 'Feature')
      visit(
        item.geometry,
        item.properties && typeof item.properties === 'object' && !Array.isArray(item.properties)
          ? (item.properties as Record<string, unknown>)
          : {},
        item.id,
      )
    else if (item.type === 'GeometryCollection' && Array.isArray(item.geometries))
      item.geometries.forEach((child) => visit(child, properties, id))
    else if (typeof item.type === 'string' && item.type in SHAPES && Array.isArray(item.coordinates))
      out.push({
        type: 'Feature',
        ...(typeof id === 'string' || typeof id === 'number' ? { id } : {}),
        properties: { ...properties },
        geometry: item as unknown as GeoJSON.Geometry,
      })
  }
  visit(input, {}, undefined)
  return out
}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5)

async function readShapefileZip(bytes: Uint8Array, fileName: string, keepHeights: boolean) {
  const [{ default: JSZip }, shpjs] = await Promise.all([import('jszip'), import('shpjs')])
  const zip = await JSZip.loadAsync(bytes).catch(() =>
    fail(`${fileName} is not a readable zip file. Use ${SPATIAL_FORMATS}.`),
  )
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.includes('__MACOSX'))
  if (entries.some((entry) => /\.kml$/i.test(entry.name)) && !entries.some((entry) => /\.shp$/i.test(entry.name)))
    return null
  const layers = entries.filter((entry) => /\.shp$/i.test(entry.name))
  if (!layers.length)
    fail(
      `${fileName} holds no shapefile (.shp) or KML. Zip the .shp, .shx, .dbf and .prj files of one layer together, or use ${SPATIAL_FORMATS}.`,
    )
  const sibling = (shp: string, extension: string) => {
    const wanted = `${shp.slice(0, -4)}.${extension}`.toLowerCase()
    return entries.find((entry) => entry.name.toLowerCase() === wanted)
  }
  const features: GeoJSON.Feature[] = []
  const labels = new Set<string>()
  for (const layer of layers) {
    const prj = await sibling(layer.name, 'prj')?.async('string')
    const dbf = await sibling(layer.name, 'dbf')?.async('uint8array')
    const cpg = await sibling(layer.name, 'cpg')?.async('string')
    let geometries: GeoJSON.Geometry[], rows: Record<string, unknown>[]
    try {
      geometries = shpjs.parseShp(await layer.async('uint8array'))
      rows = dbf ? shpjs.parseDbf(dbf, cpg) : []
    } catch {
      return fail(
        `${fileName} holds a shapefile that could not be read (${layer.name}). Export it again and re-zip it.`,
      )
    }
    const raw = geometries.map(
      (geometry, index): GeoJSON.Feature => ({
        type: 'Feature',
        properties: { ...(rows[index] ?? {}) },
        geometry,
      }),
    )
    const crs = prj ? crsFromPrj(prj, fileName) : null
    if (!crs) {
      if (!raw.every((feature) => positions(feature.geometry).every((xy) => isLonLat(xy, 90))))
        fail(
          `${fileName} has no .prj file, so its coordinate system is unknown. Add the layer's .prj to the zip and import it again.`,
        )
      labels.add('no .prj; coordinates read as WGS84 longitude/latitude')
    } else labels.add(crs.label)
    const change = crs?.toWgs84
    features.push(
      ...flatten(raw).map((feature) => ({
        ...feature,
        geometry: mapPositions(feature.geometry, (xy) => (change ? change(xy) : xy), keepHeights),
      })),
    )
  }
  return { features, crs: [...labels].join('; ') }
}

/**
 * Reads a spatial file into WGS84 features. The format comes from the file's content, not its name,
 * so a KMZ renamed `.zip` or a shapefile handed to a GeoJSON picker still reads; anything else is
 * refused with a message naming the file and the formats accepted.
 */
export async function readSpatialImport(
  file: Readable,
  {
    keepHeights = false,
  }: {
    /**
     * Keep every third coordinate, for breaklines. Without it only a GeoJSON feature that states
     * its vertical datum keeps its heights. KML altitude is never kept.
     */
    keepHeights?: boolean
  } = {},
): Promise<SpatialFile> {
  const fileName = (file.name ?? 'This file').slice(0, MAX_NAME)
  if (file.size > MAX_SPATIAL_FILE_BYTES)
    fail(`${fileName} is over 120 MB. Crop it to the area of the job and import it again.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let format: SpatialFormat, crs: string, features: GeoJSON.Feature[]
  if (isZip(bytes)) {
    const shapefile = await readShapefileZip(bytes, fileName, keepHeights)
    if (shapefile) {
      format = 'zipped shapefile'
      ;({ features, crs } = shapefile)
    } else {
      format = 'KMZ'
      crs = WGS84.label
      features = kml(await kmzDocument(bytes).catch((error: Error) => fail(`${fileName}: ${error.message}`)), fileName)
    }
  } else {
    // TextDecoder drops a leading byte-order mark.
    const text = new TextDecoder().decode(bytes)
    const start = text.trimStart()[0]
    if (start === '<') {
      format = 'KML'
      crs = WGS84.label
      features = kml(text, fileName)
    } else if (start === '{' || start === '[') {
      format = 'GeoJSON'
      let root: unknown
      try {
        root = JSON.parse(text)
      } catch {
        return fail(`${fileName} is not valid GeoJSON. This import reads ${SPATIAL_FORMATS}.`)
      }
      const object = root && typeof root === 'object' && !Array.isArray(root) ? (root as Record<string, unknown>) : {}
      if (object.schema === 'pgmaps-road-project-v1')
        fail(`${fileName} is a road project file, not a layer. Open it with Open in the header.`)
      const source = crsFromGeoJson(object, fileName)
      crs = source.label
      features = flatten(root).map((feature) => ({
        ...feature,
        geometry: mapPositions(
          feature.geometry,
          (xy) => (source.toWgs84 ? source.toWgs84(xy) : xy),
          keepHeights || statesVerticalDatum(feature),
        ),
      }))
    } else if (/\.(shp|shx|dbf|prj|cpg)$/i.test(fileName))
      return fail(
        `${fileName} is one part of a shapefile. Zip its .shp, .shx, .dbf and .prj files together and import the .zip.`,
      )
    else return fail(`${fileName} is not a file this import can read. Use ${SPATIAL_FORMATS}.`)
  }
  if (!features.length) fail(`${fileName} has no point, line or polygon features to import.`)
  if (features.length > MAX_SPATIAL_FEATURES)
    fail(
      `${fileName} has ${features.length.toLocaleString('en-CA')} features; one import takes at most ${MAX_SPATIAL_FEATURES}. Crop it to the area of the job and import it again.`,
    )
  let vertices = 0
  for (const feature of features) {
    const points = positions(feature.geometry)
    vertices += points.length
    // The project keeps latitudes strictly inside ±85°, the limit of its Web Mercator plan.
    if (!points.every((xy) => isLonLat(xy, 85) && Math.abs(xy[1]) < 85))
      fail(
        format === 'GeoJSON'
          ? `${fileName} holds coordinates that are not longitude/latitude and names no CRS. Save it in WGS84 (EPSG:4326) and import it again.`
          : `${fileName} holds coordinates outside the longitude/latitude range after reprojection. Check the file's coordinate system.`,
      )
  }
  if (vertices > MAX_SPATIAL_VERTICES)
    fail(
      `${fileName} has ${vertices.toLocaleString('en-CA')} vertices; one import takes at most ${MAX_SPATIAL_VERTICES.toLocaleString('en-CA')}. Crop or simplify it and import it again.`,
    )
  return {
    fileName,
    format,
    crs,
    collection: {
      type: 'FeatureCollection',
      features: features.map((feature) => {
        const properties = { ...(feature.properties ?? {}) }
        const name = spatialFeatureName(properties)
        if (name) properties.name = name
        else delete properties.name
        return { ...feature, properties }
      }),
    },
  }
}

function kml(text: string, fileName: string): GeoJSON.Feature[] {
  try {
    return flatten(parseKml(text)).map((feature) => {
      // `parseKml` numbers unnamed placemarks; a name the file never gave is not the feature's name.
      const properties = { ...(feature.properties ?? {}) }
      if (typeof properties.name === 'string' && /^KML feature \d+$/.test(properties.name)) delete properties.name
      return { ...feature, properties }
    })
  } catch (error) {
    return fail(`${fileName} could not be read as KML: ${error instanceof Error ? error.message : 'unknown structure'}`)
  }
}

// --- what a feature becomes -----------------------------------------------------------------------

export type ImportRole =
  | 'road'
  | 'mapped-road'
  | 'stream'
  | 'planned-block'
  | 'harvested-block'
  | 'constraint'
  | 'reference'
  | 'skip'
/** The picker a file came through. It only sets what is offered first; the features decide the rest. */
export type ImportIntent = 'road' | 'mapped-road' | 'streams' | 'cutblocks' | 'reference'
export type RoleChoice = Record<SpatialShape, ImportRole | null>

export interface RoleOption {
  role: ImportRole
  label: string
  /** What choosing it does to the design. */
  effect: string
}
export const ROLE_OPTIONS: Record<SpatialShape, RoleOption[]> = {
  line: [
    { role: 'road', label: 'Road to design', effect: 'Each line becomes a road with a control at every vertex.' },
    {
      role: 'mapped-road',
      label: 'Existing road',
      effect: 'Listed under Existing roads & reuse. Not designed or priced until you load it as a road.',
    },
    {
      role: 'stream',
      label: 'Stream',
      effect: 'Adds a crossing wherever a road meets it and a riparian screen that route search keeps out of.',
    },
    { role: 'reference', label: 'Reference line', effect: 'Drawn and listed only. Nothing is priced or avoided.' },
    { role: 'skip', label: 'Leave out', effect: 'Not imported.' },
  ],
  polygon: [
    { role: 'planned-block', label: 'Planned cutblock', effect: 'A block to build access to.' },
    {
      role: 'harvested-block',
      label: 'Harvested cutblock',
      effect: 'Harvest history. Dates come from the file when it carries them.',
    },
    {
      role: 'constraint',
      label: 'Avoidance area',
      effect: 'Excluded from route search until you change its treatment under Constraints.',
    },
    { role: 'reference', label: 'Reference area', effect: 'Drawn and listed only. Nothing is priced or avoided.' },
    { role: 'skip', label: 'Leave out', effect: 'Not imported.' },
  ],
  point: [
    {
      role: 'reference',
      label: 'Named point',
      effect: 'Drawn with its name. A road can start or end on it.',
    },
    { role: 'skip', label: 'Leave out', effect: 'Not imported.' },
  ],
}

const EXPORT_ONLY = new Set([
  'crossing-review',
  'culvert',
  'borrow-site',
  'waste-site',
  'geometric-dline',
  'terrain-profile',
])

/**
 * What the file itself says a feature is: the `kind` a PGMaps export writes, or evidence only one
 * kind of feature carries. Null when the file does not say, which is the usual case.
 */
export function statedRole(feature: GeoJSON.Feature): ImportRole | null {
  const p = (feature.properties ?? {}) as Record<string, unknown>
  const shape = shapeOf(feature)
  const proposed = (p.harvestEvidence as { status?: unknown } | undefined)?.status === 'proposed'
  if (typeof p.kind === 'string') {
    if (EXPORT_ONLY.has(p.kind)) return 'skip'
    if (p.kind === 'alignment' && shape === 'line') return 'road'
    if (p.kind === 'stream' && shape === 'line') return 'stream'
    if (p.kind === 'existing-road' && shape === 'line') return 'mapped-road'
    if (p.kind === 'avoid' && shape === 'polygon') return 'constraint'
    if (p.kind === 'harvest' && shape === 'polygon') return proposed ? 'planned-block' : 'harvested-block'
    if (p.kind === 'reference') return 'reference'
  }
  if (shape === 'polygon') {
    if (p.harvestEvidence && typeof p.harvestEvidence === 'object')
      return proposed ? 'planned-block' : 'harvested-block'
    if (p.VCCB_SYSID != null || 'HARVEST_START_YEAR_CALENDAR' in p || 'HARVEST_MID_YEAR_CALENDAR' in p)
      return 'harvested-block'
  }
  if (shape === 'line') {
    if (p.roadEvidence && typeof p.roadEvidence === 'object') return 'mapped-road'
    if (p.streamAssessment != null || p.streamSource != null || typeof p.riparianClass === 'string') return 'stream'
  }
  return null
}

const word = (pattern: string) => new RegExp(`(^|[^a-z])(${pattern})([^a-z]|$)`, 'i')
const STREAM_WORDS = word('streams?|creeks?|rivers?|brooks?|hydro|watercourses?')
const ROAD_WORDS = word('roads?|rd|rds|spurs?|fsr|mainline|alignment|centre ?line|center ?line|cl')
const BLOCK_WORDS = word('blocks?|cutblocks?|cut blocks?|openings?|cp')
const STREAM_KEYS = ['linear_feature_id', 'blue_line_key', 'stream_order', 'fwa_watershed_code', 'gnis_name']

const fileStem = (fileName: string) => fileName.replace(/\.[^.]+$/, '')
const says = (feature: GeoJSON.Feature, fileName: string, words: RegExp) => {
  const p = (feature.properties ?? {}) as Record<string, unknown>
  return [fileStem(fileName), p.name, p.description, p.type, p.TYPE, p.FEATURE_TYPE].some(
    (value) => typeof value === 'string' && words.test(value),
  )
}
/** Stream data by its own attributes (Freshwater Atlas keys) or by what the file or feature is called. */
const looksLikeStream = (feature: GeoJSON.Feature, fileName: string) =>
  Object.keys(feature.properties ?? {}).some((key) => STREAM_KEYS.includes(key.toLowerCase())) ||
  says(feature, fileName, STREAM_WORDS)

/**
 * The stated kinds each picker brings in. A picker with one purpose takes only its own, so an
 * exported project given to the road picker adds its roads and not a second copy of its streams;
 * the streams import is the general one and takes every kind of context. Roads come in only
 * through a road picker.
 */
const STATED_BY_INTENT: Record<ImportIntent, ReadonlySet<ImportRole>> = {
  road: new Set<ImportRole>(['road']),
  'mapped-road': new Set<ImportRole>(['mapped-road']),
  cutblocks: new Set<ImportRole>(['planned-block', 'harvested-block']),
  reference: new Set<ImportRole>(['reference']),
  streams: new Set<ImportRole>([
    'stream',
    'constraint',
    'mapped-road',
    'planned-block',
    'harvested-block',
    'reference',
  ]),
}
/** The role a feature states, when this picker takes it; `'skip'` when it states one the picker does not. */
function statedFor(feature: GeoJSON.Feature, intent: ImportIntent | undefined): ImportRole | null {
  const role = statedRole(feature)
  return role === null || !intent || STATED_BY_INTENT[intent].has(role) ? role : 'skip'
}

export interface SpatialInventory {
  /** Features the user's choice applies to, by shape. */
  open: Record<SpatialShape, GeoJSON.Feature[]>
  /** Features whose role the file states, by role; `kept` is false for a kind this picker leaves out. */
  stated: Array<{ role: ImportRole; features: GeoJSON.Feature[]; kept: boolean }>
}
export function spatialInventory(file: SpatialFile, intent?: ImportIntent): SpatialInventory {
  const open: SpatialInventory['open'] = { point: [], line: [], polygon: [] }
  const stated = new Map<ImportRole, GeoJSON.Feature[]>()
  for (const feature of file.collection.features) {
    const role = statedRole(feature)
    if (role) stated.set(role, [...(stated.get(role) ?? []), feature])
    else open[shapeOf(feature)].push(feature)
  }
  return {
    open,
    stated: [...stated].map(([role, features]) => ({
      role,
      features,
      kept: role !== 'skip' && (!intent || STATED_BY_INTENT[intent].has(role)),
    })),
  }
}

/**
 * The role each shape takes without asking, and whether the person has to choose. A picker with one
 * purpose settles its own shape (a road picker's lines are roads); a file given to the wrong picker,
 * or to the streams import when it does not read as stream data, is always a choice. A null role has
 * no suggestion at all.
 */
export function proposeRoles(file: SpatialFile, intent: ImportIntent): { roles: RoleChoice; ask: boolean } {
  const { open } = spatialInventory(file)
  const roles: RoleChoice = { point: null, line: null, polygon: null }
  let ask = false
  const every = (features: GeoJSON.Feature[], words: RegExp) => features.every((f) => says(f, file.fileName, words))
  const some = (features: GeoJSON.Feature[], words: RegExp) => features.some((f) => says(f, file.fileName, words))
  if (open.point.length) roles.point = 'reference'
  if (open.line.length) {
    const streams = open.line.every((f) => looksLikeStream(f, file.fileName))
    if (intent === 'road') roles.line = 'road'
    else if (intent === 'mapped-road') roles.line = 'mapped-road'
    else if (intent === 'reference') roles.line = 'reference'
    else if (intent === 'streams' && streams) roles.line = 'stream'
    else {
      ask = true
      roles.line = streams
        ? 'stream'
        : some(open.line, ROAD_WORDS)
          ? 'road'
          : open.line.some((f) => looksLikeStream(f, file.fileName))
            ? 'stream'
            : null
    }
  }
  if (open.polygon.length) {
    if (intent === 'reference') roles.polygon = 'reference'
    else {
      // Planned or harvested is never in a plain polygon, so even the cutblock picker asks.
      ask = true
      roles.polygon = intent === 'cutblocks' || every(open.polygon, BLOCK_WORDS) ? 'planned-block' : null
    }
  }
  return { roles, ask }
}

export interface CreatedGroup {
  role: Exclude<ImportRole, 'skip'>
  shape: SpatialShape
  names: string[]
}
export interface SpatialImportResult {
  alignments: Alignment[]
  /** Streams, avoidance areas, existing roads and cutblocks. */
  context: ContextFeature[]
  reference: ReferenceFeature[]
  created: CreatedGroup[]
  /** Features in the file that were not imported. */
  leftOut: number
  /** One sentence saying where the features came from and what each became. */
  notice: string
}

const ROLE_NOUNS: Record<Exclude<ImportRole, 'skip'>, Partial<Record<SpatialShape, [string, string]>>> = {
  road: { line: ['road', 'roads'] },
  'mapped-road': { line: ['existing road', 'existing roads'] },
  stream: { line: ['stream', 'streams'] },
  'planned-block': { polygon: ['planned cutblock', 'planned cutblocks'] },
  'harvested-block': { polygon: ['harvested cutblock', 'harvested cutblocks'] },
  constraint: { polygon: ['avoidance area', 'avoidance areas'] },
  reference: {
    point: ['named point', 'named points'],
    line: ['reference line', 'reference lines'],
    polygon: ['reference area', 'reference areas'],
  },
}

function describe(group: CreatedGroup): string {
  const [one, many] = ROLE_NOUNS[group.role][group.shape] ?? ['feature', 'features']
  const n = group.names.length
  const shown = group.names.slice(0, 4).join(', ')
  return `${n} ${n === 1 ? one : many} (${shown}${n > 4 ? ` and ${n - 4} more` : ''})`
}

const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })

/** A geometry's single parts: a multi-part feature becomes one feature per part. */
function parts(geometry: GeoJSON.Geometry): Array<GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon> {
  if (geometry.type === 'MultiPoint') return geometry.coordinates.map((c) => ({ type: 'Point', coordinates: c }))
  if (geometry.type === 'MultiLineString')
    return geometry.coordinates.map((c) => ({ type: 'LineString', coordinates: c }))
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }))
  return [geometry as GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon]
}

/**
 * Builds what the chosen roles make of the file. Every feature goes through the validator a project
 * file passes, so an import can never put something in the project that a saved project would refuse.
 * A shape whose role is null is refused: nothing is classified without a choice. With `intent`, a
 * feature that states a kind the picker does not take is left out.
 */
export function buildSpatialImport(file: SpatialFile, roles: RoleChoice, intent?: ImportIntent): SpatialImportResult {
  const stem = fileStem(file.fileName).slice(0, 150) || 'Imported feature'
  const byRole = new Map<
    string,
    { role: Exclude<ImportRole, 'skip'>; shape: SpatialShape; features: GeoJSON.Feature[] }
  >()
  let leftOut = 0
  for (const feature of file.collection.features) {
    const shape = shapeOf(feature)
    const role = statedFor(feature, intent) ?? roles[shape]
    if (role === null)
      throw new SpatialImportError(
        `Choose what the ${shape === 'polygon' ? 'polygons' : `${shape}s`} in ${file.fileName} are before importing.`,
      )
    if (role === 'skip' || !ROLE_NOUNS[role][shape]) {
      leftOut++
      continue
    }
    const key = `${role}|${shape}`
    const group = byRole.get(key) ?? { role, shape, features: [] }
    group.features.push(feature)
    byRole.set(key, group)
  }
  const result: SpatialImportResult = { alignments: [], context: [], reference: [], created: [], leftOut, notice: '' }
  for (const { role, shape, features } of byRole.values()) {
    // An unnamed feature takes the file's name, numbered when the file holds several of its kind.
    const named = features.map((feature, index): GeoJSON.Feature => {
      const properties = { ...(feature.properties ?? {}) }
      if (typeof properties.name !== 'string') properties.name = features.length === 1 ? stem : `${stem} ${index + 1}`
      return { ...feature, properties }
    })
    const tagged = (kind: string, extra: Record<string, unknown> = {}) =>
      collection(named.map((f) => ({ ...f, properties: { ...f.properties, ...extra, kind } })))
    let names: string[]
    if (role === 'road') {
      const roads = importAlignmentGeoJson(
        collection(named.map((f) => ({ ...f, properties: { ...f.properties, kind: 'alignment' } }))),
      )
      result.alignments.push(...roads)
      names = roads.map((road) => road.name)
    } else if (role === 'reference') {
      const made = named.flatMap((feature) => {
        const pieces = parts(feature.geometry)
        return pieces.map((geometry, part) => ({
          name: `${String(feature.properties!.name)}${pieces.length > 1 ? ` (part ${part + 1})` : ''}`.slice(
            0,
            MAX_NAME,
          ),
          geometry,
          source: file.fileName,
        }))
      })
      const checked = parseReferenceFeatures(
        made.map((feature, index) => ({ ...feature, id: `reference-${result.reference.length + index + 1}` })),
      )
      result.reference.push(...checked)
      names = checked.map((feature) => feature.name)
    } else {
      const made =
        role === 'stream'
          ? importContextGeoJson(tagged('stream'))
          : role === 'constraint'
            ? importContextGeoJson(tagged('avoid'))
            : role === 'mapped-road'
              ? importExistingRoads(tagged('existing-road'))
              : importHarvestHistory(
                  collection(
                    named.map((f) => ({
                      ...f,
                      properties: {
                        ...f.properties,
                        kind: 'harvest',
                        ...(role === 'planned-block' && !f.properties!.harvestEvidence
                          ? { harvestEvidence: { source: 'user', status: 'proposed', yearMethod: 'unknown' } }
                          : {}),
                      },
                    })),
                  ),
                )
      result.context.push(...made)
      names = made.map((feature) => feature.name)
    }
    result.created.push({ role, shape, names })
  }
  if (!result.created.length)
    throw new SpatialImportError(
      intent && file.collection.features.some((feature) => statedRole(feature) && statedFor(feature, intent) === 'skip')
        ? `${file.fileName} has nothing this import takes. Bring roads in with Import line on the Design tab, and streams, areas and cutblocks with Streams → Import on the Terrain tab.`
        : `Nothing in ${file.fileName} was chosen to import.`,
    )
  result.notice =
    `Imported ${result.created.map(describe).join('; ')} from ${file.fileName}, read as ${file.crs}.` +
    (leftOut ? ` ${leftOut} feature${leftOut === 1 ? ' was' : 's were'} left out.` : '')
  return result
}

/**
 * The project with an import added. Roads, streams, avoidance areas, existing roads and reference
 * features get fresh IDs; a cutblock keeps its source identity, so importing a file again replaces
 * its blocks instead of stacking copies.
 */
export function applySpatialImport(
  project: RoadProject,
  result: SpatialImportResult,
  newId: () => string,
  year = new Date().getFullYear(),
): RoadProject {
  const roads = result.alignments.map((road) => ({
    ...road,
    id: newId(),
    points: road.points.map((point) => ({ ...point, id: newId() })),
  }))
  const kept = project.alignments.filter((road) => road.id !== project.designPlaceholderId)
  if (kept.length + roads.length > MAX_ROADS)
    throw new SpatialImportError(
      `A project holds at most ${MAX_ROADS} roads; this import would make ${kept.length + roads.length}. Delete a road or import fewer lines.`,
    )
  const context = new Map(project.context.map((feature) => [feature.id, feature]))
  for (const feature of result.context) {
    const added = feature.kind === 'harvest' ? feature : { ...feature, id: newId() }
    context.set(added.id, added)
  }
  const blocks = result.context.some((feature) => feature.kind === 'harvest')
  const reference = [...(project.reference ?? []), ...result.reference.map((feature) => ({ ...feature, id: newId() }))]
  return parseProject({
    ...withAddedAlignments(project, roads),
    context: [...context.values()],
    ...(reference.length ? { reference } : {}),
    ...(blocks ? { harvestHistoryYear: project.harvestHistoryYear ?? year } : {}),
  })
}

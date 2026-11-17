/** Open geographic interchange and projected survey reduction. No inferred vertical datum. */
import { SCALE_FACTOR_LIMITS } from './scaleFactor'
import type { SoftreeStationExtras, SoftreeTraverseDetails, SoftreeTraverseSource } from './softreeTraverse'
import { checkStationEquations, fieldStation, type StationEquation } from './stationEquations'

export interface TraverseLeg {
  id: string
  bearingDegrees: number
  horizontalDistanceM: number
  gradePercent: number
}
export interface TraverseInput {
  start: [number, number, number]
  target?: [number, number, number]
  adjustment: 'none' | 'bowditch'
  legs: TraverseLeg[]
  sideShots?: Array<{ id: string; station: number; offsetM: number; heightDifferenceM: number }>
  /**
   * Combined scale factor (grid ÷ ground) when the horizontal distances and offsets were measured on
   * the ground (`scaleFactor.ts`): each is multiplied by it before it is laid on the grid. Absent,
   * distances are grid distances.
   */
  distanceScale?: number
}
export interface TraverseResult {
  stations: Array<{ id: string; raw: [number, number, number]; adjusted: [number, number, number]; chainage: number }>
  sideShots: Array<{ id: string; coordinate: [number, number, number] }>
  closure: { delta: [number, number, number]; horizontalM: number; ratio: number | null } | null
  lengthM: number
  adjustment: TraverseInput['adjustment']
}
/**
 * What a traverse read from a Softree-format file held that the field book has no field for, kept
 * with the book (lengths in the file's units): labels, ground layers, culverts, HI/HT, side-shot
 * depths, slopes beyond the last side shot, shots that are not legs, and the file as written. The
 * traverse writers (`softreeTraverse.ts`) write back each detail their format has a field for.
 */
export type SurveyBookSoftree = SoftreeTraverseDetails
/** Characters the kept Softree details of one field book may take, as JSON (the file as written included). */
export const MAX_SURVEY_SOFTREE_CHARS = 2_000_000
/** Characters of one kept text field (a label, a ground type, a line of the file as written). */
export const MAX_SURVEY_SOFTREE_TEXT = 10_000
/** Stations' extras, or located points, a field book keeps at most (the traverse readers' record limit). */
export const MAX_SURVEY_SOFTREE_ITEMS = 20_000
/** Largest start station a field book takes, m. */
export const MAX_SURVEY_START_STATION_M = 10_000_000
export interface SurveyBookRecord {
  id: string
  name: string
  epsg: number
  verticalReference: string
  input: TraverseInput
  /** The traverse's first station, m (horizontal distance; 0 when absent). PGMaps' chainage starts at 0. */
  startStation?: number
  /** Back and ahead stations, m: from each back station on, the field names stations from its ahead station. */
  stationEquations?: StationEquation[]
  softree?: SurveyBookSoftree
}
const SOFTREE_FORMATS = new Set(['asc', 'ipd', 'polycorder', 'unit-survey', 'laser-raw'])
/** The calculated station range of a field book: start station plus horizontal (ground) distance. */
export function surveyStationRange(
  input: TraverseInput,
  startStation = 0,
  result: Pick<TraverseResult, 'lengthM'> = reduceTraverse(input),
) {
  return { start: startStation, end: startStation + result.lengthM / (input.distanceScale ?? 1) }
}
/** Throws unless the start station and station equations are valid for the traverse. */
export function checkSurveyStations(
  input: TraverseInput,
  startStation: number | undefined,
  equations: readonly StationEquation[] | undefined,
) {
  if (startStation !== undefined && (!finite(startStation) || Math.abs(startStation) > MAX_SURVEY_START_STATION_M))
    throw Error(`A start station must be a number within ±${MAX_SURVEY_START_STATION_M.toLocaleString('en-CA')} m.`)
  if (equations !== undefined) {
    if (!Array.isArray(equations)) throw Error('Station equations must be a list.')
    checkStationEquations(equations, surveyStationRange(input, startStation ?? 0))
  }
}
/** The field station of a reduced station: start station plus its ground distance, through the equations. */
export function surveyFieldStation(
  chainageM: number,
  book: {
    input: Partial<TraverseInput>
    startStation?: number
    stationEquations?: readonly StationEquation[]
  },
) {
  return fieldStation(
    (book.startStation ?? 0) + chainageM / (book.input.distanceScale ?? 1),
    book.stationEquations ?? [],
  )
}
const SOURCE_FORMATS = new Set(['asc', 'ipd', 'polycorder', 'unit-survey'])
const SOURCE_ROLES = new Set(['station', 'shot', 'start', 'leg', 'side', 'other'])
const LINE_ENDS = new Set(['\r\n', '\n', '\r'])
const VERTICALS = new Set(['inclination', 'zenith', 'slope-percent', 'elevation', 'elevation-difference'])
const optionalNumber = (v: unknown) => v === undefined || v === null || finite(v)
const shortText = (v: unknown, max = MAX_SURVEY_SOFTREE_TEXT) => typeof v === 'string' && v.length <= max
const optionalText = (v: unknown) => v === undefined || shortText(v)
function checkExtras(e: SoftreeStationExtras): boolean {
  if (!e || typeof e !== 'object' || !Number.isInteger(e.station) || e.station < 0) return false
  if (!optionalText(e.label) || !optionalText(e.label2)) return false
  if (![e.hi, e.ht, e.backshot].every(optionalNumber)) return false
  if (
    e.ground !== undefined &&
    !(
      Array.isArray(e.ground) &&
      e.ground.length <= 3 &&
      e.ground.every((g) => g && shortText(g.type, 100) && optionalNumber(g.depth))
    )
  )
    return false
  const c = e.culvert
  if (
    c !== undefined &&
    !(
      c &&
      typeof c === 'object' &&
      [c.sizeY, c.sizeX, c.gradientPercent, c.azimuth, c.flag, c.sd].every(optionalNumber) &&
      optionalText(c.raw)
    )
  )
    return false
  if (
    e.sideShots !== undefined &&
    !(
      Array.isArray(e.sideShots) &&
      e.sideShots.length <= 100 &&
      e.sideShots.every(
        (x) =>
          x &&
          (x.side === 'left' || x.side === 'right') &&
          Number.isInteger(x.n) &&
          x.n >= 1 &&
          x.n <= 25 &&
          Array.isArray(x.depths) &&
          x.depths.length <= 2 &&
          x.depths.every(optionalNumber) &&
          optionalText(x.code),
      )
    )
  )
    return false
  const ext = e.extensionSlope
  return (
    ext === undefined || (!!ext && typeof ext === 'object' && optionalNumber(ext.left) && optionalNumber(ext.right))
  )
}
function checkSource(s: SoftreeTraverseSource): boolean {
  if (!s || typeof s !== 'object' || !SOURCE_FORMATS.has(s.format)) return false
  const l = s.layout
  if (!l || !LINE_ENDS.has(l.lineEnd) || typeof l.finalLineEnd !== 'boolean' || typeof l.bom !== 'boolean') return false
  if (!Array.isArray(s.head) || s.head.length > 2 || !s.head.every((h) => shortText(h))) return false
  if (
    !Array.isArray(s.records) ||
    s.records.length > MAX_TRAVERSE_FILE_RECORDS ||
    !s.records.every(
      (r) =>
        r &&
        shortText(r.line) &&
        (r.station === undefined || (Number.isInteger(r.station) && r.station >= 0)) &&
        (r.role === undefined || SOURCE_ROLES.has(r.role)),
    )
  )
    return false
  if (!finite(s.startStation) || !Array.isArray(s.equations)) return false
  try {
    reduceTraverse(s.input)
    checkStationEquations(s.equations)
  } catch {
    return false
  }
  if (s.vertical !== undefined && !VERTICALS.has(s.vertical)) return false
  if (s.distance !== undefined && s.distance !== 'slope' && s.distance !== 'horizontal') return false
  if (!optionalText(s.survey)) return false
  const names = (v: unknown) =>
    v === undefined || (Array.isArray(v) && v.length <= 2_001 && v.every((x) => shortText(x, 200)))
  const indexes = (v: unknown) =>
    v === undefined || (Array.isArray(v) && v.length <= 2_001 && v.every((x) => Number.isInteger(x) && x >= -1))
  return names(s.pointNames) && indexes(s.labelRecords) && indexes(s.heightRecords)
}
/** Records a kept traverse file holds at most (the traverse readers' limit). */
const MAX_TRAVERSE_FILE_RECORDS = 20_000
function checkSoftree(value: unknown) {
  const v = value as SurveyBookSoftree
  if (
    !v ||
    typeof v !== 'object' ||
    !SOFTREE_FORMATS.has(v.sourceFormat) ||
    !finite(v.unitM) ||
    v.unitM <= 0 ||
    !Array.isArray(v.extras) ||
    v.extras.length > MAX_SURVEY_SOFTREE_ITEMS ||
    !v.extras.every(checkExtras) ||
    !Array.isArray(v.points) ||
    v.points.length > MAX_SURVEY_SOFTREE_ITEMS ||
    !v.points.every(
      (p) =>
        p &&
        shortText(p.id, 200) &&
        shortText(p.from, 200) &&
        (p.station === undefined || (Number.isInteger(p.station) && p.station >= 0)) &&
        Array.isArray(p.coordinate) &&
        p.coordinate.length === 3 &&
        p.coordinate.every(finite),
    ) ||
    (v.source !== undefined && !checkSource(v.source)) ||
    JSON.stringify(v).length > MAX_SURVEY_SOFTREE_CHARS
  )
    throw Error('Invalid Softree traverse details in a survey field book.')
}
export function parseSurveyBooks(raw: unknown): SurveyBookRecord[] {
  if (!Array.isArray(raw) || raw.length > 20) throw Error('A project supports at most 20 survey field books.')
  const ids = new Set<string>()
  for (const r of raw as SurveyBookRecord[]) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id ||
      r.id.length > 100 ||
      ids.has(r.id) ||
      typeof r.name !== 'string' ||
      r.name.length > 200 ||
      !Number.isInteger(r.epsg) ||
      r.epsg < 1 ||
      r.epsg > 100000 ||
      typeof r.verticalReference !== 'string' ||
      !r.verticalReference.trim() ||
      r.verticalReference.length > 300
    )
      throw Error('Invalid survey field-book record.')
    reduceTraverse(r.input)
    checkSurveyStations(r.input, r.startStation, r.stationEquations)
    if (r.softree !== undefined) checkSoftree(r.softree)
    ids.add(r.id)
  }
  return structuredClone(raw) as SurveyBookRecord[]
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export function reduceTraverse(input: TraverseInput): TraverseResult {
  if (
    !input ||
    !['none', 'bowditch'].includes(input.adjustment) ||
    !Array.isArray(input.start) ||
    input.start.length !== 3 ||
    !input.start.every(finite) ||
    (input.target && (!Array.isArray(input.target) || input.target.length !== 3 || !input.target.every(finite))) ||
    !Array.isArray(input.legs) ||
    !input.legs.length ||
    input.legs.length > 2_000
  )
    throw Error('Enter a starting easting, northing and elevation, and 1–2,000 traverse legs.')
  if (input.adjustment === 'bowditch' && !input.target)
    throw Error('Bowditch adjustment needs a known closing coordinate.')
  const scale = input.distanceScale ?? 1
  if (!finite(scale) || scale < SCALE_FACTOR_LIMITS[0] || scale > SCALE_FACTOR_LIMITS[1])
    throw Error(
      `A combined scale factor must be between ${SCALE_FACTOR_LIMITS[0]} and ${SCALE_FACTOR_LIMITS[1]}; leave it out for grid distances.`,
    )
  const stations: TraverseResult['stations'] = [
    { id: 'start', raw: [...input.start], adjusted: [...input.start], chainage: 0 },
  ]
  let lengthM = 0
  const ids = new Set<string>()
  for (const leg of input.legs) {
    if (
      !leg ||
      typeof leg.id !== 'string' ||
      !leg.id.trim() ||
      leg.id.length > 100 ||
      ids.has(leg.id) ||
      ![leg.bearingDegrees, leg.horizontalDistanceM, leg.gradePercent].every(finite) ||
      leg.horizontalDistanceM <= 0 ||
      leg.horizontalDistanceM > 10_000 ||
      leg.bearingDegrees < 0 ||
      leg.bearingDegrees >= 360 ||
      Math.abs(leg.gradePercent) > 100
    )
      throw Error('Each leg needs a unique station ID, bearing 0–<360°, distance 0–10 km and grade ±100%.')
    ids.add(leg.id)
    // On the grid the leg is the ground distance times the scale factor; its rise is the ground's.
    const gridM = leg.horizontalDistanceM * scale
    lengthM += gridM
    if (lengthM > 100_000) throw Error('Traverse exceeds 100 km.')
    const last = stations[stations.length - 1].raw,
      a = (leg.bearingDegrees * Math.PI) / 180
    const raw: [number, number, number] = [
      last[0] + Math.sin(a) * gridM,
      last[1] + Math.cos(a) * gridM,
      last[2] + (leg.gradePercent * leg.horizontalDistanceM) / 100,
    ]
    stations.push({ id: leg.id, raw, adjusted: [...raw], chainage: lengthM })
  }
  const end = stations[stations.length - 1].raw
  const delta: [number, number, number] | null = input.target
    ? [end[0] - input.target[0], end[1] - input.target[1], end[2] - input.target[2]]
    : null
  const horizontalM = delta ? Math.hypot(delta[0], delta[1]) : 0
  if (input.adjustment === 'bowditch' && delta)
    for (const s of stations)
      s.adjusted = s.raw.map((v, k) => v - (delta[k] * s.chainage) / lengthM) as [number, number, number]
  const shots = input.sideShots ?? []
  if (shots.length > 10_000) throw Error('A survey supports at most 10,000 side shots.')
  const sideShots = shots.map((s) => {
    if (
      !s ||
      !Number.isInteger(s.station) ||
      s.station < 0 ||
      s.station >= stations.length ||
      !finite(s.offsetM) ||
      Math.abs(s.offsetM) > 1000 ||
      !finite(s.heightDifferenceM) ||
      Math.abs(s.heightDifferenceM) > 1000 ||
      typeof s.id !== 'string' ||
      s.id.length > 100
    )
      throw Error(
        'Invalid side shot: choose a traverse station, signed offset ±1,000 m and height difference ±1,000 m.',
      )
    const at = stations[s.station].adjusted
    const bearing = (input.legs[Math.min(s.station, input.legs.length - 1)].bearingDegrees * Math.PI) / 180
    return {
      id: s.id,
      coordinate: [
        at[0] + Math.cos(bearing) * s.offsetM * scale,
        at[1] - Math.sin(bearing) * s.offsetM * scale,
        at[2] + s.heightDifferenceM,
      ] as [number, number, number],
    }
  })
  return {
    stations,
    sideShots,
    lengthM,
    adjustment: input.adjustment,
    closure: delta ? { delta, horizontalM, ratio: horizontalM > 0 ? lengthM / horizontalM : null } : null,
  }
}
/** CSV field book: station,bearing_deg,horizontal_m,grade_pct, with an optional header. */
export function parseTraverseLegs(text: string): TraverseLeg[] {
  if (text.length > 1_000_000) throw Error('Survey notes exceed 1 MB.')
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (lines[0] && /bearing/i.test(lines[0])) lines.shift()
  return lines.map((line, i) => {
    const fields = line.split(',').map((f) => f.trim())
    if (fields.length !== 4 || fields.slice(1).some((v) => v === ''))
      throw Error(`Survey row ${i + 1} needs station,bearing_deg,horizontal_m,grade_pct.`)
    return {
      id: fields[0],
      bearingDegrees: Number(fields[1]),
      horizontalDistanceM: Number(fields[2]),
      gradePercent: Number(fields[3]),
    }
  })
}
const csv = (value: string | number) =>
  typeof value === 'number' ? String(value) : `"${/^[=+\-@\t\r]/.test(value) ? "'" : ''}${value.split('"').join('""')}"`
/**
 * The reduced traverse as CSV. `chainage_m` is grid distance from the start; `field_station` is the
 * station the field uses there: the start station plus the ground distance, through any equations.
 */
export function traverseCsv(
  result: TraverseResult,
  epsg: number,
  verticalReference: string,
  stations: Parameters<typeof surveyFieldStation>[1] = { input: {} },
): string {
  const field = (chainage: number) => Math.round(surveyFieldStation(chainage, stations) * 1e6) / 1e6
  return [
    'id,kind,chainage_m,field_station,easting_m,northing_m,elevation_m,epsg,vertical_reference,adjustment',
    ...result.stations.map((s) =>
      [s.id, 'traverse', s.chainage, field(s.chainage), ...s.adjusted, epsg, verticalReference, result.adjustment]
        .map(csv)
        .join(','),
    ),
    ...result.sideShots.map((s) =>
      [s.id, 'side-shot', '', '', ...s.coordinate, epsg, verticalReference, result.adjustment].map(csv).join(','),
    ),
  ].join('\r\n')
}

type XmlNode = { name: string; text: string; children: XmlNode[]; attributes?: Record<string, string> }
/** A tag's attributes, names lower-cased without their prefix. Only quoted values are read. */
function tagAttributes(token: string): Record<string, string> | undefined {
  let found: Record<string, string> | undefined
  for (const m of token.matchAll(/\s([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    found ??= {}
    found[m[1].split(':').at(-1)!.toLowerCase()] = decode(m[3] ?? m[4] ?? '')
  }
  return found
}
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, k: string) =>
    k[0] === '#'
      ? String.fromCodePoint(k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10))
      : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k.toLowerCase()] ?? ''),
  )
/** Small bounded XML tokenizer; rejects entities/DTDs and never follows NetworkLink resources. */
function xmlTree(text: string): XmlNode {
  if (text.length > 30_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error('KML exceeds 30 MB or uses unsupported XML entities.')
  const root: XmlNode = { name: 'root', text: '', children: [] },
    stack = [root]
  let count = 0
  const tokens = text.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g) ?? []
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?')) continue
    if (token.startsWith('<![CDATA[')) {
      stack.at(-1)!.text += token.slice(9, -3)
      continue
    }
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim().split(':').at(-1)!.toLowerCase()
      if (stack.length <= 1 || stack.at(-1)!.name !== name) throw Error('KML contains mismatched XML elements.')
      stack.pop()
      continue
    }
    if (token.startsWith('<')) {
      const name = token
        .slice(1)
        .match(/^([\w:.-]+)/)?.[1]
        .split(':')
        .at(-1)
        ?.toLowerCase()
      if (!name || ++count > 100_000 || stack.length > 50)
        throw Error('KML XML complexity exceeds the supported limit.')
      const attributes = tagAttributes(token)
      const node: XmlNode = { name, text: '', children: [], ...(attributes ? { attributes } : {}) }
      stack.at(-1)!.children.push(node)
      if (!/\/\s*>$/.test(token)) stack.push(node)
    } else stack.at(-1)!.text += decode(token)
  }
  if (stack.length !== 1) throw Error('KML XML was not closed.')
  return root
}
function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((c) => [...(c.name === name ? [c] : []), ...descendants(c, name)])
}
function kmlCoordinates(node: XmlNode): number[][] {
  const data = descendants(node, 'coordinates')[0]?.text.trim()
  if (!data) throw Error('A KML geometry has no coordinates.')
  return data.split(/\s+/).map((tuple) => {
    const p = tuple.split(',').map(Number)
    if (
      p.length < 2 ||
      p.length > 3 ||
      !p.every(finite) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) >= 85 ||
      (p.length === 3 && Math.abs(p[2]) > 12000)
    )
      throw Error('KML has an invalid geographic coordinate.')
    return p.slice(0, 2) // KML altitude is deliberately not adopted as measured ground or road design.
  })
}
/** Attributes a placemark keeps at most, and characters of one name or value. */
export const KML_ATTRIBUTE_LIMITS = { count: 50, nameChars: 100, valueChars: 2_000 } as const
/** Property names the reader sets itself; an attribute of the same name is kept with a `kml_` prefix. */
const OWN_PROPERTIES = new Set(['name', 'description', 'source', 'kmlId', 'timestamp'])
/**
 * A placemark's `ExtendedData`: `<Data name><value>` and `<SchemaData><SimpleData name>`, as text,
 * the way a shapefile's attributes arrive. Avenza and Google Earth write both forms.
 */
function extendedData(mark: XmlNode): Record<string, string> {
  const out: Record<string, string> = {}
  const extended = mark.children.find((c) => c.name === 'extendeddata')
  if (!extended) return out
  const add = (rawName: string | undefined, value: string) => {
    const name = rawName?.trim().slice(0, KML_ATTRIBUTE_LIMITS.nameChars)
    if (!name || Object.keys(out).length >= KML_ATTRIBUTE_LIMITS.count) return
    const key = OWN_PROPERTIES.has(name) ? `kml_${name}` : name
    if (!(key in out)) out[key] = value.trim().slice(0, KML_ATTRIBUTE_LIMITS.valueChars)
  }
  for (const data of descendants(extended, 'data'))
    add(data.attributes?.name, data.children.find((c) => c.name === 'value')?.text ?? '')
  for (const data of descendants(extended, 'simpledata')) add(data.attributes?.name, data.text)
  return out
}
/** The placemark's `TimeStamp/when`, or its `TimeSpan/begin`, as written. */
function placemarkTime(mark: XmlNode): string | undefined {
  const stamp = mark.children.find((c) => c.name === 'timestamp' || c.name === 'timespan')
  const when = stamp?.children.find((c) => c.name === 'when' || c.name === 'begin')?.text.trim()
  return when ? when.slice(0, 40) : undefined
}
/**
 * Placemark points, lines and polygons with their name, description, `id`, time and ExtendedData
 * attributes. A placemark says where a feature is, never what it is, so no feature leaves here
 * classified as a stream or a constraint.
 */
export function parseKml(text: string): GeoJSON.FeatureCollection {
  const tree = xmlTree(text),
    marks = descendants(tree, 'placemark'),
    features: GeoJSON.Feature[] = []
  if (!descendants(tree, 'kml').length) throw Error('The document has no KML root.')
  let vertices = 0
  for (const mark of marks) {
    const name = (
      mark.children.find((c) => c.name === 'name')?.text.trim() || `KML feature ${features.length + 1}`
    ).slice(0, 200)
    const description = mark.children
      .find((c) => c.name === 'description')
      ?.text.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500)
    const attributes = extendedData(mark)
    const kmlId = mark.attributes?.id?.trim().slice(0, 200)
    const timestamp = placemarkTime(mark)
    const geometries: GeoJSON.Geometry[] = []
    for (const node of descendants(mark, 'point')) {
      const coordinates = kmlCoordinates(node)
      if (coordinates.length !== 1) throw Error('A KML point needs exactly one coordinate.')
      vertices += 1
      geometries.push({ type: 'Point', coordinates: coordinates[0] })
    }
    for (const node of descendants(mark, 'linestring')) {
      const coordinates = kmlCoordinates(node)
      vertices += coordinates.length
      if (coordinates.length < 2) throw Error('A KML line needs at least two coordinates.')
      geometries.push({ type: 'LineString', coordinates })
    }
    for (const node of descendants(mark, 'polygon')) {
      const outer = descendants(node, 'outerboundaryis')[0]
      if (!outer) throw Error('A KML polygon needs an outer boundary.')
      const coordinates = [outer, ...descendants(node, 'innerboundaryis')].map(kmlCoordinates)
      for (const ring of coordinates) {
        vertices += ring.length
        if (ring.length < 4 || ring[0].some((v, k) => v !== ring.at(-1)![k]))
          throw Error('KML polygon rings must have four vertices and be closed.')
      }
      geometries.push({ type: 'Polygon', coordinates })
    }
    for (const geometry of geometries)
      features.push({
        type: 'Feature',
        geometry,
        properties: {
          ...attributes,
          name,
          ...(description ? { description } : {}),
          ...(kmlId ? { kmlId } : {}),
          ...(timestamp ? { timestamp } : {}),
          source: 'KML geographic linework; altitude discarded',
        },
      })
    if (features.length > 500 || vertices > 50_000)
      throw Error('KML exceeds 500 features or 50,000 vertices; crop the file.')
  }
  if (!features.length)
    throw Error('No point, line or polygon features in this KML. Network links and embedded imagery are not imported.')
  return { type: 'FeatureCollection', features }
}
/** The text of a KMZ's `doc.kml`, or of its only KML file. */
export async function kmzDocument(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const { default: JSZip } = await import('jszip'),
    zip = await JSZip.loadAsync(bytes)
  const entries = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name))
  const entry = entries.find((f) => f.name.toLowerCase() === 'doc.kml') ?? (entries.length === 1 ? entries[0] : null)
  if (!entry) throw Error('KMZ must contain doc.kml or one unambiguous KML file.')
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (size !== undefined && size > 30_000_000) throw Error('Expanded KMZ KML exceeds 30 MB.')
  return entry.async('string')
}
export async function readSpatialFile(file: Blob & { name?: string }): Promise<unknown> {
  if (file.size > 120_000_000) throw Error('Spatial import exceeds 120 MB.')
  if (/\.kmz$/i.test(file.name ?? '')) return parseKml(await kmzDocument(await file.arrayBuffer()))
  if (/\.kml$/i.test(file.name ?? '')) return parseKml(await file.text())
  return JSON.parse(await file.text())
}

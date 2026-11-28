/**
 * Mapped crossings round a block, read live from DataBC on the reviewer's click: where the road
 * sections and segments in a stated corridor cross Freshwater Atlas streams, with what the province
 * holds about each place as evidence (all four PSCIS stages, ministry bridges and major culverts,
 * Water Act approvals and notifications, fish observations on the stream, the stream's mapped
 * gradient and route measure) and dated sightings (a PSCIS survey, TRIM's source photography).
 * PSCIS sites with no mapped crossing within 50 m are offered on their own, folded by the PSCIS
 * site rule (`pscisSites.ts`). Every place is a candidate; nothing here answers a fact.
 *
 * The corridor is stated: roads within a distance of the block, or a road file (a road permit or
 * forest service road) or a timber mark within that distance. Road section names and map labels are
 * never requested: a name can carry a holder's. Names are cut on arrival everywhere (`keepFields`):
 * no holder, client, consultant, crew or agency name is read or kept, and from PSCIS's free-text
 * `ROAD_TENURE` only file-id tokens are kept.
 *
 * Two joins rest on findings of the 27 November 2026 reading of the layers: PSCIS carries no
 * `BLUE_LINE_KEY`, so a PSCIS record's stream is the nearest mapped stream within 30 m, never one
 * farther; and fish observations carry none either, so they join the crossed stream by the 50k
 * watershed code (FISS's dashed `NEW_WATERSHED_CODE` is FWA's `WATERSHED_CODE_50K` with dashes).
 * bcfishpass's modelled crossings have no service a browser can read (its feature server lists no
 * crossings, and its download is a whole-province package), so its ids are not read here: a mapped
 * crossing is computed from the same two layers its model starts from.
 *
 * DOM- and network-free: `fetch` and the geometry overlays are passed in.
 */
import type { Position } from 'geojson'
import {
  keepFields,
  quote,
  readAcrossParts,
  wfsRead,
  hullRing,
  shapeParts,
  type Fetch,
  type RawFeature,
  type Shape,
} from '@/lib/forestry/wfsReads'
import type { CrossingCandidate, CrossingRead, ReadLayerStatus } from './candidates'
import type { CrossingSighting } from './dating'
import {
  distanceM,
  distanceToPolygonsM,
  lineIntersections,
  lineParts,
  nearestOnLine,
  pointParts,
  polygonParts,
  roundPoint,
  type LonLat,
} from './geometry'
import type { CrossingAlias } from './key'
import { foldSites, structureChange, PSCIS_SITE_RULE, type SiteRecord } from './pscisSites'
import type { CrossingEvidence, CrossingStructure } from './record'

// ---------------------------------------------------------------------------------------------
// Limits and layers

/** How far round the block a corridor may reach, metres. */
export const MAX_CORRIDOR_M = 10_000
export const DEFAULT_CORRIDOR_M = 500
/** Streams are read this far either side of the roads found, metres. */
export const STREAM_READ_M = 50
/** A PSCIS record's stream is the nearest mapped stream within this, metres. */
export const PSCIS_STREAM_M = 30
/** A PSCIS site joins a mapped crossing within this, metres, on the same stream where both have one. */
export const PSCIS_MATCH_M = 50
/** A ministry structure joins a mapped crossing or PSCIS site within this, metres. */
export const STRUCTURE_MATCH_M = 50
/** Water Act approvals and notifications within this of a crossing are listed as its evidence, metres. */
export const APPROVAL_NEAR_M = 150
/** A TRIM road within this of a crossing dates the road there, metres. */
export const TRIM_NEAR_M = 20
/** Two road × stream crossings on one stream within this are one place (a section and its segment), metres. */
export const SAME_CROSSING_M = 15
/** The mapped gradient is read over this much stream either side of the crossing, metres. */
export const GRADIENT_HALF_WINDOW_M = 50

const CAP = { roads: 3000, streams: 5000, pscis: 2000, structures: 500, approvals: 1000, trim: 5000, fish: 5000 }

/** The fields asked for and kept, by layer. Names are never among them. */
export const CROSSING_LAYERS = {
  sections: {
    layer: 'pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW',
    label: 'Road permit and forest service road sections',
    geometry: 'GEOMETRY',
    fields: [
      'FOREST_FILE_ID',
      'ROAD_SECTION_ID',
      'FILE_TYPE_CODE',
      'AWARD_DATE',
      'RETIREMENT_DATE',
      'LIFE_CYCLE_STATUS_CODE',
      'OBJECTID',
    ],
  },
  segments: {
    layer: 'pub:WHSE_FOREST_TENURE.FTEN_ROAD_SEGMENT_LINES_SVW',
    label: 'Road segments (timber marks)',
    geometry: 'GEOMETRY',
    fields: [
      'FOREST_FILE_ID',
      'ROAD_SECTION_ID',
      'TIMBER_MARK',
      'START_STATION',
      'END_STATION',
      'FILE_TYPE_CODE',
      'RETIREMENT_DATE',
      'LIFE_CYCLE_STATUS_CODE',
      'OBJECTID',
    ],
  },
  streams: {
    layer: 'pub:WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP',
    label: 'Freshwater Atlas streams',
    geometry: 'GEOMETRY',
    fields: [
      'LINEAR_FEATURE_ID',
      'BLUE_LINE_KEY',
      'DOWNSTREAM_ROUTE_MEASURE',
      'WATERSHED_CODE_50K',
      'GNIS_NAME',
      'STREAM_ORDER',
      'EDGE_TYPE',
      'OBJECTID',
    ],
  },
  assessment: {
    layer: 'pub:WHSE_FISH.PSCIS_ASSESSMENT_SVW',
    label: 'PSCIS assessments',
    geometry: 'GEOMETRY',
    fields: [
      'STREAM_CROSSING_ID',
      'ASSESSMENT_ID',
      'ASSESSMENT_DATE',
      'EXTERNAL_CROSSING_REFERENCE',
      'STREAM_NAME',
      'ROAD_KM_MARK',
      'ROAD_TENURE',
      'CROSSING_TYPE_CODE',
      'CROSSING_SUBTYPE_CODE',
      'CROSSING_SUBTYPE_DESC',
      'DIAMETER_OR_SPAN',
      'LENGTH_OR_WIDTH',
      'CONTINUOUS_EMBEDDEDMENT_IND',
      'OUTLET_DROP',
      'CULVERT_SLOPE',
      'DOWNSTREAM_CHANNEL_WIDTH',
      'STREAM_SLOPE',
      'FISH_OBSERVED_IND',
      'FILL_DEPTH',
      'HABITAT_VALUE_CODE',
      'FINAL_SCORE',
      'BARRIER_RESULT_CODE',
      'CROSSING_FIX_CODE',
      'RECOMMENDED_DIAMETER_OR_SPAN',
      'CURRENT_PSCIS_STATUS',
      'OBJECTID',
    ],
  },
  habitat: {
    layer: 'pub:WHSE_FISH.PSCIS_HABITAT_CONFIRMATION_SVW',
    label: 'PSCIS habitat confirmations',
    geometry: 'GEOMETRY',
    fields: [
      'STREAM_CROSSING_ID',
      'HABCONF_ID',
      'ASSMT_DATE',
      'HABCONF_HABITAT_VALUE_CODE',
      'HABCONF_VERIFIED_HABITAT_IND',
      'HABCONF_VERIFIED_HABITAT_LEN',
      'ROAD_TENURE',
      'OBJECTID',
    ],
  },
  design: {
    layer: 'pub:WHSE_FISH.PSCIS_DESIGN_PROPOSAL_SVW',
    label: 'PSCIS design proposals',
    geometry: 'GEOMETRY',
    fields: [
      'STREAM_CROSSING_ID',
      'REMEDIATION_PROPOSAL_ID',
      'PROPOSAL_DATE',
      'CROSSING_FIX_CODE',
      'PROPOSED_DIAMETER_OR_SPAN',
      'ROAD_TENURE',
      'OBJECTID',
    ],
  },
  remediation: {
    layer: 'pub:WHSE_FISH.PSCIS_REMEDIATION_SVW',
    label: 'PSCIS remediations',
    geometry: 'GEOMETRY',
    fields: [
      'STREAM_CROSSING_ID',
      'REMEDIATION_ID',
      'COMPLETION_DATE',
      'CROSSING_TYPE_CODE',
      'CROSSING_SUBTYPE_CODE',
      'CROSSING_SUBTYPE_DESC',
      'CROSSING_FIX_CODE',
      'DIAMETER_OR_SPAN',
      'LENGTH_OR_WIDTH',
      'ROAD_TENURE',
      'OBJECTID',
    ],
  },
  structures: {
    layer: 'pub:WHSE_FOREST_TENURE.RRI_BRIDGES_MAJOR_CULVERTS_SP',
    label: 'Ministry bridges and major culverts',
    geometry: 'SHAPE',
    fields: [
      'CROSSING_SITE_ID',
      'CROSSING_SITE_STATUS_CODE',
      'CROSSING_SITE_TYPE_CODE',
      'CROSSING_SITE_TYPE_DESC',
      'FOREST_FILE_ID',
      'ROAD_SECTION_ID',
      'STRUCTURE_TYPE_CLASS_DESC',
      'TOTAL_BRIDGE_LENGTH',
      'CULVERT_TYPE_DESC',
      'CULVERT_MATERIAL_DESC',
      'OPENING_WIDTH',
      'OPENING_HEIGHT',
      'LAST_INSPECTION_DATE',
      'OBJECTID',
    ],
  },
  approvals: {
    layer: 'pub:WHSE_WATER_MANAGEMENT.WLS_WATER_APPROVALS_SVW',
    label: 'Water Act approvals and notifications',
    geometry: 'SHAPE',
    fields: [
      'WATER_APPROVAL_ID',
      'APPROVAL_TYPE',
      'APPROVAL_FILE_NUMBER',
      'SOURCE',
      'APPROVAL_STATUS',
      'APPLICATION_DATE',
      'APPROVAL_ISSUANCE_DATE',
      'APPROVAL_START_DATE',
      'APPROVAL_EXPIRY_DATE',
      'OBJECTID',
    ],
  },
  trim: {
    layer: 'pub:WHSE_BASEMAPPING.TRIM_TRANSPORTATION_LINES',
    label: 'TRIM transportation lines',
    geometry: 'GEOMETRY',
    fields: ['FCODE', 'ASRC_YEAR', 'ASRC_MNTH', 'ASRC_DAY', 'ADMIT_YEAR', 'ADMIT_MNTH', 'ADMIT_DAY', 'OBJECTID'],
  },
  fish: {
    layer: 'pub:WHSE_FISH.FISS_FISH_OBSRVTN_PNT_SP',
    label: 'Fish observations (FISS)',
    geometry: 'GEOMETRY',
    fields: [
      'FISH_OBSERVATION_POINT_ID',
      'SPECIES_CODE',
      'SPECIES_NAME',
      'OBSERVATION_DATE',
      'NEW_WATERSHED_CODE',
      'POINT_TYPE_CODE',
      'OBJECTID',
    ],
  },
} as const
export type CrossingLayerId = keyof typeof CROSSING_LAYERS

// ---------------------------------------------------------------------------------------------
// Small readers

export type Corridor =
  | { by: 'distance'; metres: number }
  | { by: 'file'; file: string; metres: number }
  | { by: 'timber-mark'; mark: string; metres: number }

/** What a corridor reads, in words for the read's record. */
export function corridorText(c: Corridor): string {
  const within = `within ${c.metres.toLocaleString()} m of the block`
  if (c.by === 'file') return `Road file ${c.file} ${within}, and Freshwater Atlas streams along it`
  if (c.by === 'timber-mark')
    return `Road segments under timber mark ${c.mark} ${within}, and Freshwater Atlas streams along them`
  return `Road sections and segments ${within}, and Freshwater Atlas streams along them`
}

/** A road file or timber mark as a CQL literal, or null when it is not a plain identifier. */
export const identifier = (s: string) => (/^[A-Za-z0-9-]{1,20}$/.test(s.trim()) ? s.trim().toUpperCase() : null)

const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
/** A DataBC date ("2016-07-26Z", "2016-07-26T00:00:00Z") as YYYY-MM-DD. */
export const dayOf = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined

/** File-id tokens from PSCIS's free-text road tenure ("FSR 9311 / R08765 CP 2" → R08765, 9311): a name is never kept. */
export function tenureTokens(text: unknown): string[] {
  if (typeof text !== 'string') return []
  const tokens = text
    .toUpperCase()
    .split(/[^A-Z0-9-]+/)
    .filter((t) => /\d/.test(t) && /^[A-Z]{0,4}\d[A-Z0-9-]{1,11}$/.test(t))
  return [...new Set(tokens)].slice(0, 5)
}

const FISS_SEGMENTS = [3, 6, 5, 5, 4, 4, 3, 3, 3, 3, 3, 3]
/** FWA's 45-digit `WATERSHED_CODE_50K` in FISS's dashed `NEW_WATERSHED_CODE` form. */
export function fissWatershedCode(code50k: unknown): string | undefined {
  if (typeof code50k !== 'string' || !/^\d{45}$/.test(code50k)) return undefined
  const parts: string[] = []
  let at = 0
  for (const n of FISS_SEGMENTS) {
    parts.push(code50k.slice(at, at + n))
    at += n
  }
  return parts.join('-')
}

/**
 * The fish the FPPR's fish stream definition lists by name (limb (a)), by FISS species code. A
 * species at risk or regionally important wildlife also counts, which no code here can say.
 */
export const LISTED_FISH: Record<string, string> = {
  CH: 'Chinook salmon',
  CO: 'Coho salmon',
  CM: 'Chum salmon',
  PK: 'Pink salmon',
  SK: 'Sockeye salmon',
  ST: 'Steelhead',
  RB: 'Rainbow trout',
  CT: 'Cutthroat trout',
  CCT: 'Coastal cutthroat trout',
  WCT: 'Westslope cutthroat trout',
  BNT: 'Brown trout',
  BT: 'Bull trout',
  DV: 'Dolly Varden',
  LT: 'Lake trout',
  EB: 'Brook trout',
  KO: 'Kokanee',
  LMB: 'Largemouth bass',
  SMB: 'Smallmouth bass',
  MW: 'Mountain whitefish',
  LW: 'Lake whitefish',
  GR: 'Arctic grayling',
  BB: 'Burbot',
  WSG: 'White sturgeon',
  BC: 'Black crappie',
  YP: 'Yellow perch',
  WP: 'Walleye',
  NP: 'Northern pike',
}

const PSCIS_KIND: Record<string, CrossingStructure['kind']> = { CBS: 'culvert', OBS: 'other' }
/** A PSCIS record's structure: closed-bottom is a culvert; open-bottom a bridge where its subtype says so. */
export function pscisStructure(p: Record<string, unknown>): CrossingStructure | undefined {
  const type = str(p.CROSSING_TYPE_CODE)
  const sub = (str(p.CROSSING_SUBTYPE_CODE) ?? '').toUpperCase()
  if (!type) return undefined
  const kind: CrossingStructure['kind'] = sub.includes('BRIDGE')
    ? 'bridge'
    : sub.includes('FORD')
      ? 'ford'
      : (PSCIS_KIND[type] ?? 'other')
  const s: CrossingStructure = { kind }
  if (type === 'OBS') s.openBottom = true
  const size = num(p.DIAMETER_OR_SPAN)
  const length = num(p.LENGTH_OR_WIDTH)
  if (size !== undefined && size > 0 && size < 1000) s.spanOrDiameterM = size
  if (length !== undefined && length > 0 && length < 10_000) s.lengthM = length
  return s
}

// ---------------------------------------------------------------------------------------------
// Stream geometry

interface StreamPart {
  line: Position[]
  props: Record<string, unknown>
}

/** Metres along a part to each vertex. */
function cumulative(line: Position[]): number[] {
  const out = [0]
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + distanceM(line[i - 1], line[i]))
  return out
}

/** The line's elevation `along` metres from its first vertex, or undefined where it has none. */
function elevationAt(line: Position[], along: number[], at: number): number | undefined {
  for (let i = 1; i < line.length; i++)
    if (at <= along[i] || i === line.length - 1) {
      const z0 = line[i - 1][2]
      const z1 = line[i][2]
      if (typeof z0 !== 'number' || typeof z1 !== 'number') return undefined
      const span = along[i] - along[i - 1]
      const t = span > 0 ? Math.max(0, Math.min(1, (at - along[i - 1]) / span)) : 0
      return z0 + t * (z1 - z0)
    }
  return undefined
}

/**
 * The stream's mapped gradient at a point `at` metres along its line, over up to
 * `GRADIENT_HALF_WINDOW_M` either side within the line, percent, and the length it was read over.
 * Freshwater Atlas lines are drawn from downstream and carry elevations.
 */
export function mappedGradient(line: Position[], at: number): { percent: number; overM: number } | undefined {
  const along = cumulative(line)
  const total = along.at(-1) ?? 0
  const a = Math.max(0, at - GRADIENT_HALF_WINDOW_M)
  const b = Math.min(total, at + GRADIENT_HALF_WINDOW_M)
  if (b - a < 10) return undefined
  const za = elevationAt(line, along, a)
  const zb = elevationAt(line, along, b)
  if (za === undefined || zb === undefined) return undefined
  return { percent: (Math.abs(zb - za) / (b - a)) * 100, overM: b - a }
}

/** The nearest stream part to a point within `reach` metres, with the point's route measure on it. */
function nearestStream(streams: StreamPart[], p: Position, reach: number) {
  let best: { part: StreamPart; distanceM: number; alongM: number } | undefined
  for (const part of streams) {
    const n = nearestOnLine(p, part.line)
    if (n.distanceM <= reach && (!best || n.distanceM < best.distanceM))
      best = { part, distanceM: n.distanceM, alongM: n.alongM }
  }
  return best
}

const blueLineKey = (props: Record<string, unknown>) => num(props.BLUE_LINE_KEY)
const routeMeasure = (props: Record<string, unknown>, alongM: number) => {
  const down = num(props.DOWNSTREAM_ROUTE_MEASURE)
  return down === undefined ? undefined : Math.round((down + alongM) * 10) / 10
}

// ---------------------------------------------------------------------------------------------
// The read

export interface CrossingOverlay {
  /** The footprint grown by `metres`, WGS84. */
  grow: (shape: Shape, metres: number) => Shape
  /** The ground within `metres` of the lines and `pointMetres` of the points, WGS84, or null when there are none. */
  corridor: (lines: Position[][], metres: number, points?: Position[], pointMetres?: number) => Shape | null
}

export interface MappedReadInput {
  footprint: Shape
  block: string
  schedule: string
  shape: string
  signature: string
  corridor: Corridor
  fetch: Fetch
  signal?: AbortSignal
  overlay: CrossingOverlay
  readOn: string
  onProgress?: (stage: string) => void
}

type LayerResult = { features: RawFeature[]; status: ReadLayerStatus; message?: string }

/** A shape of many parts is asked for by one hull: it asks for more, never less, and in one request. */
function fewParts(shape: Shape, most = 30): Shape {
  const parts = shapeParts(shape)
  if (parts.length <= most) return shape
  return { type: 'Polygon', coordinates: [hullRing(parts.flatMap((p) => p[0]))] }
}

interface MappedCrossing {
  point: LonLat
  file?: string
  section?: string
  timberMarks: Set<string>
  chainageM?: number
  roadRefs: Set<string>
  retired: boolean
  stream: StreamPart
  alongM: number
}

/**
 * Reads the corridor's roads, the streams along them, and the evidence round each crossing, and
 * returns the read with its candidates nearest the block first. A layer that fails is recorded as
 * not read, never as none; the read itself fails only when the roads cannot be read.
 */
export async function readMappedCrossings(input: MappedReadInput): Promise<CrossingRead> {
  const { fetch, signal, overlay, corridor, footprint, readOn } = input
  const progress = input.onProgress ?? (() => {})
  const metres = Math.min(MAX_CORRIDOR_M, Math.max(0, corridor.metres))
  const area = metres > 0 ? overlay.grow(footprint, metres) : footprint
  const areaPolygons = polygonParts(area)
  const blockPolygons = polygonParts(footprint)
  const layers: CrossingRead['layers'] = []
  const record = (id: CrossingLayerId, result: LayerResult) =>
    layers.push({
      id,
      label: CROSSING_LAYERS[id].label,
      status: result.status,
      count: result.features.length,
      ...(result.message ? { message: result.message } : {}),
    })

  /** One layer read across a shape's parts, with an extra CQL condition; its features cut to the layer's fields. */
  async function readLayer(
    id: CrossingLayerId,
    shape: Shape | null,
    extra: string | null,
    cap: number,
  ): Promise<LayerResult> {
    const spec = CROSSING_LAYERS[id]
    if (!shape) return { features: [], status: 'skipped', message: 'Nothing to read round.' }
    let truncated = false
    try {
      const features = await readAcrossParts(
        fewParts(shape),
        async (filter, seen) => {
          const r = await wfsRead({
            fetch,
            signal,
            layer: spec.layer,
            filter: extra ? `${filter} AND ${extra}` : filter,
            propertyName: [...spec.fields, spec.geometry].join(','),
            sortBy: 'OBJECTID',
            cap: Math.max(1, cap - seen),
          })
          truncated ||= r.truncated
          return r.features
        },
        spec.geometry,
        (f) => String(f.properties?.OBJECTID ?? f.id),
      )
      const kept = features.map((f) => ({ ...f, properties: keepFields(f.properties, spec.fields) }))
      return truncated
        ? {
            features: kept,
            status: 'truncated',
            message: `More than ${cap.toLocaleString()} records; the read stopped there.`,
          }
        : { features: kept, status: 'read' }
    } catch (e) {
      if (signal?.aborted) throw e
      return { features: [], status: 'failed', message: e instanceof Error ? e.message : 'The read failed.' }
    }
  }

  // 1. Roads in the corridor.
  progress('Reading roads…')
  let sections: LayerResult = { features: [], status: 'skipped' }
  let segments: LayerResult
  if (corridor.by === 'timber-mark') {
    const mark = identifier(corridor.mark)
    if (!mark) throw Error('A timber mark is letters and digits only.')
    segments = await readLayer('segments', area, `TIMBER_MARK = ${quote(mark)}`, CAP.roads)
    sections.message = 'Sections carry no timber mark: the segments under the mark are read.'
  } else {
    const file = corridor.by === 'file' ? identifier(corridor.file) : null
    if (corridor.by === 'file' && !file) throw Error('A road file is letters and digits only.')
    const only = file ? `FOREST_FILE_ID = ${quote(file)}` : null
    sections = await readLayer('sections', area, only, CAP.roads)
    segments = await readLayer('segments', area, only, CAP.roads)
  }
  record('sections', sections)
  record('segments', segments)
  if (sections.status === 'failed' && segments.status === 'failed')
    throw Error(`DataBC's road layers could not be read: ${sections.message ?? segments.message}`)

  // 2. PSCIS, read before the streams so its records outside the roads get a stream too.
  progress('Reading PSCIS…')
  const pscis = {
    assessment: await readLayer('assessment', area, null, CAP.pscis),
    habitat: await readLayer('habitat', area, null, CAP.pscis),
    design: await readLayer('design', area, null, CAP.pscis),
    remediation: await readLayer('remediation', area, null, CAP.pscis),
  }
  for (const id of ['assessment', 'habitat', 'design', 'remediation'] as const) record(id, pscis[id])

  // 3. Streams along the roads and round the PSCIS records.
  progress('Reading streams…')
  const roadLines = [...sections.features, ...segments.features].flatMap((f) =>
    lineParts(f.geometry).map((line) => ({ line, props: f.properties, segment: segments.features.includes(f) })),
  )
  const pscisPoints = Object.values(pscis).flatMap((r) => r.features.flatMap((f) => pointParts(f.geometry)))
  const streamArea = overlay.corridor(
    roadLines.map((r) => r.line),
    STREAM_READ_M,
    pscisPoints,
    PSCIS_MATCH_M,
  )
  const streamResult = await readLayer('streams', streamArea, null, CAP.streams)
  record('streams', streamResult)
  const streams: StreamPart[] = streamResult.features.flatMap((f) =>
    lineParts(f.geometry).map((line) => ({ line, props: f.properties })),
  )

  // 4. Road × stream crossings, one a place.
  progress('Finding crossings…')
  const crossings: MappedCrossing[] = []
  for (const road of roadLines)
    for (const stream of streams)
      for (const hit of lineIntersections(road.line, stream.line)) {
        if (areaPolygons.length && distanceToPolygonsM(hit.point, areaPolygons) > 1) continue
        const streamAlong = cumulative(stream.line)
        const alongM = streamAlong[hit.b.index] + hit.b.t * (streamAlong[hit.b.index + 1] - streamAlong[hit.b.index])
        const roadAlong = cumulative(road.line)
        const roadM = roadAlong[hit.a.index] + hit.a.t * (roadAlong[hit.a.index + 1] - roadAlong[hit.a.index])
        const file = str(road.props.FOREST_FILE_ID)
        const section = str(road.props.ROAD_SECTION_ID)
        const start = num(road.props.START_STATION)
        const same = crossings.find(
          (c) =>
            blueLineKey(c.stream.props) === blueLineKey(stream.props) &&
            distanceM(c.point, hit.point) <= SAME_CROSSING_M,
        )
        const ref = file ? `${file}${section ? `/${section}` : ''}` : undefined
        const mark = str(road.props.TIMBER_MARK)
        if (same) {
          if (ref) same.roadRefs.add(ref)
          if (mark) same.timberMarks.add(mark)
          if (!same.file && file) Object.assign(same, { file, section })
          continue
        }
        crossings.push({
          point: roundPoint(hit.point),
          file,
          section,
          timberMarks: new Set(mark ? [mark] : []),
          chainageM: road.segment && start !== undefined ? start + roadM : road.segment ? undefined : roadM,
          roadRefs: new Set(ref ? [ref] : []),
          retired: !!dayOf(road.props.RETIREMENT_DATE),
          stream,
          alongM,
        })
      }

  // 5. PSCIS records into sites, each with the nearest mapped stream within 30 m.
  type PscisRow = { stage: keyof typeof pscis; props: Record<string, unknown>; point: LonLat }
  const rows: PscisRow[] = (Object.keys(pscis) as (keyof typeof pscis)[]).flatMap((stage) =>
    pscis[stage].features.flatMap((f) => {
      const p = pointParts(f.geometry)[0]
      return p && str(f.properties.STREAM_CROSSING_ID) ? [{ stage, props: f.properties, point: roundPoint(p) }] : []
    }),
  )
  const stageDay = (r: PscisRow) =>
    dayOf(
      r.stage === 'assessment'
        ? r.props.ASSESSMENT_DATE
        : r.stage === 'habitat'
          ? r.props.ASSMT_DATE
          : r.stage === 'design'
            ? r.props.PROPOSAL_DATE
            : r.props.COMPLETION_DATE,
    )
  const siteRecords: (SiteRecord & { row: PscisRow })[] = rows.map((row, i) => {
    const near = nearestStream(streams, row.point, PSCIS_STREAM_M)
    return {
      id: `${str(row.props.STREAM_CROSSING_ID)}#${i}`,
      point: row.point,
      // Only an assessment is a survey visit; the other stages share its crossing id.
      day: row.stage === 'assessment' ? stageDay(row) : undefined,
      blueLineKey: near ? blueLineKey(near.part.props) : undefined,
      measureM: near ? routeMeasure(near.part.props, near.alongM) : undefined,
      row,
    }
  })
  const fold = foldSites(siteRecords, (r) => String(r.row.props.STREAM_CROSSING_ID))
  const sites = fold.sites

  // 6. Candidates: each mapped crossing, with the PSCIS site nearest it within 50 m on its stream.
  const candidates: CrossingCandidate[] = crossings.map((c) => {
    const blk = blueLineKey(c.stream.props)
    const measureM = routeMeasure(c.stream.props, c.alongM)
    const name = str(c.stream.props.GNIS_NAME)
    const road: CrossingCandidate['road'] = {}
    if (c.file) road.file = c.file
    if (c.section) road.section = c.section
    if (c.chainageM !== undefined) road.chainageM = Math.round(c.chainageM)
    const stream: CrossingCandidate['stream'] = {}
    if (name) stream.name = name
    if (blk !== undefined) stream.blueLineKey = blk
    if (measureM !== undefined) stream.measureM = measureM
    const gradient = mappedGradient(c.stream.line, c.alongM)
    const values: Record<string, string | number | boolean> = {}
    if (blk !== undefined) values.BLUE_LINE_KEY = blk
    if (measureM !== undefined) values.route_measure_m = measureM
    for (const k of ['LINEAR_FEATURE_ID', 'STREAM_ORDER', 'EDGE_TYPE', 'WATERSHED_CODE_50K'] as const) {
      const v = c.stream.props[k]
      if (typeof v === 'string' || typeof v === 'number') values[k] = v
    }
    if (gradient) {
      values.gradientPercent = Math.round(gradient.percent * 10) / 10
      values.gradient_over_m = Math.round(gradient.overM)
    }
    const refs = [...c.roadRefs]
    const evidence: CrossingEvidence[] = [
      {
        kind: 'stream',
        source: 'Freshwater Atlas stream network (FWA_STREAM_NETWORKS_SP)',
        readOn,
        summary: `${name ?? 'Unnamed stream'}, blue line key ${blk ?? 'not given'}${measureM !== undefined ? `, ${Math.round(measureM)} m up its route` : ''}, stream order ${c.stream.props.STREAM_ORDER ?? 'not given'}.${gradient ? ` Mapped gradient ${gradient.percent.toFixed(1)}% over ${Math.round(gradient.overM)} m of the line round the crossing.` : ' No mapped gradient: the line carries no elevations here.'}`,
        ...(blk !== undefined ? { reference: String(blk) } : {}),
        values,
      },
      {
        kind: 'road',
        source: 'Forest tenure road sections and segments (FTEN_ROAD_SECTION_LINES_SVW, FTEN_ROAD_SEGMENT_LINES_SVW)',
        readOn,
        summary: `${refs.length ? `Road ${refs.join(', ')}` : 'A tenured road'}${c.timberMarks.size ? `, timber mark ${[...c.timberMarks].join(', ')}` : ''}${c.retired ? '; retired in the record' : ''}. A section's award date is the permit's, never the crossing's.`,
        ...(refs[0] ? { reference: refs[0] } : {}),
      },
    ]
    const aliasId = `${refs[0] ?? 'road'}×${blk ?? 'stream'}@${measureM !== undefined ? Math.round(measureM) : `${c.point[0]},${c.point[1]}`}`
    const distance = Math.round(distanceToPolygonsM(c.point, blockPolygons))
    const candidate: CrossingCandidate = {
      id: `mapped:${aliasId}`,
      origin: 'mapped',
      label: `${name ?? 'Unnamed stream'} × ${refs[0] ? `road ${refs[0]}` : 'road'}`.slice(0, 200),
      point: c.point,
      role: distance === 0 ? 'own' : 'unknown',
      aliases: [{ source: 'mapped', id: aliasId, seenOn: readOn }],
      evidence,
      sightings: [],
      distanceM: distance,
    }
    if (Object.keys(road).length) candidate.road = road
    if (Object.keys(stream).length) candidate.stream = stream
    return candidate
  })

  // Sites to crossings, nearest pairs first, never across two mapped streams.
  const pairs: { site: number; cand: number; d: number }[] = []
  sites.forEach((site, s) =>
    candidates.forEach((cand, k) => {
      const d = Math.min(...site.map((r) => distanceM(r.point, cand.point)))
      const siteBlk = site.find((r) => r.blueLineKey !== undefined)?.blueLineKey
      if (d <= PSCIS_MATCH_M && (siteBlk === undefined || siteBlk === cand.stream?.blueLineKey))
        pairs.push({ site: s, cand: k, d })
    }),
  )
  pairs.sort((a, b) => a.d - b.d)
  const siteOf = new Map<number, number>()
  const taken = new Set<number>()
  for (const p of pairs) {
    if (siteOf.has(p.site) || taken.has(p.cand)) continue
    siteOf.set(p.site, p.cand)
    taken.add(p.cand)
  }

  /** A site's aliases, evidence, sightings and latest structure. */
  function siteContent(site: (SiteRecord & { row: PscisRow })[], from: LonLat) {
    const aliases = new Map<string, CrossingAlias>()
    const evidence: CrossingEvidence[] = []
    const sightings: CrossingSighting[] = []
    const surveys: { day?: string; type?: string; sizeM?: number }[] = []
    let structure: CrossingStructure | undefined
    let structureDay = ''
    for (const r of site) {
      const p = r.row.props
      const id = str(p.STREAM_CROSSING_ID)!
      const day = stageDay(r.row)
      const had = aliases.get(id)
      if (day && (!had || day < had.seenOn)) aliases.set(id, { source: 'pscis', id, seenOn: day })
      else if (!had) aliases.set(id, { source: 'pscis', id, seenOn: readOn })
      evidence.push(pscisEvidence(r.row.stage, p, readOn, day, distanceM(r.point, from)))
      if (r.row.stage === 'assessment' && day) {
        sightings.push({ source: 'pscis', date: day, state: 'present', reference: id, by: 'read' })
        const s = pscisStructure(p)
        surveys.push({ day, type: str(p.CROSSING_TYPE_CODE), sizeM: s?.spanOrDiameterM })
        if (s && day >= structureDay) {
          structure = s
          structureDay = day
        }
      }
    }
    surveys.sort((a, b) => (a.day ?? '').localeCompare(b.day ?? ''))
    const history: string[] = []
    for (let i = 1; i < surveys.length; i++) {
      const change = structureChange(surveys[i - 1], surveys[i])
      if (change === 'replaced')
        history.push(`a likely replacement between ${surveys[i - 1].day} and ${surveys[i].day}`)
      if (change === 'differs')
        history.push(
          `the structure recorded on ${surveys[i].day} differs from ${surveys[i - 1].day}'s for no stated reason`,
        )
    }
    return { aliases: [...aliases.values()], evidence, sightings, structure, history }
  }

  sites.forEach((site, s) => {
    const k = siteOf.get(s)
    if (k === undefined) return
    const cand = candidates[k]
    const content = siteContent(site, cand.point)
    cand.aliases.push(...content.aliases)
    cand.evidence.push(...content.evidence)
    cand.sightings.push(...content.sightings)
    if (content.structure) cand.structure = content.structure
    if (content.history.length) cand.note = `PSCIS shows ${content.history.join('; ')}.`
  })

  // PSCIS sites with no mapped crossing: one candidate each, or one for those within 15 m on the same road.
  const loose = sites.flatMap((site, s) => (siteOf.has(s) ? [] : [site]))
  const roadOf = (site: (SiteRecord & { row: PscisRow })[]) => {
    let best: { ref: string; d: number } | undefined
    for (const r of roadLines) {
      const d = nearestOnLine(site[0].point, r.line).distanceM
      const ref = str(r.props.FOREST_FILE_ID)
      if (ref && d <= PSCIS_STREAM_M && (!best || d < best.d)) best = { ref, d }
    }
    return best?.ref
  }
  const groups: (SiteRecord & { row: PscisRow })[][][] = []
  for (const site of loose) {
    const road = roadOf(site)
    const group = road
      ? groups.find(
          (g) =>
            roadOf(g[0]) === road &&
            g.some((other) => distanceM(other[0].point, site[0].point) <= PSCIS_SITE_RULE.nearM),
        )
      : undefined
    if (group) group.push(site)
    else groups.push([site])
  }
  for (const group of groups) {
    const first = group[0][0]
    const content = group.map((site) => siteContent(site, first.point))
    const ids = content.flatMap((c) => c.aliases.map((a) => a.id))
    const near = nearestStream(streams, first.point, PSCIS_STREAM_M)
    const blk = near ? blueLineKey(near.part.props) : undefined
    const measureM = near ? routeMeasure(near.part.props, near.alongM) : undefined
    const streamName = str(first.row.props.STREAM_NAME) ?? (near ? str(near.part.props.GNIS_NAME) : undefined)
    const distance = Math.round(distanceToPolygonsM(first.point, blockPolygons))
    const tenure = tenureTokens(first.row.props.ROAD_TENURE)
    const cand: CrossingCandidate = {
      id: `pscis:${ids[0]}`,
      origin: 'pscis',
      label: `PSCIS ${ids.join(', ')}${streamName ? ` · ${streamName}` : ''}`.slice(0, 200),
      point: first.point,
      role: distance === 0 ? 'own' : 'unknown',
      aliases: content.flatMap((c) => c.aliases),
      evidence: content.flatMap((c) => c.evidence),
      sightings: content.flatMap((c) => c.sightings),
      distanceM: distance,
    }
    const structure = content.find((c) => c.structure)?.structure
    if (structure) cand.structure = structure
    const stream: CrossingCandidate['stream'] = {}
    if (streamName) stream.name = streamName.slice(0, 200)
    if (blk !== undefined) stream.blueLineKey = blk
    if (measureM !== undefined) stream.measureM = measureM
    if (Object.keys(stream).length) cand.stream = stream
    if (tenure.length) cand.road = { file: tenure[0] }
    const notes: string[] = []
    if (!near)
      notes.push(
        `No mapped stream within ${PSCIS_STREAM_M} m: a stream below the Freshwater Atlas's resolution, or a record placed off its stream.`,
      )
    if (group.length > 1)
      notes.push(
        `${group.length} PSCIS sites within ${PSCIS_SITE_RULE.nearM} m on the same road that the site rule kept apart: add them as one crossing, or each on its own.`,
      )
    for (const c of content) if (c.history.length) notes.push(`PSCIS shows ${c.history.join('; ')}.`)
    if (notes.length) cand.note = notes.join(' ')
    if (group.length > 1)
      cand.sites = group.map((site, i) => ({
        label: `PSCIS ${content[i].aliases.map((a) => a.id).join(', ')}`,
        point: site[0].point,
        aliases: content[i].aliases,
      }))
    candidates.push(cand)
  }

  // 7. Ministry structures, Water Act approvals and TRIM roads round the candidates.
  progress('Reading structures, approvals and base mapping…')
  const points = candidates.map((c) => c.point)
  const round = overlay.corridor([], 0, points, Math.max(APPROVAL_NEAR_M, STRUCTURE_MATCH_M) + 10)
  const structures = await readLayer('structures', round, null, CAP.structures)
  const approvals = await readLayer('approvals', round, null, CAP.approvals)
  const trimArea = overlay.corridor([], 0, points, TRIM_NEAR_M + 10)
  const trim = await readLayer('trim', trimArea, null, CAP.trim)
  record('structures', structures)
  record('approvals', approvals)
  record('trim', trim)
  const nearest = (p: Position, reach: number) => {
    let best: { cand: CrossingCandidate; d: number } | undefined
    for (const cand of candidates) {
      const d = distanceM(p, cand.point)
      if (d <= reach && (!best || d < best.d)) best = { cand, d }
    }
    return best
  }
  for (const f of structures.features) {
    const p = pointParts(f.geometry)[0]
    const near = p && nearest(p, STRUCTURE_MATCH_M)
    if (!near) continue
    const id = str(f.properties.CROSSING_SITE_ID)
    if (id)
      near.cand.aliases.push({
        source: 'mof-structure',
        id,
        seenOn: dayOf(f.properties.LAST_INSPECTION_DATE) ?? readOn,
      })
    near.cand.evidence.push(structureEvidence(f.properties, readOn, near.d))
  }
  for (const f of approvals.features) {
    const p = pointParts(f.geometry)[0]
    if (!p) continue
    for (const cand of candidates) {
      const d = distanceM(p, cand.point)
      if (d <= APPROVAL_NEAR_M) cand.evidence.push(approvalEvidence(f.properties, readOn, d))
    }
  }
  for (const cand of candidates) {
    const dates = trim.features.flatMap((f) => {
      const near = lineParts(f.geometry).some((line) => nearestOnLine(cand.point, line).distanceM <= TRIM_NEAR_M)
      const y = num(f.properties.ASRC_YEAR)
      if (!near || !y) return []
      const m = num(f.properties.ASRC_MNTH)
      const d = num(f.properties.ASRC_DAY)
      const date = `${y}-${String(m && m >= 1 && m <= 12 ? m : 1).padStart(2, '0')}-${String(d && d >= 1 && d <= 31 ? d : 1).padStart(2, '0')}`
      // A source date equal to the admit date may be an update's, not the photography's.
      const admitted =
        num(f.properties.ADMIT_YEAR) === y && num(f.properties.ADMIT_MNTH) === m && num(f.properties.ADMIT_DAY) === d
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && y > 1900
        ? [{ date, exact: !!(m && d), admitted, id: String(f.properties.OBJECTID ?? '') }]
        : []
    })
    dates.sort((a, b) => a.date.localeCompare(b.date))
    const first = dates[0]
    if (first)
      cand.sightings.push({
        source: 'trim',
        date: first.date,
        state: 'present',
        reference: `TRIM line ${first.id}`,
        note: `The road as TRIM holds it, by its source date (ASRC)${first.exact ? '' : ', which gives the year and month only, so the first of the month is used'}.${first.admitted ? ' The source date equals the date the line was admitted, so it may be an update’s date rather than the photography’s.' : ''}`,
        by: 'read',
      })
  }

  // 8. Fish observations by the streams' 50k watershed codes.
  progress('Reading fish observations…')
  /** A candidate's stream's 50k code: from its mapped stream, else from the stream part with its blue line key nearest it. */
  const codeOf = (c: CrossingCandidate) => {
    const own = c.evidence.find((e) => e.kind === 'stream')?.values?.WATERSHED_CODE_50K
    if (own !== undefined) return fissWatershedCode(own)
    const near = nearestStream(
      streams.filter((s) => c.stream?.blueLineKey !== undefined && blueLineKey(s.props) === c.stream.blueLineKey),
      c.point,
      PSCIS_STREAM_M,
    )
    return fissWatershedCode(near?.part.props.WATERSHED_CODE_50K)
  }
  const codes = [...new Set(candidates.flatMap((c) => codeOf(c) ?? []))]
  const fish: LayerResult = { features: [], status: codes.length ? 'read' : 'skipped' }
  if (!codes.length) fish.message = 'No crossed stream carries a 50k watershed code.'
  for (let i = 0; i < codes.length && fish.status !== 'failed'; i += 40) {
    try {
      const r = await wfsRead({
        fetch,
        signal,
        layer: CROSSING_LAYERS.fish.layer,
        filter: `NEW_WATERSHED_CODE IN (${codes
          .slice(i, i + 40)
          .map(quote)
          .join(',')})`,
        propertyName: CROSSING_LAYERS.fish.fields.join(','),
        sortBy: 'OBJECTID',
        cap: CAP.fish - fish.features.length,
      })
      fish.features.push(
        ...r.features.map((f) => ({ ...f, properties: keepFields(f.properties, CROSSING_LAYERS.fish.fields) })),
      )
      if (r.truncated) {
        fish.status = 'truncated'
        fish.message = `More than ${CAP.fish.toLocaleString()} observations; the read stopped there.`
        break
      }
    } catch (e) {
      if (signal?.aborted) throw e
      fish.status = 'failed'
      fish.message = e instanceof Error ? e.message : 'The read failed.'
    }
  }
  record('fish', fish)
  if (fish.status !== 'failed' && fish.status !== 'skipped')
    for (const cand of candidates) {
      const code = codeOf(cand)
      if (!code) continue
      const seen = fish.features.filter((f) => f.properties.NEW_WATERSHED_CODE === code)
      cand.evidence.push(fishEvidence(seen, code, readOn))
    }

  progress('Done.')
  candidates.sort((a, b) => a.distanceM - b.distanceM || a.label.localeCompare(b.label))
  for (const c of candidates) c.sightings.sort((a, b) => a.date.localeCompare(b.date))
  return {
    block: input.block,
    schedule: input.schedule,
    shape: input.shape,
    footprint: input.signature,
    source: 'mapped',
    readOn,
    basis: corridorText({ ...corridor, metres } as Corridor),
    layers,
    candidates: candidates.slice(0, 1000),
  }
}

// ---------------------------------------------------------------------------------------------
// Evidence texts

const STAGE: Record<string, { kind: string; label: string; layer: string }> = {
  assessment: { kind: 'pscis-assessment', label: 'PSCIS assessment', layer: 'PSCIS_ASSESSMENT_SVW' },
  habitat: { kind: 'pscis-habitat', label: 'PSCIS habitat confirmation', layer: 'PSCIS_HABITAT_CONFIRMATION_SVW' },
  design: { kind: 'pscis-design', label: 'PSCIS design proposal', layer: 'PSCIS_DESIGN_PROPOSAL_SVW' },
  remediation: { kind: 'pscis-remediation', label: 'PSCIS remediation', layer: 'PSCIS_REMEDIATION_SVW' },
}

const values = (p: Record<string, unknown>, skip: readonly string[] = []) => {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(p)) {
    if (skip.includes(k) || k === 'OBJECTID') continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string' && v.trim() && v.length <= 500) out[k] = v.trim()
  }
  return out
}

/** One PSCIS stage as evidence. A barrier result is printed as PSCIS's assessment of a structure, never as a §56 finding. */
export function pscisEvidence(
  stage: string,
  p: Record<string, unknown>,
  readOn: string,
  day: string | undefined,
  distance: number,
): CrossingEvidence {
  const s = STAGE[stage]
  const id = str(p.STREAM_CROSSING_ID) ?? ''
  const parts: string[] = []
  if (stage === 'assessment') {
    const st = pscisStructure(p)
    parts.push(
      `${str(p.CROSSING_SUBTYPE_DESC) ?? str(p.CROSSING_TYPE_CODE) ?? 'Structure'}${st?.spanOrDiameterM ? ` ${st.spanOrDiameterM} m` : ''}${st?.lengthM ? ` × ${st.lengthM} m` : ''}.`,
    )
    const barrier = str(p.BARRIER_RESULT_CODE)
    if (barrier)
      parts.push(
        `Assessed ${barrier.toLowerCase()} by PSCIS's score${num(p.FINAL_SCORE) !== undefined ? ` (${num(p.FINAL_SCORE)})` : ''}: evidence about the structure, not a finding under FPPR §56.`,
      )
    if (num(p.STREAM_SLOPE) !== undefined) parts.push(`Stream slope ${num(p.STREAM_SLOPE)}%.`)
    if (num(p.DOWNSTREAM_CHANNEL_WIDTH) !== undefined)
      parts.push(`Channel width ${num(p.DOWNSTREAM_CHANNEL_WIDTH)} m downstream.`)
    if (num(p.OUTLET_DROP) !== undefined) parts.push(`Outlet drop ${num(p.OUTLET_DROP)} m.`)
    const fish = str(p.FISH_OBSERVED_IND)
    if (fish)
      parts.push(fish === 'Y' ? 'Fish seen on the visit.' : 'No fish seen on the visit (one visit is not absence).')
  } else if (stage === 'habitat') {
    parts.push(
      `Habitat value ${str(p.HABCONF_HABITAT_VALUE_CODE) ?? 'not given'}${str(p.HABCONF_VERIFIED_HABITAT_IND) === 'Y' ? `, habitat verified${num(p.HABCONF_VERIFIED_HABITAT_LEN) ? ` over ${num(p.HABCONF_VERIFIED_HABITAT_LEN)} m` : ''}` : ''}.`,
    )
  } else if (stage === 'design') {
    parts.push(
      `Fix proposed: ${str(p.CROSSING_FIX_CODE) ?? 'not given'}${num(p.PROPOSED_DIAMETER_OR_SPAN) ? `, ${num(p.PROPOSED_DIAMETER_OR_SPAN)} m` : ''}.`,
    )
  } else {
    const st = pscisStructure(p)
    parts.push(
      `Remediated: ${str(p.CROSSING_SUBTYPE_DESC) ?? str(p.CROSSING_TYPE_CODE) ?? 'structure'}${st?.spanOrDiameterM ? ` ${st.spanOrDiameterM} m` : ''}${str(p.CROSSING_FIX_CODE) ? ` (${str(p.CROSSING_FIX_CODE)})` : ''}.`,
    )
  }
  const tenure = tenureTokens(p.ROAD_TENURE)
  if (tenure.length) parts.push(`Road tenure ids recorded: ${tenure.join(', ')}.`)
  const v = values(p, ['ROAD_TENURE'])
  if (tenure.length) v.road_tenure_ids = tenure.join(' ')
  return {
    kind: s.kind,
    source: `${s.label} (${s.layer})`,
    readOn,
    summary: `${s.label}${day ? ` of ${day}` : ''}, crossing ${id}: ${parts.join(' ')}`,
    reference: id,
    ...(day ? { date: day } : {}),
    distanceM: Math.round(distance),
    values: v,
  }
}

function structureEvidence(p: Record<string, unknown>, readOn: string, d: number): CrossingEvidence {
  const id = str(p.CROSSING_SITE_ID) ?? ''
  const kind = str(p.CROSSING_SITE_TYPE_DESC) ?? str(p.CROSSING_SITE_TYPE_CODE) ?? 'Structure'
  const parts = [
    `${kind}${str(p.STRUCTURE_TYPE_CLASS_DESC) ? `, ${str(p.STRUCTURE_TYPE_CLASS_DESC)}` : ''}${num(p.TOTAL_BRIDGE_LENGTH) ? `, ${num(p.TOTAL_BRIDGE_LENGTH)} m long` : ''}${str(p.CULVERT_TYPE_DESC) ? `, ${str(p.CULVERT_TYPE_DESC)}` : ''}${num(p.OPENING_WIDTH) ? `, opening ${num(p.OPENING_WIDTH)} m` : ''}.`,
  ]
  if (str(p.FOREST_FILE_ID))
    parts.push(`On road ${str(p.FOREST_FILE_ID)}${str(p.ROAD_SECTION_ID) ? ` section ${str(p.ROAD_SECTION_ID)}` : ''}.`)
  const inspected = dayOf(p.LAST_INSPECTION_DATE)
  if (inspected) parts.push(`Last inspected ${inspected}.`)
  return {
    kind: 'mof-structure',
    source: 'Ministry bridges and major culverts (RRI_BRIDGES_MAJOR_CULVERTS_SP)',
    readOn,
    summary: `Crossing site ${id}: ${parts.join(' ')}`,
    reference: id,
    ...(inspected ? { date: inspected } : {}),
    distanceM: Math.round(d),
    values: values(p),
  }
}

const APPROVAL_TYPES: Record<string, string> = {
  'A-CIAS': 'change approval',
  'N-CIAS': 'notification of a change',
  STU: 'short-term use approval',
}

function approvalEvidence(p: Record<string, unknown>, readOn: string, d: number): CrossingEvidence {
  const type = str(p.APPROVAL_TYPE) ?? ''
  const file = str(p.APPROVAL_FILE_NUMBER) ?? str(p.WATER_APPROVAL_ID) ?? ''
  const date = dayOf(p.APPROVAL_ISSUANCE_DATE) ?? dayOf(p.APPROVAL_START_DATE) ?? dayOf(p.APPLICATION_DATE)
  const what = APPROVAL_TYPES[type] ?? `approval (${type || 'type not given'})`
  const note =
    type === 'N-CIAS'
      ? ' A notification shows the §39(1) route was used near here by someone; it does not say whose works or which crossing, and a forest road’s crossing on the §39(2) route needs none (WSR §38(1)).'
      : type === 'A-CIAS'
        ? ' An approval near here is a candidate for the approval route; match its file to the crossing before relying on it.'
        : ''
  return {
    kind: 'water-approval',
    source: 'Water Act approvals and notifications (WLS_WATER_APPROVALS_SVW)',
    readOn,
    summary: `${what[0].toUpperCase()}${what.slice(1)} ${file}${str(p.SOURCE) ? ` on ${str(p.SOURCE)}` : ''}${date ? `, ${date}` : ''}${str(p.APPROVAL_STATUS) ? `, ${str(p.APPROVAL_STATUS)}` : ''}, ${Math.round(d)} m from the crossing.${note}`,
    reference: file,
    ...(date ? { date } : {}),
    distanceM: Math.round(d),
    values: values(p),
  }
}

/** The observations on one stream, summarised: what was seen, when, and which are fish the definition lists. */
export function fishEvidence(features: RawFeature[], code: string, readOn: string): CrossingEvidence {
  const bySpecies = new Map<string, { name: string; n: number; first?: string; last?: string }>()
  for (const f of features) {
    const p = f.properties
    const sp = str(p.SPECIES_CODE)
    if (!sp) continue
    const day = dayOf(p.OBSERVATION_DATE)
    const had = bySpecies.get(sp) ?? { name: str(p.SPECIES_NAME) ?? sp, n: 0 }
    had.n++
    if (day && (!had.first || day < had.first)) had.first = day
    if (day && (!had.last || day > had.last)) had.last = day
    bySpecies.set(sp, had)
  }
  const listed = [...bySpecies.keys()].filter((sp) => LISTED_FISH[sp])
  const list = [...bySpecies.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(
      ([sp, s]) =>
        `${s.name} (${sp}) ×${s.n}${s.first ? `, ${s.first === s.last ? s.first : `${s.first} to ${s.last}`}` : ''}`,
    )
  const summary = !features.length
    ? `No fish observation recorded on this stream (watershed code ${code}). None recorded is not absence.`
    : `${features.length} observation${features.length === 1 ? '' : 's'} recorded on this stream (watershed code ${code}): ${list.join('; ')}.${listed.length ? ` Listed by the fish stream definition: ${listed.map((sp) => LISTED_FISH[sp]).join(', ')}.` : ' None is a species the fish stream definition lists by name; one may still be a species at risk or regionally important wildlife.'}`
  return {
    kind: 'fish-observation',
    source: 'Known BC fish observations (FISS_FISH_OBSRVTN_PNT_SP), by the stream’s 50k watershed code',
    readOn,
    summary: summary.slice(0, 2000),
    reference: code,
    values: {
      observations: features.length,
      species: [...bySpecies.keys()].join(' '),
      listed: listed.join(' '),
    },
  }
}

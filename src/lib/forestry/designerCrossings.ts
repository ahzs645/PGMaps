/**
 * The road designer's crossing register as it travels in the designer's GeoJSON export: one point a
 * register row (a mapped stream crossing, a modelled flow line, or both matched), written by the
 * designer's `projectGeoJson` and read by the block planner's import. Shared so neither tool imports
 * the other: the designer leaves PGMaps with this file, and the planner reads exactly what it wrote.
 *
 * The point keeps what the register shows: the road and its station, where the crossing came from,
 * the structure and its sizing, the stream's reviewed riparian class and its status, the modelled
 * catchment, and the crossing's skew and straight approaches. It carries no person's name: the
 * stream assessment's assessor stays in the designer.
 *
 * DOM- and network-free.
 */

/** The `register_format` property a register point carries. */
export const DESIGNER_CROSSING_FORMAT = 'pgmaps-designer-crossing/v1'
/** The point's `kind`, shared with the designer's geometric crossing points. */
export const DESIGNER_CROSSING_KIND = 'crossing-review'

export type DesignerCrossingSource = 'mapped' | 'modelled' | 'both'
export type DesignerStructureKind = 'none' | 'culvert' | 'record'

export interface DesignerCrossing {
  /** The register row's id: `mapped:<crossing>` or `modelled:<flow line>`. */
  id: string
  roadId: string
  road: string
  chainageM: number
  /** The station as the road's own stationing prints it. */
  station: string
  /** WGS84 longitude and latitude. */
  point: [number, number]
  source: DesignerCrossingSource
  /** The mapped stream's name, or the flow line's description. */
  stream: string
  structure: {
    kind: DesignerStructureKind
    label: string
    /** For a culvert: its diameter (the rise, for another shape) and length, metres. */
    diameterM?: number
    lengthM?: number
    /** For a crossing record: the designer's structure choice (`bridge`, `open-bottom`, `ford`, …). */
    record?: string
    capacity: 'adequate' | 'undersized' | 'unchecked' | 'not-applicable'
    /** What stops it counting as sized. */
    outstanding: string[]
  }
  /** The stream's riparian class as reviewed or imported (FPPR s. 47), and its review status. */
  riparianClass?: string
  classStatus?: string
  /** Metres along the road between a matched mapped crossing and its flow line. */
  separationM?: number
  /** A modelled flow line's catchment, hectares. */
  catchmentHa?: number
  /** The angle off square, degrees (null: the stream could not be read), and the straight road each side. */
  skewDegrees?: number | null
  onCurve?: boolean
  approachBackM?: number
  approachAheadM?: number
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits

/** The point's properties, flat as GIS software shows them. */
export function designerCrossingProperties(c: DesignerCrossing): Record<string, unknown> {
  const p: Record<string, unknown> = {
    register_format: DESIGNER_CROSSING_FORMAT,
    register_id: c.id,
    alignment_id: c.roadId,
    road: c.road,
    chainage_m: round(c.chainageM, 2),
    station: c.station,
    register_source: c.source,
    stream: c.stream,
    structure_kind: c.structure.kind,
    structure: c.structure.label,
    structure_capacity: c.structure.capacity,
    structure_outstanding: c.structure.outstanding.join('; '),
  }
  if (c.structure.diameterM !== undefined) p.culvert_diameter_m = round(c.structure.diameterM, 3)
  if (c.structure.lengthM !== undefined) p.culvert_length_m = round(c.structure.lengthM, 2)
  if (c.structure.record) p.structure_record = c.structure.record
  if (c.riparianClass) p.riparian_class = c.riparianClass
  if (c.classStatus) p.class_status = c.classStatus
  if (c.separationM !== undefined) p.separation_m = round(c.separationM, 1)
  if (c.catchmentHa !== undefined) p.catchment_ha = round(c.catchmentHa, 3)
  if (c.skewDegrees !== undefined) p.skew_deg = c.skewDegrees === null ? null : round(c.skewDegrees, 1)
  if (c.onCurve !== undefined) p.on_curve = c.onCurve
  if (c.approachBackM !== undefined) p.approach_back_m = round(c.approachBackM, 1)
  if (c.approachAheadM !== undefined) p.approach_ahead_m = round(c.approachAheadM, 1)
  return p
}

const SOURCES: readonly DesignerCrossingSource[] = ['mapped', 'modelled', 'both']
const KINDS: readonly DesignerStructureKind[] = ['none', 'culvert', 'record']
const CAPACITIES = ['adequate', 'undersized', 'unchecked', 'not-applicable'] as const

const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined)
const num = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined

/** One point's crossing, or why it is not one. */
function readOne(feature: unknown): DesignerCrossing | string {
  if (!feature || typeof feature !== 'object') return 'not a feature'
  const f = feature as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> }
  const p = f.properties ?? {}
  const g = f.geometry
  const c = g?.type === 'Point' && Array.isArray(g.coordinates) ? g.coordinates : undefined
  const lon = num(c?.[0], -180, 180)
  const lat = num(c?.[1], -90, 90)
  if (lon === undefined || lat === undefined) return 'no point on the globe'
  const id = str(p.register_id)
  const roadId = str(p.alignment_id)
  const road = str(p.road)
  const chainageM = num(p.chainage_m, 0, 1e7)
  const source = SOURCES.find((s) => s === p.register_source)
  const kind = KINDS.find((k) => k === p.structure_kind)
  if (!id || !roadId || !road || chainageM === undefined || !source || !kind) return 'a register field is missing'
  const crossing: DesignerCrossing = {
    id,
    roadId,
    road,
    chainageM,
    station: str(p.station, 40) ?? `${Math.round(chainageM)} m`,
    point: [lon, lat],
    source,
    stream: str(p.stream) ?? 'Stream',
    structure: {
      kind,
      label: str(p.structure) ?? (kind === 'none' ? 'None' : kind),
      capacity: CAPACITIES.find((x) => x === p.structure_capacity) ?? 'unchecked',
      outstanding: (str(p.structure_outstanding, 2000) ?? '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  }
  const diameterM = num(p.culvert_diameter_m, 0, 100)
  const lengthM = num(p.culvert_length_m, 0, 10_000)
  if (diameterM !== undefined) crossing.structure.diameterM = diameterM
  if (lengthM !== undefined) crossing.structure.lengthM = lengthM
  const record = str(p.structure_record, 60)
  if (record) crossing.structure.record = record
  const riparianClass = str(p.riparian_class, 20)
  if (riparianClass) crossing.riparianClass = riparianClass
  const classStatus = str(p.class_status, 40)
  if (classStatus) crossing.classStatus = classStatus
  const separationM = num(p.separation_m, 0, 1e5)
  if (separationM !== undefined) crossing.separationM = separationM
  const catchmentHa = num(p.catchment_ha, 0, 1e8)
  if (catchmentHa !== undefined) crossing.catchmentHa = catchmentHa
  if (p.skew_deg === null) crossing.skewDegrees = null
  else {
    const skew = num(p.skew_deg, 0, 90)
    if (skew !== undefined) crossing.skewDegrees = skew
  }
  if (typeof p.on_curve === 'boolean') crossing.onCurve = p.on_curve
  const back = num(p.approach_back_m, 0, 1e7)
  const ahead = num(p.approach_ahead_m, 0, 1e7)
  if (back !== undefined) crossing.approachBackM = back
  if (ahead !== undefined) crossing.approachAheadM = ahead
  return crossing
}

export interface DesignerCrossingFile {
  crossings: DesignerCrossing[]
  /** The roads the register points name, once each. */
  roads: string[]
  /** Register points that did not read, with the first reason. */
  skipped: number
  firstProblem?: string
}

/**
 * The register points of a designer GeoJSON export. Other features (the roads, culverts, context)
 * are passed over, and so are geometric crossing points from before the register was written,
 * which carry no `register_format`. Throws when the text is not a feature collection.
 */
export function readDesignerCrossings(value: unknown): DesignerCrossingFile {
  const json = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!json || typeof json !== 'object' || !Array.isArray((json as { features?: unknown }).features))
    throw Error('The file is not a GeoJSON feature collection.')
  const out: DesignerCrossingFile = { crossings: [], roads: [], skipped: 0 }
  for (const feature of (json as { features: unknown[] }).features) {
    const p = (feature as { properties?: Record<string, unknown> } | null)?.properties
    if (p?.kind !== DESIGNER_CROSSING_KIND || p.register_format !== DESIGNER_CROSSING_FORMAT) continue
    const read = readOne(feature)
    if (typeof read === 'string') {
      out.skipped++
      out.firstProblem ??= read
      continue
    }
    if (out.crossings.some((c) => c.roadId === read.roadId && c.id === read.id)) continue
    out.crossings.push(read)
    if (!out.roads.includes(read.road)) out.roads.push(read.road)
  }
  return out
}

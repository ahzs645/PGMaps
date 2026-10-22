/** Versioned, bounded project and interchange formats; no network or DOM access. */
import { distance, positionAt } from './engine'
import { parseEngineering } from './engineeringProject'
import { createEngineeringDesign } from './engineeringTypes'
import { resolvedCableLine } from './cableGeometry'
import { localRasterResolution } from '../dev-forestry/localRaster'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, roadProjection, validateRoadRaster } from './terrain'
import type {
  Alignment,
  CableLine,
  ContextFeature,
  Coordinate,
  RoadAnalysis,
  RoadProject,
  RoadSettings,
  RoadTemplate,
  TerrainMetadata,
  VerticalControl,
  VerticalStandards,
  WidthOverride,
} from './types'

const MAX_ALIGNMENTS = 20
const MAX_POINTS = 2000
const MAX_CONTEXT_VERTICES = 50_000
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error(`${label} must contain 1–${max} characters.`)
  return value.trim()
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}
function list(value: unknown, label: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length > max || value.length < min)
    throw Error(`${label} must contain ${min}–${max} entries.`)
  return value
}
function id(value: unknown, label: string) {
  const result = text(value, label, 100)
  if (!/^[a-zA-Z0-9_.:-]+$/.test(result)) throw Error(`${label} contains unsupported characters.`)
  return result
}
function coordinate(value: unknown, label: string): Coordinate {
  const p = list(value, label, 3, 2)
  // GeoJSON heights, when present, are not ground observations or vertical design controls.
  if (p.length === 3) number(p[2], `${label} elevation`, -12000, 12000)
  const longitude = number(p[0], `${label} longitude`, -180, 180)
  const latitude = number(p[1], `${label} latitude`, -85, 85)
  if (Math.abs(latitude) >= 85) throw Error(`${label} latitude must be strictly between -85 and 85 degrees.`)
  return [longitude, latitude]
}
function unique(items: Array<{ id: string }>, label: string) {
  if (new Set(items.map((p) => p.id)).size !== items.length) throw Error(`${label} must have unique IDs.`)
}
function parseTemplate(raw: unknown): RoadTemplate {
  const r = object(raw, 'Road template')
  const result: RoadTemplate = {
    leftWidth: number(r.leftWidth, 'Left width', 0.1, 50),
    rightWidth: number(r.rightWidth, 'Right width', 0.1, 50),
    crossfallPercent: number(r.crossfallPercent, 'Crossfall', 0, 20),
    cutSlope: number(r.cutSlope, 'Cut slope H:V', 0.1, 10),
    fillSlope: number(r.fillSlope, 'Fill slope H:V', 0.1, 10),
    ditchWidth: number(r.ditchWidth, 'Ditch width', 0, 10),
    ditchDepth: number(r.ditchDepth, 'Ditch depth', 0, 5),
    surfaceDepth: number(r.surfaceDepth, 'Surface depth', 0, 2),
  }
  const optional = [
    ['leftCrossfallPercent', -20, 20],
    ['rightCrossfallPercent', -20, 20],
    ['leftCutSlope', 0.1, 10],
    ['rightCutSlope', 0.1, 10],
    ['leftFillSlope', 0.1, 10],
    ['rightFillSlope', 0.1, 10],
    ['leftDitchWidth', 0, 10],
    ['rightDitchWidth', 0, 10],
    ['leftDitchDepth', 0, 5],
    ['rightDitchDepth', 0, 5],
    ['leftSurfaceDepth', 0, 2],
    ['rightSurfaceDepth', 0, 2],
  ] as const
  for (const [key, min, max] of optional) if (r[key] !== undefined) result[key] = number(r[key], key, min, max)
  return result
}
function parseSettings(raw: unknown): RoadSettings {
  const r = object(raw, 'Settings')
  return {
    stationInterval: number(r.stationInterval, 'Station interval', 2, 100),
    crossSectionHalfWidth: number(r.crossSectionHalfWidth, 'Section half-width', 5, 100),
    maxGradePercent: number(r.maxGradePercent, 'Grade threshold', 0.1, 100),
    minRadius: number(r.minRadius, 'Radius threshold', 0, 10000),
    cutRate: number(r.cutRate, 'Cut unit cost', 0, 10000),
    fillRate: number(r.fillRate, 'Fill unit cost', 0, 10000),
    surfacingRate: number(r.surfacingRate, 'Surfacing unit cost', 0, 10000),
    clearingRate: number(r.clearingRate, 'Clearing unit cost', 0, 10000),
    shrinkFactor: number(r.shrinkFactor, 'Reusable cut factor', 0.1, 2),
  }
}
function parseOverride(raw: unknown): WidthOverride {
  const r = object(raw, 'Widening'),
    start = number(r.start, 'Widening start', 0, 100000),
    end = number(r.end, 'Widening end', 0, 100000)
  if (
    end <= start ||
    !['landing', 'turnout'].includes(String(r.kind)) ||
    !['left', 'right', 'both'].includes(String(r.side))
  )
    throw Error('Widening needs an ordered station range, a landing/turnout kind and left/right/both side.')
  return {
    id: id(r.id, 'Widening ID'),
    name: text(r.name, 'Widening name'),
    kind: r.kind as WidthOverride['kind'],
    side: r.side as WidthOverride['side'],
    start,
    end,
    taper: number(r.taper, 'Widening taper', 0, 1000),
    extraWidth: number(r.extraWidth, 'Extra width', 0, 50),
  }
}
const optionalNumber = (value: unknown, label: string, min: number, max: number) =>
  value === null || value === undefined ? null : number(value, label, min, max)
function parseVerticalStandards(raw: unknown): VerticalStandards {
  const r = object(raw, 'Vertical standards')
  const gradeRanges = list(r.gradeRanges, 'Grade ranges', 100).map((rawRange) => {
    const g = object(rawRange, 'Grade range')
    const range = {
      id: id(g.id, 'Grade range ID'),
      start: optionalNumber(g.start, 'Grade range start', 0, 100000),
      end: optionalNumber(g.end, 'Grade range end', 0, 100000),
      minGradePercent: optionalNumber(g.minGradePercent, 'Minimum grade', -100, 100),
      maxGradePercent: optionalNumber(g.maxGradePercent, 'Maximum grade', -100, 100),
    }
    if (range.start !== null && range.end !== null && range.end <= range.start)
      throw Error('Grade range stations must increase.')
    if (
      range.minGradePercent !== null &&
      range.maxGradePercent !== null &&
      range.maxGradePercent < range.minGradePercent
    )
      throw Error('A grade range maximum cannot be below its minimum.')
    return range
  })
  unique(gradeRanges, 'Grade ranges')
  return {
    gradeRanges,
    minSagK: optionalNumber(r.minSagK, 'Minimum sag K', 0, 1000),
    minCrestK: optionalNumber(r.minCrestK, 'Minimum crest K', 0, 1000),
    minCurveLengthM: optionalNumber(r.minCurveLengthM, 'Minimum vertical curve length', 0, 10000),
    minTangentLengthM: optionalNumber(r.minTangentLengthM, 'Minimum tangent length', 0, 10000),
  }
}
function parseVerticalControl(raw: unknown): VerticalControl {
  const c = object(raw, 'Vertical control point')
  const control = {
    id: id(c.id, 'Control point ID'),
    chainage: number(c.chainage, 'Control station', 0, 100000),
    elevation: optionalNumber(c.elevation, 'Control elevation', -12000, 12000),
    toleranceAboveM: number(c.toleranceAboveM, 'Tolerance above', 0, 1000),
    toleranceBelowM: number(c.toleranceBelowM, 'Tolerance below', 0, 1000),
    gradePercent: optionalNumber(c.gradePercent, 'Control grade', -100, 100),
    gradeTolerancePercent: number(c.gradeTolerancePercent, 'Grade tolerance', 0, 100),
  }
  if (control.elevation === null && control.gradePercent === null)
    throw Error('A vertical control point needs an elevation, a grade or both.')
  return control
}
function parseAlignment(raw: unknown): Alignment {
  const r = object(raw, 'Alignment'),
    key = id(r.id, 'Alignment ID')
  const points = list(r.points, 'Horizontal points', MAX_POINTS, 2).map((rawPoint, i) => {
    const p = object(rawPoint, 'Horizontal point')
    return {
      id: id(p.id, 'Point ID'),
      coordinate: coordinate(p.coordinate, `Point ${i + 1}`),
      radiusM: number(p.radiusM, 'Horizontal radius', 0, 10000),
    }
  })
  unique(points, 'Horizontal points')
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i - 1].coordinate, points[i].coordinate)
    if (d < 0.001) throw Error('An alignment cannot contain consecutive duplicate horizontal points.')
    length += d
  }
  if (length > 100000) throw Error('Split alignments longer than 100 km into separate projects.')
  const vertical = list(r.vertical, 'Vertical controls', 500).map((rawPoint) => {
    const p = object(rawPoint, 'Vertical control')
    return {
      id: id(p.id, 'Vertical control ID'),
      chainage: number(p.chainage, 'Vertical station', 0, 100000),
      elevation: number(p.elevation, 'Design elevation', -12000, 12000),
      curveLength: number(p.curveLength, 'Vertical curve length', 0, 10000),
    }
  })
  unique(vertical, 'Vertical controls')
  if (vertical.some((p, i) => i > 0 && p.chainage - vertical[i - 1].chainage < 0.001))
    throw Error('Vertical control stations must increase by at least 1 mm.')
  const overrides = list(r.overrides, 'Widenings', 200).map(parseOverride)
  unique(overrides, 'Widenings')
  const color = text(r.color, 'Alignment colour', 9)
  if (!/^#[a-fA-F0-9]{6}$/.test(color)) throw Error('Alignment colours must use #RRGGBB.')
  return {
    id: key,
    name: text(r.name, 'Alignment name'),
    color,
    points,
    vertical,
    template: parseTemplate(r.template),
    overrides,
    ...(r.engineering === undefined ? {} : { engineering: parseEngineering(r.engineering, parseTemplate) }),
    ...(r.verticalStandards === undefined ? {} : { verticalStandards: parseVerticalStandards(r.verticalStandards) }),
    ...(r.verticalControls === undefined
      ? {}
      : {
          verticalControls: (() => {
            const controls = list(r.verticalControls, 'Vertical control points', 200).map(parseVerticalControl)
            unique(controls, 'Vertical control points')
            return controls
          })(),
        }),
  }
}
function parseTerrain(raw: unknown): TerrainMetadata {
  const r = object(raw, 'Terrain')
  if (!['demo', 'geotiff', 'regional'].includes(String(r.kind))) throw Error('Unknown terrain source kind.')
  const result: TerrainMetadata = {
    kind: r.kind as TerrainMetadata['kind'],
    name: text(r.name, 'Terrain name'),
    resolutionM: number(r.resolutionM, 'Terrain resolution', 0.01, 5000),
    verticalReference: text(r.verticalReference, 'Vertical reference', 300),
  }
  if (r.epsg !== undefined) {
    const epsg = number(r.epsg, 'EPSG code', 1, 100000)
    if (!Number.isInteger(epsg)) throw Error('EPSG code must be an integer.')
    roadProjection(epsg)
    result.epsg = epsg
  }
  if (r.sha256 !== undefined) {
    const hash = text(r.sha256, 'Terrain checksum', 64)
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('Terrain checksum must be a SHA-256 digest.')
    result.sha256 = hash
  }
  if (r.sourceUrl !== undefined) {
    const url = new URL(text(r.sourceUrl, 'Terrain URL', 2000))
    if (url.protocol !== 'https:' || url.username || url.password)
      throw Error('Terrain provenance URLs must use HTTPS without credentials.')
    result.sourceUrl = url.href
  }
  if (r.raster !== undefined) {
    result.raster = validateRoadRaster(r.raster)
    if (
      result.kind !== 'geotiff' ||
      result.epsg !== result.raster.epsg ||
      result.sha256 !== result.raster.sha256 ||
      result.verticalReference !== result.raster.verticalReference
    )
      throw Error('Embedded raster metadata disagrees with the project terrain.')
    const latitude = roadProjection(result.raster.epsg).inverse(result.raster.origin)[1]
    const resolution = localRasterResolution(result.raster, latitude)
    if (!Number.isFinite(resolution) || Math.abs(resolution - result.resolutionM) > 1e-6 * Math.max(1, resolution))
      throw Error('Terrain resolution does not agree with the embedded native raster cells.')
  }
  if (result.kind === 'geotiff' && !result.raster && (!result.sourceUrl || !result.sha256))
    throw Error('A GeoTIFF terrain needs embedded cells or a source URL and checksum.')
  return result
}
function parseContext(raw: unknown): ContextFeature {
  const r = object(raw, 'Context feature'),
    g = object(r.geometry, 'Context geometry')
  if (!['stream', 'avoid', 'existing-road', 'harvest'].includes(String(r.kind)))
    throw Error('Context kind must be stream, avoid, existing-road or harvest.')
  let geometry: ContextFeature['geometry']
  if (g.type === 'LineString')
    geometry = {
      type: 'LineString',
      coordinates: list(g.coordinates, 'Context line', 10000, 2).map((p) => coordinate(p, 'Context vertex')),
    }
  else if (g.type === 'Polygon') {
    const rings = list(g.coordinates, 'Polygon rings', 100, 1).map((ring) =>
      list(ring, 'Polygon vertices', 10000, 4).map((p) => coordinate(p, 'Polygon vertex')),
    )
    if (rings.some((ring) => ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]))
      throw Error('Context polygon rings must be closed.')
    geometry = { type: 'Polygon', coordinates: rings }
  } else throw Error('Context must contain LineStrings or Polygons.')
  if ((r.kind === 'stream' || r.kind === 'existing-road') && geometry.type !== 'LineString')
    throw Error('Streams and existing roads need line geometry.')
  return {
    id: id(r.id, 'Context ID'),
    name: text(r.name, 'Context name'),
    kind: r.kind as ContextFeature['kind'],
    geometry,
    ...(r.kind === 'avoid' && r.routeCostPerM !== undefined && r.routeCostPerM !== null
      ? { routeCostPerM: number(r.routeCostPerM, 'Zone route cost', 0, 1e6) }
      : {}),
  }
}
function validateContextBudget(context: ContextFeature[]) {
  const count = context.reduce(
    (sum, f) =>
      sum +
      (f.geometry.type === 'LineString'
        ? f.geometry.coordinates.length
        : f.geometry.coordinates.reduce((n, ring) => n + ring.length, 0)),
    0,
  )
  if (count > MAX_CONTEXT_VERTICES) throw Error('Crop context to at most 50,000 vertices per project.')
  unique(context, 'Context features')
}
function parseCable(raw: unknown): CableLine {
  const r = object(raw, 'D-line')
  const result: CableLine = {
    id: id(r.id, 'D-line ID'),
    name: text(r.name, 'D-line name'),
    start: coordinate(r.start, 'D-line start'),
    end: coordinate(r.end, 'D-line end'),
    startHeight: number(r.startHeight, 'Yarder height', 0, 100),
    endHeight: number(r.endHeight, 'Tailhold height', 0, 100),
    deflectionPercent: number(r.deflectionPercent, 'Deflection', 0, 30),
    ...(r.startOffsetM === undefined ? {} : { startOffsetM: number(r.startOffsetM, 'D-line start offset', -200, 200) }),
    ...(r.endOffsetM === undefined ? {} : { endOffsetM: number(r.endOffsetM, 'D-line end offset', -200, 200) }),
    ...(r.yarderAt === undefined
      ? {}
      : {
          yarderAt: (() => {
            if (r.yarderAt !== 'start' && r.yarderAt !== 'end')
              throw Error('D-line yarder position must be start or end.')
            return r.yarderAt
          })(),
        }),
  }
  resolvedCableLine(result)
  return result
}
export function parseProject(raw: unknown): RoadProject {
  if (typeof raw === 'string') {
    if (raw.length > 120_000_000) throw Error('The project file exceeds 120 MB.')
    try {
      raw = JSON.parse(raw)
    } catch {
      throw Error('The project file is not valid JSON.')
    }
  }
  const r = object(raw, 'Project')
  if (r.schema !== 'pgmaps-road-project-v1') throw Error('Use a pgmaps-road-project-v1 project file.')
  const alignments = list(r.alignments, 'Alignments', MAX_ALIGNMENTS, 1).map(parseAlignment)
  unique(alignments, 'Alignments')
  if (alignments.reduce((sum, a) => sum + a.points.length, 0) > MAX_POINTS)
    throw Error('A project supports at most 2,000 horizontal control points.')
  const activeAlignmentId = id(r.activeAlignmentId, 'Active alignment')
  if (!alignments.some((a) => a.id === activeAlignmentId)) throw Error('The active alignment is missing.')
  const context = list(r.context, 'Context features', 500).map(parseContext)
  validateContextBudget(context)
  const cables = list(r.cables, 'D-lines', 100).map(parseCable)
  unique(cables, 'D-lines')
  const profiles =
    r.profiles === undefined
      ? undefined
      : list(r.profiles, 'Terrain profiles', 20).map((rawProfile) => {
          const p = object(rawProfile, 'Terrain profile')
          const points = list(p.points, 'Terrain profile points', MAX_POINTS, 2).map((point) =>
            coordinate(point, 'Terrain profile point'),
          )
          let length = 0
          for (let i = 1; i < points.length; i++) {
            const segment = distance(points[i - 1], points[i])
            if (segment < 0.001) throw Error('A terrain profile cannot contain consecutive duplicate points.')
            length += segment
          }
          if (length > 100000) throw Error('Split terrain profiles longer than 100 km.')
          return { id: id(p.id, 'Terrain profile ID'), name: text(p.name, 'Terrain profile name'), points }
        })
  if (profiles) {
    unique(profiles, 'Terrain profiles')
    if (profiles.reduce((count, p) => count + p.points.length, 0) > MAX_POINTS)
      throw Error('Terrain profiles support at most 2,000 vertices per project.')
  }
  return {
    schema: 'pgmaps-road-project-v1',
    name: text(r.name, 'Project name'),
    activeAlignmentId,
    alignments,
    terrain: parseTerrain(r.terrain),
    settings: parseSettings(r.settings),
    context,
    cables,
    ...(profiles ? { profiles } : {}),
  }
}
export function serializeProject(project: RoadProject): string {
  return JSON.stringify(parseProject(project), null, project.terrain.raster ? 0 : 2) + '\n'
}

/** A portable PGMaps library contains definitions only, never road geometry. */
export function serializeRoadLibrary(alignment: Alignment): string {
  const design = alignment.engineering ?? createEngineeringDesign()
  const validated = parseEngineering(design, parseTemplate)
  return (
    JSON.stringify(
      { schema: 'pgmaps-road-library-v1', templates: validated.templates, materials: validated.materials },
      null,
      2,
    ) + '\n'
  )
}
export function importRoadLibrary(alignment: Alignment, raw: unknown, mode: 'merge' | 'replace'): Alignment {
  if (typeof raw === 'string') {
    if (raw.length > 2000000) throw Error('Template libraries must be at most 2 MB.')
    try {
      raw = JSON.parse(raw)
    } catch {
      throw Error('The template library is not valid JSON.')
    }
  }
  const r = object(raw, 'Road library')
  if (r.schema !== 'pgmaps-road-library-v1') throw Error('Use a pgmaps-road-library-v1 JSON library.')
  const imported = parseEngineering(
    { ...createEngineeringDesign(), templates: r.templates, materials: r.materials },
    parseTemplate,
  )
  const existing = alignment.engineering ?? createEngineeringDesign()
  if (mode === 'replace')
    return {
      ...alignment,
      engineering: {
        ...existing,
        templates: imported.templates,
        materials: imported.materials,
        assignments: [],
        strata: [],
      },
    }
  const ids = new Set([...existing.templates, ...existing.materials].map((v) => v.id))
  let nextId = 1
  const uniqueId = (original: string) => {
    let value = original
    while (ids.has(value)) value = `library-${nextId++}`
    ids.add(value)
    return value
  }
  const engineering = {
    ...existing,
    templates: [...existing.templates, ...imported.templates.map((t) => ({ ...t, id: uniqueId(t.id) }))],
    materials: [...existing.materials, ...imported.materials.map((m) => ({ ...m, id: uniqueId(m.id) }))],
  }
  return { ...alignment, engineering: parseEngineering(engineering, parseTemplate) }
}

function features(raw: unknown): Array<{ geometry: Record<string, unknown>; properties: Record<string, unknown> }> {
  if (typeof raw === 'string') {
    if (raw.length > 20_000_000) throw Error('Crop GeoJSON imports to at most 20 MB.')
    try {
      raw = JSON.parse(raw)
    } catch {
      throw Error('The GeoJSON is not valid JSON.')
    }
  }
  const root = object(raw, 'GeoJSON')
  if (root.crs !== undefined) {
    const crs = object(root.crs, 'GeoJSON CRS'),
      properties = object(crs.properties, 'CRS properties')
    if (
      crs.type !== 'name' ||
      !['urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:EPSG::4326', 'EPSG:4326'].includes(String(properties.name))
    )
      throw Error('Reproject GeoJSON to WGS84 longitude/latitude (EPSG:4326) first.')
  }
  const values = root.type === 'FeatureCollection' ? list(root.features, 'GeoJSON features', 500, 1) : [root]
  return values.map((rawFeature) => {
    const f = object(rawFeature, 'GeoJSON feature')
    if (f.crs !== undefined && f !== root)
      throw Error('Per-feature CRS declarations are not supported. Reproject all features to WGS84.')
    if (f.type === 'Feature')
      return {
        geometry: (() => {
          const geometry = object(f.geometry, 'GeoJSON geometry')
          if (geometry.crs !== undefined)
            throw Error('Geometry-level CRS declarations are not supported. Reproject all features to WGS84.')
          return geometry
        })(),
        properties: f.properties == null ? {} : object(f.properties, 'Feature properties'),
      }
    return { geometry: f, properties: {} }
  })
}
export function importAlignmentGeoJson(raw: unknown): Alignment[] {
  const result: Alignment[] = []
  const nonRoadKinds = new Set([
    'stream',
    'avoid',
    'existing-road',
    'harvest',
    'crossing-review',
    'geometric-dline',
    'terrain-profile',
    'culvert',
    'borrow-site',
    'waste-site',
  ])
  for (const feature of features(raw)) {
    const g = feature.geometry
    // Project exports include context, terrain transects, D-lines and review points.
    // Only their explicitly identified road alignments should become editable roads.
    if (nonRoadKinds.has(String(feature.properties.kind))) continue
    const parts =
      g.type === 'LineString'
        ? [g.coordinates]
        : g.type === 'MultiLineString'
          ? list(g.coordinates, 'Line parts', MAX_ALIGNMENTS, 1)
          : null
    if (!parts) continue
    for (const [partIndex, part] of parts.entries()) {
      const key = `import-${result.length + 1}`,
        coords = list(part, 'Alignment coordinates', MAX_POINTS, 2).map((p) => coordinate(p, 'Alignment vertex')),
        baseName =
          typeof feature.properties.name === 'string'
            ? feature.properties.name
            : `Imported alignment ${result.length + 1}`
      result.push(
        parseAlignment({
          id: key,
          name: parts.length > 1 ? `${baseName} (part ${partIndex + 1})` : baseName,
          color: '#d97706',
          points: coords.map((p, i) => ({ id: `${key}-p${i}`, coordinate: p, radiusM: 0 })),
          vertical: [],
          template: { ...DEFAULT_TEMPLATE },
          overrides: [],
        }),
      )
    }
  }
  if (!result.length)
    throw Error(
      'No road alignments found. Import LineString or MultiLineString features; context and terrain transects are skipped.',
    )
  if (result.length > MAX_ALIGNMENTS || result.reduce((n, a) => n + a.points.length, 0) > MAX_POINTS)
    throw Error('Import at most 20 alignments and 2,000 vertices at a time. Split larger networks first.')
  return result
}
export function importContextGeoJson(raw: unknown): ContextFeature[] {
  const result: ContextFeature[] = []
  for (const f of features(raw)) {
    const g = f.geometry,
      isLine = ['LineString', 'MultiLineString'].includes(String(g.type))
    const parts =
      g.type === 'MultiLineString' || g.type === 'MultiPolygon'
        ? list(g.coordinates, 'Geometry parts', 500, 1)
        : [g.coordinates]
    if (!['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(String(g.type)))
      throw Error('Context imports require line or polygon geometry.')
    for (const part of parts)
      result.push(
        parseContext({
          id: `context-${result.length + 1}`,
          name:
            typeof f.properties.name === 'string'
              ? f.properties.name
              : `Imported ${isLine ? 'stream' : 'review area'} ${result.length + 1}`,
          kind: f.properties.kind ?? (isLine ? 'stream' : 'avoid'),
          geometry: { type: isLine ? 'LineString' : 'Polygon', coordinates: part },
        }),
      )
  }
  if (result.length > 500) throw Error('Import at most 500 context features.')
  validateContextBudget(result)
  return result
}

export function projectGeoJson(project: RoadProject, analyses: Map<string, RoadAnalysis>): GeoJSON.FeatureCollection {
  const output: GeoJSON.Feature[] = []
  for (const a of project.alignments) {
    const analysis = analyses.get(a.id)
    if (analysis && !analysis.stations.length)
      throw Error(
        `No calculated geometry is available for ${a.name}. Resolve its model errors before exporting results.`,
      )
    output.push({
      type: 'Feature',
      id: a.id,
      properties: {
        kind: 'alignment',
        name: a.name,
        alignment_id: a.id,
        schema: project.schema,
        terrain: project.terrain.name,
        terrain_resolution_m: project.terrain.resolutionM,
        vertical_reference: project.terrain.verticalReference,
        terrain_sha256: project.terrain.sha256 ?? null,
        length_m: analysis?.length ?? null,
        coverage_percent: analysis?.coveragePercent ?? null,
        cut_m3: analysis?.cutVolumeM3 ?? null,
        fill_m3: analysis?.fillVolumeM3 ?? null,
        status:
          analysis && analysis.coveragePercent >= 99.999 && analysis.engineering?.complete !== false
            ? 'preliminary-complete'
            : 'partial-or-not-calculated',
        horizontal_controls: a.points,
        vertical_controls: a.vertical,
        template: a.template,
        widening: a.overrides,
        engineering: a.engineering ?? null,
      },
      geometry: {
        type: 'LineString',
        coordinates:
          analysis && analysis.centerline.length >= 2 ? analysis.centerline : a.points.map((p) => p.coordinate),
      },
    })
    for (const crossing of analysis?.crossings ?? [])
      output.push({
        type: 'Feature',
        id: `${a.id}-${crossing.id}`,
        geometry: { type: 'Point', coordinates: crossing.coordinate },
        properties: {
          kind: 'crossing-review',
          alignment_id: a.id,
          name: crossing.name,
          context_kind: crossing.kind,
          chainage_m: crossing.chainage,
          note: 'Geometric intersection only; structure type and capacity are not designed.',
        },
      })
    for (const c of analysis?.engineering?.culverts ?? [])
      output.push({
        type: 'Feature',
        id: `${a.id}-${c.id}`,
        geometry: { type: 'LineString', coordinates: [c.start, c.end] },
        properties: {
          kind: 'culvert',
          alignment_id: a.id,
          name: c.name,
          chainage_m: c.chainage,
          grade_percent: c.gradePercent,
          cover_m: c.coverM,
          required_length_m: c.requiredLengthM,
          installed_cost_cad: c.installedCost,
          complete: c.complete,
          warnings: c.warnings,
          vertical_reference: project.terrain.verticalReference,
        },
      })
    for (const site of a.engineering?.sites ?? []) {
      if (site.chainage > (analysis?.length ?? 0)) continue
      output.push({
        type: 'Feature',
        id: `${a.id}-${site.id}`,
        geometry: { type: 'Point', coordinates: positionAt(a, site.chainage).coordinate },
        properties: {
          kind: `${site.kind}-site`,
          alignment_id: a.id,
          name: site.name,
          chainage_m: site.chainage,
          access_distance_m: site.accessDistanceM,
          capacity_m3: site.capacityM3,
          volume_basis: site.kind === 'borrow' ? 'compacted' : 'bank',
          note: 'Road access station; the off-road pit footprint has not been surveyed.',
        },
      })
    }
  }
  for (const f of project.context)
    output.push({ type: 'Feature', id: f.id, properties: { kind: f.kind, name: f.name }, geometry: f.geometry })
  for (const c of project.cables) {
    const physical = resolvedCableLine(c)
    output.push({
      type: 'Feature',
      id: c.id,
      geometry: { type: 'LineString', coordinates: [physical.start, physical.end] },
      properties: {
        kind: 'geometric-dline',
        name: c.name,
        yarder_height_m: c.startHeight,
        tailhold_height_m: c.endHeight,
        assumed_deflection_percent: c.deflectionPercent,
        start_offset_m: c.startOffsetM ?? 0,
        end_offset_m: c.endOffsetM ?? 0,
        yarder_at: c.yarderAt ?? 'start',
        original_start: c.start,
        original_end: c.end,
        note: 'Geometric clearance screen; no tension, load or anchor-capacity solution.',
      },
    })
  }
  for (const profile of project.profiles ?? [])
    output.push({
      type: 'Feature',
      id: profile.id,
      geometry: { type: 'LineString', coordinates: profile.points },
      properties: {
        kind: 'terrain-profile',
        name: profile.name,
        terrain: project.terrain.name,
        terrain_resolution_m: project.terrain.resolutionM,
        vertical_reference: project.terrain.verticalReference,
        note: 'Ground transect only; not a road alignment or a designed grade.',
      },
    })
  return { type: 'FeatureCollection', features: output }
}
function csvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return ''
  if (typeof value === 'number') return String(value)
  const guarded = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replace(/"/g, '""')}"`
}
export function stationsCsv(analysis: RoadAnalysis, metadata: TerrainMetadata): string {
  if (!analysis.stations.length)
    throw Error('The road analysis is unavailable. Resolve the model errors before exporting results.')
  const header = [
    'station_m',
    'longitude',
    'latitude',
    'ground_elevation_m',
    'design_elevation_m',
    'design_grade_pct',
    'ground_grade_pct',
    'horizontal_radius_m',
    'left_width_m',
    'right_width_m',
    'cut_area_m2',
    'fill_area_m2',
    'interval_cut_volume_m3',
    'interval_fill_volume_m3',
    'mass_balance_m3',
    'complete',
    'flags',
    'terrain',
    'terrain_resolution_m',
    'vertical_reference',
    'terrain_sha256',
  ]
  const rows = analysis.stations.map((s) =>
    [
      s.chainage,
      ...s.coordinate,
      s.groundElevation,
      s.designElevation,
      s.gradePercent,
      s.groundGradePercent,
      s.curveRadiusM,
      s.leftWidth,
      s.rightWidth,
      s.cutAreaM2,
      s.fillAreaM2,
      s.cutVolumeM3,
      s.fillVolumeM3,
      s.massM3,
      s.complete ? 'yes' : 'no',
      s.flags.join('; '),
      metadata.name,
      metadata.resolutionM,
      metadata.verticalReference,
      metadata.sha256 ?? '',
    ]
      .map(csvValue)
      .join(','),
  )
  return header.join(',') + '\r\n' + rows.join('\r\n') + '\r\n'
}
export function engineeringCsv(analysis: RoadAnalysis, metadata: TerrainMetadata): string {
  if (!analysis.stations.length)
    throw Error('Engineering quantities are unavailable. Resolve the model errors before exporting results.')
  const header = [
    'record_type',
    'id',
    'name',
    'from_station_m',
    'to_station_m',
    'bank_m3',
    'compacted_m3',
    'haul_distance_m',
    'quantity',
    'unit',
    'cost_cad',
    'status',
    'terrain',
    'terrain_resolution_m',
    'vertical_reference',
    'terrain_sha256',
  ]
  const rows: (string | number | null | undefined)[][] = []
  const engineering = analysis.engineering
  const status =
    analysis.coveragePercent >= 99.999 && engineering?.complete !== false
      ? 'preliminary-covered'
      : 'partial-covered-subtotal'
  for (const material of engineering?.materials ?? [])
    rows.push([
      'material',
      material.materialId,
      material.name,
      null,
      null,
      material.bankCutM3,
      material.usableCompactedM3,
      null,
      material.unusableBankM3,
      'unusable bank m3',
      material.excavationCost,
      status,
    ])
  for (const culvert of engineering?.culverts ?? [])
    rows.push([
      'culvert',
      culvert.id,
      culvert.name,
      culvert.chainage,
      culvert.chainage,
      null,
      null,
      null,
      culvert.barrelLengthM ?? culvert.profile.at(-1)?.distanceM,
      culvert.barrelLengthM === null ? 'provisional horizontal barrel m' : 'inclined barrel m',
      culvert.installedCost,
      culvert.warnings.join('; ') || (culvert.complete ? 'geometry-covered' : 'incomplete'),
    ])
  for (const movement of engineering?.movements ?? [])
    rows.push([
      'haul',
      movement.id,
      movement.kind,
      movement.fromChainage,
      movement.toChainage,
      movement.bankVolumeM3,
      movement.compactedVolumeM3,
      movement.distanceM,
      movement.transportedVolumeM3,
      `${movement.volumeBasis} m3`,
      movement.haulCost,
      movement.category,
    ])
  for (const [key, value] of Object.entries(engineering?.costs ?? { total: analysis.estimatedCost }))
    rows.push(['cost', key, key, null, null, null, null, null, null, 'CAD', value, status])
  return (
    header.join(',') +
    '\r\n' +
    rows
      .map((row) =>
        [...row, metadata.name, metadata.resolutionM, metadata.verticalReference, metadata.sha256]
          .map(csvValue)
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  )
}
export function terrainProfileCsv(analysis: RoadAnalysis, metadata: TerrainMetadata): string {
  if (!analysis.stations.length)
    throw Error('The terrain profile is unavailable. Resolve the model errors before exporting results.')
  const header = [
    'station_m',
    'longitude',
    'latitude',
    'ground_elevation_m',
    'ground_grade_percent',
    'interval_length_m',
    'terrain',
    'terrain_resolution_m',
    'vertical_reference',
    'terrain_sha256',
  ]
  return (
    header.join(',') +
    '\r\n' +
    analysis.stations
      .map((station, index) =>
        [
          station.chainage,
          ...station.coordinate,
          station.groundElevation,
          station.groundGradePercent,
          index ? station.chainage - analysis.stations[index - 1].chainage : 0,
          metadata.name,
          metadata.resolutionM,
          metadata.verticalReference,
          metadata.sha256,
        ]
          .map(csvValue)
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  )
}
const html = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const fmt = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-CA', { maximumFractionDigits: digits })
function reportProfile(analysis: RoadAnalysis) {
  const hasDesign = analysis.stations.some((s) => s.designElevation !== null)
  const elevations = analysis.stations
    .flatMap((s) => [s.groundElevation, s.designElevation])
    .filter((n): n is number => n !== null && Number.isFinite(n))
  if (!elevations.length || !analysis.length) return '<p>No supported profile samples.</p>'
  const low = Math.min(...elevations) - 2,
    high = Math.max(...elevations) + 2,
    height = Math.max(1, high - low)
  const x = (s: number) => 55 + (s / analysis.length) * 875,
    y = (z: number) => 220 - ((z - low) / height) * 180
  const path = (key: 'groundElevation' | 'designElevation') => {
    let pen = false
    return analysis.stations
      .map((s) => {
        const z = s[key]
        if (z === null || !Number.isFinite(z)) {
          pen = false
          return ''
        }
        const command = pen ? 'L' : 'M'
        pen = true
        return `${command}${x(s.chainage).toFixed(2)},${y(z).toFixed(2)}`
      })
      .join(' ')
  }
  return `<svg viewBox="0 0 960 270" role="img" aria-label="${hasDesign ? 'Ground and design' : 'Ground'} longitudinal elevation profile"><rect width="960" height="270" fill="#f8fafc"/><path d="M55 30V220H930" fill="none" stroke="#94a3b8"/><path d="${path('groundElevation')}" fill="none" stroke="#64748b" stroke-width="2"/><path d="${path('designElevation')}" fill="none" stroke="#c2410c" stroke-width="3"/><g font-size="12" fill="#334155"><text x="6" y="45">${fmt(high)} m</text><text x="6" y="218">${fmt(low)} m</text><text x="55" y="242">0 m</text><text x="850" y="242">${fmt(analysis.length)} m</text><text x="60" y="20">Ground (grey)${hasDesign ? ' · design (orange)' : ''} · chainage in horizontal metres</text></g></svg>`
}
function reportEngineering(analysis: RoadAnalysis): string {
  const e = analysis.engineering
  if (!e) return ''
  return `<h2>Engineering cost breakdown</h2><table><thead><tr><th>Item</th><th>CAD</th></tr></thead><tbody>${Object.entries(
    e.costs,
  )
    .map(([key, value]) => `<tr><td>${html(key)}</td><td>$${fmt(value, 2)}</td></tr>`)
    .join(
      '',
    )}</tbody></table><h2>Material quantities</h2><p>Ground horizons are entered assumptions or measurements. They are not inferred from the terrain model. Excavated stripping is classified cut only; undercut beneath fill is not included.</p><table><thead><tr><th>Material</th><th>Bank cut m³</th><th>Usable compacted m³</th><th>Unusable bank m³</th><th>Excavation CAD</th></tr></thead><tbody>${e.materials.map((m) => `<tr><td>${html(m.name)}</td><td>${fmt(m.bankCutM3)}</td><td>${fmt(m.usableCompactedM3)}</td><td>${fmt(m.unusableBankM3)}</td><td>${fmt(m.excavationCost, 2)}</td></tr>`).join('')}</tbody></table><h2>Culvert geometry</h2>${e.culverts.length ? `<table><thead><tr><th>Name</th><th>Station m</th><th>Grade %</th><th>Minimum cover m</th><th>Required horizontal span m</th><th>Inclined barrel m</th><th>Flags</th></tr></thead><tbody>${e.culverts.map((c) => `<tr><td>${html(c.name)}</td><td>${fmt(c.chainage)}</td><td>${fmt(c.gradePercent, 2)}</td><td>${fmt(c.coverM, 2)}</td><td>${fmt(c.requiredLengthM)}</td><td>${fmt(c.barrelLengthM)}</td><td>${html(c.warnings.join('; '))}</td></tr>`).join('')}</tbody></table>` : '<p>No culvert inventory supplied.</p>'}<h2>Haul scenario</h2><p>${e.haul.enabled ? 'Deterministic nearest-source allocation within covered runs enabled.' : 'Haul allocation disabled.'} Borrow: ${fmt(e.haul.borrowCompactedM3)} compacted m³; waste: ${fmt(e.haul.wasteBankM3)} bank m³; cut/fill and borrow haul: ${fmt(e.haul.haulM3Km)} compacted m³·km; waste haul: ${fmt(e.haul.wasteHaulM3Km)} bank m³·km. Unallocated borrow: ${fmt(e.haul.unallocatedBorrowM3)} compacted m³; unallocated waste: ${fmt(e.haul.unallocatedWasteM3)} bank m³. Haul distances follow road chainage plus site access; this is not a global haul optimizer.</p>${e.warnings.length ? `<ul>${e.warnings.map((w) => `<li>${html(w)}</li>`).join('')}</ul>` : ''}`
}
export function terrainProfileReportHtml(name: string, analysis: RoadAnalysis, metadata: TerrainMetadata): string {
  if (!analysis.stations.length)
    throw Error('The terrain profile is unavailable. Resolve the model errors before exporting results.')
  const known = analysis.stations.filter((s) => s.groundElevation !== null)
  let ascent = 0,
    descent = 0,
    covered = 0
  for (let i = 1; i < analysis.stations.length; i++) {
    const a = analysis.stations[i - 1],
      b = analysis.stations[i]
    if (a.groundElevation === null || b.groundElevation === null) continue
    const delta = b.groundElevation - a.groundElevation
    ascent += Math.max(0, delta)
    descent += Math.max(0, -delta)
    covered += b.chainage - a.chainage
  }
  const rows = analysis.stations
    .map(
      (s, i) =>
        `<tr><td>${fmt(s.chainage)}</td><td>${fmt(s.groundElevation, 2)}</td><td>${fmt(s.groundGradePercent, 2)}</td><td>${fmt(i ? s.chainage - analysis.stations[i - 1].chainage : 0)}</td></tr>`,
    )
    .join('')
  const groundOnly = { ...analysis, stations: analysis.stations.map((s) => ({ ...s, designElevation: null })) }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(name)} · Terrain profile</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:32px auto;padding:0 20px;color:#172b25}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:6px;border-bottom:1px solid #ddd;text-align:right}svg{width:100%}h2{font-size:19px}thead{display:table-header-group}tr{break-inside:avoid}@media print{body{margin:0}}</style></head><body><h1>${html(name)}</h1><p>Ground-only stream / slope transect</p><p>Length ${fmt(analysis.length)} m · supported intervals ${fmt(covered)} m (${fmt(analysis.length ? (100 * covered) / analysis.length : 0)}%) · ground range ${known.length ? `${fmt(Math.min(...known.map((s) => s.groundElevation!)))}–${fmt(Math.max(...known.map((s) => s.groundElevation!)))} m` : 'unknown'} · sampled ascent ${fmt(ascent)} m · sampled descent ${fmt(descent)} m</p><p>${html(metadata.name)} · ${fmt(metadata.resolutionM, 2)} m source spacing · ${html(metadata.verticalReference)} · SHA-256 ${html(metadata.sha256 ?? 'not applicable')}</p>${reportProfile(groundOnly)}<p>No road formation, cut/fill or construction costs are assigned. Missing terrain remains a gap. Ground grades describe sampled intervals; source resolution and sampling determine which terrain features can be resolved.</p><h2>Profile stations</h2><table><thead><tr><th>Station m</th><th>Ground m</th><th>Ground grade %</th><th>Interval m</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}
export function projectReportHtml(project: RoadProject, analysis: RoadAnalysis): string {
  if (!analysis.stations.length)
    throw Error('The road analysis is unavailable. Resolve the model errors before exporting results.')
  const active = project.alignments.find((a) => a.id === project.activeAlignmentId),
    metadata = project.terrain
  const rows = analysis.stations
    .map(
      (s) =>
        `<tr><td>${fmt(s.chainage)}</td><td>${fmt(s.groundElevation, 2)}</td><td>${fmt(s.designElevation, 2)}</td><td>${fmt(s.gradePercent, 2)}</td><td>${fmt(s.cutAreaM2, 2)}</td><td>${fmt(s.fillAreaM2, 2)}</td><td>${fmt(s.massM3)}</td><td>${html(s.flags.join('; ') || (s.complete ? 'Complete' : 'Partial'))}</td></tr>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><title>${html(project.name)} · Road planning report</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#172b25;max-width:1100px;margin:36px auto;padding:0 24px}h1{font-size:28px;line-height:1.2}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #d1d5db;padding-bottom:6px}.eyebrow{font-size:11px;letter-spacing:2px;color:#527465}.status{padding:12px 16px;background:#fff7ed;border-left:4px solid #d97706}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.metric{padding:12px;background:#f1f5f2}.metric strong{display:block;font-size:23px}.muted{color:#53665e}table{width:100%;border-collapse:collapse;font-size:11px}th,td{text-align:right;padding:6px;border-bottom:1px solid #d8e0db}th{background:#eaf0ec}td:last-child{text-align:left}tr{break-inside:avoid}svg{width:100%;max-height:310px}dl{display:grid;grid-template-columns:170px 1fr;gap:5px}dd{margin:0;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none;font-size:10pt}.metrics{grid-template-columns:repeat(4,1fr)}h2{break-after:avoid}thead{display:table-header-group}a{color:inherit}}</style></head><body><div class="eyebrow">PGMAPS · FORESTRY ROAD PLANNING</div><h1>${html(project.name)}</h1><p>${html(active?.name ?? 'Selected alignment')}</p><p class="status"><strong>${analysis.coveragePercent >= 99.999 ? 'Preliminary model · complete sampled earthworks coverage' : 'Partial model · totals cover supported intervals only'}</strong><br>${fmt(analysis.coveragePercent)}% coverage (${fmt(analysis.completeLength)} of ${fmt(analysis.length)} m). ${metadata.kind === 'demo' ? 'Synthetic training terrain: all quantities and locations are illustrative.' : metadata.kind === 'regional' ? 'Coarse regional terrain: corridor screening only; resolution is inadequate for construction quantities.' : 'Source terrain supports preliminary geometry; accuracy is not independently surveyed.'}</p><div class="metrics"><div class="metric">Length<strong>${fmt(analysis.length)} m</strong></div><div class="metric">Cut<strong>${fmt(analysis.cutVolumeM3)} m³</strong></div><div class="metric">Fill<strong>${fmt(analysis.fillVolumeM3)} m³</strong></div><div class="metric">Scenario cost<strong>$${fmt(analysis.estimatedCost, 0)}</strong></div></div><h2>Terrain and assumptions</h2><dl><dt>Source</dt><dd>${html(metadata.name)}</dd><dt>Native/display spacing</dt><dd>${fmt(metadata.resolutionM, 2)} m; source grid resolution, not vertical accuracy</dd><dt>Horizontal CRS</dt><dd>${metadata.epsg ? `EPSG:${metadata.epsg}` : 'Geographic alignment; source CRS unspecified'}</dd><dt>Vertical reference</dt><dd>${html(metadata.verticalReference)}</dd><dt>Source URL</dt><dd>${html(metadata.sourceUrl ?? 'Local or synthetic source')}</dd><dt>SHA-256</dt><dd>${html(metadata.sha256 ?? 'Not applicable')}</dd><dt>Sampling interval</dt><dd>${fmt(project.settings.stationInterval)} m requested; exact event stations and computation limits can alter spacing</dd><dt>Review thresholds</dt><dd>Grade ${fmt(project.settings.maxGradePercent)}%; minimum radius ${fmt(project.settings.minRadius)} m (user assumptions)</dd><dt>Cost assumptions</dt><dd>Cut $${fmt(project.settings.cutRate)}/m³; fill $${fmt(project.settings.fillRate)}/m³; surfacing $${fmt(project.settings.surfacingRate)}/m³; clearing $${fmt(project.settings.clearingRate)}/m²; reusable cut factor ${fmt(project.settings.shrinkFactor, 2)}</dd></dl><h2>Longitudinal profile</h2>${reportProfile(analysis)}${reportEngineering(analysis)}<h2>Quantity basis and limitations</h2><p>Cut/fill areas are integrated from sampled cross-sections; interval volumes use average end areas. No-data or unclosed daylight sections leave an interval incomplete. Mass balance applies entered material reuse and compaction factors, or the default reusable-cut factor for unclassified ground. Costs use the entered rates, structures, haul scenario, mobilization and contingency where supplied; zero rates remain unpriced. Geotechnical treatments are not modeled. Ground is held separate from designed road elevation.</p><p>This is a preliminary planning record. It does not establish construction suitability, slope stability, drainage capacity, fish passage, permits or cable operating safety. D-lines screen assumed geometry without cable tension, load or anchor analysis. Crossing intersections require review. Entered culverts provide geometry and cover checks, not a hydraulic or fish-passage design.</p>${analysis.warnings.length ? `<h2>Model flags</h2><ul>${analysis.warnings.map((w) => `<li>${html(w)}</li>`).join('')}</ul>` : ''}<h2>Crossing review</h2>${analysis.crossings.length ? `<table><thead><tr><th>Station m</th><th>Name</th><th>Kind</th></tr></thead><tbody>${analysis.crossings.map((c) => `<tr><td>${fmt(c.chainage)}</td><td>${html(c.name)}</td><td>${html(c.kind)}</td></tr>`).join('')}</tbody></table>` : '<p>No intersections with the supplied context were found. This does not establish the absence of streams or constraints.</p>'}<h2>Station schedule</h2><table><thead><tr><th>Station m</th><th>Ground m</th><th>Design m</th><th>Grade %</th><th>Cut m²</th><th>Fill m²</th><th>Mass m³</th><th>Review flags</th></tr></thead><tbody>${rows}</tbody></table><p class="muted">Project schema: ${project.schema}. Export the project JSON for editable geometry and the CSV for numeric station values. Geographic export coordinates are WGS84 longitude/latitude; design elevations retain the recorded terrain vertical reference.</p></body></html>`
}

export { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE }

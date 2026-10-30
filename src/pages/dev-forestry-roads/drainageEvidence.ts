/** Portable drainage settings and compact evidence. Full flow grids remain recomputable, never hidden in JSON. */
import { DEFAULT_DRAINAGE_SETTINGS, type DrainageRun, type DrainageSettings } from './drainageRun'
import type { PourPoint } from './drainageCatchments'
import type { Alignment, RoadSettings, TerrainMetadata } from './types'
import { positionAt } from './engine'

export const MAX_DRAINAGE_RECORDS = 20
export const MAX_DRAINAGE_EVIDENCE_VERTICES = 200_000
export interface DrainageEvidence {
  schema: 'pgmaps-drainage-evidence-v1'
  alignmentId: string
  createdAt: string
  fingerprint: string
  settings: DrainageSettings
  pourPoint?: PourPoint
  watershedMinAreaHa?: number
  terrain: {
    name: string
    resolutionM: number
    verticalReference: string
    sha256?: string
    sourceKind: TerrainMetadata['kind']
    immutable: boolean
  }
  grid: { cellM: number; width: number; height: number; origin: [number, number] }
  summary: {
    crossings: number
    redirected: number
    lowPoints: number
    pondingAreaM2: number
    undersized: number
    culverts: number
    changedCells: number
  }
  warnings: string[]
  geometryScope: 'catchments-and-review-locations'
  features: GeoJSON.FeatureCollection
}
export interface DrainageProjectState {
  settings: DrainageSettings
  pourPoint?: PourPoint
  watershedMinAreaHa?: number
  records: DrainageEvidence[]
}
export interface DrainageFingerprintInput {
  alignment: Alignment
  roadSettings: RoadSettings
  terrain: TerrainMetadata
  settings: DrainageSettings
  pourPoint?: PourPoint
  watershedMinAreaHa?: number
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function number(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}
function text(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || value.length > max || !value.trim()) throw Error(`${label} is missing or too long.`)
  return value
}
function coordinate(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw Error('Drainage coordinates need longitude and latitude.')
  return [number(value[0], -180, 180, 'Drainage longitude'), number(value[1], -85, 85, 'Drainage latitude')]
}
export function parseDrainageSettings(value?: unknown): DrainageSettings {
  const r = value === undefined ? DEFAULT_DRAINAGE_SETTINGS : object(value, 'Drainage settings')
  return {
    rainfallMmPerHr: number(r.rainfallMmPerHr, 1, 500, 'Rainfall'),
    runoffCoefficient: number(r.runoffCoefficient, 0.05, 1, 'Runoff coefficient'),
    manningN: number(r.manningN, 0.009, 0.05, 'Manning roughness'),
    streamThresholdHa: number(r.streamThresholdHa, 0.05, 500, 'Stream threshold'),
    bufferM: number(r.bufferM, 20, 2_000, 'Drainage buffer'),
  }
}
export function parsePourPoint(value: unknown): PourPoint {
  const r = object(value, 'Pour point')
  if (r.surface !== 'existing' && r.surface !== 'design')
    throw Error('Choose existing or design surface for the pour point.')
  return {
    coordinate: coordinate(r.coordinate),
    snapRadiusM: number(r.snapRadiusM, 0, 2_000, 'Pour-point snap radius'),
    surface: r.surface,
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
/** Stable change detector, not an authenticity signature. Includes raster content as well as recorded source metadata. */
export function drainageInputFingerprint(input: DrainageFingerprintInput): string {
  const alignment = { ...input.alignment }
  delete alignment.fullCostRecord
  const terrain = { ...input.terrain }
  delete terrain.backgrounds
  const source = canonical({ ...input, alignment, terrain })
  let a = 2166136261,
    b = 2246822519
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619)
    b = Math.imul(b ^ source.charCodeAt(i), 3266489917)
  }
  return `drainage-v1-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

function parseFeatureCollection(value: unknown): GeoJSON.FeatureCollection {
  const r = object(value, 'Drainage evidence geometry')
  if (r.type !== 'FeatureCollection' || !Array.isArray(r.features) || r.features.length > 5_000)
    throw Error('Drainage evidence needs at most 5,000 features.')
  let vertices = 0
  const features = r.features.map((value) => {
    const f = object(value, 'Drainage feature'),
      g = object(f.geometry, 'Drainage geometry')
    if (f.type !== 'Feature') throw Error('Drainage geometry entries must be GeoJSON features.')
    const point = (value: unknown) => {
      if (++vertices > MAX_DRAINAGE_EVIDENCE_VERTICES) throw Error('Drainage evidence exceeds 200,000 vertices.')
      return coordinate(value)
    }
    const line = (value: unknown, ring = false) => {
      if (!Array.isArray(value) || value.length < (ring ? 4 : 2))
        throw Error('Drainage line or ring has too few vertices.')
      const c = value.map(point)
      if (ring && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1]))
        throw Error('Drainage polygon rings must close.')
      return c
    }
    const polygon = (value: unknown) => {
      if (!Array.isArray(value) || !value.length) throw Error('Drainage polygon has no rings.')
      return value.map((value) => line(value, true))
    }
    let geometry: GeoJSON.Geometry
    if (g.type === 'Point') geometry = { type: 'Point', coordinates: point(g.coordinates) }
    else if (g.type === 'LineString') geometry = { type: 'LineString', coordinates: line(g.coordinates) }
    else if (g.type === 'Polygon') geometry = { type: 'Polygon', coordinates: polygon(g.coordinates) }
    else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length)
      geometry = { type: 'MultiPolygon', coordinates: g.coordinates.map(polygon) }
    else throw Error('Unsupported drainage evidence geometry.')
    const raw = object(f.properties ?? {}, 'Drainage feature properties'),
      properties: Record<string, string | number | boolean | number[]> = {}
    for (const [key, v] of Object.entries(raw)) {
      if (key.length > 100) throw Error('Drainage property name is too long.')
      if (
        (typeof v === 'number' && Number.isFinite(v)) ||
        typeof v === 'boolean' ||
        (typeof v === 'string' && v.length <= 2_000)
      )
        properties[key] = v as string | number | boolean
      else if (key === 'outlet') properties[key] = coordinate(v)
      else throw Error('Drainage property must be a finite number, short text or boolean.')
    }
    return { type: 'Feature' as const, geometry, properties }
  })
  return { type: 'FeatureCollection', features }
}
export function parseDrainageEvidence(value: unknown): DrainageEvidence {
  const r = object(value, 'Drainage evidence'),
    s = object(r.summary, 'Drainage summary'),
    terrain = object(r.terrain, 'Drainage terrain'),
    grid = object(r.grid, 'Drainage grid')
  if (r.schema !== 'pgmaps-drainage-evidence-v1' || r.geometryScope !== 'catchments-and-review-locations')
    throw Error('Unsupported drainage evidence format.')
  if (!['demo', 'geotiff', 'regional'].includes(String(terrain.sourceKind)) || typeof terrain.immutable !== 'boolean')
    throw Error('Drainage terrain needs its source kind and reproducibility status.')
  if (terrain.sourceKind === 'regional' && terrain.immutable)
    throw Error('Unchecksummed regional drainage terrain cannot be marked immutable.')
  const createdAt = text(r.createdAt, 40, 'Drainage run date')
  if (!Number.isFinite(Date.parse(createdAt))) throw Error('Drainage run date is invalid.')
  const fingerprint = text(r.fingerprint, 64, 'Drainage fingerprint')
  if (!/^drainage-v1-[0-9a-f]{16}$/.test(fingerprint)) throw Error('Drainage fingerprint is invalid.')
  const width = number(grid.width, 1, 4_194_304, 'Drainage grid width'),
    height = number(grid.height, 1, 4_194_304, 'Drainage grid height')
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width * height > 4_194_304 ||
    !Array.isArray(grid.origin) ||
    grid.origin.length !== 2
  )
    throw Error('Drainage grid exceeds its cell budget or has an invalid origin.')
  if (!Array.isArray(r.warnings) || r.warnings.length > 300) throw Error('Drainage evidence has too many warnings.')
  return {
    schema: 'pgmaps-drainage-evidence-v1',
    geometryScope: 'catchments-and-review-locations',
    alignmentId: text(r.alignmentId, 100, 'Drainage road ID'),
    createdAt,
    fingerprint,
    settings: parseDrainageSettings(r.settings),
    ...(r.pourPoint === undefined ? {} : { pourPoint: parsePourPoint(r.pourPoint) }),
    ...(r.watershedMinAreaHa === undefined
      ? {}
      : { watershedMinAreaHa: number(r.watershedMinAreaHa, 0, 100_000, 'Minimum watershed area') }),
    terrain: {
      name: text(terrain.name, 2_000, 'Drainage terrain name'),
      resolutionM: number(terrain.resolutionM, 0.001, 100_000, 'Drainage source resolution'),
      verticalReference: text(terrain.verticalReference, 2_000, 'Drainage vertical reference'),
      sourceKind: terrain.sourceKind as TerrainMetadata['kind'],
      immutable: terrain.immutable,
      ...(terrain.sha256 === undefined ? {} : { sha256: text(terrain.sha256, 100, 'Drainage source hash') }),
    },
    grid: {
      width,
      height,
      origin: [
        number(grid.origin[0], -1e10, 1e10, 'Drainage grid X'),
        number(grid.origin[1], -1e10, 1e10, 'Drainage grid Y'),
      ],
      cellM: number(grid.cellM, 0.001, 100_000, 'Drainage grid cell'),
    },
    summary: {
      crossings: number(s.crossings, 0, 4_194_304, 'Crossings'),
      redirected: number(s.redirected, 0, 4_194_304, 'Redirected crossings'),
      lowPoints: number(s.lowPoints, 0, 4_194_304, 'Low points'),
      pondingAreaM2: number(s.pondingAreaM2, 0, 1e15, 'Ponding area'),
      undersized: number(s.undersized, 0, 100, 'Undersized culverts'),
      culverts: number(s.culverts, 0, 100, 'Culverts'),
      changedCells: number(s.changedCells, 0, 4_194_304, 'Changed cells'),
    },
    warnings: r.warnings.map((w) => text(w, 4_000, 'Drainage warning')),
    features: parseFeatureCollection(r.features),
  }
}
export function parseDrainageProjectState(value: unknown): DrainageProjectState {
  const r = object(value, 'Project drainage')
  if (!Array.isArray(r.records) || r.records.length > MAX_DRAINAGE_RECORDS)
    throw Error('A project holds at most 20 compact drainage records.')
  const records = r.records.map(parseDrainageEvidence)
  if (new Set(records.map((record) => record.alignmentId)).size !== records.length)
    throw Error('Drainage evidence contains duplicate road IDs.')
  return {
    settings: parseDrainageSettings(r.settings),
    ...(r.pourPoint === undefined ? {} : { pourPoint: parsePourPoint(r.pourPoint) }),
    ...(r.watershedMinAreaHa === undefined
      ? {}
      : { watershedMinAreaHa: number(r.watershedMinAreaHa, 0, 100_000, 'Minimum watershed area') }),
    records,
  }
}
export function createDrainageEvidence(
  run: DrainageRun,
  input: DrainageFingerprintInput,
  createdAt = new Date().toISOString(),
): DrainageEvidence {
  const features: GeoJSON.Feature[] = [
    ...run.plan.features.filter(
      (f) => f.properties?.role !== 'stream-existing' && f.properties?.role !== 'stream-design',
    ),
    ...run.crossings.map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: c.coordinate },
      properties: {
        role: 'crossing',
        id: c.id,
        chainage: c.chainage,
        areaHa: c.areaHa,
        redirected: c.redirected,
        divertedM: c.divertedM,
      },
    })),
    ...run.culverts.map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: positionAt(input.alignment, c.chainage).coordinate },
      properties: {
        role: 'culvert-check',
        id: c.id,
        name: c.name,
        chainage: c.chainage,
        designAreaHa: c.designAreaHa,
        existingAreaHa: c.existingAreaHa,
        designFlowM3s: c.designFlowM3s,
        capacityM3s: c.capacityM3s,
        slope: c.slope,
        slopeAssumed: c.slopeAssumed,
        diameterM: c.diameterM,
        minimumDiameterM: c.minimumDiameterM ?? '>3.0',
        adequate: c.adequate,
      },
    })),
  ]
  return parseDrainageEvidence({
    schema: 'pgmaps-drainage-evidence-v1',
    geometryScope: 'catchments-and-review-locations',
    alignmentId: input.alignment.id,
    createdAt,
    fingerprint: drainageInputFingerprint(input),
    settings: input.settings,
    pourPoint: input.pourPoint,
    watershedMinAreaHa: input.watershedMinAreaHa,
    terrain: {
      name: input.terrain.name,
      resolutionM: input.terrain.resolutionM,
      verticalReference: input.terrain.verticalReference,
      sha256: input.terrain.sha256,
      sourceKind: input.terrain.kind,
      immutable: drainageTerrainIsReproducible(input.terrain),
    },
    grid: run.grid,
    summary: {
      crossings: run.crossings.length,
      redirected: run.crossings.filter((c) => c.redirected && !c.throughCulvertId).length,
      lowPoints: run.lowPoints.filter((p) => !p.throughCulvert).length,
      pondingAreaM2: run.newPonding.areaM2,
      undersized: run.culverts.filter((c) => !c.adequate).length,
      culverts: run.culverts.length,
      changedCells: run.changedCells,
    },
    warnings: run.warnings,
    features: { type: 'FeatureCollection', features },
  })
}
/** Unchecksummed regional/live terrain must be rerun after restoration even when metadata matches. */
export function drainageTerrainIsReproducible(terrain: TerrainMetadata): boolean {
  return terrain.kind === 'demo' || !!terrain.raster || (terrain.kind === 'geotiff' && !!terrain.sha256)
}
export function drainageEvidenceNeedsRecompute(record: DrainageEvidence, terrain: TerrainMetadata): boolean {
  return !record.terrain.immutable || !drainageTerrainIsReproducible(terrain)
}
export function drainageEvidenceGeoJson(
  record: DrainageEvidence,
  currentFingerprint: string,
  { hasLiveRun = false }: { hasLiveRun?: boolean } = {},
): GeoJSON.FeatureCollection {
  if (record.fingerprint !== currentFingerprint)
    throw Error('Drainage evidence is out of date. Re-run drainage before exporting current results.')
  if (!record.terrain.immutable && !hasLiveRun)
    throw Error(
      'This saved run used unchecksummed live terrain. Re-run drainage on the current terrain before exporting current results.',
    )
  return {
    type: 'FeatureCollection',
    features: record.features.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        fingerprint: record.fingerprint,
        createdAt: record.createdAt,
        terrain: record.terrain.name,
        verticalReference: record.terrain.verticalReference,
        cellM: record.grid.cellM,
        geometryScope: record.geometryScope,
      },
    })),
  }
}

/** Escaped portable review chapter. Saved results remain labelled historical when dependencies cannot be reproduced. */
export function drainageReportHtml(
  record: DrainageEvidence,
  currentFingerprint: string,
  { hasLiveRun = false }: { hasLiveRun?: boolean } = {},
): string {
  const escape = (value: unknown) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )
  const fmt = (value: unknown, digits = 3) =>
    typeof value === 'number' && Number.isFinite(value)
      ? value.toLocaleString('en-CA', { maximumFractionDigits: digits })
      : escape(value)
  const stale = record.fingerprint !== currentFingerprint || (!record.terrain.immutable && !hasLiveRun)
  const features = (role: string) => record.features.features.filter((f) => f.properties?.role === role)
  const table = (headings: string[], rows: string[][]) =>
    rows.length
      ? `<table><thead><tr>${headings.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<p>None recorded.</p>'
  return `<section><h2>Drainage review evidence</h2><p><strong>${stale ? 'Historical / out of date — recompute before use.' : 'Inputs match this record.'}</strong></p>
<p>Run ${escape(record.createdAt)}. Source: ${escape(record.terrain.name)}; ${escape(record.terrain.verticalReference)}; native ${fmt(record.terrain.resolutionM)} m, analysis ${fmt(record.grid.cellM)} m cells (${fmt(record.grid.width, 0)} × ${fmt(record.grid.height, 0)}). ${record.terrain.sha256 ? `Source SHA-256: ${escape(record.terrain.sha256)}.` : record.terrain.sourceKind === 'regional' ? 'Unchecksummed regional terrain requires recomputation after reopening.' : ''}</p>
<p>Rainfall ${fmt(record.settings.rainfallMmPerHr)} mm/h; runoff C ${fmt(record.settings.runoffCoefficient)}; Manning n ${fmt(record.settings.manningN)}; stream threshold ${fmt(record.settings.streamThresholdHa)} ha; buffer ${fmt(record.settings.bufferM)} m.</p>
${record.pourPoint ? `<p>Requested pour point ${record.pourPoint.coordinate.map((c) => fmt(c, 6)).join(', ')}; ${escape(record.pourPoint.surface)} surface; snap radius ${fmt(record.pourPoint.snapRadiusM)} m.</p>` : ''}
<p>${fmt(record.summary.crossings, 0)} stream crossings; ${fmt(record.summary.redirected, 0)} redirected without a passing culvert; ${fmt(record.summary.lowPoints, 0)} unrelieved low points; ${fmt(record.summary.pondingAreaM2)} m² new ponding; ${fmt(record.summary.undersized, 0)} of ${fmt(record.summary.culverts, 0)} culverts below modeled capacity.</p>
<h3>Catchments and watersheds</h3>${table(
    ['ID', 'Surface', 'Area (ha)', 'Boundary contact'],
    [...features('catchment'), ...features('watershed')].map((f) => {
      const p = f.properties!
      return [
        escape(p.id),
        escape(p.surface),
        fmt(p.areaHa),
        p.truncated ? 'Sample edge or missing terrain — may be truncated' : 'No sampled boundary contact',
      ]
    }),
  )}
<h3>Stream crossing review</h3>${table(
    ['ID', 'Station (m)', 'Area (ha)', 'Carried (m)', 'Redirected'],
    features('crossing').map((f) => {
      const p = f.properties!
      return [escape(p.id), fmt(p.chainage), fmt(p.areaHa), fmt(p.divertedM), p.redirected ? 'Yes' : 'No']
    }),
  )}
<h3>Culvert capacity review</h3>${table(
    [
      'Culvert',
      'Station (m)',
      'Catchment design / existing (ha)',
      'Peak / capacity (m³/s)',
      'Diameter / minimum (m)',
      'Slope',
      'Adequate',
    ],
    features('culvert-check').map((f) => {
      const p = f.properties!
      return [
        escape(p.name),
        fmt(p.chainage),
        `${fmt(p.designAreaHa)} / ${fmt(p.existingAreaHa)}`,
        `${fmt(p.designFlowM3s)} / ${fmt(p.capacityM3s)}`,
        `${fmt(p.diameterM)} / ${fmt(p.minimumDiameterM)}`,
        `${fmt(Number(p.slope) * 100)}%${p.slopeAssumed ? ' (assumed)' : ''}`,
        p.adequate ? 'Yes' : 'No',
      ]
    }),
  )}
${record.warnings.length ? `<ul>${record.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul>` : ''}
<p>Fingerprint ${escape(record.fingerprint)}. Geometry contains catchment boundaries and review locations; full raster grids and stream linework are recomputed. This D8 surface-runoff / Rational / full-pipe Manning screen does not model inlet control, headwater, scour, fish passage or a design hydrograph.</p></section>`
}

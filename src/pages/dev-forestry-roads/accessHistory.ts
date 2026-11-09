/** Historical associations are evidence about past access, never current-use approvals. */
import { distance } from './engine'
import {
  buildHistoricalRoadTopology,
  shortestHistoricalTopologyPath,
  type HistoricalRoadTopologyGraph,
} from './roadNetwork'
import type { ContextFeature, Coordinate } from './types'
import type {
  DateWindow,
  HistoricalAccessPath,
  HistoricalAccessState,
  HistoricalAnchor,
  HistoricalBlockIdentity,
  HistoricalPathSegment,
  HistoricalRelationship,
  HistoricalRoadEvent,
  HistoricalSource,
  HistoricalSourceQuery,
  HistoricalStructure,
  HistoricalStructureAssessment,
  HistoricalTemporalAssessment,
  HistoricalTraceInput,
  HistoricalTraceResult,
  HistoricalTraceSettings,
} from './accessHistoryTypes'
export type * from './accessHistoryTypes'

export const MAX_HISTORY_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_HISTORY_PATHS = 100
export const MAX_HISTORY_SOURCES = 500
export const MAX_HISTORY_EVENTS = 1000
export const MAX_HISTORY_STRUCTURES = 500
export const MAX_HISTORY_ANCHORS = 100
export const MAX_HISTORY_PATH_VERTICES = 50000
export const MAX_HISTORY_PATH_SEARCHES = 48

const object = (raw: unknown, label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
function text(raw: unknown, label: string, max = 200, empty = false): string {
  if (typeof raw !== 'string' || (!empty && !raw.trim()) || raw.length > max)
    throw Error(`${label} must contain ${empty ? '0' : '1'}–${max} characters.`)
  return raw.trim()
}
const nullableText = (raw: unknown, label: string) => (raw == null ? null : text(raw, label))
function list(raw: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) throw Error(`${label} supports at most ${max} records.`)
  return raw
}
function unique<T extends { id: string }>(values: T[], label: string): T[] {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw Error(`${label} repeats an ID.`)
  return values
}
function number(raw: unknown, label: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return raw
}
function flag(raw: unknown, label: string): boolean {
  if (typeof raw !== 'boolean') throw Error(`${label} must be true or false.`)
  return raw
}
function date(raw: unknown, label = 'Historical date'): string {
  const value = text(raw, label, 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw Error(`${label} must be a real YYYY-MM-DD calendar date.`)
  return value
}
const nullableDate = (raw: unknown, label: string) => (raw == null ? null : date(raw, label))
function coordinate(raw: unknown): Coordinate {
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    !raw.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    Math.abs(raw[0]) > 180 ||
    Math.abs(raw[1]) >= 85
  )
    throw Error('Use finite WGS84 longitude/latitude coordinates.')
  return [raw[0], raw[1]]
}
function values<T extends string>(raw: unknown, allowed: readonly T[], label: string): T {
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) throw Error(`Invalid ${label}.`)
  return raw as T
}
const sourceIds = (raw: unknown) => {
  const result = list(raw, 'Evidence source references', MAX_HISTORY_SOURCES).map((v) => text(v, 'Source ID'))
  if (new Set(result).size !== result.length) throw Error('Evidence source references repeat an ID.')
  return result
}
const union = (values: readonly string[]) => [...new Set(values)].sort()

export function parseHistoricalDateWindow(raw: unknown): DateWindow {
  const r = object(raw, 'Historical event interval')
  const earliest = nullableDate(r.earliest, 'Earliest event date'),
    latest = nullableDate(r.latest, 'Latest event date')
  if (earliest && latest && earliest > latest) throw Error('An event interval cannot end before it starts.')
  return { earliest, latest }
}
export function createAccessHistoryState(asOf = new Date().toISOString().slice(0, 10)): HistoricalAccessState {
  return {
    schema: 'historical-access-v1',
    settings: {
      asOf: date(asOf),
      allowUnknownTime: false,
      allowUnverifiedEndpointSnaps: false,
      snapToleranceM: 1,
      attachmentToleranceM: 10,
      maxVariants: 3,
    },
    sources: [],
    events: [],
    structures: [],
    anchors: [],
    paths: [],
    selectedPathId: null,
  }
}
export const createHistoricalAccessState = createAccessHistoryState

export function parseHistoricalTraceSettings(raw: unknown): HistoricalTraceSettings {
  const r = object(raw, 'Historical trace settings')
  const maxVariants = number(r.maxVariants, 'Candidate variant count', 1, 8)
  if (!Number.isInteger(maxVariants)) throw Error('Candidate variant count must be an integer.')
  return {
    asOf: date(r.asOf),
    allowUnknownTime: flag(r.allowUnknownTime, 'Unknown historical timing assumption'),
    allowUnverifiedEndpointSnaps: flag(r.allowUnverifiedEndpointSnaps, 'Unverified endpoint assumption'),
    snapToleranceM: number(r.snapToleranceM, 'Historical snap tolerance', 0, 50),
    attachmentToleranceM: number(r.attachmentToleranceM, 'Historical attachment tolerance', 0, 50),
    maxVariants,
  }
}
function parseSource(raw: unknown): HistoricalSource {
  const r = object(raw, 'Historical source'),
    url = text(r.url, 'Source URL', 2000, true)
  if (url && !/^https?:\/\//i.test(url)) throw Error('A source URL must use HTTP or HTTPS.')
  const retrievedAt = text(r.retrievedAt, 'Source retrieval time', 40)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt)))
    throw Error('Source retrieval time must be an ISO timestamp.')
  let blockIdentity: HistoricalBlockIdentity | undefined
  if (r.blockIdentity !== undefined) {
    const b = object(r.blockIdentity, 'Block source identity')
    blockIdentity = {
      entityId: text(b.entityId, 'Block source entity ID'),
      source: values(b.source, ['results-opening', 'ften-cutblock'], 'block identity source'),
      openingId: text(b.openingId, 'Opening ID'),
    }
    for (const key of [
      'cutblockSKey',
      'forestFileId',
      'cuttingPermitId',
      'cutBlockId',
      'timberMark',
      'clientNumber',
      'lifecycleStatus',
    ] as const)
      if (b[key] !== undefined) blockIdentity[key] = text(b[key], `Block ${key}`)
    for (const key of ['disturbanceStartDate', 'disturbanceEndDate'] as const)
      if (b[key] !== undefined) blockIdentity[key] = date(b[key], `Block ${key}`)
    if (
      blockIdentity.disturbanceStartDate &&
      blockIdentity.disturbanceEndDate &&
      blockIdentity.disturbanceEndDate < blockIdentity.disturbanceStartDate
    )
      throw Error('Block disturbance source dates are reversed.')
  }
  let query: HistoricalSourceQuery | undefined
  if (r.query !== undefined) {
    const q = object(r.query, 'Source query result')
    const status = values(q.status, ['success', 'skipped'] as const, 'source query status')
    const recordCount = number(q.recordCount, 'Source query record count', 0, 500)
    if (!Number.isInteger(recordCount) || (status === 'skipped' && recordCount !== 0))
      throw Error('Source query count must be an integer; skipped queries have no returned records.')
    const requestUrl = text(q.requestUrl, 'Source query request URL', 4000, status === 'skipped')
    if (requestUrl) {
      let parsed: URL
      try {
        parsed = new URL(requestUrl)
      } catch {
        throw Error('A source query request URL must use HTTPS.')
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        throw Error('A source query request URL must use HTTPS without embedded credentials.')
    }
    query = {
      source: values(q.source, ['results-opening', 'ften-cutblock', 'ften-road-segment'], 'query source'),
      status,
      recordCount,
      requestUrl,
    }
    if (q.openingId !== undefined) query.openingId = text(q.openingId, 'Query opening ID')
    if (q.reason !== undefined) query.reason = text(q.reason, 'Source query reason', 4000)
    if (q.bounds !== undefined) {
      const bounds = list(q.bounds, 'Source query bounds', 4)
      if (
        bounds.length !== 4 ||
        !bounds.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
        (bounds[0] as number) < -180 ||
        (bounds[2] as number) > 180 ||
        (bounds[1] as number) <= -85 ||
        (bounds[3] as number) >= 85 ||
        (bounds[0] as number) >= (bounds[2] as number) ||
        (bounds[1] as number) >= (bounds[3] as number)
      )
        throw Error('Source query bounds must be a non-empty WGS84 west/south/east/north extent.')
      query.bounds = bounds as [number, number, number, number]
    }
  }
  return {
    id: text(r.id, 'Source ID'),
    dataset: text(r.dataset, 'Source dataset'),
    recordId: text(r.recordId, 'Source record ID'),
    url,
    retrievedAt,
    publishedOn: nullableDate(r.publishedOn, 'Source publication date'),
    description: text(r.description, 'Source description', 4000),
    synthetic: flag(r.synthetic, 'Synthetic source flag'),
    ...(blockIdentity ? { blockIdentity } : {}),
    ...(query ? { query } : {}),
  }
}
function parseEvent(raw: unknown): HistoricalRoadEvent {
  const r = object(raw, 'Road history event'),
    refs = sourceIds(r.sourceIds)
  if (!refs.length) throw Error('A physical road event needs a source reference.')
  return {
    id: text(r.id, 'Road event ID'),
    roadId: text(r.roadId, 'Event road ID'),
    kind: values(
      r.kind,
      ['constructed', 'present-observed', 'deactivated', 'reactivated', 'closed', 'removed'],
      'road event kind',
    ),
    when: parseHistoricalDateWindow(r.when),
    observedOn: nullableDate(r.observedOn, 'Road observation date'),
    sourceIds: refs,
    geometryFingerprint: text(r.geometryFingerprint, 'Event geometry fingerprint'),
  }
}
function parseStructure(raw: unknown): HistoricalStructure {
  const r = object(raw, 'Historical structure'),
    key = r.roadKey == null ? null : object(r.roadKey, 'Structure road key')
  const evidence = unique(
    list(r.evidence, 'Structure reports', 100).map((rawReport) => {
      const p = object(rawReport, 'Structure report'),
        refs = sourceIds(p.sourceIds)
      if (!refs.length) throw Error('A structure report needs its own source reference.')
      const validFrom = nullableDate(p.validFrom, 'Structure report start'),
        validUntil = nullableDate(p.validUntil, 'Structure report end')
      if (validFrom && validUntil && validUntil < validFrom) throw Error('Structure report validity is reversed.')
      return {
        id: text(p.id, 'Structure report ID'),
        sourceIds: refs,
        kind: values(p.kind, ['load-rating', 'closure', 'restriction'] as const, 'structure report kind'),
        validFrom,
        validUntil,
        ratedLoadTonnes:
          p.ratedLoadTonnes == null ? null : number(p.ratedLoadTonnes, 'Documented structure load', 0, 1000),
        description: text(p.description, 'Structure report description', 4000),
      }
    }),
    'Structure reports',
  )
  const construction = r.construction == null ? null : parseHistoricalDateWindow(r.construction)
  const removal = r.removal == null ? null : parseHistoricalDateWindow(r.removal)
  const refs = sourceIds(r.sourceIds)
  if (!refs.length && [construction, removal].some((window) => window?.earliest || window?.latest))
    throw Error('Dated structure construction or removal needs a source reference.')
  // Conflicting source dates are retained for review rather than silently repaired or discarded.
  return {
    id: text(r.id, 'Structure ID'),
    name: text(r.name, 'Structure name'),
    kind: values(r.kind, ['bridge', 'culvert', 'ford', 'unknown'], 'structure kind'),
    coordinate: coordinate(r.coordinate),
    sourceIds: refs,
    crossingSiteId: nullableText(r.crossingSiteId, 'Crossing site ID'),
    structureId: nullableText(r.structureId, 'Physical structure ID'),
    sourceRowId: nullableText(r.sourceRowId, 'Structure row ID'),
    roadId: nullableText(r.roadId, 'Structure road ID'),
    roadKey: key
      ? {
          forestFileId: text(key.forestFileId, 'Structure forest file'),
          roadSectionId: text(key.roadSectionId, 'Structure road section'),
        }
      : null,
    attachment: values(
      r.attachment,
      ['identifier-match', 'spatial-candidate', 'reviewed', 'unresolved'],
      'structure attachment basis',
    ),
    attachmentToleranceM: number(r.attachmentToleranceM, 'Structure attachment tolerance', 0, 50),
    construction,
    removal,
    evidence,
  }
}
function parseAnchor(raw: unknown): HistoricalAnchor {
  const r = object(raw, 'Historical access location')
  const role = values(r.role, ['entrance', 'outlet'], 'historical location role'),
    blockId = nullableText(r.blockId, 'Location block ID')
  if (role === 'entrance' && !blockId) throw Error('An entrance must identify its harvested block.')
  return {
    id: text(r.id, 'Access location ID'),
    name: text(r.name, 'Access location name'),
    role,
    coordinate: coordinate(r.coordinate),
    roadId: nullableText(r.roadId, 'Location road ID'),
    blockId,
    sourceIds: sourceIds(r.sourceIds),
  }
}
function parseReview(raw: unknown): HistoricalAccessPath['review'] {
  if (raw == null) return null
  const r = object(raw, 'Historical association review')
  return {
    reviewer: text(r.reviewer, 'Historical reviewer'),
    reviewedOn: date(r.reviewedOn, 'Historical review date'),
    reference: text(r.reference, 'Historical review basis', 4000),
  }
}
function parsePath(raw: unknown): HistoricalAccessPath {
  const r = object(raw, 'Saved historical path'),
    coords = list(r.coordinates, 'Historical path vertices', MAX_HISTORY_PATH_VERTICES).map(coordinate)
  const segments: HistoricalPathSegment[] = list(r.segments, 'Historical path segments', MAX_HISTORY_PATH_VERTICES).map(
    (rawSegment) => {
      const s = object(rawSegment, 'Historical path segment'),
        points = list(s.coordinates, 'Historical segment coordinates', 2).map(coordinate)
      if (points.length !== 2) throw Error('A historical segment requires two coordinates.')
      const lengthM = number(s.lengthM, 'Historical segment length', 0, 1000000)
      if (Math.abs(distance(points[0], points[1]) - lengthM) > 0.01)
        throw Error('Historical segment length does not match its geometry.')
      const kind = values(s.kind, ['road', 'junction', 'attachment'] as const, 'historical segment kind')
      const roadId = nullableText(s.roadId, 'Historical segment road ID')
      if ((kind === 'road') !== (roadId !== null)) throw Error('Only physical road segments carry a road ID.')
      return {
        id: text(s.id, 'Historical segment ID', 1000),
        roadId,
        kind,
        forward: flag(s.forward, 'Historical segment direction'),
        coordinates: points as [Coordinate, Coordinate],
        lengthM,
      }
    },
  )
  if (!segments.length || coords.length < 2) throw Error('A saved access path must contain a continuous route.')
  for (let i = 1; i < segments.length; i++)
    if (distance(segments[i - 1].coordinates[1], segments[i].coordinates[0]) > 0.01)
      throw Error('Saved historical path segments are disconnected.')
  const expected = [segments[0].coordinates[0], ...segments.map((s) => s.coordinates[1])]
  const compact = (points: Coordinate[]) => points.filter((p, i) => !i || distance(points[i - 1], p) > 1e-6)
  const a = compact(coords),
    b = compact(expected)
  if (a.length !== b.length || a.some((p, i) => distance(p, b[i]) > 0.01))
    throw Error('Saved path geometry disagrees with its ordered segments.')
  const lengthM = number(r.lengthM, 'Historical path length', 0, 10000000)
  if (Math.abs(segments.reduce((n, s) => n + s.lengthM, 0) - lengthM) > 0.02)
    throw Error('Saved historical path total disagrees with its segments.')
  const roadIds = sourceIds(r.roadIds),
    structureIds = sourceIds(r.structureIds),
    refs = sourceIds(r.sourceIds)
  if (JSON.stringify(union(roadIds)) !== JSON.stringify(union(segments.flatMap((s) => (s.roadId ? [s.roadId] : [])))))
    throw Error('Saved road IDs disagree with the physical path segments.')
  const relationship = values(
    r.relationship,
    ['proximity', 'inferred-access', 'planned-access', 'documented-use', 'rejected'],
    'historical relationship',
  )
  const review = parseReview(r.review)
  if (['planned-access', 'documented-use'].includes(relationship) && (!review || !refs.length))
    throw Error('Planned or documented access requires an explicit review and source reference.')
  const settings = parseHistoricalTraceSettings(r.settings),
    period = parseHistoricalDateWindow(r.period)
  if (period.earliest !== settings.asOf || period.latest !== settings.asOf)
    throw Error('A traced historical path records one explicit analysis date; use separate runs for other dates.')
  return {
    id: text(r.id, 'Historical path ID'),
    blockId: text(r.blockId, 'Historical path block'),
    entranceId: text(r.entranceId, 'Historical entrance'),
    outletId: text(r.outletId, 'Historical outlet'),
    period,
    settings,
    relationship,
    review,
    sourceIds: refs,
    roadIds,
    structureIds,
    coordinates: coords,
    segments,
    lengthM,
    inputFingerprint: text(r.inputFingerprint, 'Historical input fingerprint'),
    assumptions: list(r.assumptions, 'Historical assumptions', 2000).map((v) => text(v, 'Historical assumption', 4000)),
  }
}

export function parseAccessHistoryState(raw: unknown, context?: readonly ContextFeature[]): HistoricalAccessState {
  const r = object(raw, 'Historical access evidence')
  if (r.schema !== 'historical-access-v1') throw Error('Use a historical-access-v1 evidence file.')
  const state: HistoricalAccessState = {
    schema: 'historical-access-v1',
    settings: parseHistoricalTraceSettings(r.settings),
    sources: unique(list(r.sources, 'Historical sources', MAX_HISTORY_SOURCES).map(parseSource), 'Historical sources'),
    events: unique(list(r.events, 'Road history events', MAX_HISTORY_EVENTS).map(parseEvent), 'Road history events'),
    structures: unique(
      list(r.structures, 'Historical structures', MAX_HISTORY_STRUCTURES).map(parseStructure),
      'Historical structures',
    ),
    anchors: unique(
      list(r.anchors, 'Historical access locations', MAX_HISTORY_ANCHORS).map(parseAnchor),
      'Historical access locations',
    ),
    paths: unique(list(r.paths, 'Saved historical paths', MAX_HISTORY_PATHS).map(parsePath), 'Saved historical paths'),
    selectedPathId: nullableText(r.selectedPathId, 'Selected historical path'),
  }
  const ids = new Set(state.sources.map((s) => s.id))
  for (const item of [
    ...state.events,
    ...state.structures,
    ...state.anchors,
    ...state.paths,
    ...state.structures.flatMap((s) => s.evidence),
  ])
    for (const source of item.sourceIds) if (!ids.has(source)) throw Error(`Historical source ${source} is missing.`)
  if (state.paths.reduce((n, p) => n + p.coordinates.length + p.segments.length * 2, 0) > MAX_HISTORY_PATH_VERTICES)
    throw Error('Saved historical paths exceed the combined 50,000-vertex budget.')
  if (state.selectedPathId && !state.paths.some((p) => p.id === state.selectedPathId))
    throw Error('Selected historical path is missing.')
  // Missing context is retained as stale evidence, not silently deleted with a refreshed source.
  if (context) {
    const byId = new Map(context.map((f) => [f.id, f]))
    for (const event of state.events)
      if (byId.has(event.roadId) && byId.get(event.roadId)!.kind !== 'existing-road')
        throw Error('A road event points to a non-road feature.')
    for (const anchor of state.anchors)
      if (anchor.blockId && byId.has(anchor.blockId) && byId.get(anchor.blockId)!.kind !== 'harvest')
        throw Error('An access entrance points to a non-cutblock feature.')
    const checked = new Map<string, string>()
    for (const path of state.paths) {
      const key = stable(path.settings)
      const current = checked.get(key) ?? historicalInputFingerprint(context, state, path.settings)
      checked.set(key, current)
      if (path.inputFingerprint === current) {
        const problem = savedTopologyProblem(path, state, context)
        if (problem) throw Error(problem)
      }
    }
  }
  return state
}
export const parseHistoricalAccess = parseAccessHistoryState

function stable(raw: unknown): string {
  if (Array.isArray(raw)) return `[${raw.map(stable).join(',')}]`
  if (raw && typeof raw === 'object')
    return `{${Object.entries(raw)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`
  return JSON.stringify(raw) ?? 'null'
}
function fingerprint(raw: unknown): string {
  const input = stable(raw)
  let a = 2166136261,
    b = 2246822507
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 16777619)
    b = Math.imul(b ^ input.charCodeAt(i), 3266489909)
  }
  return `history-v1-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}
export function roadGeometryFingerprint(feature: ContextFeature): string {
  return fingerprint({ id: feature.id, geometry: feature.geometry })
}
export function historicalInputFingerprint(
  context: readonly ContextFeature[],
  state: HistoricalAccessState,
  settings = state.settings,
): string {
  return fingerprint({
    settings,
    context: context
      .filter((f) => ['existing-road', 'harvest'].includes(f.kind))
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        geometry: f.geometry,
        harvestEvidence: f.harvestEvidence,
        level: f.roadEvidence?.network?.level,
        junctions: f.roadEvidence?.network?.junctions,
        roadIdentity: f.roadEvidence
          ? {
              source: f.roadEvidence.source,
              sourceId: f.roadEvidence.sourceId,
              forestFileId: f.roadEvidence.forestFileId,
              roadSectionId: f.roadEvidence.roadSectionId,
              segmentStartStation: f.roadEvidence.segmentStartStation,
              segmentEndStation: f.roadEvidence.segmentEndStation,
            }
          : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    sources: [...state.sources].sort((a, b) => a.id.localeCompare(b.id)),
    events: [...state.events].sort((a, b) => a.id.localeCompare(b.id)),
    structures: [...state.structures].sort((a, b) => a.id.localeCompare(b.id)),
    anchors: [...state.anchors].sort((a, b) => a.id.localeCompare(b.id)),
  })
}

/** Date compatibility only. A positive result does not document historical use or uninterrupted service. */
export function assessHistoricalWindow(
  periodRaw: DateWindow,
  events: readonly HistoricalRoadEvent[],
): HistoricalTemporalAssessment {
  const period = parseHistoricalDateWindow(periodRaw),
    refs = union(events.flatMap((e) => e.sourceIds))
  const result = (
    status: HistoricalTemporalAssessment['status'],
    ...reasons: string[]
  ): HistoricalTemporalAssessment => ({ status, reasons, sourceIds: refs })
  if (!period.earliest || !period.latest) return result('unknown', 'The analysis period has unknown bounds.')
  if (!events.length)
    return result('unknown', 'No dated physical road history establishes existence at the analysis date.')
  const before = (e: HistoricalRoadEvent) => !!e.when.latest && e.when.latest <= period.earliest!
  const positives = events.filter(
    (e) => ['constructed', 'present-observed', 'reactivated'].includes(e.kind) && before(e),
  )
  const futureBuild = events.filter(
    (e) => e.kind === 'constructed' && e.when.earliest && e.when.earliest > period.latest!,
  )
  if (futureBuild.length && positives.length)
    return result(
      'conflict',
      'A future construction record conflicts with earlier evidence for the same road extent; separate incarnations or reconcile the sources.',
    )
  if (futureBuild.length)
    return result('contradicted', 'The documented construction interval starts after the analysis date.')
  const negatives = events.filter((e) => ['deactivated', 'closed', 'removed'].includes(e.kind))
  const definiteInterruptions: string[] = [],
    possibleInterruptions: string[] = []
  for (const event of negatives) {
    if (event.when.earliest && event.when.earliest > period.latest) continue
    const restored = events.some(
      (p) =>
        ['reactivated', 'constructed'].includes(p.kind) &&
        before(p) &&
        p.when.earliest &&
        event.when.latest &&
        p.when.earliest > event.when.latest,
    )
    if (restored) continue
    if (before(event)) {
      definiteInterruptions.push(
        `Recorded ${event.kind} applies before the analysis date, without a later documented reopening.`,
      )
      continue
    }
    if (
      event.when.earliest &&
      event.when.latest &&
      event.when.earliest === event.when.latest &&
      event.when.earliest <= period.latest
    )
      definiteInterruptions.push(`Recorded ${event.kind} interrupts the analysis interval.`)
    else
      possibleInterruptions.push(
        `The ${event.kind} interval could affect this date; its timing or reopening remains unresolved.`,
      )
  }
  // Evidence order must not let an undated report hide a definite closure/removal.
  if (definiteInterruptions.length)
    return result('contradicted', ...union([...definiteInterruptions, ...possibleInterruptions]))
  if (possibleInterruptions.length) return result('unknown', ...union(possibleInterruptions))
  if (!positives.length)
    return result(
      'unknown',
      'Available physical records do not establish that the road already existed by the analysis date. A later observation is not a construction date.',
    )
  const incompatibleBuild = events.some(
    (event) =>
      event.kind === 'constructed' &&
      !before(event) &&
      event.when.earliest &&
      positives.some((positive) => positive !== event && positive.when.latest! < event.when.earliest!),
  )
  if (incompatibleBuild)
    return result(
      'conflict',
      'Another physical record places this road before its earliest possible construction date; reconcile the records or separate incarnations.',
    )
  return result(
    'compatible',
    'Physical road evidence is date-compatible; historical use, condition and permission remain separate questions.',
  )
}

/** One physical road's chronology, including retained event extent checks. */
export function assessHistoricalRoad(
  road: ContextFeature,
  events: readonly HistoricalRoadEvent[],
  asOf: string,
): HistoricalTemporalAssessment {
  date(asOf)
  const retained = events.filter((event) => event.roadId === road.id)
  if (retained.some((event) => event.geometryFingerprint !== roadGeometryFingerprint(road)))
    return {
      status: 'conflict',
      reasons: ['Road geometry changed after its historical event was scoped; review the event extent.'],
      sourceIds: union(retained.flatMap((event) => event.sourceIds)),
    }
  return assessHistoricalWindow({ earliest: asOf, latest: asOf }, retained)
}

export function assessHistoricalStructure(structure: HistoricalStructure, asOf: string): HistoricalTemporalAssessment {
  date(asOf)
  const events: HistoricalRoadEvent[] = []
  if (structure.construction)
    events.push({
      id: `${structure.id}-built`,
      roadId: structure.roadId ?? structure.id,
      kind: 'constructed',
      when: structure.construction,
      observedOn: null,
      sourceIds: structure.sourceIds,
      geometryFingerprint: 'asset',
    })
  if (structure.removal)
    events.push({
      id: `${structure.id}-removed`,
      roadId: structure.roadId ?? structure.id,
      kind: 'removed',
      when: structure.removal,
      observedOn: null,
      sourceIds: structure.sourceIds,
      geometryFingerprint: 'asset',
    })
  const assessments = [assessHistoricalWindow({ earliest: asOf, latest: asOf }, events)]
  if (
    structure.construction?.earliest &&
    structure.removal?.latest &&
    structure.construction.earliest > structure.removal.latest
  )
    assessments.push({
      status: 'conflict',
      reasons: ['The structure is recorded as removed before its construction; asset identity or dates need review.'],
      sourceIds: structure.sourceIds,
    })
  const active = structure.evidence.filter(
    (e) => e.validFrom && e.validFrom <= asOf && (!e.validUntil || e.validUntil >= asOf),
  )
  const closures = active.filter((e) => e.kind === 'closure')
  const ratings = active.filter((e) => e.kind === 'load-rating' && e.ratedLoadTonnes !== null)
  if (new Set(ratings.map((e) => e.ratedLoadTonnes)).size > 1)
    assessments.push({
      status: 'conflict',
      reasons: [
        'Applicable source reports give conflicting load ratings; retain each report and review applicability.',
      ],
      sourceIds: union([...ratings, ...closures].flatMap((e) => e.sourceIds)),
    })
  if (closures.length)
    assessments.push({
      status: 'contradicted',
      reasons: ['A dated structure closure applies at the analysis date.'],
      sourceIds: union(closures.flatMap((e) => e.sourceIds)),
    })
  const undatedClosures = structure.evidence.filter(
    (e) => e.kind === 'closure' && !e.validFrom && (!e.validUntil || e.validUntil >= asOf),
  )
  if (undatedClosures.length)
    assessments.push({
      status: 'unknown',
      reasons: ['A structure closure has no established start date.'],
      sourceIds: union(undatedClosures.flatMap((e) => e.sourceIds)),
    })
  // Uncertain restriction timing never downgrades a known absence, removal or closure.
  const status = assessments.some((a) => a.status === 'conflict')
    ? 'conflict'
    : assessments.some((a) => a.status === 'contradicted')
      ? 'contradicted'
      : assessments.some((a) => a.status === 'unknown')
        ? 'unknown'
        : 'compatible'
  return {
    status,
    reasons: union([
      ...assessments.flatMap((a) => a.reasons),
      'Inventory presence and historical connectivity do not establish vehicle capacity; dated restrictions and rating applicability need separate review.',
    ]),
    sourceIds: union([
      ...structure.sourceIds,
      ...assessments.flatMap((a) => a.sourceIds),
      ...active.flatMap((e) => e.sourceIds),
    ]),
  }
}

/** Same physical asset in several inventory rows: combine reports, never pick the most convenient row. */
function structureAssessmentWithPeers(
  structure: HistoricalStructure,
  structures: readonly HistoricalStructure[],
  asOf: string,
): HistoricalTemporalAssessment {
  const peers = structure.structureId
    ? structures.filter((s) => s.structureId === structure.structureId && s.roadId === structure.roadId)
    : [structure]
  if (peers.length < 2) return assessHistoricalStructure(structure, asOf)
  const assessments = peers.map((s) => assessHistoricalStructure(s, asOf))
  const combined = assessHistoricalStructure({ ...structure, evidence: peers.flatMap((s) => s.evidence) }, asOf)
  if (
    combined.status === 'conflict' ||
    assessments.some((a) => a.status === 'conflict') ||
    (assessments.some((a) => a.status === 'contradicted') && assessments.some((a) => a.status === 'compatible'))
  ) {
    return {
      status: 'conflict',
      reasons: union([
        'Separate source rows disagree about the same physical structure; no available row overrides a closure or incompatible date.',
        ...assessments.flatMap((a) => a.reasons),
        ...combined.reasons,
      ]),
      sourceIds: union(peers.flatMap((s) => [...s.sourceIds, ...s.evidence.flatMap((e) => e.sourceIds)])),
    }
  }
  if (assessments.some((a) => a.status === 'contradicted'))
    return {
      status: 'contradicted',
      reasons: union([
        'Known physical chronology or closure for this asset cannot be overridden by another undated source row.',
        ...assessments.filter((a) => a.status === 'contradicted').flatMap((a) => a.reasons),
        ...combined.reasons,
      ]),
      sourceIds: union(peers.flatMap((s) => [...s.sourceIds, ...s.evidence.flatMap((e) => e.sourceIds)])),
    }
  return combined
}

function filteredGraph(graph: HistoricalRoadTopologyGraph, removed: ReadonlySet<string>): HistoricalRoadTopologyGraph {
  return {
    ...graph,
    edges: new Map([...graph.edges].filter(([id]) => !removed.has(id))),
    adjacency: new Map([...graph.adjacency].map(([id, edges]) => [id, edges.filter((e) => !removed.has(e.edgeId))])),
  }
}
function pointLineDistance(point: Coordinate, line: readonly number[][]) {
  return projectToLine(point, line).distanceM
}
function projectToLine(point: Coordinate, line: readonly number[][]) {
  let minimum = Infinity
  let projected: Coordinate | null = null
  let position: number | null = null
  const sx = Math.cos((point[1] * Math.PI) / 180)
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      dx = (b[0] - a[0]) * sx,
      dy = b[1] - a[1]
    const t = Math.max(
      0,
      Math.min(1, ((point[0] - a[0]) * sx * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    )
    const candidate: Coordinate = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    const separation = distance(point, candidate)
    if (separation < minimum - 1e-7) {
      minimum = separation
      projected = candidate
      position = i - 1 + t
    }
  }
  return { distanceM: minimum, coordinate: projected, position }
}
function pointOnRoad(point: Coordinate, road: ContextFeature) {
  return road.geometry.type === 'LineString' ? pointLineDistance(point, road.geometry.coordinates) : Infinity
}
function blockSeparation(point: Coordinate, block: ContextFeature): number {
  if (block.geometry.type !== 'Polygon') return Infinity
  const rings = block.geometry.coordinates
  const inRing = (ring: number[][]) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j]
      if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside
    }
    return inside
  }
  if (inRing(rings[0]) && !rings.slice(1).some(inRing)) return 0
  return Math.min(...rings.map((ring) => pointLineDistance(point, ring)))
}

/** Location validity only; road and structure chronology are evaluated separately. */
export function historicalAnchorProblems(
  anchor: HistoricalAnchor,
  context: readonly ContextFeature[],
  settings: HistoricalTraceSettings,
): string[] {
  const reasons: string[] = []
  if (anchor.role === 'entrance') {
    const block = context.find((feature) => feature.id === anchor.blockId && feature.kind === 'harvest')
    if (!block) reasons.push('The named cutblock is missing.')
    else if (blockSeparation(anchor.coordinate, block) > settings.attachmentToleranceM + 1e-7)
      reasons.push('The entrance is outside its cutblock footprint and explicit attachment tolerance.')
  }
  const roads = context.filter((feature) => feature.kind === 'existing-road' && feature.geometry.type === 'LineString')
  if (anchor.roadId) {
    const road = roads.find((feature) => feature.id === anchor.roadId)
    if (!road) reasons.push('The named access road is missing.')
    else if (pointOnRoad(anchor.coordinate, road) > settings.attachmentToleranceM + 1e-7)
      reasons.push('The access location exceeds its named-road attachment tolerance.')
  } else if (!roads.some((road) => pointOnRoad(anchor.coordinate, road) <= settings.attachmentToleranceM + 1e-7))
    reasons.push('No loaded road is within the explicit access-location attachment tolerance.')
  return reasons
}

function structureBinding(structure: HistoricalStructure, roads: readonly ContextFeature[]): string | null {
  if (!structure.roadId || !['identifier-match', 'reviewed'].includes(structure.attachment))
    return 'The structure has only a spatial/unresolved road association; identify and review its physical road section.'
  const road = roads.find((r) => r.id === structure.roadId)
  if (!road) return 'The named structure road is absent from the loaded network.'
  if (structure.attachment === 'identifier-match' || structure.roadKey) {
    const evidence = road.roadEvidence as { forestFileId?: string; roadSectionId?: string } | undefined
    if (
      !structure.roadKey ||
      !evidence?.forestFileId ||
      !evidence.roadSectionId ||
      evidence.forestFileId.trim() !== structure.roadKey.forestFileId.trim() ||
      evidence.roadSectionId.trim() !== structure.roadKey.roadSectionId.trim()
    )
      return 'The structure composite forest-file/road-section key does not match the named road.'
    if (
      structure.attachment === 'identifier-match' &&
      roads.filter((r) => {
        const e = r.roadEvidence as { forestFileId?: string; roadSectionId?: string } | undefined
        return (
          e?.forestFileId?.trim() === structure.roadKey!.forestFileId.trim() &&
          e?.roadSectionId?.trim() === structure.roadKey!.roadSectionId.trim()
        )
      }).length > 1
    )
      return 'The structure composite key matches multiple loaded road parts; review the specific physical segment.'
  }
  if (pointOnRoad(structure.coordinate, road) > structure.attachmentToleranceM + 1e-7)
    return 'The structure coordinate exceeds its explicit named-road attachment tolerance.'
  return null
}

/** The map, trace, report and saved-path review share binding and cross-record conflict semantics. */
export function assessHistoricalStructures(
  state: HistoricalAccessState,
  context: readonly ContextFeature[],
  asOf = state.settings.asOf,
): HistoricalStructureAssessment[] {
  date(asOf)
  const roads = context.filter((f) => f.kind === 'existing-road' && f.geometry.type === 'LineString')
  const result: HistoricalStructureAssessment[] = state.structures.map((s) => {
    const binding = structureBinding(s, roads),
      a = structureAssessmentWithPeers(s, state.structures, asOf)
    return {
      ...a,
      structureId: s.id,
      status: binding ? 'unknown' : a.status,
      binding: binding ? 'unresolved' : 'matched',
      reasons: binding ? [binding, ...a.reasons] : a.reasons,
    }
  })
  const byId = new Map(result.map((a) => [a.structureId, a]))
  const sites = new Map<string, HistoricalStructure[]>()
  for (const s of state.structures) {
    if (byId.get(s.id)!.binding !== 'matched') continue
    const key = `${s.roadId}|${s.crossingSiteId ?? s.structureId ?? s.id}`,
      members = sites.get(key) ?? []
    members.push(s)
    sites.set(key, members)
  }
  for (const siblings of sites.values()) {
    const available = siblings.filter((s) => ['compatible', 'unknown'].includes(byId.get(s.id)!.status))
    const unresolvedClosure = siblings.some(
      (s) =>
        s.evidence.some(
          (e) => e.kind === 'closure' && e.validFrom && e.validFrom <= asOf && (!e.validUntil || e.validUntil >= asOf),
        ) &&
        available.some(
          (replacement) =>
            !(
              s.structureId &&
              replacement.structureId &&
              s.structureId !== replacement.structureId &&
              s.removal?.latest &&
              replacement.construction?.earliest &&
              replacement.construction.earliest > s.removal.latest
            ),
        ),
    )
    if (unresolvedClosure)
      for (const s of siblings) {
        const row = byId.get(s.id)!
        row.status = 'conflict'
        row.reasons = union([
          ...row.reasons,
          'A closure at this crossing site conflicts with another available record; a dated distinct replacement is not established.',
        ])
        row.sourceIds = union([
          ...row.sourceIds,
          ...siblings.flatMap((v) => [...v.sourceIds, ...v.evidence.flatMap((e) => e.sourceIds)]),
        ])
      }
  }
  return result
}

/** Validate imported current-fingerprint routes against their actual source segments and junctions. */
function savedTopologyProblem(
  path: HistoricalAccessPath,
  state: HistoricalAccessState,
  context: readonly ContextFeature[],
): string | null {
  const eligible = context
    .filter((f) => f.kind === 'existing-road' && f.geometry.type === 'LineString')
    .filter((f) => {
      const events = state.events.filter((e) => e.roadId === f.id)
      if (events.some((e) => e.geometryFingerprint !== roadGeometryFingerprint(f))) return false
      const a = assessHistoricalWindow(path.period, events)
      return a.status === 'compatible' || (a.status === 'unknown' && path.settings.allowUnknownTime)
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const roads = eligible.map((f) => ({
    feature: f,
    coordinates:
      f.geometry.type === 'LineString'
        ? f.geometry.coordinates
            .map((p) => [p[0], p[1]] as Coordinate)
            .filter((p, i, points) => !i || distance(points[i - 1], p) > 1e-6)
        : [],
  }))
  const byId = new Map(roads.map((r) => [r.feature.id, r]))
  const endpoints = roads.flatMap((r) => [
    { road: r, coordinate: r.coordinates[0], position: 0 },
    { road: r, coordinate: r.coordinates.at(-1)!, position: r.coordinates.length - 1 },
  ])
  const junctions = new Map<string, { road: (typeof roads)[number]; coordinate: Coordinate }[]>()
  for (const road of roads)
    for (const junction of road.feature.roadEvidence?.network?.junctions ?? []) {
      const p = projectToLine(junction.coordinate, road.coordinates)
      if (!p.coordinate || p.distanceM > path.settings.snapToleranceM + 1e-7) continue
      const members = junctions.get(junction.id) ?? []
      members.push({ road, coordinate: p.coordinate })
      junctions.set(junction.id, members)
    }
  const compatibleLevels = (a: (typeof roads)[number], b: (typeof roads)[number], explicit: boolean) => {
    const left = a.feature.roadEvidence?.network?.level ?? null,
      right = b.feature.roadEvidence?.network?.level ?? null
    if (left !== null && right !== null) return left === right
    return explicit || path.settings.allowUnverifiedEndpointSnaps
  }
  const sourceNode = (roadId: string, position: number) => `${encodeURIComponent(roadId)}:${position.toFixed(9)}`
  const projectedNode = (road: (typeof roads)[number], point: Coordinate) => {
    const projection = projectToLine(point, road.coordinates)
    return projection.position === null ? null : sourceNode(road.feature.id, projection.position)
  }
  let previousNode: string | null = null
  for (const segment of path.segments) {
    let expected: Coordinate[] | null = null
    let nodes: (string | null)[] | null = null
    if (segment.kind === 'road') {
      const m = /^road:(.+):(\d+):([\d.]+)-([\d.]+)$/.exec(segment.id),
        road = segment.roadId ? byId.get(segment.roadId) : undefined
      if (!m || !road || m[1] !== encodeURIComponent(segment.roadId!))
        return 'Saved historical road segment identity does not match a date-compatible source road.'
      const index = Number(m[2]),
        start = Number(m[3]),
        end = Number(m[4]),
        a = road.coordinates[index],
        b = road.coordinates[index + 1]
      if (!a || !b || !(start >= 0 && start < end && end <= 1))
        return 'Saved historical road segment fractions are invalid.'
      expected = [start, end].map((t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
      nodes = [sourceNode(road.feature.id, index + start), sourceNode(road.feature.id, index + end)]
    } else if (segment.kind === 'junction') {
      const snap = /^snap:(\d+):(\d+)$/.exec(segment.id),
        declared = /^junction:(.+):(\d+)$/.exec(segment.id)
      if (snap) {
        const a = endpoints[Number(snap[1])],
          b = endpoints[Number(snap[2])]
        if (
          a &&
          b &&
          compatibleLevels(a.road, b.road, false) &&
          distance(a.coordinate, b.coordinate) <= path.settings.snapToleranceM + 1e-7
        ) {
          expected = [a.coordinate, b.coordinate]
          nodes = [sourceNode(a.road.feature.id, a.position), sourceNode(b.road.feature.id, b.position)]
        }
      } else if (declared) {
        const members = junctions.get(decodeURIComponent(declared[1])),
          a = members?.[0],
          b = members?.[Number(declared[2])]
        if (
          a &&
          b &&
          compatibleLevels(a.road, b.road, true) &&
          distance(a.coordinate, b.coordinate) <= path.settings.snapToleranceM + 1e-7
        ) {
          expected = [a.coordinate, b.coordinate]
          nodes = [projectedNode(a.road, a.coordinate), projectedNode(b.road, b.coordinate)]
        }
      } else if (segment.id.startsWith('loop:')) {
        const road = byId.get(decodeURIComponent(segment.id.slice(5)))
        if (road && distance(road.coordinates[0], road.coordinates.at(-1)!) < 1e-6) {
          expected = [road.coordinates[0], road.coordinates.at(-1)!]
          nodes = [sourceNode(road.feature.id, 0), sourceNode(road.feature.id, road.coordinates.length - 1)]
        }
      }
      if (!expected) return 'Saved historical path contains an undeclared, over-tolerance or grade-separated junction.'
    } else {
      if (!segment.id.startsWith('attachment-edge:')) return 'Saved historical attachment identity is invalid.'
      const id = decodeURIComponent(segment.id.slice('attachment-edge:'.length))
      const anchor = id.startsWith('anchor:') ? state.anchors.find((a) => a.id === id.slice(7)) : undefined
      const structure = id.startsWith('structure:') ? state.structures.find((s) => s.id === id.slice(10)) : undefined
      const location = anchor ?? structure
      if (!location) return 'Saved historical attachment refers to a missing named location.'
      const candidates = roads
        .filter((r) => !location.roadId || r.feature.id === location.roadId)
        .map((road) => ({ ...projectToLine(location.coordinate, road.coordinates), road }))
        .sort((a, b) => a.distanceM - b.distanceM)
      const nearest = candidates[0],
        tolerance = structure?.attachmentToleranceM ?? path.settings.attachmentToleranceM
      if (!nearest?.coordinate || nearest.distanceM > tolerance + 1e-7)
        return 'Saved historical attachment exceeds its named-road tolerance.'
      expected = [location.coordinate, nearest.coordinate]
      nodes = [`attachment:${id}`, projectedNode(nearest.road, nearest.coordinate)]
    }
    if (!segment.forward) {
      expected.reverse()
      nodes?.reverse()
    }
    if (expected.some((point, i) => distance(point, segment.coordinates[i]) > 0.01))
      return 'Saved historical path geometry no longer matches the identified source segments and junctions.'
    if (!nodes || nodes.some((node) => node === null) || (previousNode !== null && previousNode !== nodes[0]))
      return 'Saved historical path changes source-road nodes without its declared junction or attachment; coincident linework is not connectivity.'
    previousNode = nodes[1]
  }
  const start = state.anchors.find((a) => a.id === path.entranceId),
    end = state.anchors.find((a) => a.id === path.outletId)
  if (
    !start ||
    !end ||
    start.role !== 'entrance' ||
    start.blockId !== path.blockId ||
    end.role !== 'outlet' ||
    (end.blockId !== null && end.blockId !== path.blockId) ||
    historicalAnchorProblems(start, context, path.settings).length > 0 ||
    historicalAnchorProblems(end, context, path.settings).length > 0 ||
    distance(path.coordinates[0], start.coordinate) > 0.01 ||
    distance(path.coordinates.at(-1)!, end.coordinate) > 0.01
  )
    return 'Saved historical path does not connect its named entrance and outlet.'
  const assetAssessments = new Map(
    assessHistoricalStructures(state, context, path.settings.asOf).map((assessment) => [
      assessment.structureId,
      assessment,
    ]),
  )
  const sites = new Map<string, HistoricalStructure[]>()
  for (const structure of state.structures) {
    if (assetAssessments.get(structure.id)!.binding !== 'matched') continue
    const key = `${structure.roadId}|${structure.crossingSiteId ?? structure.structureId ?? structure.id}`
    const members = sites.get(key) ?? []
    members.push(structure)
    sites.set(key, members)
  }
  const touches = (structure: HistoricalStructure) => {
    const road = structure.roadId ? byId.get(structure.roadId) : undefined
    if (!road) return false
    const point = projectToLine(structure.coordinate, road.coordinates).coordinate
    return (
      point !== null &&
      path.segments.some(
        (segment) => segment.roadId === structure.roadId && pointLineDistance(point, segment.coordinates) < 0.02,
      )
    )
  }
  const usedStructures: HistoricalStructure[] = []
  for (const members of sites.values()) {
    if (!members.some(touches)) continue
    const available = members.some((structure) => assetAssessments.get(structure.id)!.status === 'conflict')
      ? []
      : members.filter((structure) => {
          const assessment = assetAssessments.get(structure.id)!
          return (
            assessment.status === 'compatible' || (assessment.status === 'unknown' && path.settings.allowUnknownTime)
          )
        })
    if (!available.length)
      return 'Saved historical path crosses a structure site without a date-compatible or explicitly qualified crossing.'
    usedStructures.push(...available.filter(touches))
  }
  if (stable(union(usedStructures.map((structure) => structure.id))) !== stable(union(path.structureIds)))
    return 'Saved historical structure IDs do not match the crossing evidence encountered by the physical path.'
  const requiredSources = union([
    ...start.sourceIds,
    ...end.sourceIds,
    ...state.events.filter((event) => path.roadIds.includes(event.roadId)).flatMap((event) => event.sourceIds),
    ...usedStructures.flatMap((structure) => [
      ...structure.sourceIds,
      ...assetAssessments.get(structure.id)!.sourceIds,
    ]),
  ])
  if (requiredSources.some((id) => !path.sourceIds.includes(id)))
    return 'Saved historical path omits source references used by its physical roads, crossings or named access locations.'
  return null
}

function harvestTimingAssumptions(block: ContextFeature, asOf: string): string[] {
  const evidence = block.harvestEvidence
  const earliest = evidence?.startDate ?? (evidence?.startYear !== undefined ? `${evidence.startYear}-01-01` : null)
  const latest = evidence?.endDate ?? (evidence?.endYear !== undefined ? `${evidence.endYear}-12-31` : null)
  const reasons: string[] = []
  if ((earliest && asOf < earliest) || (latest && asOf > latest))
    reasons.push(
      'The analysis date is outside the reported harvest interval. This trace compares network history; it does not document the route used during harvesting.',
    )
  if (!latest)
    reasons.push(
      'Harvest completion timing is unknown. The chosen network date does not establish that this access candidate was available during harvesting.',
    )
  else if (!evidence?.endDate)
    reasons.push(
      'Harvest timing is recorded only to calendar-year precision; it does not establish the exact harvest date or use of this route on the analysis date.',
    )
  return reasons
}

/** Bounded alternative geometric paths. No automatic output is classified as planned or documented use. */
export function traceHistoricalAccess(input: HistoricalTraceInput): HistoricalTraceResult {
  const state = parseAccessHistoryState(input.state, input.context)
  const settings = parseHistoricalTraceSettings({ ...state.settings, ...input.settings })
  const inputFingerprint = historicalInputFingerprint(input.context, state, settings)
  const result: HistoricalTraceResult = {
    paths: [],
    excludedRoads: [],
    structures: [],
    unresolved: [],
    inputFingerprint,
  }
  const block = input.context.find(
    (f) => f.id === input.blockId && f.kind === 'harvest' && f.geometry.type === 'Polygon',
  )
  if (!block) throw Error('Select a loaded cutblock for historical access reconstruction.')
  if (block.harvestEvidence?.status === 'proposed')
    throw Error('A proposed block has no historical access to reconstruct. Use access planning for proposals.')
  const entrances = state.anchors
    .filter(
      (a) =>
        a.role === 'entrance' && a.blockId === block.id && (!input.entranceIds || input.entranceIds.includes(a.id)),
    )
    .filter((anchor) => {
      if (blockSeparation(anchor.coordinate, block) <= settings.attachmentToleranceM + 1e-7) return true
      result.unresolved.push(
        `${anchor.name}: entrance is outside the selected cutblock footprint and the explicit attachment tolerance.`,
      )
      return false
    })
  const outlets = state.anchors.filter(
    (a) =>
      a.role === 'outlet' &&
      (!a.blockId || a.blockId === block.id) &&
      (!input.outletIds || input.outletIds.includes(a.id)),
  )
  if (!entrances.length || !outlets.length) {
    result.unresolved.push(
      'Save at least one explicit block entrance and network outlet. No centroid or nearest-road substitute was made.',
    )
    return result
  }
  if (entrances.length * outlets.length > 24)
    throw Error('Compare at most 24 entrance/outlet pairs in one historical trace.')
  const roads = input.context.filter((f) => f.kind === 'existing-road' && f.geometry.type === 'LineString')
  const period = { earliest: settings.asOf, latest: settings.asOf }
  const assessments = new Map<string, HistoricalTemporalAssessment>()
  const eligible = roads.filter((road) => {
    const assessment = assessHistoricalRoad(road, state.events, settings.asOf)
    assessments.set(road.id, assessment)
    const allowed = assessment.status === 'compatible' || (assessment.status === 'unknown' && settings.allowUnknownTime)
    if (!allowed) result.excludedRoads.push({ roadId: road.id, name: road.name, reasons: assessment.reasons })
    return allowed
  })
  for (const event of state.events)
    if (!roads.some((r) => r.id === event.roadId))
      result.unresolved.push(`Road event ${event.id} refers to missing road ${event.roadId}.`)
  const structureAssessments = new Map(
    assessHistoricalStructures(state, input.context, settings.asOf).map((a) => [a.structureId, a]),
  )
  result.structures = [...structureAssessments.values()].map(({ structureId, status, reasons }) => ({
    structureId,
    status,
    reasons,
  }))
  const boundStructures = state.structures.filter((s) => {
    const a = structureAssessments.get(s.id)!
    if (a.binding === 'unresolved') result.unresolved.push(`${s.name}: ${a.reasons.join(' ')}`)
    return a.binding === 'matched'
  })
  const allAnchors = state.anchors // One graph splits shared portions consistently for every saved entrance/outlet.
  let graph = buildHistoricalRoadTopology(
    eligible.map((f) => ({
      id: f.id,
      name: f.name,
      coordinates:
        f.geometry.type === 'LineString' ? f.geometry.coordinates.map((c) => [c[0], c[1]] as Coordinate) : [],
      level: f.roadEvidence?.network?.level ?? null,
      junctions: f.roadEvidence?.network?.junctions ?? [],
    })),
    settings,
    [
      ...allAnchors.map((a) => ({
        id: `anchor:${a.id}`,
        coordinate: a.coordinate,
        ...(a.roadId ? { roadId: a.roadId } : {}),
        maxDistanceM: settings.attachmentToleranceM,
      })),
      ...boundStructures.map((s) => ({
        id: `structure:${s.id}`,
        coordinate: s.coordinate,
        roadId: s.roadId!,
        maxDistanceM: s.attachmentToleranceM,
      })),
    ],
  )
  // A crossing is scoped to its own point on its named road. Other portions remain available.
  const sites = new Map<string, HistoricalStructure[]>()
  for (const s of boundStructures) {
    const key = `${s.roadId}|${s.crossingSiteId ?? s.structureId ?? s.id}`
    const siblings = sites.get(key) ?? []
    siblings.push(s)
    sites.set(key, siblings)
  }
  const blocked = new Set<string>(),
    usableStructures = new Set<string>(),
    assetReasons: string[] = []
  for (const siblings of sites.values()) {
    const statuses = siblings.map((s) => ({
      s,
      a: structureAssessments.get(s.id)!,
      attachment: graph.attachments.get(`structure:${s.id}`),
    }))
    const good = statuses.filter(
      ({ a, attachment }) =>
        attachment?.nodeId && (a.status === 'compatible' || (a.status === 'unknown' && settings.allowUnknownTime)),
    )
    const sameSiteConflicts = statuses.some(({ a }) => a.status === 'conflict')
    const valid = sameSiteConflicts ? [] : good
    if (valid.length) {
      valid.forEach(({ s }) => usableStructures.add(s.id))
      continue
    }
    for (const { s, a, attachment } of statuses) {
      if (!attachment?.nodeId) {
        result.unresolved.push(`${s.name}: its named road is unavailable or the attachment is unresolved.`)
        continue
      }
      assetReasons.push(`${s.name}: ${a.reasons.join(' ')}`)
      // attachment.nodeId may be an offset marker; find the projected road node instead.
      const nodeIds = new Set([attachment.nodeId])
      for (const e of graph.edges.values())
        if (e.kind === 'attachment' && (e.from === attachment.nodeId || e.to === attachment.nodeId)) {
          nodeIds.add(e.from)
          nodeIds.add(e.to)
        }
      for (const edge of graph.edges.values())
        if (edge.roadId === s.roadId && (nodeIds.has(edge.from) || nodeIds.has(edge.to))) blocked.add(edge.id)
    }
  }
  graph = filteredGraph(graph, blocked)
  result.unresolved.push(...assetReasons)
  let searches = 0
  const candidates: {
    entrance: HistoricalAnchor
    outlet: HistoricalAnchor
    path: NonNullable<ReturnType<typeof shortestHistoricalTopologyPath>>
  }[] = []
  const seen = new Set<string>()
  const add = (
    entrance: HistoricalAnchor,
    outlet: HistoricalAnchor,
    path: ReturnType<typeof shortestHistoricalTopologyPath>,
  ) => {
    if (!path || !path.edgeIds.length) return false
    const key = `${entrance.id}|${outlet.id}|${path.edgeIds.join('|')}`
    if (seen.has(key)) return false
    seen.add(key)
    candidates.push({ entrance, outlet, path })
    return true
  }
  for (const entrance of entrances)
    for (const outlet of outlets) {
      searches++
      const path = shortestHistoricalTopologyPath(graph, `anchor:${entrance.id}`, `anchor:${outlet.id}`)
      if (path && !path.edgeIds.length) {
        result.unresolved.push(
          `${entrance.name} is already at ${outlet.name}; no intervening road-segment path was required.`,
        )
        continue
      }
      if (!add(entrance, outlet, path))
        result.unresolved.push(
          `${entrance.name} → ${outlet.name}: no continuous date-compatible path in the loaded network.`,
        )
    }
  // Excluding one used physical edge discovers bounded alternatives without claiming all possible routes.
  for (const candidate of [...candidates]) {
    const edgeIds = candidate.path.edgeIds.filter((id) => graph.edges.get(id)?.kind === 'road')
    for (const edgeId of edgeIds) {
      if (searches >= MAX_HISTORY_PATH_SEARCHES) break
      searches++
      add(
        candidate.entrance,
        candidate.outlet,
        shortestHistoricalTopologyPath(
          filteredGraph(graph, new Set([edgeId])),
          `anchor:${candidate.entrance.id}`,
          `anchor:${candidate.outlet.id}`,
        ),
      )
    }
  }
  if (searches >= MAX_HISTORY_PATH_SEARCHES)
    result.unresolved.push(
      'The 48-search alternative budget was reached. These candidates are not an exhaustive set of historical routes.',
    )
  candidates.sort(
    (a, b) =>
      a.path.lengthM - b.path.lengthM ||
      a.entrance.id.localeCompare(b.entrance.id) ||
      a.outlet.id.localeCompare(b.outlet.id) ||
      a.path.edgeIds.join().localeCompare(b.path.edgeIds.join()),
  )
  if (candidates.length > settings.maxVariants)
    result.unresolved.push(
      `Showing ${settings.maxVariants} of ${candidates.length} distinct paths found within the bounded search, ordered by geometric length; this is not an exhaustive route inventory.`,
    )
  for (const candidate of candidates.slice(0, settings.maxVariants)) {
    const { entrance, outlet, path } = candidate
    let node = graph.attachments.get(`anchor:${entrance.id}`)!.nodeId!
    const segments: HistoricalPathSegment[] = []
    for (const edgeId of path.edgeIds) {
      const e = graph.edges.get(edgeId)!
      if (e.from !== node && e.to !== node)
        throw Error('Historical path topology is disconnected; no association was saved.')
      const forward = e.from === node
      const coordinates = (forward ? e.coordinates : [...e.coordinates].reverse()) as [Coordinate, Coordinate]
      segments.push({ id: e.id, roadId: e.roadId, kind: e.kind, forward, coordinates, lengthM: e.lengthM })
      node = forward ? e.to : e.from
    }
    if (node !== graph.attachments.get(`anchor:${outlet.id}`)!.nodeId)
      throw Error('Historical path does not reach its named outlet.')
    const roadIds = union(segments.flatMap((s) => (s.roadId ? [s.roadId] : [])))
    const structureIds = [...usableStructures].filter((id) => {
      const s = state.structures.find((v) => v.id === id)!,
        attachment = graph.attachments.get(`structure:${id}`)
      if (!attachment?.projectedCoordinate) return false
      return segments.some(
        (segment) =>
          segment.roadId === s.roadId &&
          (distance(segment.coordinates[0], attachment.projectedCoordinate!) < 0.02 ||
            distance(segment.coordinates[1], attachment.projectedCoordinate!) < 0.02),
      )
    })
    const refs = union([
      ...entrance.sourceIds,
      ...outlet.sourceIds,
      ...roadIds.flatMap((id) => assessments.get(id)!.sourceIds),
      ...structureIds.flatMap((id) => {
        const structure = state.structures.find((s) => s.id === id)!
        return [...structure.sourceIds, ...structureAssessments.get(structure.id)!.sourceIds]
      }),
    ])
    const assumptions = union([
      ...path.warnings,
      'This is a geometric historical-access candidate, not proof that this route was used or built for this block.',
      'Vehicle capacity, present condition and current legal access are not established.',
      ...roadIds.flatMap((id) =>
        assessments.get(id)!.status === 'unknown'
          ? [`Unknown historical timing was explicitly allowed for ${roads.find((r) => r.id === id)!.name}.`]
          : [],
      ),
      ...structureIds.flatMap((id) =>
        assessHistoricalStructure(state.structures.find((s) => s.id === id)!, settings.asOf).status === 'unknown'
          ? [`Unknown historical timing was explicitly allowed for structure ${id}.`]
          : [],
      ),
      ...result.unresolved.filter((reason) => !reason.includes('no continuous')),
      ...harvestTimingAssumptions(block, settings.asOf),
    ])
    const coordinates = [segments[0].coordinates[0], ...segments.map((s) => s.coordinates[1])]
    result.paths.push({
      id: `access-${fingerprint({ block: block.id, entrance: entrance.id, outlet: outlet.id, edges: path.edgeIds, inputFingerprint })}`,
      blockId: block.id,
      entranceId: entrance.id,
      outletId: outlet.id,
      period,
      settings: { ...settings },
      relationship: 'inferred-access',
      sourceIds: refs,
      roadIds,
      coordinates,
      segments,
      structureIds,
      lengthM: path.lengthM,
      inputFingerprint,
      assumptions,
      review: null,
    })
  }
  result.unresolved = union(result.unresolved)
  return result
}
export const deriveHistoricalCandidates = traceHistoricalAccess

export function assessHistoricalPath(
  path: HistoricalAccessPath,
  state: HistoricalAccessState,
  context: readonly ContextFeature[],
) {
  const reasons: string[] = []
  const inputChanged = path.inputFingerprint !== historicalInputFingerprint(context, state, path.settings)
  const topologyProblem = inputChanged ? null : savedTopologyProblem(path, state, context)
  const stale = inputChanged || !!topologyProblem
  if (topologyProblem) reasons.push(topologyProblem)
  if (stale)
    reasons.push(
      'Source geometry, event evidence, structures or named access locations changed since this path was traced.',
    )
  const missing = path.roadIds.filter((id) => !context.some((f) => f.id === id && f.kind === 'existing-road'))
  if (missing.length) reasons.push(`Missing historical road inputs: ${missing.join(', ')}.`)
  if (!context.some((f) => f.id === path.blockId && f.kind === 'harvest'))
    reasons.push('The path cutblock is no longer loaded.')
  if (![path.entranceId, path.outletId].every((id) => state.anchors.some((a) => a.id === id)))
    reasons.push('A named path entrance or outlet is missing.')
  const roads = context.filter((f) => f.kind === 'existing-road')
  let unresolvedAsset = false
  const assessments: HistoricalTemporalAssessment[] = path.roadIds.map((roadId) => {
    const events = state.events.filter((e) => e.roadId === roadId),
      road = roads.find((r) => r.id === roadId)
    if (road && events.some((e) => e.geometryFingerprint !== roadGeometryFingerprint(road)))
      return {
        status: 'conflict',
        reasons: ['A retained physical road event no longer matches its geometry scope.'],
        sourceIds: events.flatMap((e) => e.sourceIds),
      }
    return assessHistoricalWindow(path.period, events)
  })
  const assetAssessments = new Map(
    assessHistoricalStructures(state, context, path.settings.asOf).map((a) => [a.structureId, a]),
  )
  for (const id of path.structureIds) {
    const structure = state.structures.find((s) => s.id === id)
    if (!structure) {
      unresolvedAsset = true
      reasons.push(`Historical structure ${id} is missing.`)
      assessments.push({
        status: 'unknown',
        reasons: ['A structure used by this path is no longer in the evidence register.'],
        sourceIds: [],
      })
      continue
    }
    const a = assetAssessments.get(id)!
    if (a.binding === 'unresolved') {
      unresolvedAsset = true
      reasons.push(`${structure.name}: ${a.reasons.join(' ')}`)
    }
    assessments.push(a)
  }
  const temporalStatus = assessments.some((a) => a.status === 'conflict')
    ? 'conflict'
    : assessments.some((a) => a.status === 'contradicted')
      ? 'contradicted'
      : assessments.some((a) => a.status === 'unknown')
        ? 'unknown'
        : 'compatible'
  if (temporalStatus !== 'compatible')
    reasons.push(...assessments.filter((a) => a.status !== 'compatible').flatMap((a) => a.reasons))
  return {
    stale,
    temporalStatus: temporalStatus as HistoricalTemporalAssessment['status'],
    connectivity:
      missing.length ||
      unresolvedAsset ||
      !!topologyProblem ||
      reasons.some((r) => r.includes('missing') || r.includes('no longer'))
        ? ('unresolved' as const)
        : ('stored-continuous' as const),
    reasons: union(reasons),
  }
}

export function mergeHistoricalTrace(
  state: HistoricalAccessState,
  result: HistoricalTraceResult,
): HistoricalAccessState {
  const paths = new Map(state.paths.map((p) => [p.id, p]))
  for (const path of result.paths) if (!paths.has(path.id)) paths.set(path.id, path)
  return parseAccessHistoryState({
    ...state,
    paths: [...paths.values()],
    selectedPathId: result.paths[0]?.id ?? state.selectedPathId,
  })
}

export function reviewHistoricalPath(
  state: HistoricalAccessState,
  pathId: string,
  relationship: HistoricalRelationship,
  review: NonNullable<HistoricalAccessPath['review']>,
  refs: string[],
  context: readonly ContextFeature[],
): HistoricalAccessState {
  const path = state.paths.find((p) => p.id === pathId)
  if (!path) throw Error('Choose a saved historical path to review.')
  const assessment = assessHistoricalPath(path, state, context)
  if (
    relationship !== 'rejected' &&
    (assessment.stale ||
      assessment.connectivity === 'unresolved' ||
      ['contradicted', 'conflict'].includes(assessment.temporalStatus))
  )
    throw Error(
      'Retrace or resolve changed, missing or conflicting evidence before asserting a historical association.',
    )
  if (!refs.length && ['planned-access', 'documented-use'].includes(relationship))
    throw Error('Attach the actual planned-access or historical-use source before recording that assertion.')
  return parseAccessHistoryState(
    {
      ...state,
      paths: state.paths.map((p) =>
        p.id === pathId ? { ...p, relationship, sourceIds: union([...p.sourceIds, ...refs]), review } : p,
      ),
    },
    context,
  )
}

/** Physical overlap, not procurement totals. No historical price is invented from geometry. */
export function historicalSharedUsage(paths: readonly HistoricalAccessPath[], state?: HistoricalAccessState) {
  const included = paths.filter((p) => p.relationship !== 'rejected')
  const groups = new Map<string, { start: number; end: number; fullLength: number }[]>()
  let summedPathRoadLengthM = 0
  for (const path of included)
    for (const segment of path.segments) {
      if (segment.kind !== 'road') continue
      summedPathRoadLengthM += segment.lengthM
      const match = /^road:(.+):(\d+):([\d.]+)-([\d.]+)$/.exec(segment.id)
      if (!match) throw Error('Historical road segments need stable source-segment identities for shared accounting.')
      const start = Number(match[3]),
        end = Number(match[4]),
        fraction = end - start
      if (!(fraction > 0)) throw Error('Historical source-segment fractions are invalid.')
      // Store geometry in source direction so old/replaced geometries with the same road ID do not merge.
      const ordered = segment.forward ? segment.coordinates : [segment.coordinates[1], segment.coordinates[0]]
      const dx = (ordered[1][0] - ordered[0][0]) / fraction,
        dy = (ordered[1][1] - ordered[0][1]) / fraction
      const base = [ordered[0][0] - start * dx, ordered[0][1] - start * dy]
      const geometry = `${base[0].toFixed(8)}:${base[1].toFixed(8)}:${dx.toFixed(8)}:${dy.toFixed(8)}`
      const key = `${match[1]}:${match[2]}:${geometry}`
      const entries = groups.get(key) ?? []
      entries.push({ start, end, fullLength: segment.lengthM / fraction })
      groups.set(key, entries)
    }
  let uniqueRoadLengthM = 0
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.start - b.start || a.end - b.end)
    let start = entries[0].start,
      end = entries[0].end
    const length = entries[0].fullLength
    for (const interval of entries.slice(1)) {
      if (interval.start <= end + 1e-9) end = Math.max(end, interval.end)
      else {
        uniqueRoadLengthM += (end - start) * length
        start = interval.start
        end = interval.end
      }
    }
    uniqueRoadLengthM += (end - start) * length
  }
  const structureIds = union(included.flatMap((p) => p.structureIds))
  const physicalSites = new Set(
    structureIds.map((id) => {
      const s = state?.structures.find((v) => v.id === id)
      return s?.crossingSiteId ? `${s.roadId}|${s.crossingSiteId}` : id
    }),
  )
  const physicalStructures = new Set(
    structureIds.map((id) => {
      const s = state?.structures.find((v) => v.id === id)
      return s?.structureId ? `${s.roadId}|${s.structureId}` : `unresolved-record:${id}`
    }),
  )
  return {
    pathCount: included.length,
    roadIds: union(included.flatMap((p) => p.roadIds)),
    structureIds,
    uniqueStructureCount: physicalStructures.size,
    uniqueCrossingSiteCount: physicalSites.size,
    summedPathRoadLengthM,
    uniqueRoadLengthM,
    sharedRoadLengthM: Math.max(0, summedPathRoadLengthM - uniqueRoadLengthM),
    constructionCost: null,
    note: 'Shared geometry and crossing sites are counted once. Historical construction or rehabilitation costs remain unknown; alternative paths are not a combined build estimate.',
  }
}

/** Bounded connected-road graph. Source linework is evidence, not a verified topology or access right. */
import { distance } from './engine'
import { assessRoadCondition, type RoadConditionObservation, type RoadConditionPolicy } from './roadCondition'
import type { ContextFeature, Coordinate, ExistingRoadEvidence } from './types'
import type {
  BridgeLoadRatingEvidence,
  RoadNetworkAttachmentInput,
  RoadNetworkCostItem,
  RoadNetworkEvidence,
  RoadNetworkGraph,
  RoadNetworkInput,
  RoadNetworkPath,
  RoadNetworkPathOptions,
  RoadNetworkPolicy,
} from './roadNetworkTypes'
export type * from './roadNetworkTypes'

export const MAX_NETWORK_ROADS = 500
export const MAX_NETWORK_VERTICES = 20000
export const MAX_NETWORK_NODES = 50000
export const MAX_NETWORK_EDGES = 75000
export const MAX_NETWORK_OPERATIONS = 2000000
export const MAX_NETWORK_PATH_STATES = 50000
export const MAX_NETWORK_PATH_TRANSITIONS = 1000000
export const MAX_NETWORK_PAID_GROUP_ENTRIES = 1000000

const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const record = (raw: unknown, name: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${name} must be an object.`)
  return raw as Record<string, unknown>
}
function nullableNumber(raw: unknown, name: string, min: number, max: number) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max)
    throw Error(`${name} must be between ${min} and ${max}, or unknown.`)
  return raw
}
function coordinate(raw: unknown): Coordinate {
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    !raw.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    Math.abs(raw[0]) > 180 ||
    Math.abs(raw[1]) >= 85
  )
    throw Error('Network coordinates must be finite WGS84 longitude/latitude.')
  return [raw[0], raw[1]]
}
function string(raw: unknown, name: string, max = 100) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max)
    throw Error(`${name} must contain 1–${max} characters.`)
  return raw.trim()
}
function nullableString(raw: unknown, name: string) {
  return raw === undefined || raw === null ? null : string(raw, name)
}
function strings(raw: unknown, name: string) {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw) || raw.length > 50) throw Error(`${name} must have at most 50 entries, or remain unknown.`)
  return [...new Set(raw.map((value) => string(value, name)))].sort()
}
function flag(raw: unknown, fallback: boolean, name: string) {
  if (raw === undefined) return fallback
  if (typeof raw !== 'boolean') throw Error(`${name} must be true or false.`)
  return raw
}
function dateString(raw: unknown) {
  const value = string(raw, 'Network assessment date', 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw Error('Use a valid YYYY-MM-DD network assessment date.')
  return value
}

export function createBridgeLoadRatingEvidence(ratedLoadTonnes: number | null = null): BridgeLoadRatingEvidence {
  return { sourceReference: '', reviewer: '', ratedLoadTonnes, ratedAt: null, validUntil: null, vehicleClasses: null }
}

export function parseBridgeLoadRatingEvidence(raw: unknown): BridgeLoadRatingEvidence | null {
  if (raw === undefined || raw === null) return null
  const r = record(raw, 'Bridge load-rating evidence')
  const optionalText = (rawText: unknown, label: string, max: number) => {
    if (rawText === undefined) return ''
    if (typeof rawText !== 'string' || rawText.length > max)
      throw Error(`${label} must contain at most ${max} characters.`)
    return rawText.trim()
  }
  const ratedAt = r.ratedAt === null || r.ratedAt === undefined ? null : dateString(r.ratedAt)
  const validUntil = r.validUntil === null || r.validUntil === undefined ? null : dateString(r.validUntil)
  if (ratedAt && validUntil && validUntil < ratedAt)
    throw Error('Bridge rating validity must end on or after its rating date.')
  return {
    sourceReference: optionalText(r.sourceReference, 'Bridge rating reference', 2000),
    reviewer: optionalText(r.reviewer, 'Bridge rating reviewer', 200),
    ratedLoadTonnes: nullableNumber(r.ratedLoadTonnes, 'Rated bridge load (tonnes)', 0, 1000),
    ratedAt,
    validUntil,
    vehicleClasses: strings(r.vehicleClasses, 'Bridge rating vehicle classes'),
  }
}

export function createRoadNetworkEvidence(): RoadNetworkEvidence {
  return {
    access: 'unknown',
    seasons: null,
    vehicleClasses: null,
    maxVehicleWeightTonnes: null,
    bridgeStatus: 'unknown',
    bridgeLoadTonnes: null,
    bridgeRating: null,
    direction: 'both',
    level: null,
    forwardUphillGradePercent: null,
    forwardDownhillGradePercent: null,
    rehabilitationCostPerM: null,
    accessCost: null,
    structureCost: null,
    fixedCost: null,
    haulCostFactor: 1,
    junctions: [],
  }
}
export function parseRoadNetworkEvidence(raw: unknown): RoadNetworkEvidence {
  const r = record(raw, 'Road network evidence'),
    defaults = createRoadNetworkEvidence()
  const access = r.access ?? defaults.access,
    direction = r.direction ?? defaults.direction
  const bridgeStatus = r.bridgeStatus ?? defaults.bridgeStatus
  if (typeof access !== 'string' || !['allowed', 'permission-required', 'closed', 'unknown'].includes(access))
    throw Error('Invalid road access status.')
  if (typeof direction !== 'string' || !['both', 'forward', 'reverse'].includes(direction))
    throw Error('Invalid road travel direction.')
  if (typeof bridgeStatus !== 'string' || !['none', 'reviewed', 'closed', 'unknown'].includes(bridgeStatus))
    throw Error('Invalid bridge restriction status.')
  const level = nullableNumber(r.level, 'Road grade-separation level', -100, 100)
  if (level !== null && !Number.isInteger(level)) throw Error('Road grade-separation level must be a whole number.')
  const junctions = r.junctions ?? []
  if (!Array.isArray(junctions) || junctions.length > 100) throw Error('Use at most 100 declared junctions per road.')
  const parsedJunctions = junctions.map((rawJunction) => {
    const j = record(rawJunction, 'Road junction'),
      id = string(j.id, 'Junction ID')
    if (!/^[a-zA-Z0-9_.:-]+$/.test(id))
      throw Error('Junction IDs must use letters, numbers, periods, underscores, colons or hyphens.')
    return { id, coordinate: coordinate(j.coordinate) }
  })
  if (new Set(parsedJunctions.map((j) => j.id)).size !== parsedJunctions.length)
    throw Error('A road repeats a declared junction ID.')
  return {
    access: access as RoadNetworkEvidence['access'],
    direction: direction as RoadNetworkEvidence['direction'],
    seasons: strings(r.seasons, 'Permitted seasons'),
    vehicleClasses: strings(r.vehicleClasses, 'Permitted vehicle classes'),
    maxVehicleWeightTonnes: nullableNumber(r.maxVehicleWeightTonnes, 'Vehicle weight restriction (tonnes)', 0, 1000),
    bridgeStatus: bridgeStatus as RoadNetworkEvidence['bridgeStatus'],
    bridgeLoadTonnes: nullableNumber(r.bridgeLoadTonnes, 'Bridge load restriction (tonnes)', 0, 1000),
    bridgeRating: parseBridgeLoadRatingEvidence(r.bridgeRating),
    level,
    forwardUphillGradePercent: nullableNumber(r.forwardUphillGradePercent, 'Known forward uphill grade', 0, 100),
    forwardDownhillGradePercent: nullableNumber(r.forwardDownhillGradePercent, 'Known forward downhill grade', 0, 100),
    rehabilitationCostPerM: nullableNumber(r.rehabilitationCostPerM, 'Rehabilitation cost per metre', 0, 1e6),
    accessCost: nullableNumber(r.accessCost, 'Access allowance', 0, 1e12),
    structureCost: nullableNumber(r.structureCost, 'Structure allowance', 0, 1e12),
    fixedCost: nullableNumber(r.fixedCost, 'Road setup allowance', 0, 1e12),
    haulCostFactor: nullableNumber(r.haulCostFactor ?? 1, 'Road haul cost factor', 0.1, 100)!,
    junctions: parsedJunctions,
  }
}
export function createRoadNetworkPolicy(asOf = today()): RoadNetworkPolicy {
  return {
    asOf: dateString(asOf),
    requireCurrentConditionEvidence: true,
    snapToleranceM: 1,
    attachmentToleranceM: 1,
    season: null,
    vehicleClass: null,
    vehicleWeightTonnes: null,
    maxUphillGradePercent: null,
    maxDownhillGradePercent: null,
    allowUnknownAccess: false,
    allowPermissionRequired: false,
    allowUnknownRestrictions: false,
    allowUnknownCondition: false,
    allowUnverifiedEndpointSnaps: false,
  }
}
export const DEFAULT_ROAD_NETWORK_POLICY = createRoadNetworkPolicy()
export function parseRoadNetworkPolicy(raw: unknown): RoadNetworkPolicy {
  const r = record(raw, 'Road network policy'),
    defaults = createRoadNetworkPolicy()
  return {
    asOf: r.asOf === undefined ? defaults.asOf : dateString(r.asOf),
    requireCurrentConditionEvidence: flag(
      r.requireCurrentConditionEvidence,
      true,
      'Current condition evidence requirement',
    ),
    snapToleranceM: nullableNumber(r.snapToleranceM ?? defaults.snapToleranceM, 'Endpoint snap tolerance', 0, 50)!,
    attachmentToleranceM: nullableNumber(
      r.attachmentToleranceM ?? defaults.attachmentToleranceM,
      'Network attachment tolerance',
      0,
      50,
    )!,
    season: nullableString(r.season, 'Planning season'),
    vehicleClass: nullableString(r.vehicleClass, 'Planning vehicle class'),
    vehicleWeightTonnes: nullableNumber(r.vehicleWeightTonnes, 'Planning vehicle weight', 0.01, 1000),
    maxUphillGradePercent: nullableNumber(r.maxUphillGradePercent, 'Maximum network uphill grade', 0, 100),
    maxDownhillGradePercent: nullableNumber(r.maxDownhillGradePercent, 'Maximum network downhill grade', 0, 100),
    allowUnknownAccess: flag(r.allowUnknownAccess, false, 'Unknown access assumption'),
    allowPermissionRequired: flag(r.allowPermissionRequired, false, 'Permission-required access assumption'),
    allowUnknownRestrictions: flag(r.allowUnknownRestrictions, false, 'Unknown restriction assumption'),
    allowUnknownCondition: flag(r.allowUnknownCondition, false, 'Unknown condition assumption'),
    allowUnverifiedEndpointSnaps: flag(
      r.allowUnverifiedEndpointSnaps,
      false,
      'Unverified endpoint connection assumption',
    ),
  }
}

/** App adapter only; generic graph inputs also support independently checked proposed links. */
export function roadNetworkInputs(context: readonly ContextFeature[]): RoadNetworkInput[] {
  return context
    .filter((f) => f.kind === 'existing-road' && f.geometry.type === 'LineString')
    .map((f) => ({
      id: f.id,
      name: f.name,
      coordinates:
        f.geometry.type === 'LineString' ? f.geometry.coordinates.map((p) => [p[0], p[1]] as Coordinate) : [],
      evidence: f.roadEvidence,
      network: (f.roadEvidence as (ExistingRoadEvidence & { network?: RoadNetworkEvidence }) | undefined)?.network,
    }))
}

type ExtendedEvidence = ExistingRoadEvidence & {
  observations?: RoadConditionObservation[]
  conditionPolicy?: RoadConditionPolicy
}
export function evaluateNetworkRoad(input: RoadNetworkInput, policy: RoadNetworkPolicy) {
  const n = input.network ?? createRoadNetworkEvidence(),
    e = input.evidence as ExtendedEvidence | undefined
  const reasons: string[] = [],
    warnings: string[] = []
  let condition = e?.condition ?? 'unknown'
  if (!input.proposed) {
    if (!e?.reuseAllowed) reasons.push('Road reuse is not explicitly approved.')
    if (e?.geometryReviewRequired)
      reasons.push('The source road geometry changed; evidence and network scope must be explicitly reconfirmed.')
    const assessment = assessRoadCondition(e?.observations ?? [], {
      asOf: policy.asOf,
      policy: e?.conditionPolicy ?? { maxInspectionAgeDays: null, maxImageryAgeDays: null },
    })
    if (condition === 'closed' || assessment.hasOpenClosureEvidence)
      reasons.push('Road has closed or unresolved closure evidence.')
    if (policy.requireCurrentConditionEvidence) {
      if (assessment.hasConflicts || !['serviceable', 'rehabilitation'].includes(assessment.condition))
        reasons.push('No consistent current positive condition evidence applies on the planning date.')
      else
        condition =
          condition === 'rehabilitation' || assessment.condition === 'rehabilitation' ? 'rehabilitation' : 'serviceable'
    } else {
      warnings.push('Current dated condition evidence is not required by this explicit planning policy.')
      if (condition === 'unknown' && !policy.allowUnknownCondition) reasons.push('Road condition is unknown.')
      else if (condition === 'unknown') warnings.push('Unknown road condition is explicitly assumed passable.')
    }
  }
  if (n.access === 'closed') reasons.push('Road access is closed.')
  else if (n.access === 'unknown') {
    if (!policy.allowUnknownAccess) reasons.push('Road access is unknown.')
    else warnings.push('Unknown road access is explicitly assumed available.')
  } else if (n.access === 'permission-required') {
    if (!policy.allowPermissionRequired)
      reasons.push('Required access permission has not been allowed in the planning policy.')
    else warnings.push('Permission-required access is explicitly assumed available; this does not grant permission.')
  }
  const unknown = (message: string) => {
    if (policy.allowUnknownRestrictions) warnings.push(`${message} Explicitly assumed unrestricted.`)
    else reasons.push(message)
  }
  const permitted = (entries: string[] | null, value: string | null, label: string) => {
    if (entries?.length === 0) {
      reasons.push(`No ${label.toLowerCase()} is permitted on this road.`)
      return
    }
    if (entries?.includes('*')) return
    if (!entries || value === null) unknown(`${label} applicability is unknown.`)
    else if (!entries.includes(value)) reasons.push(`${label} ${value} is not permitted.`)
  }
  permitted(n.seasons, policy.season, 'Season')
  permitted(n.vehicleClasses, policy.vehicleClass, 'Vehicle class')
  const weight = (limit: number | null, label: string) => {
    if (limit === null || policy.vehicleWeightTonnes === null)
      unknown(`${label} or the planning vehicle weight is unknown.`)
    else if (policy.vehicleWeightTonnes > limit + 1e-9)
      reasons.push(`${label} of ${limit} t is below the ${policy.vehicleWeightTonnes} t vehicle weight.`)
  }
  weight(n.maxVehicleWeightTonnes, 'Road vehicle weight limit')
  if (n.bridgeStatus === 'closed') reasons.push('A bridge or structure on this road is closed.')
  else if (n.bridgeStatus === 'unknown') unknown('Bridge presence/load restrictions are unknown.')
  else if (n.bridgeStatus === 'reviewed') {
    // A known restrictive capacity remains restrictive even if its evidence later becomes stale.
    weight(n.bridgeLoadTonnes, 'Bridge load limit')
    const rating = n.bridgeRating
    const missing: string[] = []
    if (!rating) missing.push('separate dated load-rating evidence is missing')
    else {
      if (rating.ratedLoadTonnes !== null) weight(rating.ratedLoadTonnes, 'Documented bridge load limit')
      else missing.push('the documented rated capacity is unknown')
      if (!rating.sourceReference.trim()) missing.push('the source/report reference is missing')
      if (!rating.reviewer.trim()) missing.push('the rating review is unconfirmed')
      if (!rating.ratedAt) missing.push('the rating date is unknown')
      else if (rating.ratedAt > policy.asOf) missing.push('the rating is dated after the assessment date')
      if (!rating.validUntil) missing.push('the rating validity period is unknown')
      else if (rating.validUntil < policy.asOf) missing.push('the rating expired before the assessment date')
      if (rating.vehicleClasses?.length === 0)
        reasons.push('The bridge load rating does not apply to any permitted vehicle class.')
      else if (!rating.vehicleClasses?.includes('*')) {
        if (!rating.vehicleClasses || policy.vehicleClass === null)
          missing.push('rating applicability to the planning vehicle class is unknown')
        else if (!rating.vehicleClasses.includes(policy.vehicleClass))
          reasons.push(`The bridge load rating does not apply to vehicle class ${policy.vehicleClass}.`)
      }
      if (rating.ratedLoadTonnes !== null && n.bridgeLoadTonnes !== null && n.bridgeLoadTonnes > rating.ratedLoadTonnes)
        warnings.push(
          `The entered bridge limit is higher than the documented ${rating.ratedLoadTonnes} t rating; the lower documented limit is enforced.`,
        )
    }
    if (missing.length) unknown(`Bridge load rating is unresolved: ${missing.join('; ')}.`)
  }
  const directionAllowed = (forward: boolean) => {
    if (forward ? n.direction === 'reverse' : n.direction === 'forward') return false
    const up = forward ? n.forwardUphillGradePercent : n.forwardDownhillGradePercent
    const down = forward ? n.forwardDownhillGradePercent : n.forwardUphillGradePercent
    for (const [observed, limit, label] of [
      [up, policy.maxUphillGradePercent, 'uphill'],
      [down, policy.maxDownhillGradePercent, 'downhill'],
    ] as const) {
      if (limit === null) continue
      if (observed === null) {
        if (!policy.allowUnknownRestrictions) return false
        warnings.push(
          `Unknown ${forward ? 'forward' : 'reverse'} ${label} grade is explicitly assumed within the vehicle limit.`,
        )
      } else if (observed > limit + 1e-9) return false
    }
    return true
  }
  const forwardAllowed = directionAllowed(true),
    reverseAllowed = directionAllowed(false)
  if (!forwardAllowed && !reverseAllowed)
    reasons.push('No travel direction satisfies the direction and known/unknown grade restrictions.')
  return {
    eligible: !reasons.length,
    reasons,
    warnings: [...new Set(warnings)],
    condition,
    forwardAllowed,
    reverseAllowed,
  }
}

type Mark = { nodeId: string; coordinate: Coordinate; fraction: number }
type RoadData = {
  input: RoadNetworkInput
  network: RoadNetworkEvidence
  status: ReturnType<typeof evaluateNetworkRoad>
  marks: Map<number, Map<string, Mark>>
}
function project(point: Coordinate, a: Coordinate, b: Coordinate) {
  const sx = Math.cos((point[1] * Math.PI) / 180) * 111195.0802335329,
    sy = 111195.0802335329
  const ax = (a[0] - point[0]) * sx,
    ay = (a[1] - point[1]) * sy
  const dx = (b[0] - a[0]) * sx,
    dy = (b[1] - a[1]) * sy,
    length2 = dx * dx + dy * dy
  const fraction = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0
  const projected: Coordinate = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])]
  return { coordinate: projected, fraction, distanceM: distance(point, projected) }
}

/** Only declared junctions and explicitly reviewed endpoint snaps join independent source roads. */
export function buildRoadNetwork(
  inputs: readonly RoadNetworkInput[],
  rawPolicy: RoadNetworkPolicy,
  attachmentInputs: readonly RoadNetworkAttachmentInput[] = [],
): RoadNetworkGraph {
  const policy = parseRoadNetworkPolicy(rawPolicy)
  if (inputs.length > MAX_NETWORK_ROADS)
    throw Error(`Road network exceeds ${MAX_NETWORK_ROADS} roads; split the planning area.`)
  if (attachmentInputs.length > 1000) throw Error('Road network supports at most 1,000 named attachments.')
  const graph: RoadNetworkGraph = {
    nodes: new Map(),
    edges: new Map(),
    adjacency: new Map(),
    attachments: new Map(),
    excludedRoads: [],
    warnings: [],
    policy,
  }
  if (!policy.requireCurrentConditionEvidence)
    graph.warnings.push('The planning policy does not require current dated condition evidence for existing roads.')
  for (const [enabled, label] of [
    [policy.allowUnknownAccess, 'unknown road access'],
    [policy.allowPermissionRequired, 'permission-required road access'],
    [policy.allowUnknownRestrictions, 'unknown vehicle/season/load restrictions'],
    [policy.allowUnknownCondition, 'unknown entered road condition'],
    [policy.allowUnverifiedEndpointSnaps, 'endpoint connections with unknown grade-separation levels'],
  ] as const)
    if (enabled)
      graph.warnings.push(
        `The planning policy explicitly permits assumptions about ${label}; permission and physical suitability are not established by this switch.`,
      )
  if (policy.maxUphillGradePercent === null && policy.maxDownhillGradePercent === null)
    graph.warnings.push(
      'No existing-network vehicle grade limits are set; network grade feasibility is not established.',
    )
  let operations = 0,
    vertices = 0
  const budget = () => {
    if (++operations > MAX_NETWORK_OPERATIONS)
      throw Error('Road network topology budget exceeded; crop the network. No partial graph was returned.')
  }
  const addNode = (id: string, at: Coordinate) => {
    if (!graph.nodes.has(id)) {
      graph.nodes.set(id, { id, coordinate: at })
      graph.adjacency.set(id, [])
    }
    if (graph.nodes.size > MAX_NETWORK_NODES)
      throw Error('Road network node budget exceeded; no partial graph was returned.')
  }
  const addEdge = (edge: import('./roadNetworkTypes').RoadNetworkEdge) => {
    if (graph.edges.has(edge.id)) return
    graph.edges.set(edge.id, edge)
    if (edge.forwardAllowed) graph.adjacency.get(edge.from)!.push({ edgeId: edge.id, to: edge.to, forward: true })
    if (edge.reverseAllowed) graph.adjacency.get(edge.to)!.push({ edgeId: edge.id, to: edge.from, forward: false })
    if (graph.edges.size > MAX_NETWORK_EDGES)
      throw Error('Road network edge budget exceeded; no partial graph was returned.')
  }
  const roads: RoadData[] = [],
    ids = new Set<string>()
  for (const raw of [...inputs].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = string(raw.id, 'Network road ID', 200)
    if (ids.has(id)) throw Error(`Duplicate network road ID ${id}.`)
    ids.add(id)
    if (!Array.isArray(raw.coordinates) || raw.coordinates.length < 2)
      throw Error('Every network road requires at least two coordinates.')
    vertices += raw.coordinates.length
    if (vertices > MAX_NETWORK_VERTICES)
      throw Error(`Road network exceeds ${MAX_NETWORK_VERTICES} vertices; crop it before routing.`)
    const coordinates = raw.coordinates
      .map(coordinate)
      .filter((at, index, points) => !index || distance(points[index - 1], at) > 1e-6)
    if (coordinates.length < 2) throw Error(`Network road ${id} has no nonzero line segments.`)
    const input = { ...raw, id, name: string(raw.name, 'Network road name', 200), coordinates }
    const network = input.network ? parseRoadNetworkEvidence(input.network) : createRoadNetworkEvidence()
    const status = evaluateNetworkRoad({ ...input, network }, policy)
    if (!status.eligible) {
      graph.excludedRoads.push({ roadId: id, name: input.name, reasons: status.reasons })
      continue
    }
    const data: RoadData = { input, network, status, marks: new Map() }
    for (let i = 0; i < input.coordinates.length; i++) addNode(`v:${encodeURIComponent(id)}:${i}`, input.coordinates[i])
    roads.push(data)
  }
  const mark = (road: RoadData, segment: number, rawFraction: number): Mark => {
    const fraction = rawFraction < 1e-9 ? 0 : rawFraction > 1 - 1e-9 ? 1 : Number(rawFraction.toFixed(9))
    const marks = road.marks.get(segment) ?? new Map<string, Mark>()
    road.marks.set(segment, marks)
    const key = String(fraction),
      previous = marks.get(key)
    if (previous) return previous
    const a = road.input.coordinates[segment],
      b = road.input.coordinates[segment + 1]
    const at: Coordinate = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])]
    const nodeId =
      fraction === 0
        ? `v:${encodeURIComponent(road.input.id)}:${segment}`
        : fraction === 1
          ? `v:${encodeURIComponent(road.input.id)}:${segment + 1}`
          : `s:${encodeURIComponent(road.input.id)}:${segment}:${key}`
    const result = { nodeId, coordinate: at, fraction }
    marks.set(key, result)
    addNode(nodeId, at)
    return result
  }
  const nearest = (point: Coordinate, candidates: readonly RoadData[]) => {
    type Candidate = { road: RoadData; segment: number; fraction: number; coordinate: Coordinate; distanceM: number }
    let found: Candidate | undefined
    let equallyNear: Candidate[] = []
    for (const road of candidates) {
      let nearestOnRoad: Candidate | undefined
      for (let segment = 0; segment < road.input.coordinates.length - 1; segment++) {
        budget()
        const candidate = project(point, road.input.coordinates[segment], road.input.coordinates[segment + 1])
        if (!nearestOnRoad || candidate.distanceM < nearestOnRoad.distanceM - 1e-7)
          nearestOnRoad = { road, segment, ...candidate }
      }
      if (!nearestOnRoad) continue
      if (!found || nearestOnRoad.distanceM < found.distanceM - 1e-7) {
        found = nearestOnRoad
        equallyNear = [nearestOnRoad]
      } else if (Math.abs(nearestOnRoad.distanceM - found.distanceM) <= 1e-7) equallyNear.push(nearestOnRoad)
    }
    return found ? { ...found, equallyNear } : undefined
  }
  const link = (a: Mark, b: Mark, id: string, kind: 'junction' | 'attachment', warnings: string[]) => {
    if (a.nodeId === b.nodeId) return
    const lengthM = distance(a.coordinate, b.coordinate)
    addEdge({
      id,
      from: a.nodeId,
      to: b.nodeId,
      roadId: null,
      kind,
      reused: false,
      coordinates: [a.coordinate, b.coordinate],
      lengthM,
      weightedLengthM: lengthM,
      forwardAllowed: true,
      reverseAllowed: true,
      costItems: [],
      warnings,
    })
  }
  const endpoints = roads.flatMap((road) => [
    { road, at: mark(road, 0, 0) },
    { road, at: mark(road, road.input.coordinates.length - 2, 1) },
  ])
  let unknownEndpoints = 0
  for (let i = 0; i < endpoints.length; i++)
    for (let j = i + 1; j < endpoints.length; j++) {
      budget()
      const a = endpoints[i],
        b = endpoints[j],
        gap = distance(a.at.coordinate, b.at.coordinate)
      if (gap > policy.snapToleranceM + 1e-7) continue
      if (a.road === b.road) {
        if (gap < 1e-6) link(a.at, b.at, `loop:${encodeURIComponent(a.road.input.id)}`, 'junction', [])
        continue
      }
      const la = a.road.network.level,
        lb = b.road.network.level
      if (la !== null && lb !== null && la !== lb) continue
      if ((la === null || lb === null) && !policy.allowUnverifiedEndpointSnaps) {
        unknownEndpoints++
        continue
      }
      const warnings =
        la === null || lb === null
          ? ['An endpoint junction with unknown grade-separation levels was explicitly assumed connected.']
          : []
      if (gap > 0.001)
        warnings.push(
          `Endpoint snap spans ${gap.toFixed(2)} m of assumed junction connection; this is not measured road geometry.`,
        )
      link(a.at, b.at, `snap:${i}:${j}`, 'junction', warnings)
    }
  if (unknownEndpoints)
    graph.warnings.push(
      `${unknownEndpoints} nearby endpoint pair(s) remained disconnected because their grade-separation level is unknown.`,
    )
  const junctions = new Map<string, { road: RoadData; at: Mark }[]>()
  for (const road of roads)
    for (const junction of road.network.junctions) {
      const point = nearest(junction.coordinate, [road])
      if (!point || point.distanceM > policy.snapToleranceM + 1e-7)
        throw Error(`Declared junction ${junction.id} does not lie on ${road.input.name} within the snap tolerance.`)
      const list = junctions.get(junction.id) ?? []
      list.push({ road, at: mark(road, point.segment, point.fraction) })
      junctions.set(junction.id, list)
    }
  for (const [id, members] of junctions) {
    if (members.length < 2) {
      graph.warnings.push(`Junction ${id} is declared on only one eligible road; it connects no other road.`)
      continue
    }
    const first = members[0]
    for (let i = 1; i < members.length; i++) {
      budget()
      const other = members[i]
      if (
        first.road.network.level !== null &&
        other.road.network.level !== null &&
        first.road.network.level !== other.road.network.level
      )
        throw Error(`Declared junction ${id} conflicts with the roads' different grade-separation levels.`)
      if (distance(first.at.coordinate, other.at.coordinate) > policy.snapToleranceM + 1e-7)
        throw Error(`Declared junction ${id} has inconsistent locations beyond the snap tolerance.`)
      link(first.at, other.at, `junction:${encodeURIComponent(id)}:${i}`, 'junction', [])
    }
  }
  for (const raw of [...attachmentInputs].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = string(raw.id, 'Network attachment ID', 200),
      at = coordinate(raw.coordinate)
    if (graph.attachments.has(id)) throw Error(`Duplicate network attachment ID ${id}.`)
    const tolerance = nullableNumber(raw.maxDistanceM ?? policy.attachmentToleranceM, 'Attachment tolerance', 0, 50)!
    const found = nearest(at, raw.roadId ? roads.filter((road) => road.input.id === raw.roadId) : roads)
    if (!found || found.distanceM > tolerance + 1e-7) {
      graph.attachments.set(id, {
        id,
        nodeId: null,
        coordinate: at,
        distanceM: found?.distanceM ?? null,
        reason: found
          ? `No eligible road lies within the ${tolerance} m attachment tolerance.`
          : 'No eligible road is available for this attachment.',
      })
      continue
    }
    const projected = mark(found.road, found.segment, found.fraction)
    const junctionConnected = (target: string) => {
      const pending = [projected.nodeId],
        seen = new Set<string>()
      while (pending.length) {
        const node = pending.pop()!
        if (node === target) return true
        if (seen.has(node)) continue
        seen.add(node)
        for (const traversal of graph.adjacency.get(node) ?? []) {
          budget()
          if (graph.edges.get(traversal.edgeId)!.kind === 'junction') pending.push(traversal.to)
        }
      }
      return false
    }
    if (
      !raw.roadId &&
      found.equallyNear.some(
        (candidate) => !junctionConnected(mark(candidate.road, candidate.segment, candidate.fraction).nodeId),
      )
    ) {
      graph.attachments.set(id, {
        id,
        nodeId: null,
        coordinate: at,
        distanceM: found.distanceM,
        reason:
          'The attachment is equally near different unjoined road sections. Identify the physical road section explicitly; crossing linework does not establish a junction.',
      })
      continue
    }
    let nodeId = projected.nodeId
    if (found.distanceM > 0.001) {
      nodeId = `attachment:${encodeURIComponent(id)}`
      addNode(nodeId, at)
      link(
        { nodeId, coordinate: at, fraction: 0 },
        projected,
        `attachment-edge:${encodeURIComponent(id)}`,
        'attachment',
        [
          `Attachment ${id} includes ${found.distanceM.toFixed(2)} m within the entered attachment tolerance; verify this entrance/junction.`,
        ],
      )
    }
    graph.attachments.set(id, {
      id,
      nodeId,
      coordinate: at,
      projectedCoordinate: projected.coordinate,
      roadId: found.road.input.id,
      distanceM: found.distanceM,
    })
  }
  for (const road of roads) {
    const n = road.network,
      roadId = road.input.id
    for (let segment = 0; segment < road.input.coordinates.length - 1; segment++) {
      mark(road, segment, 0)
      mark(road, segment, 1)
      const pieces = [...road.marks.get(segment)!.values()].sort((a, b) => a.fraction - b.fraction)
      for (let i = 1; i < pieces.length; i++) {
        budget()
        const a = pieces[i - 1],
          b = pieces[i],
          lengthM = distance(a.coordinate, b.coordinate)
        if (lengthM < 1e-6) continue
        const id = `road:${encodeURIComponent(roadId)}:${segment}:${a.fraction}-${b.fraction}`
        const costItems: RoadNetworkCostItem[] = [
          {
            id: `rehab:${id}`,
            kind: 'rehabilitation',
            roadId,
            amount: n.rehabilitationCostPerM === null ? null : lengthM * n.rehabilitationCostPerM,
            label: `${road.input.name} · ${lengthM.toFixed(1)} m rehabilitation`,
          },
          {
            id: `access:${encodeURIComponent(roadId)}`,
            kind: 'access',
            roadId,
            amount: n.accessCost,
            label: `${road.input.name} · access allowance`,
          },
          {
            id: `structure:${encodeURIComponent(roadId)}`,
            kind: 'structure',
            roadId,
            amount: n.structureCost,
            label: `${road.input.name} · structure allowance`,
          },
          {
            id: `fixed:${encodeURIComponent(roadId)}`,
            kind: 'fixed',
            roadId,
            amount: n.fixedCost,
            label: `${road.input.name} · fixed road setup`,
          },
        ]
        addEdge({
          id,
          from: a.nodeId,
          to: b.nodeId,
          roadId,
          kind: 'road',
          reused: !road.input.proposed,
          coordinates: [a.coordinate, b.coordinate],
          lengthM,
          weightedLengthM: lengthM * n.haulCostFactor,
          forwardAllowed: road.status.forwardAllowed,
          reverseAllowed: road.status.reverseAllowed,
          costItems,
          warnings: road.status.warnings,
        })
      }
    }
  }
  graph.warnings = [...new Set(graph.warnings)]
  for (const list of graph.adjacency.values())
    list.sort((a, b) => a.edgeId.localeCompare(b.edgeId) || a.to.localeCompare(b.to))
  return graph
}

class NetworkHeap {
  private entries: { key: string; score: number; length: number }[] = []
  private before(a: { key: string; score: number; length: number }, b: { key: string; score: number; length: number }) {
    return (
      a.score < b.score || (a.score === b.score && (a.length < b.length || (a.length === b.length && a.key <= b.key)))
    )
  }
  get length() {
    return this.entries.length
  }
  push(entry: { key: string; score: number; length: number }) {
    let index = this.entries.length
    this.entries.push(entry)
    while (index) {
      const parent = (index - 1) >> 1,
        previous = this.entries[parent]
      if (this.before(previous, entry)) break
      this.entries[index] = previous
      index = parent
    }
    this.entries[index] = entry
  }
  pop() {
    const result = this.entries[0],
      last = this.entries.pop()
    if (this.entries.length && last) {
      let index = 0
      while (index * 2 + 1 < this.entries.length) {
        let child = index * 2 + 1
        const other = child + 1
        if (other < this.entries.length && this.before(this.entries[other], this.entries[child])) child = other
        const next = this.entries[child]
        if (this.before(last, next)) break
        this.entries[index] = next
        index = child
      }
      this.entries[index] = last
    }
    return result
  }
}

/** Weighted Dijkstra; once-only feature allowances are state, not duplicated at every split vertex. */
export function shortestRoadNetworkPath(
  graph: RoadNetworkGraph,
  from: string,
  to: string,
  options: RoadNetworkPathOptions,
): RoadNetworkPath | null {
  if (!Number.isFinite(options.distanceRatePerM) || options.distanceRatePerM < 0 || options.distanceRatePerM > 1e9)
    throw Error('Network haul rate must be a finite non-negative cost per metre.')
  const objective = options.objective ?? 'total-cost',
    includeRehabilitation = options.includeRehabilitation !== false
  if (!['distance', 'total-cost'].includes(objective)) throw Error('Choose a network distance or total-cost objective.')
  if (objective === 'total-cost' && options.allowUnpricedCosts)
    throw Error('Unpriced roads can be screened by distance only; they cannot be ranked by a known total cost.')
  if ((options.paidCostItemIds?.length ?? 0) > MAX_NETWORK_EDGES * 4)
    throw Error('Too many previously paid network cost items.')
  const initialPaid = new Set(options.paidCostItemIds ?? [])
  const resolve = (id: string) =>
    graph.attachments.has(id) ? graph.attachments.get(id)!.nodeId : graph.nodes.has(id) ? id : null
  const start = resolve(from),
    target = resolve(to)
  if (!start || !target) return null
  type State = {
    node: string
    paid: Set<string>
    score: number
    length: number
    previous?: string
    edgeId?: string
    forward?: boolean
  }
  const key = (node: string, paid: Set<string>) =>
    `${node}\u0000${
      objective === 'distance'
        ? ''
        : [...paid]
            .filter((id) => !initialPaid.has(id))
            .sort()
            .join('\u001f')
    }`
  const startKey = key(start, new Set()),
    states = new Map<string, State>([[startKey, { node: start, paid: new Set(), score: 0, length: 0 }]])
  const closed = new Set<string>(),
    heap = new NetworkHeap()
  heap.push({ key: startKey, score: 0, length: 0 })
  let transitions = 0,
    paidGroupEntries = 0,
    finalKey: string | undefined
  while (heap.length) {
    const current = heap.pop(),
      state = states.get(current.key)!
    if (closed.has(current.key) || current.score !== state.score || current.length !== state.length) continue
    closed.add(current.key)
    if (closed.size > MAX_NETWORK_PATH_STATES)
      throw Error(
        'Connected-road path state budget exceeded; crop the network or simplify fixed allowances. No partial path was returned.',
      )
    if (state.node === target) {
      finalKey = current.key
      break
    }
    for (const traversal of graph.adjacency.get(state.node) ?? []) {
      if (++transitions > MAX_NETWORK_PATH_TRANSITIONS)
        throw Error('Connected-road path transition budget exceeded; no partial path was returned.')
      const edge = graph.edges.get(traversal.edgeId)!
      const items = edge.costItems.filter(
        (item) =>
          (includeRehabilitation || item.kind !== 'rehabilitation') &&
          !state.paid.has(item.id) &&
          !initialPaid.has(item.id),
      )
      if (!options.allowUnpricedCosts && items.some((item) => item.amount === null)) continue
      const paid = new Set(state.paid)
      if (objective === 'total-cost')
        for (const item of items) if (item.kind !== 'rehabilitation' && item.amount) paid.add(item.id)
      paidGroupEntries += paid.size
      if (paidGroupEntries > MAX_NETWORK_PAID_GROUP_ENTRIES)
        throw Error(
          'Connected-road paid-allowance state budget exceeded; simplify the network allowances. No partial path was returned.',
        )
      const edgeScore =
        objective === 'distance'
          ? edge.weightedLengthM
          : edge.weightedLengthM * options.distanceRatePerM + items.reduce((sum, item) => sum + (item.amount ?? 0), 0)
      const nextScore = state.score + edgeScore,
        nextLength = state.length + edge.weightedLengthM,
        nextKey = key(traversal.to, paid)
      const previous = states.get(nextKey)
      if (previous && (previous.score < nextScore || (previous.score === nextScore && previous.length <= nextLength)))
        continue
      states.set(nextKey, {
        node: traversal.to,
        paid,
        score: nextScore,
        length: nextLength,
        previous: current.key,
        edgeId: edge.id,
        forward: traversal.forward,
      })
      if (states.size > MAX_NETWORK_PATH_STATES * 4)
        throw Error('Connected-road path queued-state budget exceeded; no partial path was returned.')
      heap.push({ key: nextKey, score: nextScore, length: nextLength })
    }
  }
  if (!finalKey) return null
  const traversals: { edgeId: string; forward: boolean }[] = []
  for (let at = finalKey; at !== startKey; ) {
    const state = states.get(at)!
    if (!state.previous || state.edgeId === undefined || state.forward === undefined)
      throw Error('Network path reconstruction failed.')
    traversals.push({ edgeId: state.edgeId, forward: state.forward })
    at = state.previous
  }
  traversals.reverse()
  const coordinates: Coordinate[] = [],
    costItems = new Map<string, RoadNetworkCostItem>(),
    warnings = new Set(graph.warnings)
  let lengthM = 0,
    weightedLengthM = 0,
    reusedLengthM = 0,
    junctionGapM = 0,
    attachmentDistanceM = 0
  const roadIds = new Set<string>()
  for (const traversal of traversals) {
    const edge = graph.edges.get(traversal.edgeId)!
    lengthM += edge.lengthM
    weightedLengthM += edge.weightedLengthM
    if (edge.reused) reusedLengthM += edge.lengthM
    if (edge.kind === 'junction') junctionGapM += edge.lengthM
    if (edge.kind === 'attachment') attachmentDistanceM += edge.lengthM
    if (edge.roadId) roadIds.add(edge.roadId)
    for (const item of edge.costItems)
      if ((includeRehabilitation || item.kind !== 'rehabilitation') && !initialPaid.has(item.id))
        costItems.set(item.id, item)
    for (const warning of edge.warnings) warnings.add(warning)
    const points = traversal.forward ? edge.coordinates : [...edge.coordinates].reverse()
    for (const point of points)
      if (!coordinates.length || distance(coordinates.at(-1)!, point) > 1e-6) coordinates.push(point)
  }
  if (!coordinates.length) coordinates.push(graph.nodes.get(start)!.coordinate)
  const items = [...costItems.values()].sort((a, b) => a.id.localeCompare(b.id))
  const subtotal = (kind: RoadNetworkCostItem['kind']) => {
    const applicable = items.filter((item) => item.kind === kind)
    return applicable.some((item) => item.amount === null)
      ? null
      : applicable.reduce((sum, item) => sum + item.amount!, 0)
  }
  const rehabilitationCost = subtotal('rehabilitation'),
    accessCost = subtotal('access'),
    structureCost = subtotal('structure'),
    fixedCost = subtotal('fixed')
  const haulCost = weightedLengthM * options.distanceRatePerM
  const totalCost = [rehabilitationCost, accessCost, structureCost, fixedCost].some((cost) => cost === null)
    ? null
    : haulCost + rehabilitationCost! + accessCost! + structureCost! + fixedCost!
  if (totalCost === null)
    warnings.add(
      'This connected distance path has unpriced road costs; no complete total or cost ranking is established.',
    )
  if (!includeRehabilitation) warnings.add('Rehabilitation costs were explicitly excluded from this path request.')
  return {
    coordinates,
    edgeIds: traversals.map((t) => t.edgeId),
    roadIds: [...roadIds],
    lengthM,
    distanceM: lengthM,
    weightedLengthM,
    reusedLengthM,
    junctionGapM,
    attachmentDistanceM,
    haulCost,
    rehabilitationCost,
    accessCost,
    structureCost,
    fixedCost,
    totalCost,
    cost: totalCost,
    costItems: items,
    costItemIds: items.map((item) => item.id),
    costGroupIds: items.map((item) => item.id),
    warnings: [...warnings],
  }
}

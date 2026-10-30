/** Dated condition evidence for planning. No deterioration curve, road-age inference or load rating. */
export type RoadCondition = 'unknown' | 'serviceable' | 'rehabilitation' | 'closed'
export type RoadConditionSource = 'inspection' | 'imagery'
export type RoadConditionComponent = 'overall' | 'surface' | 'drainage' | 'bridge' | 'culvert'

export interface RoadConditionObservation {
  id: string
  source: RoadConditionSource
  component: RoadConditionComponent
  /** Optional structure/station scope; never treated as evidence for other structures on the road. */
  assetReference?: string
  /** Date the condition was observed / image acquired, not the date this link was retrieved. */
  observedAt: string
  sourceUrl: string
  notes: string
  finding: RoadCondition
  /** A recorded reviewer is a user assertion, not authenticated professional credentials. */
  review?: { reviewer: string; reviewedAt: string }
  /** Explicitly replaced observations, on this road and the same component only. */
  supersedes?: string[]
}

export interface RoadConditionPolicy {
  /** Null means the source has no configured applicability window and cannot establish a current estimate. */
  maxInspectionAgeDays: number | null
  maxImageryAgeDays: number | null
}

export type RoadObservationStatus =
  | 'current'
  | 'unreviewed'
  | 'future'
  | 'policy-unset'
  | 'stale'
  | 'superseded'
  | 'insufficient-source'

export interface AssessedRoadObservation {
  observation: RoadConditionObservation
  status: RoadObservationStatus
  ageDays: number
  expiresAt: string | null
  reason: string
}

export interface RoadComponentAssessment {
  component: RoadConditionComponent
  assetReference?: string
  condition: RoadCondition
  observationIds: string[]
  hasConflicts: boolean
  hasUnknownFinding: boolean
}

export interface RoadConditionAssessment {
  asOf: string
  condition: RoadCondition
  basis: 'unknown' | 'inspection' | 'imagery' | 'mixed' | 'conflicting'
  hasCurrentEvidence: boolean
  hasConflicts: boolean
  hasOpenClosureEvidence: boolean
  /** Historical reviewed closures stay unresolved until explicitly cleared; expiry does not reopen a road. */
  unresolvedClosureObservationIds: string[]
  usedObservationIds: string[]
  evidenceAgeDays: { youngest: number; oldest: number } | null
  expiresAt: string | null
  components: RoadComponentAssessment[]
  records: AssessedRoadObservation[]
  /** Condition classifications do not establish engineering load ratings, even for a recent inspection. */
  truckCapacityEstablished: false
  explanation: string
}

export const MAX_ROAD_CONDITION_OBSERVATIONS = 100
export const MAX_CONDITION_EVIDENCE_AGE_DAYS = 36_500
const DAY_MS = 86_400_000
export const ROAD_CONDITION_LABELS: Record<RoadCondition, string> = {
  unknown: 'Unknown',
  serviceable: 'Serviceable for planning',
  rehabilitation: 'Needs rehabilitation',
  closed: 'Closed / unavailable',
}
export const ROAD_COMPONENT_LABELS: Record<RoadConditionComponent, string> = {
  overall: 'Overall road',
  surface: 'Road surface',
  drainage: 'Road drainage',
  bridge: 'Bridge',
  culvert: 'Culvert',
}

export function createRoadConditionPolicy(): RoadConditionPolicy {
  return { maxInspectionAgeDays: null, maxImageryAgeDays: null }
}

function text(raw: unknown, label: string, max: number): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max)
    throw Error(`${label} must contain 1–${max} characters.`)
  return raw.trim()
}

/** Calendar dates are intentionally timezone-free; reject Date.parse's rollover of impossible days. */
export function roadConditionDate(raw: unknown, label = 'Evidence date'): string {
  const date = text(raw, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error(`${label} must be a calendar date (YYYY-MM-DD).`)
  const value = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date)
    throw Error(`${label} is not a real calendar date.`)
  return date
}

function dateValue(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`)
}

function identifier(raw: unknown, label: string) {
  const value = text(raw, label, 100)
  if (!/^[a-zA-Z0-9_.:-]+$/.test(value)) throw Error(`${label} contains unsupported characters.`)
  return value
}

function object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}

export function parseRoadConditionPolicy(raw: unknown): RoadConditionPolicy {
  const value = object(raw, 'Condition evidence policy')
  const days = (key: keyof RoadConditionPolicy) => {
    const result = value[key]
    if (result === null) return null
    if (!Number.isInteger(result) || Number(result) < 0 || Number(result) > MAX_CONDITION_EVIDENCE_AGE_DAYS)
      throw Error(
        `Condition evidence age must be unset or an integer from 0 to ${MAX_CONDITION_EVIDENCE_AGE_DAYS} days.`,
      )
    return Number(result)
  }
  return { maxInspectionAgeDays: days('maxInspectionAgeDays'), maxImageryAgeDays: days('maxImageryAgeDays') }
}

export function parseRoadConditionObservations(raw: unknown): RoadConditionObservation[] {
  if (!Array.isArray(raw) || raw.length > MAX_ROAD_CONDITION_OBSERVATIONS)
    throw Error(`A road may contain at most ${MAX_ROAD_CONDITION_OBSERVATIONS} dated condition observations.`)
  const observations = raw.map((item): RoadConditionObservation => {
    const value = object(item, 'Condition observation')
    if (value.source !== 'inspection' && value.source !== 'imagery') throw Error('Invalid condition evidence source.')
    if (
      typeof value.component !== 'string' ||
      !Object.prototype.hasOwnProperty.call(ROAD_COMPONENT_LABELS, value.component)
    )
      throw Error('Invalid condition component.')
    if (
      typeof value.finding !== 'string' ||
      !Object.prototype.hasOwnProperty.call(ROAD_CONDITION_LABELS, value.finding)
    )
      throw Error('Invalid observed road condition.')
    const sourceUrl = text(value.sourceUrl, 'Evidence source URL', 2000)
    let url: URL
    try {
      url = new URL(sourceUrl)
    } catch {
      throw Error('Evidence source URL must be a full HTTP or HTTPS link.')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw Error('Evidence source URL must be HTTP or HTTPS and must not contain credentials.')
    const observation: RoadConditionObservation = {
      id: identifier(value.id, 'Observation ID'),
      source: value.source,
      component: value.component as RoadConditionComponent,
      observedAt: roadConditionDate(value.observedAt, 'Observation date'),
      sourceUrl,
      notes: text(value.notes, 'Observation notes', 2000),
      finding: value.finding as RoadCondition,
    }
    if (value.assetReference !== undefined)
      observation.assetReference = text(value.assetReference, 'Observed asset / station', 200)
    if (value.review !== undefined) {
      const review = object(value.review, 'Observation review')
      observation.review = {
        reviewer: text(review.reviewer, 'Recorded reviewer', 200),
        reviewedAt: roadConditionDate(review.reviewedAt, 'Review date'),
      }
      if (observation.review.reviewedAt < observation.observedAt)
        throw Error('The review date cannot precede the observation date.')
    }
    if (value.supersedes !== undefined) {
      if (!Array.isArray(value.supersedes) || value.supersedes.length > MAX_ROAD_CONDITION_OBSERVATIONS)
        throw Error('Invalid superseded observation list.')
      observation.supersedes = value.supersedes.map((id) => identifier(id, 'Superseded observation ID'))
      if (new Set(observation.supersedes).size !== observation.supersedes.length)
        throw Error('Superseded observation IDs must be unique.')
    }
    return observation
  })
  const byId = new Map(observations.map((item) => [item.id, item]))
  if (byId.size !== observations.length) throw Error('Condition observation IDs must be unique on the road.')
  for (const observation of observations)
    for (const id of observation.supersedes ?? []) {
      const target = byId.get(id)
      if (
        !target ||
        target.id === observation.id ||
        target.component !== observation.component ||
        target.assetReference !== observation.assetReference
      )
        throw Error('A superseded observation must exist on this road and describe the same component and asset.')
      if (target.observedAt > observation.observedAt)
        throw Error('An observation cannot supersede evidence observed at a later date.')
    }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw Error('Condition observations cannot form a supersession cycle.')
    if (visited.has(id)) return
    visiting.add(id)
    for (const previous of byId.get(id)!.supersedes ?? []) visit(previous)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
  return observations
}

/**
 * All unsuperseded, reviewed evidence within its explicit source-age window participates.
 * A later date alone does not resolve disagreement. Imagery cannot positively clear a structure.
 * Closure evidence stays blocking until explicitly replaced by applicable reviewed evidence.
 */
export function assessRoadCondition(
  input: readonly RoadConditionObservation[],
  { asOf: rawDate, policy: rawPolicy }: { asOf: string; policy: RoadConditionPolicy },
): RoadConditionAssessment {
  const asOf = roadConditionDate(rawDate, 'Condition assessment date')
  const policy = parseRoadConditionPolicy(rawPolicy)
  const observations = parseRoadConditionObservations(input)
  const records: AssessedRoadObservation[] = observations.map((observation) => {
    const ageDays = Math.round((dateValue(asOf) - dateValue(observation.observedAt)) / DAY_MS)
    const limit = observation.source === 'inspection' ? policy.maxInspectionAgeDays : policy.maxImageryAgeDays
    const expiresAt =
      limit === null ? null : new Date(dateValue(observation.observedAt) + limit * DAY_MS).toISOString().slice(0, 10)
    let status: RoadObservationStatus = 'current'
    let reason = 'Reviewed evidence within the configured age window.'
    if (ageDays < 0 || (observation.review && observation.review.reviewedAt > asOf)) {
      status = 'future'
      reason = 'Observation or review occurs after the assessment date.'
    } else if (!observation.review) {
      status = 'unreviewed'
      reason = 'A reviewer and review date have not been recorded.'
    } else if (limit === null) {
      status = 'policy-unset'
      reason = 'No maximum evidence age is configured for this source.'
    } else if (ageDays > limit) {
      status = 'stale'
      reason = `Evidence is ${ageDays} days old, beyond the configured ${limit}-day window.`
    } else if (
      observation.source === 'imagery' &&
      ['bridge', 'culvert'].includes(observation.component) &&
      observation.finding === 'serviceable'
    ) {
      status = 'insufficient-source'
      reason = 'Imagery cannot establish a bridge or culvert as serviceable.'
    }
    return { observation, status, ageDays, expiresAt, reason }
  })
  const eligible = records.filter((record) => record.status === 'current')
  const byId = new Map(observations.map((observation) => [observation.id, observation]))
  const replaced = new Set<string>()
  const replace = (id: string, replacement: RoadConditionObservation) => {
    if (replaced.has(id)) return
    const previous = byId.get(id)!
    if (
      previous.finding === 'closed' &&
      (replacement.finding === 'unknown' ||
        (replacement.source === 'imagery' &&
          ['bridge', 'culvert'].includes(previous.component) &&
          replacement.finding !== 'closed'))
    )
      return
    replaced.add(id)
    for (const ancestor of previous.supersedes ?? []) replace(ancestor, replacement)
  }
  for (const record of eligible)
    for (const previous of record.observation.supersedes ?? []) replace(previous, record.observation)
  // A whole chain remains replaced, even when an intermediate observation is itself superseded.
  for (const record of records)
    if (replaced.has(record.observation.id)) {
      record.status = 'superseded'
      record.reason = 'Explicitly replaced by applicable reviewed evidence.'
    }
  const current = records.filter((record) => record.status === 'current')
  const scopes = new Map<string, { component: RoadConditionComponent; assetReference?: string }>()
  for (const component of Object.keys(ROAD_COMPONENT_LABELS) as RoadConditionComponent[])
    scopes.set(`${component}:`, { component })
  for (const { observation } of current)
    scopes.set(`${observation.component}:${observation.assetReference ?? ''}`, {
      component: observation.component,
      ...(observation.assetReference ? { assetReference: observation.assetReference } : {}),
    })
  const components = [...scopes.values()].map(({ component, assetReference }): RoadComponentAssessment => {
    const group = current.filter(
      (record) => record.observation.component === component && record.observation.assetReference === assetReference,
    )
    const findings = new Set(group.map((record) => record.observation.finding))
    const known = [...findings].filter((finding) => finding !== 'unknown')
    const hasConflicts = known.length > 1
    const hasUnknownFinding = findings.has('unknown')
    const condition = findings.has('closed')
      ? 'closed'
      : hasConflicts || hasUnknownFinding
        ? 'unknown'
        : (known[0] ?? 'unknown')
    return {
      component,
      ...(assetReference ? { assetReference } : {}),
      condition,
      observationIds: group.map((record) => record.observation.id),
      hasConflicts,
      hasUnknownFinding,
    }
  })
  const hasConflicts = components.some((component) => component.hasConflicts)
  const hasCurrentClosureEvidence = current.some((record) => record.observation.finding === 'closed')
  const unresolvedClosureObservationIds = records
    .filter(
      ({ observation }) =>
        observation.finding === 'closed' &&
        observation.review &&
        observation.observedAt <= asOf &&
        observation.review.reviewedAt <= asOf &&
        !replaced.has(observation.id),
    )
    .map(({ observation }) => observation.id)
  const hasOpenClosureEvidence = unresolvedClosureObservationIds.length > 0
  for (const record of records)
    if (unresolvedClosureObservationIds.includes(record.observation.id) && record.status !== 'current')
      record.reason += ' This earlier closure has not been explicitly resolved.'
  const overall = components.find((component) => component.component === 'overall' && !component.assetReference)!
  const condition: RoadCondition = hasCurrentClosureEvidence
    ? 'closed'
    : hasOpenClosureEvidence
      ? 'unknown'
      : components.some((component) => component.condition === 'rehabilitation')
        ? 'rehabilitation'
        : hasConflicts || components.some((component) => component.hasUnknownFinding)
          ? 'unknown'
          : overall.condition
  const sources = new Set(current.map((record) => record.observation.source))
  const basis = hasConflicts
    ? 'conflicting'
    : condition === 'unknown'
      ? 'unknown'
      : sources.size > 1
        ? 'mixed'
        : ([...sources][0] ?? 'unknown')
  const expiries = current.flatMap((record) => (record.expiresAt ? [record.expiresAt] : [])).sort()
  const ages = current.map((record) => record.ageDays)
  const explanation = hasCurrentClosureEvidence
    ? 'Applicable evidence reports a closure or unavailable component. Resolve it before planning reuse.'
    : hasOpenClosureEvidence
      ? 'An earlier reviewed closure remains unresolved. Evidence expiry or a newer positive observation alone cannot reopen the road.'
      : hasConflicts
        ? 'Applicable observations disagree. Review the conflict and explicitly supersede any replaced evidence.'
        : condition === 'rehabilitation'
          ? 'Applicable evidence identifies rehabilitation needs; scope and cost remain separate planning inputs.'
          : condition === 'serviceable'
            ? 'Applicable overall-road evidence supports a planning condition estimate; access and loaded-truck capacity remain unestablished.'
            : current.length
              ? 'Evidence does not establish an overall road condition; component findings remain visible.'
              : 'No applicable reviewed condition evidence remains for this assessment date and source-age policy.'
  return {
    asOf,
    condition,
    basis,
    hasCurrentEvidence: current.length > 0,
    hasConflicts,
    hasOpenClosureEvidence,
    unresolvedClosureObservationIds,
    usedObservationIds: current.map((record) => record.observation.id),
    evidenceAgeDays: ages.length ? { youngest: Math.min(...ages), oldest: Math.max(...ages) } : null,
    expiresAt: expiries[0] ?? null,
    components,
    records,
    truckCapacityEstablished: false,
    explanation,
  }
}

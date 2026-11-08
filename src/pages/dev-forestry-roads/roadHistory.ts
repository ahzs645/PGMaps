import type { ExistingRoadEvidence } from './types'

/** Physical road events, supplied separately from the administrative life of a road tenure. */
export interface RoadDeactivationEvidence {
  status: 'unknown' | 'deactivated' | 'reactivated'
  basis: 'source-record' | 'field-observation' | 'scenario'
  /** A report, record identifier or field note; a date without a source is not evidence. */
  reference: string
  /** Event dates only. Observing an old deactivation does not establish when it occurred. */
  deactivatedOn?: string
  reactivatedOn?: string
  observedOn?: string
  sourceUrl?: string
  notes?: string
}

export const MAX_ROAD_HISTORY_TEXT = 2000
export const BC_ROAD_NOTICES_URL =
  'https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/local-road-safety-information'
export const PRINCE_GEORGE_ROAD_NOTICES_URL = `${BC_ROAD_NOTICES_URL}/prince-george-natural-resource-district-road-safety-information`
export const PRINCE_GEORGE_ROAD_MAP_URL =
  'https://governmentofbc.maps.arcgis.com/apps/webappviewer/index.html?id=da77454784c84d1098bd57385ecc1829'

function optionalText(raw: unknown, label: string): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_ROAD_HISTORY_TEXT)
    throw Error(`${label} must contain 1–${MAX_ROAD_HISTORY_TEXT} characters, or be omitted.`)
  return raw.trim()
}

/** Strict calendar dates reject JavaScript's silent rollover of dates such as 2025-02-30. */
function eventDate(raw: unknown, label: string): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !/^(18|19|20|21|22)\d{2}-\d{2}-\d{2}$/.test(raw))
    throw Error(`${label} must be a calendar date (YYYY-MM-DD), or be omitted when unknown.`)
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
    throw Error(`${label} must be a real calendar date.`)
  return raw
}

export function parseRoadDeactivation(raw: unknown): RoadDeactivationEvidence {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Road deactivation evidence must be an object.')
  const r = raw as Record<string, unknown>
  if (typeof r.status !== 'string' || !['unknown', 'deactivated', 'reactivated'].includes(r.status))
    throw Error('Choose unknown, deactivated or reactivated road status.')
  if (typeof r.basis !== 'string' || !['source-record', 'field-observation', 'scenario'].includes(r.basis))
    throw Error('Choose the source of the road deactivation evidence.')
  if (typeof r.reference !== 'string' || r.reference.length > MAX_ROAD_HISTORY_TEXT)
    throw Error(`Road deactivation source reference must be at most ${MAX_ROAD_HISTORY_TEXT} characters.`)
  const result: RoadDeactivationEvidence = {
    status: r.status as RoadDeactivationEvidence['status'],
    basis: r.basis as RoadDeactivationEvidence['basis'],
    reference: r.reference.trim(),
  }
  if (result.status !== 'unknown' && !result.reference)
    throw Error('Enter a source record or field-note reference for the road event.')
  for (const key of ['deactivatedOn', 'reactivatedOn', 'observedOn'] as const) {
    const parsed = eventDate(r[key], `Road ${key}`)
    if (parsed !== undefined) result[key] = parsed
  }
  if (result.status === 'unknown' && (result.deactivatedOn || result.reactivatedOn))
    throw Error('Choose a recorded event status before entering a deactivation or reactivation date.')
  if (result.status === 'deactivated' && result.reactivatedOn)
    throw Error('Choose reactivated status when recording a reactivation date.')
  if (result.deactivatedOn && result.reactivatedOn && result.reactivatedOn < result.deactivatedOn)
    throw Error('The reactivation date cannot precede the deactivation date.')
  const latestEvent = result.reactivatedOn ?? result.deactivatedOn
  if (result.observedOn && latestEvent && result.observedOn < latestEvent)
    throw Error('The observation date cannot precede the recorded road event.')
  for (const key of ['sourceUrl', 'notes'] as const) {
    const parsed = optionalText(r[key], `Road deactivation ${key}`)
    if (parsed !== undefined) result[key] = parsed
  }
  if (result.sourceUrl && !/^https?:\/\//i.test(result.sourceUrl))
    throw Error('Road deactivation source URL must use HTTP or HTTPS.')
  return result
}

/** A known deactivation can enter a cost scenario only as explicitly reviewed rehabilitation. */
export function deactivatedRoadNeedsReview(evidence?: ExistingRoadEvidence): boolean {
  return (
    evidence?.deactivation?.status === 'deactivated' &&
    !(
      evidence.reuseAllowed &&
      evidence.condition === 'rehabilitation' &&
      evidence.conditionBasis !== 'unreviewed' &&
      !evidence.geometryReviewRequired
    )
  )
}

export const ROAD_HISTORY_STYLES = {
  deactivated: { label: 'Recorded deactivation', color: '#b91c1c', dasharray: [3, 2] },
  closed: { label: 'Closed / unavailable', color: '#7f1d1d', dasharray: [1, 1] },
  reactivated: { label: 'Recorded reactivation · review condition', color: '#2563eb', dasharray: [5, 1] },
  rehabilitation: { label: 'Rehabilitation planning input', color: '#d97706', dasharray: [5, 2] },
  serviceable: { label: 'Serviceable planning input', color: '#0f766e', dasharray: [1, 0] },
  'retired-tenure': { label: 'Retired tenure · condition unknown', color: '#475569', dasharray: [1, 3] },
  unknown: { label: 'Road condition unknown', color: '#64748b', dasharray: [2, 3] },
} satisfies Record<string, { label: string; color: string; dasharray: number[] }>

export type RoadHistoryStyleKey = keyof typeof ROAD_HISTORY_STYLES

/** ACTIVE tenure alone never receives a serviceable colour; deactivation remains red during rehab planning. */
export function roadHistoryStyle(evidence?: ExistingRoadEvidence) {
  let key: RoadHistoryStyleKey = 'unknown'
  if (evidence?.deactivation?.status === 'deactivated') key = 'deactivated'
  else if (evidence?.condition === 'closed') key = 'closed'
  else if (evidence?.geometryReviewRequired) key = 'unknown'
  else if (evidence?.deactivation?.status === 'reactivated') key = 'reactivated'
  else if (evidence?.conditionBasis !== 'unreviewed' && evidence?.condition === 'rehabilitation') key = 'rehabilitation'
  else if (evidence?.conditionBasis !== 'unreviewed' && evidence?.condition === 'serviceable') key = 'serviceable'
  else if (evidence?.retirementDate || evidence?.lifecycleStatus?.trim().toUpperCase() === 'RETIRED')
    key = 'retired-tenure'
  return { key, ...ROAD_HISTORY_STYLES[key] }
}

export function roadDeactivationSummary(evidence?: RoadDeactivationEvidence): string {
  if (!evidence || evidence.status === 'unknown') return 'Physical deactivation: unknown'
  if (evidence.status === 'reactivated') return `Reactivation: ${evidence.reactivatedOn ?? 'date unknown'}`
  return `Deactivation: ${evidence.deactivatedOn ?? 'date unknown'}`
}

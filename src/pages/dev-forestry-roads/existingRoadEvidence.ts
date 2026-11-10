import type { ContextFeature, ExistingRoadEvidence, RoadLineOrigin } from './types'
import { parseRoadNetworkEvidence } from './roadNetwork'
import { parseRoadConditionObservations, parseRoadConditionPolicy } from './roadCondition'
import { deactivatedRoadNeedsReview, parseRoadDeactivation } from './roadHistory'

const ROAD_IDENTIFIER_FIELDS = ['forestFileId', 'roadSectionId', 'timberMark', 'clientNumber'] as const
const ROAD_STATION_FIELDS = ['segmentStartStation', 'segmentEndStation'] as const

/** Business codes are strings: coercing them to numbers would destroy section/client leading zeros. */
export function parseRoadIdentifiers(raw: Record<string, unknown>): Partial<ExistingRoadEvidence> {
  const result: Partial<ExistingRoadEvidence> = {}
  for (const key of ROAD_IDENTIFIER_FIELDS) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value))
      throw Error(`Invalid road evidence ${key}; retain the source identifier as text.`)
    result[key] = value
  }
  for (const key of ROAD_STATION_FIELDS) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000)
      throw Error(`Invalid road evidence ${key}; use a non-negative source station.`)
    result[key] = value
  }
  if (
    result.segmentStartStation !== undefined &&
    result.segmentEndStation !== undefined &&
    result.segmentStartStation > result.segmentEndStation
  )
    throw Error('Road segment end station must not precede its start station.')
  return result
}

/** Facts stay separate from planning assumptions, including after portable project restoration. */
export function parseRoadEvidence(raw: unknown): ExistingRoadEvidence {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Road evidence must be an object.')
  const r = raw as Record<string, unknown>
  if (typeof r.source !== 'string' || !['bc-ften', 'user', 'scenario'].includes(r.source))
    throw Error('Invalid road evidence source.')
  if (typeof r.condition !== 'string' || !['unknown', 'serviceable', 'rehabilitation', 'closed'].includes(r.condition))
    throw Error('Invalid existing-road condition.')
  if (typeof r.conditionBasis !== 'string' || !['unreviewed', 'assumed', 'field-verified'].includes(r.conditionBasis))
    throw Error('Invalid existing-road condition evidence.')
  if (typeof r.reuseAllowed !== 'boolean') throw Error('Road reuse must be explicitly enabled or disabled.')
  const result: ExistingRoadEvidence = {
    source: r.source as ExistingRoadEvidence['source'],
    condition: r.condition as ExistingRoadEvidence['condition'],
    conditionBasis: r.conditionBasis as ExistingRoadEvidence['conditionBasis'],
    reuseAllowed: r.reuseAllowed,
    ...parseRoadIdentifiers(r),
  }
  if (r.roadClass !== undefined) {
    if (typeof r.roadClass !== 'string' || !['fsr', 'permit', 'user'].includes(r.roadClass))
      throw Error('Invalid existing-road network class.')
    result.roadClass = r.roadClass as ExistingRoadEvidence['roadClass']
  }
  for (const key of [
    'sourceId',
    'sourceUrl',
    'retrievedAt',
    'status',
    'awardDate',
    'retirementDate',
    'fileTypeCode',
    'lifecycleStatus',
  ] as const) {
    if (r[key] === undefined) continue
    if (typeof r[key] !== 'string' || !r[key].trim() || r[key].length > 2000)
      throw Error(`Invalid road evidence ${key}.`)
    result[key] = r[key]
  }
  for (const key of ['awardDate', 'retirementDate', 'retrievedAt'] as const)
    if (result[key] && !Number.isFinite(Date.parse(result[key]!))) throw Error(`Invalid road evidence ${key}.`)
  if (r.constructionYear !== undefined) {
    if (!Number.isInteger(r.constructionYear) || Number(r.constructionYear) < 1800 || Number(r.constructionYear) > 2200)
      throw Error('Construction year must be a known year from 1800 to 2200, or unset.')
    result.constructionYear = Number(r.constructionYear)
  }
  if (result.sourceUrl && !/^https?:\/\//i.test(result.sourceUrl))
    throw Error('Road source URL must use HTTP or HTTPS.')
  if (result.condition === 'closed' && result.reuseAllowed) throw Error('A closed road cannot be enabled for reuse.')
  if (r.network !== undefined) result.network = parseRoadNetworkEvidence(r.network)
  if (r.observations !== undefined) result.observations = parseRoadConditionObservations(r.observations)
  if (r.conditionPolicy !== undefined) result.conditionPolicy = parseRoadConditionPolicy(r.conditionPolicy)
  if (r.deactivation !== undefined) result.deactivation = parseRoadDeactivation(r.deactivation)
  if (r.lineOrigin !== undefined) result.lineOrigin = parseRoadLineOrigin(r.lineOrigin)
  if (r.geometryReviewRequired !== undefined) {
    if (typeof r.geometryReviewRequired !== 'boolean') throw Error('Road geometry scope review must be true or false.')
    result.geometryReviewRequired = r.geometryReviewRequired
    if (result.geometryReviewRequired && result.reuseAllowed)
      throw Error('Review the updated road geometry scope before enabling reuse.')
  }
  if (result.reuseAllowed && deactivatedRoadNeedsReview(result))
    throw Error('A deactivated road requires an explicit reviewed rehabilitation assumption before enabling reuse.')
  return result
}

const LINE_ORIGIN_METHODS = ['terrain-relocation', 'terrain-trace', 'clicks'] as const
const LINE_ORIGIN_NUMBERS = {
  terrainCellM: [0, 1000],
  foundPercent: [0, 100],
  medianShiftM: [0, 1000],
  p90ShiftM: [0, 1000],
  benchWidthM: [0, 100],
  segments: [0, 100_000],
  snappedSegments: [0, 100_000],
  corridorM: [0, 1000],
  confidence: [0, 1],
  flatToleranceM: [0, 10],
  drivableWidthM: [0, 100],
  vegetationPercent: [0, 100],
  stateScore: [0, 100],
  stateClass: [1, 4],
  reconnectedEnds: [0, 2],
} as const

/** How a traced or adopted line was made; every figure optional and bounded. */
export function parseRoadLineOrigin(raw: unknown): RoadLineOrigin {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Road line origin must be an object.')
  const r = raw as Record<string, unknown>
  if (typeof r.method !== 'string' || !(LINE_ORIGIN_METHODS as readonly string[]).includes(r.method))
    throw Error('Invalid road line origin method.')
  if (typeof r.createdAt !== 'string' || r.createdAt.length > 40 || !Number.isFinite(Date.parse(r.createdAt)))
    throw Error('Invalid road line origin date.')
  const result: RoadLineOrigin = { method: r.method as RoadLineOrigin['method'], createdAt: r.createdAt }
  if (r.fromName !== undefined) {
    if (typeof r.fromName !== 'string' || !r.fromName.trim() || r.fromName.length > 200)
      throw Error('Invalid road line origin name.')
    result.fromName = r.fromName
  }
  for (const [key, [min, max]] of Object.entries(LINE_ORIGIN_NUMBERS) as [
    keyof typeof LINE_ORIGIN_NUMBERS,
    readonly [number, number],
  ][]) {
    const value = r[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(`Invalid road line origin ${key}.`)
    if ((key === 'stateClass' || key === 'reconnectedEnds') && !Number.isInteger(value))
      throw Error(`Invalid road line origin ${key}.`)
    result[key] = value
  }
  if (r.scoredWith !== undefined) {
    if (r.scoredWith !== 'terrain' && r.scoredWith !== 'terrain+vegetation')
      throw Error('Invalid road line origin scoredWith.')
    result.scoredWith = r.scoredWith
  }
  return result
}

export function unreviewedRoadEvidence(source: ExistingRoadEvidence['source'] = 'user'): ExistingRoadEvidence {
  return { source, condition: 'unknown', conditionBasis: 'unreviewed', reuseAllowed: false }
}

/** Refresh catalogue facts while retaining only the user's separate review assumptions. */
export function refreshedRoadEvidence(
  facts: ExistingRoadEvidence,
  previous?: ExistingRoadEvidence,
): ExistingRoadEvidence {
  const result = previous
    ? {
        // Older section responses did not include these codes. Preserve explicit identifiers
        // until a refresh supplies a replacement; never infer them from a display name.
        ...Object.fromEntries(
          [...ROAD_IDENTIFIER_FIELDS, ...ROAD_STATION_FIELDS]
            .filter((key) => previous[key] !== undefined)
            .map((key) => [key, previous[key]]),
        ),
        ...facts,
        condition: previous.condition,
        conditionBasis: previous.conditionBasis,
        reuseAllowed: previous.reuseAllowed,
        ...(previous.constructionYear !== undefined ? { constructionYear: previous.constructionYear } : {}),
        ...(previous.network ? { network: previous.network } : {}),
        ...(previous.observations ? { observations: previous.observations } : {}),
        ...(previous.conditionPolicy ? { conditionPolicy: previous.conditionPolicy } : {}),
        ...(facts.deactivation || previous.deactivation
          ? { deactivation: facts.deactivation ?? previous.deactivation }
          : {}),
        ...(previous.geometryReviewRequired !== undefined
          ? { geometryReviewRequired: previous.geometryReviewRequired }
          : {}),
      }
    : facts
  // New event evidence invalidates an earlier reuse approval even when the line itself is unchanged.
  if (
    (facts.deactivation && JSON.stringify(facts.deactivation) !== JSON.stringify(previous?.deactivation)) ||
    deactivatedRoadNeedsReview(result)
  )
    return { ...result, reuseAllowed: false }
  return result
}

/** Preserve review history on refresh, but do not transfer its approved scope onto changed linework. */
export function refreshExistingRoadFeature(facts: ContextFeature, previous?: ContextFeature): ContextFeature {
  const evidence = facts.roadEvidence
    ? refreshedRoadEvidence(facts.roadEvidence, previous?.roadEvidence)
    : previous?.roadEvidence
  const changed =
    previous?.kind === 'existing-road' &&
    facts.kind === 'existing-road' &&
    JSON.stringify(facts.geometry) !== JSON.stringify(previous.geometry)
  if (changed || evidence?.geometryReviewRequired)
    return {
      ...facts,
      roadEvidence: {
        ...(evidence ?? unreviewedRoadEvidence()),
        geometryReviewRequired: true,
        reuseAllowed: false,
      },
    }
  return { ...facts, ...(evidence ? { roadEvidence: evidence } : {}) }
}

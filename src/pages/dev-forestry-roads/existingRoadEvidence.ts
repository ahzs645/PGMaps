import type { ContextFeature, ExistingRoadEvidence } from './types'
import { parseRoadNetworkEvidence } from './roadNetwork'
import { parseRoadConditionObservations, parseRoadConditionPolicy } from './roadCondition'

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
  if (r.geometryReviewRequired !== undefined) {
    if (typeof r.geometryReviewRequired !== 'boolean') throw Error('Road geometry scope review must be true or false.')
    result.geometryReviewRequired = r.geometryReviewRequired
    if (result.geometryReviewRequired && result.reuseAllowed)
      throw Error('Review the updated road geometry scope before enabling reuse.')
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
  return previous
    ? {
        ...facts,
        condition: previous.condition,
        conditionBasis: previous.conditionBasis,
        reuseAllowed: previous.reuseAllowed,
        ...(previous.constructionYear !== undefined ? { constructionYear: previous.constructionYear } : {}),
        ...(previous.network ? { network: previous.network } : {}),
        ...(previous.observations ? { observations: previous.observations } : {}),
        ...(previous.conditionPolicy ? { conditionPolicy: previous.conditionPolicy } : {}),
        ...(previous.geometryReviewRequired !== undefined
          ? { geometryReviewRequired: previous.geometryReviewRequired }
          : {}),
      }
    : facts
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

/** Explicit planning treatments shared by every route search and final route screen. */
import { RIPARIAN_RULES } from './streamClass'
import type { ContextFeature } from './types'

export const CONSTRAINT_TREATMENTS = ['excluded', 'conditional', 'avoid-where-practical', 'additional-cost'] as const
export type ConstraintTreatment = (typeof CONSTRAINT_TREATMENTS)[number]
export const CONSTRAINT_LABELS: Record<ConstraintTreatment, string> = {
  excluded: 'Excluded',
  conditional: 'Conditional',
  'avoid-where-practical': 'Avoid where practical',
  'additional-cost': 'Additional cost',
}
export interface ConstraintPolicy {
  treatment: ConstraintTreatment
  /** CAD/m of route inside the screening area. Avoidance is a search penalty, not an estimate. */
  costPerM?: number
  condition?: string
  review?: {
    reviewer: string
    reviewedOn: string
    basis: string
    fingerprint: string
  }
}
export interface ResolvedConstraint {
  policy: ConstraintPolicy
  blocked: boolean
  reviewStatus: 'not-required' | 'pending' | 'current' | 'stale'
  costPerM: number
  /** True only for additional-cost; avoidance penalties must not enter construction estimates. */
  estimateCost: boolean
}

export function parseConstraintPolicy(raw: unknown): ConstraintPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Constraint policy must be an object.')
  const r = raw as Record<string, unknown>
  if (!CONSTRAINT_TREATMENTS.includes(r.treatment as ConstraintTreatment)) throw Error('Unknown constraint treatment.')
  const text = (value: unknown, label: string, max: number) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      throw Error(`${label} must be non-empty text of at most ${max} characters.`)
    return value.trim()
  }
  const policy: ConstraintPolicy = { treatment: r.treatment as ConstraintTreatment }
  if (r.costPerM !== undefined) {
    if (typeof r.costPerM !== 'number' || !Number.isFinite(r.costPerM) || r.costPerM < 0 || r.costPerM > 1e6)
      throw Error('Constraint cost must be between 0 and 1,000,000 CAD/m.')
    policy.costPerM = r.costPerM
  }
  if (policy.treatment === 'avoid-where-practical' && !(policy.costPerM! > 0))
    throw Error('Avoid where practical needs a positive search penalty per metre.')
  if (policy.treatment === 'additional-cost' && policy.costPerM === undefined)
    throw Error('Additional cost needs an explicit cost per metre.')
  if (r.condition !== undefined && r.condition !== '') policy.condition = text(r.condition, 'Condition', 2000)
  if (r.review !== undefined) {
    if (!r.review || typeof r.review !== 'object' || Array.isArray(r.review))
      throw Error('Constraint review must be an object.')
    const v = r.review as Record<string, unknown>
    const reviewedOn = text(v.reviewedOn, 'Review date', 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedOn) || !Number.isFinite(Date.parse(reviewedOn)))
      throw Error('Review date must be YYYY-MM-DD.')
    policy.review = {
      reviewer: text(v.reviewer, 'Reviewer', 200),
      reviewedOn,
      basis: text(v.basis, 'Review basis', 2000),
      fingerprint: text(v.fingerprint, 'Review fingerprint', 80),
    }
  }
  return policy
}

export function constraintPolicy(feature: ContextFeature): ConstraintPolicy {
  if (feature.kind === 'stream')
    return (
      feature.riparianPolicy ?? {
        treatment: 'conditional',
        condition: 'Review the preliminary riparian screening area and proposed crossing.',
      }
    )
  return (
    feature.constraint ??
    (feature.routeCostPerM === undefined
      ? { treatment: 'excluded' }
      : { treatment: 'additional-cost', costPerM: feature.routeCostPerM })
  )
}

/** Changes to the reach, evidence, rule version or condition invalidate the recorded decision. */
export function constraintFingerprint(feature: ContextFeature, policy = constraintPolicy(feature)): string {
  const canonical = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(canonical)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, canonical(value)]),
          )
        : input
  const value = JSON.stringify(
    canonical([
      feature.kind,
      feature.geometry,
      feature.streamAssessment ?? null,
      feature.kind === 'stream' ? RIPARIAN_RULES : null,
      policy.treatment,
      policy.costPerM ?? null,
      policy.condition?.trim() || null,
    ]),
  )
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0
  return `constraint-v1-${hash.toString(36)}`
}

export function resolveConstraint(feature: ContextFeature): ResolvedConstraint {
  const policy = constraintPolicy(feature)
  const conditional = policy.treatment === 'conditional'
  const review = policy.review
  const complete = !!(policy.condition?.trim() && review?.reviewer.trim() && review.reviewedOn && review.basis.trim())
  const current = complete && review?.fingerprint === constraintFingerprint(feature, policy)
  const reviewStatus = !conditional ? 'not-required' : current ? 'current' : review ? 'stale' : 'pending'
  const priced = policy.treatment === 'avoid-where-practical' || policy.treatment === 'additional-cost'
  // Invalid programmatic inputs fail closed as well as being refused by the JSON parser.
  const invalidPrice =
    priced &&
    (!Number.isFinite(policy.costPerM) ||
      policy.costPerM! < 0 ||
      policy.costPerM! > 1e6 ||
      (policy.treatment === 'avoid-where-practical' && policy.costPerM === 0))
  return {
    policy,
    reviewStatus,
    blocked:
      !CONSTRAINT_TREATMENTS.includes(policy.treatment) ||
      policy.treatment === 'excluded' ||
      (conditional && !current) ||
      invalidPrice,
    costPerM: priced && !invalidPrice ? policy.costPerM! : 0,
    estimateCost: policy.treatment === 'additional-cost',
  }
}

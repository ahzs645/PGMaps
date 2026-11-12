import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import {
  CONSTRAINT_LABELS,
  CONSTRAINT_TREATMENTS,
  constraintFingerprint,
  resolveConstraint,
  type ConstraintPolicy,
  type ConstraintTreatment,
} from './constraints'
import type { ContextFeature } from './types'
import { insetBox } from '@/components/ui/inset-box'

/** A recorded planning decision, scoped to this feature and its current evidence. */
export function ConstraintPolicyEditor({
  feature,
  onChange,
}: {
  feature: ContextFeature
  onChange: (policy: ConstraintPolicy) => void
}) {
  const resolved = resolveConstraint(feature)
  const policy = resolved.policy
  const [reviewer, setReviewer] = useState(policy.review?.reviewer ?? '')
  const [basis, setBasis] = useState(policy.review?.basis ?? '')
  const [reviewedOn, setReviewedOn] = useState(policy.review?.reviewedOn ?? new Date().toISOString().slice(0, 10))
  const priced = policy.treatment === 'avoid-where-practical' || policy.treatment === 'additional-cost'
  return (
    <div className="space-y-2" data-testid={`constraint-policy-${feature.id}`}>
      <Field
        label={`${feature.name} treatment`}
        hint="Excluded blocks search. Conditional blocks until a recorded planning review is current. Avoid where practical adds a search penalty; additional cost adds a planning allowance. None establishes legal permission."
      >
        <RoadSelect
          ariaLabel={`${feature.name} treatment`}
          className={roadFieldClass}
          value={policy.treatment}
          onValueChange={(value) => {
            const treatment = value as ConstraintTreatment
            onChange({
              ...policy,
              treatment,
              ...(treatment === 'avoid-where-practical'
                ? { costPerM: Math.max(1, policy.costPerM ?? 1000) }
                : treatment === 'additional-cost'
                  ? { costPerM: policy.costPerM ?? 0 }
                  : {}),
            })
          }}
        >
          {CONSTRAINT_TREATMENTS.map((value) => (
            <option key={value} value={value}>
              {CONSTRAINT_LABELS[value]}
            </option>
          ))}
        </RoadSelect>
      </Field>
      <p className="text-2xs text-muted-foreground" role="status">
        {resolved.blocked
          ? policy.treatment === 'conditional'
            ? `Blocked: conditional review ${resolved.reviewStatus}`
            : 'Excluded from route search'
          : policy.treatment === 'conditional'
            ? 'Conditional planning review current'
            : `${CONSTRAINT_LABELS[policy.treatment]}, $${resolved.costPerM}/m`}
      </p>
      {priced && (
        <NumberField
          label={`${feature.name} ${policy.treatment === 'avoid-where-practical' ? 'search penalty' : 'zone cost'} per metre`}
          value={policy.costPerM ?? 0}
          min={policy.treatment === 'avoid-where-practical' ? 1 : 0}
          max={1e6}
          step={10}
          onChange={(costPerM) => onChange({ ...policy, costPerM })}
          hint={
            policy.treatment === 'avoid-where-practical'
              ? 'CAD-equivalent penalty for each metre inside the area. Encourages a detour; it is not a construction estimate.'
              : 'Planning CAD allowance for each metre inside the area.'
          }
        />
      )}
      {policy.treatment === 'conditional' && (
        <>
          <Field label="Planning condition">
            <textarea
              className={roadFieldClass}
              rows={2}
              maxLength={2000}
              value={policy.condition ?? ''}
              onChange={(event) => onChange({ ...policy, condition: event.target.value })}
            />
          </Field>
          <details className={insetBox({ padding: 'none' })}>
            <summary className="cursor-pointer px-2 py-1 text-xs">Review conditional use</summary>
            <div className="space-y-2 border-t p-2">
              <p className="text-2xs text-muted-foreground">
                Record how the condition is addressed for this area and proposed use. This enables planning search
                through the area; it does not grant approval. Changed geometry, evidence or conditions require another
                review.
              </p>
              <Field label="Condition reviewer">
                <input
                  className={roadFieldClass}
                  maxLength={200}
                  value={reviewer}
                  onChange={(event) => setReviewer(event.target.value)}
                />
              </Field>
              <Field label="Condition review date">
                <input
                  className={roadFieldClass}
                  type="date"
                  value={reviewedOn}
                  onChange={(event) => setReviewedOn(event.target.value)}
                />
              </Field>
              <Field label="Condition review evidence">
                <textarea
                  className={roadFieldClass}
                  rows={2}
                  maxLength={2000}
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                />
              </Field>
              <Button
                size="sm"
                className="w-full text-xs"
                disabled={!policy.condition?.trim() || !reviewer.trim() || !basis.trim() || !reviewedOn}
                onClick={() =>
                  onChange({
                    ...policy,
                    review: {
                      reviewer: reviewer.trim(),
                      reviewedOn,
                      basis: basis.trim(),
                      fingerprint: constraintFingerprint(feature, policy),
                    },
                  })
                }
              >
                Record conditional review
              </Button>
              {policy.review && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => onChange({ ...policy, review: undefined })}
                >
                  Clear conditional review
                </Button>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

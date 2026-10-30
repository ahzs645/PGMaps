import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, OptionalNumberField, roadFieldClass } from './Controls'
import {
  assessRoadCondition,
  MAX_CONDITION_EVIDENCE_AGE_DAYS,
  MAX_ROAD_CONDITION_OBSERVATIONS,
  parseRoadConditionObservations,
  ROAD_COMPONENT_LABELS,
  ROAD_CONDITION_LABELS,
  type RoadCondition,
  type RoadConditionAssessment,
  type RoadConditionComponent,
  type RoadConditionObservation,
  type RoadConditionPolicy,
  type RoadConditionSource,
} from './roadCondition'

interface Props {
  roadName: string
  observations: RoadConditionObservation[]
  policy: RoadConditionPolicy
  asOf: string
  onChangeObservations: (observations: RoadConditionObservation[]) => void
  onChangePolicy: (policy: RoadConditionPolicy) => void
  onChangeAsOf?: (date: string) => void
  /** The host decides whether and how an explicit copy changes its separate manual condition. */
  onUseEstimate?: (assessment: RoadConditionAssessment) => void
  disabled?: boolean
}

function emptyObservation(asOf: string) {
  return {
    source: 'inspection' as RoadConditionSource,
    component: 'overall' as RoadConditionComponent,
    assetReference: '',
    observedAt: asOf,
    sourceUrl: '',
    notes: '',
    finding: 'unknown' as RoadCondition,
    reviewed: false,
    reviewer: '',
    reviewedAt: asOf,
    replaces: '',
  }
}

/** Mount with a road-specific condition-editor key, so a draft cannot move to another road. */
export function RoadConditionEditor({
  roadName,
  observations,
  policy,
  asOf,
  onChangeObservations,
  onChangePolicy,
  onChangeAsOf,
  onUseEstimate,
  disabled = false,
}: Props) {
  const [draft, setDraft] = useState(() => emptyObservation(asOf))
  const [entryError, setEntryError] = useState('')
  const change = (patch: Partial<typeof draft>) => setDraft((previous) => ({ ...previous, ...patch }))
  let assessment: RoadConditionAssessment | null = null
  let assessmentError = ''
  try {
    assessment = assessRoadCondition(observations, { asOf, policy })
  } catch (cause) {
    assessmentError = cause instanceof Error ? cause.message : 'Could not assess road evidence.'
  }
  const estimate = assessment
  const add = () => {
    try {
      const observation: RoadConditionObservation = {
        id: crypto.randomUUID(),
        source: draft.source,
        component: draft.component,
        ...(draft.assetReference.trim() ? { assetReference: draft.assetReference.trim() } : {}),
        observedAt: draft.observedAt,
        sourceUrl: draft.sourceUrl,
        notes: draft.notes,
        finding: draft.finding,
        ...(draft.reviewed ? { review: { reviewer: draft.reviewer, reviewedAt: draft.reviewedAt } } : {}),
        ...(draft.replaces ? { supersedes: [draft.replaces] } : {}),
      }
      onChangeObservations(parseRoadConditionObservations([...observations, observation]))
      setDraft(emptyObservation(asOf))
      setEntryError('')
    } catch (cause) {
      setEntryError(cause instanceof Error ? cause.message : 'Could not add condition evidence.')
    }
  }
  const replaceOptions = observations.filter(
    (observation) =>
      observation.component === draft.component &&
      (observation.assetReference ?? '') === draft.assetReference.trim() &&
      observation.observedAt <= draft.observedAt,
  )
  return (
    <section
      className="space-y-2 rounded-lg border p-2.5"
      aria-label={`Dated condition evidence for ${roadName}`}
      data-testid="road-condition-editor"
    >
      <h4 className="text-xs font-semibold">Dated condition evidence</h4>
      <p className="text-[11px] text-muted-foreground">
        Link an inspection or dated image, record the observed component and a reviewer, then set how long this evidence
        may inform planning. Record dates and tenure awards do not establish construction age.
      </p>
      <fieldset className="space-y-2" disabled={disabled}>
        <Field label="Assess condition as of">
          <input
            className={roadFieldClass}
            type="date"
            value={asOf}
            readOnly={!onChangeAsOf}
            onChange={(event) => {
              if (event.target.value) onChangeAsOf?.(event.target.value)
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <OptionalNumberField
            label="Inspection evidence max age (days)"
            value={policy.maxInspectionAgeDays}
            min={0}
            max={MAX_CONDITION_EVIDENCE_AGE_DAYS}
            step={1}
            placeholder="not configured"
            onChange={(value) =>
              onChangePolicy({ ...policy, maxInspectionAgeDays: value === null ? null : Math.round(value) })
            }
          />
          <OptionalNumberField
            label="Imagery evidence max age (days)"
            value={policy.maxImageryAgeDays}
            min={0}
            max={MAX_CONDITION_EVIDENCE_AGE_DAYS}
            step={1}
            placeholder="not configured"
            onChange={(value) =>
              onChangePolicy({ ...policy, maxImageryAgeDays: value === null ? null : Math.round(value) })
            }
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          These are your planning applicability windows. An unset window leaves that source unassessed; it does not
          prescribe an inspection schedule or predict deterioration.
        </p>
        {assessmentError && <InlineAlert tone="warning">{assessmentError}</InlineAlert>}
        {estimate && (
          <div
            className="space-y-1 rounded border bg-muted/20 p-2 text-[11px]"
            data-testid="road-condition-estimate"
            data-estimated-condition={estimate.condition}
            data-evidence-basis={estimate.basis}
          >
            <p className="font-semibold">Planning estimate: {ROAD_CONDITION_LABELS[estimate.condition]}</p>
            <p>{estimate.explanation}</p>
            {estimate.hasOpenClosureEvidence && (
              <p>
                Unresolved closure records: {estimate.unresolvedClosureObservationIds.join(', ')}. Road reuse remains
                blocked.
              </p>
            )}
            <p className="text-muted-foreground">
              As of {estimate.asOf} · {estimate.usedObservationIds.length} applicable records · {estimate.basis}
              {estimate.evidenceAgeDays
                ? ` · ${estimate.evidenceAgeDays.youngest}–${estimate.evidenceAgeDays.oldest} days old`
                : ''}
              {estimate.expiresAt ? ` · earliest window ends ${estimate.expiresAt}` : ''}
            </p>
            {estimate.components
              .filter((component) => component.observationIds.length)
              .map((component) => (
                <p key={`${component.component}:${component.assetReference ?? ''}`}>
                  {ROAD_COMPONENT_LABELS[component.component]}
                  {component.assetReference ? ` · ${component.assetReference}` : ''}:{' '}
                  {ROAD_CONDITION_LABELS[component.condition]}
                  {component.hasConflicts ? ' · conflicting evidence' : ''}
                </p>
              ))}
            <p className="text-muted-foreground">
              Loaded-truck capacity, crossing approval and access permission are not established by this estimate. A
              recorded reviewer is a user-entered attribution, not verified professional credentials.
            </p>
            {onUseEstimate && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 w-full"
                disabled={estimate.condition === 'unknown' || estimate.hasConflicts}
                onClick={() => onUseEstimate(estimate)}
              >
                Use estimate as planning condition
              </Button>
            )}
          </div>
        )}
        {!!estimate?.records.length && (
          <ul className="divide-y rounded border" aria-label="Dated road observations">
            {estimate.records.map(({ observation, status, ageDays, reason }) => (
              <li key={observation.id} className="space-y-1 p-2 text-[11px]">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {observation.observedAt} · {observation.source} · {ROAD_COMPONENT_LABELS[observation.component]}
                      {observation.assetReference ? ` · ${observation.assetReference}` : ''}
                    </p>
                    <p>
                      {ROAD_CONDITION_LABELS[observation.finding]} · {status} ·{' '}
                      {ageDays < 0 ? `${-ageDays} days after assessment` : `${ageDays} days old`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1 text-[11px]"
                    aria-label={`Remove observation ${observation.id}`}
                    onClick={() =>
                      onChangeObservations(
                        observations
                          .filter((item) => item.id !== observation.id)
                          .map((item) => ({
                            ...item,
                            ...(item.supersedes
                              ? { supersedes: item.supersedes.filter((id) => id !== observation.id) }
                              : {}),
                          })),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
                <p className="text-muted-foreground">{reason}</p>
                <p className="whitespace-pre-wrap break-words">{observation.notes}</p>
                <p className="text-muted-foreground">
                  {observation.review
                    ? `Recorded reviewer: ${observation.review.reviewer} · reviewed ${observation.review.reviewedAt}`
                    : 'No review recorded'}
                  {observation.supersedes?.length ? ` · replaces ${observation.supersedes.join(', ')}` : ''}
                </p>
                <a className="underline" href={observation.sourceUrl} target="_blank" rel="noreferrer">
                  Open linked evidence
                </a>
              </li>
            ))}
          </ul>
        )}
        <details className="rounded border">
          <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">
            Add an inspection or imagery observation
          </summary>
          <div className="space-y-2 border-t p-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Evidence source">
                <select
                  className={roadFieldClass}
                  value={draft.source}
                  onChange={(event) => change({ source: event.target.value as RoadConditionSource })}
                >
                  <option value="inspection">Inspection record</option>
                  <option value="imagery">Dated imagery</option>
                </select>
              </Field>
              <Field label="Observation date">
                <input
                  className={roadFieldClass}
                  type="date"
                  value={draft.observedAt}
                  onChange={(event) => change({ observedAt: event.target.value })}
                />
              </Field>
              <Field label="Observed component">
                <select
                  className={roadFieldClass}
                  value={draft.component}
                  onChange={(event) =>
                    change({ component: event.target.value as RoadConditionComponent, replaces: '' })
                  }
                >
                  {Object.entries(ROAD_COMPONENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Observed condition">
                <select
                  className={roadFieldClass}
                  value={draft.finding}
                  onChange={(event) => change({ finding: event.target.value as RoadCondition })}
                >
                  {Object.entries(ROAD_CONDITION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Observed asset / station (optional)">
              <input
                className={roadFieldClass}
                value={draft.assetReference}
                maxLength={200}
                placeholder="e.g. bridge B-12 or km 4.2"
                onChange={(event) => change({ assetReference: event.target.value, replaces: '' })}
              />
            </Field>
            <Field label="Evidence source URL">
              <input
                className={roadFieldClass}
                type="url"
                value={draft.sourceUrl}
                maxLength={2000}
                placeholder="https://… inspection report or dated imagery"
                onChange={(event) => change({ sourceUrl: event.target.value })}
              />
            </Field>
            <Field label="Observation notes">
              <textarea
                className={roadFieldClass}
                rows={3}
                value={draft.notes}
                maxLength={2000}
                placeholder="Describe findings, intended use, visibility and parts not inspected."
                onChange={(event) => change({ notes: event.target.value })}
              />
            </Field>
            <label className="flex items-start gap-2 text-xs">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={draft.reviewed}
                onChange={(event) => change({ reviewed: event.target.checked })}
              />
              <span>Record a review of this observation</span>
            </label>
            {draft.reviewed && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Recorded reviewer">
                  <input
                    className={roadFieldClass}
                    value={draft.reviewer}
                    maxLength={200}
                    onChange={(event) => change({ reviewer: event.target.value })}
                  />
                </Field>
                <Field label="Review date">
                  <input
                    className={roadFieldClass}
                    type="date"
                    value={draft.reviewedAt}
                    onChange={(event) => change({ reviewedAt: event.target.value })}
                  />
                </Field>
              </div>
            )}
            <Field label="Replaces observation (optional)">
              <select
                className={roadFieldClass}
                value={draft.replaces}
                onChange={(event) => change({ replaces: event.target.value })}
              >
                <option value="">Keep all existing evidence</option>
                {replaceOptions.map((observation) => (
                  <option key={observation.id} value={observation.id}>
                    {observation.observedAt} · {ROAD_CONDITION_LABELS[observation.finding]} · {observation.id}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-[11px] text-muted-foreground">
              A newer date alone does not replace conflicting evidence. Replacements apply to the same component and
              asset and take effect only when the new record is applicable and reviewed. Imagery cannot clear a bridge
              or culvert as serviceable. Links are saved; their contents are not downloaded or analysed.
            </p>
            {entryError && <InlineAlert tone="warning">{entryError}</InlineAlert>}
            <Button
              size="sm"
              className="w-full"
              onClick={add}
              disabled={observations.length >= MAX_ROAD_CONDITION_OBSERVATIONS}
            >
              Add dated evidence
            </Button>
            {observations.length >= MAX_ROAD_CONDITION_OBSERVATIONS && (
              <p className="text-[11px] text-muted-foreground">
                The road has reached its {MAX_ROAD_CONDITION_OBSERVATIONS}-observation limit.
              </p>
            )}
          </div>
        </details>
      </fieldset>
    </section>
  )
}

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
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
  // A record counts only once its source has an age limit, so that setting cannot stay folded away.
  const needsAgeLimit = !!estimate?.records.some(({ status }) => status === 'policy-unset')
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
      className={cn(insetBox(), 'space-y-2')}
      aria-label={`Dated condition evidence for ${roadName}`}
      data-testid="road-condition-editor"
    >
      <div className="flex items-center gap-1">
        <h4 className="min-w-0 flex-1 text-xs font-semibold">Condition evidence</h4>
        <InfoTip label="About condition evidence">
          Link an inspection or dated image, then set how long it may inform planning. Record dates and tenure awards do
          not establish construction age. Loaded-truck capacity, crossing approval and access permission are not
          established by this estimate, and a recorded reviewer is a user-entered attribution, not verified credentials.
        </InfoTip>
      </div>
      <fieldset className="space-y-2" disabled={disabled}>
        {assessmentError && <InlineAlert tone="warning">{assessmentError}</InlineAlert>}
        {estimate && (
          <div
            className="space-y-1 text-2xs"
            data-testid="road-condition-estimate"
            data-estimated-condition={estimate.condition}
            data-evidence-basis={estimate.basis}
          >
            <p>
              <span className="font-semibold">{ROAD_CONDITION_LABELS[estimate.condition]}</span>
              <span className="text-muted-foreground">
                {' '}
                · {estimate.usedObservationIds.length} record{estimate.usedObservationIds.length === 1 ? '' : 's'}
                {estimate.evidenceAgeDays
                  ? ` · ${estimate.evidenceAgeDays.youngest}–${estimate.evidenceAgeDays.oldest} days old`
                  : ''}
                {estimate.expiresAt ? ` · valid to ${estimate.expiresAt}` : ''}
              </span>
            </p>
            {observations.length > 0 && <p className="text-muted-foreground">{estimate.explanation}</p>}
            {estimate.hasOpenClosureEvidence && (
              <InlineAlert tone="warning">
                Unresolved closure records: {estimate.unresolvedClosureObservationIds.join(', ')}. Road reuse remains
                blocked.
              </InlineAlert>
            )}
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
            {onUseEstimate && estimate.condition !== 'unknown' && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 w-full"
                disabled={estimate.hasConflicts}
                onClick={() => onUseEstimate(estimate)}
              >
                Use as planning condition
              </Button>
            )}
          </div>
        )}
        {!!estimate?.records.length && (
          <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')} aria-label="Dated road observations">
            {estimate.records.map(({ observation, status, ageDays, reason }) => (
              <li key={observation.id} className="space-y-1 p-2 text-2xs">
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
                    size="2xs"
                    variant="ghost"
                    className="px-1"
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
                {observation.lidar && (
                  <p data-testid="lidar-road-state">
                    LiDAR state class {observation.lidar.stateClass} · score {observation.lidar.score.toFixed(1)} ·
                    drivable {observation.lidar.drivableWidthM.toFixed(1)} m · vegetation{' '}
                    {observation.lidar.vegetationPercent.toFixed(1)}% · shoulders{' '}
                    {observation.lidar.shoulderPercent.toFixed(0)}% · conductivity{' '}
                    {observation.lidar.conductivity.toFixed(2)} · {observation.lidar.terrainName}
                  </p>
                )}
                {observation.sourceUrl && (
                  <a className="underline" href={observation.sourceUrl} target="_blank" rel="noreferrer">
                    Open linked evidence
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        <details className={insetBox({ padding: 'none' })}>
          <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">Add an inspection or imagery</summary>
          <div className="space-y-2 border-t p-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Evidence source">
                <RoadSelect
                  ariaLabel="Evidence source"
                  className={roadFieldClass}
                  value={draft.source}
                  onValueChange={(value) => change({ source: value as RoadConditionSource })}
                >
                  <option value="inspection">Inspection record</option>
                  <option value="imagery">Dated imagery</option>
                </RoadSelect>
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
                <RoadSelect
                  ariaLabel="Observed component"
                  className={roadFieldClass}
                  value={draft.component}
                  onValueChange={(value) => change({ component: value as RoadConditionComponent, replaces: '' })}
                >
                  {Object.entries(ROAD_COMPONENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </RoadSelect>
              </Field>
              <Field label="Observed condition">
                <RoadSelect
                  ariaLabel="Observed condition"
                  className={roadFieldClass}
                  value={draft.finding}
                  onValueChange={(value) => change({ finding: value as RoadCondition })}
                >
                  {Object.entries(ROAD_CONDITION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </RoadSelect>
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
              <RoadSelect
                ariaLabel="Replaces observation (optional)"
                className={roadFieldClass}
                value={draft.replaces}
                onValueChange={(value) => change({ replaces: value })}
              >
                <option value="">Keep all existing evidence</option>
                {replaceOptions.map((observation) => (
                  <option key={observation.id} value={observation.id}>
                    {observation.observedAt} · {ROAD_CONDITION_LABELS[observation.finding]} · {observation.id}
                  </option>
                ))}
              </RoadSelect>
            </Field>
            {entryError && <InlineAlert tone="warning">{entryError}</InlineAlert>}
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                className="min-w-0 flex-1"
                onClick={add}
                disabled={observations.length >= MAX_ROAD_CONDITION_OBSERVATIONS}
              >
                Add dated evidence
              </Button>
              <InfoTip label="About adding evidence">
                A newer date alone does not replace conflicting evidence. Replacements apply to the same component and
                asset and take effect only when the new record is applicable and reviewed. Imagery cannot clear a bridge
                or culvert as serviceable. Links are saved; their contents are not downloaded or analysed.
              </InfoTip>
            </div>
            {observations.length >= MAX_ROAD_CONDITION_OBSERVATIONS && (
              <p className="text-2xs text-muted-foreground">
                The road has reached its {MAX_ROAD_CONDITION_OBSERVATIONS}-observation limit.
              </p>
            )}
          </div>
        </details>
        {needsAgeLimit && (
          <InlineAlert tone="warning">Set a maximum age below so your records count towards the estimate.</InlineAlert>
        )}
        <details className={insetBox({ padding: 'none' })} open={needsAgeLimit || undefined}>
          <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">Assessment date & evidence age</summary>
          <div className="space-y-2 border-t p-2">
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
                placeholder="not set"
                hint="How long an inspection may inform planning. Unset leaves that source unassessed; it does not prescribe an inspection schedule or predict deterioration."
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
                placeholder="not set"
                onChange={(value) =>
                  onChangePolicy({ ...policy, maxImageryAgeDays: value === null ? null : Math.round(value) })
                }
              />
              <OptionalNumberField
                label="LiDAR evidence max age (days)"
                value={policy.maxLidarAgeDays ?? null}
                min={0}
                max={MAX_CONDITION_EVIDENCE_AGE_DAYS}
                step={1}
                placeholder="not set"
                hint="How long a LiDAR state class, recorded from Find on terrain, may inform planning, counted from the acquisition date."
                onChange={(value) =>
                  onChangePolicy({ ...policy, maxLidarAgeDays: value === null ? null : Math.round(value) })
                }
              />
            </div>
          </div>
        </details>
      </fieldset>
    </section>
  )
}

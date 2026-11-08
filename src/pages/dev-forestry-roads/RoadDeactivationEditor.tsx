import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import {
  BC_ROAD_NOTICES_URL,
  MAX_ROAD_HISTORY_TEXT,
  PRINCE_GEORGE_ROAD_MAP_URL,
  PRINCE_GEORGE_ROAD_NOTICES_URL,
  parseRoadDeactivation,
  roadDeactivationSummary,
  type RoadDeactivationEvidence,
} from './roadHistory'

function draftFor(value?: RoadDeactivationEvidence) {
  return {
    status: value?.status ?? ('unknown' as RoadDeactivationEvidence['status']),
    basis: value?.basis ?? ('source-record' as RoadDeactivationEvidence['basis']),
    reference: value?.reference ?? '',
    deactivatedOn: value?.deactivatedOn ?? '',
    reactivatedOn: value?.reactivatedOn ?? '',
    observedOn: value?.observedOn ?? '',
    sourceUrl: value?.sourceUrl ?? '',
    notes: value?.notes ?? '',
  }
}

/** Event dates are staged together so a partial edit cannot silently change reuse eligibility. */
export function RoadDeactivationEditor({
  value,
  onChange,
  disabled = false,
}: {
  value?: RoadDeactivationEvidence
  onChange: (value: RoadDeactivationEvidence) => void
  disabled?: boolean
}) {
  const currentKey = JSON.stringify(value ?? null)
  const [entry, setEntry] = useState(() => ({ key: currentKey, draft: draftFor(value) }))
  const [error, setError] = useState('')
  const stale = entry.key !== currentKey
  const draft = entry.draft
  const patch = (update: Partial<typeof draft>) =>
    setEntry((prior) => ({ ...prior, draft: { ...prior.draft, ...update } }))
  const reset = () => {
    setEntry({ key: currentKey, draft: draftFor(value) })
    setError('')
  }
  const save = () => {
    if (stale) return
    try {
      const next = parseRoadDeactivation({
        status: draft.status,
        basis: draft.basis,
        reference: draft.reference,
        ...(draft.status !== 'unknown' && draft.deactivatedOn ? { deactivatedOn: draft.deactivatedOn } : {}),
        ...(draft.status === 'reactivated' && draft.reactivatedOn ? { reactivatedOn: draft.reactivatedOn } : {}),
        ...(draft.observedOn ? { observedOn: draft.observedOn } : {}),
        ...(draft.sourceUrl.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}),
        ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      })
      onChange(next)
      setEntry({ key: JSON.stringify(next), draft: draftFor(next) })
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save road event evidence.')
    }
  }
  return (
    <CollapsibleSection
      label="Physical road history"
      summary={roadDeactivationSummary(value)}
      summaryWhenCollapsedOnly
      contentClassName="space-y-2 pt-2"
      toggleProps={{ 'data-testid': 'road-deactivation-toggle' }}
    >
      <div className="space-y-2" data-testid="road-deactivation-editor">
        <p className="text-2xs text-muted-foreground">
          Enter a record or field observation. Leave the event date blank when only the status is known. Tenure
          retirement and the date you observed a road are separate.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs">
          <a className="underline" href={BC_ROAD_NOTICES_URL} target="_blank" rel="noreferrer">
            BC district road notices
          </a>
          <a className="underline" href={PRINCE_GEORGE_ROAD_NOTICES_URL} target="_blank" rel="noreferrer">
            Prince George road notices
          </a>
          <a className="underline" href={PRINCE_GEORGE_ROAD_MAP_URL} target="_blank" rel="noreferrer">
            Official district road map
          </a>
        </div>
        {stale && (
          <InlineAlert tone="warning">
            This road history changed while you were editing. Reload its current evidence before saving.
          </InlineAlert>
        )}
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
        <fieldset className="space-y-2" disabled={disabled || stale}>
          <Field label="Recorded physical status">
            <RoadSelect
              ariaLabel="Recorded physical status"
              className={roadFieldClass}
              value={draft.status}
              onValueChange={(status) => patch({ status: status as RoadDeactivationEvidence['status'] })}
              disabled={disabled || stale}
            >
              <option value="unknown">Unknown</option>
              <option value="deactivated">Deactivated</option>
              <option value="reactivated">Reactivated</option>
            </RoadSelect>
          </Field>
          <Field label="Road event evidence source">
            <RoadSelect
              ariaLabel="Road event evidence source"
              className={roadFieldClass}
              value={draft.basis}
              onValueChange={(basis) => patch({ basis: basis as RoadDeactivationEvidence['basis'] })}
              disabled={disabled || stale}
            >
              <option value="source-record">Source record / report</option>
              <option value="field-observation">Field observation</option>
              <option value="scenario">Scenario assumption</option>
            </RoadSelect>
          </Field>
          <Field
            label="Road event source reference"
            hint="Check the FSR number, kilometre range and whether the work is completed or only planned. A publication date is not necessarily the deactivation date. If a notice covers only part of this line, import that section separately before applying its status."
          >
            <input
              className={roadFieldClass}
              value={draft.reference}
              maxLength={MAX_ROAD_HISTORY_TEXT}
              placeholder="Report, record identifier or field note"
              onChange={(event) => patch({ reference: event.target.value })}
            />
          </Field>
          {draft.status !== 'unknown' && (
            <Field label="Deactivated on (known event date)">
              <input
                className={roadFieldClass}
                type="date"
                value={draft.deactivatedOn}
                onChange={(event) => patch({ deactivatedOn: event.target.value })}
              />
            </Field>
          )}
          {draft.status === 'reactivated' && (
            <Field label="Reactivated on (known event date)">
              <input
                className={roadFieldClass}
                type="date"
                value={draft.reactivatedOn}
                onChange={(event) => patch({ reactivatedOn: event.target.value })}
              />
            </Field>
          )}
          <Field label="Observed on (optional)">
            <input
              className={roadFieldClass}
              type="date"
              value={draft.observedOn}
              onChange={(event) => patch({ observedOn: event.target.value })}
            />
          </Field>
          <Field label="Road event source URL (optional)">
            <input
              className={roadFieldClass}
              type="url"
              value={draft.sourceUrl}
              maxLength={MAX_ROAD_HISTORY_TEXT}
              placeholder="https://…"
              onChange={(event) => patch({ sourceUrl: event.target.value })}
            />
          </Field>
          <Field label="Road event notes (optional)">
            <textarea
              className={roadFieldClass}
              value={draft.notes}
              maxLength={MAX_ROAD_HISTORY_TEXT}
              rows={2}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
        </fieldset>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={disabled || stale} onClick={save}>
            Save road history
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={reset}>
            {stale ? 'Reload evidence' : 'Discard changes'}
          </Button>
        </div>
      </div>
    </CollapsibleSection>
  )
}

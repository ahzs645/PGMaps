import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { ChevronDown, Sprout } from 'lucide-react'
import { FORM_INPUT_CLASS, FormField, NullableNumberField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { cn } from '@/lib/utils'
import type { ForestryScene } from './scene'
import type { TargetPolygon } from './types'
import {
  FIELD_GREEN_UP_NOTE_MAX,
  FIELD_GREEN_UP_OBSERVER_MAX,
  greenUpReading,
  type FieldGreenUp,
  type FieldGreenUpFinding,
} from './greenUp'
import { formatPct } from './measureFormat'

const INLINE_FIELD = 'flex-row items-center justify-between gap-3'

/** The existing openings whose green-up a field check can confirm. */
/** What the one-click visual judgement writes into the check's note, so the basis travels with it. */
export const VISUAL_JUDGEMENT_NOTE = 'Judged visually greened up from the viewpoint photo.'

export function greenUpOpenings(scene: ForestryScene): TargetPolygon[] {
  return scene.targets.filter((t) => t.role === 'harvested' && !t.siteDisturbance)
}

/** "2 field-confirmed · 5 modelled", for the fold's summary. */
export function greenUpSummary(scene: ForestryScene): string {
  const year = scene.assessmentYear ?? new Date().getFullYear()
  const openings = greenUpOpenings(scene)
  const field = openings.filter((t) => greenUpReading(t, year, scene.settings.greenUpAgeYears).used === 'field').length
  return field ? `${field} field-confirmed · ${openings.length - field} modelled` : 'Modelled · no field checks'
}

const share = (value: number | null) => (value === null ? 'not counted' : `${formatPct(value, 0)} greened up`)

/**
 * Handbook 3.4.2 per existing opening: the modelled share greened up (green-up
 * age, or a supplied estimate), and an optional field check that overrides it
 * once it has a date and an observer. Both stay on screen, with the one the
 * run uses named.
 */
export function ExistingOpeningGreenUp({
  scene,
  onChange,
}: {
  scene: ForestryScene
  onChange: (scene: ForestryScene) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const year = scene.assessmentYear ?? new Date().getFullYear()
  const openings = greenUpOpenings(scene)
  const update = (id: string, patch: Partial<TargetPolygon>) =>
    onChange({ ...scene, targets: scene.targets.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  const setField = (target: TargetPolygon, patch: Partial<FieldGreenUp> | null) => {
    if (!patch) return update(target.id, { fieldGreenUp: null })
    const current: FieldGreenUp = target.fieldGreenUp ?? {
      finding: 'yes',
      greenedUpPercent: 100,
      observedOn: '',
      observedBy: '',
    }
    const next = { ...current, ...patch }
    if (patch.finding === 'yes') next.greenedUpPercent = 100
    if (patch.finding === 'no') next.greenedUpPercent = 0
    if (patch.finding === 'percent' && current.finding !== 'percent') next.greenedUpPercent = null
    update(target.id, { fieldGreenUp: next })
  }
  if (!openings.length)
    return <p className="text-muted-foreground">No existing openings in the scene. Look up this map view in step 1.</p>
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">
        An opening 70% greened up still counts 30% of its area (handbook 3.4.2). The model reads the share from a
        supplied estimate, else the green-up age. A field check with a date and an observer overrides it; the modelled
        share is kept beside it.
      </p>
      <ul
        className="max-h-96 divide-y overflow-y-auto rounded-md border"
        aria-label="Existing openings and their green-up"
      >
        {openings.map((t) => {
          const reading = greenUpReading(t, year, scene.settings.greenUpAgeYears)
          const open = openId === t.id
          const field = t.fieldGreenUp ?? null
          return (
            <li key={t.id}>
              <ResultRow
                className="py-2"
                title={t.name}
                subtitle={`${share(reading.greenedUpPercent)} · ${reading.used === 'field' ? reading.label : 'modelled'}`}
                leading={
                  <Sprout
                    aria-hidden="true"
                    className={cn('mt-1 size-3', reading.used === 'field' ? 'text-success' : 'text-muted-foreground')}
                  />
                }
                trailing={
                  <ChevronDown
                    aria-hidden="true"
                    className={cn('mt-1 size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
                  />
                }
                selected={open}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : t.id)}
              />
              {open && (
                <ResultRowDetail className="space-y-2">
                  <p>
                    <span className="text-muted-foreground">Modelled: </span>
                    {share(reading.modelled.greenedUpPercent)} — {reading.modelled.detail}
                    {reading.used === 'field' ? ' (kept for the record, not used)' : ' (used)'}
                  </p>
                  <NullableNumberField
                    label="Supplied recovery estimate"
                    aria-label={`Recovery percent for ${t.name}`}
                    contentClassName={INLINE_FIELD}
                    inputClassName={cn(FORM_INPUT_CLASS, 'w-20')}
                    suffix="%"
                    placeholder="Age"
                    min={0}
                    max={100}
                    value={t.recoveryPercent ?? null}
                    onValueChange={(recoveryPercent) => update(t.id, { recoveryPercent })}
                  />
                  {/* A VIA's existing-alteration line is an ocular judgement: one click records it, dated. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setField(t, {
                        finding: 'yes',
                        observedOn: new Date().toISOString().slice(0, 10),
                        note: [VISUAL_JUDGEMENT_NOTE, field?.note].filter(Boolean).join(' '),
                      })
                    }
                  >
                    Judged visually greened up from the viewpoint photo
                  </Button>
                  <FormField label="Field check" contentClassName={INLINE_FIELD}>
                    <StyledSelect
                      aria-label={`Field check for ${t.name}`}
                      className="rounded-md border bg-background"
                      value={field?.finding ?? ''}
                      onChange={(e) =>
                        setField(t, e.target.value ? { finding: e.target.value as FieldGreenUpFinding } : null)
                      }
                    >
                      <option value="">Not checked</option>
                      <option value="yes">Greened up</option>
                      <option value="no">Not greened up</option>
                      <option value="percent">Partly: share greened up</option>
                    </StyledSelect>
                  </FormField>
                  {field && (
                    <>
                      {field.finding === 'percent' && (
                        <NullableNumberField
                          label="Share greened up"
                          aria-label={`Field share greened up for ${t.name}`}
                          contentClassName={INLINE_FIELD}
                          inputClassName={cn(FORM_INPUT_CLASS, 'w-20')}
                          suffix="%"
                          min={0}
                          max={100}
                          value={field.greenedUpPercent}
                          onValueChange={(greenedUpPercent) => setField(t, { greenedUpPercent })}
                        />
                      )}
                      <FormField label="Checked on" contentClassName={INLINE_FIELD}>
                        <input
                          type="date"
                          aria-label={`Field check date for ${t.name}`}
                          className={cn(FORM_INPUT_CLASS, 'w-36')}
                          value={field.observedOn}
                          onChange={(e) => setField(t, { observedOn: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Checked by" contentClassName={INLINE_FIELD}>
                        <input
                          aria-label={`Field check observer for ${t.name}`}
                          className={cn(FORM_INPUT_CLASS, 'w-36')}
                          maxLength={FIELD_GREEN_UP_OBSERVER_MAX}
                          value={field.observedBy}
                          onChange={(e) => setField(t, { observedBy: e.target.value })}
                        />
                      </FormField>
                      <FormField label={`Field note for ${t.name}`} hideLabel>
                        <textarea
                          className={FORM_INPUT_CLASS}
                          rows={2}
                          maxLength={FIELD_GREEN_UP_NOTE_MAX}
                          placeholder="Note (stand height, stocking, photo IDs). Not a run input."
                          value={field.note ?? ''}
                          onChange={(e) => setField(t, { note: e.target.value })}
                        />
                      </FormField>
                    </>
                  )}
                  {reading.fieldIssue ? (
                    <InlineAlert tone="warning">
                      Field check not used: {reading.fieldIssue} The model applies.
                    </InlineAlert>
                  ) : (
                    <p>
                      <span className="text-muted-foreground">The run uses: </span>
                      <span className="font-medium">
                        {share(reading.greenedUpPercent)}, {reading.label}
                      </span>
                    </p>
                  )}
                </ResultRowDetail>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

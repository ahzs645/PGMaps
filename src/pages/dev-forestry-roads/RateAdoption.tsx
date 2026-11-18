import { createContext, useContext, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DisclosureRow } from '@/components/ui/disclosure'
import { CheckboxField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, OptionalNumberField, roadFieldClass } from './Controls'
import { ReferenceLink, ReferenceSelect } from './CostReferenceControls'
import {
  evidenceBasis,
  formatEvidenceAmount,
  type EvidenceCurrency,
  type EvidenceRecord,
} from './costEvidence/costEvidence'
import {
  adoptionOverlaps,
  MEASURE_BASES,
  WORK_PARTS,
  type AdoptionTarget,
  type MeasureBasis,
  type WorkPart,
} from './costEvidence/adoptionTargets'
import {
  ADOPTION_REASON_MAX,
  adoptionBasisNote,
  adoptionPrefill,
  adoptionProblems,
  adoptionRefusal,
  createAdoption,
  rateSourceLines,
  type RateAdoption,
  type RateSourceLine,
} from './costEvidence/rateAdoption'
import type { RateBuildUp } from './costEvidence/rateBuildUps'
import type { ScheduleTemplateItem } from './costSchedule'
import type { RoadProject } from './types'

export interface RateAdoptionTarget {
  project: RoadProject
  /** The project's currency: a record in it, in the rate's unit, is offered as a start. */
  currency: EvidenceCurrency
  /** Every rate a record can inform here (`adoptionTargets`). */
  targets: AdoptionTarget[]
  scheduleItems: readonly ScheduleTemplateItem[]
  /** The one write an adoption makes, from the form's Save: rate and source together. */
  onAdopt: (key: string, adoption: RateAdoption, label: string) => void
  /** Saving, editing or deleting a build-up. */
  onBuildUps?: (next: RateBuildUp[] | undefined, label: string) => void
}

/** Absent where the dialog is read-only: no record then offers an adoption. */
export const RateAdoptionContext = createContext<RateAdoptionTarget | null>(null)

export const rateValueText = (value: number | null, unit: string, currency: EvidenceCurrency = 'CAD') =>
  value === null
    ? 'not set'
    : unit === '%'
      ? `${value.toLocaleString('en-CA', { maximumFractionDigits: 4 })}%`
      : `${currency === 'CAD' ? '$' : `${currency} `}${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${unit || ' lump sum'}`

export const today = () => {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

const NOT_STATED = ''

/** The rate picker shared by records and build-ups: grouped, each with its present value. */
export function TargetSelect({
  targets,
  value,
  onChange,
  currency,
  label = 'Project rate to inform',
}: {
  targets: readonly AdoptionTarget[]
  value: string
  onChange: (key: string) => void
  currency: EvidenceCurrency
  label?: string
}) {
  return (
    <ReferenceSelect
      label={label}
      value={value}
      options={[
        { value: '', label: 'Choose a rate' },
        ...targets.map((target) => ({
          value: target.key,
          label: `${target.group} · ${target.label} · now ${rateValueText(target.value, target.unit, currency)}`,
        })),
      ]}
      onChange={onChange}
    />
  )
}

/**
 * Under an evidence record: the step that takes it into a project rate. Nothing is written until
 * Save, the rate is the user's own figure, and the record is stored beside it as it reads here,
 * with what it is measured on, what it includes, and any overlap with lines already priced.
 */
export function AdoptRecord({ record }: { record: EvidenceRecord }) {
  const target = useContext(RateAdoptionContext)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [rate, setRate] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [basis, setBasis] = useState<MeasureBasis | typeof NOT_STATED>(NOT_STATED)
  const [includes, setIncludes] = useState<WorkPart[]>([])
  const [saved, setSaved] = useState<string | null>(null)
  const chosen = target?.targets.find((item) => item.key === key) ?? null
  const overlaps = useMemo(
    () => (target && chosen ? adoptionOverlaps(target.project, chosen, includes) : []),
    [target, chosen, includes],
  )
  if (!target || adoptionRefusal(record)) return null
  const currency = target.currency
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-testid="road-rate-adopt-open"
          onClick={() => {
            setOpen(true)
            setSaved(null)
          }}
        >
          Use for a project rate
        </Button>
        {saved && (
          <span role="status" className="text-2xs leading-4 text-success" data-testid="road-rate-adopt-saved">
            {saved}
          </span>
        )}
      </div>
    )
  const observedBasis = basis || undefined
  const problems = chosen
    ? adoptionProblems({
        record,
        target: chosen,
        currency,
        rate,
        reason,
        specificationConfirmed: confirmed,
        observedBasis,
        includes,
        overlaps,
      })
    : ['Choose the project rate this record informs.']
  const existing = key
    ? rateSourceLines(target.project.rateEvidence, target.project, target.scheduleItems).find((l) => l.rateKey === key)
    : null
  const offered = chosen ? adoptionPrefill(record, chosen, currency, observedBasis) : null
  const reset = () => {
    setKey('')
    setRate(null)
    setConfirmed(false)
    setReason('')
    setBasis(NOT_STATED)
    setIncludes([])
  }
  return (
    <div className={cn(insetBox({ padding: 'lg' }), 'space-y-2')} data-testid="road-rate-adopt-form">
      <p className="text-2xs leading-4 text-muted-foreground">
        Stored beside the rate as read here, with every term above:{' '}
        <span className="font-medium text-foreground">{formatEvidenceAmount(record)}</span> · {evidenceBasis(record)}
        {record.url && (
          <>
            {' · '}
            <ReferenceLink href={record.url}>source</ReferenceLink>
          </>
        )}
        {record.locator ? ` · ${record.locator}` : ''} · checked {record.checked}
      </p>
      <TargetSelect
        targets={target.targets}
        value={key}
        currency={currency}
        onChange={(next) => {
          setKey(next)
          const t = target.targets.find((item) => item.key === next)
          // Only a single figure already in the project's currency and the rate's unit is offered.
          setRate(t ? adoptionPrefill(record, t, currency) : null)
          setConfirmed(false)
          setIncludes(t ? [...t.prices] : [])
          setBasis(NOT_STATED)
        }}
      />
      {chosen && (
        <>
          <p className="text-2xs leading-4 text-muted-foreground" data-testid="road-rate-adopt-basis">
            {adoptionBasisNote(record, chosen, currency, observedBasis)}
          </p>
          {existing && (
            <p className="text-2xs leading-4 text-warning">
              Replaces the source recorded for this rate: {existing.observed} ({existing.source}).
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ReferenceSelect
              label="The price is measured on"
              value={basis}
              options={[
                { value: NOT_STATED, label: 'Not stated by the source' },
                ...(Object.keys(MEASURE_BASES) as MeasureBasis[]).map((value) => ({
                  value,
                  label: MEASURE_BASES[value],
                })),
              ]}
              onChange={(value) => {
                const next = value as MeasureBasis | ''
                setBasis(next)
                setRate((current) => current ?? adoptionPrefill(record, chosen, currency, next || undefined))
              }}
              hint={`This rate is entered ${chosen.basisText}.`}
            />
            <fieldset className="space-y-1" data-testid="road-rate-adopt-includes">
              <legend className="text-2xs font-medium text-muted-foreground">The price includes</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {(Object.keys(WORK_PARTS) as WorkPart[]).map((part) => (
                  <label key={part} className="flex items-center gap-1 text-2xs">
                    <input
                      type="checkbox"
                      checked={includes.includes(part)}
                      onChange={(event) =>
                        setIncludes((current) =>
                          event.target.checked ? [...current, part] : current.filter((item) => item !== part),
                        )
                      }
                    />
                    {WORK_PARTS[part]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {overlaps.length > 0 && (
            <div data-testid="road-rate-adopt-overlaps">
              <InlineAlert tone="warning" title="Part of this price is already priced on another line">
                <ul className="list-disc space-y-0.5 pl-4">
                  {overlaps.map((overlap) => (
                    <li key={overlap}>{overlap}</li>
                  ))}
                </ul>
                <p className="mt-1">Lower the rate, or zero the other line, and say which in the reason.</p>
              </InlineAlert>
            </div>
          )}
          <CheckboxField
            label="The specification matches"
            description={`The record prices ${chosen.specification}. Check its scope, tax, loading and delivery terms above.`}
            checked={confirmed}
            onCheckedChange={setConfirmed}
          />
          <OptionalNumberField
            label={`Adopted rate (${chosen.unit === '%' ? '%' : `${currency}${chosen.unit || ' lump sum'}`})`}
            value={rate}
            onChange={setRate}
            updateOn="change"
            min={0}
            max={chosen.max}
            step={0.01}
            placeholder=""
            description={`${currency} ${chosen.basisText}. ${offered === null ? 'Your own figure; none is computed.' : `Starts at the record’s ${rateValueText(offered, chosen.unit, currency)}.`}`}
          />
          <Field label="Reason for any adjustment">
            <textarea
              className={roadFieldClass}
              aria-label="Reason for any adjustment"
              value={reason}
              maxLength={ADOPTION_REASON_MAX}
              rows={2}
              placeholder="Unit conversion, date, quantity, haul, overlap…"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          disabled={problems.length > 0}
          data-testid="road-rate-adopt-save"
          onClick={() => {
            if (!chosen || rate === null) return
            target.onAdopt(
              chosen.key,
              createAdoption(
                {
                  record,
                  target: chosen,
                  currency,
                  rate,
                  reason,
                  specificationConfirmed: confirmed,
                  observedBasis,
                  includes,
                  overlaps,
                },
                today(),
              ),
              chosen.label,
            )
            setSaved(
              `${chosen.label} set to ${rateValueText(rate, chosen.unit, currency)}, with this record beside it. Undo reverses both.`,
            )
            setOpen(false)
            reset()
          }}
        >
          Save rate and source
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {problems.length > 0 && (
          <span className="text-2xs leading-4 text-muted-foreground" data-testid="road-rate-adopt-problem">
            {problems[0]}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The cost dialog's record of where each adopted rate came from: the observation in its own unit,
 * currency and price year (or the build-up's formula), its frozen terms, the reason for the
 * difference, and whether the rate was edited, its target removed or its build-up changed since.
 */
export function RateSources({
  lines,
  onRemove,
}: {
  lines: readonly RateSourceLine[]
  onRemove?: (key: string, label: string) => void
}) {
  if (!lines.length) return null
  return (
    <section className="space-y-1" aria-label="Rate sources" data-testid="road-rate-sources-adopted">
      <h3 className="text-xs font-semibold text-foreground">Rate sources</h3>
      <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
        {lines.map((line) => (
          <li key={line.rateKey} className="space-y-0.5 px-3 py-2 text-2xs leading-4" data-rate-source={line.rateKey}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-xs text-foreground">
                <span className="font-medium">{line.adopted}</span> · {line.url || line.locator ? 'reference' : 'from'}{' '}
                {line.observed}
              </p>
              {onRemove && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  title="Removes this record from the project. The rate keeps its value."
                  aria-label={`Remove the source for ${line.label}`}
                  onClick={() => onRemove(line.rateKey, line.label)}
                >
                  Remove source
                </Button>
              )}
            </div>
            <p className="text-muted-foreground">
              {line.source}
              {line.url && (
                <>
                  {' · '}
                  <ReferenceLink href={line.url}>source</ReferenceLink>
                </>
              )}
              {line.locator && ` · ${line.locator}`} · adopted {line.adoptedOn}
            </p>
            {line.scope && <p className="text-muted-foreground">{line.scope}.</p>}
            <p className="text-muted-foreground">
              <span className="text-foreground">Adjustment:</span> {line.reason}
            </p>
            {line.terms.length > 0 && (
              <DisclosureRow
                title="Terms as read"
                summary={`${line.terms.length} term${line.terms.length === 1 ? '' : 's'}`}
                contentClassName="text-muted-foreground"
              >
                <ul className="list-disc pl-4">
                  {line.terms.map((term) => (
                    <li key={term}>{term}</li>
                  ))}
                </ul>
              </DisclosureRow>
            )}
            {line.overlaps.map((overlap) => (
              <p key={overlap} className="text-warning">
                Accounted overlap: {overlap}
              </p>
            ))}
            {[line.edited, line.orphaned, line.stale].filter(Boolean).map((note) => (
              <p key={note} className="text-warning" data-testid="road-rate-source-note">
                {note}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

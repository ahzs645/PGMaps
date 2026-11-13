import { createContext, useContext, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckboxField } from '@/components/ui/form-field'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, OptionalNumberField, roadFieldClass } from './Controls'
import { ReferenceLink, ReferenceSelect } from './CostReferenceControls'
import { evidenceBasis, formatEvidenceAmount, type EvidenceRecord } from './costEvidence/costEvidence'
import {
  ADOPTABLE_RATES,
  ADOPTABLE_RATE_KEYS,
  ADOPTED_RATE_MAX,
  ADOPTION_REASON_MAX,
  adoptionBasisNote,
  adoptionPrefill,
  adoptionProblems,
  adoptionRefusal,
  createAdoption,
  rateSourceLines,
  type AdoptableRateKey,
  type RateAdoption,
  type RateEvidence,
} from './costEvidence/rateAdoption'

export interface RateAdoptionTarget {
  rates: Record<AdoptableRateKey, number>
  rateEvidence: RateEvidence | undefined
  /** The one write the references dialog can make, and only from the form's Save. */
  onAdopt: (rateKey: AdoptableRateKey, adoption: RateAdoption) => void
}

/** Absent where the dialog is read-only: no record then offers an adoption. */
export const RateAdoptionContext = createContext<RateAdoptionTarget | null>(null)

const rateText = (value: number, unit: string) =>
  `$${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${unit}`

const today = () => {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

/**
 * Under an evidence record: the step that takes it into a project rate. Nothing is written until
 * Save, the rate is the user's own figure, and the record is stored beside it as it reads here.
 */
export function AdoptRecord({ record }: { record: EvidenceRecord }) {
  const target = useContext(RateAdoptionContext)
  const [open, setOpen] = useState(false)
  const [rateKey, setRateKey] = useState<AdoptableRateKey | ''>('')
  const [rate, setRate] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  if (!target || adoptionRefusal(record)) return null
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
  const chosen = rateKey ? ADOPTABLE_RATES[rateKey] : null
  const problems = rateKey
    ? adoptionProblems({ record, rateKey, rate, reason, specificationConfirmed: confirmed })
    : ['Choose the project rate this record informs.']
  const existing = rateKey
    ? rateSourceLines(target.rateEvidence, target.rates).find((l) => l.rateKey === rateKey)
    : null
  const offered = rateKey ? adoptionPrefill(record, rateKey) : null
  return (
    <div className={cn(insetBox({ padding: 'lg' }), 'space-y-2')} data-testid="road-rate-adopt-form">
      <p className="text-2xs leading-4 text-muted-foreground">
        Stored beside the rate as read here:{' '}
        <span className="font-medium text-foreground">{formatEvidenceAmount(record)}</span> · {evidenceBasis(record)} ·{' '}
        <ReferenceLink href={record.url}>source</ReferenceLink>
        {record.locator ? ` · ${record.locator}` : ''} · checked {record.checked}
      </p>
      <ReferenceSelect
        label="Project rate to inform"
        value={rateKey}
        options={[
          { value: '', label: 'Choose a rate' },
          ...ADOPTABLE_RATE_KEYS.map((key) => ({
            value: key,
            label: `${ADOPTABLE_RATES[key].label} · now ${rateText(target.rates[key], ADOPTABLE_RATES[key].unit)}`,
          })),
        ]}
        onChange={(value) => {
          const next = value as AdoptableRateKey | ''
          setRateKey(next)
          // Only a single CAD figure already in the rate's unit is offered; otherwise the field is empty.
          setRate(next ? adoptionPrefill(record, next) : null)
          setConfirmed(false)
        }}
      />
      {rateKey && chosen && (
        <>
          <p className="text-2xs leading-4 text-muted-foreground" data-testid="road-rate-adopt-basis">
            {adoptionBasisNote(record, rateKey)}
          </p>
          {existing && (
            <p className="text-2xs leading-4 text-warning">
              Replaces the source recorded for this rate: {existing.observed} ({existing.source}).
            </p>
          )}
          <CheckboxField
            label="The specification matches"
            description={`The record prices ${chosen.specification}. Check its scope, tax, loading and delivery terms above.`}
            checked={confirmed}
            onCheckedChange={setConfirmed}
          />
          <OptionalNumberField
            label={`Adopted rate (CAD${chosen.unit})`}
            value={rate}
            onChange={setRate}
            updateOn="change"
            min={0}
            max={ADOPTED_RATE_MAX}
            step={0.01}
            placeholder=""
            description={`${chosen.basis}. ${offered === null ? 'Your own figure; none is computed.' : `Starts at the record’s ${rateText(offered, chosen.unit)}.`}`}
          />
          <Field label="Reason for any adjustment">
            <textarea
              className={roadFieldClass}
              aria-label="Reason for any adjustment"
              value={reason}
              maxLength={ADOPTION_REASON_MAX}
              rows={2}
              placeholder="Unit conversion, date, quantity, haul…"
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
            if (!rateKey || rate === null) return
            target.onAdopt(
              rateKey,
              createAdoption({ record, rateKey, rate, reason, specificationConfirmed: confirmed }, today()),
            )
            setSaved(
              `${ADOPTABLE_RATES[rateKey].label} set to ${rateText(rate, ADOPTABLE_RATES[rateKey].unit)}, with this record beside it. Undo reverses both.`,
            )
            setOpen(false)
            setRateKey('')
            setRate(null)
            setConfirmed(false)
            setReason('')
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
 * currency and price year, the reason for the difference, and whether the rate was edited since.
 */
export function RateSources({
  rates,
  rateEvidence,
  onRemove,
}: {
  rates: Record<AdoptableRateKey, number>
  rateEvidence: RateEvidence | undefined
  onRemove?: (rateKey: AdoptableRateKey) => void
}) {
  const lines = rateSourceLines(rateEvidence, rates)
  if (!lines.length) return null
  return (
    <section className="space-y-1" aria-label="Rate sources" data-testid="road-rate-sources-adopted">
      <h3 className="text-xs font-semibold text-foreground">Rate sources</h3>
      <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
        {lines.map((line) => (
          <li key={line.rateKey} className="space-y-0.5 px-3 py-2 text-2xs leading-4" data-rate-source={line.rateKey}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-xs text-foreground">
                <span className="font-medium">{line.adopted}</span> · reference {line.observed}
              </p>
              {onRemove && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  title="Removes this record from the project. The rate keeps its value."
                  aria-label={`Remove the source for ${ADOPTABLE_RATES[line.rateKey].label}`}
                  onClick={() => onRemove(line.rateKey)}
                >
                  Remove source
                </Button>
              )}
            </div>
            <p className="text-muted-foreground">
              {line.source} · <ReferenceLink href={line.url}>source</ReferenceLink> · {line.locator} · adopted{' '}
              {line.adoptedOn}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Adjustment:</span> {line.reason}
            </p>
            {line.edited && <p className="text-warning">{line.edited}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

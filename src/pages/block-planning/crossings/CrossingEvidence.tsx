import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import type { Pack, Scalar } from '../../../../packages/legal-rules/src/contract'
import { addCrossingSighting, removeCrossingSighting, applyCrossingOffer } from '../edits'
import type { Plan } from '../plan'
import { evidenceKindLabel, factOffers, heldAnswer, type FactOffer } from './candidates'
import {
  builtAfter1995,
  datingBracket,
  SIGHTING_SOURCE_LABELS,
  SIGHTING_SOURCES,
  SIGHTING_STATES,
  type CrossingSighting,
  type SightingSource,
  type SightingState,
} from './dating'
import { CROSSING_ALIAS_LABELS } from './key'
import type { CrossingRecord } from './record'

const metres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

const valueText = (v: Scalar | undefined) =>
  v === true ? 'Yes' : v === false ? 'No' : v === undefined || v === null ? 'Not answered' : String(v)

/** What the crossing's records offer for its answers: each used only on the reviewer's click. */
function Offers({
  plan,
  record,
  library,
  edit,
  keepPacks,
}: {
  plan: Plan
  record: CrossingRecord
  library: Pack[]
  edit: (change: (plan: Plan) => Plan) => void
  keepPacks: (plan: Plan) => Plan
}) {
  const [error, setError] = useState<string | null>(null)
  const offers = factOffers(record)
  if (!offers.length) return null
  const label = (offer: FactOffer) =>
    library
      .filter((p) => p.id === offer.pack)
      .flatMap((p) => p.facts.filter((f) => f.id === offer.fact).map((f) => f.label))[0] ?? offer.fact
  const use = (offer: FactOffer) => {
    const tried = applyCrossingOffer(plan, library, record.key, offer)
    setError('error' in tried ? tried.error : null)
    if ('error' in tried) return
    edit((p) => {
      const result = applyCrossingOffer(p, library, record.key, offer)
      return 'error' in result ? p : keepPacks(result.plan)
    })
  }
  return (
    <div className="space-y-1" data-testid="crossing-offers">
      <p className="text-xs font-medium">Offered for the answers</p>
      <p className="text-2xs text-muted-foreground">
        What the records above suggest. None answers a question until you use it, and using one keeps what it rests on
        as the answer’s evidence.
      </p>
      <ul className="space-y-1 text-2xs">
        {offers.map((offer) => {
          const held = heldAnswer(record.review, library, offer)
          const same = held !== undefined && held === offer.value
          return (
            <li
              key={`${offer.pack}:${offer.fact}`}
              className="flex items-start justify-between gap-2"
              data-offer={offer.fact}
            >
              <span>
                <span className="font-medium">{label(offer)}</span>: {valueText(offer.value)}
                <span className="block text-muted-foreground">{offer.basis}</span>
                {held !== undefined && !same && (
                  <span className="block text-muted-foreground">Answered {valueText(held)} now.</span>
                )}
              </span>
              {same ? (
                <span className="shrink-0 text-muted-foreground">Answered</span>
              ) : (
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => use(offer)}>
                  Use
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {error && <InlineAlert tone="warning">{error}</InlineAlert>}
    </div>
  )
}

/** The dated sightings, the bracket they give, and a form to add one. */
function Dating({ record, edit }: { record: CrossingRecord; edit: (change: (plan: Plan) => Plan) => void }) {
  const sightings = record.sightings ?? []
  const bracket = datingBracket(sightings)
  const candidate = builtAfter1995(sightings)
  const [source, setSource] = useState<SightingSource>('air-photo')
  const [state, setState] = useState<SightingState>('present')
  const [date, setDate] = useState('')
  const [reference, setReference] = useState('')
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return
    const sighting: CrossingSighting = { source, date, state }
    if (reference.trim()) sighting.reference = reference.trim()
    edit((p) => addCrossingSighting(p, record.key, sighting))
    setDate('')
    setReference('')
  }
  return (
    <div className="space-y-1" data-testid="crossing-dating">
      <p className="text-xs font-medium">When it was built</p>
      <p className="text-2xs" data-testid="crossing-bracket">
        {bracket.text}
      </p>
      <p className="text-2xs text-muted-foreground">
        After 15 June 1995 (FPPR §56(2)): {candidate.value === null ? 'cannot say' : candidate.value ? 'Yes' : 'No'}.{' '}
        {candidate.reason} {candidate.replaced}
      </p>
      {bracket.contradictions.length > 0 && (
        <p className="text-2xs text-warning">
          Not seen after it was first seen: {bracket.contradictions.map((s) => s.date).join(', ')}. A removal, a
          replacement or a misreading; check those pictures.
        </p>
      )}
      {sightings.length > 0 && (
        <ul className="space-y-0.5 text-2xs">
          {sightings.map((s, i) => (
            <li
              key={`${s.source}-${s.date}-${s.state}-${s.reference ?? ''}`}
              className="flex items-center justify-between gap-2"
            >
              <span>
                {s.date} · {SIGHTING_SOURCE_LABELS[s.source]} · {s.state}
                {s.reference ? ` · ${s.reference}` : ''}
                {s.by === 'read' ? ' · read' : ''}
                {s.note && <span className="block text-muted-foreground">{s.note}</span>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove the sighting of ${s.date}`}
                onClick={() => edit((p) => removeCrossingSighting(p, record.key, i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid grid-cols-2 items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <FormField label="Seen on" group>
          <StyledSelect
            aria-label="Sighting source"
            value={source}
            options={SIGHTING_SOURCES.map((s) => ({ value: s, label: SIGHTING_SOURCE_LABELS[s] }))}
            onValueChange={(v) => setSource(v as SightingSource)}
          />
        </FormField>
        <FormField label="The crossing was" group>
          <StyledSelect
            aria-label="Sighting state"
            value={state}
            options={SIGHTING_STATES.map((s) => ({
              value: s,
              label: s === 'present' ? 'There' : s === 'absent' ? 'Not there' : 'Cannot tell',
            }))}
            onValueChange={(v) => setState(v as SightingState)}
          />
        </FormField>
        <FormField label="Date of the picture or visit">
          <input
            type="date"
            className={FORM_INPUT_CLASS}
            value={date}
            max={today()}
            aria-label="Sighting date"
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
        <FormField label="Frame, scene or reference">
          <input
            className={FORM_INPUT_CLASS}
            value={reference}
            maxLength={200}
            aria-label="Sighting reference"
            onChange={(e) => setReference(e.target.value)}
          />
        </FormField>
        <Button size="sm" type="submit" variant="outline" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}>
          Add sighting
        </Button>
      </form>
    </div>
  )
}

/**
 * What was read about one crossing: the ids sources give it, each record with its source, date and
 * distance, what those records offer for its answers, and the sightings that date it.
 */
export function CrossingEvidencePanel({
  plan,
  record,
  library,
  edit,
  keepPacks,
}: {
  plan: Plan
  record: CrossingRecord
  library: Pack[]
  edit: (change: (plan: Plan) => Plan) => void
  keepPacks: (plan: Plan) => Plan
}) {
  const aliases = record.aliases ?? []
  return (
    <div className="space-y-3">
      {aliases.length > 0 && (
        <div className="space-y-0.5" data-testid="crossing-aliases">
          <p className="text-xs font-medium">Seen by</p>
          <ul className="text-2xs">
            {aliases.map((a) => (
              <li key={`${a.source}:${a.id}`}>
                {CROSSING_ALIAS_LABELS[a.source]} {a.id} <span className="text-muted-foreground">({a.seenOn})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-medium">Evidence</p>
        <p className="text-2xs text-muted-foreground" data-testid="crossing-evidence">
          {record.evidence.length
            ? `${record.evidence.length} record${record.evidence.length === 1 ? '' : 's'} read`
            : 'None read for this crossing yet. Records read later (PSCIS assessments, fish observations, Water Act notices, the designer’s sizing) are candidates beside the answers, never the answers.'}
        </p>
        {record.evidence.length > 0 && (
          <ul className="space-y-1 text-2xs" data-testid="crossing-evidence-list">
            {record.evidence.map((e, i) => (
              <li key={i} data-kind={e.kind}>
                <span className="font-medium">{evidenceKindLabel(e.kind)}</span>
                {e.date ? ` · ${e.date}` : ''}
                {e.distanceM !== undefined ? ` · ${metres.format(e.distanceM)} m away` : ''}: {e.summary}{' '}
                <span className="text-muted-foreground">
                  ({e.source}, read {e.readOn})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Offers plan={plan} record={record} library={library} edit={edit} keepPacks={keepPacks} />
      <Dating record={record} edit={edit} />
    </div>
  )
}

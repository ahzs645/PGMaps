import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { setRecordIds } from '../edits'
import type { Block, Plan } from '../plan'
import { groundFootprint, groundReadCurrent, groundReadOf } from '../ground/record'
import { bctsPlanOf, CHANNEL_CATALOGUE } from './channels'
import {
  fspHistory,
  readFspAmendments,
  readFspUnits,
  readStandardsRegimes,
  unitsFromGroundRead,
  type FspUnit,
  type StandardsRegime,
} from './fsp'
import { FSP_BASES, FSP_BASIS_LABELS, recordIdsOf, type FspBasis } from './record'
import { localToday } from './RecordsSection'

type Edit = (change: (plan: Plan) => Plan) => void
type Read<T> =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'failed'; error: string }
  | { status: 'read'; value: T }

const failure = (e: unknown) => (e instanceof Error ? e.message : 'The read failed.')
const fetchOf = (url: string, init?: RequestInit) => fetch(url, init)

/**
 * Review → *Forest stewardship plan*: which plan a block's permit relied on, as far as public data
 * names it, and the plan the reviewer states. The units over the block come from the ground
 * screen's reader (or a ground read already kept); each plan's amendments as the layer holds them,
 * with the first held, the numbers it skips and the one approved by the permit's issue date as a
 * candidate; the opening's stocking standard ids, to find in the plan's tables. Reads are on click
 * and for the session; only what the reviewer states is kept. The amendment's text is asked for
 * under *Records to get*.
 */
export function FspPanel({ plan, edit, block, schedule }: { plan: Plan; edit: Edit; block: Block; schedule: string }) {
  const ids = recordIdsOf(plan, block.id)
  const ground = groundReadOf(plan, block.id, schedule)
  const fromGround = ground && groundReadCurrent(plan, ground) ? unitsFromGroundRead(ground) : null
  const [units, setUnits] = useState<Read<FspUnit[]>>({ status: 'idle' })
  const [rows, setRows] = useState<Read<Record<string, unknown>[]>>({ status: 'idle' })
  const [standards, setStandards] = useState<Read<StandardsRegime[]>>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const shownUnits = units.status === 'read' ? units.value : fromGround
  const fspIds = [...new Set([...(shownUnits ?? []).map((u) => u.fspId), ...(ids.fsp ? [ids.fsp.id] : [])])]

  const begin = () => {
    abort.current?.abort()
    abort.current = new AbortController()
    return abort.current.signal
  }
  const readUnits = async () => {
    const signal = begin()
    setUnits({ status: 'reading' })
    try {
      const { shape } = groundFootprint(plan, block, schedule)
      const { units: value } = await readFspUnits({ footprint: shape.geometry, fetch: fetchOf, signal })
      if (!signal.aborted) setUnits({ status: 'read', value })
    } catch (e) {
      if (!signal.aborted) setUnits({ status: 'failed', error: failure(e) })
    }
  }
  const readAmendments = async () => {
    const signal = begin()
    setRows({ status: 'reading' })
    try {
      const { rows: value } = await readFspAmendments({ fspIds, fetch: fetchOf, signal })
      if (!signal.aborted) setRows({ status: 'read', value })
    } catch (e) {
      if (!signal.aborted) setRows({ status: 'failed', error: failure(e) })
    }
  }
  const readStandards = async () => {
    if (!ids.opening) return
    const signal = begin()
    setStandards({ status: 'reading' })
    try {
      const value = await readStandardsRegimes({ opening: ids.opening, fetch: fetchOf, signal })
      if (!signal.aborted) setStandards({ status: 'read', value })
    } catch (e) {
      if (!signal.aborted) setStandards({ status: 'failed', error: failure(e) })
    }
  }

  const [draft, setDraft] = useState({
    id: ids.fsp?.id ?? '',
    amendment: ids.fsp?.amendment ?? '',
    basis: (ids.fsp?.basis ?? 'fdu-layer') as FspBasis,
    note: ids.fsp?.note ?? '',
  })
  const fsp = CHANNEL_CATALOGUE.fsp

  return (
    <div className="space-y-3 text-xs" data-testid="block-planning-fsp">
      <p className="text-2xs text-muted-foreground">
        Which forest stewardship plan the block&apos;s permit relied on, and its amendment then. Public data can name
        the plan; it rarely names the amendment in force on a date, which only the plan&apos;s records hold. Nothing
        here decides either: the plan you state below is your record.
      </p>

      <div className="space-y-1.5">
        <p className="font-medium">Plans over this block</p>
        {shownUnits ? (
          shownUnits.length ? (
            <ul className="space-y-0.5" data-testid="fsp-units">
              {shownUnits.map((u) => (
                <li key={`${u.fspId}|${u.fduId}|${u.status}`}>
                  FSP {u.fspId}
                  {u.fduId ? ` · FDU ${u.fduId}` : ''}
                  {u.amendment ? ` · amendment ${u.amendment}` : ''}
                  {u.status ? ` · ${u.status.toLowerCase()}` : ''}
                  {bctsPlanOf(u.fspId) && (
                    <>
                      {' · '}
                      <a className="underline" href={bctsPlanOf(u.fspId)!.url} target="_blank" rel="noreferrer">
                        {bctsPlanOf(u.fspId)!.label}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No forest development unit is mapped over this block shape.</p>
          )
        ) : null}
        <p className="text-2xs text-muted-foreground">
          {units.status !== 'read' && fromGround ? `From On this ground, read ${ground!.readOn}. ` : ''}
          The layer names no holder (no name is read), lists at most five licences, and shows current units: a permit
          may have relied on an earlier plan.
        </p>
        <Button size="sm" variant="outline" disabled={units.status === 'reading'} onClick={() => void readUnits()}>
          {units.status === 'reading'
            ? 'Reading…'
            : shownUnits
              ? 'Read the units again'
              : 'Read the units over this block'}
        </Button>
        {units.status === 'failed' && <InlineAlert tone="error">Not read: {units.error}</InlineAlert>}
      </div>

      {fspIds.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-medium">Amendments, as the layer holds them</p>
          <Button
            size="sm"
            variant="outline"
            disabled={rows.status === 'reading'}
            onClick={() => void readAmendments()}
          >
            {rows.status === 'reading' ? 'Reading…' : `Read the amendments of FSP ${fspIds.join(', ')}`}
          </Button>
          {rows.status === 'failed' && <InlineAlert tone="error">Not read: {rows.error}</InlineAlert>}
          {rows.status === 'read' &&
            fspIds.map((id) => {
              const h = fspHistory(id, rows.value, ids.permitIssued)
              return (
                <div key={id} className="space-y-1 rounded-md border p-2" data-testid={`fsp-history-${id}`}>
                  <p className="font-medium">FSP {id}</p>
                  {h.amendments.length ? (
                    <ul className="space-y-0.5">
                      {h.amendments.map((a) => (
                        <li key={a.number}>
                          Amendment {a.number} · {a.status.toLowerCase()}
                          {a.approved ? ` · approved ${a.approved}` : a.decided ? ` · decided ${a.decided}` : ''}
                          {h.atIssue?.number === a.number && (
                            <Badge tone="info" size="sm" className="ml-1.5">
                              Latest approved by {ids.permitIssued}
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">The layer holds no amendment of this plan.</p>
                  )}
                  {h.firstHeld !== undefined && (
                    <p className="text-warning">
                      The layer holds nothing before amendment {h.firstHeld}: earlier amendments are not in it.
                    </p>
                  )}
                  {h.skipped.length > 0 && (
                    <p className="text-warning">The layer skips amendment {h.skipped.join(', ')}.</p>
                  )}
                  <p className="text-2xs text-muted-foreground">
                    {ids.permitIssued
                      ? 'The amendment approved by the permit’s issue date is a candidate only: the layer misses amendments, and one approved may not yet have taken effect.'
                      : 'State when the cutting permit was issued (Records to get → Identifiers) to see which amendment the layer puts before it.'}
                  </p>
                </div>
              )
            })}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="font-medium">The opening&apos;s stocking standards</p>
        {ids.opening ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={standards.status === 'reading'}
              onClick={() => void readStandards()}
            >
              {standards.status === 'reading' ? 'Reading…' : `Read opening ${ids.opening}'s standards from RESULTS`}
            </Button>
            {standards.status === 'failed' && <InlineAlert tone="error">Not read: {standards.error}</InlineAlert>}
            {standards.status === 'read' &&
              (standards.value.length ? (
                <ul className="space-y-0.5" data-testid="fsp-standards">
                  {standards.value.map((s) => (
                    <li key={`${s.unit}|${s.regime}`}>
                      Standards unit {s.unit}: regime id <span className="font-medium">{s.regime}</span>
                      {s.variance ? ' · under an approved variation' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">RESULTS lists no standards regime for this opening.</p>
              ))}
            <p className="text-2xs text-muted-foreground">{fsp.standardsNote}</p>
          </>
        ) : (
          <p className="text-2xs text-muted-foreground">
            Enter the RESULTS opening id under Records to get → Identifiers to read its stocking standard ids.
          </p>
        )}
      </div>

      <div className="space-y-0.5 text-2xs text-muted-foreground">
        <p>
          BC Timber Sales posts each business area&apos;s current plan:{' '}
          <a className="underline" href={fsp.bctsIndex.url} target="_blank" rel="noreferrer">
            {fsp.bctsIndex.label}
          </a>
          .
        </p>
        <p>
          For a block since 2022:{' '}
          <a className="underline" href={fsp.fom.url} target="_blank" rel="noreferrer">
            {fsp.fom.label}
          </a>
          . {fsp.fom.note}
        </p>
      </div>

      <div className="space-y-1.5 rounded-md border p-2" data-testid="fsp-statement">
        <p className="font-medium">The plan the permit relied on, as you identify it</p>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="FSP id">
            <input
              className={FORM_INPUT_CLASS}
              aria-label="FSP id"
              inputMode="numeric"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            />
          </FormField>
          <FormField label="Amendment">
            <input
              className={FORM_INPUT_CLASS}
              aria-label="FSP amendment"
              inputMode="numeric"
              value={draft.amendment}
              onChange={(e) => setDraft({ ...draft, amendment: e.target.value })}
            />
          </FormField>
          <FormField label="Identified by" group className="col-span-2">
            <StyledSelect
              aria-label="How the plan was identified"
              value={draft.basis}
              options={FSP_BASES.map((b) => ({ value: b, label: FSP_BASIS_LABELS[b] }))}
              onValueChange={(basis) => setDraft({ ...draft, basis: basis as FspBasis })}
            />
          </FormField>
          <FormField label="Note" className="col-span-2">
            <input
              className={FORM_INPUT_CLASS}
              aria-label="FSP note"
              maxLength={2000}
              value={draft.note}
              placeholder="Where you found it: the page, the table, the letter"
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!/^\d{1,7}$/.test(draft.id.trim().replace(/^#/, ''))}
            onClick={() =>
              edit((p) =>
                setRecordIds(p, block.id, {
                  fsp: {
                    id: draft.id.trim().replace(/^#/, ''),
                    amendment: draft.amendment.trim() || undefined,
                    basis: draft.basis,
                    note: draft.note,
                    statedOn: localToday(),
                  },
                }),
              )
            }
          >
            Keep this
          </Button>
          {ids.fsp && (
            <>
              <span className="text-muted-foreground">
                Stated {ids.fsp.statedOn}: FSP {ids.fsp.id}
                {ids.fsp.amendment ? `, amendment ${ids.fsp.amendment}` : ', amendment not stated'} ·{' '}
                {FSP_BASIS_LABELS[ids.fsp.basis]}
              </span>
              <Button size="sm" variant="outline" onClick={() => edit((p) => setRecordIds(p, block.id, { fsp: null }))}>
                Clear
              </Button>
            </>
          )}
        </div>
        <p className="text-2xs text-muted-foreground">
          The amendment&apos;s text and its approval letter, as at the permit&apos;s date, are asked for under Records
          to get (Forest stewardship plan and amendment in force).
        </p>
      </div>
    </div>
  )
}

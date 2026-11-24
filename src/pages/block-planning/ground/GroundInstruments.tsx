import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CalculationTable } from '@/components/ui/calculation-results'
import { CopyButton } from '@/components/ui/copy-button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  BINDS_LABELS,
  groundInstrument,
  groundLayer,
  REACH_LABELS,
  type GroundInstrument,
  type ReachCell,
} from '@/lib/legal/groundInstruments'
import type { Pack } from '../../../../packages/legal-rules/src/contract'
import type { Block, Plan } from '../plan'
import type { StepProps } from '../steps/types'
import type { GroundStage } from './groundRead'
import { precedentSummary } from './precedent'
import {
  failedByReason,
  groundFootprint,
  groundReadCurrent,
  groundReadOf,
  saveGroundRead,
  type GroundRead,
} from './record'
import { documentRequests } from './requests'
import { exceptionsToRequest, wildlifeCitesText, wildlifeRows, withheldRequests } from './wildlifeMeasures'

type State = { status: 'idle' } | { status: 'reading'; stage: string } | { status: 'failed'; error: string }

const today = () => new Date().toISOString().slice(0, 10)
const ha = (v: number) => (v > 0 && v < 0.01 ? '<0.01' : v.toFixed(2))

/** A reach cell: its state word, with the note and the provisions behind it. */
function Cell({ cell, what }: { cell: ReachCell; what: string }) {
  return (
    <InfoTip label={REACH_LABELS[cell.state]} showLabel bubbleClassName="w-80">
      <span className="block font-medium">{what}</span>
      <span className="block">{cell.note}</span>
      <span className="mt-1 block text-muted-foreground">Rests on: {wildlifeCitesText(cell.cites)}</span>
    </InfoTip>
  )
}

const stageText = (stage: GroundStage) =>
  stage.kind === 'layer' ? `Reading ${stage.layer.title.toLowerCase()}…` : `Reading RESULTS precedent: ${stage.step}…`

/**
 * Step 5's "On this ground": on the reviewer's click, every instrument the catalogue lists read on
 * the block shape under review, kept with the plan (`Plan.groundReads`) with the footprint it was
 * read for. For each instrument found: what it can reach for harvest, replanting, roads and grazing,
 * how it binds, whether its terms are public, what RESULTS shows was done inside it nearby, and the
 * documents to ask for. A screen, never a legal determination; it answers no review fact.
 */
export function GroundInstruments({
  plan,
  edit,
  block,
  schedule,
  library,
}: {
  plan: Plan
  edit: StepProps['edit']
  block: Block
  schedule: string
  library: Pack[]
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const read = groundReadOf(plan, block.id, schedule)
  const current = Boolean(read && groundReadCurrent(plan, read))
  const factLabel = (pack: string, fact: string) =>
    library.find((p) => p.id === pack)?.facts.find((f) => f.id === fact)?.label

  async function run() {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const { shape, signature } = groundFootprint(plan, block, schedule)
    setState({ status: 'reading', stage: 'Starting the read…' })
    try {
      const { groundOverlay } = await import('../oldForest/oldForest')
      const { readGroundInstruments } = await import('./groundRead')
      const result = await readGroundInstruments({
        footprint: shape.geometry,
        block: block.id,
        schedule,
        shape: shape.id,
        signature,
        fetch: (url, init) => fetch(url, init),
        signal: controller.signal,
        overlay: groundOverlay,
        readOn: today(),
        onProgress: (stage) => setState({ status: 'reading', stage: stageText(stage) }),
      })
      if (controller.signal.aborted) return
      // The block was redrawn during the read: `saveGroundRead` refuses an answer for other ground.
      edit((p) => saveGroundRead(p, result))
      setState({ status: 'idle' })
    } catch (e) {
      if (controller.signal.aborted) return setState({ status: 'idle' })
      setState({ status: 'failed', error: e instanceof Error ? e.message : 'The read failed.' })
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }

  const found = (read?.instruments ?? []).flatMap((r) => {
    const instrument = groundInstrument(r.instrument)
    return instrument && r.features.length ? [{ read: r, instrument }] : []
  })
  const empty = (read?.instruments ?? []).filter((r) => r.status !== 'failed' && !r.features.length)
  const failed = (read?.instruments ?? []).filter((r) => r.status === 'failed')
  const truncated = (read?.instruments ?? []).filter((r) => r.status === 'truncated')
  const label = (id: string) => groundInstrument(id)?.label ?? id
  const requests = read
    ? [...documentRequests(read, block.name), ...withheldRequests(read, groundInstrument, block.name)]
    : []
  const exceptions = read ? exceptionsToRequest(read, groundInstrument) : []
  // A range or habitat area whose order was read answers from the order, one row per order and answer.
  const matrix = found.flatMap((r) => {
    const own = wildlifeRows(r.instrument, r.read)
    const share = (v: number) => (read && read.footprintHa > 0 ? (v / read.footprintHa) * 100 : 0)
    if (!own)
      return [
        {
          key: r.instrument.id,
          instrument: r.instrument,
          title: r.instrument.label,
          sub: `${ha(r.read.coveredHa)} ha · ${share(r.read.coveredHa).toFixed(1)}% of the block`,
          reach: r.instrument.reach,
          binds: r.instrument.binds,
        },
      ]
    return own.map((w) => ({
      key: w.key,
      instrument: r.instrument,
      title: `${r.instrument.label} · ${w.label}`,
      sub: `${w.features.map((f) => f.id).join(', ')} · ${ha(w.overlapHa)} ha · ${share(w.overlapHa).toFixed(1)}% of the block${w.status === 'read' ? ' · order read' : ''}`,
      reach: w.reach,
      binds: w.binds,
    }))
  })
  const precedent = read?.precedent
  const inside = (openingId: number) =>
    (precedent?.rows ?? []).filter((r) => r.openings.includes(openingId)).map((r) => label(r.instrument))

  return (
    <div className="space-y-3" data-testid="block-planning-ground">
      <p className="text-2xs text-muted-foreground">
        Reads the legal instruments DataBC maps on this block shape: Land Act reserves, withdrawals, designated use
        areas, leases, licences and rights of way; the Agricultural Land Reserve; legal land use objectives and OGMAs;
        ungulate winter ranges and wildlife habitat areas; range tenures; parks, ecological reserves and protected
        areas; private parcels; and community watersheds. For each one found it shows what it can reach for harvest,
        replanting, roads and grazing, with the provision each answer rests on. This is a screen, never a legal
        determination: it decides no fact, and an instrument that is not mapped can still apply.
      </p>
      {state.status === 'reading' ? (
        <div className="flex items-center gap-2">
          <InlineAlert loading>{state.stage}</InlineAlert>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              abort.current?.abort()
              abort.current = null
              setState({ status: 'idle' })
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void run()}>
          {read ? 'Read this ground again' : 'Read the instruments on this ground'}
        </Button>
      )}
      {state.status === 'failed' && <InlineAlert tone="error">{state.error}</InlineAlert>}
      {read && !current && (
        <InlineAlert tone="warning">
          The block shape changed since this read ({read.readOn}). Read it again before relying on it.
        </InlineAlert>
      )}
      {read && (
        <>
          {found.length ? (
            <CalculationTable
              caption={`What each instrument can reach · read ${read.readOn} · ${ha(read.footprintHa)} ha footprint`}
              rows={matrix}
              rowKey={(r) => r.key}
              columns={[
                {
                  label: 'Instrument',
                  render: (r) => (
                    <>
                      <span className="block">{r.title}</span>
                      <span className="block font-normal text-muted-foreground">{r.sub}</span>
                    </>
                  ),
                },
                ...ACTIVITIES.map((a) => ({
                  label: ACTIVITY_LABELS[a],
                  render: (r: (typeof matrix)[number]) => (
                    <Cell cell={r.reach[a]} what={`${r.title}: ${ACTIVITY_LABELS[a]}`} />
                  ),
                })),
                {
                  label: 'Binds',
                  render: (r) => (
                    <InfoTip label={BINDS_LABELS[r.binds.kind]} showLabel bubbleClassName="w-80">
                      <span className="block">{r.binds.note}</span>
                      <span className="mt-1 block text-muted-foreground">
                        Rests on: {wildlifeCitesText(r.binds.cites)}
                      </span>
                    </InfoTip>
                  ),
                },
                {
                  label: 'Terms public',
                  render: (r) => (
                    <InfoTip label={r.instrument.terms.public ? 'Yes' : 'No'} showLabel>
                      {r.instrument.terms.where}.
                    </InfoTip>
                  ),
                },
              ]}
            />
          ) : (
            <p className="text-xs">
              None of the instruments read is mapped on this footprint
              {failed.length ? ', but some layers were not read (below)' : ''}. That is what the layers hold, not
              evidence that nothing applies.
            </p>
          )}
          {found.some((r) => r.instrument.note) && (
            <p className="text-2xs text-muted-foreground">
              {found.flatMap((r) => (r.instrument.note ? [r.instrument.note] : [])).join(' ')}
            </p>
          )}
          {failedByReason(failed).map(({ reason, ids }) => (
            <InlineAlert key={reason} tone="warning">
              <span className="[overflow-wrap:anywhere]">
                Not read: {ids.map(label).join(', ')}. {reason}
              </span>
            </InlineAlert>
          ))}
          {truncated.length > 0 && (
            <InlineAlert tone="warning">
              Incomplete: {truncated.map((r) => label(r.instrument)).join(', ')}. {truncated[0].message}
            </InlineAlert>
          )}
          {empty.length > 0 && (
            <p className="text-2xs text-muted-foreground">
              Read, nothing mapped on the footprint: {empty.map((r) => label(r.instrument)).join(', ')}.
            </p>
          )}
          {found.length > 0 && (
            <CalculationTable
              caption="Mapped on the block, as DataBC names it"
              rows={found.flatMap((r) => r.read.features.map((f) => ({ f, instrument: r.instrument })))}
              rowKey={(x) => `${x.instrument.id}:${x.f.id}:${x.f.name}`}
              columns={[
                { label: 'Feature', render: (x) => x.f.id },
                { label: 'Instrument', render: (x) => x.instrument.label },
                { label: 'As DataBC names it', render: (x) => x.f.name },
                { label: 'Overlap', render: (x) => `${ha(x.f.overlapHa)} ha · ${x.f.sharePercent.toFixed(1)}%` },
                { label: 'Details', render: (x) => x.f.details.join(' · ') },
              ]}
            />
          )}
          {found.length > 0 && <Precedent read={read} found={found} inside={inside} />}
          {requests.length > 0 && (
            <div className="space-y-2" data-testid="block-planning-ground-requests">
              <p className="text-xs font-medium">Documents to request</p>
              <p className="text-2xs text-muted-foreground">
                Drafts for the instruments whose terms are not public. Nothing is sent from here, and no holder is
                named: ask through the channel each one gives.
              </p>
              {requests.map((r) => (
                <div key={r.instrument} className="space-y-1 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">{r.label}</p>
                    <CopyButton
                      text={r.text}
                      title="Copy the request"
                      className="shrink-0 rounded border border-input bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Copy
                    </CopyButton>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    {r.holder} · {r.channel}
                  </p>
                  <pre className="whitespace-pre-wrap break-words font-sans text-2xs">{r.text}</pre>
                </div>
              ))}
            </div>
          )}
          {exceptions.length > 0 && (
            <div className="space-y-2" data-testid="block-planning-ground-exceptions">
              <p className="text-xs font-medium">Exceptions the wildlife orders provide</p>
              <p className="text-2xs text-muted-foreground">
                What each order read here says may proceed, or may be approved, despite its measures, and who decides.
                Listed so the reviewer can see what to ask for; nothing here says an exception applies or would be
                granted.
              </p>
              {exceptions.map((x) => (
                <div key={x.order.id} className="space-y-1 rounded-md border p-2 text-xs">
                  <p className="font-medium">
                    {x.order.title} ·{' '}
                    <a className="underline" href={x.order.url} target="_blank" rel="noreferrer">
                      the order
                    </a>
                  </p>
                  <p className="text-2xs text-muted-foreground">On the block: {x.units.join(', ')}</p>
                  {x.clauses.length ? (
                    <ul className="list-disc space-y-1 pl-4">
                      {x.clauses.map((c) => (
                        <li key={c.ref}>
                          <span className="font-medium">{c.ref}</span>
                          {c.inOrder ? '' : ' (guidance, not part of the order)'}: {c.says} “{c.quote}” Decides: {c.by}.
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>The order states no exception or approval of its own.</p>
                  )}
                  <p className="text-2xs text-muted-foreground">
                    {x.route.text} ({wildlifeCitesText(x.route.cites)})
                  </p>
                </div>
              ))}
            </div>
          )}
          <FactsInformed found={found} factLabel={factLabel} />
        </>
      )}
    </div>
  )
}

/** Why some layers' precedent counts every date: each layer without one says where the date is. */
function undatedNotes(found: { instrument: GroundInstrument }[]) {
  const layers = [...new Set(found.map(({ instrument }) => instrument.layer))].map((id) => groundLayer(id))
  return layers.flatMap((l) => (l && !l.date && l.dateNote ? [l.dateNote] : []))
}

function Precedent({
  read,
  found,
  inside,
}: {
  read: GroundRead
  found: { instrument: GroundInstrument }[]
  inside: (openingId: number) => string[]
}) {
  const precedent = read.precedent
  if (!precedent) return null
  const notRead = (['standards', 'planting', 'activities'] as const).filter((j) => precedent.joins[j] === 'failed')
  return (
    <div className="space-y-2" data-testid="block-planning-ground-precedent">
      <p className="text-xs font-medium">Precedent: what RESULTS records inside each instrument nearby</p>
      <p className="text-2xs text-muted-foreground">
        Openings inside each instrument and within {precedent.radiusM / 1000} km of the block, harvested on or after its
        date where the layer gives one. Evidence of what was allowed and done nearby, not a finding that this block may
        be cut or reforested.
      </p>
      <ul className="space-y-1 text-xs">
        {found.map(({ instrument }) => (
          <li key={instrument.id}>
            <span className="font-medium">{instrument.label}:</span> {precedentSummary(precedent, instrument.id)}
          </li>
        ))}
      </ul>
      {undatedNotes(found).length > 0 && (
        <p className="text-2xs text-muted-foreground">{undatedNotes(found).join(' ')}</p>
      )}
      {notRead.length > 0 && precedent.status !== 'failed' && (
        <InlineAlert tone="warning">
          Not read:{' '}
          {notRead
            .map((j) => ({ standards: 'standards units', planting: 'planting results', activities: 'activities' })[j])
            .join(', ')}
          .
        </InlineAlert>
      )}
      {precedent.openings.length > 0 && (
        <CalculationTable
          caption={`Openings (${precedent.openings.length})`}
          rows={precedent.openings}
          rowKey={(o) => o.openingId}
          columns={[
            {
              label: 'Opening',
              render: (o) => `${o.openingId}${o.mapLabel ? ` (${o.mapLabel})` : ''}`,
            },
            {
              label: 'Licence',
              render: (o) =>
                [
                  o.forestFileId,
                  o.fileType,
                  o.cuttingPermit && `CP ${o.cuttingPermit}`,
                  o.cutBlock && `block ${o.cutBlock}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—',
            },
            {
              label: 'Harvested',
              render: (o) =>
                [
                  o.harvested ?? 'not recorded',
                  ...o.denudation,
                  o.category,
                  o.grossHa !== undefined && `${o.grossHa} ha`,
                ]
                  .filter(Boolean)
                  .join(' · '),
            },
            {
              label: 'Site preparation',
              render: (o) =>
                o.sitePrep.length
                  ? o.sitePrep.join('; ')
                  : precedent.joins.activities === 'read'
                    ? 'None recorded'
                    : 'Not read',
            },
            {
              label: 'Planting',
              render: (o) =>
                o.planting.length ? o.planting.join('; ') : o.planted === false ? 'None recorded' : 'Not read',
            },
            {
              label: 'Standards',
              render: (o) =>
                o.standards.length
                  ? o.standards.join('; ')
                  : precedent.joins.standards === 'read'
                    ? 'None recorded'
                    : 'Not read',
            },
            { label: 'Inside', render: (o) => inside(o.openingId).join(', ') },
          ]}
        />
      )}
    </div>
  )
}

function FactsInformed({
  found,
  factLabel,
}: {
  found: { instrument: GroundInstrument }[]
  factLabel: (pack: string, fact: string) => string | undefined
}) {
  const rows = found.filter(({ instrument }) => instrument.facts.length)
  if (!rows.length) return null
  return (
    <div className="space-y-1" data-testid="block-planning-ground-facts">
      <p className="text-xs font-medium">Review facts these inform</p>
      <p className="text-2xs text-muted-foreground">
        Weigh what was read when answering them below and in the landscape review; nothing here answers them.
      </p>
      <ul className="space-y-1 text-xs">
        {rows.map(({ instrument }) => (
          <li key={instrument.id}>
            <span className="font-medium">{instrument.label}:</span>{' '}
            {instrument.facts.map((f) => `“${factLabel(f.pack, f.fact) ?? f.fact}”`).join('; ')}
          </li>
        ))}
      </ul>
    </div>
  )
}

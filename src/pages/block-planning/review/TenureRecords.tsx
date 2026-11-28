import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import type { Block, Plan } from '../plan'
import { groundFootprint } from '../ground/record'
import { localToday } from '../acquire/RecordsSection'
import { readTenureSignals, tenureKindLabel, type TenureSignalsRead } from './tenureSignals'

/** A read kept for the session, with the block, schedule and footprint it was made for. */
export interface KeptTenureRead {
  block: string
  schedule: string
  footprint: string
  read: TenureSignalsRead
}

/** The kept read when it describes the block's footprint under the schedule as it stands now. */
export function currentTenureRead(
  plan: Plan,
  block: Block,
  schedule: string,
  kept: KeptTenureRead | null,
): TenureSignalsRead | null {
  if (!kept || kept.block !== block.id || kept.schedule !== schedule) return null
  return kept.footprint === groundFootprint(plan, block, schedule).signature ? kept.read : null
}

const fetchOf = (url: string, init?: RequestInit) => fetch(url, init)
const hectares = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/**
 * Review → *Tenure records*: the harvesting authorities, cut blocks and RESULTS openings on the
 * block's ground, read on the reviewer's click and kept for the session only, and the signals in
 * them that bear on an exception. The signals are offered beside the exception in the block review;
 * nothing here answers a question or claims an exception.
 */
export function TenureRecords({
  plan,
  block,
  schedule,
  kept,
  onRead,
}: {
  plan: Plan
  block: Block
  schedule: string
  kept: KeptTenureRead | null
  onRead: (kept: KeptTenureRead) => void
}) {
  const read = currentTenureRead(plan, block, schedule, kept)
  const stale = !!kept && kept.block === block.id && kept.schedule === schedule && !read
  const [state, setState] = useState<{ status: 'idle' | 'reading' } | { status: 'failed'; error: string }>({
    status: 'idle',
  })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const start = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setState({ status: 'reading' })
    try {
      const { shape, signature } = groundFootprint(plan, block, schedule)
      const { groundOverlay } = await import('../oldForest/oldForest')
      const value = await readTenureSignals({
        footprint: shape.geometry,
        fetch: fetchOf,
        signal: controller.signal,
        measure: groundOverlay.measure,
        readOn: localToday(),
      })
      if (controller.signal.aborted) return
      onRead({ block: block.id, schedule, footprint: signature, read: value })
      setState({ status: 'idle' })
    } catch (e) {
      if (!controller.signal.aborted)
        setState({ status: 'failed', error: e instanceof Error ? e.message : 'The read failed.' })
    }
  }

  return (
    <div className="space-y-2 text-xs" data-testid="block-planning-tenure-records">
      <p className="text-2xs text-muted-foreground">
        The harvesting authorities, cut blocks and RESULTS openings sharing ground with the block, from Forest Tenures
        and RESULTS. Where one records a catastrophic or salvage harvest, a permit&apos;s issue date or a site plan
        exemption, the block review offers it beside the exception it bears on. A record says what it says, never why,
        and answers nothing: relying on an exception is your claim. Read for this session only; no holder&apos;s name is
        read.
      </p>
      <Button size="sm" variant="outline" onClick={start} disabled={state.status === 'reading'}>
        {state.status === 'reading' ? 'Reading…' : read ? 'Read again' : 'Read the tenure records'}
      </Button>
      {stale && (
        <InlineAlert tone="info">The block&apos;s shape changed since the last read. Read it again.</InlineAlert>
      )}
      {state.status === 'failed' && <InlineAlert tone="error">{state.error}</InlineAlert>}
      {read && (
        <div className="space-y-1.5">
          <p className="text-muted-foreground">Read {read.readOn}.</p>
          {read.failed.map((f) => (
            <InlineAlert key={f.layer} tone="warning">
              Not read: {tenureKindLabel(f.layer)}. {f.message}
            </InlineAlert>
          ))}
          {read.records.length ? (
            <ul className="space-y-0.5" data-testid="tenure-records">
              {read.records.map((r) => (
                <li key={`${r.kind}|${r.id}`}>
                  {r.id} · {hectares.format(r.overlapHa)} ha ({hectares.format(r.sharePercent)}% of the block)
                  {r.fields.ISSUE_DATE ? ` · issued ${r.fields.ISSUE_DATE.slice(0, 10)}` : ''}
                  {r.fields.OPENING_CATEGORY_CODE ? ` · category ${r.fields.OPENING_CATEGORY_CODE}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>No record in the layers read shares ground with the block.</p>
          )}
          {read.slivers > 0 && (
            <p className="text-muted-foreground">
              {read.slivers} more touch the block by less than 100 m², read as boundaries meeting, and are left out.
            </p>
          )}
          <p data-testid="tenure-signal-count">
            {read.signals.length
              ? `${read.signals.length} record${read.signals.length === 1 ? '' : 's'} bear${read.signals.length === 1 ? 's' : ''} on an exception; each is offered beside it in the block review, on a raised rule that lists it.`
              : 'None of these records bears on an exception a rule lists.'}
          </p>
        </div>
      )}
    </div>
  )
}

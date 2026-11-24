import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CalculationTable } from '@/components/ui/calculation-results'
import { InlineAlert } from '@/components/ui/map-panels'
import { table } from '../forest-patches/project'
import type { BoardCheck } from './boardCheck'
import { setCheck } from './edits'
import { publishedUnit } from './observations'
import type { Plan } from './plan'
import { boardCheckCurrent, boardCheckKey, type BoardCheckRecord } from './records'
import type { StepProps } from './steps/types'

const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const signed = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

type State = { status: 'idle' } | { status: 'running' } | { status: 'failed'; error: string } | { status: 'none' }

/** What the plan keeps of a check: each year's modelled shares and young hectares. */
export const boardCheckRecord = (check: BoardCheck, key: string, ranOn: string): BoardCheckRecord => ({
  ranOn,
  key,
  years: check.years.map((y) => ({
    year: y.year,
    shares: y.modelled.classes.map((c) => c.percent),
    totalHa: y.modelled.totalHa,
  })),
})

/**
 * The patch calculation run on the baseline alone at 2015 and 2018, beside the Board's figures. Run
 * on request and kept with the plan (`checks.board`), keyed to the area and baseline it read, so the
 * assessment record and the printed summary carry it and say when it is out of date. Its answer is
 * evidence to weigh, never a gate on the projections.
 */
export function BoardCheckSection({ plan, edit }: { plan: Plan; edit: StepProps['edit'] }) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const record = plan.checks?.board
  const current = boardCheckCurrent(plan)
  const published = publishedUnit(plan.area.district, plan.area.ndu)

  function run() {
    worker.current?.terminate()
    const w = new Worker(new URL('./boardCheck.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    const key = boardCheckKey(plan)
    const ranOn = new Date().toISOString().slice(0, 10)
    setState({ status: 'running' })
    w.onmessage = ({ data }: MessageEvent<{ result?: BoardCheck | null; error?: string }>) => {
      w.terminate()
      worker.current = null
      if (data.error) return setState({ status: 'failed', error: data.error })
      if (!data.result) return setState({ status: 'none' })
      const kept = boardCheckRecord(data.result, key, ranOn)
      edit((p) => setCheck(p, 'board', kept))
      setState({ status: 'idle' })
    }
    w.onerror = (e) => {
      w.terminate()
      worker.current = null
      setState({ status: 'failed', error: e.message || 'The check could not start.' })
    }
    w.postMessage({ plan: { ...plan, reviews: {}, landscape: {}, packs: [], zones: undefined, checks: undefined } })
  }

  const neededFrom = 2015 - 20
  const gap =
    plan.area.baselineRead === undefined
      ? `The baseline was not read from DataBC, so whether it holds every disturbance since ${neededFrom} is not known.`
      : plan.area.baselineRead.fromYear > neededFrom
        ? `The baseline was read from ${plan.area.baselineRead.fromYear}; 2015’s young forest includes disturbances from ${neededFrom}. Read it again from step 1.`
        : null
  const years =
    record && published
      ? record.years.flatMap((y) => {
          const board = published.observations.find((o) => o.year === y.year)
          return board ? [{ ...y, board: board.shares }] : []
        })
      : []
  const diffs = years
    .flatMap((y) => y.shares.map((s, i) => (s === null ? null : Math.abs(s - y.board[i]))))
    .filter((d): d is number => d !== null)

  return (
    <div className="space-y-2" data-testid="block-planning-board-check">
      <p className="text-xs text-muted-foreground">
        Runs the plan’s calculation on the baseline alone at 2015 and 2018 and sets each class beside the Board’s
        figure. A difference tests the method and today’s records together: the Board used other inventories, and 2018
        the revised 2017 guidance.
      </p>
      {state.status === 'running' ? (
        <div className="flex items-center gap-2">
          <InlineAlert loading>
            Calculating 2015 and 2018 from {plan.baseline.length.toLocaleString()} disturbances. A whole unit takes a
            few minutes.
          </InlineAlert>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              worker.current?.terminate()
              worker.current = null
              setState({ status: 'idle' })
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={!plan.baseline.length} onClick={run}>
          {record ? 'Run it again' : 'Run the check'}
        </Button>
      )}
      {!plan.baseline.length && (
        <p className="text-2xs text-muted-foreground">Read past disturbances from DataBC in step 1 first.</p>
      )}
      {record && !current && (
        <InlineAlert tone="warning">
          The area or baseline changed since this check ({record.ranOn}). Run it again before relying on it.
        </InlineAlert>
      )}
      {state.status === 'failed' && <InlineAlert tone="error">{state.error}</InlineAlert>}
      {state.status === 'none' && (
        <InlineAlert tone="info">The Board published nothing for this district and sub-unit.</InlineAlert>
      )}
      {years.length > 0 && (
        <>
          {gap && <InlineAlert tone="warning">{gap}</InlineAlert>}
          <CalculationTable
            caption={`Share of young forest by patch size · modelled (Board, difference in points) · run ${record!.ranOn}`}
            rows={table.labels.map((label, b) => ({ label, b }))}
            rowKey={(r) => r.label}
            columns={[
              { label: 'Patch size', render: (r) => r.label },
              ...years.map((y) => ({
                label: String(y.year),
                render: (r: { b: number }) => {
                  const modelled = y.shares[r.b]
                  return modelled === null
                    ? `— (${pct.format(y.board[r.b])}%)`
                    : `${pct.format(modelled)}% (${pct.format(y.board[r.b])}%, ${signed.format(modelled - y.board[r.b])})`
                },
              })),
            ]}
          />
          <p className="text-2xs text-muted-foreground">
            Young forest modelled: {years.map((y) => `${y.year} ${pct.format(y.totalHa)} ha`).join(' · ')}
            {diffs.length > 0 && ` · largest class difference ${pct.format(Math.max(...diffs))} points`}. A close match
            supports the inputs and method together; a wide one is a question to answer before relying on the
            projections, not a finding.
          </p>
        </>
      )}
    </div>
  )
}

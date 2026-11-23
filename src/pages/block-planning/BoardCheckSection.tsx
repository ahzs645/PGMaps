import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CalculationTable } from '@/components/ui/calculation-results'
import { InlineAlert } from '@/components/ui/map-panels'
import { table } from '../forest-patches/project'
import type { BoardCheck } from './boardCheck'
import type { Plan } from './plan'

const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const signed = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

type State =
  | { status: 'idle' }
  | { status: 'running'; key: unknown[] }
  | { status: 'done'; key: unknown[]; result: BoardCheck | null }
  | { status: 'failed'; key: unknown[]; error: string }

/**
 * The patch calculation run on the baseline alone at 2015 and 2018, beside the Board's figures. Run
 * on request: it reads nothing but the area and the baseline, and its answer is evidence to weigh,
 * never a gate on the projections.
 */
export function BoardCheckSection({ plan }: { plan: Plan }) {
  const key = [plan.area, plan.baseline]
  const [state, setState] = useState<State>({ status: 'idle' })
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const stale = state.status !== 'idle' && (state.key[0] !== key[0] || state.key[1] !== key[1])

  function run() {
    worker.current?.terminate()
    const w = new Worker(new URL('./boardCheck.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setState({ status: 'running', key })
    w.onmessage = ({ data }: MessageEvent<{ result?: BoardCheck | null; error?: string }>) => {
      w.terminate()
      worker.current = null
      setState(
        data.error
          ? { status: 'failed', key, error: data.error }
          : { status: 'done', key, result: data.result ?? null },
      )
    }
    w.onerror = (e) => {
      w.terminate()
      worker.current = null
      setState({ status: 'failed', key, error: e.message || 'The check could not start.' })
    }
    w.postMessage({ plan: { ...plan, reviews: {}, landscape: {}, packs: [], zones: undefined } })
  }

  const check = state.status === 'done' ? state.result : null
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
          {state.status === 'idle' ? 'Run the check' : 'Run it again'}
        </Button>
      )}
      {!plan.baseline.length && (
        <p className="text-2xs text-muted-foreground">Read past disturbances from DataBC in step 1 first.</p>
      )}
      {stale && <InlineAlert tone="warning">The area or baseline changed since this check. Run it again.</InlineAlert>}
      {state.status === 'failed' && <InlineAlert tone="error">{state.error}</InlineAlert>}
      {state.status === 'done' && !check && (
        <InlineAlert tone="info">The Board published nothing for this district and sub-unit.</InlineAlert>
      )}
      {check && (
        <>
          {check.coverageGap && <InlineAlert tone="warning">{check.coverageGap}</InlineAlert>}
          <CalculationTable
            caption="Share of young forest by patch size · modelled (published, difference in points)"
            rows={table.labels.map((label, b) => ({ label, b }))}
            rowKey={(r) => r.label}
            columns={[
              { label: 'Patch size', render: (r) => r.label },
              ...check.years.map((y) => ({
                label: String(y.year),
                render: (r: { b: number }) => {
                  const modelled = y.modelled.classes[r.b].percent
                  const diff = y.difference[r.b]
                  return modelled === null
                    ? `— (${pct.format(y.published.shares[r.b])}%)`
                    : `${pct.format(modelled)}% (${pct.format(y.published.shares[r.b])}%, ${signed.format(diff ?? 0)})`
                },
              })),
            ]}
          />
          <p className="text-2xs text-muted-foreground">
            Young forest modelled:{' '}
            {check.years.map((y) => `${y.year} ${pct.format(y.modelled.totalHa)} ha`).join(' · ')}
            {check.largestDifference !== null &&
              ` · largest class difference ${pct.format(check.largestDifference)} points`}
            . A close match supports the inputs and method together; a wide one is a question to answer before relying
            on the projections, not a finding.
          </p>
        </>
      )}
    </div>
  )
}

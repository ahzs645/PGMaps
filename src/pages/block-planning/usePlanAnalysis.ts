import { useEffect, useMemo, useState } from 'react'
import { landscapeReady, type PlanAnalysis } from './planAnalysis'
import type { Plan } from './plan'

export type AnalysisState =
  | { status: 'not-ready'; reason: string }
  | { status: 'running'; previous?: PlanAnalysis }
  | { status: 'ready'; result: PlanAnalysis }
  | { status: 'failed'; error: string }

/**
 * Every schedule's periods for the plan, from a worker. Only what changes the calculation starts a
 * run: the area, the baseline, the blocks and the schedules, and the schedule and year on the map.
 * Reviews, the rationale and the ground reads never do. While a run is going the last result stays
 * on screen.
 */
export function usePlanAnalysis(plan: Plan, shown: { schedule: string; year: number }): AnalysisState {
  const { area, baseline, blocks, schedules } = plan
  const input = useMemo(
    () => ({
      plan: {
        ...plan,
        reviews: {},
        rangeReviews: undefined,
        groundReads: undefined,
        landscape: {},
        packs: [],
        zones: undefined,
      },
      shown,
    }),
    // `plan` is read only for the fields listed; a review edit must not start a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [area, baseline, blocks, schedules, shown.schedule, shown.year],
  )
  const reason = landscapeReady(plan)
  const [answer, setAnswer] = useState<{ input: typeof input; result?: PlanAnalysis; error?: string }>()
  const [last, setLast] = useState<PlanAnalysis>()
  useEffect(() => {
    if (reason) return
    const worker = new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ result?: PlanAnalysis; error?: string }>) => {
      setAnswer({ input, ...data })
      if (data.result) setLast(data.result)
    }
    worker.onerror = (event) => setAnswer({ input, error: event.message || 'The patch calculation could not start.' })
    worker.postMessage(input)
    return () => worker.terminate()
  }, [input, reason])
  if (reason) return { status: 'not-ready', reason }
  if (answer?.input !== input) return { status: 'running', previous: last }
  if (answer.error) return { status: 'failed', error: answer.error }
  return { status: 'ready', result: answer.result! }
}

/** The result to draw: the current one, or the last while the next is calculated. */
export const shownResult = (state: AnalysisState) =>
  state.status === 'ready' ? state.result : state.status === 'running' ? state.previous : undefined

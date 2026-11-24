import { useEffect, useRef, useState } from 'react'
import { drawingDisagrees, type OldForestDrawing } from './oldForest/drawing'
import { drawOldForest, OldForestStopped } from './oldForest/oldForestClient'
import type { Plan } from './plan'
import { oldForestCurrent, type OldForestYear } from './records'

export interface OldForestMap {
  /** The shapes on the map. They stay up while the next schedule or year is drawn. */
  drawing: OldForestDrawing | null
  /** The schedule and year being drawn while the map still shows `drawing`, with the worker's progress. */
  pending: { schedule: string; year: number; progress: string } | null
  /** Why nothing is drawn (layer on but no current record, a failed or stopped draw); null otherwise. */
  note: string | null
  /** Where the drawing's figures differ from the record's (`drawingDisagrees`). */
  disagrees: string | null
}

const OFF: OldForestMap = { drawing: null, pending: null, note: null, disagrees: null }

/**
 * The old forest map layer for the schedule and year on the map. Asked of the page's old forest
 * worker only while the layer is on and the record is current; the shapes come from the worker's
 * own run of the calculation. A new year or schedule keeps the last drawing up until the next has
 * come back, then swaps it in one render. Session only: nothing is written to the plan.
 */
export function useOldForestMap(plan: Plan, shown: { schedule: string; year: number }, on: boolean): OldForestMap {
  const record = plan.checks?.oldForest
  const current = !!record && oldForestCurrent(plan)
  const [drawing, setDrawing] = useState<OldForestDrawing | null>(null)
  const [pending, setPending] = useState<OldForestMap['pending']>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const planRef = useRef(plan)
  planRef.current = plan
  const wanted = on && current && record ? `${record.key}|${shown.schedule}|${shown.year}` : null
  const drawnKey = drawing ? `${drawing.key}|${drawing.schedule}|${drawing.year}` : null

  useEffect(() => {
    if (!wanted || wanted === drawnKey) {
      setPending(null)
      return
    }
    let live = true
    const { schedule, year } = shown
    setFailure(null)
    setPending({ schedule, year, progress: `Drawing old forest for ${year}…` })
    const p = planRef.current
    drawOldForest(
      {
        plan: { ...p, reviews: {}, landscape: {}, packs: [], zones: undefined, checks: undefined },
        key: p.checks!.oldForest!.key,
        ranOn: new Date().toISOString().slice(0, 10),
        schedule,
        year,
      },
      (progress) => live && setPending({ schedule, year, progress }),
    )
      .then((next) => {
        if (!live || !next) return
        // One render: the shapes and the end of the wait change together.
        setDrawing(next)
        setPending(null)
      })
      .catch((e: unknown) => {
        if (!live) return
        setPending(null)
        setFailure(
          e instanceof OldForestStopped
            ? 'Drawing stopped. Turn the layer off and on to draw it again.'
            : `The old forest map could not be drawn: ${e instanceof Error ? e.message : 'unknown error'}`,
        )
      })
    return () => {
      live = false
    }
    // `wanted` names the record, schedule and year; the plan is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, drawnKey])

  if (!on) return OFF
  if (!record) return { ...OFF, note: 'Calculate old and old interior forest (Compare) to draw it.' }
  if (!current) return { ...OFF, note: 'The old forest record is out of date. Calculate again to draw it.' }
  const recordYear = (unit: string): OldForestYear | undefined => {
    if (!drawing) return undefined
    const runs = record.pool?.find((u) => u.unit === unit)?.schedules ?? record.schedules
    return runs.find((s) => s.schedule === drawing.schedule)?.years.find((y) => y.year === drawing.year)
  }
  const shownDrawing = drawing && drawing.key === record.key ? drawing : null
  return {
    drawing: shownDrawing,
    pending,
    note: failure,
    disagrees: shownDrawing ? drawingDisagrees(shownDrawing, record.readOn, recordYear) : null,
  }
}

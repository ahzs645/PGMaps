import { useMemo } from 'react'
import { useTheme } from 'next-themes'
import { LineBandChart, type XYDomain } from '@pgmaps/geo-toolkit/visualizations/react'
import { InlineAlert } from '@/components/ui/map-panels'
import { bins, table } from '../forest-patches/project'
import { MAX_COLOURED_SCHEDULES, scheduleColour } from './colors'
import { periodYears, type Plan } from './plan'
import type { PlanAnalysis } from './planAnalysis'

const TARGET_COLOUR = '#6b6b67'
const percent = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}%`

type Point = { x: number; y: number | null; schedule: string }

/**
 * The four Table 7 size classes as small multiples: each class's share of young forest over the
 * projection, one line per schedule, against the order's target for the sub-unit. The order sets
 * a trend toward each class's target and no score for the four together, so they are never
 * combined into one line.
 */
export function TrendChart({ plan, result, year }: { plan: Plan; result: PlanAnalysis; year: number }) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  const years = periodYears(plan.area.startYear)
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const panels = useMemo(
    () =>
      bins.map((bin, b) => {
        const target = result.runs[0]?.periods[0]?.classes[b]?.target ?? null
        const series = result.runs.map((run, i) => ({
          id: run.schedule,
          label: names[run.schedule] ?? run.schedule,
          color: scheduleColour(i, dark),
          strokeWidth: run.schedule === plan.reviewSchedule ? 2.5 : 2,
          points: run.periods.map((p) => ({ x: p.year, y: p.classes[b].percent, schedule: run.schedule })),
        }))
        if (target !== null)
          series.push({
            id: 'target',
            label: 'Order target',
            color: TARGET_COLOUR,
            strokeWidth: 1,
            points: years.map((y) => ({ x: y, y: target, schedule: 'target' })),
          })
        const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v !== null)
        const high = Math.min(100, Math.max(10, ...ys) + 5)
        const extent: XYDomain = [years[0] - 1, years.at(-1)! + 1, 0, high]
        return { bin, label: table.labels[b], target, series, extent }
      }),
    [result, dark, years, names, plan.reviewSchedule],
  )
  const overflow = plan.schedules.length > MAX_COLOURED_SCHEDULES
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" data-testid="block-planning-trend">
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground" aria-label="Schedules">
        {plan.schedules.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: scheduleColour(i, dark) }} />
            <span className={s.id === plan.reviewSchedule ? 'font-semibold' : undefined}>
              {s.name}
              {s.id === plan.reviewSchedule && <span className="text-muted-foreground"> · under review</span>}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4" style={{ background: TARGET_COLOUR }} />
          <span>Order target</span>
        </li>
      </ul>
      {overflow && (
        <InlineAlert tone="info">
          Schedules past the eighth are drawn in grey. Compare them in the period table.
        </InlineAlert>
      )}
      <div className="grid shrink-0 gap-3 sm:grid-cols-2">
        {panels.map((panel) => (
          <figure key={panel.bin} className="min-w-0">
            <figcaption className="text-xs font-medium text-foreground">
              Patches {panel.label}
              <span className="font-normal text-muted-foreground">
                {panel.target === null ? ' · no target' : ` · target ${percent(panel.target)}`}
              </span>
            </figcaption>
            <LineBandChart<Point>
              series={panel.series}
              height={150}
              extent={panel.extent}
              label={`Share of young forest in patches ${panel.label}, ${plan.area.ndu}, ${years[0]}–${years.at(-1)}, by schedule`}
              xAxis={{ format: (v) => String(Math.round(v)), ticks: years.filter((_, i) => i % 2 === 0) }}
              yAxis={{ width: 56, format: (v) => `${Math.round(v)}%` }}
              highlightOnHover
              renderTooltip={(point, series) => (
                <>
                  <div className="font-medium">
                    {series.label} · {point.x}
                    {point.x === year ? ' (on the map)' : ''}
                  </div>
                  <div>{point.y === null ? 'No young forest' : percent(point.y)}</div>
                </>
              )}
            />
          </figure>
        ))}
      </div>
      <p className="shrink-0 text-2xs text-muted-foreground">
        Share of young forest (0–20 years) in each patch size class, method pg-2005-buffer-v1. A class moving toward its
        target is the order’s test; no figure here combines the four.
      </p>
    </div>
  )
}

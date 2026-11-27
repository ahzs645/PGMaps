import { useMemo } from 'react'
import { CalculationTable } from '@/components/ui/calculation-results'
import { table } from '../forest-patches/project'
import type { Plan } from './plan'
import type { PlanAnalysis } from './planAnalysis'

const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const fmt = (n: number | null | undefined) => (n == null ? null : formatter.format(n))

/**
 * Every period of every schedule as rows: the chart's figures as a table, and its table view.
 * "Distance grew" is how much the four classes' distances from their targets, added, grew since the
 * period before (the order's trend test, `distributionTrend`); "A class moved away" is whether any one
 * class moved farther, the evidence of which classes did.
 */
export function PeriodTable({ plan, result, year }: { plan: Plan; result: PlanAnalysis; year: number }) {
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const rows = useMemo(
    () =>
      result.runs.flatMap((run) =>
        run.periods.map((period, i) => ({
          key: run.schedule + period.year,
          run,
          period,
          movedAway: run.movedAway[i],
          growth: run.distanceGrowth[i],
        })),
      ),
    [result],
  )
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2" data-testid="block-planning-table">
      <CalculationTable
        caption={`Young forest by period and schedule · ${plan.area.district} · ${plan.area.ndu}`}
        rows={rows}
        rowKey={(r) => r.key}
        columns={[
          {
            label: 'Schedule · year',
            render: (r) =>
              `${names[r.run.schedule] ?? r.run.schedule} · ${r.period.year}${r.period.year === year ? ' ◂' : ''}`,
          },
          { label: 'Young ha', render: (r) => fmt(r.period.totalHa) },
          { label: 'Patches', render: (r) => r.period.patches },
          ...table.labels.map((label, b) => ({
            label: `${label} %`,
            render: (r: (typeof rows)[number]) => fmt(r.period.classes[b].percent),
          })),
          { label: 'Unclassified ha', render: (r) => fmt(r.period.unclassifiedHa) },
          {
            label: 'Distance grew (points)',
            render: (r) => (r.growth === null ? '—' : r.growth > 0 ? `+${fmt(r.growth)}` : fmt(r.growth)),
          },
          {
            label: 'A class moved away',
            render: (r) => (r.movedAway === null ? '—' : r.movedAway ? 'Yes' : 'No'),
          },
        ]}
      />
    </div>
  )
}

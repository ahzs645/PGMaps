import { NativeSelect } from '@/components/ui/form-field'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { isFullCostRecordCurrent } from './fullCostRecord'
import type { Alignment, RoadAnalysis, RoadProject } from './types'

const number = (v: number, digits = 0) => v.toLocaleString('en-CA', { maximumFractionDigits: digits })

type Metric = { id: string; label: string; unit: string; value: (r: RoadAnalysis) => number; digits?: number }
/** The comparison a design review asks for: length, disturbance, earthworks and cost against a baseline. */
const METRICS: Metric[] = [
  { id: 'length', label: 'Length', unit: 'm', value: (r) => r.length },
  { id: 'grade', label: 'Max grade', unit: '%', value: (r) => r.maxGradePercent, digits: 1 },
  { id: 'disturbance', label: 'Disturbance', unit: 'm²', value: (r) => r.clearingAreaM2 },
  { id: 'earthworks', label: 'Earthworks', unit: 'm³ cut+fill', value: (r) => r.cutVolumeM3 + r.fillVolumeM3 },
  { id: 'cost', label: 'Base engineering', unit: 'CAD', value: (r) => r.estimatedCost },
]

export function compareMetric(base: RoadAnalysis, other: RoadAnalysis, id: string) {
  const metric = METRICS.find((m) => m.id === id)!
  const a = metric.value(base),
    b = metric.value(other)
  return { value: b, change: a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null }
}

export function CompareAlternatives({
  alignments,
  analyses,
  activeId,
  onSelect,
  project,
  onCompareCompleteCosts,
}: {
  alignments: Alignment[]
  analyses: Map<string, RoadAnalysis>
  activeId: string
  onSelect: (id: string) => void
  project?: RoadProject
  onCompareCompleteCosts?: () => void
}) {
  const [baselineId, setBaselineId] = useState(alignments[0]?.id ?? '')
  const baseline = analyses.get(alignments.some((a) => a.id === baselineId) ? baselineId : alignments[0].id)!
  const completeCosts = useMemo(
    () =>
      new Map(
        alignments
          .filter((road) => road.fullCostRecord)
          .map((road) => [road.id, project && isFullCostRecordCurrent(road, project)]),
      ),
    [alignments, project],
  )
  return (
    <div className="h-full space-y-2 overflow-auto" data-testid="road-compare">
      <label className="flex items-center gap-2 text-xs">
        Compared with
        <NativeSelect
          aria-label="Comparison baseline"
          className="rounded border bg-background px-1 text-base md:text-xs"
          value={baselineId}
          onChange={(e) => setBaselineId(e.target.value)}
        >
          {alignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <EngineeringTable>
        <thead className="sticky top-0 z-10">
          <tr>
            <ColumnHeader label="Alternative" className="text-left" />
            {METRICS.map((m) => (
              <ColumnHeader key={m.id} label={m.label} unit={m.unit} />
            ))}
            <ColumnHeader label="Coverage" unit="%" />
            {completeCosts.size > 0 && <ColumnHeader label="Saved complete access" unit="CAD" />}
          </tr>
        </thead>
        <tbody>
          {alignments.map((a) => {
            const result = analyses.get(a.id)!
            const available = result.stations.length > 0
            return (
              <tr
                key={a.id}
                aria-selected={a.id === activeId}
                title={available ? undefined : result.warnings.join('; ')}
              >
                <td className="max-w-56 truncate text-left">
                  <button className="underline" onClick={() => onSelect(a.id)} title={a.name}>
                    {a.name}
                  </button>
                </td>
                {METRICS.map((m) => {
                  if (!available) return <td key={m.id}>—</td>
                  const { value, change } = compareMetric(baseline, result, m.id)
                  const better = change !== null && change < -0.05,
                    worse = change !== null && change > 0.05
                  return (
                    <td key={m.id} data-metric={m.id}>
                      {m.id === 'cost' ? `$${number(value)}` : number(value, m.digits ?? 0)}
                      {result !== baseline && change !== null && (
                        <span
                          className={`ml-1 text-[10px] ${better ? 'text-emerald-700 dark:text-emerald-400' : worse ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
                        >
                          {change > 0 ? '+' : ''}
                          {number(change, 0)}%
                        </span>
                      )}
                    </td>
                  )
                })}
                <td>{available ? number(result.coveragePercent, 1) : '—'}</td>
                {completeCosts.size > 0 && (
                  <td>
                    {a.fullCostRecord
                      ? completeCosts.get(a.id)
                        ? `$${number(a.fullCostRecord.totalCost)}`
                        : 'Stale — recalculate'
                      : 'Not compared'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </EngineeringTable>
      <p className="text-[11px] text-muted-foreground">
        Changes are against the baseline on the same terrain and rates. Disturbance is the area between catch points.
        Partial quantities are not directly comparable with complete ones. Base engineering estimates exclude the
        complete connected-access and delivered-supply comparison.
      </p>
      {onCompareCompleteCosts && (
        <Button size="sm" variant="outline" onClick={onCompareCompleteCosts}>
          Compare complete access and supply costs
        </Button>
      )}
    </div>
  )
}

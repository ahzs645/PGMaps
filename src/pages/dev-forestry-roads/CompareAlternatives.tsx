import { RoadSelect } from './Controls'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { isFullCostRecordCurrent } from './fullCostRecord'
import { VerticalAlternativesEditor } from './VerticalAlternativesEditor'
import { terrainReferenceSurfaces } from './terrain'
import { alternativeCostLabel } from './alternativeCosts'
import { alternativeMetricComparison } from './alternativeComparison'
import { hasCompleteCoverage } from './analysisResult'
import { InfoTip } from '@/components/ui/info-tip'
import { distinctRoadColors } from './roadColors'
import { shortRoadNames } from './roadNames'
import type { Alignment, RoadAnalysis, RoadProject, TerrainSource } from './types'

const number = (v: number, digits = 0) => v.toLocaleString('en-CA', { maximumFractionDigits: digits })

type Metric = { id: string; label: string; unit: string; value: (r: RoadAnalysis) => number; digits?: number }
/** The comparison a design review asks for: length, disturbance, earthworks and cost against a baseline. */
const METRICS: Metric[] = [
  { id: 'cost', label: 'Base engineering', unit: 'CAD', value: (r) => r.estimatedCost },
  { id: 'length', label: 'Length', unit: 'm', value: (r) => r.length },
  { id: 'grade', label: 'Max grade', unit: '%', value: (r) => r.maxGradePercent, digits: 1 },
  { id: 'earthworks', label: 'Earthworks', unit: 'm³ cut+fill', value: (r) => r.cutVolumeM3 + r.fillVolumeM3 },
  { id: 'disturbance', label: 'Disturbance', unit: 'm²', value: (r) => r.clearingAreaM2 },
]

/** What building a road costs and disturbs. A mapped road already exists, so it has none to compare. */
const BUILD_METRICS = new Set(['cost', 'earthworks', 'disturbance'])
const EXISTING_ROAD_NOTE =
  'A mapped road already exists. Its formation follows the ground, so build cost, earthworks and disturbance do not apply.'

export function compareMetric(
  base: RoadAnalysis,
  other: RoadAnalysis,
  id: string,
  profiles?: { baseHasProfile: boolean; otherHasProfile: boolean },
) {
  const metric = METRICS.find((m) => m.id === id)!
  const a = metric.value(base),
    b = metric.value(other)
  const eligibility = alternativeMetricComparison(base, other, id, profiles)
  return {
    value: b,
    change: eligibility.comparable && a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null,
    reason: eligibility.reason,
  }
}

export function CompareAlternatives({
  alignments,
  analyses,
  activeId,
  onSelect,
  project,
  onCompareCompleteCosts,
  terrain,
  onAlignmentChange,
}: {
  alignments: Alignment[]
  analyses: Map<string, RoadAnalysis>
  activeId: string
  onSelect: (id: string) => void
  project?: RoadProject
  onCompareCompleteCosts?: () => void
  terrain?: TerrainSource
  onAlignmentChange?: (alignment: Alignment) => void
}) {
  const [baselineId, setBaselineId] = useState(alignments[0]?.id ?? '')
  const metadata = project?.terrain
  const referenceSurfaces = useMemo(() => (metadata ? terrainReferenceSurfaces(metadata) : undefined), [metadata])
  const baselineAlignment = alignments.find((a) => a.id === baselineId) ?? alignments[0]
  const baseline = analyses.get(baselineAlignment.id)!
  const completeCosts = useMemo(
    () =>
      new Map(
        alignments
          .filter((road) => road.fullCostRecord)
          .map((road) => [road.id, project && isFullCostRecordCurrent(road, project)]),
      ),
    [alignments, project],
  )
  const names = new Map(
    shortRoadNames(alignments.map((a) => a.name)).map((name, i) => [alignments[i].id, name] as const),
  )
  const colors = distinctRoadColors(alignments)
  const partial = alignments.some((a) => {
    const result = analyses.get(a.id)
    return !!result && result.stations.length > 0 && !hasCompleteCoverage(result)
  })
  return (
    <div className="h-full space-y-2 overflow-auto overscroll-none" data-testid="road-compare">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <label className="flex min-w-0 items-center gap-2">
          Compared with
          <RoadSelect
            ariaLabel="Comparison baseline"
            className="min-w-0 max-w-48 rounded-md border bg-background px-1 text-base md:text-xs"
            value={baselineAlignment.id}
            onValueChange={(value) => setBaselineId(value)}
          >
            {alignments.map((a) => (
              <option key={a.id} value={a.id}>
                {names.get(a.id)}
              </option>
            ))}
          </RoadSelect>
        </label>
        <InfoTip label="About this comparison">
          Changes are against the baseline on the same terrain and rates. Disturbance is the area between catch points.
          Partial earthwork and disturbance subtotals show no percentage ranking. Base engineering excludes the drainage
          allowance in Find the best route, and the complete connected-access and delivered-supply comparison.
        </InfoTip>
        {onCompareCompleteCosts && (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={onCompareCompleteCosts}>
            Complete access & supply costs
          </Button>
        )}
      </div>
      <EngineeringTable>
        <thead className="sticky top-0 z-10">
          <tr>
            <ColumnHeader label="Alternative" className="text-left" />
            {METRICS.map((m) => (
              <ColumnHeader key={m.id} label={m.label} unit={m.unit} />
            ))}
            {partial && <ColumnHeader label="Coverage" unit="%" />}
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
                className="cursor-pointer"
                onClick={() => onSelect(a.id)}
              >
                <td className="max-w-56 truncate text-left">
                  <button className="flex max-w-full items-center gap-1.5 hover:underline" title={a.name}>
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: colors.get(a.id) }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{names.get(a.id)}</span>
                    {a.mappedRoad && (
                      <span className="shrink-0 rounded-sm bg-violet-100 px-1 text-3xs text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                        mapped
                      </span>
                    )}
                  </button>
                </td>
                {METRICS.map((m) => {
                  if (!available) return <td key={m.id}>—</td>
                  if (a.mappedRoad && BUILD_METRICS.has(m.id))
                    return (
                      <td key={m.id} data-metric={m.id} title={EXISTING_ROAD_NOTE} className="text-muted-foreground">
                        Existing
                      </td>
                    )
                  if (m.id === 'cost' && alternativeCostLabel(result))
                    return (
                      <td key={m.id} data-metric={m.id} className="text-warning">
                        {alternativeCostLabel(result)}
                      </td>
                    )
                  const compared = compareMetric(baseline, result, m.id, {
                    baseHasProfile: baselineAlignment.vertical.length > 0,
                    otherHasProfile: a.vertical.length > 0,
                  })
                  const { value } = compared
                  const againstExisting = !!baselineAlignment.mappedRoad && BUILD_METRICS.has(m.id)
                  const change = againstExisting ? null : compared.change
                  const reason = againstExisting ? EXISTING_ROAD_NOTE : compared.reason
                  const better = change !== null && change < -0.05,
                    worse = change !== null && change > 0.05
                  return (
                    <td key={m.id} data-metric={m.id} title={reason ?? undefined}>
                      {m.id === 'cost' ? `$${number(value)}` : number(value, m.digits ?? 0)}
                      {(m.id === 'earthworks' || m.id === 'disturbance') && !hasCompleteCoverage(result) && (
                        <span className="ml-1 text-3xs text-warning">covered</span>
                      )}
                      {m.id === 'grade' && !a.vertical.length && (
                        <span className="ml-1 text-3xs text-muted-foreground">ground</span>
                      )}
                      {result !== baseline && change !== null && (
                        <span
                          className={`ml-1 text-3xs ${better ? 'text-success' : worse ? 'text-warning' : 'text-muted-foreground'}`}
                        >
                          {change > 0 ? '+' : ''}
                          {number(change, 0)}%
                        </span>
                      )}
                    </td>
                  )
                })}
                {partial && <td>{available ? number(result.coveragePercent, 1) : '—'}</td>}
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
      {onAlignmentChange && alignments.find((a) => a.id === activeId && !a.mappedRoad) && (
        <VerticalAlternativesEditor
          alignment={alignments.find((a) => a.id === activeId)!}
          terrain={terrain}
          settings={project?.settings}
          context={project?.context}
          referenceSurfaces={referenceSurfaces}
          sharedCrossingCosts={project?.sharedCrossingCosts}
          onChange={onAlignmentChange}
        />
      )}
    </div>
  )
}

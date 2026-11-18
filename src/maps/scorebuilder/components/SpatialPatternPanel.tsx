import { useMemo, type ReactNode } from 'react'
import { ScatterPlot, type XYDomain } from '@pgmaps/geo-toolkit/visualizations/react'
import { CheckboxField } from '@/components/ui/form-field'
import { InlineAlert, LegendItem } from '@/components/ui/map-panels'
import { EmptyHint } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { cn } from '@/lib/utils'
import type { LisaClass, SpatialPatternSummary } from '../lib/spatialAutocorrelation'
import {
  CLUSTER_COLORS,
  CLUSTER_LABELS,
  describeGlobalPattern,
  formatPermutationP,
  type ClusterMapClass,
} from '../lib/spatialPatternView'

interface MoranScatterPoint {
  x: number
  y: number
  id: string
  cluster: LisaClass
}

export interface SpatialPatternPanelProps {
  className?: string
  /** What the run reads, e.g. "Index score" or a metric's label. */
  variableLabel: string
  summary: SpatialPatternSummary | null
  regionNames: ReadonlyMap<string, string>
  /** Map class counts over the drawn regions; shown while the cluster map is on. */
  mapCounts?: Record<ClusterMapClass, number> | null
  fdr: boolean
  onFdrChange: (on: boolean) => void
  /** The Index and Density labs choose their map colouring here. */
  clusterMap?: { on: boolean; onChange: (on: boolean) => void; valueLabel: string }
  /** The Correlation Lab chooses what the run reads. */
  variablePicker?: ReactNode
}

const SCATTER_CLASSES: readonly LisaClass[] = ['ns', 'LH', 'HL', 'LL', 'HH']

/** One axis from the data, with zero on a tick so the four quadrants read at a glance. */
function axisRange(values: readonly number[]): { range: [number, number]; ticks: number[] } {
  let low = -1
  let high = 1
  for (const value of values) {
    if (value < low) low = value
    if (value > high) high = value
  }
  const span = high - low
  const step = span <= 4 ? 1 : span <= 10 ? 2 : Math.ceil(span / 5)
  const lowEdge = Math.floor((low - span * 0.03) / step) * step
  const highEdge = Math.ceil((high + span * 0.03) / step) * step
  const ticks: number[] = []
  for (let tick = lowEdge; tick <= highEdge + 1e-9; tick += step) ticks.push(tick)
  return { range: [lowEdge, highEdge], ticks }
}

function scatterExtent(points: readonly MoranScatterPoint[]): { extent: XYDomain; xTicks: number[]; yTicks: number[] } {
  const x = axisRange(points.map((point) => point.x))
  const y = axisRange(points.map((point) => point.y))
  return { extent: [x.range[0], x.range[1], y.range[0], y.range[1]], xTicks: x.ticks, yTicks: y.ticks }
}

/**
 * Global Moran's I, the Moran scatter and the local clusters for one variable. Every figure
 * here is computed in the browser from the mapped values, so the panel says so.
 */
export function SpatialPatternPanel({
  className,
  variableLabel,
  summary,
  regionNames,
  mapCounts,
  fdr,
  onFdrChange,
  clusterMap,
  variablePicker,
}: SpatialPatternPanelProps) {
  const local = summary?.local ?? null
  const global = summary?.global ?? null

  const scatter = useMemo(() => {
    if (!local) return null
    const points: MoranScatterPoint[] = local.ids.map((id, i) => ({
      x: local.standardised[i],
      y: local.lag[i],
      id,
      cluster: local.cluster[i],
    }))
    const series = SCATTER_CLASSES.map((cluster) => ({
      color: CLUSTER_COLORS[cluster],
      points: points.filter((point) => point.cluster === cluster),
    })).filter((entry) => entry.points.length)
    return { series, ...scatterExtent(points) }
  }, [local])

  const leftOut = summary ? [...summary.islands] : []
  const counts = mapCounts ?? (summary ? { ...summary.counts, none: summary.missing.length + leftOut.length } : null)
  const tickLabel = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

  return (
    <div className={cn('space-y-3', className)} data-score-builder-section="spatialPattern">
      {variablePicker}
      {clusterMap && (
        <SegmentedControl
          label="Map colours"
          size="sm"
          value={clusterMap.on ? 'clusters' : 'values'}
          onChange={(value) => clusterMap.onChange(value === 'clusters')}
          options={[
            { value: 'values', label: clusterMap.valueLabel },
            { value: 'clusters', label: 'Clusters' },
          ]}
        />
      )}

      {!summary || !global ? (
        <EmptyHint>
          {summary && summary.analysedCount < 4
            ? 'Too few neighbouring regions have a value to measure a spatial pattern.'
            : summary
              ? `${variableLabel} has the same value in every region, so there is no pattern to measure.`
              : 'Measuring the spatial pattern…'}
        </EmptyHint>
      ) : (
        <>
          <StatGroup
            variant="tiles"
            size="sm"
            columns={3}
            items={[
              { label: "Moran's I", value: global.I.toFixed(2) },
              { label: 'z', value: global.zRandomisation.toFixed(1), note: 'randomisation' },
              {
                label: 'p',
                value: formatPermutationP(global.pPermutation, global.permutations).replace(/^p\s/, ''),
                note: `${global.permutations} permutations`,
              },
            ]}
          />
          <p className="text-xs leading-snug text-foreground" data-spatial-pattern-reading="true">
            {describeGlobalPattern(global)}
          </p>

          {scatter && (
            <figure className="space-y-1" data-moran-scatter="true">
              <ScatterPlot<MoranScatterPoint>
                series={scatter.series}
                extent={scatter.extent}
                height={230}
                radius={3}
                label={`Moran scatter plot of ${variableLabel}: each region's standardised value against its neighbours' mean`}
                xAxis={{ label: `${variableLabel} (z)`, ticks: scatter.xTicks, format: tickLabel }}
                yAxis={{ label: 'Neighbours (z)', ticks: scatter.yTicks, format: tickLabel, width: 46 }}
                renderTooltip={(point) => (
                  <>
                    <div className="font-medium">{regionNames.get(point.id) ?? point.id}</div>
                    <div>
                      {CLUSTER_LABELS[point.cluster]} · value {point.x.toFixed(2)} · neighbours {point.y.toFixed(2)}
                    </div>
                  </>
                )}
              />
              <figcaption className="text-xs leading-snug text-muted-foreground">
                Each dot is a region: its value against the mean of its neighbours&apos;, both in standard deviations.
                The cloud&apos;s slope is Moran&apos;s I. Top right and bottom left are clusters; the other corners are
                outliers.
              </figcaption>
            </figure>
          )}

          {local && counts && (
            <div className="space-y-0.5 text-xs" data-spatial-pattern-counts="true">
              {(['HH', 'LL', 'HL', 'LH', 'ns', 'none'] as const)
                .filter((cluster) => cluster !== 'none' || counts.none > 0)
                .map((cluster) => (
                  <LegendItem
                    key={cluster}
                    color={CLUSTER_COLORS[cluster]}
                    swatchShape="square"
                    label={CLUSTER_LABELS[cluster]}
                    value={String(counts[cluster])}
                  />
                ))}
            </div>
          )}

          <CheckboxField
            label="Hold clusters to a 5% false discovery rate"
            description={
              local && fdr
                ? `A region needs p ≤ ${local.cutoff ? local.cutoff.toFixed(4) : '0'} once every region's test is counted.`
                : 'Without it, about 1 region in 20 shows as a cluster by chance.'
            }
            checked={fdr}
            onCheckedChange={onFdrChange}
          />

          {leftOut.length > 0 && (
            <InlineAlert tone="info" className="leading-snug">
              {leftOut.length === 1 ? '1 region touches' : `${leftOut.length} regions touch`} no other region with a
              value, so {leftOut.length === 1 ? 'it is' : 'they are'} left out:{' '}
              {leftOut
                .slice(0, 4)
                .map((id) => regionNames.get(id) ?? id)
                .join(', ')}
              {leftOut.length > 4 ? ` and ${leftOut.length - 4} more` : ''}.
            </InlineAlert>
          )}
        </>
      )}

      <p className="text-xs leading-snug text-muted-foreground">
        Calculated by PGMaps from the mapped values, not a published statistic: regions that share an edge or a corner
        are neighbours, and clusters are local Moran&apos;s I (Anselin 1995) at p ≤ 0.05 from 999 permutations.
      </p>
    </div>
  )
}

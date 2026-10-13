import { MapGradientLegendItem, MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { COLOR_SCALES } from '@/components/ui/map-styles'
import { HEALTHYPLAN_EQUITY_PRIORITY_RAMP } from '@/lib/healthyplan'
import { toWalkabilityMiLegendBands, useWalkabilityMiBands } from '@/maps/pgdata/walkabilityMiBands'
import { SCORE_METRICS, type ScorePaletteProfile } from '../constants'
import type { CorrelationResult } from '../lib/correlation'
import { BIVARIATE_3X3_PALETTE } from '../lib/correlationColors'
import type { ScoreSpread } from '../lib/scoreSummaries'
import type { ScoreMethodSettings, ScoreMetricKey } from '../types'
import { formatMetricValue } from '../lib/metrics'
import type { BcEnviroScreenMapView } from '../lib/bcEnviroScreenMapView'
import { BcEnviroScreenMapLegend } from './BcEnviroScreenMapLegend'

interface ScoreBuilderMapLegendProps {
  correlateMode: boolean
  correlateMetricX: ScoreMetricKey
  correlateMetricY: ScoreMetricKey
  correlateVisStyle: 'bivariate' | 'residual'
  correlationResult: CorrelationResult
  densityMode: boolean
  densityMetric: ScoreMetricKey
  densityRange: { min: number; max: number } | undefined
  showWalkabilitySourceSurface: boolean
  canUseWalkabilitySourceSurface: boolean
  methodSettings: ScoreMethodSettings
  scorePaletteProfile: ScorePaletteProfile
  scoreSpread: ScoreSpread
  enabledDataSourceCount: number
  regionCount: number
  thinCoverageCount: number
  /** Regions the coverage floor is holding out of the ranking. */
  lowCoverageExcludedCount?: number
  bcEnviroScreenMapView?: BcEnviroScreenMapView | null
}

/**
 * The collapsible map legend, switching between the score, correlate, and density maps.
 *
 * It follows the legend pattern of the other map pages: the panel title names what is
 * mapped, then one colour scale and at most a line of figures, in the shared narrow
 * width at every screen size. Explanations belong in the sidebars, not here, because
 * sentence-length notes are what stretched this panel across the map.
 */
export function ScoreBuilderMapLegend({
  correlateMode,
  correlateMetricX,
  correlateMetricY,
  correlateVisStyle,
  correlationResult,
  densityMode,
  densityMetric,
  densityRange,
  showWalkabilitySourceSurface,
  canUseWalkabilitySourceSurface,
  methodSettings,
  scorePaletteProfile,
  scoreSpread,
  enabledDataSourceCount,
  regionCount,
  thinCoverageCount,
  lowCoverageExcludedCount = 0,
  bcEnviroScreenMapView = null,
}: ScoreBuilderMapLegendProps) {
  const walkabilityBands = showWalkabilitySourceSurface || canUseWalkabilitySourceSurface
  // Same resolved MI bands the raster paints with, so a regenerated grid moves
  // the legend too.
  const miBands = useWalkabilityMiBands(walkabilityBands)
  const metricLabel = (key: ScoreMetricKey) => SCORE_METRICS.find((metric) => metric.key === key)?.shortLabel ?? key
  const healthyPlan = methodSettings.aggregation === 'healthyPlanPairwisePriority'

  const { title, description } = correlateMode
    ? {
        title: correlateVisStyle === 'bivariate' ? 'Bivariate map' : 'Residual map',
        description: `${metricLabel(correlateMetricY)} vs ${metricLabel(correlateMetricX)}`,
      }
    : densityMode
      ? { title: 'Density', description: metricLabel(densityMetric) }
      : bcEnviroScreenMapView
        ? { title: bcEnviroScreenMapView.label, description: undefined }
        : walkabilityBands
          ? {
              title: 'Walkability MI',
              description: showWalkabilitySourceSurface ? 'Citywide source grid' : 'Boundary bands',
            }
          : healthyPlan
            ? { title: 'HealthyPlan priority', description: 'Vulnerability > 5, benefit < 6' }
            : {
                title: scorePaletteProfile.label,
                description: methodSettings.mapColorScale === 'absolute' ? 'Fixed 0–100 scale' : 'Current score range',
              }

  return (
    // Collapsed on phones, where the expanded panel covers much of the map.
    <MapLegendPanel title={title} description={description} width="sm" collapsible defaultCollapsed="mobile">
      {correlateMode ? (
        <CorrelationMapLegend visStyle={correlateVisStyle} result={correlationResult} />
      ) : densityMode ? (
        <DensityMapLegend metric={densityMetric} range={densityRange} />
      ) : (
        <>
          {bcEnviroScreenMapView ? (
            <BcEnviroScreenMapLegend view={bcEnviroScreenMapView} showLabel={false} />
          ) : walkabilityBands ? (
            <MapSteppedLegend bands={toWalkabilityMiLegendBands(miBands)} />
          ) : healthyPlan ? (
            <MapSteppedLegend
              bands={HEALTHYPLAN_EQUITY_PRIORITY_RAMP.map((color) => ({ color, label: '' }))}
              labels={['Rank gap 1', 'Rank gap 9']}
            />
          ) : methodSettings.visualOutput === 'binned' ? (
            <MapSteppedLegend
              bands={scorePaletteProfile.colors.map((color) => ({ color, label: '' }))}
              labels={['0', '100']}
            />
          ) : (
            <MapGradientLegendItem
              colors={scorePaletteProfile.colors}
              minLabel={methodSettings.mapColorScale === 'absolute' ? '0' : scoreSpread.min.toFixed(0)}
              maxLabel={methodSettings.mapColorScale === 'absolute' ? '100' : scoreSpread.max.toFixed(0)}
            />
          )}
          <div className="mt-2 text-xs text-muted-foreground">
            {bcEnviroScreenMapView ? (
              <>
                Avg <span className="font-medium text-foreground">{bcEnviroScreenMapView.average.toFixed(2)}</span>
                {' · '}
                {bcEnviroScreenMapView.valueCount} LHAs
              </>
            ) : (
              <>
                Avg <span className="font-medium text-foreground">{scoreSpread.average.toFixed(1)}</span>
                {' · '}
                {regionCount} regions · {enabledDataSourceCount} source{enabledDataSourceCount === 1 ? '' : 's'}
              </>
            )}
          </div>
          {lowCoverageExcludedCount > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {lowCoverageExcludedCount} region{lowCoverageExcludedCount === 1 ? '' : 's'} unranked (thin data).
            </div>
          )}
          {thinCoverageCount > 0 && (
            <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              Thin data in {thinCoverageCount} region{thinCoverageCount === 1 ? '' : 's'}.
            </div>
          )}
        </>
      )}
    </MapLegendPanel>
  )
}

function CorrelationMapLegend({ visStyle, result }: { visStyle: 'bivariate' | 'residual'; result: CorrelationResult }) {
  const stats = result.stats
  return (
    <>
      {visStyle === 'bivariate' ? (
        <div className="flex items-center gap-2">
          <div
            className="grid h-12 w-12 shrink-0 grid-cols-3 grid-rows-3 overflow-hidden rounded border border-border"
            aria-label="Bivariate legend grid"
          >
            {BIVARIATE_3X3_PALETTE.slice()
              .reverse()
              .flatMap((row, rowIdx) =>
                row.map((color, colIdx) => <div key={`bv-${rowIdx}-${colIdx}`} style={{ backgroundColor: color }} />),
              )}
          </div>
          <div className="text-xs leading-tight text-muted-foreground">
            <div>Up = higher Y</div>
            <div className="mt-1">Right = higher X</div>
          </div>
        </div>
      ) : (
        <MapGradientLegendItem colors={['#1d4ed8', '#f1f5f9', '#b91c1c']} minLabel="Below fit" maxLabel="Above fit" />
      )}
      <div className="mt-2 text-xs text-muted-foreground">
        r <span className="font-medium text-foreground">{stats ? stats.pearson.toFixed(2) : '–'}</span>
        {' · '}
        r² <span className="font-medium text-foreground">{stats ? stats.rSquared.toFixed(2) : '–'}</span>
        {' · '}n <span className="font-medium text-foreground">{stats ? stats.n : '–'}</span>
      </div>
    </>
  )
}

function DensityMapLegend({
  metric,
  range,
}: {
  metric: ScoreMetricKey
  range: { min: number; max: number } | undefined
}) {
  // Same units as the Density Lab sidebar's figures.
  return (
    <MapGradientLegendItem
      colors={COLOR_SCALES.amber}
      minLabel={range ? formatMetricValue(metric, range.min, true) : 'Lower'}
      maxLabel={range ? formatMetricValue(metric, range.max, true) : 'Higher'}
    />
  )
}

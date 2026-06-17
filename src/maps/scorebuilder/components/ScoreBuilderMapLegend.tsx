import { MapGradientLegendItem, MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { COLOR_SCALES } from '@/components/ui/map-styles'
import { AppSelect } from '@/components/ui/select'
import { HEALTHYPLAN_EQUITY_PRIORITY_RAMP } from '@/lib/healthyplan'
import {
  SCORE_METRICS,
  SCORE_PALETTE_PROFILES,
  WALKABILITY_REPORT_MI_BANDS,
  type ScorePaletteKey,
  type ScorePaletteProfile,
} from '../constants'
import type { CorrelationResult } from '../lib/correlation'
import { BIVARIATE_3X3_PALETTE } from '../lib/correlationColors'
import type { ScoreSpread } from '../lib/scoreSummaries'
import type { ScoreMethodSettings, ScoreMetricKey } from '../types'

interface ScoreBuilderMapLegendProps {
  isDesktop: boolean
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
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
  scorePaletteProfile: ScorePaletteProfile
  scoreSpread: ScoreSpread
  enabledDataSourceCount: number
  regionCount: number
  thinCoverageCount: number
}

/** The collapsible map legend, switching between score, correlate, and density lenses. */
export function ScoreBuilderMapLegend({
  isDesktop,
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
  onMethodSettingsChange,
  scorePaletteProfile,
  scoreSpread,
  enabledDataSourceCount,
  regionCount,
  thinCoverageCount,
}: ScoreBuilderMapLegendProps) {
  return (
    <MapLegendPanel title="Legend" width={isDesktop ? 'md' : 'sm'} collapsible>
      {correlateMode ? (
        <CorrelationMapLegend
          metricX={correlateMetricX}
          metricY={correlateMetricY}
          visStyle={correlateVisStyle}
          result={correlationResult}
        />
      ) : densityMode ? (
        <DensityMapLegend metric={densityMetric} range={densityRange} />
      ) : (
        <>
          <h4 className="mb-2 text-xs font-semibold text-foreground">
            {showWalkabilitySourceSurface
              ? 'Walkability source MI grid'
              : canUseWalkabilitySourceSurface
                ? 'Walkability boundary MI bands'
                : methodSettings.aggregation === 'healthyPlanPairwisePriority'
                  ? 'HealthyPlan priority'
                  : scorePaletteProfile.label}
          </h4>
          {showWalkabilitySourceSurface || canUseWalkabilitySourceSurface ? (
            <>
              <MapSteppedLegend bands={WALKABILITY_REPORT_MI_BANDS} />
              <div className="mt-2 text-[10px] leading-snug text-muted-foreground">
                {showWalkabilitySourceSurface
                  ? 'Showing the report-style citywide source grid. Click a boundary, or switch Map surface to Boundary map in Study area, to map the Index Lab equation by selected regions.'
                  : 'Boundary polygons use the same report-style Mobility Index bands as the source grid while mapping the Index Lab equation by selected regions.'}
              </div>
            </>
          ) : methodSettings.aggregation === 'healthyPlanPairwisePriority' ? (
            <>
              <MapSteppedLegend
                bands={HEALTHYPLAN_EQUITY_PRIORITY_RAMP.map((color, index) => ({
                  color,
                  label:
                    index === 0
                      ? 'Rank gap 1'
                      : index === HEALTHYPLAN_EQUITY_PRIORITY_RAMP.length - 1
                        ? 'Rank gap 9'
                        : '',
                }))}
                labels={['Rank gap 1', 'Rank gap 9']}
              />
              <div className="mt-2 text-[10px] leading-snug text-muted-foreground">
                Colored regions meet vulnerability decile &gt; 5 and environment benefit decile &lt; 6.
                Uncolored regions do not meet the HealthyPlan threshold.
              </div>
            </>
          ) : (
            <>
              {methodSettings.visualOutput === 'binned' ? (
                <MapSteppedLegend
                  bands={scorePaletteProfile.colors.map((color, index) => ({
                    color,
                    label:
                      index === 0
                        ? scorePaletteProfile.legend.low
                        : index === scorePaletteProfile.colors.length - 1
                          ? scorePaletteProfile.legend.high
                          : '',
                  }))}
                  labels={[scorePaletteProfile.legend.low, scorePaletteProfile.legend.high]}
                />
              ) : (
                <MapGradientLegendItem
                  colors={scorePaletteProfile.colors}
                  minLabel={
                    <>
                      {scorePaletteProfile.legend.low}
                      {' · '}
                      <span className="font-medium text-foreground">
                        {methodSettings.mapColorScale === 'absolute' ? '0' : scoreSpread.min.toFixed(0)}
                      </span>
                    </>
                  }
                  maxLabel={
                    <>
                      {scorePaletteProfile.legend.high}
                      {' · '}
                      <span className="font-medium text-foreground">
                        {methodSettings.mapColorScale === 'absolute' ? '100' : scoreSpread.max.toFixed(0)}
                      </span>
                    </>
                  }
                />
              )}
              {methodSettings.visualOutput === 'binned' ? (
                <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                  Map output uses five fixed score classes: 0-20, 20-40, 40-60, 60-80, 80-100.
                </div>
              ) : (
                <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                  {methodSettings.mapColorScale === 'absolute'
                    ? 'Colors map to a fixed 0–100 score, so they stay put as you adjust the model.'
                    : 'Colors stretch between the current lowest and highest scores, so they shift on every edit.'}
                </div>
              )}
              <div className="mt-3 space-y-2 border-t border-border pt-2">
                <label className="block space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Map output
                  </span>
                  <AppSelect
                    value={methodSettings.visualOutput}
                    onValueChange={(value) =>
                      onMethodSettingsChange({
                        ...methodSettings,
                        visualOutput: value as ScoreMethodSettings['visualOutput'],
                      })
                    }
                    triggerAriaLabel="Map output"
                    options={[
                      { value: 'interpolated', label: 'Interpolated ramp' },
                      { value: 'binned', label: '5 score bins' },
                    ]}
                    triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
                  />
                </label>
                {methodSettings.visualOutput !== 'binned' && (
                  <label className="block space-y-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Color scale
                    </span>
                    <AppSelect
                      value={methodSettings.mapColorScale}
                      onValueChange={(value) =>
                        onMethodSettingsChange({
                          ...methodSettings,
                          mapColorScale: value as ScoreMethodSettings['mapColorScale'],
                        })
                      }
                      triggerAriaLabel="Color scale"
                      options={[
                        { value: 'relative', label: 'Stretch to results' },
                        { value: 'absolute', label: 'Fixed 0–100' },
                      ]}
                      triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
                    />
                  </label>
                )}
                <label className="block space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Palette
                  </span>
                  <AppSelect
                    value={methodSettings.paletteOverride ?? 'auto'}
                    onValueChange={(value) =>
                      onMethodSettingsChange({
                        ...methodSettings,
                        paletteOverride: value === 'auto' ? null : (value as ScorePaletteKey),
                      })
                    }
                    triggerAriaLabel="Palette"
                    options={[
                      { value: 'auto', label: 'Auto (from preset)' },
                      ...Object.values(SCORE_PALETTE_PROFILES).map((profile) => ({
                        value: profile.key,
                        label: profile.label,
                      })),
                    ]}
                    triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
                  />
                </label>
              </div>
            </>
          )}
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
            <div>
              <div className="uppercase">Min</div>
              <div className="font-medium text-foreground">{scoreSpread.min.toFixed(1)}</div>
            </div>
            <div>
              <div className="uppercase">Avg</div>
              <div className="font-medium text-foreground">{scoreSpread.average.toFixed(1)}</div>
            </div>
            <div>
              <div className="uppercase">Max</div>
              <div className="font-medium text-foreground">{scoreSpread.max.toFixed(1)}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            {enabledDataSourceCount} data source(s) active across {regionCount} regions.
          </div>
          {thinCoverageCount > 0 && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              {thinCoverageCount} region{thinCoverageCount === 1 ? '' : 's'} have thin active-data coverage.
            </div>
          )}
        </>
      )}
    </MapLegendPanel>
  )
}

function CorrelationMapLegend({
  metricX,
  metricY,
  visStyle,
  result,
}: {
  metricX: ScoreMetricKey
  metricY: ScoreMetricKey
  visStyle: 'bivariate' | 'residual'
  result: CorrelationResult
}) {
  const xLabel = SCORE_METRICS.find((metric) => metric.key === metricX)?.shortLabel ?? metricX
  const yLabel = SCORE_METRICS.find((metric) => metric.key === metricY)?.shortLabel ?? metricY
  const stats = result.stats
  return (
    <>
      <h4 className="mb-2 text-xs font-semibold text-foreground">
        Correlate · {visStyle === 'bivariate' ? 'Bivariate map' : 'Residual map'}
      </h4>
      {visStyle === 'bivariate' ? (
        <div className="flex items-start gap-2">
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
          <div className="text-[10px] leading-tight text-muted-foreground">
            <div className="font-medium text-foreground">Y · {yLabel}</div>
            <div>up the grid = higher</div>
            <div className="mt-1 font-medium text-foreground">X · {xLabel}</div>
            <div>across the grid = higher</div>
          </div>
        </div>
      ) : (
        <>
          <MapGradientLegendItem
            colors={['#1d4ed8', '#f1f5f9', '#b91c1c']}
            minLabel="Y below fit"
            maxLabel="Y above fit"
          />
          <div className="mt-2 text-[10px] leading-snug text-muted-foreground">
            Color = residual from a least-squares line of {yLabel} on {xLabel}.
          </div>
        </>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
        <div>
          <div className="uppercase">r</div>
          <div className="font-medium text-foreground">{stats ? stats.pearson.toFixed(2) : '–'}</div>
        </div>
        <div>
          <div className="uppercase">r²</div>
          <div className="font-medium text-foreground">{stats ? stats.rSquared.toFixed(2) : '–'}</div>
        </div>
        <div>
          <div className="uppercase">n</div>
          <div className="font-medium text-foreground">{stats ? stats.n : '–'}</div>
        </div>
      </div>
      {stats && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Spearman ρ {stats.spearman.toFixed(2)} · within current boundary level.
        </div>
      )}
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
  const definition = SCORE_METRICS.find((entry) => entry.key === metric)
  const label = definition?.shortLabel ?? metric
  const colors = COLOR_SCALES.amber
  return (
    <>
      <h4 className="mb-2 text-xs font-semibold text-foreground">Density · {label}</h4>
      <MapGradientLegendItem colors={colors} minLabel="Lower" maxLabel="Higher" />
      {range && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
          <div>
            <div className="uppercase">Min</div>
            <div className="font-medium text-foreground">
              {range.min.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="uppercase">Max</div>
            <div className="font-medium text-foreground">
              {range.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      )}
      <div className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Each region colored by its raw value of {label} within the current boundary level.
      </div>
    </>
  )
}

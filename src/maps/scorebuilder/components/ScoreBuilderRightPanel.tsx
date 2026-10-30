import { useClipboardText } from '@/hooks/useClipboardText'
import { useMemo } from 'react'
import { Check, Copy } from 'lucide-react'
import { InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { SCORE_BUILDER_EXAMPLES, SCORE_PRESETS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricWeightMap } from '../types'
import type { ScoreBuilderExportFormat } from '../lib/exportRegions'
import type { BaselineComparisonResult, BaselineSnapshot } from '../lib/baselineComparison'
import { getScoreDrivers } from '../lib/scoreDrivers'
import type { PopulationWeightedEquitySummary } from '../lib/populationSummary'
import { RegionsTab } from './RegionsTab'

interface ScoreBuilderRightPanelProps {
  className?: string
  loading: boolean
  dataErrors: string[]
  weights: ScoreMetricWeightMap
  activePresetKey: string | null
  hasActiveBoundarySurface: boolean
  scoreSpread: { min: number; max: number; average: number }
  populationEquitySummary: PopulationWeightedEquitySummary | null
  regions: ScoredBoundaryRegion[]
  filteredRegions: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onRegionSelect: (regionId: string) => void
  onClearRegionSelection: () => void
  onOpenRegionInsight: (regionId: string) => void
  comparisonIds: string[]
  comparisonRegions: ScoredBoundaryRegion[]
  onToggleComparison: (regionId: string) => void
  onClearComparison: () => void
  onExport: (format: ScoreBuilderExportFormat) => void
  onShareUrl: () => Promise<string>
  activeExampleKey: string | null
  baseline: BaselineSnapshot | null
  baselineComparison: BaselineComparisonResult | null
  onPinBaseline: () => void
  onClearBaseline: () => void
}

/**
 * Results-only desktop panel: the ranked regions. The equation itself is edited in the
 * equation bar and the Build view, never here. Density and correlation have their own
 * labs (`/density-lab`, `/correlation-lab`).
 */
export function ScoreBuilderRightPanel({
  className,
  loading,
  dataErrors,
  weights,
  activePresetKey,
  hasActiveBoundarySurface,
  scoreSpread,
  populationEquitySummary,
  regions,
  filteredRegions,
  selectedRegion,
  searchQuery,
  onSearchQueryChange,
  onRegionSelect,
  onClearRegionSelection,
  onOpenRegionInsight,
  comparisonIds,
  comparisonRegions,
  onToggleComparison,
  onClearComparison,
  onExport,
  onShareUrl,
  activeExampleKey,
  baseline,
  baselineComparison,
  onPinBaseline,
  onClearBaseline,
}: ScoreBuilderRightPanelProps) {
  const { copy, status: shareStatus } = useClipboardText()

  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])
  const activeExample = useMemo(
    () => SCORE_BUILDER_EXAMPLES.find((example) => example.key === activeExampleKey) || null,
    [activeExampleKey],
  )
  const activePreset = useMemo(
    () => SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null,
    [activePresetKey],
  )
  const selectedRegionDrivers = useMemo(
    () => (selectedRegion ? getScoreDrivers(selectedRegion, weights, 2) : []),
    [selectedRegion, weights],
  )
  const handleShare = () => {
    void copy(onShareUrl)
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background/95 shadow-xl backdrop-blur',
        className,
      )}
      data-score-builder-right-panel="true"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-foreground">
              {activeExample?.label || activePreset?.label || 'Custom index'}
            </h1>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {activeExample
                ? activeExample.question
                : activePreset
                  ? activePreset.description
                  : 'Custom weights saved in the URL.'}
            </p>
          </div>
          <button
            type="button"
            data-score-builder-share="true"
            disabled={shareStatus === 'pending'}
            onClick={handleShare}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {shareStatus === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {shareStatus === 'pending'
              ? 'Copying'
              : shareStatus === 'copied'
                ? 'Copied'
                : shareStatus === 'failed'
                  ? 'Failed'
                  : 'Share'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        {dataErrors.length > 0 && (
          <InlineAlert tone="error" title="Unable to build scores" className="m-3 p-3">
            {dataErrors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </InlineAlert>
        )}

        {!hasActiveBoundarySurface && (
          <InlineAlert tone="success" title="Source grid mode" className="m-3 p-3">
            <p className="mt-1 leading-4">
              The map is showing the walkability source grid. Choose a study area to turn boundary rankings back on.
            </p>
          </InlineAlert>
        )}

        {hasActiveBoundarySurface && (
          <RegionsTab
            className="p-4"
            loading={loading}
            regions={regions}
            filteredRegions={filteredRegions}
            selectedRegion={selectedRegion}
            selectedRegionDrivers={selectedRegionDrivers}
            comparisonRegions={comparisonRegions}
            comparisonSet={comparisonSet}
            weights={weights}
            scoreSpread={scoreSpread}
            populationEquitySummary={populationEquitySummary}
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            onRegionSelect={onRegionSelect}
            onClearRegionSelection={onClearRegionSelection}
            onOpenRegionInsight={onOpenRegionInsight}
            onToggleComparison={onToggleComparison}
            onClearComparison={onClearComparison}
            onExport={onExport}
            baseline={baseline}
            baselineComparison={baselineComparison}
            onPinBaseline={onPinBaseline}
            onClearBaseline={onClearBaseline}
          />
        )}
      </div>
    </div>
  )
}

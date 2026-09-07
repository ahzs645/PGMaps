import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type {
  RobustnessResult,
  ScoredBoundaryRegion,
  ScoreBandSummary,
  ScoreComponentSummary,
  ScoreFilterKey,
  ScoreFilterState,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScenarioComparison,
} from '../types'
import { SCORE_PRESETS } from '../constants'
import { MethodologyTab } from './MethodologyTab'
import { ModelTab } from './ModelTab'
import { RobustnessTab } from './RobustnessTab'

type SettingsTab = 'methodology' | 'model' | 'robustness'

const TAB_ORDER: SettingsTab[] = ['methodology', 'model', 'robustness']
const TAB_LABELS: Record<SettingsTab, string> = {
  methodology: 'Methodology',
  model: 'Model & filters',
  robustness: 'Robustness',
}
const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  methodology: 'How the index is composed, normalized, and aggregated.',
  model: 'Filters, normalization, aggregation, and scenario comparison.',
  robustness: 'Stress-tests of the current recipe — rank stability and confidence.',
}

interface ScoreBuilderSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  weights: ScoreMetricWeightMap
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
  componentSummaries: ScoreComponentSummary[]
  activePresetKey: string | null
  totalAbsoluteWeight: number
  scoreFilters: ScoreFilterState
  onToggleScoreFilter: (filter: ScoreFilterKey) => void
  scoreBands: ScoreBandSummary[]
  scenarioComparison: ScenarioComparison | null
  regions: ScoredBoundaryRegion[]
  totalRegionCount: number
  excludedRegionCount: number
  scoreSpread: { min: number; max: number; average: number }
  robustnessResults: RobustnessResult[]
}

/** Method settings and diagnostics. Loading recipes lives in the Recipes dialog. */
export function ScoreBuilderSettingsDialog({
  open,
  onOpenChange,
  weights,
  methodSettings,
  onMethodSettingsChange,
  componentSummaries,
  activePresetKey,
  totalAbsoluteWeight,
  scoreFilters,
  onToggleScoreFilter,
  scoreBands,
  scenarioComparison,
  regions,
  totalRegionCount,
  excludedRegionCount,
  scoreSpread,
  robustnessResults,
}: ScoreBuilderSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('model')
  const activePreset = SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="sheet"
        elevated
        className="sm:max-h-[90vh] sm:w-[min(960px,calc(100vw-2rem))] sm:max-w-[960px]"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>Index settings</DialogTitle>
          <DialogDescription>{TAB_DESCRIPTIONS[activeTab]}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            role="tablist"
            aria-label="Index settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/40 px-3 py-2 md:w-48 md:flex-col md:gap-0.5 md:border-b-0 md:border-r md:px-2 md:py-3"
          >
            {TAB_ORDER.map((tab) => (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'shrink-0 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors',
                  activeTab === tab
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-0">
            {activeTab === 'methodology' && (
              <MethodologyTab
                weights={weights}
                methodSettings={methodSettings}
                componentSummaries={componentSummaries}
                activePreset={activePreset}
              />
            )}
            {activeTab === 'model' && (
              <ModelTab
                weights={weights}
                totalAbsoluteWeight={totalAbsoluteWeight}
                scoreFilters={scoreFilters}
                onToggleScoreFilter={onToggleScoreFilter}
                methodSettings={methodSettings}
                onMethodSettingsChange={onMethodSettingsChange}
                scoreBands={scoreBands}
                scenarioComparison={scenarioComparison}
                regions={regions}
                totalRegionCount={totalRegionCount}
                excludedRegionCount={excludedRegionCount}
                scoreSpread={scoreSpread}
                activePreset={activePreset}
              />
            )}
            {activeTab === 'robustness' && (
              <RobustnessTab robustnessResults={robustnessResults} scenarioComparison={scenarioComparison} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

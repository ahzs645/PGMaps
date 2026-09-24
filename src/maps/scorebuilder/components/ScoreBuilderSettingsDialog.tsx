import { useState } from 'react'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { TabBar } from '@/components/ui/tab-bar'
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

const TAB_OPTIONS: { value: SettingsTab; label: string }[] = [
  { value: 'methodology', label: 'Methodology' },
  { value: 'model', label: 'Model & filters' },
  { value: 'robustness', label: 'Robustness' },
]
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
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Index settings"
      subtitle={TAB_DESCRIPTIONS[activeTab]}
      className="sm:max-h-[90vh] sm:w-[min(960px,calc(100vw-2rem))] sm:max-w-[960px]"
      bodyClassName="flex flex-col p-0 sm:overflow-hidden sm:p-0 md:flex-row"
    >
      {/* A row of tabs on phones, a side rail from md up; only the panel beside it scrolls. */}
      <TabBar
        value={activeTab}
        options={TAB_OPTIONS}
        onChange={setActiveTab}
        label="Index settings sections"
        orientation="responsive"
        className="shrink-0 rounded-none border-b border-border bg-muted/40 px-3 py-2 md:w-48 md:border-b-0 md:border-r md:px-2 md:py-3"
      />
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
    </PanelDialog>
  )
}

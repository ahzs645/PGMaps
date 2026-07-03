import { useState } from 'react'
import { Bookmark, Download, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { buildProjectPackageFromShareState, downloadProjectPackage } from '@/lib/projectPackages'
import type { SavedIndexEntry } from '../lib/savedIndexes'
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
import { ExamplesTab } from './ExamplesTab'
import { MethodologyTab } from './MethodologyTab'
import { ModelTab } from './ModelTab'
import { RobustnessTab } from './RobustnessTab'

type SettingsTab = 'examples' | 'saved' | 'methodology' | 'model' | 'robustness'

const TAB_ORDER: SettingsTab[] = ['examples', 'saved', 'methodology', 'model', 'robustness']
const TAB_LABELS: Record<SettingsTab, string> = {
  examples: 'Examples',
  saved: 'My indexes',
  methodology: 'Methodology',
  model: 'Model & filters',
  robustness: 'Robustness',
}
const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  examples: 'Story-driven recipes that wire boundary, data sources, and weights together.',
  saved: 'Name and reload index recipes saved on this device.',
  methodology: 'How the index is composed, normalized, and aggregated.',
  model: 'Filters, normalization, aggregation, and scenario comparison.',
  robustness: 'Stress-tests of the current recipe — rank stability and confidence.',
}

interface ScoreBuilderSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
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
  savedIndexes: SavedIndexEntry[]
  onSaveIndex: (label: string) => void
  onApplySavedIndex: (id: string) => void
  onDeleteSavedIndex: (id: string) => void
  onExportProjectPackage?: (label: string) => void
  activeRecipeLabel: string
}

export function ScoreBuilderSettingsDialog({
  open,
  onOpenChange,
  activeExampleKey,
  onApplyExample,
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
  savedIndexes,
  onSaveIndex,
  onApplySavedIndex,
  onDeleteSavedIndex,
  onExportProjectPackage,
  activeRecipeLabel,
}: ScoreBuilderSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('methodology')
  const [saveLabel, setSaveLabel] = useState('')

  const activePreset = SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null

  const handleApplyExample = (key: string) => {
    onApplyExample(key)
    onOpenChange(false)
  }

  const handleSaveIndex = () => {
    const label = saveLabel.trim() || activeRecipeLabel
    onSaveIndex(label)
    setSaveLabel('')
  }

  const handleApplySaved = (id: string) => {
    onApplySavedIndex(id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent elevated className="max-h-[90vh] w-[min(960px,calc(100vw-2rem))] overflow-hidden p-0 sm:max-w-[960px]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Index settings</DialogTitle>
          <DialogDescription>{TAB_DESCRIPTIONS[activeTab]}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[calc(90vh-5rem)] min-h-0 flex-col md:flex-row">
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
                  'rounded-md px-3 py-2 text-left text-xs font-medium transition-colors',
                  activeTab === tab
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'examples' && (
              <ExamplesTab activeExampleKey={activeExampleKey} onApplyExample={handleApplyExample} />
            )}
            {activeTab === 'saved' && (
              <div className="space-y-4 p-4" data-score-builder-saved-indexes="true">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-xs font-semibold text-foreground">Save current index</div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Stores the boundary, data sources, weights, custom metrics, and method settings on this device.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={saveLabel}
                      onChange={(event) => setSaveLabel(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleSaveIndex()
                      }}
                      placeholder={activeRecipeLabel}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveIndex}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cyan-500 bg-cyan-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-cyan-600"
                    >
                      <Bookmark className="h-3.5 w-3.5" />
                      Save
                    </button>
                    {onExportProjectPackage && (
                      <button
                        type="button"
                        onClick={() => onExportProjectPackage(saveLabel)}
                        title="Download the current recipe as a project package file"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Package
                      </button>
                    )}
                  </div>
                  {onExportProjectPackage && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      A package file can be imported on the Projects page or shared with someone else.
                    </p>
                  )}
                </div>

                {savedIndexes.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    No saved indexes yet. Save the current recipe above to reload it later.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedIndexes.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{entry.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            Saved {new Date(entry.savedAt).toLocaleDateString()} ·{' '}
                            {entry.state.enabledDataSources.length} sources
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleApplySaved(entry.id)}
                            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              downloadProjectPackage(buildProjectPackageFromShareState(entry.state, entry.label))
                            }
                            title="Download as project package"
                            aria-label={`Download ${entry.label} as a project package`}
                            className="rounded-md border border-input p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSavedIndex(entry.id)}
                            title="Delete saved index"
                            aria-label={`Delete ${entry.label}`}
                            className="rounded-md border border-input p-1.5 text-muted-foreground transition-colors hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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

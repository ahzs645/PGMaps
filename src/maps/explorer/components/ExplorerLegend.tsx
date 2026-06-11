import { ChevronDown, ChevronUp, Layers } from 'lucide-react'
import { LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { datasetById, GEOMETRY_TYPE_LABEL } from '../constants'
import type { ExplorerDatasetDefinition, ExplorerDatasetStat, ExplorerItem } from '../types'

interface ExplorerLegendProps {
  legendDatasets: ExplorerDatasetDefinition[]
  datasetStats: ExplorerDatasetStat[]
  selectedItem: ExplorerItem | null
  showHeatmap: boolean
  onToggleHeatmap: () => void
  showMobileLegend: boolean
  onToggleMobileLegend: () => void
}

export function ExplorerLegend({
  legendDatasets,
  datasetStats,
  selectedItem,
  showHeatmap,
  onToggleHeatmap,
  showMobileLegend,
  onToggleMobileLegend,
}: ExplorerLegendProps) {
  return (
    <MapLegendPanel
      title="Active Layers"
      icon={<Layers className="h-3.5 w-3.5 shrink-0" />}
      collapsible
      contentClassName={cn('mt-2 space-y-1 md:mt-0 md:block', showMobileLegend ? 'block' : 'hidden')}
      actions={
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:hidden">
            {legendDatasets.length}
          </span>
          <button
            type="button"
            onClick={onToggleMobileLegend}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground md:hidden"
            aria-label={showMobileLegend ? 'Hide active layer legend' : 'Show active layer legend'}
            aria-expanded={showMobileLegend}
          >
            {showMobileLegend ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onToggleHeatmap}
            className={`hidden rounded border px-2 py-0.5 text-[10px] font-medium transition-colors md:inline-flex ${
              showHeatmap
                ? 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
                : 'border-input text-muted-foreground hover:text-foreground'
            }`}
          >
            {showHeatmap ? 'Heatmap ON' : 'Heatmap'}
          </button>
        </div>
      }
    >
      <MapLegendSection>
        <button
          onClick={onToggleHeatmap}
          className={`mb-1 inline-flex rounded border px-2 py-0.5 text-[10px] font-medium transition-colors md:hidden ${
            showHeatmap
              ? 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
              : 'border-input text-muted-foreground hover:text-foreground'
          }`}
        >
          {showHeatmap ? 'Heatmap ON' : 'Heatmap'}
        </button>
        {legendDatasets.slice(0, 8).map((dataset) => {
          const stat = datasetStats.find((entry) => entry.dataset.id === dataset.id)
          return (
            <LegendItem
              key={dataset.id}
              color={dataset.color}
              label={dataset.label}
              value={`${GEOMETRY_TYPE_LABEL[dataset.geometryType]} | ${stat?.count.toLocaleString() || 0}`}
            />
          )
        })}
        {legendDatasets.length === 0 && (
          <div className="text-xs text-muted-foreground">No active layers in current filter.</div>
        )}
        {legendDatasets.length > 8 && (
          <div className="pt-1 text-xs text-muted-foreground">+{legendDatasets.length - 8} more layers</div>
        )}
      </MapLegendSection>
      {selectedItem && (
        <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Selected: <span className="font-medium text-foreground">{selectedItem.name}</span>
          <div>
            {datasetById(selectedItem.datasetId).label} | relevance {Math.round(selectedItem.relevance)}
          </div>
        </div>
      )}
    </MapLegendPanel>
  )
}

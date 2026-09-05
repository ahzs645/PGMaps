import { useState } from 'react'
import { Layers } from 'lucide-react'
import { LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { datasetById, GEOMETRY_TYPE_LABEL } from '../constants'
import type { ExplorerDatasetDefinition, ExplorerDatasetStat, ExplorerItem } from '../types'

interface ExplorerLegendProps {
  legendDatasets: ExplorerDatasetDefinition[]
  datasetStats: ExplorerDatasetStat[]
  selectedItem: ExplorerItem | null
  /** Show one detail at a time; counts are the default. */
  defaultDetailDisplay?: 'count' | 'type'
  /** Disable to keep the configured detail fixed. */
  allowDetailToggle?: boolean
}

export function ExplorerLegend({
  legendDatasets,
  datasetStats,
  selectedItem,
  defaultDetailDisplay = 'count',
  allowDetailToggle = true,
}: ExplorerLegendProps) {
  const [detailDisplay, setDetailDisplay] = useState(defaultDetailDisplay)
  const display = allowDetailToggle ? detailDisplay : defaultDetailDisplay
  const nextDisplay = display === 'count' ? 'type' : 'count'
  const toggleDetails = () => setDetailDisplay(nextDisplay)

  return (
    <MapLegendPanel
      title="Active Layers"
      icon={<Layers className="h-3.5 w-3.5 shrink-0" />}
      collapsible
      contentClassName="space-y-1"
    >
      <div
        role={allowDetailToggle ? 'button' : undefined}
        tabIndex={allowDetailToggle ? 0 : undefined}
        aria-label={
          allowDetailToggle
            ? `Active layer ${display === 'count' ? 'counts' : 'types'}. Show all ${nextDisplay === 'count' ? 'counts' : 'types'}`
            : undefined
        }
        onClick={allowDetailToggle ? toggleDetails : undefined}
        onKeyDown={
          allowDetailToggle
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggleDetails()
                }
              }
            : undefined
        }
        className={
          allowDetailToggle
            ? '-m-2 rounded-md p-2 cursor-pointer touch-manipulation hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : undefined
        }
      >
        <MapLegendSection>
          {legendDatasets.slice(0, 8).map((dataset) => {
            const stat = datasetStats.find((entry) => entry.dataset.id === dataset.id)
            return (
              <LegendItem
                key={dataset.id}
                color={dataset.color}
                label={dataset.label}
                className="min-h-8 md:min-h-6"
                value={
                  display === 'count' ? (stat?.count ?? 0).toLocaleString() : GEOMETRY_TYPE_LABEL[dataset.geometryType]
                }
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
          <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            Selected: <span className="font-medium text-foreground">{selectedItem.name}</span>
            <div>
              {datasetById(selectedItem.datasetId).label} | relevance {Math.round(selectedItem.relevance)}
            </div>
          </div>
        )}
      </div>
    </MapLegendPanel>
  )
}

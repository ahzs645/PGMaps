import { LegendItem, MapGradientLegendItem, ToggleChip } from '@/components/ui/map-panels'
import { formatDate } from '../shared'
import { formatMetricValue, getBoundaryMetricLabel } from './utils'
import type { WaterPointCategory } from './types'
import type { WaterState } from './useWaterData'

export function WaterLayerControls({ water }: { water: WaterState }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleChip
        active={water.showPoints}
        onClick={() => water.setShowPoints((current) => !current)}
      >
        {water.showPoints ? 'Hide points' : 'Show points'}
      </ToggleChip>
      <ToggleChip
        active={water.showHeatmap}
        onClick={() => water.setShowHeatmap((current) => !current)}
        tone="cyan"
      >
        {water.showHeatmap ? 'Hide heatmap' : 'Show heatmap'}
      </ToggleChip>
      <ToggleChip
        active={water.timelineEnabled}
        onClick={() => water.setTimelineEnabled((current) => !current)}
        tone="violet"
      >
        {water.timelineEnabled ? 'Hide timeline' : 'Show timeline'}
      </ToggleChip>
    </div>
  )
}

export function WaterLegend({ water }: { water: WaterState }) {
  const togglePointCategory = (category: WaterPointCategory) => {
    if (!water.showPoints) {
      water.setShowPoints(true)
      if (!water.visiblePointCategories.includes(category)) water.togglePointCategory(category)
      return
    }
    water.togglePointCategory(category)
  }

  return (
    <div className="w-full space-y-2 text-xs text-muted-foreground md:w-56">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Drinking water</span>
      </div>
      <LegendItem
        color="#2563eb"
        label="Facility"
        active={water.showPoints && water.visiblePointCategories.includes('facility')}
        onClick={() => togglePointCategory('facility')}
      />
      <LegendItem
        color="#0891b2"
        label="Sampling activity"
        active={water.showPoints && water.visiblePointCategories.includes('samples')}
        onClick={() => togglePointCategory('samples')}
      />
      <LegendItem
        color="#dc2626"
        label="Active notice"
        active={water.showPoints && water.visiblePointCategories.includes('notice')}
        onClick={() => togglePointCategory('notice')}
      />
      <LegendItem
        color="#7dd3fc"
        label={getBoundaryMetricLabel(water.boundaryMetric)}
        active={water.showBoundaries}
        onClick={() => water.setShowBoundaries((current) => !current)}
      />
      {water.showBoundaries && (
        <div className="px-1">
          <MapGradientLegendItem
            colors={['#e0f2fe', '#38bdf8', '#075985']}
            minLabel="0"
            maxLabel={formatMetricValue(water.boundaryMaxValue, water.boundaryMetric)}
          />
        </div>
      )}
    </div>
  )
}

export function WaterSourceNotes({ water }: { water: WaterState }) {
  const summary = water.combinedNoticesSummary.data
  return (
    <>
      <p>Drinking water extracts updated {formatDate(water.manifest.data?.generatedAt)}.</p>
      <p>
        Includes facilities, bacteriological samples, chemical results, and a combined active notices layer from HealthSpace and WaterToday
        {summary?.combined_count ? ` (${summary.combined_count.toLocaleString()} canonical notices, ${summary.with_coordinates?.toLocaleString() ?? 'all'} mapped).` : '.'}
      </p>
    </>
  )
}

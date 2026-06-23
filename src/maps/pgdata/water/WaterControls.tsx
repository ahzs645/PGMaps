import { InlineAlert, LegendItem, MapGradientLegendItem, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { formatDate } from '../shared'
import { WATER_HAZARD_DOT_COLORS } from './constants'
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
  const activePointItem: { category: WaterPointCategory; color: string; label: string } = water.layerMode === 'samples'
    ? { category: 'samples', color: '#0891b2', label: 'Sampling activity' }
    : water.layerMode === 'notices'
      ? { category: 'notice', color: '#dc2626', label: 'Active notice' }
      : { category: 'facility', color: WATER_HAZARD_DOT_COLORS.Unknown, label: 'Facilities by hazard' }

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
        color={activePointItem.color}
        label={activePointItem.label}
        active={water.showPoints && water.visiblePointCategories.includes(activePointItem.category)}
        onClick={() => togglePointCategory(activePointItem.category)}
      />
      {water.layerMode === 'facilities' && water.showPoints && water.visiblePointCategories.includes('facility') && (
        <div className="space-y-1 border-l border-border/70 pl-2">
          {water.hazardOptions.map((rating) => (
            <LegendItem
              key={rating}
              color={WATER_HAZARD_DOT_COLORS[rating] ?? WATER_HAZARD_DOT_COLORS.Unknown}
              label={rating}
              value={(water.hazardCounts[rating] ?? 0).toLocaleString()}
              className="text-[11px]"
            />
          ))}
        </div>
      )}
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
  const facilityRecordCount = Object.values(water.facilityTypeCounts).reduce((sum, count) => sum + count, 0)
  const noticeOnlyPointCount = Math.max(0, water.facilities.length - facilityRecordCount)
  return (
    <>
      <p>Drinking water extracts updated {formatDate(water.manifest.data?.generatedAt)}.</p>
      <p>
        Includes facilities, bacteriological samples, chemical results, and a combined active notices layer from HealthSpace and WaterToday
        {summary?.combined_count ? ` (${summary.combined_count.toLocaleString()} canonical notices, ${summary.with_coordinates?.toLocaleString() ?? 'all'} mapped).` : '.'}
      </p>
      <div className="space-y-2 pt-1">
        <InlineAlert>
          Facilities, samples, and active public notices are joined where the facility names match.
        </InlineAlert>
        <StatGrid
          columns={2}
          stats={[
            { label: 'facilities', value: facilityRecordCount.toLocaleString() },
            { label: 'sample/result rows', value: water.samples.length.toLocaleString() },
            { label: 'active notices', value: (summary?.combined_count ?? water.visibleNoticeCount).toLocaleString() },
            { label: 'notice-only points', value: noticeOnlyPointCount.toLocaleString() },
          ]}
        />
        <StatGrid
          columns={2}
          stats={[
            { label: 'combined notices', value: (summary?.combined_count ?? 0).toLocaleString() },
            { label: 'mapped notices', value: (summary?.with_coordinates ?? water.visibleNoticeCount).toLocaleString() },
            { label: 'HealthSpace', value: (summary?.healthspace_count ?? 0).toLocaleString() },
            { label: 'WaterToday', value: (summary?.watertoday_count ?? 0).toLocaleString() },
          ]}
        />
        <InlineAlert>
          {summary?.with_multiple_sources?.toLocaleString() ?? 'Some'} notices have multiple source matches; unmatched WaterToday notices still draw as notice-only points when coordinates are available.
        </InlineAlert>
      </div>
    </>
  )
}

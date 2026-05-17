import { ExternalLink, Layers } from 'lucide-react'
import { InlineAlert, MapSteppedLegend, SelectedItemCard, SidebarSection, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DROUGHT_LEVELS } from '../constants'
import type { DroughtFeature, DroughtManifest } from '../types'

interface DroughtSidebarProps {
  className?: string
  manifest: DroughtManifest | null
  selectedYear: number
  availableYears: number[]
  visibleCount: number
  totalCount: number
  loading: boolean
  error: string | null
  selectedFeature: DroughtFeature | null
  timelineEnabled: boolean
  onYearChange: (year: number) => void
  onClearSelection: () => void
  onToggleTimeline: () => void
}

function getReadableTextColor(backgroundColor: string): '#000000' | '#ffffff' {
  const hex = backgroundColor.replace('#', '')
  const [red, green, blue] = [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16))
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255

  return luminance > 0.55 ? '#000000' : '#ffffff'
}

export function DroughtSidebar({
  className,
  manifest,
  selectedYear,
  availableYears,
  visibleCount,
  totalCount,
  loading,
  error,
  selectedFeature,
  timelineEnabled,
  onYearChange,
  onClearSelection,
  onToggleTimeline,
}: DroughtSidebarProps) {
  const selectedYearInfo = manifest?.years.find((item) => item.year === selectedYear)

  return (
    <aside className={cn('flex h-full flex-col overflow-hidden bg-background', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarSection
          title="Historical Drought Levels"
          icon={Layers}
          iconClassName="text-amber-600"
          actions={(
            <ToggleChip active={timelineEnabled} onClick={onToggleTimeline} tone="amber">
              Timeline
            </ToggleChip>
          )}
        >
          <div className="space-y-3">
            <label className="block text-xs font-medium text-foreground" htmlFor="drought-year">
              Year
              <AppSelect
                id="drought-year"
                value={String(selectedYear)}
                onValueChange={(value) => onYearChange(Number(value))}
                options={availableYears.map((year) => ({ value: String(year), label: year }))}
                disabled={availableYears.length === 0}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>

            <StatGrid
              stats={[
                { label: 'visible', value: visibleCount.toLocaleString() },
                { label: 'year rows', value: totalCount.toLocaleString() },
                { label: 'year', value: selectedYear },
              ]}
            />

            <InlineAlert>
              Drought basin polygons from the provincial time-lapse services, normalized for PGMaps.
            </InlineAlert>

            {loading && <InlineAlert>Loading drought polygons...</InlineAlert>}
            {error && <InlineAlert tone="error">{error}</InlineAlert>}
          </div>
        </SidebarSection>

        <SidebarSection title="Legend">
          <MapSteppedLegend
            bands={[
              ...DROUGHT_LEVELS.map((item) => ({
                label: item.label,
                color: item.color,
                textColor: getReadableTextColor(item.color),
                swatchLabel: item.level,
              })),
              { label: 'Not updated / no numeric level', color: '#8a8f98', swatchLabel: '' },
            ]}
            variant="rows"
          />
        </SidebarSection>

        {selectedFeature && (
          <SidebarSection title="Selected Basin">
            <SelectedItemCard
              title={selectedFeature.properties.basinName || 'Drought basin'}
              onClear={onClearSelection}
              rows={[
                { label: 'Level', value: selectedFeature.properties.droughtLevelRaw ?? 'Not updated' },
                { label: 'Start', value: selectedFeature.properties.startDate ?? 'Unknown' },
                { label: 'End', value: selectedFeature.properties.endDate ?? 'Unknown' },
              ]}
            />
          </SidebarSection>
        )}

        {selectedYearInfo && (
          <SidebarSection title="Source">
            <div className="space-y-2 text-xs text-muted-foreground">
              <div>Source range: {selectedYearInfo.startDate ?? 'unknown'} to {selectedYearInfo.endDate ?? 'unknown'}</div>
              <div>{selectedYearInfo.featureCount.toLocaleString()} source rows for {selectedYear}.</div>
              <a
                href={selectedYearInfo.layerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                ArcGIS REST layer
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </SidebarSection>
        )}
      </div>
    </aside>
  )
}

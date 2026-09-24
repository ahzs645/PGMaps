import { Layers } from 'lucide-react'
import {
  InlineAlert,
  MapSidebarShell,
  MapSteppedLegend,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
  ToggleChip,
} from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { ExternalLink } from '@/components/ui/text-button'
import { readableTextColor } from '@/lib/color'
import { DATASETS } from '@/lib/dataCatalog'
import { formatNumber } from '@/lib/format'
import { DROUGHT_LEVELS } from '../constants'
import type { DroughtFeature, DroughtManifest } from '../types'
import { DroughtBasinDetails } from './DroughtBasinDetails'

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
  showSelectedFeature?: boolean
  timelineEnabled: boolean
  onYearChange: (year: number) => void
  onClearSelection: () => void
  onToggleTimeline: () => void
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
  showSelectedFeature = true,
  timelineEnabled,
  onYearChange,
  onClearSelection,
  onToggleTimeline,
}: DroughtSidebarProps) {
  const selectedYearInfo = manifest?.years.find((item) => item.year === selectedYear)

  return (
    <MapSidebarShell
      className={className}
      title="Historical Drought Levels"
      dataset={DATASETS.drought}
      icon={Layers}
      iconClassName="bg-amber-500/10 text-amber-600"
      actions={
        <ToggleChip active={timelineEnabled} onClick={onToggleTimeline} tone="amber" className="touch:min-h-10">
          Timeline
        </ToggleChip>
      }
    >
      <SidebarSection>
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
              { label: 'visible', value: formatNumber(visibleCount) },
              { label: 'year rows', value: formatNumber(totalCount) },
              { label: 'year', value: selectedYear },
            ]}
          />

          <InlineAlert>
            Drought basin polygons from the provincial time-lapse services, normalized for PGMaps.
          </InlineAlert>

          {loading && <InlineAlert loading>Loading drought polygons...</InlineAlert>}
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
        </div>
      </SidebarSection>

      <SidebarSection title="Legend">
        <MapSteppedLegend
          bands={[
            ...DROUGHT_LEVELS.map((item) => ({
              label: item.label,
              color: item.color,
              textColor: readableTextColor(item.color, { threshold: 0.55, dark: '#000000', weights: '709' }),
              swatchLabel: item.level,
            })),
            { label: 'Not updated / no numeric level', color: '#8a8f98', swatchLabel: '' },
          ]}
          variant="rows"
        />
      </SidebarSection>

      {showSelectedFeature && selectedFeature && (
        <SidebarSection title="Selected Basin">
          <SelectedItemCard title={selectedFeature.properties.basinName || 'Drought basin'} onClear={onClearSelection}>
            <DroughtBasinDetails feature={selectedFeature} className="mt-2" />
          </SelectedItemCard>
        </SidebarSection>
      )}

      {selectedYearInfo && (
        <SidebarSection title="Source">
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>Source range: {selectedYearInfo.startDate ?? 'unknown'} to {selectedYearInfo.endDate ?? 'unknown'}</div>
            <div>{formatNumber(selectedYearInfo.featureCount)} source rows for {selectedYear}.</div>
            <ExternalLink href={selectedYearInfo.layerUrl}>ArcGIS REST layer</ExternalLink>
          </div>
        </SidebarSection>
      )}
    </MapSidebarShell>
  )
}

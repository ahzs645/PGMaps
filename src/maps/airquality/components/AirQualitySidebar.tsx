import { useMemo, useRef } from 'react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import {
  FilterChipGroup,
  InlineAlert,
  KeyValueRows,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { ListState, ResultRow } from '@/components/ui/result-list'
import { StatGroup } from '@/components/ui/stat-group'
import {
  FilterToggleButton,
  ResetFiltersButton,
  StickyListToolbar,
  useRevealBelowSticky,
  useStickyListToolbar,
} from '@/components/ui/sticky-list-toolbar'
import { SelectAllActions } from '@/components/ui/text-button'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { DATASETS } from '@/lib/dataCatalog'
import { DEFAULT_LOCALE } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getNetworkColor } from '../constants'
import { calculateCorrectedPm25, formatPm25 } from '../lib/corrections'
import { monitorEntryKey, uniqueParameters } from '../lib/monitorPopup'
import type { AirQualityActions, AirQualityViewState } from '../hooks/useAirQualityState'
import type {
  AirMonitor,
  AirQualityAreaStats,
  AirQualityBoundaryColorMetric,
  BoundarySource,
  RegionLevel,
  SensorDensityStats,
} from '../types'
import { CorrectionSummary } from './CorrectionSummary'

interface AirQualitySidebarProps {
  className?: string
  state: AirQualityViewState
  actions: AirQualityActions
  monitors: AirMonitor[]
  filteredMonitors: AirMonitor[]
  visibleMonitorCount: number
  visibleMonitorCountLabel: string
  regionLevelOptions: Array<{ value: RegionLevel; label: string }>
  boundaryLoading: boolean
  boundaryError: string | null
  densityStats: SensorDensityStats | null
  areaStats: AirQualityAreaStats | null
  densityScopeLabel: string
  loading: boolean
  error: string | null
}

const BOUNDARY_COLOR_OPTIONS: Array<{ value: AirQualityBoundaryColorMetric; label: string }> = [
  { value: 'sensorCount', label: 'Total sensors' },
  { value: 'overallDensity', label: 'Sensors per km²' },
  { value: 'lowCostDensity', label: 'Low-cost sensors per km²' },
  { value: 'otherDensity', label: 'Other sensors per km²' },
  { value: 'correctedPm25', label: 'Corrected PM2.5' },
  { value: 'rawPm25', label: 'Raw PM2.5' },
  { value: 'networkCount', label: 'Networks' },
]

function formatDensityValue(value: number, count: number): string {
  if (!Number.isFinite(value) || value <= 0 || count <= 0) return 'None'
  return `1 per ${(1 / value).toFixed(1)} km²`
}

export function AirQualitySidebar({
  className,
  state,
  actions,
  monitors,
  filteredMonitors,
  visibleMonitorCount,
  visibleMonitorCountLabel,
  regionLevelOptions,
  boundaryLoading,
  boundaryError,
  densityStats,
  areaStats,
  densityScopeLabel,
  loading,
  error,
}: AirQualitySidebarProps) {
  const {
    searchQuery,
    selectedNetworks,
    showHeatmap,
    showPoints,
    boundariesVisible,
    boundarySource,
    selectedRegionLevel,
    boundaryColorMetric,
    correctionModel,
    selectedMonitor,
  } = state
  const networkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    monitors.forEach((monitor) => {
      counts.set(monitor.network, (counts.get(monitor.network) || 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [monitors])

  const { toolbarRef, filtersPanelId, filtersOpen, toggleFilters } = useStickyListToolbar()
  const selectedCardRef = useRef<HTMLDivElement>(null)
  // A pick on the map inserts the card above the list, out of view once the list has scrolled.
  useRevealBelowSticky(toolbarRef, selectedCardRef, selectedMonitor?.id)

  const selectedMonitorParameters = useMemo(() => {
    if (!selectedMonitor) return []
    return uniqueParameters(selectedMonitor.parameters)
  }, [selectedMonitor])

  const selectedMonitorCorrection = useMemo(() => {
    if (!selectedMonitor) return null
    return calculateCorrectedPm25(selectedMonitor, correctionModel)
  }, [correctionModel, selectedMonitor])

  const allNetworksSelected = networkCounts.every(([network]) => selectedNetworks.includes(network))
  const noNetworksSelected = networkCounts.every(([network]) => !selectedNetworks.includes(network))
  const hasActiveFilters = !allNetworksSelected || searchQuery !== ''
  const resetFilters = () => {
    actions.setSearchQuery('')
    actions.setNetworks([...selectedNetworks, ...networkCounts.map(([network]) => network)])
  }

  return (
    <MapSidebarShell
      className={cn('relative', className)}
      title="Air Quality"
      subtitle="Monitoring Networks"
      dataset={DATASETS.airQuality}
      actions={
        <>
          <ToggleChip active={showPoints} onClick={actions.togglePoints} tone="sky">
            {showPoints ? 'Hide points' : 'Show points'}
          </ToggleChip>
          <ToggleChip active={showHeatmap} onClick={actions.toggleHeatmap} tone="orange">
            Heatmap
          </ToggleChip>
        </>
      }
    >
      <StudyAreaSelector<BoundarySource, RegionLevel>
        source={boundariesVisible ? boundarySource : undefined}
        sourceOptions={BOUNDARY_SOURCE_OPTIONS}
        level={selectedRegionLevel}
        levelOptions={boundariesVisible ? regionLevelOptions : []}
        onSourceChange={actions.setBoundarySource}
        onSelectedSourceClick={actions.clearBoundaries}
        onLevelChange={actions.setRegionLevel}
        levelSelectId="air-quality-study-area-level"
      />

      {(boundaryLoading || boundaryError) && (
        <div className="space-y-2 border-b border-border bg-background/95 px-4 pb-4">
          {boundaryLoading && <InlineAlert loading>Loading boundaries...</InlineAlert>}
          {boundaryError && <InlineAlert tone="error">{boundaryError}</InlineAlert>}
        </div>
      )}

      {densityStats && (
        <SidebarSection title="Area Summary">
          <div className="space-y-2 text-sm">
            <div>
              <label htmlFor="air-quality-boundary-color" className="mb-1.5 block text-xs font-medium text-foreground">
                Polygon color
              </label>
              <AppSelect
                id="air-quality-boundary-color"
                value={boundaryColorMetric}
                onValueChange={(value) => actions.setBoundaryColorMetric(value as AirQualityBoundaryColorMetric)}
                options={BOUNDARY_COLOR_OPTIONS}
                triggerClassName="h-8 text-xs"
              />
            </div>
            {areaStats && (
              <>
                <StatGroup
                  variant="tiles"
                  size="sm"
                  columns={2}
                  items={[
                    { key: 'corrected', label: 'Corrected PM2.5', value: formatPm25(areaStats.correctedPm25Average), compact: true },
                    { key: 'raw', label: 'Raw PM2.5', value: formatPm25(areaStats.rawPm25Average), compact: true },
                    { key: 'sensors', label: 'PM2.5 sensors', value: areaStats.pm25MonitorCount.toLocaleString(DEFAULT_LOCALE) },
                    { key: 'networks', label: 'Networks', value: areaStats.networkCount.toLocaleString(DEFAULT_LOCALE) },
                  ]}
                />
                {(areaStats.correctedPm25Min !== null || areaStats.correctedPm25Max !== null) && (
                  <KeyValueRows
                    valueMaxWidth={null}
                    valueClassName="font-normal text-muted-foreground"
                    rows={[
                      {
                        label: 'Corrected range:',
                        value: `${formatPm25(areaStats.correctedPm25Min)} - ${formatPm25(areaStats.correctedPm25Max)}`,
                      },
                    ]}
                  />
                )}
              </>
            )}
            <KeyValueRows
              size="sm"
              valueMaxWidth={null}
              rows={[
                { key: 'lowCost', label: 'Low-cost:', value: formatDensityValue(densityStats.lowCost, densityStats.lowCostCount) },
                { key: 'other', label: 'Other:', value: formatDensityValue(densityStats.other, densityStats.otherCount) },
              ]}
            />
            <KeyValueRows
              size="sm"
              valueMaxWidth={null}
              className="border-t pt-2"
              labelClassName="font-medium text-foreground"
              valueClassName="font-semibold"
              rows={[
                { key: 'overall', label: 'Overall:', value: formatDensityValue(densityStats.overall, densityStats.totalCount) },
              ]}
            />
            <div className="pt-1 text-xs text-muted-foreground">{densityScopeLabel}</div>
            <KeyValueRows
              valueMaxWidth={null}
              valueClassName="font-normal text-muted-foreground"
              rows={[
                { key: 'area', label: 'Search area:', value: `${densityStats.areaKm2.toFixed(1)} km²` },
                densityStats.actualCoverageKm2 > 0 && {
                  key: 'coverage',
                  label: 'Actual coverage:',
                  value: `${densityStats.actualCoverageKm2.toFixed(1)} km² (${densityStats.coveragePercent.toFixed(1)}%)`,
                },
                {
                  key: 'total',
                  label: <span className="font-medium text-foreground">Total sensors:</span>,
                  value: <span className="font-medium text-foreground">{densityStats.totalCount}</span>,
                },
              ]}
            />
          </div>
        </SidebarSection>
      )}

      {/* Search and the network filter stay reachable while the list scrolls. */}
      <StickyListToolbar
        ref={toolbarRef}
        search={
          <SearchInput
            value={searchQuery}
            onChange={(event) => actions.setSearchQuery(event.target.value)}
            onClear={() => actions.setSearchQuery('')}
            icon
            placeholder="Search monitors, city, network, parameter..."
            aria-label="Search monitors"
            className="focus:ring-sky-500"
          />
        }
        controls={
          <>
            <FilterToggleButton
              open={filtersOpen}
              onToggle={toggleFilters}
              panelId={filtersPanelId}
              label="Networks"
              activeCount={allNetworksSelected ? 0 : 1}
            />
            {hasActiveFilters && <ResetFiltersButton onClick={resetFilters} />}
          </>
        }
        count={
          !loading && !error ? (
            <>
              {visibleMonitorCount.toLocaleString(DEFAULT_LOCALE)} {visibleMonitorCountLabel}
            </>
          ) : undefined
        }
      />

      {filtersOpen && (
        <div id={filtersPanelId} className="space-y-2 border-b border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-foreground">Networks</h3>
            <SelectAllActions
              onAll={() => actions.setNetworks(networkCounts.map(([network]) => network))}
              onNone={() => actions.setNetworks([])}
              allSelected={allNetworksSelected}
              noneSelected={noNetworksSelected}
            />
          </div>
          <FilterChipGroup
            variant="filled"
            items={networkCounts.map(([network, count]) => ({
              value: network,
              label: network,
              count,
              color: getNetworkColor(network),
            }))}
            selectedValues={selectedNetworks}
            onToggle={actions.toggleNetwork}
            className="max-h-48 overflow-y-auto"
            chipClassName="px-3 py-1"
          />
        </div>
      )}

      {selectedMonitor && (
        <div ref={selectedCardRef} className="border-b border-border bg-background/95 p-4">
          <SelectedItemCard
            tone="sky"
            title={selectedMonitor.name}
            subtitle={
              [selectedMonitor.city, selectedMonitor.province].filter(Boolean).join(', ') || 'Location available'
            }
            onClear={actions.clearMonitor}
            clearLabel="Clear selected monitor"
            badges={
              <>
                <span className="flex items-center gap-1 rounded border border-sky-300/60 bg-sky-100/70 px-1.5 py-0.5 text-xs font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/50 dark:text-sky-100">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: getNetworkColor(selectedMonitor.network) }}
                  />
                  {selectedMonitor.network}
                </span>
                {selectedMonitor.status && (
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium uppercase dark:bg-sky-900/60">
                    {selectedMonitor.status}
                  </span>
                )}
                {selectedMonitorParameters.map((parameter) => (
                  <span
                    key={`${selectedMonitor.id}-${parameter}`}
                    className="rounded border border-sky-300/60 bg-sky-100/70 px-1.5 py-0.5 text-xs font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/50 dark:text-sky-100"
                  >
                    {parameter}
                  </span>
                ))}
              </>
            }
          >
            {selectedMonitorCorrection && (
              <CorrectionSummary
                correction={selectedMonitorCorrection}
                showNote
                className="mt-3 border-sky-300/70 bg-background/70 p-3 dark:border-sky-800/70"
                titleClassName="mb-2 text-sky-900 dark:text-sky-100"
              />
            )}
          </SelectedItemCard>
        </div>
      )}

      <ListState
        loading={loading}
        loadingLabel="Loading monitor data..."
        error={error}
        errorTitle="Error loading monitor data"
        empty={filteredMonitors.length === 0}
        emptyLabel="No monitors match the current filters."
        onReset={hasActiveFilters ? resetFilters : undefined}
      >
        <div className="pb-6">
          <VirtualResultList items={filteredMonitors} getKey={monitorEntryKey} estimateSize={92} label="Monitors">
            {(monitor) => <MonitorRow monitor={monitor} selected={selectedMonitor?.id === monitor.id} onSelect={actions.selectMonitor} />}
          </VirtualResultList>
        </div>
      </ListState>
    </MapSidebarShell>
  )
}

function MonitorRow({
  monitor,
  selected,
  onSelect,
}: {
  monitor: AirMonitor
  selected: boolean
  onSelect: (monitor: AirMonitor) => void
}) {
  const parameters = uniqueParameters(monitor.parameters)
  const visibleParameters = parameters.slice(0, 3)
  const hiddenParameterCount = Math.max(parameters.length - visibleParameters.length, 0)

  return (
    <ResultRow
      title={monitor.name}
      subtitle={monitor.network}
      dotColor={getNetworkColor(monitor.network)}
      selected={selected}
      accent="sky"
      onClick={() => onSelect(monitor)}
      meta={
        <>
          <span className="block">{[monitor.city, monitor.province].filter(Boolean).join(', ') || 'No city/province'}</span>
          {visibleParameters.length > 0 && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {visibleParameters.map((parameter) => (
                <span key={parameter} className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                  {parameter}
                </span>
              ))}
              {hiddenParameterCount > 0 && <span className="text-xs text-muted-foreground">+{hiddenParameterCount} more</span>}
            </span>
          )}
        </>
      }
    />
  )
}

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'
import {
  FilterChipGroup,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { DATASETS } from '@/lib/dataCatalog'
import { formatDate } from '@/lib/format'
import { getCrimeCategory, getCrimeCategoryColor, CRIME_CATEGORY_COLORS } from '../constants'
import type { CrimeIncident, CrimeCategory } from '../types'

interface CrimeSidebarProps {
  className?: string
  incidents: CrimeIncident[]
  filteredIncidents: CrimeIncident[]
  selectedIncident: CrimeIncident | null
  selectedCategories: CrimeCategory[]
  selectedYears: number[]
  selectedCommunity: string
  searchQuery: string
  showHeatmap: boolean
  timelineEnabled: boolean
  loading: boolean
  error: string | null
  allYears: number[]
  allCommunities: string[]
  onToggleCategory: (category: CrimeCategory) => void
  onSelectAllCategories: () => void
  onClearCategories: () => void
  onToggleYear: (year: number) => void
  onSelectAllYears: () => void
  onCommunityChange: (community: string) => void
  onSearchChange: (query: string) => void
  onToggleHeatmap: () => void
  onToggleTimeline: () => void
  onIncidentClick: (incident: CrimeIncident) => void
  onClearSelection: () => void
  // Data layers
  showCrimeLayer: boolean
  onToggleCrimeLayer: () => void
}

const MAX_VISIBLE_ROWS = 200

export function CrimeSidebar({
  className,
  incidents,
  filteredIncidents,
  selectedIncident,
  selectedCategories,
  selectedYears,
  selectedCommunity,
  searchQuery,
  showHeatmap,
  timelineEnabled,
  loading,
  error,
  allYears,
  allCommunities,
  onToggleCategory,
  onSelectAllCategories,
  onClearCategories,
  onToggleYear,
  onSelectAllYears,
  onCommunityChange,
  onSearchChange,
  onToggleHeatmap,
  onToggleTimeline,
  onIncidentClick,
  onClearSelection,
  showCrimeLayer,
  onToggleCrimeLayer,
}: CrimeSidebarProps) {
  const categoryCounts = useMemo(() => {
    const counts = new Map<CrimeCategory, number>()
    incidents.forEach((inc) => {
      const cat = getCrimeCategory(inc.crimeType)
      counts.set(cat, (counts.get(cat) ?? 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [incidents])

  const yearCounts = useMemo(() => {
    const counts = new Map<number, number>()
    filteredIncidents.forEach((inc) => {
      const year = inc.date.getFullYear()
      counts.set(year, (counts.get(year) ?? 0) + 1)
    })
    return counts
  }, [filteredIncidents])

  const displayedRows = useMemo(() => filteredIncidents.slice(0, MAX_VISIBLE_ROWS), [filteredIncidents])

  return (
    <MapSidebarShell
      className={cn('relative', className)}
      title="PG Data"
      subtitle="City of Prince George"
      dataset={DATASETS.crime}
      actions={
        <>
          <ToggleChip active={timelineEnabled} onClick={onToggleTimeline} tone="sky">
            Timeline
          </ToggleChip>
          <ToggleChip active={showHeatmap} onClick={onToggleHeatmap} tone="orange">
            Heatmap
          </ToggleChip>
        </>
      }
    >
      {/* Data Layers */}
      <SidebarSection title="Data Layers">
        <div className="space-y-2">
          <label className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showCrimeLayer}
                onChange={onToggleCrimeLayer}
                className="h-3.5 w-3.5 rounded border-input accent-red-500"
              />
              <span className="text-sm text-foreground">Property Crime</span>
            </div>
            <span className="text-xs text-muted-foreground">{incidents.length.toLocaleString()}</span>
          </label>
        </div>
      </SidebarSection>

      {/* Crime Filters (only show when crime layer is on) */}
      {showCrimeLayer && (
        <>
          {/* Stats */}
          {!loading && !error && (
            <SidebarSection title="Crime Summary">
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total incidents:</span>
                  <span className="font-semibold text-foreground">{incidents.length.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Showing:</span>
                  <span className="font-medium">{filteredIncidents.length.toLocaleString()}</span>
                </div>
                <div className="pt-1 text-xs text-muted-foreground">Updated biweekly by City of Prince George</div>
              </div>
            </SidebarSection>
          )}

          {/* Search */}
          <SidebarSection>
            <label className="mb-2 block text-xs font-medium text-foreground">Search incidents</label>
            <SearchInput
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Address, file number, community..."
              className="focus:ring-sky-500"
            />
          </SidebarSection>

          {/* Crime Type Filter */}
          <SidebarSection
            title="Crime Type"
            actions={
              <>
                <button
                  onClick={onSelectAllCategories}
                  className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                >
                  All
                </button>
                <button onClick={onClearCategories} className="text-xs text-muted-foreground hover:text-foreground">
                  None
                </button>
              </>
            }
          >
            <FilterChipGroup
              items={categoryCounts.map(([category, count]) => ({
                value: category,
                label: category,
                count: count.toLocaleString(),
                color: CRIME_CATEGORY_COLORS[category],
              }))}
              selectedValues={selectedCategories}
              onToggle={onToggleCategory}
              chipClassName="px-3 py-1"
            />
          </SidebarSection>

          {/* Year Filter */}
          <SidebarSection
            title="Year"
            actions={
              <button
                onClick={onSelectAllYears}
                className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                All
              </button>
            }
          >
            <FilterChipGroup
              items={allYears.map((year) => ({
                value: String(year),
                label: year,
                count: (yearCounts.get(year) ?? 0).toLocaleString(),
              }))}
              selectedValues={selectedYears.map(String)}
              onToggle={(year) => onToggleYear(Number(year))}
              showDot={false}
              selectedClassName="border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300"
              chipClassName="px-3 py-1"
            />
          </SidebarSection>

          {/* Community Filter */}
          <div className="border-b border-border bg-background/95 p-4">
            <label className="mb-2 block text-xs font-medium text-foreground">Community</label>
            <AppSelect
              value={selectedCommunity}
              onValueChange={onCommunityChange}
              options={[
                { value: '', label: 'All communities' },
                ...allCommunities.map((community) => ({ value: community, label: community })),
              ]}
              triggerClassName="h-8 rounded-md text-xs focus:ring-2 focus:ring-ring"
            />
          </div>
        </>
      )}

      {/* Selected Incident */}
      {selectedIncident && (
        <SidebarSection>
          <SelectedItemCard
            tone="sky"
            title={selectedIncident.crimeType}
            subtitle={selectedIncident.address}
            onClear={onClearSelection}
            clearLabel="Clear selected incident"
            badges={
              <span className="flex items-center gap-1 rounded border border-sky-300/60 bg-sky-100/70 px-1.5 py-0.5 text-xs font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/50 dark:text-sky-100">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: getCrimeCategoryColor(selectedIncident.crimeType) }}
                />
                {getCrimeCategory(selectedIncident.crimeType)}
              </span>
            }
          >
            <div className="mt-1 text-xs text-sky-700 dark:text-sky-300">
              {formatDate(selectedIncident.date)} &middot; {selectedIncident.community}
            </div>
            <div className="mt-1 text-xs text-sky-600 dark:text-sky-400">File: {selectedIncident.fileNumber}</div>
          </SelectedItemCard>
        </SidebarSection>
      )}

      {/* Incident List */}
      {showCrimeLayer && (
        <>
          {loading ? (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              Loading crime data...
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="text-center text-sm text-red-500">
                <p className="font-medium">Error loading crime data</p>
                <p>{error}</p>
              </div>
            </div>
          ) : (
            <div className="pb-6">
              <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
                <span>{filteredIncidents.length.toLocaleString()} incidents</span>
                {filteredIncidents.length > MAX_VISIBLE_ROWS && <span>Showing first {MAX_VISIBLE_ROWS}</span>}
              </div>
              <div className="divide-y divide-border">
                {displayedRows.map((incident) => {
                  const isSelected = selectedIncident?.id === incident.id
                  return (
                    <button
                      key={incident.id}
                      onClick={() => onIncidentClick(incident)}
                      className={cn(
                        'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                        isSelected && 'bg-sky-50 dark:bg-sky-950/30',
                      )}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">{incident.crimeType}</span>
                        <span
                          className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: getCrimeCategoryColor(incident.crimeType) }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">{incident.address}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(incident.date)} &middot; {incident.community}
                      </div>
                    </button>
                  )
                })}
                {displayedRows.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No incidents match the current filters.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </MapSidebarShell>
  )
}

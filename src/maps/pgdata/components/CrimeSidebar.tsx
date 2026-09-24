import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  FilterChipGroup,
  KeyValueRows,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { SelectAllActions, TextButton } from '@/components/ui/text-button'
import { ToggleRow } from '@/components/ui/toggle-row'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { DATASETS } from '@/lib/dataCatalog'
import { formatDate, formatNumber } from '@/lib/format'
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
        <ToggleRow
          active={showCrimeLayer}
          onClick={onToggleCrimeLayer}
          tone="rose"
          label="Property Crime"
          trailing={<span className="tabular-nums">{formatNumber(incidents.length)}</span>}
        />
      </SidebarSection>

      {/* Crime Filters (only show when crime layer is on) */}
      {showCrimeLayer && (
        <>
          {/* Stats */}
          {!loading && !error && (
            <SidebarSection title="Crime Summary">
              <KeyValueRows
                size="sm"
                rows={[
                  { label: 'Total incidents:', value: formatNumber(incidents.length) },
                  { label: 'Showing:', value: formatNumber(filteredIncidents.length) },
                ]}
              />
              <p className="pt-2 text-xs text-muted-foreground">Updated biweekly by City of Prince George</p>
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
            actions={<SelectAllActions onAll={onSelectAllCategories} onNone={onClearCategories} />}
          >
            <FilterChipGroup
              items={categoryCounts.map(([category, count]) => ({
                value: category,
                label: category,
                count: formatNumber(count),
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
            actions={<TextButton onClick={onSelectAllYears}>All</TextButton>}
          >
            <FilterChipGroup
              items={allYears.map((year) => ({
                value: String(year),
                label: year,
                count: formatNumber(yearCounts.get(year) ?? 0),
              }))}
              selectedValues={selectedYears.map(String)}
              onToggle={(year) => onToggleYear(Number(year))}
              showDot={false}
              selectedClassName="border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300"
              chipClassName="px-3 py-1"
            />
          </SidebarSection>

          {/* Community Filter */}
          <SidebarSection>
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
          </SidebarSection>
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
              <Badge tone="info" size="sm">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: getCrimeCategoryColor(selectedIncident.crimeType) }}
                />
                {getCrimeCategory(selectedIncident.crimeType)}
              </Badge>
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
          <ListState
            loading={loading}
            loadingLabel="Loading crime data..."
            error={error}
            errorTitle="Error loading crime data"
            empty={filteredIncidents.length === 0}
            emptyLabel="No incidents match the current filters."
          >
            <ListHeader count={filteredIncidents.length} noun={['incident', 'incidents']} />
            <VirtualResultList
              items={filteredIncidents}
              getKey={(incident) => String(incident.id)}
              estimateSize={72}
              label="Crime incidents"
            >
              {(incident) => (
                <ResultRow
                  title={incident.crimeType}
                  subtitle={incident.address}
                  meta={<>{formatDate(incident.date)} &middot; {incident.community}</>}
                  dotColor={getCrimeCategoryColor(incident.crimeType)}
                  selected={selectedIncident?.id === incident.id}
                  onClick={() => onIncidentClick(incident)}
                />
              )}
            </VirtualResultList>
          </ListState>
        </>
      )}
    </MapSidebarShell>
  )
}

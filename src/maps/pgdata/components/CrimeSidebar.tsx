import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'
import { getCrimeCategory, getCrimeCategoryColor, CRIME_CATEGORY_COLORS } from '../constants'
import type { CrimeIncident, CrimeCategory } from '../types'
import type { CensusCategory, CensusVariable } from '@/maps/census/types'

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
  showAirQualityLayer: boolean
  showCensusLayer: boolean
  onToggleCrimeLayer: () => void
  onToggleAirQualityLayer: () => void
  onToggleCensusLayer: () => void
  // Air quality
  airMonitorCount: number
  // Census overlay
  censusCategories: CensusCategory[]
  censusVariables: CensusVariable[]
  selectedCensusCategoryId: string | null
  selectedCensusVariableId: string | null
  onCensusCategoryChange: (id: string) => void
  onCensusVariableChange: (id: string) => void
  censusLoading: boolean
}

const MAX_VISIBLE_ROWS = 200

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
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
  showAirQualityLayer,
  showCensusLayer,
  onToggleCrimeLayer,
  onToggleAirQualityLayer,
  onToggleCensusLayer,
  airMonitorCount,
  censusCategories,
  censusVariables,
  selectedCensusCategoryId,
  selectedCensusVariableId,
  onCensusCategoryChange,
  onCensusVariableChange,
  censusLoading,
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

  const displayedRows = useMemo(
    () => filteredIncidents.slice(0, MAX_VISIBLE_ROWS),
    [filteredIncidents]
  )

  return (
    <div
      className={cn(
        'relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
        className
      )}
    >
      {/* Header */}
      <div className="border-b border-border bg-background/95 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">PG Data</h1>
            <p className="text-sm text-muted-foreground">City of Prince George</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleTimeline}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                timelineEnabled
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-input text-muted-foreground hover:text-foreground'
              )}
            >
              Timeline
            </button>
            <button
              onClick={onToggleHeatmap}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                showHeatmap
                  ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                  : 'border-input text-muted-foreground hover:text-foreground'
              )}
            >
              Heatmap
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Data Layers */}
        <div className="border-b border-border bg-background/95 p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Data Layers</h2>
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
              <span className="text-xs text-muted-foreground">
                {incidents.length.toLocaleString()}
              </span>
            </label>
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showAirQualityLayer}
                  onChange={onToggleAirQualityLayer}
                  className="h-3.5 w-3.5 rounded border-input accent-green-500"
                />
                <span className="text-sm text-foreground">Air Quality Sensors</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {airMonitorCount}
              </span>
            </label>
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showCensusLayer}
                  onChange={onToggleCensusLayer}
                  className="h-3.5 w-3.5 rounded border-input accent-purple-500"
                />
                <span className="text-sm text-foreground">Census Socioeconomic</span>
              </div>
              <span className="text-xs text-muted-foreground">DA level</span>
            </label>
          </div>
        </div>

        {/* Census Variable Selector */}
        {showCensusLayer && (
          <div className="border-b border-border bg-purple-50/50 p-4 dark:bg-purple-950/20">
            <h3 className="mb-2 text-xs font-semibold text-foreground">Census Variable</h3>
            <AppSelect
              value={selectedCensusCategoryId ?? ''}
              onValueChange={onCensusCategoryChange}
              disabled={censusLoading}
              options={censusCategories.map((cat) => ({ value: cat.id, label: cat.name }))}
              className="mb-2"
              triggerClassName="h-8 rounded-md text-xs focus:ring-2 focus:ring-ring"
            />
            <AppSelect
              value={selectedCensusVariableId ?? ''}
              onValueChange={onCensusVariableChange}
              disabled={censusLoading || censusVariables.length === 0}
              options={censusVariables.map((v) => ({ value: v.id, label: v.label }))}
              triggerClassName="h-8 rounded-md text-xs focus:ring-2 focus:ring-ring"
            />
            {censusLoading && (
              <div className="mt-2 text-[10px] text-muted-foreground">Loading census data...</div>
            )}
          </div>
        )}

        {/* Crime Filters (only show when crime layer is on) */}
        {showCrimeLayer && (
          <>
            {/* Stats */}
            {!loading && !error && (
              <div className="border-b border-border bg-background/95 p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Crime Summary</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total incidents:</span>
                    <span className="font-semibold text-foreground">
                      {incidents.length.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Showing:</span>
                    <span className="font-medium">
                      {filteredIncidents.length.toLocaleString()}
                    </span>
                  </div>
                  <div className="pt-1 text-[10px] text-muted-foreground">
                    Updated biweekly by City of Prince George
                  </div>
                </div>
              </div>
            )}

            {/* Search */}
            <div className="border-b border-border bg-background/95 p-4">
              <label className="mb-2 block text-xs font-medium text-foreground">
                Search incidents
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Address, file number, community..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Crime Type Filter */}
            <div className="border-b border-border bg-background/95 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">Crime Type</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onSelectAllCategories}
                    className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                  >
                    All
                  </button>
                  <button
                    onClick={onClearCategories}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {categoryCounts.map(([category, count]) => {
                  const selected = selectedCategories.includes(category)
                  const color = CRIME_CATEGORY_COLORS[category]
                  return (
                    <button
                      key={category}
                      onClick={() => onToggleCategory(category)}
                      className={cn(
                        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors',
                        selected
                          ? 'bg-background'
                          : 'border-input bg-background text-foreground hover:bg-accent'
                      )}
                      style={selected ? { borderColor: color } : undefined}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span
                        className="max-w-[110px] truncate"
                        style={selected ? { color } : undefined}
                      >
                        {category}
                      </span>
                      <span
                        className={cn('opacity-80', selected ? '' : 'text-muted-foreground')}
                        style={selected ? { color } : undefined}
                      >
                        {count.toLocaleString()}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Year Filter */}
            <div className="border-b border-border bg-background/95 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">Year</h2>
                <button
                  onClick={onSelectAllYears}
                  className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                >
                  All
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {allYears.map((year) => {
                  const selected = selectedYears.includes(year)
                  const count = yearCounts.get(year) ?? 0
                  return (
                    <button
                      key={year}
                      onClick={() => onToggleYear(year)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        selected
                          ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300'
                          : 'border-input bg-background text-foreground hover:bg-accent'
                      )}
                    >
                      {year}
                      <span className={cn('ml-1.5', selected ? 'opacity-80' : 'text-muted-foreground')}>
                        {count.toLocaleString()}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

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
          <div className="border-b border-sky-300/60 bg-sky-50 p-4 dark:border-sky-800/60 dark:bg-sky-950/30">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-sky-900 dark:text-sky-200">
                  {selectedIncident.crimeType}
                </div>
                <div className="text-xs text-sky-700 dark:text-sky-300">
                  {selectedIncident.address}
                </div>
              </div>
              <button
                onClick={onClearSelection}
                className="text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
                aria-label="Clear selected incident"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: getCrimeCategoryColor(selectedIncident.crimeType) }}
              />
              <span>{getCrimeCategory(selectedIncident.crimeType)}</span>
            </div>
            <div className="mt-1 text-xs text-sky-700 dark:text-sky-300">
              {formatDate(selectedIncident.date)} &middot; {selectedIncident.community}
            </div>
            <div className="mt-1 text-[10px] text-sky-600 dark:text-sky-400">
              File: {selectedIncident.fileNumber}
            </div>
          </div>
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
                  {filteredIncidents.length > MAX_VISIBLE_ROWS && (
                    <span>Showing first {MAX_VISIBLE_ROWS}</span>
                  )}
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
                          isSelected && 'bg-sky-50 dark:bg-sky-950/30'
                        )}
                      >
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-medium text-foreground">
                            {incident.crimeType}
                          </span>
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
      </div>
    </div>
  )
}

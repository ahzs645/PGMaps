import { useMemo, useRef } from 'react'
import { Layers, MapPin, Route, TreePine } from 'lucide-react'
import {
  FilterChipGroup,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import {
  FilterToggleButton,
  ResetFiltersButton,
  StickyListToolbar,
  useRevealBelowSticky,
  useStickyListToolbar,
} from '@/components/ui/sticky-list-toolbar'
import { ToggleRow, type ToggleRowTone } from '@/components/ui/toggle-row'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { DATASETS } from '@/lib/dataCatalog'
import { formatArea, formatLength, formatNumber } from '@/lib/format'
import { getClassificationColor, getTrailColor } from '../constants'
import type {
  Park,
  Trail,
  ParkAmenity,
  ParkClassification,
  TrailUserClass,
  ActiveLayer,
  CityPgOverlaySummary,
} from '../types'

interface ParksSidebarProps {
  className?: string
  parks: Park[]
  trails: Trail[]
  amenities: ParkAmenity[]
  overlaySummary: CityPgOverlaySummary
  filteredParks: Park[]
  filteredTrails: Trail[]
  activeLayers: ActiveLayer[]
  selectedClassifications: ParkClassification[]
  selectedTrailTypes: TrailUserClass[]
  selectedPark: Park | null
  selectedTrail: Trail | null
  searchQuery: string
  loading: boolean
  error: string | null
  onSearchQueryChange: (query: string) => void
  onToggleLayer: (layer: ActiveLayer) => void
  onToggleClassification: (classification: ParkClassification) => void
  onToggleTrailType: (type: TrailUserClass) => void
  onParkClick: (park: Park) => void
  onTrailClick: (trail: Trail) => void
  onClearSelection: () => void
  onResetFilters: () => void
}

const ALL_CLASSIFICATIONS: ParkClassification[] = [
  'Athletic',
  'Community',
  'Downtown',
  'Green Space',
  'Major',
  'Nature',
  'Neighbourhood',
  'Public',
  'Special Purpose',
]

const ALL_TRAIL_TYPES: TrailUserClass[] = ['Walking', 'Multiuse', 'Equine']

/** Rows rendered for the second list while the first one is virtualised. */
const SECONDARY_LIST_CAP = 200

type OverlayLayer = Exclude<ActiveLayer, 'parks' | 'trails' | 'amenities'>

const OVERLAY_TOGGLES: Array<{
  layer: OverlayLayer
  label: string
  count: (summary: CityPgOverlaySummary) => number
  tone: ToggleRowTone
}> = [
  {
    layer: 'parkAssets',
    label: 'Park assets',
    count: (summary) => summary.parkAssets + summary.parkLines + summary.parkAreas,
    tone: 'emerald',
  },
  { layer: 'mobility', label: 'Mobility', count: (summary) => summary.mobility, tone: 'cyan' },
  { layer: 'ecology', label: 'Ecology', count: (summary) => summary.ecology, tone: 'lime' },
  { layer: 'community', label: 'Community', count: (summary) => summary.community, tone: 'indigo' },
  { layer: 'services', label: 'Services', count: (summary) => summary.services, tone: 'sky' },
  { layer: 'planning', label: 'OCP 2025', count: (summary) => summary.planning, tone: 'orange' },
]

function ParkRow({ park, selected, onClick }: { park: Park; selected: boolean; onClick: () => void }) {
  return (
    <ResultRow
      accent="green"
      selected={selected}
      onClick={onClick}
      dotColor={getClassificationColor(park.classification)}
      title={park.name}
      subtitle={[park.classification || 'Unknown', park.area ? formatArea(park.area) : null].filter(Boolean).join(' · ')}
    />
  )
}

function TrailRow({ trail, selected, onClick }: { trail: Trail; selected: boolean; onClick: () => void }) {
  return (
    <ResultRow
      accent="green"
      selected={selected}
      onClick={onClick}
      dotColor={getTrailColor(trail.userClass)}
      title={trail.name}
      subtitle={[trail.userClass || 'Trail', trail.surfaceMaterial, trail.length ? formatLength(trail.length) : null]
        .filter(Boolean)
        .join(' · ')}
      meta={trail.parkName || undefined}
    />
  )
}

export function ParksSidebar({
  className,
  parks,
  trails,
  amenities,
  overlaySummary,
  filteredParks,
  filteredTrails,
  activeLayers,
  selectedClassifications,
  selectedTrailTypes,
  selectedPark,
  selectedTrail,
  searchQuery,
  loading,
  error,
  onSearchQueryChange,
  onToggleLayer,
  onToggleClassification,
  onToggleTrailType,
  onParkClick,
  onTrailClick,
  onClearSelection,
  onResetFilters,
}: ParksSidebarProps) {
  const { toolbarRef, filtersPanelId, filtersOpen, toggleFilters } = useStickyListToolbar()
  const selectedCardRef = useRef<HTMLDivElement>(null)

  const showParks = activeLayers.includes('parks')
  const showTrails = activeLayers.includes('trails')
  const showAmenities = activeLayers.includes('amenities')
  const hasFilterPanel = showParks || showTrails

  const classificationCounts = useMemo(() => {
    const counts = new globalThis.Map<ParkClassification, number>()
    parks.forEach((p) => {
      if (p.classification) {
        counts.set(p.classification, (counts.get(p.classification) || 0) + 1)
      }
    })
    return counts
  }, [parks])

  const trailTypeCounts = useMemo(() => {
    const counts = new globalThis.Map<TrailUserClass, number>()
    trails.forEach((t) => {
      if (t.userClass) {
        counts.set(t.userClass, (counts.get(t.userClass) || 0) + 1)
      }
    })
    return counts
  }, [trails])

  // Deduplicate trails by name for the list display
  const uniqueTrails = useMemo(() => {
    const seen = new globalThis.Map<string, Trail>()
    filteredTrails.forEach((t) => {
      const key = t.name
      if (!seen.has(key)) {
        seen.set(key, t)
      } else {
        const existing = seen.get(key)!
        if (existing.length && t.length) {
          seen.set(key, { ...existing, length: existing.length + t.length })
        }
      }
    })
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredTrails])

  // A filter group counts as active when it hides a type that has features.
  const parkTypesNarrowed =
    showParks && ALL_CLASSIFICATIONS.some((type) => (classificationCounts.get(type) || 0) > 0 && !selectedClassifications.includes(type))
  const trailTypesNarrowed =
    showTrails && ALL_TRAIL_TYPES.some((type) => (trailTypeCounts.get(type) || 0) > 0 && !selectedTrailTypes.includes(type))
  const activeFilterCount = Number(parkTypesNarrowed) + Number(trailTypesNarrowed)
  const hasActiveFilters = activeFilterCount > 0 || searchQuery !== ''

  const selectedKey = selectedPark ? `park-${selectedPark.id}` : selectedTrail ? `trail-${selectedTrail.id}` : null
  useRevealBelowSticky(toolbarRef, selectedCardRef, selectedKey)

  // One virtual list per scroll port: parks when shown, otherwise trails. The
  // other list renders a capped number of rows and says so in its header.
  const trailsVirtual = !showParks
  const visibleTrails = trailsVirtual ? uniqueTrails : uniqueTrails.slice(0, SECONDARY_LIST_CAP)
  const listEmpty = (showParks ? filteredParks.length : 0) + (showTrails ? uniqueTrails.length : 0) === 0

  return (
    <MapSidebarShell
      className={className}
      title="Parks & Trails"
      subtitle="Prince George Open Data"
      dataset={DATASETS.parks}
    >
      {/* Stats */}
      <SidebarSection>
        <StatGrid
          stats={[
            { label: 'Parks', value: formatNumber(filteredParks.length), valueClassName: 'text-xl' },
            { label: 'Trails', value: formatNumber(uniqueTrails.length), valueClassName: 'text-xl' },
            {
              label: 'City layers',
              value: formatNumber(
                overlaySummary.parkAssets +
                  overlaySummary.parkLines +
                  overlaySummary.parkAreas +
                  overlaySummary.mobility +
                  overlaySummary.ecology +
                  overlaySummary.community +
                  overlaySummary.services +
                  overlaySummary.planning,
              ),
            },
          ]}
        />
      </SidebarSection>

      {/* Layer Toggles */}
      <SidebarSection title="Layers">
        <div className="grid grid-cols-3 gap-2">
          <ToggleRow
            layout="tile"
            tone="green"
            icon={TreePine}
            label="Parks"
            active={showParks}
            onClick={() => onToggleLayer('parks')}
          />
          <ToggleRow
            layout="tile"
            tone="green"
            icon={Route}
            label="Trails"
            active={showTrails}
            onClick={() => onToggleLayer('trails')}
          />
          <ToggleRow
            layout="tile"
            tone="amber"
            icon={MapPin}
            label="Amenities"
            active={showAmenities}
            onClick={() => onToggleLayer('amenities')}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {OVERLAY_TOGGLES.map((overlay) => {
            const active = activeLayers.includes(overlay.layer)
            return (
              <ToggleRow
                key={overlay.layer}
                icon={Layers}
                label={overlay.label}
                tone={overlay.tone}
                active={active}
                trailing={<span className="tabular-nums opacity-70">{formatNumber(overlay.count(overlaySummary))}</span>}
                onClick={() => onToggleLayer(overlay.layer)}
              />
            )
          })}
        </div>
      </SidebarSection>

      {/* Search and type filters stay reachable while the lists scroll. */}
      <StickyListToolbar
        ref={toolbarRef}
        search={
          <SearchInput
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onClear={() => onSearchQueryChange('')}
            icon
            placeholder="Search parks, trails..."
            aria-label="Search parks and trails"
            className="focus:ring-green-500"
          />
        }
        controls={
          hasFilterPanel || hasActiveFilters ? (
            <>
              {hasFilterPanel && (
                <FilterToggleButton
                  open={filtersOpen}
                  onToggle={toggleFilters}
                  panelId={filtersPanelId}
                  activeCount={activeFilterCount}
                />
              )}
              {hasActiveFilters && <ResetFiltersButton onClick={onResetFilters} />}
            </>
          ) : undefined
        }
      />

      {/* Park and trail type filters */}
      {filtersOpen && hasFilterPanel && (
        <div id={filtersPanelId} className="space-y-4 border-b border-border bg-muted/30 p-4">
          {showParks && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Park Type</h3>
              <FilterChipGroup
                items={ALL_CLASSIFICATIONS.map((classification) => ({
                  value: classification,
                  label: classification,
                  count: classificationCounts.get(classification) || 0,
                  color: getClassificationColor(classification),
                  disabled: (classificationCounts.get(classification) || 0) === 0,
                })).filter((item) => item.count !== 0)}
                selectedValues={selectedClassifications}
                onToggle={onToggleClassification}
              />
            </div>
          )}
          {showTrails && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Trail Type</h3>
              <FilterChipGroup
                items={ALL_TRAIL_TYPES.map((type) => ({
                  value: type,
                  label: type,
                  count: trailTypeCounts.get(type) || 0,
                  color: getTrailColor(type),
                  disabled: (trailTypeCounts.get(type) || 0) === 0,
                })).filter((item) => item.count !== 0)}
                selectedValues={selectedTrailTypes}
                onToggle={onToggleTrailType}
              />
            </div>
          )}
        </div>
      )}

      {/* Selected Detail */}
      {(selectedPark || selectedTrail) && (
        <div ref={selectedCardRef} className="hidden md:block">
          <SidebarSection>
            <SelectedItemCard
              tone="green"
              title={selectedPark?.name || selectedTrail?.name}
              onClick={() => {
                if (selectedPark) onParkClick(selectedPark)
                if (selectedTrail) onTrailClick(selectedTrail)
              }}
              subtitle={
                <>
                  {selectedPark && (
                    <>
                      {selectedPark.classification || 'Unknown'} {selectedPark.subType || 'Park'}
                      {selectedPark.area && ` · ${formatArea(selectedPark.area)}`}
                    </>
                  )}
                  {selectedTrail && (
                    <>
                      {selectedTrail.userClass || 'Trail'}
                      {selectedTrail.surfaceMaterial && ` · ${selectedTrail.surfaceMaterial}`}
                      {selectedTrail.length && ` · ${formatLength(selectedTrail.length)}`}
                    </>
                  )}
                </>
              }
              onClear={onClearSelection}
            >
              {selectedTrail?.parkName && (
                <div className="mt-2 text-xs text-green-600 dark:text-green-400">Located in {selectedTrail.parkName}</div>
              )}
            </SelectedItemCard>
          </SidebarSection>
        </div>
      )}

      {/* Lists */}
      <ListState
        loading={loading}
        loadingLabel="Loading park data..."
        error={error}
        errorTitle="Error loading data"
        empty={(showParks || showTrails) && listEmpty}
        emptyLabel="No parks or trails match these filters."
        onReset={hasActiveFilters ? onResetFilters : undefined}
      >
        {showParks && (
          <>
            <ListHeader
              sticky={false}
              count={filteredParks.length}
              noun={['park', 'parks']}
              aside={<span>{formatNumber(amenities.length)} amenities loaded</span>}
            />
            <VirtualResultList items={filteredParks} getKey={(park) => String(park.id)} estimateSize={64} label="Parks">
              {(park) => (
                <ParkRow park={park} selected={selectedPark?.id === park.id} onClick={() => onParkClick(park)} />
              )}
            </VirtualResultList>
          </>
        )}

        {showTrails && (
          <>
            <ListHeader
              sticky={false}
              count={uniqueTrails.length}
              noun={['trail', 'trails']}
              shown={trailsVirtual ? undefined : visibleTrails.length}
            />
            {trailsVirtual ? (
              <VirtualResultList items={uniqueTrails} getKey={(trail) => String(trail.id)} estimateSize={80} label="Trails">
                {(trail) => (
                  <TrailRow trail={trail} selected={selectedTrail?.id === trail.id} onClick={() => onTrailClick(trail)} />
                )}
              </VirtualResultList>
            ) : (
              <div role="list" aria-label="Trails" className="divide-y divide-border">
                {visibleTrails.map((trail) => (
                  <div key={trail.id} role="listitem">
                    <TrailRow trail={trail} selected={selectedTrail?.id === trail.id} onClick={() => onTrailClick(trail)} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </ListState>
    </MapSidebarShell>
  )
}

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Layers, MapPin, Route, TreePine } from 'lucide-react'
import {
  FilterChipGroup,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
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

function formatArea(sqm: number | null): string {
  if (!sqm) return ''
  if (sqm >= 10000) return `${(sqm / 10000).toFixed(1)} ha`
  return `${Math.round(sqm)} m²`
}

function formatLength(m: number | null): string {
  if (!m) return ''
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m)} m`
}

function OverlayToggle({
  label,
  count,
  active,
  colorClass,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  colorClass: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors',
        active ? colorClass : 'border-input text-muted-foreground hover:bg-accent',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Layers className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 tabular-nums opacity-70">{count.toLocaleString()}</span>
    </button>
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
}: ParksSidebarProps) {
  const [showExpandedParkTypes, setShowExpandedParkTypes] = useState(false)

  const showParks = activeLayers.includes('parks')
  const showTrails = activeLayers.includes('trails')
  const showAmenities = activeLayers.includes('amenities')
  const showParkAssets = activeLayers.includes('parkAssets')
  const showMobility = activeLayers.includes('mobility')
  const showEcology = activeLayers.includes('ecology')
  const showCommunity = activeLayers.includes('community')
  const showServices = activeLayers.includes('services')
  const showPlanning = activeLayers.includes('planning')

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

  return (
    <MapSidebarShell
      className={className}
      title="Parks & Trails"
      subtitle="Prince George Open Data"
      dataset={DATASETS.parks}
    >
      {/* Stats & Search */}
      <SidebarSection>
        <StatGrid
          className="mb-3"
          stats={[
            { label: 'Parks', value: filteredParks.length, valueClassName: 'text-xl' },
            { label: 'Trails', value: uniqueTrails.length, valueClassName: 'text-xl' },
            {
              label: 'City layers',
              value: (
                overlaySummary.parkAssets +
                overlaySummary.parkLines +
                overlaySummary.parkAreas +
                overlaySummary.mobility +
                overlaySummary.ecology +
                overlaySummary.community +
                overlaySummary.services +
                overlaySummary.planning
              ).toLocaleString(),
            },
          ]}
        />
        <SearchInput
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search parks, trails..."
          className="focus:ring-green-500"
        />
      </SidebarSection>

      {/* Layer Toggles */}
      <SidebarSection title="Layers">
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onToggleLayer('parks')}
            className={cn(
              'flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors',
              showParks
                ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                : 'border-input text-muted-foreground hover:bg-accent',
            )}
          >
            <TreePine className="h-3 w-3" />
            Parks
          </button>
          <button
            onClick={() => onToggleLayer('trails')}
            className={cn(
              'flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors',
              showTrails
                ? 'border-red-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                : 'border-input text-muted-foreground hover:bg-accent',
            )}
          >
            <Route className="h-3 w-3" />
            Trails
          </button>
          <button
            onClick={() => onToggleLayer('amenities')}
            className={cn(
              'flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors',
              showAmenities
                ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-input text-muted-foreground hover:bg-accent',
            )}
          >
            <MapPin className="h-3 w-3" />
            Amenities
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <OverlayToggle
            label="Park assets"
            count={overlaySummary.parkAssets + overlaySummary.parkLines + overlaySummary.parkAreas}
            active={showParkAssets}
            colorClass="border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
            onClick={() => onToggleLayer('parkAssets')}
          />
          <OverlayToggle
            label="Mobility"
            count={overlaySummary.mobility}
            active={showMobility}
            colorClass="border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300"
            onClick={() => onToggleLayer('mobility')}
          />
          <OverlayToggle
            label="Ecology"
            count={overlaySummary.ecology}
            active={showEcology}
            colorClass="border-lime-500 bg-lime-50 text-lime-700 dark:bg-lime-950/30 dark:text-lime-300"
            onClick={() => onToggleLayer('ecology')}
          />
          <OverlayToggle
            label="Community"
            count={overlaySummary.community}
            active={showCommunity}
            colorClass="border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300"
            onClick={() => onToggleLayer('community')}
          />
          <OverlayToggle
            label="Services"
            count={overlaySummary.services}
            active={showServices}
            colorClass="border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300"
            onClick={() => onToggleLayer('services')}
          />
          <OverlayToggle
            label="OCP 2025"
            count={overlaySummary.planning}
            active={showPlanning}
            colorClass="border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
            onClick={() => onToggleLayer('planning')}
          />
        </div>
      </SidebarSection>

      {/* Classification Filters */}
      {showParks && (
        <SidebarSection
          title="Park Type"
          actions={
            <button
              type="button"
              onClick={() => setShowExpandedParkTypes((prev) => !prev)}
              className="rounded border border-input p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={showExpandedParkTypes ? 'Show compact park types' : 'Expand park types'}
            >
              {showExpandedParkTypes ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          }
        >
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
            layout={showExpandedParkTypes ? 'wrap' : 'scroll'}
            className={showExpandedParkTypes ? 'max-h-24 overflow-y-auto' : undefined}
          />
        </SidebarSection>
      )}

      {/* Trail Type Filters */}
      {showTrails && (
        <SidebarSection title="Trail Type">
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
        </SidebarSection>
      )}

      {/* Selected Detail */}
      {(selectedPark || selectedTrail) && (
        <SidebarSection>
          <SelectedItemCard
            tone="green"
            title={selectedPark?.name || selectedTrail?.name}
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
      )}

      {/* List */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading park data...
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-sm text-red-500">
            <p className="font-medium">Error loading data</p>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <div>
          {showParks && (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
                <span>Parks ({filteredParks.length})</span>
                <span>{amenities.length.toLocaleString()} amenities loaded</span>
              </div>
              <div className="divide-y divide-border">
                {filteredParks.slice(0, 200).map((park) => {
                  const isSelected = selectedPark?.id === park.id
                  return (
                    <button
                      key={park.id}
                      onClick={() => onParkClick(park)}
                      className={cn(
                        'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                        isSelected && 'bg-green-50 dark:bg-green-950/30',
                      )}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">{park.name}</span>
                        <span
                          className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: getClassificationColor(park.classification) }}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{park.classification || 'Unknown'}</span>
                        {park.area && <span>· {formatArea(park.area)}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {showTrails && (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
                <span>Trails ({uniqueTrails.length})</span>
              </div>
              <div className="divide-y divide-border">
                {uniqueTrails.slice(0, 200).map((trail) => {
                  const isSelected = selectedTrail?.id === trail.id
                  return (
                    <button
                      key={trail.id}
                      onClick={() => onTrailClick(trail)}
                      className={cn(
                        'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                        isSelected && 'bg-green-50 dark:bg-green-950/30',
                      )}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">{trail.name}</span>
                        <span
                          className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: getTrailColor(trail.userClass) }}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{trail.userClass || 'Trail'}</span>
                        {trail.surfaceMaterial && <span>· {trail.surfaceMaterial}</span>}
                        {trail.length && <span>· {formatLength(trail.length)}</span>}
                      </div>
                      {trail.parkName && <div className="mt-0.5 text-xs text-muted-foreground">{trail.parkName}</div>}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </MapSidebarShell>
  )
}

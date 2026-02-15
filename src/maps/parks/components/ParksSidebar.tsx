import { useMemo } from 'react'
import { MapPin, Route, TreePine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getClassificationColor, getTrailColor } from '../constants'
import type { Park, Trail, ParkAmenity, ParkClassification, TrailUserClass, ActiveLayer } from '../types'

interface ParksSidebarProps {
  parks: Park[]
  trails: Trail[]
  amenities: ParkAmenity[]
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
  'Athletic', 'Community', 'Downtown', 'Green Space',
  'Major', 'Nature', 'Neighbourhood', 'Public', 'Special Purpose',
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

export function ParksSidebar({
  parks,
  trails,
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
  const showParks = activeLayers.includes('parks')
  const showTrails = activeLayers.includes('trails')
  const showAmenities = activeLayers.includes('amenities')

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
    <div className="z-10 flex h-full w-[350px] flex-col border-r border-border bg-background/95 shadow-xl backdrop-blur">
      {/* Header */}
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">Parks & Trails</h1>
        <p className="text-sm text-muted-foreground">Prince George Open Data</p>
      </div>

      {/* Stats & Search */}
      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Parks</div>
            <div className="text-xl font-bold text-foreground">{filteredParks.length}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Trails</div>
            <div className="text-xl font-bold text-foreground">{uniqueTrails.length}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-sm font-medium text-foreground">{parks.length} parks</div>
          </div>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search parks, trails..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Layer Toggles */}
      <div className="border-b border-border bg-background/95 p-4">
        <h2 className="mb-2 text-sm font-medium text-foreground">Layers</h2>
        <div className="flex gap-2">
          <button
            onClick={() => onToggleLayer('parks')}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              showParks
                ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                : 'border-input text-muted-foreground hover:bg-accent'
            )}
          >
            <TreePine className="h-3 w-3" />
            Parks
          </button>
          <button
            onClick={() => onToggleLayer('trails')}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              showTrails
                ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                : 'border-input text-muted-foreground hover:bg-accent'
            )}
          >
            <Route className="h-3 w-3" />
            Trails
          </button>
          <button
            onClick={() => onToggleLayer('amenities')}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              showAmenities
                ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-input text-muted-foreground hover:bg-accent'
            )}
          >
            <MapPin className="h-3 w-3" />
            Amenities
          </button>
        </div>
      </div>

      {/* Classification Filters */}
      {showParks && (
        <div className="border-b border-border bg-background/95 p-4">
          <h2 className="mb-2 text-sm font-medium text-foreground">Park Type</h2>
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {ALL_CLASSIFICATIONS.map((classification) => {
              const count = classificationCounts.get(classification) || 0
              if (count === 0) return null
              const selected = selectedClassifications.includes(classification)
              const color = getClassificationColor(classification)
              return (
                <button
                  key={classification}
                  onClick={() => onToggleClassification(classification)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    selected ? 'bg-background' : 'border-input text-muted-foreground hover:bg-accent'
                  )}
                  style={selected ? { borderColor: color, color } : undefined}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  {classification}
                  <span className="opacity-70">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Trail Type Filters */}
      {showTrails && (
        <div className="border-b border-border bg-background/95 p-4">
          <h2 className="mb-2 text-sm font-medium text-foreground">Trail Type</h2>
          <div className="flex gap-2">
            {ALL_TRAIL_TYPES.map((type) => {
              const count = trailTypeCounts.get(type) || 0
              if (count === 0) return null
              const selected = selectedTrailTypes.includes(type)
              const color = getTrailColor(type)
              return (
                <button
                  key={type}
                  onClick={() => onToggleTrailType(type)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    selected ? 'bg-background' : 'border-input text-muted-foreground hover:bg-accent'
                  )}
                  style={selected ? { borderColor: color, color } : undefined}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  {type}
                  <span className="opacity-70">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Selected Detail */}
      {(selectedPark || selectedTrail) && (
        <div className="border-b border-green-300/60 bg-green-50 p-4 dark:border-green-800/60 dark:bg-green-950/30">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-green-900 dark:text-green-200">
                {selectedPark?.name || selectedTrail?.name}
              </div>
              <div className="text-xs text-green-700 dark:text-green-300">
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
              </div>
            </div>
            <button
              onClick={onClearSelection}
              className="text-green-700 hover:text-green-900 dark:text-green-300 dark:hover:text-green-100"
              aria-label="Clear selection"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {selectedTrail?.parkName && (
            <div className="text-xs text-green-600 dark:text-green-400">
              Located in {selectedTrail.parkName}
            </div>
          )}
        </div>
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
        <div className="flex-1 overflow-y-auto">
          {showParks && (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
                <span>Parks ({filteredParks.length})</span>
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
                        isSelected && 'bg-green-50 dark:bg-green-950/30'
                      )}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">
                          {park.name}
                        </span>
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
                        isSelected && 'bg-green-50 dark:bg-green-950/30'
                      )}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">
                          {trail.name}
                        </span>
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
                      {trail.parkName && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{trail.parkName}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

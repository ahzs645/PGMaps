import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { ParksMap } from './components/ParksMap'
import { ParksSidebar } from './components/ParksSidebar'
import { useParksData } from './hooks/useParksData'
import { getClassificationColor, getTrailColor } from './constants'
import type { Park, Trail, ParkClassification, TrailUserClass, ActiveLayer } from './types'

const ALL_CLASSIFICATIONS: ParkClassification[] = [
  'Athletic', 'Community', 'Downtown', 'Green Space',
  'Major', 'Nature', 'Neighbourhood', 'Public', 'Special Purpose',
]

const ALL_TRAIL_TYPES: TrailUserClass[] = ['Walking', 'Multiuse', 'Equine']

export default function ParksSection() {
  const { parks, trails, amenities, loading, error } = useParksData()

  const [activeLayers, setActiveLayers] = useState<ActiveLayer[]>(['parks', 'trails'])
  const [selectedClassifications, setSelectedClassifications] = useState<ParkClassification[]>([])
  const [classificationsInitialized, setClassificationsInitialized] = useState(false)
  const [selectedTrailTypes, setSelectedTrailTypes] = useState<TrailUserClass[]>([])
  const [trailTypesInitialized, setTrailTypesInitialized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  const [selectedTrail, setSelectedTrail] = useState<Trail | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)

  // Initialize filters with all available classifications/types
  useEffect(() => {
    if (!classificationsInitialized && parks.length > 0) {
      setSelectedClassifications(ALL_CLASSIFICATIONS)
      setClassificationsInitialized(true)
    }
  }, [parks, classificationsInitialized])

  useEffect(() => {
    if (!trailTypesInitialized && trails.length > 0) {
      setSelectedTrailTypes(ALL_TRAIL_TYPES)
      setTrailTypesInitialized(true)
    }
  }, [trails, trailTypesInitialized])

  const filteredParks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return parks.filter((park) => {
      const matchesClassification = !park.classification || selectedClassifications.includes(park.classification)
      const matchesSearch = !query || park.name.toLowerCase().includes(query)
      return matchesClassification && matchesSearch
    })
  }, [parks, selectedClassifications, searchQuery])

  const filteredTrails = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return trails.filter((trail) => {
      const matchesType = !trail.userClass || selectedTrailTypes.includes(trail.userClass)
      const matchesSearch = !query || [
        trail.name,
        trail.parkName,
        trail.surfaceMaterial,
      ].filter(Boolean).join(' ').toLowerCase().includes(query)
      return matchesType && matchesSearch
    })
  }, [trails, selectedTrailTypes, searchQuery])

  // Clear selection if it's no longer visible
  useEffect(() => {
    if (selectedPark && !filteredParks.some((p) => p.id === selectedPark.id)) {
      setSelectedPark(null)
    }
  }, [filteredParks, selectedPark])

  useEffect(() => {
    if (selectedTrail && !filteredTrails.some((t) => t.id === selectedTrail.id)) {
      setSelectedTrail(null)
    }
  }, [filteredTrails, selectedTrail])

  const toggleLayer = useCallback((layer: ActiveLayer) => {
    setActiveLayers((current) =>
      current.includes(layer)
        ? current.filter((l) => l !== layer)
        : [...current, layer]
    )
  }, [])

  const toggleClassification = useCallback((classification: ParkClassification) => {
    setSelectedClassifications((current) =>
      current.includes(classification)
        ? current.filter((c) => c !== classification)
        : [...current, classification]
    )
  }, [])

  const toggleTrailType = useCallback((type: TrailUserClass) => {
    setSelectedTrailTypes((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type]
    )
  }, [])

  const handleParkClick = useCallback((park: Park) => {
    setSelectedPark(park)
    setSelectedTrail(null)
  }, [])

  const handleTrailClick = useCallback((trail: Trail) => {
    setSelectedTrail(trail)
    setSelectedPark(null)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedPark(null)
    setSelectedTrail(null)
  }, [])

  // Build legend items
  const legendItems = useMemo(() => {
    const items: { label: string; color: string }[] = []
    if (activeLayers.includes('parks')) {
      selectedClassifications.slice(0, 5).forEach((c) => {
        items.push({ label: c, color: getClassificationColor(c) })
      })
    }
    if (activeLayers.includes('trails')) {
      selectedTrailTypes.forEach((t) => {
        items.push({ label: `${t} Trail`, color: getTrailColor(t) })
      })
    }
    if (activeLayers.includes('amenities')) {
      items.push({ label: 'Amenities', color: '#f59e0b' })
    }
    return items
  }, [activeLayers, selectedClassifications, selectedTrailTypes])

  return (
    <div className="relative flex h-full w-full bg-slate-100 dark:bg-slate-950">
      {showSidebar && (
        <ParksSidebar
          parks={parks}
          trails={trails}
          amenities={amenities}
          filteredParks={filteredParks}
          filteredTrails={filteredTrails}
          activeLayers={activeLayers}
          selectedClassifications={selectedClassifications}
          selectedTrailTypes={selectedTrailTypes}
          selectedPark={selectedPark}
          selectedTrail={selectedTrail}
          searchQuery={searchQuery}
          loading={loading}
          error={error}
          onSearchQueryChange={setSearchQuery}
          onToggleLayer={toggleLayer}
          onToggleClassification={toggleClassification}
          onToggleTrailType={toggleTrailType}
          onParkClick={handleParkClick}
          onTrailClick={handleTrailClick}
          onClearSelection={handleClearSelection}
        />
      )}

      <button
        onClick={() => setShowSidebar(!showSidebar)}
        aria-label={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
        className={`absolute top-6 z-20 flex h-10 w-8 items-center justify-center border border-l-0 border-slate-300/80 bg-slate-50/95 text-slate-600 shadow-md backdrop-blur transition-[left,background-color,color,border-color] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800 ${
          showSidebar ? 'left-[350px] rounded-r-lg' : 'left-0 rounded-r-lg'
        }`}
      >
        {showSidebar ? (
          <ChevronsLeft className="h-4 w-4" />
        ) : (
          <ChevronsRight className="h-4 w-4" />
        )}
      </button>

      <div className="relative flex-1">
        <ParksMap
          parks={filteredParks}
          trails={filteredTrails}
          amenities={amenities}
          activeLayers={activeLayers}
          selectedPark={selectedPark}
          selectedTrail={selectedTrail}
          onParkClick={handleParkClick}
          onTrailClick={handleTrailClick}
        />

        {/* Legend */}
        {legendItems.length > 0 && (
          <div className="absolute bottom-6 right-6 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
            <h4 className="mb-2 text-xs font-semibold text-foreground">
              Legend
            </h4>
            <div className="space-y-1">
              {legendItems.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

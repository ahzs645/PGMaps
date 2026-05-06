import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeLayers, setActiveLayers] = useState<ActiveLayer[]>(() => {
    const layers = (searchParams.get('layers') || '').split(',').filter(Boolean) as ActiveLayer[]
    return layers.length ? layers : ['parks', 'trails']
  })
  const { parks, trails, amenities, cityOverlays, overlaySummary, loading, error } = useParksData(activeLayers)
  const [selectedClassifications, setSelectedClassifications] = useState<ParkClassification[]>([])
  const [classificationsInitialized, setClassificationsInitialized] = useState(false)
  const [selectedTrailTypes, setSelectedTrailTypes] = useState<TrailUserClass[]>([])
  const [trailTypesInitialized, setTrailTypesInitialized] = useState(false)
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  const [selectedTrail, setSelectedTrail] = useState<Trail | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (activeLayers.join(',') !== 'parks,trails') params.set('layers', activeLayers.join(','))
    else params.delete('layers')
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    else params.delete('q')
    if (selectedPark) params.set('park', String(selectedPark.id))
    else params.delete('park')
    if (selectedTrail) params.set('trail', String(selectedTrail.id))
    else params.delete('trail')
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [activeLayers, searchParams, searchQuery, selectedPark, selectedTrail, setSearchParams])

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

  useEffect(() => {
    const parkId = searchParams.get('park')
    const trailId = searchParams.get('trail')
    if (parkId && !selectedPark) {
      const park = parks.find((item) => String(item.id) === parkId)
      if (park) setSelectedPark(park)
    } else if (trailId && !selectedTrail) {
      const trail = trails.find((item) => String(item.id) === trailId)
      if (trail) setSelectedTrail(trail)
    }
  }, [parks, searchParams, selectedPark, selectedTrail, trails])

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
    if (activeLayers.includes('parkAssets')) {
      items.push({ label: 'Park assets', color: '#16a34a' })
    }
    if (activeLayers.includes('mobility')) {
      items.push({ label: 'Mobility', color: '#0891b2' })
    }
    if (activeLayers.includes('ecology')) {
      items.push({ label: 'Ecology', color: '#16a34a' })
    }
    if (activeLayers.includes('community')) {
      items.push({ label: 'Community', color: '#6366f1' })
    }
    if (activeLayers.includes('services')) {
      items.push({ label: 'Services', color: '#38bdf8' })
    }
    if (activeLayers.includes('planning')) {
      items.push({ label: 'OCP 2025', color: '#f97316' })
    }
    return items
  }, [activeLayers, selectedClassifications, selectedTrailTypes])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            Parks & Trails | {filteredParks.length + filteredTrails.length} visible
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedPark?.name || selectedTrail?.name || `${activeLayers.length} layers active`}
          </div>
        </div>
      )}
      sidebar={(
        <ParksSidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          parks={parks}
          trails={trails}
          amenities={amenities}
          overlaySummary={overlaySummary}
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
    >
      <div className="relative h-full">
        <ParksMap
          parks={filteredParks}
          trails={filteredTrails}
          amenities={amenities}
          cityOverlays={cityOverlays}
          activeLayers={activeLayers}
          selectedPark={selectedPark}
          selectedTrail={selectedTrail}
          onParkClick={handleParkClick}
          onTrailClick={handleTrailClick}
        />

        {/* Legend */}
        {legendItems.length > 0 && (
          <div className="absolute bottom-36 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
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
    </MapSectionLayout>
  )
}

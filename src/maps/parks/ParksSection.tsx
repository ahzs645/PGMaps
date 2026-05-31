import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { useMediaQuery } from '@/hooks/useMediaQuery'
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

export default function ParksSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
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
  const [mobileFeatureSheetOpen, setMobileFeatureSheetOpen] = useState(false)
  const [selectionFocusKey, setSelectionFocusKey] = useState(0)
  const [showSidebar, setShowSidebar] = useState(true)
  const ignoreUrlSelectionRef = useRef(false)

  useEffect(() => {
    const parkParam = searchParams.get('park')
    const trailParam = searchParams.get('trail')
    const urlSelectionPending = !ignoreUrlSelectionRef.current && (
      (parkParam && !selectedPark && (parks.length === 0 || parks.some((item) => String(item.id) === parkParam))) ||
      (trailParam && !selectedTrail && (trails.length === 0 || trails.some((item) => String(item.id) === trailParam)))
    )
    if (urlSelectionPending) return

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
  }, [activeLayers, parks, searchParams, searchQuery, selectedPark, selectedTrail, setSearchParams, trails])

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
    if (!parkId && !trailId) {
      ignoreUrlSelectionRef.current = false
      return
    }
    if (ignoreUrlSelectionRef.current) return
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
    ignoreUrlSelectionRef.current = false
    setSelectedPark(park)
    setSelectedTrail(null)
    setMobileFeatureSheetOpen(true)
    setSelectionFocusKey((key) => key + 1)
  }, [])

  const handleTrailClick = useCallback((trail: Trail) => {
    ignoreUrlSelectionRef.current = false
    setSelectedTrail(trail)
    setSelectedPark(null)
    setMobileFeatureSheetOpen(true)
    setSelectionFocusKey((key) => key + 1)
  }, [])

  const handleClearSelection = useCallback(() => {
    ignoreUrlSelectionRef.current = true
    setSelectedPark(null)
    setSelectedTrail(null)
    setMobileFeatureSheetOpen(false)
    const params = new URLSearchParams(searchParams)
    params.delete('park')
    params.delete('trail')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const parkLegendRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return ALL_CLASSIFICATIONS
      .map((classification) => ({
        classification,
        count: parks.filter((park) => (
          park.classification === classification &&
          (!query || park.name.toLowerCase().includes(query))
        )).length,
        active: selectedClassifications.includes(classification),
      }))
      .filter((row) => row.count > 0)
  }, [parks, searchQuery, selectedClassifications])

  const trailLegendRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return ALL_TRAIL_TYPES
      .map((type) => ({
        type,
        count: trails.filter((trail) => (
          trail.userClass === type &&
          (!query || [
            trail.name,
            trail.parkName,
            trail.surfaceMaterial,
          ].filter(Boolean).join(' ').toLowerCase().includes(query))
        )).length,
        active: selectedTrailTypes.includes(type),
      }))
      .filter((row) => row.count > 0)
  }, [searchQuery, selectedTrailTypes, trails])

  const overlayLegendItems = useMemo(() => {
    const items: Array<{ label: string; color: string; layer: ActiveLayer }> = []
    if (activeLayers.includes('amenities')) items.push({ label: 'Amenities', color: '#f59e0b', layer: 'amenities' })
    if (activeLayers.includes('parkAssets')) items.push({ label: 'Park assets', color: '#16a34a', layer: 'parkAssets' })
    if (activeLayers.includes('mobility')) items.push({ label: 'Mobility', color: '#0891b2', layer: 'mobility' })
    if (activeLayers.includes('ecology')) items.push({ label: 'Ecology', color: '#16a34a', layer: 'ecology' })
    if (activeLayers.includes('community')) items.push({ label: 'Community', color: '#6366f1', layer: 'community' })
    if (activeLayers.includes('services')) items.push({ label: 'Services', color: '#38bdf8', layer: 'services' })
    if (activeLayers.includes('planning')) items.push({ label: 'OCP 2025', color: '#f97316', layer: 'planning' })
    return items
  }, [activeLayers])

  const showLegend = (activeLayers.includes('parks') && selectedClassifications.length > 0)
    || (activeLayers.includes('trails') && selectedTrailTypes.length > 0)
    || overlayLegendItems.length > 0

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
          selectionFocusKey={selectionFocusKey}
          loading={loading}
          onParkClick={handleParkClick}
          onTrailClick={handleTrailClick}
        />

        {isMobileViewport && mobileFeatureSheetOpen && selectedPark && (
          <MobileParkFeatureCard park={selectedPark} onClose={handleClearSelection} />
        )}

        {isMobileViewport && mobileFeatureSheetOpen && selectedTrail && (
          <MobileTrailFeatureCard trail={selectedTrail} onClose={handleClearSelection} />
        )}

        {/* Legend */}
        {showLegend && (
          <MapLegendPanel title="Legend" collapsible contentClassName="space-y-3">
            {activeLayers.includes('parks') && selectedClassifications.length > 0 && (
              <MapLegendSection title="Parks" value={parkLegendRows.length.toLocaleString()}>
                {parkLegendRows.length > 0 ? (
                  parkLegendRows.map((row) => (
                    <LegendItem
                      key={row.classification}
                      color={getClassificationColor(row.classification)}
                      label={row.classification}
                      value={row.count.toLocaleString()}
                      active={row.active}
                      onClick={() => toggleClassification(row.classification)}
                    />
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">No visible parks</div>
                )}
              </MapLegendSection>
            )}

            {activeLayers.includes('trails') && selectedTrailTypes.length > 0 && (
              <MapLegendSection title="Trails" value={trailLegendRows.length.toLocaleString()} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                {trailLegendRows.length > 0 ? (
                  trailLegendRows.map((row) => (
                    <LegendItem
                      key={row.type}
                      color={getTrailColor(row.type)}
                      label={`${row.type} Trail`}
                      value={row.count.toLocaleString()}
                      active={row.active}
                      swatchShape="dashed-line"
                      onClick={() => toggleTrailType(row.type)}
                    />
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">No visible trails</div>
                )}
              </MapLegendSection>
            )}

            {overlayLegendItems.length > 0 && (
              <MapLegendSection title="Overlays" value={overlayLegendItems.length.toLocaleString()} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                {overlayLegendItems.map((item) => (
                  <LegendItem
                    key={item.layer}
                    color={item.color}
                    label={item.label}
                    active={activeLayers.includes(item.layer)}
                    onClick={() => toggleLayer(item.layer)}
                  />
                ))}
              </MapLegendSection>
            )}
          </MapLegendPanel>
        )}
      </div>
    </MapSectionLayout>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 py-2 first:pt-0 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 max-w-[13rem] text-right font-medium text-foreground">{value}</span>
    </div>
  )
}

function MobileParkFeatureCard({ park, onClose }: { park: Park; onClose: () => void }) {
  const subtitle = [
    `${park.classification || 'Unknown'} ${park.subType || 'Park'}`,
    park.area ? formatArea(park.area) : null,
  ].filter(Boolean).join(' · ')

  return (
    <MobileFeatureCard
      cardKey={`park-${park.id}`}
      title={park.name}
      subtitle={subtitle}
      onClose={onClose}
    >
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <DetailRow label="Type" value={`${park.classification || 'Unknown'} ${park.subType || 'Park'}`} />
        <DetailRow label="Area" value={park.area ? formatArea(park.area) : 'Not listed'} />
        <DetailRow label="Developed" value={park.developed ? 'Yes' : 'No'} />
      </div>
    </MobileFeatureCard>
  )
}

function MobileTrailFeatureCard({ trail, onClose }: { trail: Trail; onClose: () => void }) {
  const subtitle = [
    trail.userClass || 'Trail',
    trail.surfaceMaterial,
    trail.length ? formatLength(trail.length) : null,
  ].filter(Boolean).join(' · ')

  return (
    <MobileFeatureCard
      cardKey={`trail-${trail.id}`}
      title={trail.name}
      subtitle={subtitle}
      onClose={onClose}
    >
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <DetailRow label="Trail type" value={trail.userClass || 'Trail'} />
        <DetailRow label="Surface" value={trail.surfaceMaterial || trail.surfaceClass || 'Not listed'} />
        <DetailRow label="Length" value={trail.length ? formatLength(trail.length) : 'Not listed'} />
        <DetailRow label="Park" value={trail.parkName || 'Not listed'} />
        <DetailRow label="Winter maintenance" value={trail.winterMaintenance ? 'Yes' : 'No'} />
      </div>
    </MobileFeatureCard>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUrlParamSync } from '@/hooks/useUrlState'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { toggleArrayItem } from '@/hooks/useToggleArray'
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
  // null means "no explicit selection yet" and resolves to every option, so
  // no initialization effect is needed once data loads.
  const [classificationsOverride, setClassificationsOverride] = useState<ParkClassification[] | null>(null)
  const selectedClassifications = classificationsOverride ?? ALL_CLASSIFICATIONS
  const [trailTypesOverride, setTrailTypesOverride] = useState<TrailUserClass[] | null>(null)
  const selectedTrailTypes = trailTypesOverride ?? ALL_TRAIL_TYPES
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  const [selectedTrail, setSelectedTrail] = useState<Trail | null>(null)
  const [mobileFeatureSheetOpen, setMobileFeatureSheetOpen] = useState(false)
  const [selectionFocusKey, setSelectionFocusKey] = useState(0)
  const [ignoredUrlSelection, setIgnoredUrlSelection] = useState<{ park: string | null; trail: string | null }>({
    park: null,
    trail: null,
  })


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

  // Deep-linked selections derive from the URL until the user explicitly
  // clears them; remembering cleared ids keeps fresh links live. A selection
  // that filters drop out of view stops rendering without a state write.
  const urlParkId = searchParams.get('park')
  const urlTrailId = searchParams.get('trail')
  const effectiveSelectedPark = useMemo(() => {
    if (selectedPark) return selectedPark
    if (!urlParkId || urlParkId === ignoredUrlSelection.park) return null
    return parks.find((item) => String(item.id) === urlParkId) ?? null
  }, [selectedPark, urlParkId, ignoredUrlSelection.park, parks])
  const effectiveSelectedTrail = useMemo(() => {
    if (selectedTrail) return selectedTrail
    if (effectiveSelectedPark || !urlTrailId || urlTrailId === ignoredUrlSelection.trail) return null
    return trails.find((item) => String(item.id) === urlTrailId) ?? null
  }, [selectedTrail, effectiveSelectedPark, urlTrailId, ignoredUrlSelection.trail, trails])
  const visibleSelectedPark = useMemo(() => {
    if (!effectiveSelectedPark) return null
    return filteredParks.some((park) => park.id === effectiveSelectedPark.id) ? effectiveSelectedPark : null
  }, [filteredParks, effectiveSelectedPark])
  const visibleSelectedTrail = useMemo(() => {
    if (!effectiveSelectedTrail) return null
    return filteredTrails.some((trail) => trail.id === effectiveSelectedTrail.id) ? effectiveSelectedTrail : null
  }, [filteredTrails, effectiveSelectedTrail])

  // Sync filters to URL for shareable links; deep-linked ids stay untouched
  // until their dataset has loaded.
  const urlSelectionPending =
    (urlParkId && urlParkId !== ignoredUrlSelection.park && parks.length === 0) ||
    (urlTrailId && urlTrailId !== ignoredUrlSelection.trail && trails.length === 0)
  useUrlParamSync(
    urlSelectionPending
      ? null
      : {
          layers: activeLayers.join(',') === 'parks,trails' ? null : activeLayers.join(','),
          q: searchQuery.trim(),
          park: visibleSelectedPark ? String(visibleSelectedPark.id) : null,
          trail: visibleSelectedTrail ? String(visibleSelectedTrail.id) : null,
        },
  )

  const toggleLayer = useCallback((layer: ActiveLayer) => {
    setActiveLayers((current) => toggleArrayItem(current, layer))
  }, [])

  const toggleClassification = useCallback((classification: ParkClassification) => {
    setClassificationsOverride((current) => toggleArrayItem(current ?? ALL_CLASSIFICATIONS, classification))
  }, [])

  const toggleTrailType = useCallback((type: TrailUserClass) => {
    setTrailTypesOverride((current) => toggleArrayItem(current ?? ALL_TRAIL_TYPES, type))
  }, [])

  const handleClearSelection = useCallback(() => {
    setIgnoredUrlSelection({ park: searchParams.get('park'), trail: searchParams.get('trail') })
    setSelectedPark(null)
    setSelectedTrail(null)
    setMobileFeatureSheetOpen(false)
    const params = new URLSearchParams(searchParams)
    params.delete('park')
    params.delete('trail')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const handleParkClick = useCallback((park: Park | null) => {
    if (!park) {
      handleClearSelection()
      return
    }
    setSelectedPark(park)
    setSelectedTrail(null)
    setMobileFeatureSheetOpen(true)
    setSelectionFocusKey((key) => key + 1)
  }, [handleClearSelection])

  const handleTrailClick = useCallback((trail: Trail | null) => {
    if (!trail) {
      handleClearSelection()
      return
    }
    setSelectedTrail(trail)
    setSelectedPark(null)
    setMobileFeatureSheetOpen(true)
    setSelectionFocusKey((key) => key + 1)
  }, [handleClearSelection])

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
      mobilePeekTitle={<>Parks & Trails | {filteredParks.length + filteredTrails.length} visible</>}
      mobilePeekSubtitle={<>{visibleSelectedPark?.name || visibleSelectedTrail?.name || `${activeLayers.length} layers active`}</>}
      sidebar={(
        <ParksSidebar
          className={MAP_SIDEBAR_CLASS}
          parks={parks}
          trails={trails}
          amenities={amenities}
          overlaySummary={overlaySummary}
          filteredParks={filteredParks}
          filteredTrails={filteredTrails}
          activeLayers={activeLayers}
          selectedClassifications={selectedClassifications}
          selectedTrailTypes={selectedTrailTypes}
          selectedPark={visibleSelectedPark}
          selectedTrail={visibleSelectedTrail}
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
          selectedPark={visibleSelectedPark}
          selectedTrail={visibleSelectedTrail}
          selectionFocusKey={selectionFocusKey}
          loading={loading}
          onParkClick={handleParkClick}
          onTrailClick={handleTrailClick}
        />

        {isMobileViewport && mobileFeatureSheetOpen && visibleSelectedPark && (
          <MobileParkFeatureCard park={visibleSelectedPark} onClose={handleClearSelection} />
        )}

        {isMobileViewport && mobileFeatureSheetOpen && visibleSelectedTrail && (
          <MobileTrailFeatureCard trail={visibleSelectedTrail} onClose={handleClearSelection} />
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

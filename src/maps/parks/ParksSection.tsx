import { useCallback, useMemo, useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSearchParams } from 'react-router-dom'
import { useUrlParamSync } from '@/hooks/useUrlState'
import { useUrlSelection } from '@/hooks/useUrlSelection'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { KeyValueRows, LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { toggleArrayItem } from '@/hooks/useToggleArray'
import { ParksMap } from './components/ParksMap'
import { ParksSidebar } from './components/ParksSidebar'
import { useParksData } from './hooks/useParksData'
import { getClassificationColor, getTrailColor } from './constants'
import type { Park, Trail, ParkClassification, TrailUserClass, ActiveLayer } from './types'
import { geometryBounds } from '@/lib/geo'
import { formatArea, formatLength, formatNumber } from '@/lib/format'

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

const getParkId = (park: Park) => String(park.id)
const getTrailId = (trail: Trail) => String(trail.id)
// Parks and trails each number their own OBJECTIDs, so a table row names its kind.
const parkRowId = (park: Park) => `park-${park.id}`
const trailRowId = (trail: Trail) => `trail-${trail.id}`
const wholeNumber = (value: number) => formatNumber(value, { maximumFractionDigits: 0 })

const PARK_COLUMNS = [
  textColumn<Park>('name', 'Name', (park) => park.name, { width: 240 }),
  textColumn<Park>('classification', 'Classification', (park) => park.classification),
  textColumn<Park>('subType', 'Type', (park) => park.subType, { width: 120 }),
  textColumn<Park>('developed', 'Developed', (park) => (park.developed ? 'Yes' : 'No'), { width: 110 }),
  numberColumn<Park>('area', 'Area (m²)', (park) => park.area, { format: wholeNumber }),
]

const TRAIL_COLUMNS = [
  textColumn<Trail>('name', 'Name', (trail) => trail.name, { width: 240 }),
  textColumn<Trail>('parkName', 'Park', (trail) => trail.parkName, { width: 200 }),
  textColumn<Trail>('userClass', 'Trail type', (trail) => trail.userClass, { width: 120 }),
  textColumn<Trail>('surface', 'Surface', (trail) => trail.surfaceMaterial || trail.surfaceClass),
  numberColumn<Trail>('length', 'Length (m)', (trail) => trail.length, { format: wholeNumber }),
  textColumn<Trail>('winter', 'Winter maintenance', (trail) => (trail.winterMaintenance ? 'Yes' : 'No'), {
    width: 160,
  }),
]

function trailCenter(trail: Trail): [number, number] | null {
  return trail.coordinates[Math.floor(trail.coordinates.length / 2)] ?? null
}

export default function ParksSection() {
  const [searchParams] = useSearchParams()
  const isMobileViewport = useIsMobile()
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
  const [mobileFeatureSheetOpen, setMobileFeatureSheetOpen] = useState(false)
  const [selectionFocusKey, setSelectionFocusKey] = useState(0)

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
      const matchesSearch =
        !query ||
        [trail.name, trail.parkName, trail.surfaceMaterial].filter(Boolean).join(' ').toLowerCase().includes(query)
      return matchesType && matchesSearch
    })
  }, [trails, selectedTrailTypes, searchQuery])

  // A selection that filters drop out of view stops rendering without a state write.
  const parkSelection = useUrlSelection<Park>({ param: 'park', items: parks, getId: getParkId })
  const effectiveSelectedPark = parkSelection.selected
  // A park selection wins, so the trail param is only resolved when none is set.
  const trailSelection = useUrlSelection<Trail>({
    param: 'trail',
    items: trails,
    getId: getTrailId,
    enabled: !effectiveSelectedPark,
  })
  const effectiveSelectedTrail = trailSelection.selected
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
  const urlSelectionPending = parkSelection.pending || trailSelection.pending
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

  const handleResetFilters = useCallback(() => {
    setClassificationsOverride(null)
    setTrailTypesOverride(null)
    setSearchQuery('')
  }, [])

  const handleClearSelection = useCallback(() => {
    // Both clears write through useSetUrlParams, so the second does not start
    // from the first's stale render params.
    parkSelection.clear()
    trailSelection.clear()
    setMobileFeatureSheetOpen(false)
  }, [parkSelection, trailSelection])

  const handleParkClick = useCallback(
    (park: Park | null) => {
      if (!park) {
        handleClearSelection()
        return
      }
      parkSelection.select(park)
      trailSelection.select(null)
      setMobileFeatureSheetOpen(true)
      setSelectionFocusKey((key) => key + 1)
    },
    [handleClearSelection, parkSelection, trailSelection],
  )

  const handleTrailClick = useCallback(
    (trail: Trail | null) => {
      if (!trail) {
        handleClearSelection()
        return
      }
      trailSelection.select(trail)
      parkSelection.select(null)
      setMobileFeatureSheetOpen(true)
      setSelectionFocusKey((key) => key + 1)
    },
    [handleClearSelection, parkSelection, trailSelection],
  )

  const showParks = activeLayers.includes('parks')
  const showTrails = activeLayers.includes('trails')
  const tableSources = useMemo(() => {
    const status = loading ? ('loading' as const) : error ? ('error' as const) : ('ready' as const)
    return [
      ...(showParks
        ? [
            defineTableSource<Park>({
              id: 'parks',
              label: 'Parks',
              color: '#16a34a',
              shape: 'fill',
              rows: filteredParks,
              columns: PARK_COLUMNS,
              getRowId: parkRowId,
              getRowCenter: (park) => [park.longitude, park.latitude],
              getRowBounds: (park) => geometryBounds(park.geometry),
              status,
              emptyMessage: error ?? 'No parks match these filters.',
              exportFileName: 'pg-parks',
            }),
          ]
        : []),
      ...(showTrails
        ? [
            defineTableSource<Trail>({
              id: 'trails',
              label: 'Trails',
              color: '#ef4444',
              shape: 'line',
              rows: filteredTrails,
              columns: TRAIL_COLUMNS,
              getRowId: trailRowId,
              getRowCenter: trailCenter,
              getRowBounds: (trail) => geometryBounds({ type: 'LineString', coordinates: trail.coordinates }),
              status,
              emptyMessage: error ?? 'No trails match these filters.',
              exportFileName: 'pg-trails',
            }),
          ]
        : []),
    ]
  }, [error, filteredParks, filteredTrails, loading, showParks, showTrails])
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: visibleSelectedPark
      ? parkRowId(visibleSelectedPark)
      : visibleSelectedTrail
        ? trailRowId(visibleSelectedTrail)
        : null,
    onSelectRow: (row: Park | Trail, source) =>
      source.id === 'trails' ? handleTrailClick(row as Trail) : handleParkClick(row as Park),
    // ParksMap fits the selected park or trail, which also covers a click on the map.
    flyOnSelect: false,
  })

  const parkLegendRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return ALL_CLASSIFICATIONS.map((classification) => ({
      classification,
      count: parks.filter(
        (park) => park.classification === classification && (!query || park.name.toLowerCase().includes(query)),
      ).length,
      active: selectedClassifications.includes(classification),
    })).filter((row) => row.count > 0)
  }, [parks, searchQuery, selectedClassifications])

  const trailLegendRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return ALL_TRAIL_TYPES.map((type) => ({
      type,
      count: trails.filter(
        (trail) =>
          trail.userClass === type &&
          (!query ||
            [trail.name, trail.parkName, trail.surfaceMaterial]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(query)),
      ).length,
      active: selectedTrailTypes.includes(type),
    })).filter((row) => row.count > 0)
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

  const showLegend =
    (activeLayers.includes('parks') && selectedClassifications.length > 0) ||
    (activeLayers.includes('trails') && selectedTrailTypes.length > 0) ||
    overlayLegendItems.length > 0

  return (
    <MapSectionLayout
      table={table}
      mobilePeekTitle={<>Parks & Trails · {formatNumber(filteredParks.length + filteredTrails.length)} visible</>}
      mobilePeekSubtitle={
        <>{visibleSelectedPark?.name || visibleSelectedTrail?.name || `${activeLayers.length} layers active`}</>
      }
      sidebar={
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
          onResetFilters={handleResetFilters}
        />
      }
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
          table={table}
          onParkClick={(park) => {
            handleParkClick(park)
            if (park) table.follow('parks')
          }}
          onTrailClick={(trail) => {
            handleTrailClick(trail)
            if (trail) table.follow('trails')
          }}
        />

        {isMobileViewport && mobileFeatureSheetOpen && visibleSelectedPark && (
          <MobileParkFeatureCard park={visibleSelectedPark} onClose={handleClearSelection} />
        )}

        {isMobileViewport && mobileFeatureSheetOpen && visibleSelectedTrail && (
          <MobileTrailFeatureCard trail={visibleSelectedTrail} onClose={handleClearSelection} />
        )}

        {/* Legend */}
        {showLegend && (
          <MapLegendPanel title="Legend" collapsible defaultCollapsed="mobile" contentClassName="space-y-3">
            {activeLayers.includes('parks') && selectedClassifications.length > 0 && (
              <MapLegendSection title="Parks" value={formatNumber(parkLegendRows.length)}>
                {parkLegendRows.length > 0 ? (
                  parkLegendRows.map((row) => (
                    <LegendItem
                      key={row.classification}
                      color={getClassificationColor(row.classification)}
                      label={row.classification}
                      value={formatNumber(row.count)}
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
              <MapLegendSection
                title="Trails"
                value={formatNumber(trailLegendRows.length)}
                className="border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
                {trailLegendRows.length > 0 ? (
                  trailLegendRows.map((row) => (
                    <LegendItem
                      key={row.type}
                      color={getTrailColor(row.type)}
                      label={`${row.type} Trail`}
                      value={formatNumber(row.count)}
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
              <MapLegendSection
                title="Overlays"
                value={formatNumber(overlayLegendItems.length)}
                className="border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
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

function MobileParkFeatureCard({ park, onClose }: { park: Park; onClose: () => void }) {
  const subtitle = [
    `${park.classification || 'Unknown'} ${park.subType || 'Park'}`,
    park.area ? formatArea(park.area) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <MobileFeatureCard cardKey={`park-${park.id}`} title={park.name} subtitle={subtitle} onClose={onClose}>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
        <KeyValueRows
          variant="divided"
          size="sm"
          valueMaxWidth="max-w-[13rem]"
          rows={[
            { label: 'Type', value: `${park.classification || 'Unknown'} ${park.subType || 'Park'}` },
            { label: 'Area', value: park.area ? formatArea(park.area) : 'Not listed' },
            { label: 'Developed', value: park.developed ? 'Yes' : 'No' },
          ]}
        />
      </div>
    </MobileFeatureCard>
  )
}

function MobileTrailFeatureCard({ trail, onClose }: { trail: Trail; onClose: () => void }) {
  const subtitle = [trail.userClass || 'Trail', trail.surfaceMaterial, trail.length ? formatLength(trail.length) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <MobileFeatureCard cardKey={`trail-${trail.id}`} title={trail.name} subtitle={subtitle} onClose={onClose}>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
        <KeyValueRows
          variant="divided"
          size="sm"
          valueMaxWidth="max-w-[13rem]"
          rows={[
            { label: 'Trail type', value: trail.userClass || 'Trail' },
            { label: 'Surface', value: trail.surfaceMaterial || trail.surfaceClass || 'Not listed' },
            { label: 'Length', value: trail.length ? formatLength(trail.length) : 'Not listed' },
            { label: 'Park', value: trail.parkName || 'Not listed' },
            { label: 'Winter maintenance', value: trail.winterMaintenance ? 'Yes' : 'No' },
          ]}
        />
      </div>
    </MobileFeatureCard>
  )
}

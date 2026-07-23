import { ArrowLeft, BookOpen, Calendar, Globe, Layers, MapPin, Play, RotateCcw, Search, X } from 'lucide-react'
import type MapLibreGL from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { Map, MapControls, MapPopup, useMap } from '@/components/ui/map'
import { LegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { Timeline } from '@/components/ui/timeline'
import type { ProjectDataPortalDef } from '@/lib/projectPackages'
import { cn } from '@/lib/utils'

import type { ResearchPortalLocationFeatureProperties, ResearchPortalSubmission } from './types'
import { type ResearchPortalData, useResearchPortalData } from './useResearchPortalData'

export function ResearchPortal({
  title,
  config,
  onBack,
}: {
  title: string
  config: ProjectDataPortalDef
  onBack: () => void
}) {
  const [showSidebar, setShowSidebar] = useState(true)
  const [timelineMode, setTimelineMode] = useState(false)
  const data = useResearchPortalData(config)

  if (data.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
            <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
          </div>
          <span className="text-sm text-muted-foreground">Loading research data…</span>
        </div>
      </div>
    )
  }

  if (data.error) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-sm rounded-lg border bg-card p-5 text-center shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Research data unavailable</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{data.error}</p>
          <Button type="button" size="sm" className="mt-4" onClick={data.retry}>
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <MapSectionLayout
      sidebar={
        <ResearchSidebar
          title={title}
          onBack={onBack}
          data={data}
          timelineMode={timelineMode}
          onToggleTimeline={() => {
            data.setSelectedLocationId(null)
            setTimelineMode((current) => !current)
          }}
        />
      }
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobileCollapsedVisibleHeight={68}
      mobilePeek={
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {data.filteredStats.totalPublications.toLocaleString()} publications
          </div>
        </div>
      }
      showMobilePeek
    >
      <ResearchMap
        config={config}
        data={data}
        timelineMode={timelineMode}
        onExitTimeline={() => {
          data.setSelectedLocationId(null)
          setTimelineMode(false)
        }}
      />
    </MapSectionLayout>
  )
}

function ResearchSidebar({
  title,
  onBack,
  data,
  timelineMode,
  onToggleTimeline,
}: {
  title: string
  onBack: () => void
  data: ResearchPortalData
  timelineMode: boolean
  onToggleTimeline: () => void
}) {
  const {
    overview,
    decades,
    filteredStats,
    allResourceTypes,
    regionalOnlySubmissions,
    selectedDecade,
    setSelectedDecade,
    selectedTypes,
    toggleResourceType,
    searchQuery,
    setSearchQuery,
    filteredLocations,
    setSelectedLocationId,
    clearFilters,
  } = data
  const [showRegionalModal, setShowRegionalModal] = useState(false)
  const hasFilters = selectedDecade !== null || selectedTypes.size > 0 || searchQuery !== ''

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
        >
          <ArrowLeft className="size-3.5" />
          Projects
        </button>
        <div className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground" title={title}>
          {title}
        </div>
      </div>

      <div className="shrink-0 border-b border-border p-3">
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            icon={<BookOpen className="size-3.5" />}
            value={filteredStats.totalPublications}
            label="Publications"
          />
          <StatCard icon={<MapPin className="size-3.5" />} value={filteredStats.activeLocations} label="Locations" />
          <StatCard
            icon={<Calendar className="size-3.5" />}
            value={overview?.yearRange ? `${overview.yearRange.min}–${overview.yearRange.max}` : '—'}
            label="Years"
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <X className="size-3" />
            Clear all filters
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timeline</h3>
          <DecadeTimeline
            decades={decades}
            selectedDecade={selectedDecade}
            onSelectDecade={(decade) => setSelectedDecade(decade === selectedDecade ? null : decade)}
          />
          <button
            type="button"
            onClick={onToggleTimeline}
            aria-pressed={timelineMode}
            className={cn(
              'mt-2 flex w-full items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              timelineMode
                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10',
            )}
          >
            <Play className="size-3" />
            {timelineMode ? 'Hide Timeline' : 'Show Timeline'}
          </button>
        </section>

        <section className="border-b border-border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resource Types</h3>
          <div className="space-y-0.5">
            {allResourceTypes.map(([type, count]) => {
              const isSelected = selectedTypes.size === 0 || selectedTypes.has(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleResourceType(type)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors',
                    isSelected ? 'hover:bg-muted' : 'opacity-40 hover:opacity-60',
                  )}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: data.resourceTypeColors[type] ?? data.resourceTypeColors.other }}
                  />
                  <span className="flex-1 truncate text-left">{data.resourceTypeLabels[type] ?? type}</span>
                  <span className="text-muted-foreground">{count}</span>
                </button>
              )
            })}
          </div>
        </section>

        {regionalOnlySubmissions.length > 0 && (
          <section className="border-b border-border p-3">
            <button
              type="button"
              onClick={() => setShowRegionalModal(true)}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
            >
              <Globe className="size-3.5 shrink-0" />
              <span className="flex-1 text-left">
                <strong>{regionalOnlySubmissions.length}</strong> publications tagged to watershed region only
              </span>
            </button>
          </section>
        )}

        <section className="p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Locations</h3>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search titles, authors, tags…"
              className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                aria-label="Clear search"
              >
                <X className="size-3 text-muted-foreground" />
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {filteredLocations.slice(0, 30).map((location) => {
              const maxCount = filteredLocations[0]?.filteredCount ?? 1
              return (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => setSelectedLocationId(location.id)}
                  className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate text-left transition-colors group-hover:text-primary">
                    {formatLocationName(location.name)}
                  </span>
                  <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/50"
                      style={{ width: `${(location.filteredCount / maxCount) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right text-muted-foreground">{location.filteredCount}</span>
                </button>
              )
            })}
            {filteredLocations.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No locations match filters</p>
            )}
          </div>
        </section>
      </div>

      {showRegionalModal && (
        <RegionalSubmissionsModal
          submissions={regionalOnlySubmissions}
          resourceTypeLabels={data.resourceTypeLabels}
          onClose={() => setShowRegionalModal(false)}
        />
      )}
    </div>
  )
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  const displayValue = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
      <div className="mb-0.5 flex items-center justify-center gap-1 text-primary">{icon}</div>
      <div
        className={cn(
          'whitespace-nowrap font-bold leading-tight tabular-nums text-foreground',
          displayValue.length > 7 ? 'text-sm' : 'text-base',
        )}
      >
        {displayValue}
      </div>
      <div className="truncate text-[10px] leading-tight text-muted-foreground">{label}</div>
    </div>
  )
}

function DecadeTimeline({
  decades,
  selectedDecade,
  onSelectDecade,
}: {
  decades: ResearchPortalData['decades']
  selectedDecade: number | null
  onSelectDecade: (decade: number) => void
}) {
  const maxTotal = Math.max(1, ...decades.map((item) => item.total))
  return (
    <div className="space-y-0.5">
      {decades.map((item) => {
        const selected = selectedDecade === item.decade
        return (
          <button
            key={item.decade}
            type="button"
            onClick={() => onSelectDecade(item.decade)}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors',
              selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted',
            )}
            title={`${item.decade}s: ${item.total} publications`}
          >
            <span className="w-10 text-right font-mono text-muted-foreground">{item.decade}s</span>
            <span className="h-3 flex-1 overflow-hidden rounded bg-muted">
              <span
                className={cn(
                  'block h-full rounded transition-all duration-300',
                  selected ? 'bg-primary' : 'bg-primary/40',
                )}
                style={{ width: `${(item.total / maxTotal) * 100}%` }}
              />
            </span>
            <span className="w-8 text-right font-mono text-muted-foreground">{item.total}</span>
          </button>
        )
      })}
    </div>
  )
}

function RegionalSubmissionsModal({
  submissions,
  resourceTypeLabels,
  onClose,
}: {
  submissions: ResearchPortalSubmission[]
  resourceTypeLabels: Record<string, string>
  onClose: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close regional publications"
      />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Regional Publications</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {submissions.length} publications tagged to the watershed without a specific location
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {submissions.map((submission) => (
            <article key={submission.id} className="rounded-md border bg-muted/20 p-3">
              <h3 className="text-sm font-medium leading-5 text-foreground">
                {submission.title || 'Untitled publication'}
              </h3>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {submission.author && <span>{submission.author}</span>}
                {submission.publicationYear && <span>{submission.publicationYear}</span>}
                <span>{resourceTypeLabels[submission.resourceTypeMain] ?? submission.resourceType}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

function ResearchMap({
  config,
  data,
  timelineMode,
  onExitTimeline,
}: {
  config: ProjectDataPortalDef
  data: ResearchPortalData
  timelineMode: boolean
  onExitTimeline: () => void
}) {
  const { locationGeoJSON, selectedLocation, setSelectedLocationId } = data
  const decadeValues = useMemo(() => data.decades.map((item) => item.decade), [data.decades])
  const firstDecade = decadeValues[0] ?? new Date().getFullYear()
  const lastDecade = decadeValues[decadeValues.length - 1] ?? firstDecade
  const [currentDate, setCurrentDate] = useState(() => new Date(lastDecade, 0, 1))
  const currentDecade = Math.floor(currentDate.getFullYear() / 10) * 10
  const currentIndex = data.decades.findIndex((item) => item.decade === currentDecade)
  const decadeSummary = currentIndex >= 0 ? data.decades[currentIndex] : undefined
  const timelineData = data.buildDecadeGeoJSON(currentDecade)
  const activeGeoJSON = timelineMode ? timelineData : locationGeoJSON
  const bucketCounts = useMemo(
    () => new globalThis.Map(data.decades.map((item) => [String(item.decade), item.total])),
    [data.decades],
  )
  const selectedTimelineFeature = timelineData.features.find(
    (feature) => feature.properties.id === data.selectedLocationId,
  )
  const legendCounts = timelineMode
    ? Object.entries(decadeSummary?.byResourceType ?? {}).sort((a, b) => b[1] - a[1])
    : data.filteredStats.typeBreakdown

  return (
    <Map center={config.map.center} zoom={config.map.zoom} minZoom={config.map.minZoom} maxZoom={config.map.maxZoom}>
      <ResearchLocationLayer
        idPrefix="research"
        data={activeGeoJSON}
        fallbackColor={data.resourceTypeColors.other ?? '#94a3b8'}
        onLocationClick={(properties) => setSelectedLocationId(properties.id)}
      />
      <MapControls position="top-right" showZoom showCompass showFullscreen />
      <ResearchPortalLegend config={config} counts={legendCounts} elevated={timelineMode} />
      {!timelineMode && selectedLocation?.coordinates && (
        <MapPopup
          longitude={selectedLocation.coordinates.lon}
          latitude={selectedLocation.coordinates.lat}
          onClose={() => setSelectedLocationId(null)}
          closeButton
          className="w-64"
        >
          <LocationPopupContent
            name={selectedLocation.name}
            count={selectedLocation.filteredCount}
            resourceTypes={selectedLocation.resourceTypes}
            resourceTypeColors={data.resourceTypeColors}
            resourceTypeLabels={data.resourceTypeLabels}
          />
        </MapPopup>
      )}
      {timelineMode && selectedTimelineFeature && (
        <MapPopup
          longitude={selectedTimelineFeature.geometry.coordinates[0]}
          latitude={selectedTimelineFeature.geometry.coordinates[1]}
          onClose={() => setSelectedLocationId(null)}
          closeButton
          className="w-56"
        >
          <div>
            <h3 className="text-sm font-semibold">{formatLocationName(selectedTimelineFeature.properties.name)}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedTimelineFeature.properties.count.toLocaleString()} publications in the {currentDecade}s
            </p>
          </div>
        </MapPopup>
      )}
      {timelineMode && (
        <Timeline
          startDate={new Date(firstDecade, 0, 1)}
          endDate={new Date(lastDecade, 0, 1)}
          currentDate={currentDate}
          onDateChange={(date) => {
            setSelectedLocationId(null)
            setCurrentDate(date)
          }}
          onClose={onExitTimeline}
          bucketCounts={bucketCounts}
          bucketValueLabel="publications"
          statsLabel={`${decadeSummary?.total.toLocaleString() ?? 0} publications`}
          granularity="decade"
        />
      )}
    </Map>
  )
}

function ResearchLocationLayer({
  idPrefix,
  data,
  fallbackColor,
  onLocationClick,
}: {
  idPrefix: string
  data: GeoJSON.FeatureCollection<GeoJSON.Point, ResearchPortalLocationFeatureProperties>
  fallbackColor: string
  onLocationClick: (properties: ResearchPortalLocationFeatureProperties) => void
}) {
  const { map, isLoaded } = useMap()
  const sourceId = `${idPrefix}-locations`
  const circleLayerId = `${idPrefix}-location-circles`
  const labelLayerId = `${idPrefix}-location-labels`
  const onClickRef = useRef(onLocationClick)
  const dataRef = useRef(data)

  useEffect(() => {
    onClickRef.current = onLocationClick
  }, [onLocationClick])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const ensureLayers = useCallback(
    (mapInstance: MapLibreGL.Map) => {
      const source = mapInstance.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
      if (source) {
        source.setData(dataRef.current)
        return
      }
      mapInstance.addSource(sourceId, { type: 'geojson', data: dataRef.current })
      mapInstance.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': ['coalesce', ['get', 'radius'], 8],
          'circle-color': ['coalesce', ['get', 'color'], fallbackColor],
          'circle-opacity': 0.65,
          'circle-stroke-width': 2,
          'circle-stroke-color': ['coalesce', ['get', 'color'], fallbackColor],
          'circle-stroke-opacity': 0.9,
          'circle-radius-transition': { duration: 400, delay: 0 },
          'circle-opacity-transition': { duration: 300, delay: 0 },
        },
      })
      mapInstance.addLayer({
        id: labelLayerId,
        type: 'symbol',
        source: sourceId,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      })
    },
    [circleLayerId, fallbackColor, labelLayerId, sourceId],
  )

  useEffect(() => {
    if (!isLoaded || !map) return
    ensureLayers(map)

    const handleClick = (event: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0]
      if (feature) onClickRef.current(feature.properties as unknown as ResearchPortalLocationFeatureProperties)
    }
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }
    const handleStyleData = () => {
      window.setTimeout(() => {
        if (!map.getSource(sourceId)) ensureLayers(map)
      }, 200)
    }

    map.on('click', circleLayerId, handleClick)
    map.on('mouseenter', circleLayerId, handleMouseEnter)
    map.on('mouseleave', circleLayerId, handleMouseLeave)
    map.on('styledata', handleStyleData)
    return () => {
      map.off('click', circleLayerId, handleClick)
      map.off('mouseenter', circleLayerId, handleMouseEnter)
      map.off('mouseleave', circleLayerId, handleMouseLeave)
      map.off('styledata', handleStyleData)
      try {
        if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId)
        if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Style replacement can remove the layers before this cleanup runs.
      }
    }
  }, [circleLayerId, ensureLayers, isLoaded, labelLayerId, map, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
    source?.setData(data)
  }, [data, isLoaded, map, sourceId])

  return null
}

function LocationPopupContent({
  name,
  count,
  resourceTypes,
  resourceTypeColors,
  resourceTypeLabels,
}: {
  name: string
  count: number
  resourceTypes: Record<string, number>
  resourceTypeColors: Record<string, string>
  resourceTypeLabels: Record<string, string>
}) {
  const sorted = Object.entries(resourceTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const maxTypeCount = sorted[0]?.[1] ?? 1
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{formatLocationName(name)}</h3>
        <p className="text-xs text-muted-foreground">{count} publications (filtered)</p>
      </div>
      <div className="space-y-1">
        {sorted.map(([type, typeCount]) => (
          <div key={type} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: resourceTypeColors[type] ?? resourceTypeColors.other }}
            />
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(typeCount / maxTypeCount) * 100}%`,
                  backgroundColor: resourceTypeColors[type] ?? resourceTypeColors.other,
                }}
              />
            </span>
            <span className="w-16 truncate text-right text-muted-foreground">{resourceTypeLabels[type] ?? type}</span>
            <span className="w-6 text-right font-medium">{typeCount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResearchPortalLegend({
  config,
  counts,
  elevated = false,
}: {
  config: ProjectDataPortalDef
  counts: Array<[string, number]>
  elevated?: boolean
}) {
  const countMap = new globalThis.Map(counts)
  return (
    <MapLegendPanel
      title="Resource types"
      description="Circle size represents publication count."
      icon={<Layers className="size-3.5" />}
      collapsible
      elevated={elevated}
      width="sm"
      contentClassName="space-y-1"
    >
      {config.resourceTypes.map((type) => (
        <LegendItem
          key={type.id}
          color={type.color}
          label={type.label}
          value={(countMap.get(type.id) ?? 0).toLocaleString()}
        />
      ))}
    </MapLegendPanel>
  )
}

function formatLocationName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

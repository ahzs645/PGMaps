import { ArrowLeft, BookOpen, Calendar, Globe, Layers, MapPin, Play, RotateCcw, Search, X } from 'lucide-react'
import type MapLibreGL from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { Map, MapControls, MapPopup, useMap } from '@/components/ui/map'
import { LegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { Timeline } from '@/components/ui/timeline'
import type {
  ProjectExplorerFeatureDef,
  ProjectExplorerSummaryIcon,
  ProjectMapExplorerWorkspaceDef,
} from '@/lib/projectPackages'
import { cn } from '@/lib/utils'

import type { ExplorerLocationFeatureProperties, ResearchRecord } from './adapters/researchRecordsTypes'
import { type ResearchRecordsAdapterData, useResearchRecordsAdapter } from './adapters/useResearchRecordsAdapter'

export function ProjectMapExplorer({
  title,
  config,
  onBack,
}: {
  title: string
  config: ProjectMapExplorerWorkspaceDef
  onBack: () => void
}) {
  const [timelineMode, setTimelineMode] = useState(false)
  const data = useResearchRecordsAdapter(config)

  if (data.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
            <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
          </div>
          <span className="text-sm text-muted-foreground">{config.labels.loading}</span>
        </div>
      </div>
    )
  }

  if (data.error) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-sm rounded-lg border bg-card p-5 text-center shadow-sm">
          <h2 className="text-base font-semibold text-foreground">{config.labels.unavailable}</h2>
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
        <ProjectExplorerSidebar
          title={title}
          onBack={onBack}
          config={config}
          data={data}
          timelineMode={timelineMode}
          onToggleTimeline={() => {
            data.setSelectedLocationId(null)
            setTimelineMode((current) => !current)
          }}
        />
      }
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobileCollapsedVisibleHeight={68}
      mobilePeek={
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {data.filteredStats.totalPublications.toLocaleString()} {config.labels.recordPlural}
          </div>
        </div>
      }
      showMobilePeek
    >
      <ProjectExplorerMap
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

function ProjectExplorerSidebar({
  title,
  onBack,
  config,
  data,
  timelineMode,
  onToggleTimeline,
}: {
  title: string
  onBack: () => void
  config: ProjectMapExplorerWorkspaceDef
  data: ResearchRecordsAdapterData
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
  const summaryFeature = config.features.find((feature) => feature.type === 'summary-stats')
  const aggregateFeature = config.features.find((feature) => feature.type === 'aggregate-records')

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

      {summaryFeature && (
        <div className="shrink-0 border-b border-border p-3">
          <div className={cn('grid gap-2', summaryFeature.items.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
            {summaryFeature.items.map((item) => (
              <StatCard
                key={item.metric}
                icon={summaryIcon(item.icon)}
                value={summaryMetricValue(item.metric, overview, filteredStats)}
                label={item.label}
              />
            ))}
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
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {config.features.map((feature, index) => {
          const key = `${feature.type}-${index}`
          switch (feature.type) {
            case 'timeline':
              return (
                <TimelineFeature
                  key={key}
                  feature={feature}
                  decades={decades}
                  selectedDecade={selectedDecade}
                  onSelectDecade={(decade) => setSelectedDecade(decade === selectedDecade ? null : decade)}
                  timelineMode={timelineMode}
                  onToggleTimeline={onToggleTimeline}
                  recordPlural={config.labels.recordPlural}
                />
              )
            case 'category-filter':
              return (
                <CategoryFilterFeature
                  key={key}
                  feature={feature}
                  categories={allResourceTypes}
                  selectedCategories={selectedTypes}
                  colors={data.resourceTypeColors}
                  labels={data.resourceTypeLabels}
                  onToggle={toggleResourceType}
                />
              )
            case 'aggregate-records':
              if (regionalOnlySubmissions.length === 0) return null
              return (
                <AggregateRecordsFeature
                  key={key}
                  feature={feature}
                  count={regionalOnlySubmissions.length}
                  onOpen={() => setShowRegionalModal(true)}
                />
              )
            case 'search':
              return <SearchFeature key={key} feature={feature} query={searchQuery} onQueryChange={setSearchQuery} />
            case 'ranked-list':
              return (
                <RankedListFeature
                  key={key}
                  feature={feature}
                  locations={filteredLocations}
                  locationPlural={config.labels.locationPlural}
                  onSelect={setSelectedLocationId}
                />
              )
            default:
              return null
          }
        })}
      </div>

      {showRegionalModal && aggregateFeature?.type === 'aggregate-records' && (
        <AggregateRecordsModal
          feature={aggregateFeature}
          submissions={regionalOnlySubmissions}
          resourceTypeLabels={data.resourceTypeLabels}
          recordSingular={config.labels.recordSingular}
          onClose={() => setShowRegionalModal(false)}
        />
      )}
    </div>
  )
}

type ExplorerFeature<T extends ProjectExplorerFeatureDef['type']> = Extract<ProjectExplorerFeatureDef, { type: T }>

function TimelineFeature({
  feature,
  decades,
  selectedDecade,
  onSelectDecade,
  timelineMode,
  onToggleTimeline,
  recordPlural,
}: {
  feature: ExplorerFeature<'timeline'>
  decades: ResearchRecordsAdapterData['decades']
  selectedDecade: number | null
  onSelectDecade: (decade: number) => void
  timelineMode: boolean
  onToggleTimeline: () => void
  recordPlural: string
}) {
  return (
    <section className="border-b border-border p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{feature.title}</h3>
      <DecadeTimeline
        decades={decades}
        selectedDecade={selectedDecade}
        onSelectDecade={onSelectDecade}
        recordPlural={recordPlural}
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
        {timelineMode ? feature.hideLabel : feature.showLabel}
      </button>
    </section>
  )
}

function CategoryFilterFeature({
  feature,
  categories,
  selectedCategories,
  colors,
  labels,
  onToggle,
}: {
  feature: ExplorerFeature<'category-filter'>
  categories: Array<[string, number]>
  selectedCategories: Set<string>
  colors: Record<string, string>
  labels: Record<string, string>
  onToggle: (category: string) => void
}) {
  return (
    <section className="border-b border-border p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{feature.title}</h3>
      <div className="space-y-0.5">
        {categories.map(([category, count]) => {
          const isSelected = selectedCategories.size === 0 || selectedCategories.has(category)
          return (
            <button
              key={category}
              type="button"
              onClick={() => onToggle(category)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors',
                isSelected ? 'hover:bg-muted' : 'opacity-40 hover:opacity-60',
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colors[category] ?? colors.other }}
              />
              <span className="flex-1 truncate text-left">{labels[category] ?? category}</span>
              <span className="text-muted-foreground">{count}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AggregateRecordsFeature({
  feature,
  count,
  onOpen,
}: {
  feature: ExplorerFeature<'aggregate-records'>
  count: number
  onOpen: () => void
}) {
  return (
    <section className="border-b border-border p-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
      >
        <Globe className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">{applyCountTemplate(feature.triggerTemplate, count)}</span>
      </button>
    </section>
  )
}

function SearchFeature({
  feature,
  query,
  onQueryChange,
}: {
  feature: ExplorerFeature<'search'>
  query: string
  onQueryChange: (query: string) => void
}) {
  return (
    <section className="border-b border-border p-3">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={feature.placeholder}
          className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="size-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </section>
  )
}

function RankedListFeature({
  feature,
  locations,
  locationPlural,
  onSelect,
}: {
  feature: ExplorerFeature<'ranked-list'>
  locations: ResearchRecordsAdapterData['filteredLocations']
  locationPlural: string
  onSelect: (locationId: string) => void
}) {
  const maxCount = locations[0]?.filteredCount ?? 1
  return (
    <section className="p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{feature.title}</h3>
      <div className="space-y-0.5">
        {locations.slice(0, feature.limit).map((location) => (
          <button
            key={location.id}
            type="button"
            onClick={() => onSelect(location.id)}
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
        ))}
        {locations.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No {locationPlural} match filters</p>
        )}
      </div>
    </section>
  )
}

function summaryIcon(icon: ProjectExplorerSummaryIcon) {
  if (icon === 'map-pin') return <MapPin className="size-3" />
  if (icon === 'calendar') return <Calendar className="size-3" />
  return <BookOpen className="size-3" />
}

function summaryMetricValue(
  metric: ExplorerFeature<'summary-stats'>['items'][number]['metric'],
  overview: ResearchRecordsAdapterData['overview'],
  filteredStats: ResearchRecordsAdapterData['filteredStats'],
) {
  if (metric === 'records') return filteredStats.totalPublications
  if (metric === 'locations') return filteredStats.activeLocations
  if (!overview?.yearRange) return '—'
  return `${overview.yearRange.min}–${overview.yearRange.max}`
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
  recordPlural,
}: {
  decades: ResearchRecordsAdapterData['decades']
  selectedDecade: number | null
  onSelectDecade: (decade: number) => void
  recordPlural: string
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
            title={`${item.decade}s: ${item.total} ${recordPlural}`}
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

function AggregateRecordsModal({
  feature,
  submissions,
  resourceTypeLabels,
  recordSingular,
  onClose,
}: {
  feature: ExplorerFeature<'aggregate-records'>
  submissions: ResearchRecord[]
  resourceTypeLabels: Record<string, string>
  recordSingular: string
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
        aria-label={`Close ${recordSingular} collection`}
      />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{feature.modalTitle}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {applyCountTemplate(feature.modalDescription, submissions.length)}
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
                {submission.title || `Untitled ${recordSingular}`}
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

function ProjectExplorerMap({
  config,
  data,
  timelineMode,
  onExitTimeline,
}: {
  config: ProjectMapExplorerWorkspaceDef
  data: ResearchRecordsAdapterData
  timelineMode: boolean
  onExitTimeline: () => void
}) {
  const { locationGeoJSON, selectedLocation, setSelectedLocationId } = data
  const timelineFeature = config.features.find((feature) => feature.type === 'timeline')
  const legendFeature = config.features.find((feature) => feature.type === 'map-legend')
  const popupFeature = config.features.find((feature) => feature.type === 'location-popup')
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
    <Map
      center={config.map.center}
      zoom={config.map.zoom}
      minZoom={config.map.minZoom}
      maxZoom={config.map.maxZoom}
      controls={<MapControls position="top-right" showZoom showCompass showFullscreen />}
    >
      <ResearchLocationLayer
        idPrefix="research"
        data={activeGeoJSON}
        fallbackColor={data.resourceTypeColors.other ?? '#94a3b8'}
        onLocationClick={(properties) => setSelectedLocationId(properties.id)}
      />
      {legendFeature?.type === 'map-legend' && (
        <ProjectExplorerLegend config={config} feature={legendFeature} counts={legendCounts} elevated={timelineMode} />
      )}
      {!timelineMode && popupFeature?.type === 'location-popup' && selectedLocation?.coordinates && (
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
            recordPlural={config.labels.recordPlural}
            maxCategories={popupFeature.maxCategories}
          />
        </MapPopup>
      )}
      {timelineMode && popupFeature?.type === 'location-popup' && selectedTimelineFeature && (
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
              {selectedTimelineFeature.properties.count.toLocaleString()} {config.labels.recordPlural} in the{' '}
              {currentDecade}s
            </p>
          </div>
        </MapPopup>
      )}
      {timelineMode && timelineFeature?.type === 'timeline' && (
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
          bucketValueLabel={config.labels.recordPlural}
          statsLabel={`${decadeSummary?.total.toLocaleString() ?? 0} ${config.labels.recordPlural}`}
          granularity={timelineFeature.granularity}
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
  data: GeoJSON.FeatureCollection<GeoJSON.Point, ExplorerLocationFeatureProperties>
  fallbackColor: string
  onLocationClick: (properties: ExplorerLocationFeatureProperties) => void
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
      if (feature) onClickRef.current(feature.properties as unknown as ExplorerLocationFeatureProperties)
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
  recordPlural,
  maxCategories,
}: {
  name: string
  count: number
  resourceTypes: Record<string, number>
  resourceTypeColors: Record<string, string>
  resourceTypeLabels: Record<string, string>
  recordPlural: string
  maxCategories: number
}) {
  const sorted = Object.entries(resourceTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCategories)
  const maxTypeCount = sorted[0]?.[1] ?? 1
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{formatLocationName(name)}</h3>
        <p className="text-xs text-muted-foreground">
          {count} {recordPlural} (filtered)
        </p>
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

function ProjectExplorerLegend({
  config,
  feature,
  counts,
  elevated = false,
}: {
  config: ProjectMapExplorerWorkspaceDef
  feature: ExplorerFeature<'map-legend'>
  counts: Array<[string, number]>
  elevated?: boolean
}) {
  const countMap = new globalThis.Map(counts)
  return (
    <MapLegendPanel
      title={feature.title}
      description={feature.description}
      icon={<Layers className="size-3.5" />}
      collapsible
      elevated={elevated}
      width="sm"
      contentClassName="space-y-1"
    >
      {config.data.categories.map((type) => (
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

function applyCountTemplate(template: string, count: number) {
  return template.split('{count}').join(count.toLocaleString())
}

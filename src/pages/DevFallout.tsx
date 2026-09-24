import bbox from '@turf/bbox'
import { Filter, MapPin, RadioTower, Search, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Map, MapClusterLayer, MapControls, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MapLineLayer } from '@/components/ui/map-layers'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { InlineAlert, KeyValueRows, MapSidebarShell, SearchInput, SidebarSection } from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { AppSelect } from '@/components/ui/select'
import { StatGroup } from '@/components/ui/stat-group'
import { ToggleRow } from '@/components/ui/toggle-row'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

type FalloutProperties = {
  id: string
  name: string
  description: string
  rawDescription: string
  province: string
  sourceStyle: string
  sourceColor: string | null
  sourceIcon: string
  sourceWidth: number | null
  featureType: string
}

type FalloutPointFeature = GeoJSON.Feature<GeoJSON.Point, FalloutProperties>
type FalloutLineFeature = GeoJSON.Feature<GeoJSON.LineString, FalloutProperties>
type FalloutFeature = FalloutPointFeature | FalloutLineFeature
type FalloutCollection = GeoJSON.FeatureCollection<GeoJSON.Point | GeoJSON.LineString, FalloutProperties> & {
  metadata?: {
    title?: string
    totalFeatures?: number
    byGeometry?: Record<string, number>
    byProvince?: Record<string, number>
    byType?: Record<string, number>
  }
}

const DATA_PATH = '/data/fallout/fallout-reporting-posts-canada.geojson'
const CANADA_CENTER: [number, number] = [-96.8, 56.1]

function featureCoordinate(feature: FalloutFeature): [number, number] {
  if (feature.geometry.type === 'Point') return feature.geometry.coordinates as [number, number]
  const coordinates = feature.geometry.coordinates
  const middle = coordinates[Math.floor(coordinates.length / 2)] ?? coordinates[0]
  return middle as [number, number]
}

function FitBounds({ data }: { data: GeoJSON.FeatureCollection }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!isLoaded || !map || data.features.length === 0) return
    const bounds = bbox(data as never) as [number, number, number, number]
    map.fitBounds(bounds, {
      padding: { top: 72, bottom: 56, left: 36, right: 36 },
      duration: 650,
      maxZoom: 8,
    })
  }, [data, isLoaded, map])

  return null
}

function DevFallout() {
  const [collection, setCollection] = useState<FalloutCollection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [province, setProvince] = useState('All')
  const [featureType, setFeatureType] = useState('All')
  const [query, setQuery] = useState('')
  const [showPoints, setShowPoints] = useState(true)
  const [showLines, setShowLines] = useState(true)
  const [selected, setSelected] = useState<FalloutFeature | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(DATA_PATH, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to load fallout data: ${response.status}`)
        const data = await response.json() as FalloutCollection
        if (!controller.signal.aborted) setCollection(data)
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message || 'Unable to load fallout data')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  const provinces = useMemo(() => {
    const values = new Set<string>()
    collection?.features.forEach((feature) => values.add(feature.properties.province))
    return ['All', ...Array.from(values).sort((a, b) => a.localeCompare(b))]
  }, [collection])

  const featureTypes = useMemo(() => {
    const values = new Set<string>()
    collection?.features.forEach((feature) => values.add(feature.properties.featureType))
    return ['All', ...Array.from(values).sort((a, b) => a.localeCompare(b))]
  }, [collection])

  const filteredFeatures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return (collection?.features ?? []).filter((feature) => {
      const properties = feature.properties
      if (province !== 'All' && properties.province !== province) return false
      if (featureType !== 'All' && properties.featureType !== featureType) return false
      if (!normalizedQuery) return true
      return `${properties.name} ${properties.description} ${properties.province} ${properties.featureType}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [collection, featureType, province, query])

  const pointData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, FalloutProperties>>(() => ({
    type: 'FeatureCollection',
    features: filteredFeatures.filter((feature): feature is FalloutPointFeature => feature.geometry.type === 'Point'),
  }), [filteredFeatures])

  const lineData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString, FalloutProperties>>(() => ({
    type: 'FeatureCollection',
    features: filteredFeatures.filter((feature): feature is FalloutLineFeature => feature.geometry.type === 'LineString'),
  }), [filteredFeatures])

  const visibleFitData = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: [
      ...(showPoints ? pointData.features : []),
      ...(showLines ? lineData.features : []),
    ],
  }), [lineData, pointData, showLines, showPoints])

  const selectedCoordinate = selected ? featureCoordinate(selected) : null
  const selectedGeometryType = selected?.geometry.type ?? null
  const totalFeatures = collection?.metadata?.totalFeatures ?? collection?.features.length ?? 0

  const handleLineClick = useCallback((id: string) => {
    const feature = lineData.features.find((candidate) => candidate.properties.id === id) ?? null
    setSelected(feature)
  }, [lineData])

  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Fallout posts & shelters"
      subtitle="Imported from the Google My Maps KML export for Canadian fallout reporting posts and nuclear shelter references."
      icon={ShieldAlert}
    >
      {error && (
        <div className="border-b border-border p-4">
          <InlineAlert tone="error" className="text-sm">{error}</InlineAlert>
        </div>
      )}

      <SidebarSection>
        <StatGroup
          variant="tiles"
          size="sm"
          columns={3}
          items={[
            { label: 'Total', value: formatNumber(totalFeatures), loading },
            { label: 'Points', value: formatNumber(pointData.features.length) },
            { label: 'Lines', value: formatNumber(lineData.features.length) },
          ]}
        />
      </SidebarSection>

      <SidebarSection title="Search" icon={Search}>
        <SearchInput
          icon
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Name, notes, province..."
          aria-label="Search fallout features"
        />
      </SidebarSection>

      <SidebarSection title="Filters" icon={Filter}>
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Province or region</span>
            <AppSelect
              value={province}
              onValueChange={setProvince}
              options={provinces.map((item) => ({ value: item, label: item }))}
              triggerAriaLabel="Province or region"
              className="w-full"
              triggerClassName="h-9 rounded-md text-sm"
            />
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Feature type</span>
            <AppSelect
              value={featureType}
              onValueChange={setFeatureType}
              options={featureTypes.map((item) => ({ value: item, label: item }))}
              triggerAriaLabel="Feature type"
              className="w-full"
              triggerClassName="h-9 rounded-md text-sm"
            />
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title="Layers">
        <div className="space-y-2">
          <ToggleRow
            active={showPoints}
            label={<LayerLabel color="bg-red-500" active={showPoints}>Point placemarks</LayerLabel>}
            trailing={<span className="text-muted-foreground">{formatNumber(pointData.features.length)}</span>}
            onClick={() => setShowPoints((current) => !current)}
          />
          <ToggleRow
            active={showLines}
            label={<LayerLabel color="bg-amber-400" active={showLines}>Communication lines</LayerLabel>}
            trailing={<span className="text-muted-foreground">{formatNumber(lineData.features.length)}</span>}
            onClick={() => setShowLines((current) => !current)}
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Visible results">
        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {filteredFeatures.slice(0, 80).map((feature) => (
            <button
              key={feature.properties.id}
              type="button"
              onClick={() => setSelected(feature as FalloutFeature)}
              className={cn(
                'w-full rounded-md border px-2 py-2 text-left transition-colors hover:bg-muted',
                selected?.properties.id === feature.properties.id ? 'border-sky-500 bg-sky-500/10' : 'border-border bg-background',
              )}
            >
              <div className="truncate text-xs font-semibold">{feature.properties.name}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {feature.properties.province} · {feature.properties.featureType}
              </div>
            </button>
          ))}
          {filteredFeatures.length > 80 && (
            <div className="px-1 pt-1 text-xs text-muted-foreground">
              Showing first 80 of {formatNumber(filteredFeatures.length)} filtered features.
            </div>
          )}
        </div>
      </SidebarSection>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobilePeekTitle={`${formatNumber(filteredFeatures.length)} fallout features`}
      mobilePeekSubtitle={province === 'All' ? 'Canada' : province}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map
          center={CANADA_CENTER}
          zoom={3.3}
          loading={loading}
          controls={<MapControls position="top-right" className="top-16 md:top-2" />}
        >
          <FitBounds data={visibleFitData} />

          {showLines && (
            <MapLineLayer
              data={lineData}
              color={['coalesce', ['get', 'sourceColor'], '#f59e0b']}
              width={['interpolate', ['linear'], ['zoom'], 3, 1.2, 7, 3.2]}
              opacity={0.82}
              idProperty="id"
              selectedId={selectedGeometryType === 'LineString' ? selected?.properties.id : null}
              selectionColor="#0ea5e9"
              onFeatureClick={handleLineClick}
            />
          )}

          {showPoints && (
            <MapClusterLayer<FalloutProperties>
              data={pointData}
              clusterRadius={42}
              clusterMaxZoom={9}
              clusterColors={['#f97316', '#dc2626', '#7f1d1d']}
              clusterThresholds={[25, 100]}
              clusterSizes={[16, 24, 34]}
              pointColor="#dc2626"
              circleOpacity={0.88}
              circleStrokeWidth={1.4}
              onPointClick={(feature) => setSelected(feature)}
            />
          )}

          {selectedCoordinate && (
            <MapMarker longitude={selectedCoordinate[0]} latitude={selectedCoordinate[1]}>
              <MarkerContent>
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-white shadow-lg">
                  {selectedGeometryType === 'Point' ? <MapPin className="size-4" /> : <RadioTower className="size-4" />}
                </div>
              </MarkerContent>
            </MapMarker>
          )}

          {selected && selectedCoordinate && (
            <MapPopup
              longitude={selectedCoordinate[0]}
              latitude={selectedCoordinate[1]}
              onClose={() => setSelected(null)}
              closeButton={false}
            >
              <FeaturePopup feature={selected} onClose={() => setSelected(null)} />
            </MapPopup>
          )}
        </Map>
      </div>
    </MapSectionLayout>
  )
}

function LayerLabel({ color, active, children }: { color: string; active: boolean; children: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={cn('size-2.5 shrink-0 rounded-full', active ? color : 'bg-muted-foreground/40')} aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  )
}

function FeaturePopup({ feature, onClose }: { feature: FalloutFeature; onClose: () => void }) {
  const description = feature.properties.description
  return (
    <MapPopupCard
      className="w-64"
      eyebrow={feature.properties.featureType}
      title={<span className="line-clamp-2">{feature.properties.name}</span>}
      onClose={onClose}
      closeLabel="Close popup"
    >
      <KeyValueRows
        variant="grid"
        rows={[
          { label: 'Province', value: feature.properties.province },
          { label: 'Geometry', value: feature.geometry.type },
        ]}
      />
      {description && (
        <p className="max-h-40 overflow-y-auto whitespace-pre-line border-t border-border pt-2 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      )}
    </MapPopupCard>
  )
}

export default DevFallout

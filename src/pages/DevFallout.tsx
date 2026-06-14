import bbox from '@turf/bbox'
import { Filter, MapPin, RadioTower, Search, ShieldAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Map, MapClusterLayer, MapControls, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MapLineLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
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
  const [showSidebar, setShowSidebar] = useState(true)
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
    <aside className="flex h-full w-full flex-col bg-background/95 md:w-[360px] md:border-r md:shadow-xl">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <ShieldAlert className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Fallout posts &amp; shelters</h1>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              Imported from the Google My Maps KML export for Canadian fallout reporting posts and nuclear shelter references.
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="grid grid-cols-3 gap-2">
          <Stat label="Total" value={loading ? '...' : totalFeatures.toLocaleString()} />
          <Stat label="Points" value={pointData.features.length.toLocaleString()} />
          <Stat label="Lines" value={lineData.features.length.toLocaleString()} />
        </section>

        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Search className="size-3" />
            Search
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, notes, province..."
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
          />
        </section>

        <section className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Filter className="size-3" />
            Filters
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Province or region</span>
            <select
              value={province}
              onChange={(event) => setProvince(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              {provinces.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Feature type</span>
            <select
              value={featureType}
              onChange={(event) => setFeatureType(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              {featureTypes.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="space-y-2 border-t border-border pt-4">
          <LayerToggle
            checked={showPoints}
            label="Point placemarks"
            count={pointData.features.length}
            colorClass="bg-red-500"
            onChange={() => setShowPoints((current) => !current)}
          />
          <LayerToggle
            checked={showLines}
            label="Communication lines"
            count={lineData.features.length}
            colorClass="bg-amber-400"
            onChange={() => setShowLines((current) => !current)}
          />
        </section>

        <section className="border-t border-border pt-4">
          <h2 className="mb-2 text-sm font-semibold">Visible results</h2>
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
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {feature.properties.province} · {feature.properties.featureType}
                </div>
              </button>
            ))}
            {filteredFeatures.length > 80 && (
              <div className="px-1 pt-1 text-[11px] text-muted-foreground">
                Showing first 80 of {filteredFeatures.length.toLocaleString()} filtered features.
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{filteredFeatures.length.toLocaleString()} fallout features</div>
          <div className="truncate text-[11px] text-muted-foreground">{province === 'All' ? 'Canada' : province}</div>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map center={CANADA_CENTER} zoom={3.3} loading={loading}>
          <MapControls position="top-right" className="top-16 md:top-2" />
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

function LayerToggle({
  checked,
  label,
  count,
  colorClass,
  onChange,
}: {
  checked: boolean
  label: string
  count: number
  colorClass: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={cn(
        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors',
        checked ? 'border-sky-500 bg-sky-500/10' : 'border-border bg-background text-muted-foreground',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('size-2.5 rounded-full', checked ? colorClass : 'bg-muted-foreground/40')} />
        <span className="truncate font-medium">{label}</span>
      </span>
      <span className="text-xs text-muted-foreground">{count.toLocaleString()}</span>
    </button>
  )
}

function FeaturePopup({ feature, onClose }: { feature: FalloutFeature; onClose: () => void }) {
  const description = feature.properties.description
  return (
    <div className="w-72 overflow-hidden rounded-md bg-popover text-popover-foreground">
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-muted-foreground">{feature.properties.featureType}</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold">{feature.properties.name}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close popup">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-2 px-3 py-2 text-sm">
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">Province</span>
          <span className="font-medium">{feature.properties.province}</span>
          <span className="text-muted-foreground">Geometry</span>
          <span className="font-medium">{feature.geometry.type}</span>
        </div>
        {description && (
          <p className="max-h-40 overflow-y-auto whitespace-pre-line border-t border-border pt-2 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  )
}

export default DevFallout

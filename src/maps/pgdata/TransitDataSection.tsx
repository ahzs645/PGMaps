import { useEffect, useMemo, useState } from 'react'
import { Bus, MapPin, Route } from 'lucide-react'
import { Map as PgMap, MapControls, MapMarker, MarkerContent, MarkerPopup } from '@/components/ui/map'
import { MapLineLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { DatasetInfo } from '@/components/DatasetInfo'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { useTransitData, type TransitStop } from '@/maps/scorebuilder/hooks/useTransitData'

type TransitLayerId = 'stops' | 'routes'

interface RouteFeatureProperties {
  segmentKey?: string
  routeId: string
  routeShortName: string
  routeLongName: string
  routeColor: string
  routeTextColor: string
  shapeId?: string
  shapeIds?: string[]
  headsigns: string[]
  directions: string[]
  sharedRouteCount?: number
  segmentOffset?: number
  snappedToRoad?: boolean
  snappedPointCount?: number
  pointCount?: number
  bundledSegmentCount?: number
}

type RouteFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProperties>

const ROUTES_PATH = '/data/transit/prince_george_gtfs_route_bundles.geojson?v=edge-bundle-2'
const LAYER_OPTIONS: Array<{ id: TransitLayerId; label: string }> = [
  { id: 'stops', label: 'Stops' },
  { id: 'routes', label: 'Routes' },
]

const ROUTE_PALETTE: Record<string, string> = {
  '1': '#005A9C',
  '5': '#F7931D',
  '10': '#7AC143',
  '11': '#F48BB8',
  '12': '#4B1A78',
  '15': '#EC008C',
  '16': '#22B8B0',
  '19': '#B77BB4',
  '46': '#8A1238',
  '47': '#00A64F',
  '55': '#13A8D8',
  '88': '#FFC20E',
  '89': '#0073AE',
  '91': '#A13A9D',
  '96': '#A7C539',
  '97': '#4F7F2A',
  '161': '#00843D',
}

const ROUTE_ORDER = ['1', '11', '10', '5', '55', '12', '15', '16', '19', '46', '47', '88', '89', '91', '96', '97', '161']
const DISPLAYED_ROUTES = new Set(ROUTE_ORDER)

function routeSortValue(routeShortName: string): number {
  const index = ROUTE_ORDER.indexOf(routeShortName)
  if (index >= 0) return index
  const numeric = Number(routeShortName)
  return Number.isFinite(numeric) ? 1000 + numeric : 9999
}

function routeColor(routeShortName: string, fallback: string): string {
  return ROUTE_PALETTE[routeShortName] ?? fallback
}

function subtypeLabel(subtype: number | null): string {
  if (subtype === 3) return 'Bus shelter'
  if (subtype === 4) return 'Exchange'
  if (subtype === 5) return 'HandiDART'
  return 'Bus stop'
}

function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km)) return 'No value'
  if (km < 1) return `${Math.round(km * 1000).toLocaleString()} m`
  return `${km.toLocaleString(undefined, { maximumFractionDigits: 2 })} km`
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = toRad(b[1] - a[1])
  const deltaLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)))
}

function useRouteData() {
  const [routes, setRoutes] = useState<RouteFeatureCollection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(ROUTES_PATH, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to fetch transit routes: ${response.status}`)
        const geojson = (await response.json()) as RouteFeatureCollection
        if (!controller.signal.aborted) setRoutes(geojson)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load transit routes')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  return { routes, loading, error }
}

function nearestStop(origin: [number, number], stops: TransitStop[]): { stop: TransitStop; distanceKm: number } | null {
  let best: { stop: TransitStop; distanceKm: number } | null = null
  stops.forEach((stop) => {
    const distance = distanceKm(origin, [stop.longitude, stop.latitude])
    if (!best || distance < best.distanceKm) best = { stop, distanceKm: distance }
  })
  return best
}

export default function TransitDataSection() {
  const { stops, loading: stopsLoading, error: stopsError } = useTransitData(true)
  const { routes, loading: routesLoading, error: routesError } = useRouteData()
  const [activeLayers, setActiveLayers] = useState<TransitLayerId[]>(['routes'])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'shelter' | 'accessible'>('all')
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)

  const filteredStops = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return stops.filter((stop) => {
      if (statusFilter === 'active' && stop.status !== 'ACT') return false
      if (statusFilter === 'shelter' && !stop.hasShelter) return false
      if (statusFilter === 'accessible' && !stop.accessible) return false
      if (!query) return true
      return [stop.name, stop.id, stop.status, subtypeLabel(stop.subtype)].join(' ').toLowerCase().includes(query)
    })
  }, [searchQuery, statusFilter, stops])

  const selectedStop = useMemo(
    () => filteredStops.find((stop) => stop.id === selectedStopId) ?? stops.find((stop) => stop.id === selectedStopId) ?? null,
    [filteredStops, selectedStopId, stops],
  )

  const routeCounts = useMemo(() => {
    const routeIds = new Set<string>()
    let shapes = 0
    routes?.features.forEach((feature) => {
      if (!DISPLAYED_ROUTES.has(feature.properties.routeShortName)) return
      routeIds.add(feature.properties.routeShortName)
      shapes += 1
    })
    return { routes: routeIds.size, shapes }
  }, [routes])

  const routeLayerData = useMemo<RouteFeatureCollection | null>(() => {
    if (!routes) return null
    const features = routes.features
      .filter((feature) => DISPLAYED_ROUTES.has(feature.properties.routeShortName))
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          segmentKey: String(feature.id ?? `${feature.properties.routeId}:${feature.properties.segmentOffset ?? 0}`),
          routeColor: routeColor(feature.properties.routeShortName, feature.properties.routeColor),
        },
      }))
    return {
      type: 'FeatureCollection',
      features,
    }
  }, [routes])

  const routeLegendItems = useMemo(() => {
    const grouped = new Map<string, RouteFeatureProperties>()
    routes?.features.forEach((feature) => {
      const routeShortName = feature.properties.routeShortName
      if (!DISPLAYED_ROUTES.has(routeShortName)) return
      if (!grouped.has(routeShortName)) grouped.set(routeShortName, feature.properties)
    })

    return Array.from(grouped.entries())
      .sort(([a], [b]) => routeSortValue(a) - routeSortValue(b))
      .map(([routeShortName, properties]) => ({
        id: routeShortName,
        label: `${routeShortName} ${properties.routeLongName}`.trim(),
        color: routeColor(routeShortName, properties.routeColor),
      }))
  }, [routes])

  const pgCenterNearestStop = useMemo(() => nearestStop(PG_CENTER, stops), [stops])
  const accessibleCount = useMemo(() => stops.filter((stop) => stop.accessible).length, [stops])
  const shelterCount = useMemo(() => stops.filter((stop) => stop.hasShelter).length, [stops])

  const toggleLayer = (layer: TransitLayerId) => {
    setActiveLayers((current) => (current.includes(layer) ? current.filter((id) => id !== layer) : [...current, layer]))
  }

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((value) => !value)}
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            Transit | {stops.length.toLocaleString()} stops
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {activeLayers.join(', ')} | {routeCounts.routes.toLocaleString()} routes
          </div>
        </div>
      )}
      sidebar={
        <aside className="flex h-full w-full flex-col border-0 bg-background shadow-none md:w-[350px] md:border-r md:shadow-xl">
          <div className="border-b border-border p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-700 dark:text-teal-300">
                <Bus className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Transit Access</h2>
                <p className="text-xs text-muted-foreground">CityPG stops and BC Transit route geometry</p>
              </div>
            </div>
          </div>

          <DatasetInfo dataset={DATASETS.transit} />

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {(stopsError || routesError) && (
              <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {stopsError || routesError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Stops" value={stops.length.toLocaleString()} loading={stopsLoading} />
              <StatCard label="Accessible" value={accessibleCount.toLocaleString()} loading={stopsLoading} />
              <StatCard label="Shelters/exchanges" value={shelterCount.toLocaleString()} loading={stopsLoading} />
              <StatCard label="Routes" value={routeCounts.routes.toLocaleString()} loading={routesLoading} />
            </div>

            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MapPin className="h-4 w-4 text-teal-600" />
                400 m proximity reference
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The OCP source treats 400 m from conventional transit as a reasonable walking distance for single residential housing.
              </p>
              {pgCenterNearestStop && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Nearest loaded stop to map center: <span className="font-medium text-foreground">{pgCenterNearestStop.stop.name}</span>{' '}
                  ({formatDistanceKm(pgCenterNearestStop.distanceKm)})
                </div>
              )}
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layers</label>
              <div className="grid grid-cols-2 gap-2">
                {LAYER_OPTIONS.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => toggleLayer(layer.id)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors',
                      activeLayers.includes(layer.id)
                        ? 'border-teal-500 bg-teal-500/10 text-teal-800 dark:text-teal-200'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {layer.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search stop name or ID..."
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-teal-500"
              />
              <AppSelect
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
                options={[
                  { value: 'all', label: 'All stops' },
                  { value: 'active', label: 'Active stops' },
                  { value: 'shelter', label: 'Shelters and exchanges' },
                  { value: 'accessible', label: 'Accessible / sidewalk proxy' },
                ]}
                triggerClassName="h-9 rounded-md text-sm focus:border-teal-500"
              />
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{filteredStops.length.toLocaleString()} visible stops</span>
                <span>{routeCounts.shapes.toLocaleString()} bundled corridors</span>
              </div>
              <div className="max-h-[42vh] space-y-1 overflow-y-auto pr-1">
                {filteredStops.slice(0, 120).map((stop) => (
                  <button
                    key={stop.id}
                    type="button"
                    onClick={() => setSelectedStopId(stop.id)}
                    className={cn(
                      'w-full rounded-md border px-3 py-2 text-left transition-colors',
                      selectedStopId === stop.id
                        ? 'border-teal-500 bg-teal-500/10'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium text-foreground">{stop.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{stop.id}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {subtypeLabel(stop.subtype)}
                      {stop.accessible ? ' · accessible proxy' : ''}
                      {stop.hasShelter ? ' · shelter/exchange' : ''}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
      }
    >
      <div className="relative h-full">
        <PgMap
          center={PG_CENTER}
          zoom={11}
          styles={MAP_STYLES}
        >
          <MapControls position="top-right" />
          {routeLayerData && (
            <>
              <MapLineLayer
                data={routeLayerData}
                idProperty="segmentKey"
                color="#ffffff"
                width={6}
                offset={['get', 'segmentOffset']}
                opacity={0.95}
                visible={activeLayers.includes('routes')}
              />
              <MapLineLayer
                data={routeLayerData}
                idProperty="segmentKey"
                color={['get', 'routeColor']}
                width={3.2}
                offset={['get', 'segmentOffset']}
                opacity={0.92}
                visible={activeLayers.includes('routes')}
              />
            </>
          )}
          {activeLayers.includes('stops') &&
            filteredStops.map((stop) => (
              <MapMarker
                key={stop.id}
                longitude={stop.longitude}
                latitude={stop.latitude}
                onClick={() => setSelectedStopId(stop.id)}
              >
                <MarkerContent>
                  <span
                    className={cn(
                      'block rounded-full border-2 shadow-sm',
                      stop.id === selectedStopId ? 'h-4 w-4 bg-teal-200 ring-4 ring-teal-500/30' : 'h-2.5 w-2.5 bg-background',
                      stop.hasShelter
                        ? 'border-cyan-700'
                        : stop.accessible
                          ? 'border-teal-700'
                          : 'border-slate-500',
                    )}
                  />
                </MarkerContent>
                {selectedStop?.id === stop.id && (
                  <MarkerPopup closeButton>
                    <div className="max-w-[220px] p-2">
                      <div className="text-sm font-semibold text-foreground">{stop.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Stop ID {stop.id}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {subtypeLabel(stop.subtype)}
                        {stop.accessible ? ' · accessible proxy' : ''}
                        {stop.hasShelter ? ' · shelter/exchange' : ''}
                      </div>
                    </div>
                  </MarkerPopup>
                )}
              </MapMarker>
            ))}
        </PgMap>

        <div className="absolute bottom-6 right-6 z-10 rounded-md border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
            <Route className="h-3.5 w-3.5" />
            Transit layers
          </div>
          <div className="max-h-[34vh] space-y-1 overflow-y-auto pr-1 text-xs text-muted-foreground">
            {routeLegendItems.map((item) => (
              <LegendItem key={item.id} color={item.color} label={item.label} />
            ))}
            <LegendItem color="#0891b2" label="Shelter / exchange" />
            <LegendItem color="#0d9488" label="Accessible / sidewalk proxy" />
            <LegendItem color="#64748b" label="Other stop" />
          </div>
        </div>
      </div>
    </MapSectionLayout>
  )
}

function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-lg font-semibold text-foreground">{loading ? '...' : value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  )
}

import area from '@turf/area'
import bbox from '@turf/bbox'
import { Eye, EyeOff, Info, Layers, MapPin, MoreHorizontal, Ruler, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type LayerId = 'parks' | 'routes' | 'neighbourhoods'

interface InteractFeatureProperties extends Record<string, unknown> {
  id: string
  name: string
  layer: LayerId
  description: string
  value?: string
  properties: Array<{ label: string; value: string }>
}

type PolygonFeature = GeoJSON.Feature<GeoJSON.Polygon, InteractFeatureProperties>
type LineFeature = GeoJSON.Feature<GeoJSON.LineString, InteractFeatureProperties>
type MeasurementMode = 'idle' | 'drawing' | 'complete'

const CENTER: [number, number] = [-122.7497, 53.9171]
const EARTH_RADIUS_KM = 6371.0088

const parkFeatures: GeoJSON.FeatureCollection<GeoJSON.Polygon, InteractFeatureProperties> = {
  type: 'FeatureCollection',
  features: [
    polygonFeature('cottonwood', 'Cottonwood Island Park', 'parks', 'Riverfront park and trail access.', [
      [-122.757, 53.923],
      [-122.746, 53.925],
      [-122.742, 53.919],
      [-122.751, 53.915],
      [-122.761, 53.918],
      [-122.757, 53.923],
    ], 'Large natural park'),
    polygonFeature('lheidli', 'Lheidli T\'enneh Memorial Park', 'parks', 'Central gathering space near downtown.', [
      [-122.753, 53.910],
      [-122.743, 53.912],
      [-122.740, 53.906],
      [-122.748, 53.902],
      [-122.757, 53.905],
      [-122.753, 53.910],
    ], 'Civic park'),
  ],
}

const neighbourhoodFeatures: GeoJSON.FeatureCollection<GeoJSON.Polygon, InteractFeatureProperties> = {
  type: 'FeatureCollection',
  features: [
    polygonFeature('downtown', 'Downtown', 'neighbourhoods', 'Mixed-use core with civic destinations.', [
      [-122.762, 53.919],
      [-122.740, 53.921],
      [-122.735, 53.906],
      [-122.754, 53.899],
      [-122.770, 53.908],
      [-122.762, 53.919],
    ], 'Core area'),
    polygonFeature('college-heights', 'College Heights', 'neighbourhoods', 'Residential area with ridge views.', [
      [-122.820, 53.902],
      [-122.785, 53.908],
      [-122.774, 53.887],
      [-122.802, 53.875],
      [-122.830, 53.884],
      [-122.820, 53.902],
    ], 'Residential'),
  ],
}

const routeFeatures: GeoJSON.FeatureCollection<GeoJSON.LineString, InteractFeatureProperties> = {
  type: 'FeatureCollection',
  features: [
    lineFeature('route-15', 'Route 15', 'routes', 'East-west transit spine through the city centre.', [
      [-122.815, 53.894],
      [-122.790, 53.902],
      [-122.760, 53.911],
      [-122.733, 53.918],
      [-122.704, 53.928],
    ], '15 min'),
    lineFeature('route-5', 'Route 5', 'routes', 'North-south route connecting parks and downtown.', [
      [-122.777, 53.940],
      [-122.761, 53.923],
      [-122.749, 53.909],
      [-122.740, 53.891],
      [-122.728, 53.874],
    ], '30 min'),
  ],
}

const actionRows = [
  { label: 'Search locations', icon: Search },
  { label: 'Measure areas', icon: Ruler },
]

function polygonFeature(
  id: string,
  name: string,
  layer: LayerId,
  description: string,
  ring: [number, number][],
  value: string,
): PolygonFeature {
  return {
    type: 'Feature',
    id,
    properties: { id, name, layer, description, value, properties: featureProperties(layer, value) },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

function lineFeature(
  id: string,
  name: string,
  layer: LayerId,
  description: string,
  coordinates: [number, number][],
  value: string,
): LineFeature {
  return {
    type: 'Feature',
    id,
    properties: { id, name, layer, description, value, properties: featureProperties(layer, value) },
    geometry: { type: 'LineString', coordinates },
  }
}

function featureProperties(layer: LayerId, value: string): Array<{ label: string; value: string }> {
  if (layer === 'parks') {
    return [
      { label: 'Category', value },
      { label: 'Access', value: 'Public' },
      { label: 'Trail Connection', value: 'Yes' },
      { label: 'Maintained By', value: 'City of Prince George' },
      { label: 'Inspection Status', value: 'Active' },
    ]
  }
  if (layer === 'routes') {
    return [
      { label: 'Route Type', value: 'Transit' },
      { label: 'Frequency', value },
      { label: 'Service Status', value: 'Active' },
      { label: 'Primary Corridor', value: 'Yes' },
      { label: 'Stops in View', value: '8' },
    ]
  }
  return [
    { label: 'Area Type', value },
    { label: 'Profile', value: 'Neighbourhood' },
    { label: 'Map Layer', value: 'Boundary' },
    { label: 'Feature Count', value: '1' },
    { label: 'Selection Status', value: 'Active' },
  ]
}

function formatArea(squareMeters: number): string {
  const squareKm = squareMeters / 1_000_000
  if (squareKm >= 1) return `${squareKm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sq km`
  return `${(squareMeters / 10_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`
}

function formatDistance(km: number): string {
  if (km >= 1) return `${km.toLocaleString(undefined, { maximumFractionDigits: 2 })} km`
  return `${Math.round(km * 1000).toLocaleString()} m`
}

function closeRing(points: [number, number][]): [number, number][] {
  if (points.length === 0) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return points
  return [...points, first]
}

function lineLengthKm(coordinates: [number, number][]): number {
  return coordinates.slice(1).reduce((total, coordinate, index) => {
    const previous = coordinates[index]
    const lat1 = previous[1] * Math.PI / 180
    const lat2 = coordinate[1] * Math.PI / 180
    const deltaLat = lat2 - lat1
    const deltaLng = (coordinate[0] - previous[0]) * Math.PI / 180
    const haversine = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2

    return total + 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  }, 0)
}

function DevInteract() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerId, boolean>>({
    parks: true,
    routes: true,
    neighbourhoods: true,
  })
  const [selectedFeature, setSelectedFeature] = useState<PolygonFeature | LineFeature | null>(null)
  const [selectedLngLat, setSelectedLngLat] = useState<[number, number] | null>(null)
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('idle')
  const [measurementPoints, setMeasurementPoints] = useState<[number, number][]>([])

  const measurementPolygon = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(() => {
    if (measurementPoints.length < 3) return { type: 'FeatureCollection', features: [] }
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { id: 'measurement' },
        geometry: { type: 'Polygon', coordinates: [closeRing(measurementPoints)] },
      }],
    }
  }, [measurementPoints])

  const measurementLine = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => ({
    type: 'FeatureCollection',
    features: measurementPoints.length > 1
      ? [{
          type: 'Feature',
          properties: { id: 'measurement-line' },
          geometry: { type: 'LineString', coordinates: measurementMode === 'complete' ? closeRing(measurementPoints) : measurementPoints },
        }]
      : [],
  }), [measurementMode, measurementPoints])

  const measurementStats = useMemo(() => {
    if (measurementPoints.length < 2) return null
    const lineCoordinates = measurementMode === 'complete' ? closeRing(measurementPoints) : measurementPoints
    const perimeter = lineLengthKm(lineCoordinates)
    const areaValue = measurementPoints.length >= 3 ? area({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeRing(measurementPoints)] },
    }) : 0
    return { perimeter, area: areaValue }
  }, [measurementMode, measurementPoints])

  const selectPolygon = useCallback((id: string, collection: GeoJSON.FeatureCollection<GeoJSON.Polygon, InteractFeatureProperties>) => {
    const feature = collection.features.find((candidate) => candidate.properties.id === id) ?? null
    setSelectedFeature(feature)
    if (feature) {
      const bounds = bbox(feature) as [number, number, number, number]
      setSelectedLngLat([(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
    }
  }, [])

  const selectRoute = useCallback((id: string) => {
    const feature = routeFeatures.features.find((candidate) => candidate.properties.id === id) ?? null
    setSelectedFeature(feature)
    if (feature) {
      const coordinates = feature.geometry.coordinates
      setSelectedLngLat(coordinates[Math.floor(coordinates.length / 2)] as [number, number])
    }
  }, [])

  const toggleLayer = useCallback((layer: LayerId) => {
    setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }, [])

  const startMeasurement = useCallback(() => {
    setSelectedFeature(null)
    setSelectedLngLat(null)
    setMeasurementMode('drawing')
    setMeasurementPoints([])
  }, [])

  const clearMeasurement = useCallback(() => {
    setMeasurementMode('idle')
    setMeasurementPoints([])
  }, [])

  const finishMeasurement = useCallback(() => {
    setMeasurementMode((current) => (current === 'drawing' && measurementPoints.length >= 3 ? 'complete' : current))
  }, [measurementPoints.length])

  const sidebar = (
    <DevInteractSidebar
      className="h-full w-full border-0 shadow-none md:w-[320px] md:border-r md:shadow-xl"
      visibleLayers={visibleLayers}
      measurementMode={measurementMode}
      measurementStats={measurementStats}
      measurementPointCount={measurementPoints.length}
      onToggleLayer={toggleLayer}
      onStartMeasurement={startMeasurement}
      onFinishMeasurement={finishMeasurement}
      onClearMeasurement={clearMeasurement}
    />
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={320}
      mobileInitialSheetState="collapsed"
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">Interactive map controls</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {measurementMode === 'drawing' ? `${measurementPoints.length} measurement points` : 'Legend, actions, and popup cards'}
          </div>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map center={CENTER} zoom={11.1}>
          <MapControls position="top-right" />
          <MapClickCapture
            measurementMode={measurementMode}
            onMeasurementPoint={(point) => setMeasurementPoints((current) => [...current, point])}
          />
          <MapFillLayer
            data={neighbourhoodFeatures}
            fillColor="#8b5cf6"
            fillOpacity={0.12}
            lineColor="#6d28d9"
            lineWidth={1}
            idProperty="id"
            selectedId={selectedFeature?.properties.layer === 'neighbourhoods' ? selectedFeature.properties.id : null}
            visible={visibleLayers.neighbourhoods}
            onFeatureClick={(id) => selectPolygon(id, neighbourhoodFeatures)}
          />
          <MapFillLayer
            data={parkFeatures}
            fillColor="#22c55e"
            fillOpacity={0.32}
            lineColor="#15803d"
            lineWidth={1.3}
            idProperty="id"
            selectedId={selectedFeature?.properties.layer === 'parks' ? selectedFeature.properties.id : null}
            visible={visibleLayers.parks}
            onFeatureClick={(id) => selectPolygon(id, parkFeatures)}
          />
          <MapLineLayer
            data={routeFeatures}
            color="#0ea5e9"
            width={4}
            opacity={0.82}
            idProperty="id"
            selectedId={selectedFeature?.properties.layer === 'routes' ? selectedFeature.properties.id : null}
            visible={visibleLayers.routes}
            onFeatureClick={selectRoute}
          />
          <MapFillLayer
            data={measurementPolygon}
            fillColor="#f97316"
            fillOpacity={0.18}
            lineColor="#ea580c"
            lineWidth={2}
            visible={measurementPoints.length >= 3}
          />
          <MapLineLayer
            data={measurementLine}
            color="#ea580c"
            width={2.5}
            opacity={1}
            dashArray={measurementMode === 'drawing' ? [2, 1.3] : undefined}
            visible={measurementPoints.length > 1}
          />
          {measurementPoints.map((point, index) => (
            <MapMarker key={`${point[0]}:${point[1]}:${index}`} longitude={point[0]} latitude={point[1]}>
              <MarkerContent>
                <div className="flex size-5 items-center justify-center rounded-full border-2 border-white bg-orange-500 text-[10px] font-semibold text-white shadow-lg">
                  {index + 1}
                </div>
              </MarkerContent>
            </MapMarker>
          ))}
          {selectedFeature && selectedLngLat && (
            <MapPopup
              longitude={selectedLngLat[0]}
              latitude={selectedLngLat[1]}
              onClose={() => setSelectedFeature(null)}
              closeButton
              className="hidden md:block"
            >
              <FeaturePopup feature={selectedFeature} />
            </MapPopup>
          )}
        </Map>

        {selectedFeature && (
          <MobileFeatureInspector
            feature={selectedFeature}
            onClose={() => setSelectedFeature(null)}
          />
        )}

        {measurementMode !== 'idle' && (
          <div className="absolute bottom-[calc(var(--map-mobile-sheet-visible-height,72px)+0.75rem)] left-3 z-20 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur md:bottom-4 md:left-auto md:right-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Polygon measurement</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {measurementMode === 'drawing' ? 'Click the map to add points, then finish the polygon.' : 'Measurement is visible only in this session.'}
                </div>
              </div>
              <button type="button" className="rounded-md p-1.5 hover:bg-muted" onClick={clearMeasurement} aria-label="Clear measurement">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MeasurementValue label="Perimeter" value={measurementStats ? formatDistance(measurementStats.perimeter) : '-'} />
              <MeasurementValue label="Area" value={measurementStats && measurementStats.area > 0 ? formatArea(measurementStats.area) : '-'} />
            </div>
            {measurementMode === 'drawing' && (
              <Button size="sm" className="mt-3 w-full" disabled={measurementPoints.length < 3} onClick={finishMeasurement}>
                Finish polygon
              </Button>
            )}
          </div>
        )}
      </div>
    </MapSectionLayout>
  )
}

function DevInteractSidebar({
  className,
  visibleLayers,
  measurementMode,
  measurementStats,
  measurementPointCount,
  onToggleLayer,
  onStartMeasurement,
  onFinishMeasurement,
  onClearMeasurement,
}: {
  className?: string
  visibleLayers: Record<LayerId, boolean>
  measurementMode: MeasurementMode
  measurementStats: { perimeter: number; area: number } | null
  measurementPointCount: number
  onToggleLayer: (layer: LayerId) => void
  onStartMeasurement: () => void
  onFinishMeasurement: () => void
  onClearMeasurement: () => void
}) {
  return (
    <aside className={cn('flex flex-col bg-background/95', className)}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <Layers className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Interactive map shell</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Shared sidebar, bottom sheet, popup cards, layer controls, and map actions.
            </p>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <p className="text-xs leading-5 text-muted-foreground">
            Use this map to test the Felt-style presentation against the app's existing MapLibre stack.
          </p>
          <div className="mt-3 space-y-2">
            {actionRows.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={label === 'Measure areas' ? onStartMeasurement : undefined}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium shadow-sm transition-colors hover:bg-muted"
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Legend</h2>
            <button type="button" className="rounded-md p-1.5 hover:bg-muted" aria-label="More legend options">
              <MoreHorizontal className="size-4" />
            </button>
          </div>
          <div className="space-y-2">
            <LegendRow
              title="Neighbourhood areas"
              detail="2 polygons"
              color="#8b5cf6"
              active={visibleLayers.neighbourhoods}
              onClick={() => onToggleLayer('neighbourhoods')}
            />
            <LegendRow
              title="Parks"
              detail="2 polygons"
              color="#22c55e"
              active={visibleLayers.parks}
              onClick={() => onToggleLayer('parks')}
            />
            <LegendRow
              title="Transit routes"
              detail="2 lines"
              color="#0ea5e9"
              active={visibleLayers.routes}
              onClick={() => onToggleLayer('routes')}
              line
            />
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Measurement</h2>
            <button type="button" onClick={onClearMeasurement} className="rounded-md p-1.5 hover:bg-muted" aria-label="Delete measurement">
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">
              {measurementMode === 'idle'
                ? 'Start measuring to draw a private polygon on the map.'
                : `${measurementPointCount} point${measurementPointCount === 1 ? '' : 's'} placed`}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MeasurementValue label="Perimeter" value={measurementStats ? formatDistance(measurementStats.perimeter) : '-'} />
              <MeasurementValue label="Area" value={measurementStats && measurementStats.area > 0 ? formatArea(measurementStats.area) : '-'} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant={measurementMode === 'drawing' ? 'secondary' : 'default'} onClick={onStartMeasurement} className="flex-1">
                <Ruler className="mr-2 size-4" />
                Measure
              </Button>
              <Button size="sm" variant="outline" disabled={measurementPointCount < 3 || measurementMode !== 'drawing'} onClick={onFinishMeasurement} className="flex-1">
                Finish
              </Button>
            </div>
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Visible" value={Object.values(visibleLayers).filter(Boolean).length.toString()} />
            <StatCard label="Features" value="6" />
            <StatCard label="Cards" value="On" />
          </div>
        </section>
      </div>
    </aside>
  )
}

function MapClickCapture({
  measurementMode,
  onMeasurementPoint,
}: {
  measurementMode: MeasurementMode
  onMeasurementPoint: (point: [number, number]) => void
}) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || measurementMode !== 'drawing') return
    const previousCursor = map.getCanvas().style.cursor
    map.getCanvas().style.cursor = 'crosshair'
    const handleClick = (event: { lngLat: { lng: number; lat: number }; originalEvent: MouseEvent }) => {
      event.originalEvent.preventDefault()
      onMeasurementPoint([event.lngLat.lng, event.lngLat.lat])
    }
    map.on('click', handleClick as never)
    return () => {
      map.off('click', handleClick as never)
      map.getCanvas().style.cursor = previousCursor
    }
  }, [isLoaded, map, measurementMode, onMeasurementPoint])

  return null
}

function LegendRow({
  title,
  detail,
  color,
  active,
  line = false,
  onClick,
}: {
  title: string
  detail: string
  color: string
  active: boolean
  line?: boolean
  onClick: () => void
}) {
  return (
    <div className={cn('rounded-md border border-border bg-background p-3 shadow-sm', !active && 'opacity-55')}>
      <div className="flex items-center gap-3">
        <span
          className={cn('shrink-0 border', line ? 'h-1 w-8 rounded-full' : 'size-4 rounded')}
          style={{ backgroundColor: active ? color : 'transparent', borderColor: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
        </div>
        <button type="button" onClick={onClick} className="rounded-md p-1.5 hover:bg-muted" aria-label={`Toggle ${title}`}>
          {active ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
        <button type="button" className="rounded-md p-1.5 hover:bg-muted" aria-label={`View info for ${title}`}>
          <Info className="size-4" />
        </button>
      </div>
    </div>
  )
}

function MeasurementValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

function MobileFeatureInspector({
  feature,
  onClose,
}: {
  feature: PolygonFeature | LineFeature
  onClose: () => void
}) {
  return (
    <div
      id="feature-inspector"
      aria-label="Feature inspector"
      data-sheet-open-state="open"
      className="pointer-events-none fixed inset-0 z-50 md:hidden"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/0"
        onClick={onClose}
        aria-label="Close feature inspector backdrop"
      />
      <div className="absolute inset-x-0 bottom-0 pointer-events-auto rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)]">
        <div className="flex justify-center py-2" aria-hidden="true">
          <div className="flex">
            <span className="h-1 w-[18px] translate-x-0.5 rounded-full bg-muted-foreground/25" />
            <span className="h-1 w-[18px] -translate-x-0.5 rounded-full bg-muted-foreground/25" />
          </div>
        </div>
        <header className="border-b border-border px-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <button type="button" className="min-w-0 text-left" aria-label={`Selected feature ${feature.properties.name}`}>
              <span className="block truncate text-base font-semibold text-foreground">
                {feature.properties.name}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" className="rounded-md p-2 hover:bg-muted" aria-label="Feature actions">
                <MoreHorizontal className="size-4" />
              </button>
              <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close feature inspector">
                <X className="size-4" />
              </button>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{layerLabel(feature.properties.layer)}</p>
        </header>
        <div className="max-h-[42vh] overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <div aria-label="Vector feature popup contents" className="px-4 py-2">
            {feature.properties.properties.map((row) => (
              <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-3 border-b border-border/70 py-2.5 text-sm last:border-b-0">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="min-w-0 truncate font-medium text-foreground">{row.value || '-'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function layerLabel(layer: LayerId): string {
  if (layer === 'parks') return 'Parks'
  if (layer === 'routes') return 'Transit routes'
  return 'Neighbourhood areas'
}

function FeaturePopup({ feature }: { feature: PolygonFeature | LineFeature }) {
  return (
    <div className="w-64 text-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-md border bg-muted p-2">
          <MapPin className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-foreground">{feature.properties.name}</div>
          <div className="mt-0.5 text-xs capitalize text-muted-foreground">{feature.properties.layer}</div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{feature.properties.description}</p>
      {feature.properties.value && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <span className="font-medium text-foreground">{feature.properties.value}</span>
        </div>
      )}
      <div className="mt-3 divide-y divide-border rounded-md border border-border">
        {feature.properties.properties.slice(0, 3).map((row) => (
          <div key={row.label} className="grid grid-cols-2 gap-2 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-medium">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DevInteract

import { useCallback, useMemo, useState, useEffect } from 'react'
import { Layers, MapPin, RadioTower, RefreshCw, Flame, Wind, CloudFog } from 'lucide-react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Map as PgMap, MapControls, MapPopup, useMap } from '@/components/ui/map'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { cn } from '@/lib/utils'
import { useAirQualityData, type AirMonitor } from '@/maps/airquality'
import type maplibregl from 'maplibre-gl'

type AqMonitorGroup = 'agency' | 'lcm' | 'other'
type AqBasemap = 'light' | 'dark'
type WmsLayerKey = 'surfaceWinds' | 'modelledPm25' | 'activeFires' | 'firePerimeters' | 'fireDanger'

interface AqMapFeatureProperties {
  key: string
  id: string
  name: string
  network: string
  group: AqMonitorGroup
  groupLabel: string
  city: string
  province: string
  status: string
  pm25: number | null
  aqhi: number | null
  color: string
  online: boolean
}

interface WmsLayerDefinition {
  key: WmsLayerKey
  label: string
  icon: typeof Wind
  tiles: string[]
  opacity: number
  attribution: string
}

const CANADA_CENTER: [number, number] = [-96, 56]

const AQHI_STOPS = [
  { max: 10, color: '#3bb54a', label: 'Low' },
  { max: 20, color: '#f7d13d', label: 'Moderate' },
  { max: 30, color: '#f59e0b', label: 'High' },
  { max: Number.POSITIVE_INFINITY, color: '#c81e1e', label: 'Very high' },
]

const WMS_LAYERS: WmsLayerDefinition[] = [
  {
    key: 'surfaceWinds',
    label: 'Surface Winds',
    icon: Wind,
    tiles: [
      'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=HRDPS.CONTINENTAL_UU&STYLES=WindBarbs_Sfc&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.65,
    attribution: 'ECCC GeoMet',
  },
  {
    key: 'modelledPm25',
    label: 'Modelled PM2.5',
    icon: CloudFog,
    tiles: [
      'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=RAQDPS.SFC_PM2.5&STYLES=RAQDPS-SFC-PM_UGM3_BCAQHI&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.55,
    attribution: 'ECCC GeoMet',
  },
  {
    key: 'activeFires',
    label: 'Active Fires',
    icon: Flame,
    tiles: [
      'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=public:activefires_current&STYLES=public:cwfis_activefires&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.75,
    attribution: 'Natural Resources Canada CWFIS',
  },
  {
    key: 'firePerimeters',
    label: 'Fire Perimeters',
    icon: Flame,
    tiles: [
      'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=m3_polygons_current&STYLES=cwfis_m3_polygons&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.55,
    attribution: 'Natural Resources Canada CWFIS',
  },
  {
    key: 'fireDanger',
    label: 'Fire Danger',
    icon: Flame,
    tiles: [
      'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=public:fdr_current&STYLES=public:cffdrs_fdr&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.45,
    attribution: 'Natural Resources Canada CWFIS',
  },
]

const BASEMAP_STYLES: Record<AqBasemap, { light: string; dark: string }> = {
  light: MAP_STYLES,
  dark: {
    light: MAP_STYLES.dark,
    dark: MAP_STYLES.dark,
  },
}

function monitorKey(monitor: AirMonitor): string {
  return `${monitor.network}:${monitor.id}:${monitor.longitude}:${monitor.latitude}`
}

function getMonitorGroup(network: string): AqMonitorGroup {
  if (network === 'FEM' || network === 'BC ENV') return 'agency'
  if (network === 'PA' || network === 'EGG') return 'lcm'
  return 'other'
}

function getGroupLabel(group: AqMonitorGroup): string {
  if (group === 'agency') return 'Agency'
  if (group === 'lcm') return 'Low-cost'
  return 'Other networks'
}

function getAqhiColor(pm25: number | null | undefined): string {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return '#94a3b8'
  return AQHI_STOPS.find((stop) => pm25 <= stop.max)?.color ?? '#c81e1e'
}

function getAqhiLabel(pm25: number | null | undefined): string {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return 'No recent PM2.5'
  const stop = AQHI_STOPS.find((item) => pm25 <= item.max)
  return stop ? stop.label : 'Very high'
}

function formatPm25(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'No data' : `${value.toFixed(1)} ug/m3`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No timestamp'
  const date = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function AqMapSidebar({
  monitors,
  visibleGroups,
  onToggleGroup,
  visibleWmsLayers,
  onToggleWmsLayer,
  basemap,
  onBasemapChange,
  loading,
  error,
}: {
  monitors: AirMonitor[]
  visibleGroups: Set<AqMonitorGroup>
  onToggleGroup: (group: AqMonitorGroup) => void
  visibleWmsLayers: Set<WmsLayerKey>
  onToggleWmsLayer: (layer: WmsLayerKey) => void
  basemap: AqBasemap
  onBasemapChange: (basemap: AqBasemap) => void
  loading: boolean
  error: string | null
}) {
  const counts = useMemo(() => {
    return monitors.reduce<Record<AqMonitorGroup, number>>(
      (acc, monitor) => {
        acc[getMonitorGroup(monitor.network)] += 1
        return acc
      },
      { agency: 0, lcm: 0, other: 0 },
    )
  }, [monitors])

  const visibleCount = monitors.filter((monitor) => visibleGroups.has(getMonitorGroup(monitor.network))).length
  const recentCount = monitors.filter((monitor) => monitor.pm25Recent !== null && monitor.pm25Recent !== undefined).length
  const latestDate = monitors
    .map((monitor) => monitor.dateObserved)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)

  return (
    <aside className="flex h-full flex-col bg-background">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <RadioTower className="size-4 text-primary" />
          <h1 className="text-base font-semibold text-foreground">AQmap</h1>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Static reimplementation of the AQmap monitor and overlay view.
        </p>
      </div>

      <div className="space-y-5 overflow-y-auto p-4">
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Visible</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{visibleCount.toLocaleString()}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">PM2.5</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{recentCount.toLocaleString()}</div>
          </div>
        </section>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MapPin className="size-3.5" />
            Monitor Layers
          </div>
          <div className="space-y-2">
            {(['agency', 'lcm', 'other'] as AqMonitorGroup[]).map((group) => (
              <ToggleButton key={group} active={visibleGroups.has(group)} onClick={() => onToggleGroup(group)}>
                <span>{getGroupLabel(group)}</span>
                <span className="text-xs font-medium">{counts[group].toLocaleString()}</span>
              </ToggleButton>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Layers className="size-3.5" />
            Overlays
          </div>
          <div className="space-y-2">
            {WMS_LAYERS.map((layer) => {
              const Icon = layer.icon
              return (
                <ToggleButton
                  key={layer.key}
                  active={visibleWmsLayers.has(layer.key)}
                  onClick={() => onToggleWmsLayer(layer.key)}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="size-3.5" />
                    {layer.label}
                  </span>
                  <span className="text-xs font-medium">WMS</span>
                </ToggleButton>
              )
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Basemap</div>
          <div className="grid grid-cols-2 gap-2">
            {(['light', 'dark'] as AqBasemap[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onBasemapChange(option)}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm capitalize transition-colors',
                  basemap === option
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Static snapshot
          </div>
          <div className="mt-1">Latest monitor timestamp: {formatDate(latestDate)}</div>
          <div>Monitor data: <span className="font-medium text-foreground">/data/monitors/all.json</span></div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">PM2.5 Legend</div>
          <div className="space-y-1.5">
            {AQHI_STOPS.map((stop, index) => (
              <div key={stop.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: stop.color }} />
                <span>
                  {stop.label}
                  {' '}
                  {index === 0 ? '<= 10' : index === 1 ? '10.1-20' : index === 2 ? '20.1-30' : '> 30'}
                  {' ug/m3'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}

function WmsRasterLayer({ definition, visible }: { definition: WmsLayerDefinition; visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = `aqmap-wms-source-${definition.key}`
  const layerId = `aqmap-wms-layer-${definition.key}`

  useEffect(() => {
    if (!isLoaded || !map || !visible) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'raster',
        tiles: definition.tiles,
        tileSize: 256,
        attribution: definition.attribution,
      })
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': definition.opacity,
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [definition, isLoaded, layerId, map, sourceId, visible])

  return null
}

function AqMonitorLayer({
  monitors,
  visibleGroups,
  onMonitorClick,
}: {
  monitors: AirMonitor[]
  visibleGroups: Set<AqMonitorGroup>
  onMonitorClick: (monitor: AirMonitor) => void
}) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-monitor-source'
  const haloLayerId = 'aqmap-monitor-halo'
  const pointLayerId = 'aqmap-monitor-point'
  const labelLayerId = 'aqmap-monitor-label'

  const features = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, AqMapFeatureProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: monitors
        .filter((monitor) => visibleGroups.has(getMonitorGroup(monitor.network)))
        .map((monitor) => {
          const group = getMonitorGroup(monitor.network)
          const pm25 = monitor.pm25Recent ?? null
          return {
            type: 'Feature',
            properties: {
              key: monitorKey(monitor),
              id: monitor.id,
              name: monitor.name,
              network: monitor.network,
              group,
              groupLabel: getGroupLabel(group),
              city: monitor.city ?? '',
              province: monitor.province ?? '',
              status: monitor.status ?? '',
              pm25,
              aqhi: pm25,
              color: getAqhiColor(pm25),
              online: pm25 !== null,
            },
            geometry: {
              type: 'Point',
              coordinates: [monitor.longitude, monitor.latitude],
            },
          }
        }),
    }
  }, [monitors, visibleGroups])

  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: features,
        cluster: true,
        clusterRadius: 38,
        clusterMaxZoom: 8,
      })
    }

    if (!map.getLayer(haloLayerId)) {
      map.addLayer({
        id: haloLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['case', ['get', 'online'], 11, 8],
          'circle-color': '#ffffff',
          'circle-opacity': 0.92,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': ['case', ['get', 'online'], 2, 1.5],
        },
      })
    }

    if (!map.getLayer(pointLayerId)) {
      map.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': [
            'case',
            ['has', 'point_count'],
            '#334155',
            ['get', 'color'],
          ],
          'circle-radius': [
            'case',
            ['has', 'point_count'],
            ['step', ['get', 'point_count'], 16, 25, 20, 100, 25],
            ['case', ['get', 'online'], 7, 4.5],
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['case', ['has', 'point_count'], 2, 1],
          'circle-opacity': 0.95,
        },
      })
    }

    if (!map.getLayer(labelLayerId)) {
      map.addLayer({
        id: labelLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 11,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
        },
      })
    }

    const handleClick = async (event: maplibregl.MapMouseEvent) => {
      const rendered = map.queryRenderedFeatures(event.point, { layers: [pointLayerId] })
      const feature = rendered[0]
      if (!feature) return

      const properties = feature.properties as Record<string, unknown>
      if (typeof properties.cluster_id === 'number') {
        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(properties.cluster_id)
        map.easeTo({ center: event.lngLat, zoom: Math.min(zoom, 12), duration: 400 })
        return
      }

      const key = String(properties.key ?? '')
      const monitor = monitors.find((item) => monitorKey(item) === key)
      if (monitor) onMonitorClick(monitor)
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', pointLayerId, handleClick)
    map.on('mouseenter', pointLayerId, handleMouseEnter)
    map.on('mouseleave', pointLayerId, handleMouseLeave)

    return () => {
      try {
        map.getCanvas().style.cursor = ''
        map.off('click', pointLayerId, handleClick)
        map.off('mouseenter', pointLayerId, handleMouseEnter)
        map.off('mouseleave', pointLayerId, handleMouseLeave)
        if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId)
        if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
        if (map.getLayer(haloLayerId)) map.removeLayer(haloLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [features, haloLayerId, isLoaded, labelLayerId, map, monitors, onMonitorClick, pointLayerId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(features)
  }, [features, isLoaded, map])

  return null
}

function MonitorPopup({ monitor, onClose }: { monitor: AirMonitor; onClose: () => void }) {
  const pm25 = monitor.pm25Recent ?? null
  return (
    <MapPopup
      longitude={monitor.longitude}
      latitude={monitor.latitude}
      onClose={onClose}
      closeButton
      maxWidth="320px"
      className="w-[280px] p-0"
    >
      <div className="p-3">
        <div className="pr-5 text-sm font-semibold text-foreground">{monitor.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {[monitor.city, monitor.province].filter(Boolean).join(', ') || 'Location available'}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="size-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: getAqhiColor(pm25) }} />
          <span className="text-xs font-semibold text-foreground">{getAqhiLabel(pm25)}</span>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">
            {getGroupLabel(getMonitorGroup(monitor.network))}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Network</span>
          <span className="text-right font-medium text-foreground">{monitor.network}</span>
          <span className="text-muted-foreground">PM2.5</span>
          <span className="text-right font-medium text-foreground">{formatPm25(pm25)}</span>
          <span className="text-muted-foreground">Observed</span>
          <span className="text-right font-medium text-foreground">{formatDate(monitor.dateObserved)}</span>
          <span className="text-muted-foreground">Status</span>
          <span className="text-right font-medium text-foreground">{monitor.status || 'Unknown'}</span>
        </div>
      </div>
    </MapPopup>
  )
}

export default function AqMapSection() {
  const { monitors, loading, error } = useAirQualityData()
  const [showSidebar, setShowSidebar] = useState(true)
  const [visibleGroups, setVisibleGroups] = useState<Set<AqMonitorGroup>>(() => new Set(['agency', 'lcm']))
  const [visibleWmsLayers, setVisibleWmsLayers] = useState<Set<WmsLayerKey>>(() => new Set())
  const [basemap, setBasemap] = useState<AqBasemap>('light')
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)

  const toggleGroup = useCallback((group: AqMonitorGroup) => {
    setVisibleGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const toggleWmsLayer = useCallback((layer: WmsLayerKey) => {
    setVisibleWmsLayers((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const sidebar = (
    <AqMapSidebar
      monitors={monitors}
      visibleGroups={visibleGroups}
      onToggleGroup={toggleGroup}
      visibleWmsLayers={visibleWmsLayers}
      onToggleWmsLayer={toggleWmsLayer}
      basemap={basemap}
      onBasemapChange={setBasemap}
      loading={loading}
      error={error}
    />
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((value) => !value)}
      desktopSidebarWidth={360}
      mobileInitialSheetState="half"
      mobilePeek={<div className="text-sm font-semibold text-foreground">AQmap</div>}
    >
      <PgMap
        key={basemap}
        center={CANADA_CENTER}
        zoom={3.1}
        minZoom={2}
        maxZoom={16}
        styles={BASEMAP_STYLES[basemap]}
      >
        {WMS_LAYERS.map((layer) => (
          <WmsRasterLayer key={layer.key} definition={layer} visible={visibleWmsLayers.has(layer.key)} />
        ))}
        <AqMonitorLayer monitors={monitors} visibleGroups={visibleGroups} onMonitorClick={setSelectedMonitor} />
        {selectedMonitor && <MonitorPopup monitor={selectedMonitor} onClose={() => setSelectedMonitor(null)} />}
        <MapControls showLocate showFullscreen showCompass />
      </PgMap>
    </MapSectionLayout>
  )
}

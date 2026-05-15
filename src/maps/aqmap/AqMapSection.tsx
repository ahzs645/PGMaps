import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Layers, LineChart, MapPin, RadioTower, RefreshCw, RotateCcw } from 'lucide-react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Map as PgMap, MapControls, MapPopup, useMap } from '@/components/ui/map'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { cn } from '@/lib/utils'
import { useAirQualityData, type AirMonitor } from '@/maps/airquality'
import {
  getAqhiColor,
  getMonitorAqhiPm25,
} from '@/maps/airquality/lib/monitorPopup'
import {
  formatAqmapPm25,
  getAqmapHealthMessage,
  getAqmapMonitorType,
  getAqmapObservationRows,
  getAqmapObservedLabel,
  getGroupLabel,
  getMonitorGroup,
  monitorKey,
  type AqBasemap,
  type AqMonitorGroup,
} from './lib/monitorPresentation'
import { getAqmapMarkerIcon, getAqmapMarkerSortKey } from './lib/markerIcons'
import { fetchAqmapPlotSeries, makePlotPolyline, type AqPlotPoint } from './lib/plotData'
import { useAqmapSmokeLayers } from './lib/useAqmapSmokeLayers'
import { SMOKE_LAYERS, type SmokeLayerDefinition, type SmokeLayerKey } from './lib/smokeLayers'
import {
  CANADA_CENTER,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  isValidMapView,
  parseAqmapHash,
  serializeAqmapHash,
  serializeSet,
} from './lib/urlState'
import { WMS_LAYERS, type WmsLayerDefinition, type WmsLayerKey } from './lib/wmsLayers'
import type maplibregl from 'maplibre-gl'

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
  markerText: string
  iconId: string
  iconSize: number
  zIndex: number
  online: boolean
}

const URL_UPDATE_DELAY_MS = 350

const AQHI_STOPS = [
  { max: 30, color: '#3bb54a', label: 'Low', range: '0-29.9' },
  { max: 60, color: '#f7d13d', label: 'Moderate', range: '30-59.9' },
  { max: 100, color: '#f59e0b', label: 'High', range: '60-99.9' },
  { max: Number.POSITIVE_INFINITY, color: '#c81e1e', label: 'Very high' },
]

const OSM_LIGHT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
}

const BASEMAP_STYLES: Record<AqBasemap, { light: string | maplibregl.StyleSpecification; dark: string | maplibregl.StyleSpecification }> = {
  light: {
    light: OSM_LIGHT_STYLE,
    dark: OSM_LIGHT_STYLE,
  },
  dark: {
    light: MAP_STYLES.dark,
    dark: MAP_STYLES.dark,
  },
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

function basemapLabel(value: AqBasemap): string {
  return value === 'light' ? 'Light Theme' : 'Dark Theme'
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
  smokeLayers,
  visibleGroups,
  onToggleGroup,
  visibleWmsLayers,
  onToggleWmsLayer,
  visibleSmokeLayers,
  onToggleSmokeLayer,
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
  visibleSmokeLayers: Set<SmokeLayerKey>
  onToggleSmokeLayer: (layer: SmokeLayerKey) => void
  basemap: AqBasemap
  onBasemapChange: (basemap: AqBasemap) => void
  loading: boolean
  error: string | null
  smokeLayers: SmokeLayerDefinition[]
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
  const recentCount = monitors.filter((monitor) => getMonitorAqhiPm25(monitor) !== null).length
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

        {visibleWmsLayers.size > 0 && (
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">WMS Legends</div>
            <div className="space-y-3">
              {WMS_LAYERS.filter((layer) => visibleWmsLayers.has(layer.key)).map((layer) => (
                <div key={layer.key} className="rounded-md border border-border bg-secondary/30 p-3">
                  <div className="mb-2 text-xs font-medium text-foreground">{layer.label}</div>
                  {layer.legendUrl ? (
                    <img
                      src={layer.legendUrl}
                      alt={`${layer.label} legend`}
                      className="max-h-24 max-w-full rounded bg-white object-contain"
                    />
                  ) : (
                    <div className="h-8 rounded bg-gradient-to-r from-emerald-400 via-amber-300 to-red-600" />
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Layers className="size-3.5" />
            Overlays
          </div>
          <div className="space-y-2">
            {smokeLayers.map((layer) => (
              <ToggleButton
                key={layer.key}
                active={visibleSmokeLayers.has(layer.key)}
                onClick={() => onToggleSmokeLayer(layer.key)}
              >
                <span>{layer.label}</span>
                <span className="text-xs font-medium">Smoke</span>
              </ToggleButton>
            ))}
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
                  'rounded-md border px-3 py-2 text-sm transition-colors',
                  basemap === option
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {basemapLabel(option)}
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
          <div>Monitor data: <span className="font-medium text-foreground">aqmap-compatible endpoints</span></div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">PM2.5 Legend</div>
          <div className="space-y-1.5">
            {AQHI_STOPS.map((stop) => (
              <div key={stop.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: stop.color }} />
                <span>
                  {stop.label}
                  {' '}
                  {stop.range ?? '100+'}
                  {' ug m-3'}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monitor Icon Legend</div>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><span className="size-3 rotate-45 border border-foreground bg-emerald-400" /> Regulatory (FEM)</div>
            <div className="flex items-center gap-2"><span className="size-3 rounded-full border border-foreground bg-emerald-400" /> PurpleAir / LCM</div>
            <div className="flex items-center gap-2"><span className="size-3 border border-foreground bg-emerald-400" /> AQegg</div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full border border-foreground bg-slate-400" /> Missing recent data</div>
          </div>
        </section>
      </div>
    </aside>
  )
}

function WmsRasterLayer({
  definition,
  visible,
}: {
  definition: WmsLayerDefinition
  visible: boolean
}) {
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

function SmokePolygonLayer({ definition, visible }: { definition: SmokeLayerDefinition; visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = `aqmap-smoke-source-${definition.key}`
  const fillLayerId = `aqmap-smoke-fill-${definition.key}`
  const lineLayerId = `aqmap-smoke-line-${definition.key}`

  useEffect(() => {
    if (!isLoaded || !map || !visible) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: definition.data,
      })
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['coalesce', ['get', 'fill'], definition.fill],
          'fill-opacity': definition.opacity,
        },
      })
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['coalesce', ['get', 'fill'], definition.fill],
          'line-opacity': 0.65,
          'line-width': 1,
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [definition, fillLayerId, isLoaded, lineLayerId, map, sourceId, visible])

  return null
}

function loadMapImage(map: maplibregl.Map, id: string, src: string): Promise<void> {
  if (map.hasImage(id)) return Promise.resolve()

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      if (!map.hasImage(id)) map.addImage(id, image)
      resolve()
    }
    image.onerror = () => resolve()
    image.src = src
  })
}

function AqMonitorLayer({
  monitors,
  visibleGroups,
  onMonitorClick,
  onMonitorHover,
}: {
  monitors: AirMonitor[]
  visibleGroups: Set<AqMonitorGroup>
  onMonitorClick: (monitor: AirMonitor) => void
  onMonitorHover: (monitor: AirMonitor | null) => void
}) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-monitor-source'
  const offlineLayerId = 'aqmap-monitor-offline-icon'
  const onlineLayerId = 'aqmap-monitor-online-icon'

  const features = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, AqMapFeatureProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: monitors
        .filter((monitor) => visibleGroups.has(getMonitorGroup(monitor.network)))
        .map((monitor) => {
          const group = getMonitorGroup(monitor.network)
          const pm25 = getMonitorAqhiPm25(monitor)
          const icon = getAqmapMarkerIcon(monitor)
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
              markerText: '',
              iconId: icon.id,
              iconSize: icon.size,
              zIndex: getAqmapMarkerSortKey(monitor),
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
    const currentMap = map
    let cancelled = false
    const interactiveLayers = [onlineLayerId, offlineLayerId]

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: interactiveLayers })
      const feature = rendered[0]
      if (!feature) return

      const key = String(feature.properties?.key ?? '')
      const monitor = monitors.find((item) => monitorKey(item) === key)
      if (monitor) {
        onMonitorClick(monitor)
      }
    }

    const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
      currentMap.getCanvas().style.cursor = 'pointer'
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: interactiveLayers })
      const key = String(rendered[0]?.properties?.key ?? '')
      const monitor = monitors.find((item) => monitorKey(item) === key)
      onMonitorHover(monitor ?? null)
    }
    const handleMouseLeave = () => {
      currentMap.getCanvas().style.cursor = ''
      onMonitorHover(null)
    }

    async function addLayer() {
      const iconMap = new Map(monitors.map((monitor) => {
        const icon = getAqmapMarkerIcon(monitor)
        return [icon.id, icon]
      }))

      await Promise.all(Array.from(iconMap.values()).map((icon) => loadMapImage(currentMap, icon.id, icon.src)))
      if (cancelled) return

      if (!currentMap.getSource(sourceId)) {
        currentMap.addSource(sourceId, {
          type: 'geojson',
          data: features,
        })
      }

      const addSymbolLayer = (layerId: string, online: boolean) => {
        if (currentMap.getLayer(layerId)) return
        currentMap.addLayer({
          id: layerId,
          type: 'symbol',
          source: sourceId,
          filter: ['==', ['get', 'online'], online],
          layout: {
            'icon-image': ['get', 'iconId'],
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'symbol-sort-key': ['get', 'zIndex'],
          },
        })
      }

      addSymbolLayer(offlineLayerId, false)
      addSymbolLayer(onlineLayerId, true)

      interactiveLayers.forEach((layerId) => {
        currentMap.on('click', layerId, handleClick)
        currentMap.on('mousemove', layerId, handleMouseMove)
        currentMap.on('mouseleave', layerId, handleMouseLeave)
      })
    }

    void addLayer()

    return () => {
      cancelled = true
      try {
        currentMap.getCanvas().style.cursor = ''
        interactiveLayers.forEach((layerId) => {
          currentMap.off('click', layerId, handleClick)
          currentMap.off('mousemove', layerId, handleMouseMove)
          currentMap.off('mouseleave', layerId, handleMouseLeave)
        })
        if (currentMap.getLayer(onlineLayerId)) currentMap.removeLayer(onlineLayerId)
        if (currentMap.getLayer(offlineLayerId)) currentMap.removeLayer(offlineLayerId)
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [features, isLoaded, map, monitors, offlineLayerId, onMonitorClick, onMonitorHover, onlineLayerId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(features)
  }, [features, isLoaded, map])

  return null
}

function MonitorPopup({ monitor, onClose }: { monitor: AirMonitor; onClose: () => void }) {
  const { map } = useMap()
  const contentRef = useRef<HTMLDivElement>(null)
  const [showPlot, setShowPlot] = useState(false)
  const [plotPoints, setPlotPoints] = useState<AqPlotPoint[]>([])
  const [plotSource, setPlotSource] = useState<'endpoint' | 'fallback'>('fallback')
  const pm25 = getMonitorAqhiPm25(monitor)
  const health = getAqmapHealthMessage(monitor)
  const observationRows = getAqmapObservationRows(monitor)

  useEffect(() => {
    if (!map) return
    const frame = window.requestAnimationFrame(() => {
      const popupHeight = contentRef.current?.offsetHeight ?? 0
      if (popupHeight > 0) {
        map.panBy([0, -(popupHeight / 2 + 12)], { duration: 300 })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [map, monitor])

  useEffect(() => {
    if (!showPlot) return
    const controller = new AbortController()
    fetchAqmapPlotSeries(monitor, controller.signal)
      .then((result) => {
        setPlotPoints(result.points)
        setPlotSource(result.source)
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') {
          setPlotPoints([])
          setPlotSource('fallback')
        }
      })
    return () => controller.abort()
  }, [monitor, showPlot])

  return (
    <MapPopup
      longitude={monitor.longitude}
      latitude={monitor.latitude}
      onClose={onClose}
      closeButton
      closeOnClick={false}
      offset={[0, -5]}
      maxWidth="540px"
      className="aqmap-popup w-[520px] max-w-[calc(100vw-32px)] p-0"
    >
      <div ref={contentRef} className="p-2 pr-6 text-[12px] leading-[1.35] text-black">
        <div className="popup_title" style={{ verticalAlign: 'middle' }}>
          <span title="Name assigned to this monitor.">
            <big><strong>{monitor.name}</strong></big>
          </span>
        </div>
        <div className="text-[12px] italic">{getAqmapMonitorType(monitor)} monitor</div>
        <div className="text-[12px]">
          Observed PM<sub>2.5</sub> as of: {getAqmapObservedLabel(monitor).replace(/^Observed PM2\.5 as of: /, '')}
        </div>
        <table className="mt-1">
          <tbody>
            {observationRows.map((row) => (
              <tr key={row.key}>
                <td className="popup_value pr-3" title={row.title}>
                  <b>{row.label}:</b>
                </td>
                <td className="popup_value">
                  {formatAqmapPm25(row.value)} <span dangerouslySetInnerHTML={{ __html: '&mu;g m<sup>-3</sup>' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="mt-1">
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'middle' }}>
                <span title="Health messaging based on the AQHI+ system.">
                  <b>{health.heading}</b>
                </span>
                <br />
                {health.lines.map((line) => (
                  <span key={line}>{line}<br /></span>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setShowPlot((value) => !value)}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
          >
            <LineChart className="size-3.5" />
            Plot Timeseries
          </button>
        </div>
        {showPlot && (
          <div className="mt-3 rounded-md border border-border bg-secondary/20 p-2">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Hourly PM2.5</span>
              <span>{plotSource === 'endpoint' ? '/data/plotting' : 'Fallback data'}</span>
            </div>
            <svg viewBox="0 0 280 110" className="h-[110px] w-full rounded bg-background">
              <line x1="24" y1="90" x2="260" y2="90" stroke="currentColor" strokeOpacity="0.25" />
              <line x1="24" y1="20" x2="24" y2="90" stroke="currentColor" strokeOpacity="0.25" />
              <polyline
                points={makePlotPolyline(plotPoints)}
                fill="none"
                stroke={getAqhiColor(pm25)}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text x="30" y="32" className="fill-current text-[10px]">
                Now {formatAqmapPm25(pm25)} ug m-3
              </text>
            </svg>
          </div>
        )}
      </div>
    </MapPopup>
  )
}

function MonitorTooltip({ monitor }: { monitor: AirMonitor }) {
  const rows = getAqmapObservationRows(monitor)

  return (
    <MapPopup
      longitude={monitor.longitude}
      latitude={monitor.latitude}
      closeOnClick={false}
      closeButton={false}
      focusAfterOpen={false}
      offset={18}
      maxWidth="280px"
      className="aqmap-tooltip pointer-events-none w-[260px] px-2 py-1.5"
    >
      <div className="text-xs">
        <div className="tooltip_title truncate font-semibold text-foreground">{monitor.name}</div>
        <div className="mt-0.5 text-[11px] italic text-muted-foreground">{getAqmapMonitorType(monitor)} monitor</div>
        <div className="mt-1 text-[11px] text-muted-foreground">Observed PM<sub>2.5</sub> as of: {getAqmapObservedLabel(monitor).replace(/^Observed PM2\.5 as of: /, '')}</div>
        <table className="mt-1 w-full text-[11px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="pr-3 text-muted-foreground">{row.label}:</td>
                <td className="popup_value text-right font-medium text-foreground">
                  {formatAqmapPm25(row.value)} <span dangerouslySetInnerHTML={{ __html: '&mu;g m<sup>-3</sup>' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MapPopup>
  )
}

function FloatingLayerControl({
  basemap,
  onBasemapChange,
  visibleGroups,
  onToggleGroup,
  visibleWmsLayers,
  onToggleWmsLayer,
  visibleSmokeLayers,
  onToggleSmokeLayer,
  smokeLayers,
}: {
  basemap: AqBasemap
  onBasemapChange: (basemap: AqBasemap) => void
  visibleGroups: Set<AqMonitorGroup>
  onToggleGroup: (group: AqMonitorGroup) => void
  visibleWmsLayers: Set<WmsLayerKey>
  onToggleWmsLayer: (layer: WmsLayerKey) => void
  visibleSmokeLayers: Set<SmokeLayerKey>
  onToggleSmokeLayer: (layer: SmokeLayerKey) => void
  smokeLayers: SmokeLayerDefinition[]
}) {
  return (
    <div
      className="absolute z-10 w-56 rounded border border-border bg-background/95 p-3 text-xs shadow-md backdrop-blur"
      style={{ top: 12, right: 12 }}
    >
      <div className="font-semibold text-foreground">Basemaps</div>
      <div className="mt-1 space-y-1">
        {(['light', 'dark'] as AqBasemap[]).map((option) => (
          <label key={option} className="flex items-center gap-2 text-muted-foreground">
            <input type="radio" checked={basemap === option} onChange={() => onBasemapChange(option)} />
            <span>{basemapLabel(option)}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 font-semibold text-foreground">Layers</div>
      <div className="mt-1 max-h-72 space-y-1 overflow-y-auto">
        {(['agency', 'lcm', 'other'] as AqMonitorGroup[]).map((group) => (
          <label key={group} className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={visibleGroups.has(group)} onChange={() => onToggleGroup(group)} />
            <span>{getGroupLabel(group)}</span>
          </label>
        ))}
        {smokeLayers.map((layer) => (
          <label key={layer.key} className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={visibleSmokeLayers.has(layer.key)} onChange={() => onToggleSmokeLayer(layer.key)} />
            <span>{layer.label}</span>
          </label>
        ))}
        {WMS_LAYERS.map((layer) => (
          <label key={layer.key} className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={visibleWmsLayers.has(layer.key)} onChange={() => onToggleWmsLayer(layer.key)} />
            <span>{layer.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function FloatingLegends({
  visibleWmsLayers,
  visibleSmokeLayers,
  smokeLayers,
}: {
  visibleWmsLayers: Set<WmsLayerKey>
  visibleSmokeLayers: Set<SmokeLayerKey>
  smokeLayers: SmokeLayerDefinition[]
}) {
  const visibleWms = WMS_LAYERS.filter((layer) => visibleWmsLayers.has(layer.key) && layer.legendUrl)
  const visibleSmoke = smokeLayers.filter((layer) => visibleSmokeLayers.has(layer.key))
  if (visibleWms.length === 0 && visibleSmoke.length === 0) return null

  return (
    <div
      className="absolute z-10 max-w-[260px] space-y-2"
      style={{ bottom: 40, left: 12 }}
    >
      {visibleWms.map((layer) => (
        <div key={layer.key} className="rounded border border-border bg-background/95 p-2 text-xs shadow-md">
          <div className="mb-1 font-medium text-foreground">{layer.label}</div>
          <img src={layer.legendUrl} alt={`${layer.label} legend`} className="max-h-24 max-w-full rounded bg-white object-contain" />
        </div>
      ))}
      {visibleSmoke.map((layer) => (
        <div key={layer.key} className="rounded border border-border bg-background/95 p-2 text-xs shadow-md">
          <div className="mb-1 font-medium text-foreground">{layer.label}</div>
          {layer.legend.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-muted-foreground">
              <span className="size-3 rounded-sm border border-border" style={{ backgroundColor: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function MapUtilityControls({ onReset }: { onReset: () => void }) {
  const { map } = useMap()

  const locate = () => {
    if (!navigator.geolocation || !map) return
    navigator.geolocation.getCurrentPosition((position) => {
      map.easeTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: 15,
        duration: 650,
      })
    })
  }

  return (
    <div
      className="absolute z-10 flex flex-col overflow-hidden rounded border border-border bg-background shadow-md"
      style={{ top: 12, left: 12 }}
    >
      <button type="button" title="Zoom to your location" onClick={locate} className="p-2 hover:bg-secondary">
        <Crosshair className="size-4" />
      </button>
      <button type="button" title="Reset map view" onClick={onReset} className="border-t border-border p-2 hover:bg-secondary">
        <RotateCcw className="size-4" />
      </button>
    </div>
  )
}

function MapTimestamp({ latestDate }: { latestDate: string | null | undefined }) {
  return (
    <div
      className="absolute z-10 rounded border border-border bg-background/95 px-2 py-1 text-[11px] text-foreground shadow-md"
      style={{ bottom: 12, left: 12 }}
    >
      Last updated: {formatDate(latestDate)}
    </div>
  )
}

function ScaleBar() {
  const { map } = useMap()
  const [scale, setScale] = useState({ width: 80, label: '500 km' })

  useEffect(() => {
    if (!map) return

    const updateScale = () => {
      const center = map.getCenter()
      const metersPerPixel = (
        Math.cos(center.lat * Math.PI / 180)
        * 2
        * Math.PI
        * 6378137
      ) / (512 * (2 ** map.getZoom()))
      const maxWidth = 100
      const rawDistanceMeters = metersPerPixel * maxWidth
      const niceDistances = [
        1, 2, 5, 10, 20, 50, 100, 200, 500,
        1000, 2000, 5000, 10000, 20000, 50000,
        100000, 200000, 500000, 1000000,
      ]
      const distance = [...niceDistances].reverse().find((value) => value <= rawDistanceMeters) ?? 1
      const width = Math.max(36, Math.round(distance / metersPerPixel))
      setScale({
        width,
        label: distance >= 1000 ? `${distance / 1000} km` : `${distance} m`,
      })
    }

    updateScale()
    map.on('move', updateScale)
    return () => {
      map.off('move', updateScale)
    }
  }, [map])

  return (
    <div
      className="absolute z-10 rounded border border-border bg-background/95 px-2 py-1 text-[11px] text-foreground shadow-md"
      style={{ bottom: 12, right: 220 }}
    >
      <div className="h-1 border-x border-b border-foreground" style={{ width: scale.width }} />
      <div className="mt-0.5 text-center">{scale.label}</div>
    </div>
  )
}

export default function AqMapSection() {
  const { monitors, loading, error } = useAirQualityData({ aqmapCompatible: true })
  const { layers: smokeLayers, error: smokeError } = useAqmapSmokeLayers()
  const initialUrlState = useMemo(() => parseAqmapHash(window.location.hash, new URLSearchParams(window.location.search)), [])
  const [showSidebar, setShowSidebar] = useState(false)
  const [visibleGroups, setVisibleGroups] = useState<Set<AqMonitorGroup>>(() => initialUrlState.visibleGroups)
  const [visibleWmsLayers, setVisibleWmsLayers] = useState<Set<WmsLayerKey>>(() => initialUrlState.visibleWmsLayers)
  const [visibleSmokeLayers, setVisibleSmokeLayers] = useState<Set<SmokeLayerKey>>(() => initialUrlState.visibleSmokeLayers)
  const [basemap, setBasemap] = useState<AqBasemap>(() => initialUrlState.basemap)
  const [mapView, setMapView] = useState(() => initialUrlState.mapView)
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [hoveredMonitor, setHoveredMonitor] = useState<AirMonitor | null>(null)
  const latestDate = monitors
    .map((monitor) => monitor.dateObserved)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search)
      const groups = serializeSet(visibleGroups)
      const wms = serializeSet(visibleWmsLayers)
      const smoke = serializeSet(visibleSmokeLayers)

      if (basemap === 'light') next.delete('basemap')
      else next.set('basemap', basemap)

      if (groups === 'agency,lcm') next.delete('groups')
      else next.set('groups', groups)

      if (wms) next.set('wms', wms)
      else next.delete('wms')

      if (smoke) next.set('smoke', smoke)
      else next.delete('smoke')

      next.delete('time')

      if (isValidMapView(mapView)) {
        next.set('lng', mapView.center[0].toFixed(4))
        next.set('lat', mapView.center[1].toFixed(4))
        next.set('z', mapView.zoom.toFixed(2))
      }

      const nextSearch = next.toString()
      const nextHash = serializeAqmapHash({
        basemap,
        visibleGroups,
        visibleWmsLayers,
        visibleSmokeLayers,
        selectedTimestamp: '',
        mapView,
      })
      if (nextSearch !== window.location.search.slice(1) || nextHash !== window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}?${nextSearch}${nextHash}`)
      }
    }, URL_UPDATE_DELAY_MS)

    return () => window.clearTimeout(timeout)
  }, [basemap, mapView, visibleGroups, visibleSmokeLayers, visibleWmsLayers])

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

  const toggleSmokeLayer = useCallback((layer: SmokeLayerKey) => {
    setVisibleSmokeLayers((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const resetView = useCallback(() => {
    setMapView({ center: CANADA_CENTER, zoom: DEFAULT_ZOOM })
  }, [])

  const sidebar = (
      <AqMapSidebar
        monitors={monitors}
        smokeLayers={smokeLayers}
        visibleGroups={visibleGroups}
        onToggleGroup={toggleGroup}
      visibleWmsLayers={visibleWmsLayers}
      onToggleWmsLayer={toggleWmsLayer}
      visibleSmokeLayers={visibleSmokeLayers}
      onToggleSmokeLayer={toggleSmokeLayer}
        basemap={basemap}
        onBasemapChange={setBasemap}
        loading={loading}
        error={error || smokeError}
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
        viewport={{
          center: mapView.center,
          zoom: mapView.zoom,
        }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        styles={BASEMAP_STYLES[basemap]}
        onViewportChange={(viewport) => {
          if (!isValidMapView(viewport)) return
          setMapView({
            center: viewport.center,
            zoom: viewport.zoom,
          })
        }}
      >
        {smokeLayers.map((layer) => (
          <SmokePolygonLayer key={layer.key} definition={layer} visible={visibleSmokeLayers.has(layer.key)} />
        ))}
        {WMS_LAYERS.map((layer) => (
          <WmsRasterLayer
            key={layer.key}
            definition={layer}
            visible={visibleWmsLayers.has(layer.key)}
          />
        ))}
        <AqMonitorLayer
          monitors={monitors}
          visibleGroups={visibleGroups}
          onMonitorClick={setSelectedMonitor}
          onMonitorHover={setHoveredMonitor}
        />
        {hoveredMonitor && selectedMonitor !== hoveredMonitor && <MonitorTooltip monitor={hoveredMonitor} />}
        {selectedMonitor && <MonitorPopup monitor={selectedMonitor} onClose={() => setSelectedMonitor(null)} />}
        <FloatingLayerControl
          basemap={basemap}
          onBasemapChange={setBasemap}
          visibleGroups={visibleGroups}
          onToggleGroup={toggleGroup}
          visibleWmsLayers={visibleWmsLayers}
          onToggleWmsLayer={toggleWmsLayer}
          visibleSmokeLayers={visibleSmokeLayers}
          onToggleSmokeLayer={toggleSmokeLayer}
          smokeLayers={smokeLayers}
        />
        <FloatingLegends
          visibleWmsLayers={visibleWmsLayers}
          visibleSmokeLayers={visibleSmokeLayers}
          smokeLayers={smokeLayers}
        />
        <MapUtilityControls onReset={resetView} />
        <MapTimestamp latestDate={latestDate} />
        <ScaleBar />
        <MapControls showFullscreen />
      </PgMap>
    </MapSectionLayout>
  )
}

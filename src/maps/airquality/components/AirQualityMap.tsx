import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  useMap,
  type MapRef
} from '@/components/ui/map'
import bbox from '@turf/bbox'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { getNetworkColor } from '../constants'
import { calculateCorrectedPm25, formatNumber, formatPm25 } from '../lib/corrections'
import { AirQualityHeatmapLayer } from './AirQualityHeatmapLayer'
import type {
  AirMonitor,
  AirQualityBasemap,
  AirQualityBoundaryColorMetric,
  AirQualityCorrectionModel
} from '../types'
import type maplibregl from 'maplibre-gl'

interface AirQualityMapProps {
  monitors: AirMonitor[]
  selectedMonitor: AirMonitor | null
  selectedRegionFeature?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  browseBoundaryFeatures?: GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    { code: string; name: string; colorValue?: number | null; hasColorValue?: boolean }
  > | null
  browseBoundariesVisible?: boolean
  selectedBrowseBoundaryCode?: string | null
  browseBoundaryColorMetric: AirQualityBoundaryColorMetric
  maxBrowseBoundaryColorValue?: number
  showHeatmap: boolean
  showPoints: boolean
  basemap: AirQualityBasemap
  correctionModel: AirQualityCorrectionModel
  onBoundsChange?: (bounds: AirQualityMapBounds) => void
  onMonitorClick: (monitor: AirMonitor) => void
  onBrowseBoundaryClick?: (feature: { code: string; name: string }) => void
  onMonitorClear?: () => void
}

export interface AirQualityMapBounds {
  west: number
  east: number
  south: number
  north: number
}

type MonitorFeatureProperties = {
  id: string
  network: string
  name: string
  city: string
  province: string
}

const ZOOM = 12

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '')
  const full = cleaned.length === 3
    ? cleaned.split('').map((char) => char + char).join('')
    : cleaned

  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function uniqueParameters(parameters: string[]): string[] {
  return Array.from(new Set(parameters.map((parameter) => parameter.trim()).filter(Boolean)))
}

function monitorLocationKey(monitor: AirMonitor): string {
  return `${monitor.longitude.toFixed(6)}:${monitor.latitude.toFixed(6)}`
}

function monitorEntryKey(monitor: AirMonitor): string {
  return `${monitor.network}:${monitor.id}:${monitor.longitude.toFixed(6)}:${monitor.latitude.toFixed(6)}`
}

function isSameLocation(a: AirMonitor, b: AirMonitor): boolean {
  return monitorLocationKey(a) === monitorLocationKey(b)
}

const AIR_QUALITY_MAP_STYLES: Record<AirQualityBasemap, { light: string; dark: string }> = {
  light: MAP_STYLES,
  topographic: {
    light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    dark: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
  },
  dark: {
    light: MAP_STYLES.dark,
    dark: MAP_STYLES.dark
  }
}

function SelectedMonitorDetails({
  monitor,
  correctionModel
}: {
  monitor: AirMonitor
  correctionModel: AirQualityCorrectionModel
}) {
  const parameters = uniqueParameters(monitor.parameters)
  const correction = calculateCorrectedPm25(monitor, correctionModel)

  return (
    <div>
      <div className="text-sm font-semibold text-foreground">{monitor.name}</div>
      <div className="text-xs text-muted-foreground">
        {[monitor.city, monitor.province].filter(Boolean).join(', ') || 'Location available'}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: getNetworkColor(monitor.network) }}
        />
        <span className="font-medium text-foreground">{monitor.network}</span>
        {monitor.status && (
          <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase text-secondary-foreground">
            {monitor.status}
          </span>
        )}
      </div>
      {parameters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parameters.map((parameter) => (
            <span
              key={`${monitorEntryKey(monitor)}:${parameter}`}
              className="rounded border bg-secondary/40 px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
            >
              {parameter}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-md border border-border bg-background/80 p-2 text-xs">
        <div className="mb-1 font-semibold text-foreground">{correction.label}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Raw PM2.5</span>
          <span className="text-right font-medium text-foreground">{formatPm25(correction.rawPm25)}</span>
          <span className="text-muted-foreground">Corrected</span>
          <span className="text-right font-medium text-foreground">{formatPm25(correction.correctedPm25)}</span>
          <span className="text-muted-foreground">RH</span>
          <span className="text-right font-medium text-foreground">{formatNumber(correction.humidity, '%')}</span>
          <span className="text-muted-foreground">Uncertainty</span>
          <span className="text-right font-medium text-foreground">
            {correction.uncertainty === null ? 'No data' : `+/- ${correction.uncertainty.toFixed(1)} ug/m3`}
          </span>
        </div>
      </div>
    </div>
  )
}

function BoundaryBrowseLayer({
  features,
  visible,
  selectedCode,
  colorMetric,
  maxColorValue,
  onBoundaryClick
}: {
  features: GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    { code: string; name: string; colorValue?: number | null; hasColorValue?: boolean }
  > | null | undefined
  visible: boolean
  selectedCode: string | null | undefined
  colorMetric: AirQualityBoundaryColorMetric
  maxColorValue: number
  onBoundaryClick?: (feature: { code: string; name: string }) => void
}) {
  const { map, isLoaded } = useMap()
  const sourceId = 'airq-browse-boundary-source'
  const fillLayerId = 'airq-browse-boundary-fill'
  const lineLayerId = 'airq-browse-boundary-line'

  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      } as never)
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#0ea5e9',
          'fill-opacity': 0.1
        },
        layout: {
          visibility: 'none'
        }
      } as never)
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#0284c7',
          'line-width': 1.2,
          'line-opacity': 0.9
        },
        layout: {
          visibility: 'none'
        }
      } as never)
    }

    const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
      const firstFeature = event.features?.[0]
      const properties = (firstFeature?.properties ?? {}) as Record<string, unknown>
      const code = String(properties.code ?? '').trim()
      if (!code) return
      const name = String(properties.name ?? code)
      onBoundaryClick?.({ code, name })
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', fillLayerId, handleClick)
    map.on('mouseenter', fillLayerId, handleMouseEnter)
    map.on('mouseleave', fillLayerId, handleMouseLeave)

    return () => {
      try {
        if (!map || !map.getStyle()) return
        map.getCanvas().style.cursor = ''
        map.off('click', fillLayerId, handleClick)
        map.off('mouseenter', fillLayerId, handleMouseEnter)
        map.off('mouseleave', fillLayerId, handleMouseLeave)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map already destroyed during unmount.
      }
    }
  }, [fillLayerId, isLoaded, lineLayerId, map, onBoundaryClick, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(features ?? {
      type: 'FeatureCollection',
      features: []
    })

    const hasFeatures = Boolean(features && features.features.length > 0)
    const layerVisibility = visible && hasFeatures ? 'visible' : 'none'

    const maxStop = maxColorValue > 0 ? maxColorValue : 1
    const lowStop = maxStop * 0.25
    const midStop = maxStop * 0.6
    const colorStops = colorMetric === 'correctedPm25' || colorMetric === 'rawPm25'
      ? ['#dcfce7', '#fde047', '#fb923c', '#b91c1c']
      : ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#0369a1']

    if (map.getLayer(fillLayerId)) {
      map.setLayoutProperty(fillLayerId, 'visibility', layerVisibility)
      map.setPaintProperty(
        fillLayerId,
        'fill-color',
        [
          'interpolate',
          ['linear'],
          ['to-number', ['get', 'colorValue'], 0],
          0,
          colorStops[0],
          lowStop,
          colorStops[1],
          midStop,
          colorStops[2],
          maxStop,
          colorStops[3]
        ] as never
      )
      map.setPaintProperty(
        fillLayerId,
        'fill-opacity',
        [
          'case',
          ['==', ['get', 'hasColorValue'], true],
          0.26,
          0.1
        ] as never
      )
    }

    if (map.getLayer(lineLayerId)) {
      map.setLayoutProperty(lineLayerId, 'visibility', layerVisibility)
      map.setPaintProperty(
        lineLayerId,
        'line-color',
        [
          'case',
          ['==', ['to-string', ['get', 'code']], selectedCode ?? '__none__'],
          '#ea580c',
          '#0284c7'
        ] as never
      )
      map.setPaintProperty(
        lineLayerId,
        'line-width',
        [
          'case',
          ['==', ['to-string', ['get', 'code']], selectedCode ?? '__none__'],
          2.2,
          1.1
        ] as never
      )
    }
  }, [colorMetric, features, fillLayerId, isLoaded, lineLayerId, map, maxColorValue, selectedCode, sourceId, visible])

  return null
}

export function AirQualityMap({
  monitors,
  selectedMonitor,
  selectedRegionFeature,
  browseBoundaryFeatures,
  browseBoundariesVisible = false,
  selectedBrowseBoundaryCode,
  browseBoundaryColorMetric,
  maxBrowseBoundaryColorValue = 0,
  showHeatmap,
  showPoints,
  basemap,
  correctionModel,
  onBoundsChange,
  onMonitorClick,
  onBrowseBoundaryClick,
  onMonitorClear
}: AirQualityMapProps) {
  const mapRef = useRef<MapRef>(null)

  const monitorById = useMemo(() => {
    const map = new globalThis.Map<string, AirMonitor>()
    monitors.forEach((monitor) => map.set(monitor.id, monitor))
    return map
  }, [monitors])

  const collectionsByNetwork = useMemo(() => {
    const grouped = new globalThis.Map<string, GeoJSON.FeatureCollection<GeoJSON.Point, MonitorFeatureProperties>>()

    monitors.forEach((monitor) => {
      const network = monitor.network || 'Unknown'
      if (!grouped.has(network)) {
        grouped.set(network, {
          type: 'FeatureCollection',
          features: []
        })
      }

      grouped.get(network)?.features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [monitor.longitude, monitor.latitude]
        },
        properties: {
          id: monitor.id,
          network,
          name: monitor.name,
          city: monitor.city || '',
          province: monitor.province || ''
        }
      })
    })

    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [monitors])

  const selectedMonitorsAtLocation = useMemo(() => {
    if (!selectedMonitor) return []

    const matches = monitors.filter((monitor) => isSameLocation(monitor, selectedMonitor))
    const uniqueByEntry = new Map<string, AirMonitor>()
    matches.forEach((monitor) => uniqueByEntry.set(monitorEntryKey(monitor), monitor))

    const uniqueMatches = Array.from(uniqueByEntry.values()).sort((a, b) => {
      return a.name.localeCompare(b.name) || a.network.localeCompare(b.network)
    })

    const selectedKey = monitorEntryKey(selectedMonitor)
    const selectedMatch = uniqueMatches.find((monitor) => monitorEntryKey(monitor) === selectedKey)
    if (!selectedMatch) return uniqueMatches

    return [
      selectedMatch,
      ...uniqueMatches.filter((monitor) => monitorEntryKey(monitor) !== selectedKey)
    ]
  }, [monitors, selectedMonitor])

  const mapStyles = useMemo(() => AIR_QUALITY_MAP_STYLES[basemap], [basemap])

  useEffect(() => {
    if (!selectedMonitor || !mapRef.current) return
    mapRef.current.flyTo({
      center: [selectedMonitor.longitude, selectedMonitor.latitude],
      duration: 800
    })
  }, [selectedMonitor])

  useEffect(() => {
    if (!selectedRegionFeature || !mapRef.current) return
    const [minLon, minLat, maxLon, maxLat] = bbox(selectedRegionFeature)
    mapRef.current.flyTo({
      center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
      zoom: mapRef.current.getZoom(),
      duration: 800
    })
  }, [selectedRegionFeature])

  useEffect(() => {
    if (!onBoundsChange) return

    let mapInstance: MapRef | null = null
    let animationFrame: number | null = null

    const publishBounds = () => {
      if (!mapInstance) return
      const bounds = mapInstance.getBounds()
      onBoundsChange({
        west: bounds.getWest(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
        north: bounds.getNorth()
      })
    }

    const bind = () => {
      mapInstance = mapRef.current
      if (!mapInstance) {
        animationFrame = requestAnimationFrame(bind)
        return
      }

      mapInstance.on('load', publishBounds)
      mapInstance.on('moveend', publishBounds)
      mapInstance.on('zoomend', publishBounds)
      mapInstance.on('resize', publishBounds)

      if (mapInstance.loaded()) {
        publishBounds()
      }
    }

    bind()

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame)
      }
      if (!mapInstance) return
      mapInstance.off('load', publishBounds)
      mapInstance.off('moveend', publishBounds)
      mapInstance.off('zoomend', publishBounds)
      mapInstance.off('resize', publishBounds)
    }
  }, [onBoundsChange])

  return (
    <div className="h-full w-full">
      <PgMap
        key={basemap}
        ref={mapRef}
        center={PG_CENTER}
        zoom={ZOOM}
        styles={mapStyles}
      >
        <MapControls position="top-right" showZoom showCompass />
        <BoundaryBrowseLayer
          features={browseBoundaryFeatures}
          visible={browseBoundariesVisible}
          selectedCode={selectedBrowseBoundaryCode}
          colorMetric={browseBoundaryColorMetric}
          maxColorValue={maxBrowseBoundaryColorValue}
          onBoundaryClick={onBrowseBoundaryClick}
        />
        <AirQualityHeatmapLayer monitors={monitors} visible={showHeatmap} />

        {showPoints && collectionsByNetwork.map(([network, collection]) => {
          const color = getNetworkColor(network)
          const clusterColors: [string, string, string] = [
            hexToRgba(color, 0.65),
            hexToRgba(color, 0.8),
            color
          ]

          return (
            <MapClusterLayer<MonitorFeatureProperties>
              key={network}
              data={collection}
              pointColor={color}
              clusterColors={clusterColors}
              clusterThresholds={[40, 150]}
              onPointClick={(feature) => {
                const id = feature.properties?.id
                if (!id) return
                const selected = monitorById.get(id)
                if (selected) onMonitorClick(selected)
              }}
            />
          )
        })}

        {selectedMonitor && (
          <>
            <MapMarker
              longitude={selectedMonitor.longitude}
              latitude={selectedMonitor.latitude}
            >
              <MarkerContent>
                <div
                  className="h-5 w-5 rounded-full border-2 border-white shadow-lg ring-2 ring-sky-500 ring-offset-2"
                  style={{ backgroundColor: getNetworkColor(selectedMonitor.network) }}
                />
              </MarkerContent>
            </MapMarker>

            <MapPopup
              key={monitorEntryKey(selectedMonitor)}
              longitude={selectedMonitor.longitude}
              latitude={selectedMonitor.latitude}
              closeButton
              onClose={onMonitorClear}
              className={selectedMonitorsAtLocation.length > 1 ? 'max-w-sm' : 'max-w-xs'}
            >
              <div className="pr-6">
                {selectedMonitorsAtLocation.length > 1 && (
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {selectedMonitorsAtLocation.length} sensors at this location
                  </div>
                )}

                <div className="space-y-2">
                  {selectedMonitorsAtLocation.map((monitor, index) => (
                    <div
                      key={monitorEntryKey(monitor)}
                      className={index === 0 ? '' : 'border-t border-border pt-2'}
                    >
                      <SelectedMonitorDetails monitor={monitor} correctionModel={correctionModel} />
                    </div>
                  ))}
                </div>
              </div>
            </MapPopup>
          </>
        )}
      </PgMap>
    </div>
  )
}

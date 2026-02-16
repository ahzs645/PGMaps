import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  type MapRef
} from '@/components/ui/map'
import { getNetworkColor } from '../constants'
import { AirQualityHeatmapLayer } from './AirQualityHeatmapLayer'
import type { AirMonitor } from '../types'

interface AirQualityMapProps {
  monitors: AirMonitor[]
  selectedMonitor: AirMonitor | null
  showHeatmap: boolean
  onBoundsChange?: (bounds: AirQualityMapBounds) => void
  onMonitorClick: (monitor: AirMonitor) => void
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

const CENTER: [number, number] = [-122.764593, 53.909784]
const ZOOM = 12

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'

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

function SelectedMonitorDetails({ monitor }: { monitor: AirMonitor }) {
  const parameters = uniqueParameters(monitor.parameters)

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
    </div>
  )
}

export function AirQualityMap({
  monitors,
  selectedMonitor,
  showHeatmap,
  onBoundsChange,
  onMonitorClick,
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

  useEffect(() => {
    if (!selectedMonitor || !mapRef.current) return
    mapRef.current.flyTo({
      center: [selectedMonitor.longitude, selectedMonitor.latitude],
      duration: 800
    })
  }, [selectedMonitor])

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
        ref={mapRef}
        center={CENTER}
        zoom={ZOOM}
        styles={{
          light: LIGHT_STYLE,
          dark: DARK_STYLE
        }}
      >
        <MapControls position="top-right" showZoom showCompass />
        <AirQualityHeatmapLayer monitors={monitors} visible={showHeatmap} />

        {!showHeatmap && collectionsByNetwork.map(([network, collection]) => {
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
                      <SelectedMonitorDetails monitor={monitor} />
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

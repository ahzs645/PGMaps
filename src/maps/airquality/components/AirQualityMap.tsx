import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  MapMarker,
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
  onMonitorClick: (monitor: AirMonitor) => void
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

export function AirQualityMap({ monitors, selectedMonitor, showHeatmap, onMonitorClick }: AirQualityMapProps) {
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

  useEffect(() => {
    if (!selectedMonitor || !mapRef.current) return
    mapRef.current.flyTo({
      center: [selectedMonitor.longitude, selectedMonitor.latitude],
      zoom: 9,
      duration: 800
    })
  }, [selectedMonitor])

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
        )}
      </PgMap>
    </div>
  )
}

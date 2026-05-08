import { useMemo } from 'react'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import type { AirMonitor } from '../types'

interface AirQualityHeatmapLayerProps {
  monitors: AirMonitor[]
  visible: boolean
}

export function AirQualityHeatmapLayer({ monitors, visible }: AirQualityHeatmapLayerProps) {
  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: monitors.map((monitor) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [monitor.longitude, monitor.latitude] },
        properties: { weight: 1 },
      })),
    }),
    [monitors],
  )

  return (
    <MapHeatmapLayer
      data={data}
      visible={visible}
      intensityStops={[
        [0, 0.4],
        [9, 1.2],
      ]}
      radiusStops={[
        [0, 8],
        [9, 26],
      ]}
      opacity={[
        [0, 0.65],
        [9, 0.9],
      ]}
      colorRamp="air"
    />
  )
}

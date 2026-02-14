import { useEffect, useId, useMemo } from 'react'
import { useMap } from '@/components/ui/map'
import type { AirMonitor } from '../types'

interface AirQualityHeatmapLayerProps {
  monitors: AirMonitor[]
  visible: boolean
}

export function AirQualityHeatmapLayer({ monitors, visible }: AirQualityHeatmapLayerProps) {
  const { map, isLoaded } = useMap()
  const id = useId().replace(/:/g, '')
  const sourceId = `airq-heatmap-source-${id}`
  const layerId = `airq-heatmap-layer-${id}`

  const data = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: monitors.map((monitor) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [monitor.longitude, monitor.latitude]
        },
        properties: {
          weight: 1
        }
      }))
    }
  }, [monitors])

  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data
      } as never)
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'heatmap',
        source: sourceId,
        layout: {
          visibility: visible ? 'visible' : 'none'
        },
        paint: {
          'heatmap-weight': ['coalesce', ['get', 'weight'], 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 9, 1.2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 9, 26],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.65, 9, 0.9],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(15, 23, 42, 0)',
            0.2,
            '#0ea5e9',
            0.45,
            '#22c55e',
            0.65,
            '#f59e0b',
            1,
            '#ef4444'
          ]
        }
      } as never)
    }

    return () => {
      try {
        if (!map || !map.getStyle()) return
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId)
        }
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId)
        }
      } catch {
        // Map already destroyed during unmount
      }
    }
  }, [data, isLoaded, layerId, map, sourceId, visible])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as { setData?: (v: unknown) => void } | undefined
    source?.setData?.(data)
  }, [data, isLoaded, map, sourceId])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }, [isLoaded, layerId, map, visible])

  return null
}

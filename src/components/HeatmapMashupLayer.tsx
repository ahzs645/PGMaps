import { useEffect, useId, useMemo } from 'react'
import { useMap } from '@/components/ui/map'

export interface HeatmapDataset {
  id: string
  label: string
  points: Array<{ lng: number; lat: number; weight?: number }>
  color: [string, string, string, string] // 4 stops: low, mid-low, mid-high, high
}

interface HeatmapMashupLayerProps {
  datasets: HeatmapDataset[]
  visible: boolean
}

export function HeatmapMashupLayer({ datasets, visible }: HeatmapMashupLayerProps) {
  const { map, isLoaded } = useMap()
  const baseId = useId().replace(/:/g, '')

  const layers = useMemo(
    () =>
      datasets.map((ds) => ({
        sourceId: `mashup-src-${baseId}-${ds.id}`,
        layerId: `mashup-lyr-${baseId}-${ds.id}`,
        data: {
          type: 'FeatureCollection' as const,
          features: ds.points.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: { weight: p.weight ?? 1 },
          })),
        },
        color: ds.color,
      })),
    [datasets, baseId],
  )

  // Create / cleanup sources + layers
  useEffect(() => {
    if (!isLoaded || !map) return

    layers.forEach((layer) => {
      if (!map.getSource(layer.sourceId)) {
        map.addSource(layer.sourceId, { type: 'geojson', data: layer.data } as never)
      }

      if (!map.getLayer(layer.layerId)) {
        map.addLayer({
          id: layer.layerId,
          type: 'heatmap',
          source: layer.sourceId,
          layout: { visibility: visible ? 'visible' : 'none' },
          paint: {
            'heatmap-weight': ['coalesce', ['get', 'weight'], 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 9, 1],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 6, 9, 22],
            'heatmap-opacity': 0.6,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(0,0,0,0)',
              0.25, layer.color[0],
              0.5, layer.color[1],
              0.75, layer.color[2],
              1, layer.color[3],
            ],
          },
        } as never)
      }
    })

    return () => {
      try {
        if (!map || !map.getStyle()) return
        layers.forEach((layer) => {
          if (map.getLayer(layer.layerId)) map.removeLayer(layer.layerId)
          if (map.getSource(layer.sourceId)) map.removeSource(layer.sourceId)
        })
      } catch {
        // Map destroyed during unmount
      }
    }
  }, [isLoaded, map, layers, visible])

  // Update data
  useEffect(() => {
    if (!isLoaded || !map) return
    layers.forEach((layer) => {
      const source = map.getSource(layer.sourceId) as { setData?: (v: unknown) => void } | undefined
      source?.setData?.(layer.data)
    })
  }, [isLoaded, map, layers])

  // Toggle visibility
  useEffect(() => {
    if (!isLoaded || !map) return
    layers.forEach((layer) => {
      if (map.getLayer(layer.layerId)) {
        map.setLayoutProperty(layer.layerId, 'visibility', visible ? 'visible' : 'none')
      }
    })
  }, [isLoaded, map, layers, visible])

  return null
}

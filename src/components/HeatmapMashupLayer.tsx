import { useMemo } from 'react'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { buildHeatmapRamp } from '@/components/ui/map-styles'

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
  const layers = useMemo(
    () =>
      datasets.map((ds) => ({
        id: ds.id,
        ramp: buildHeatmapRamp(ds.color),
        data: {
          type: 'FeatureCollection' as const,
          features: ds.points.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: { weight: p.weight ?? 1 },
          })),
        },
      })),
    [datasets],
  )

  return (
    <>
      {layers.map((layer) => (
        <MapHeatmapLayer
          key={layer.id}
          data={layer.data}
          visible={visible}
          intensityStops={[
            [0, 0.3],
            [9, 1],
          ]}
          radiusStops={[
            [0, 6],
            [9, 22],
          ]}
          opacity={0.6}
          colorRamp={layer.ramp}
        />
      ))}
    </>
  )
}

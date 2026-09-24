import { useEffect, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { DEFAULT_WARS_HEATMAP, WARS_HEATMAP_PALETTES, type WarsHeatmapSettings } from './WarsHeatmapControls'
import { estimateHeatmapPeak, warsHeatmapRadius } from './warsHeatmapDensity'

export function WarsHeatmapLayer({ data, settings }: {
  data: GeoJSON.FeatureCollection<GeoJSON.Point>
  settings: WarsHeatmapSettings
}) {
  const { map, isLoaded } = useMap()
  const [relativeIntensity, setRelativeIntensity] = useState(1)

  useEffect(() => {
    if (!map || !isLoaded || settings.scale !== 'relative') return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const { clientWidth: width, clientHeight: height } = map.getCanvas()
        const radius = warsHeatmapRadius(settings.radius, map.getZoom())
        const points = data.features.map((feature) => {
          const [longitude, latitude] = feature.geometry.coordinates
          const { x, y } = map.project([longitude, latitude])
          const quantity = Number(feature.properties?.weight)
          return { x, y, weight: settings.weighting === 'animals' && Number.isFinite(quantity) ? Math.max(1, quantity) * 0.25 : 0.25 }
        })
        const peak = estimateHeatmapPeak(points, width, height, radius)
        // Keep individual kernels above MapLibre's shader cutoff. The default
        // intensity places the estimated peak at the top of the color ramp.
        const intensity = peak > 0 ? settings.intensity / DEFAULT_WARS_HEATMAP.intensity / peak : 1
        setRelativeIntensity(Math.max(0.003, intensity))
      })
    }
    schedule()
    map.on('moveend', schedule)
    map.on('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      map.off('moveend', schedule)
      map.off('resize', schedule)
    }
  }, [data, isLoaded, map, settings.scale, settings.radius, settings.weighting, settings.intensity])

  return (
    <MapHeatmapLayer
      data={data}
      weight={settings.weighting === 'records' ? 0.25 : ['*', ['get', 'weight'], 0.25]}
      intensityStops={settings.scale === 'relative'
        ? [[0, relativeIntensity], [24, relativeIntensity]]
        : [[8, settings.intensity / 100 * 0.56], [11, settings.intensity / 100], [14, settings.intensity / 100 * 1.52]]}
      radiusStops={[[8, settings.radius * 0.53], [11, settings.radius], [14, settings.radius * 1.53]]}
      opacity={settings.opacity / 100}
      colorRamp={WARS_HEATMAP_PALETTES[settings.palette].stops}
    />
  )
}

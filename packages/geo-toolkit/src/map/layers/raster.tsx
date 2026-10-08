import { useEffect, useId } from 'react'
import { useMap } from '../map-context.js'

export type MapRasterLayerProps = {
  /** Array of tile URL templates — use {z}/{x}/{y} placeholders */
  tiles: string[]
  /** Tile size in pixels (default: 256) */
  tileSize?: number
  /** Layer opacity from 0 to 1 (default: 1) */
  opacity?: number
  /** Whether the layer is visible (default: true) */
  visible?: boolean
  /** Minimum zoom level for tile requests (default: 0) */
  minZoom?: number
  /** Maximum zoom level for tile requests (default: 22) */
  maxZoom?: number
  /** Use nearest for classified rasters so class boundaries stay sharp when tiles are enlarged. */
  resampling?: 'linear' | 'nearest'
  /** Attribution text shown in map corner */
  attribution?: string
  /** Insert this layer before another layer ID (default: added on top) */
  beforeId?: string
}

export function MapRasterLayer({
  tiles,
  tileSize = 256,
  opacity = 1,
  visible = true,
  minZoom = 0,
  maxZoom = 22,
  resampling = 'linear',
  attribution,
  beforeId,
}: MapRasterLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `raster-src-${uid}`
  const layerId = `raster-layer-${uid}`

  // Mount: create source + layer
  useEffect(() => {
    if (!isLoaded || !map) return

    map.addSource(sourceId, {
      type: 'raster',
      tiles,
      tileSize,
      minzoom: minZoom,
      maxzoom: maxZoom,
      ...(attribution && { attribution }),
    })

    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': opacity,
          'raster-resampling': resampling,
        },
      },
      beforeId,
    )

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map])

  // Update opacity
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setPaintProperty(layerId, 'raster-opacity', opacity)
  }, [opacity, isLoaded, map, layerId])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setPaintProperty(layerId, 'raster-resampling', resampling)
  }, [resampling, isLoaded, map, layerId])

  // Update visibility
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }, [visible, isLoaded, map, layerId])

  return null
}

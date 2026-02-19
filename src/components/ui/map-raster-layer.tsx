import { useEffect, useId } from 'react'
import { useMap } from '@/components/ui/map'

/**
 * Renders a raster tile layer on the map.
 *
 * Use this for satellite imagery, weather overlays, elevation hillshade
 * or any XYZ / TMS / WMS tile source.  The layer is inserted *below*
 * the first symbol layer (labels) so that vector labels stay readable.
 *
 * @example
 * ```tsx
 * <RasterTileLayer
 *   tiles={['https://tile.openstreetmap.org/{z}/{x}/{y}.png']}
 *   attribution="&copy; OpenStreetMap contributors"
 *   opacity={0.6}
 * />
 * ```
 */

export interface RasterTileLayerProps {
  /** Array of tile URL templates with `{x}`, `{y}`, `{z}` placeholders. */
  tiles: string[]
  /** Tile size in pixels (default 256). */
  tileSize?: number
  /** Min source zoom level (default 0). */
  minZoom?: number
  /** Max source zoom level (default 19). */
  maxZoom?: number
  /** Layer opacity 0–1 (default 1). */
  opacity?: number
  /** Whether the layer is visible (default true). */
  visible?: boolean
  /** Attribution string for the tile source. */
  attribution?: string
  /** Optional insertion point: place this layer before the given layer id. */
  beforeLayerId?: string
}

function findFirstSymbolLayer(map: { getStyle: () => { layers?: Array<{ id: string; type: string }> } | null }): string | undefined {
  const layers = map.getStyle()?.layers
  if (!layers) return undefined
  const symbol = layers.find((l) => l.type === 'symbol')
  return symbol?.id
}

export function RasterTileLayer({
  tiles,
  tileSize = 256,
  minZoom = 0,
  maxZoom = 19,
  opacity = 1,
  visible = true,
  attribution,
  beforeLayerId,
}: RasterTileLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `raster-source-${uid}`
  const layerId = `raster-layer-${uid}`

  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'raster',
        tiles,
        tileSize,
        minzoom: minZoom,
        maxzoom: maxZoom,
        ...(attribution ? { attribution } : {}),
      } as never)
    }

    if (!map.getLayer(layerId)) {
      const before = beforeLayerId ?? findFirstSymbolLayer(map as never)
      map.addLayer(
        {
          id: layerId,
          type: 'raster',
          source: sourceId,
          layout: {
            visibility: visible ? 'visible' : 'none',
          },
          paint: {
            'raster-opacity': opacity,
          },
        } as never,
        before,
      )
    }

    return () => {
      try {
        if (!map || !map.getStyle()) return
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map already destroyed during unmount.
      }
    }
  }, [attribution, beforeLayerId, isLoaded, layerId, map, maxZoom, minZoom, opacity, sourceId, tileSize, tiles, visible])

  // Respond to visibility changes.
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }, [isLoaded, layerId, map, visible])

  // Respond to opacity changes.
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setPaintProperty(layerId, 'raster-opacity', opacity)
  }, [isLoaded, layerId, map, opacity])

  return null
}

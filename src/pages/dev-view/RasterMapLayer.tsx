import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useMap } from '@/components/ui/map'
import type { RasterRecord } from './catalogue'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

export function RasterMapLayer({
  item,
  opacity,
  onError,
}: {
  item: RasterRecord | null
  opacity: number
  onError: (text: string) => void
}) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded || !item) return
    const ids = item.assets.map((_, i) => `shared-raster-${i}`)
    const install = () => {
      if (!map.isStyleLoaded()) return
      ids.forEach((id, i) => {
        const asset = item.assets[i]
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
        map.addSource(id, {
          type: 'raster',
          tiles: asset.url ? [`pmtiles://${asset.url}/{z}/{x}/{y}`] : asset.tiles,
          bounds: asset.bounds,
          tileSize: 256,
          minzoom: asset.minZoom,
          maxzoom: asset.maxZoom,
        })
        map.addLayer({
          id,
          type: 'raster',
          source: id,
          paint: { 'raster-opacity': opacity / 100, 'raster-fade-duration': 150 },
        })
      })
      map.fitBounds(
        [
          [item.bounds[0], item.bounds[1]],
          [item.bounds[2], item.bounds[3]],
        ],
        { padding: 45, maxZoom: 18, duration: 0 },
      )
    }
    const error = (event: { sourceId?: string }) => {
      if (event.sourceId && ids.includes(event.sourceId))
        onError(
          'Some map tiles could not load. Retry the map or check that its URL permits cross-origin range requests.',
        )
    }
    map.on('style.load', install)
    map.on('error', error)
    install()
    return () => {
      map.off('style.load', install)
      map.off('error', error)
      ids.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
      })
    }
    // Opacity has its own paint-only effect so moving the slider never refits the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, item, onError])
  useEffect(() => {
    if (!map || !isLoaded || !item) return
    item.assets.forEach((_, i) => {
      const id = `shared-raster-${i}`
      if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', opacity / 100)
    })
  }, [map, isLoaded, item, opacity])
  return null
}

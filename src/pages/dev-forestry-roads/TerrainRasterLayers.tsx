import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'
import { roadProjection } from './terrain'
import type { TerrainBackgroundLayer } from './terrainPreparation'

/** Imported canopy/ortho images use their source CRS and stay separate from engineering ground. */
export function TerrainRasterLayers({ layers }: { layers: TerrainBackgroundLayer[] }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const ids: string[] = []
    for (const layer of layers) {
      const id = `road-background-${layer.id}`,
        sourceId = `${id}-source`
      const canvas = document.createElement('canvas')
      canvas.width = layer.width
      canvas.height = layer.height
      const context = canvas.getContext('2d')
      if (!context) continue
      context.putImageData(new ImageData(Uint8ClampedArray.from(layer.rgba), layer.width, layer.height), 0, 0)
      const projection = roadProjection(layer.epsg),
        west = layer.origin[0] - layer.pixelSize[0] / 2,
        north = layer.origin[1] - layer.pixelSize[1] / 2
      const east = west + layer.width * layer.pixelSize[0],
        south = north + layer.height * layer.pixelSize[1]
      const coordinates = (
        [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ] as Array<[number, number]>
      ).map((xy) => projection.inverse(xy) as [number, number]) as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ]
      map.addSource(sourceId, { type: 'image', url: canvas.toDataURL('image/png'), coordinates })
      const before = map
        .getStyle()
        .layers?.find((l) => l.type !== 'background' && l.type !== 'raster' && l.type !== 'hillshade')?.id
      map.addLayer(
        {
          id,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': layer.opacity },
          layout: { visibility: layer.visible ? 'visible' : 'none' },
        },
        before,
      )
      ids.push(id)
    }
    return () => {
      for (const id of ids) {
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(`${id}-source`)) map.removeSource(`${id}-source`)
      }
    }
  }, [map, isLoaded, layers])
  return null
}

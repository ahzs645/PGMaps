import { useMemo } from 'react'
import { useMap } from '@/components/ui/map'
import { MapImageLayer, type MapQuadCoordinates } from '@/components/ui/map-layers'
import { roadProjection } from './terrain'
import type { TerrainBackgroundLayer } from './terrainPreparation'

function TerrainRasterLayer({ layer, beforeId }: { layer: TerrainBackgroundLayer; beforeId?: string }) {
  const image = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = layer.width
    canvas.height = layer.height
    const context = canvas.getContext('2d')
    if (!context) return null
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
    ).map((xy) => projection.inverse(xy) as [number, number]) as MapQuadCoordinates
    return { url: canvas.toDataURL('image/png'), coordinates }
  }, [layer])
  if (!image) return null
  return (
    <MapImageLayer
      id={`road-background-${layer.id}`}
      url={image.url}
      coordinates={image.coordinates}
      opacity={layer.opacity}
      visible={layer.visible}
      beforeId={beforeId}
    />
  )
}

/** Imported canopy/ortho images use their source CRS and stay separate from engineering ground. */
export function TerrainRasterLayers({ layers }: { layers: TerrainBackgroundLayer[] }) {
  const { map, isLoaded } = useMap()
  if (!map || !isLoaded) return null
  // Backgrounds stay under the engineering layers.
  const beforeId = map
    .getStyle()
    .layers?.find((l) => l.type !== 'background' && l.type !== 'raster' && l.type !== 'hillshade')?.id
  return layers.map((layer) => <TerrainRasterLayer key={layer.id} layer={layer} beforeId={beforeId} />)
}

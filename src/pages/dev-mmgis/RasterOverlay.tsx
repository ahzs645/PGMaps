import { useMemo } from 'react'
import { interpolateViridis } from 'd3'
import { MapCanvasLayer, boundsToQuad } from '@/components/ui/map-layers'
import type { LocalRaster } from '../dev-forestry/types'
import { lngLatToMercator, mercatorToLngLat } from '../dev-forestry/terrain'
import { rasterBounds, rasterCellSampler } from './raster'

export function RasterOverlay({ raster }: { raster: LocalRaster }) {
  const image = useMemo(() => {
    const [west, south, east, north] = rasterBounds(raster),
      nw = lngLatToMercator(west, north),
      se = lngLatToMercator(east, south)
    const values = raster.values.filter((v): v is number => v !== null)
    let min = Infinity,
      max = -Infinity
    for (const v of values) {
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    const sample = rasterCellSampler(raster)
    for (let row = 0; row < 256; row++)
      for (let column = 0; column < 256; column++) {
        const p = mercatorToLngLat(
          nw[0] + ((column + 0.5) / 256) * (se[0] - nw[0]),
          nw[1] + ((row + 0.5) / 256) * (se[1] - nw[1]),
        )
        const value = sample(p)?.value
        if (value == null) continue
        ctx.fillStyle = interpolateViridis(max === min ? 0.5 : (value - min) / (max - min))
        ctx.fillRect(column, row, 1, 1)
      }
    return { canvas, bounds: { west, south, east, north }, min, max }
  }, [raster])
  return <MapCanvasLayer canvas={image.canvas} coordinates={boundsToQuad(image.bounds)} opacity={0.7} layerOrder={10} />
}

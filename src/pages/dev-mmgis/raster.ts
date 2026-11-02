import type { LocalRaster } from '../dev-forestry/types'
import { rasterProjection } from '../dev-forestry/localRaster'
import type { Coordinate } from './model'

/** Report an original cell, without interpolation or deriving values from a color. */
export function rasterCellSampler(raster: LocalRaster) {
  const projection = rasterProjection(raster.epsg)
  return (point: Coordinate): { value: number | null; row: number; column: number } | null => {
    const [x, y] = projection.forward(point)
    const column = Math.round((x - raster.origin[0]) / raster.pixelSize[0]),
      row = Math.round((y - raster.origin[1]) / raster.pixelSize[1])
    if (column < 0 || row < 0 || column >= raster.width || row >= raster.height) return null
    return { value: raster.values[row * raster.width + column], row, column }
  }
}
export function sampleRaster(raster: LocalRaster, point: Coordinate) {
  return rasterCellSampler(raster)(point)
}
export function rasterBounds(r: LocalRaster): [number, number, number, number] {
  const projection = rasterProjection(r.epsg)
  const corners = [
    [0, 0],
    [r.width - 1, 0],
    [r.width - 1, r.height - 1],
    [0, r.height - 1],
  ].map(([x, y]) => projection.inverse([r.origin[0] + x * r.pixelSize[0], r.origin[1] + y * r.pixelSize[1]]))
  return [
    Math.min(...corners.map((p) => p[0])),
    Math.min(...corners.map((p) => p[1])),
    Math.max(...corners.map((p) => p[0])),
    Math.max(...corners.map((p) => p[1])),
  ]
}

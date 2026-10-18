import type { AnalysisSummary } from './types'

export const LIDAR_SOURCE_POINTS = 84_608_005

export function checkAnalysisSummary(data: unknown): asserts data is AnalysisSummary {
  const value = data as Partial<AnalysisSummary> | null
  if (
    !value ||
    value.source_points !== LIDAR_SOURCE_POINTS ||
    !value.rasters ||
    !value.sample_grid ||
    !Array.isArray(value.limitations) ||
    !Array.isArray(value.highlights) ||
    !Array.isArray(value.downloads)
  )
    throw new Error('The analysis manifest is incomplete or belongs to a different tile.')
  const grid = value.sample_grid
  if (
    !Number.isInteger(grid.width) ||
    grid.width <= 0 ||
    !Number.isInteger(grid.height) ||
    grid.height <= 0 ||
    grid.bounds_mercator.length !== 4 ||
    !grid.bounds_mercator.every(Number.isFinite)
  )
    throw new Error('Invalid height-sampling grid.')
}

/** Index the resampled Web Mercator display grid; source GeoTIFF values are separate. */
export function heightAtLocation(
  samples: Float32Array,
  grid: AnalysisSummary['sample_grid'],
  longitude: number,
  latitude: number,
): number | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) >= 85.051129) return null
  const mx = (longitude * 20037508.342789244) / 180
  const my = Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) * 6378137
  const col = Math.floor(
    ((mx - grid.bounds_mercator[0]) / (grid.bounds_mercator[2] - grid.bounds_mercator[0])) * grid.width,
  )
  const row = Math.floor(
    ((grid.bounds_mercator[3] - my) / (grid.bounds_mercator[3] - grid.bounds_mercator[1])) * grid.height,
  )
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return null
  const value = samples[row * grid.width + col]
  return Number.isFinite(value) ? value : null
}

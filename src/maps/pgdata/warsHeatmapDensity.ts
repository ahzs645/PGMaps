export interface HeatmapScreenPoint { x: number; y: number; weight: number }

/** Matches the Gaussian in MapLibre's heatmap shader (sigma = radius / 3).
 * Estimate the visible peak on a bounded screen grid; bilinear deposition avoids
 * abrupt jumps as points cross grid cells. Include offscreen kernels, but never
 * let a peak outside the viewport set the visible color scale.
 */
export function estimateHeatmapPeak(
  points: readonly HeatmapScreenPoint[], width: number, height: number, radius: number,
): number {
  if (width <= 0 || height <= 0 || radius <= 0 || points.length === 0) return 0
  const step = Math.max(2, radius / 4, Math.max(width, height) / 512)
  const padding = Math.ceil(radius * 1.5 / step) + 1
  const columns = Math.ceil(width / step) + padding * 2 + 1
  const rows = Math.ceil(height / step) + padding * 2 + 1
  const grid = new Float64Array(columns * rows)
  for (const { x, y, weight } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(weight) || weight <= 0) continue
    const gx = x / step + padding
    const gy = y / step + padding
    const ix = Math.floor(gx)
    const iy = Math.floor(gy)
    if (ix < 0 || iy < 0 || ix + 1 >= columns || iy + 1 >= rows) continue
    const dx = gx - ix
    const dy = gy - iy
    grid[iy * columns + ix] += weight * (1 - dx) * (1 - dy)
    grid[iy * columns + ix + 1] += weight * dx * (1 - dy)
    grid[(iy + 1) * columns + ix] += weight * (1 - dx) * dy
    grid[(iy + 1) * columns + ix + 1] += weight * dx * dy
  }
  const reach = padding - 1
  const kernel = Array.from({ length: reach * 2 + 1 }, (_, i) => Math.exp(-4.5 * ((i - reach) * step / radius) ** 2))
  const horizontal = new Float64Array(grid.length)
  const lastX = padding + Math.floor(width / step)
  const lastY = padding + Math.floor(height / step)
  for (let y = 0; y < rows; y++) {
    for (let x = padding; x <= lastX; x++) {
      let sum = 0
      for (let k = -reach; k <= reach; k++) sum += grid[y * columns + x + k] * kernel[k + reach]
      horizontal[y * columns + x] = sum
    }
  }
  let peak = 0
  for (let y = padding; y <= lastY; y++) {
    for (let x = padding; x <= lastX; x++) {
      let sum = 0
      for (let k = -reach; k <= reach; k++) sum += horizontal[(y + k) * columns + x] * kernel[k + reach]
      peak = Math.max(peak, sum)
    }
  }
  return peak * 0.3989422804014327
}

export function warsHeatmapRadius(radius: number, zoom: number): number {
  if (zoom <= 8) return radius * 0.53
  if (zoom <= 11) return radius * (0.53 + (zoom - 8) / 3 * 0.47)
  return radius * (1 + Math.min(3, zoom - 11) / 3 * 0.53)
}

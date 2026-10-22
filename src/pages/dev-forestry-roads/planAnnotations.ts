/**
 * Zoom-aware plan annotation density. Labels keep a minimum on-screen spacing, so an overview
 * shows a few stations and zooming in adds more instead of stacking boxes over the road.
 * Pure: no DOM or map access.
 */
export const STATION_LABEL_INTERVALS = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]

/** Ground metres per CSS pixel at a MapLibre zoom (512 px tiles) and latitude. */
export function metresPerPixel(zoom: number, latitude: number) {
  return (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** Smallest round chainage interval whose labels sit at least `minPixels` apart; null if none fits. */
export function stationLabelInterval(metresPerPx: number, minPixels = 110): number | null {
  if (!(metresPerPx > 0)) return null
  return STATION_LABEL_INTERVALS.find((interval) => interval / metresPerPx >= minPixels) ?? null
}

/** Start, every interval multiple and the end; a multiple too close to the end gives way to it. */
export function labelChainages(length: number, interval: number): number[] {
  if (!(length > 0) || !(interval > 0)) return length >= 0 ? [0] : []
  const values = [0]
  for (let chainage = interval; chainage < length - interval * 0.4; chainage += interval)
    values.push(Math.round(chainage * 1000) / 1000)
  values.push(length)
  return values
}

/** Major ticks at the label interval, and minor ticks between them once they are 10 px apart. */
export function tickChainages(length: number, interval: number, metresPerPx: number) {
  if (!(length > 0) || !(interval > 0)) return []
  const minor = interval / 5
  const step = minor / metresPerPx >= 10 ? minor : interval
  const ticks: { chainage: number; major: boolean }[] = []
  for (let i = 0; i * step <= length + 1e-6; i++) {
    const chainage = Math.round(i * step * 1000) / 1000
    ticks.push({ chainage, major: Math.abs(chainage / interval - Math.round(chainage / interval)) < 1e-6 })
  }
  return ticks
}

/**
 * Screen offset (CSS px) that places a label of `characters` beside the road, on the right of
 * travel (`side` 1) or the left (-1), clear of the line whatever the road's direction.
 */
export function labelOffset(roadBearing: number, mapBearing: number, characters: number, side: 1 | -1 = 1, gap = 9) {
  const angle = ((roadBearing - mapBearing) * Math.PI) / 180
  // Right of travel on screen: forward is (sin a, −cos a) with y down, so right is (cos a, sin a).
  const nx = Math.cos(angle) * side,
    ny = Math.sin(angle) * side
  const halfWidth = characters * 2.9 + 5,
    halfHeight = 8
  const reach = gap + Math.abs(nx) * halfWidth + Math.abs(ny) * halfHeight
  return [Math.round(nx * reach), Math.round(ny * reach)] as const
}

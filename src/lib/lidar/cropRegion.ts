/**
 * Whether a point lies in a crop region: inside a polygon, within a corridor round a line, or within
 * `reachM` of either. Shared by the road designer's point-cloud crop (`pointCloudCrop.ts`) and the
 * chunked LAS/LAZ reader (`largeLazDecode.ts`), which drops points outside the region's reach as it
 * decodes. Coordinates are the cloud's own projected x/y. No DOM or network access.
 */
export interface CropRegion {
  corridor?: { points: Array<[number, number]>; halfWidthM: number }
  polygons?: Array<Array<[number, number]>>
}

export function inRing(x: number, y: number, ring: ReadonlyArray<readonly [number, number]>) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j]
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) inside = !inside
  }
  return inside
}

export function segmentDistanceSquared(
  x: number,
  y: number,
  a: readonly [number, number],
  b: readonly [number, number],
) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    size = dx * dx + dy * dy
  const t = size ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / size)) : 0
  return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2
}

/** [minX, minY, maxX, maxY] of the region grown by `reachM` (and the corridor's half width). */
export function cropRegionBox(region: CropRegion, reachM = 0): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const grow = (p: readonly [number, number], r: number) => {
    minX = Math.min(minX, p[0] - r)
    minY = Math.min(minY, p[1] - r)
    maxX = Math.max(maxX, p[0] + r)
    maxY = Math.max(maxY, p[1] + r)
  }
  for (const ring of region.polygons ?? []) for (const p of ring) grow(p, reachM)
  if (region.corridor) for (const p of region.corridor.points) grow(p, region.corridor.halfWidthM + reachM)
  return [minX, minY, maxX, maxY]
}

/**
 * A point test for the region grown by `reachM`. With `reachM` 0 a polygon keeps exactly what its
 * ring test does (no edge-distance test), so the crop's own mask is unchanged by sharing this.
 * Each ring and corridor segment carries its own box, so most points skip the exact tests.
 */
export function cropRegionTest(region: CropRegion, reachM = 0): (x: number, y: number) => boolean {
  const r2 = reachM * reachM
  const rings = (region.polygons ?? []).map((ring) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    return { ring, minX: minX - reachM, minY: minY - reachM, maxX: maxX + reachM, maxY: maxY + reachM }
  })
  const corridor = region.corridor
  const h = corridor ? corridor.halfWidthM + reachM : 0
  const segments = corridor
    ? corridor.points.slice(1).map((b, k) => {
        const a = corridor.points[k]
        return {
          a,
          b,
          minX: Math.min(a[0], b[0]) - h,
          minY: Math.min(a[1], b[1]) - h,
          maxX: Math.max(a[0], b[0]) + h,
          maxY: Math.max(a[1], b[1]) + h,
        }
      })
    : []
  const h2 = h * h
  return (x, y) => {
    for (const r of rings) {
      if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) continue
      if (inRing(x, y, r.ring)) return true
      if (reachM > 0) {
        const ring = r.ring
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
          if (segmentDistanceSquared(x, y, ring[j], ring[i]) <= r2) return true
      }
    }
    for (const s of segments)
      if (x >= s.minX && x <= s.maxX && y >= s.minY && y <= s.maxY && segmentDistanceSquared(x, y, s.a, s.b) <= h2)
        return true
    return false
  }
}

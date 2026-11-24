/**
 * A drawing clip that is not an axis-aligned rectangle: the region a map exporter paints a layer
 * inside, such as an operating area's outline or the map frame less its label masks. Built from the
 * clip path's subpaths under the operator's own fill rule, intersected through the q/Q state stack,
 * and applied to lines (split at its edges, gaps kept as separate paths) and areas (polygon
 * intersection). A clip whose region cannot be stated exactly is left unsupported, never guessed.
 * No DOM or network access.
 */
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { Box, XY } from './types'

/** A clip region in page points: non-overlapping polygons with holes, as polygon-clipping returns. */
export interface ClipRegion {
  polygons: XY[][][]
  bbox: Box
  /** Every ring's edges as x1, y1, x2, y2; inside is even-odd over all rings. */
  edges: Float64Array
  bandTop: number
  bandHeight: number
  /** Edge indices whose y-range meets each horizontal band. */
  bands: Uint32Array[]
}

const ringArea = (ring: XY[]) => {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return s / 2
}
const multiArea = (mp: MultiPolygon) =>
  mp.reduce((s, poly) => s + poly.reduce((t, r, i) => t + (i ? -1 : 1) * Math.abs(ringArea(r as XY[])), 0), 0)
const closed = (path: XY[]): XY[] => {
  const ring = path.slice()
  const [a, b] = [ring[0], ring.at(-1)!]
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a)
  return ring
}
function inside(ring: XY[], p: XY) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit
  }
  return hit
}
/** A ring that crosses itself paints differently under the two fill rules; its union area tells. */
const simple = (ring: XY[]) => {
  const area = Math.abs(ringArea(ring))
  const filled = multiArea(polygonClipping.union([ring] as Polygon))
  return Math.abs(filled - area) <= 1e-6 * Math.max(1, area)
}

/**
 * The region a clip path's subpaths enclose under nonzero (`W n`) or even-odd (`W* n`) filling, or
 * undefined when it cannot be stated exactly here: subpaths that cross themselves under even-odd,
 * or rings of both windings nested so that some area is wound twice over. An empty array is a clip
 * that encloses nothing (everything under it is clipped away).
 */
export function clipRegionFromPaths(paths: XY[][], evenOdd: boolean): MultiPolygon | undefined {
  const rings = paths.filter((p) => p.length >= 3).map(closed)
  if (!rings.length) return []
  // One subpath: polygon-clipping fills a ring by the nonzero rule, crossings included.
  if (rings.length === 1) return !evenOdd || simple(rings[0]) ? polygonClipping.union([rings[0]] as Polygon) : undefined
  if (!rings.every(simple)) return undefined
  // Simple rings: the even-odd region is the points inside an odd number of them.
  const polys = rings.map((r) => [r] as Polygon)
  const xor = () => polygonClipping.xor(polys[0], ...polys.slice(1))
  if (evenOdd) return xor()
  const signs = rings.map((r) => Math.sign(ringArea(r)))
  if (signs.every((s) => s === signs[0])) return polygonClipping.union(polys[0], ...polys.slice(1))
  // Mixed windings (an outline with its holes wound the other way): nonzero equals even-odd only
  // while no area is wound twice. Nest the rings by containment, as the fills do, and check that.
  const order = rings.map((_, i) => i).sort((a, b) => Math.abs(ringArea(rings[b])) - Math.abs(ringArea(rings[a])))
  const winding = new Map<number, number>()
  for (const [k, i] of order.entries()) {
    const parent = order
      .slice(0, k)
      .reverse()
      .find((j) => inside(rings[j], rings[i][0]))
    const w = (parent === undefined ? 0 : winding.get(parent)!) + signs[i]
    if (Math.abs(w) > 1) return undefined
    winding.set(i, w)
  }
  return xor()
}

export const intersectRegions = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length && b.length ? polygonClipping.intersection(a, b) : []

export function prepareRegion(region: MultiPolygon): ClipRegion {
  const polygons = region as XY[][][]
  const rings = polygons.flat()
  const count = rings.reduce((s, r) => s + Math.max(0, r.length - 1), 0)
  const edges = new Float64Array(count * 4)
  const bbox: Box = [Infinity, Infinity, -Infinity, -Infinity]
  let e = 0
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const [a, b] = [ring[i - 1], ring[i]]
      edges.set([a[0], a[1], b[0], b[1]], e * 4)
      e++
      bbox[0] = Math.min(bbox[0], a[0])
      bbox[1] = Math.min(bbox[1], a[1])
      bbox[2] = Math.max(bbox[2], a[0])
      bbox[3] = Math.max(bbox[3], a[1])
    }
  const bandCount = Math.max(1, Math.min(1024, Math.ceil(count / 8)))
  const bandTop = bbox[1],
    bandHeight = count ? Math.max((bbox[3] - bbox[1]) / bandCount, 1e-9) : 1
  const lists: number[][] = Array.from({ length: count ? bandCount : 0 }, () => [])
  for (let i = 0; i < count; i++) {
    const y1 = edges[i * 4 + 1],
      y2 = edges[i * 4 + 3]
    const from = bandOf(Math.min(y1, y2), bandTop, bandHeight, lists.length),
      to = bandOf(Math.max(y1, y2), bandTop, bandHeight, lists.length)
    for (let b = from; b <= to; b++) lists[b].push(i)
  }
  return { polygons, bbox, edges, bandTop, bandHeight, bands: lists.map((l) => Uint32Array.from(l)) }
}
const bandOf = (y: number, top: number, height: number, n: number) =>
  Math.min(n - 1, Math.max(0, Math.floor((y - top) / height)))

export function regionContains(region: ClipRegion, p: XY) {
  const [x, y] = p
  if (!region.bands.length || x < region.bbox[0] || x > region.bbox[2] || y < region.bbox[1] || y > region.bbox[3])
    return false
  let hit = false
  for (const i of region.bands[bandOf(y, region.bandTop, region.bandHeight, region.bands.length)]) {
    const ax = region.edges[i * 4],
      ay = region.edges[i * 4 + 1],
      bx = region.edges[i * 4 + 2],
      by = region.edges[i * 4 + 3]
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit
  }
  return hit
}

/** Liang–Barsky: does the segment meet the box? */
function segmentMeetsBox(ax: number, ay: number, bx: number, by: number, box: Box) {
  const dx = bx - ax,
    dy = by - ay
  let low = 0,
    high = 1
  for (const [p, q] of [
    [-dx, ax - box[0]],
    [dx, box[2] - ax],
    [-dy, ay - box[1]],
    [dy, box[3] - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) low = Math.max(low, t)
    else high = Math.min(high, t)
    if (low > high) return false
  }
  return true
}

/** Where a drawing's box lies against the region: wholly inside, wholly outside or across an edge. */
export function boxAgainstRegion(region: ClipRegion, box: Box): 'inside' | 'outside' | 'across' {
  const r = region.bbox
  if (!region.bands.length || box[2] < r[0] || box[0] > r[2] || box[3] < r[1] || box[1] > r[3]) return 'outside'
  const n = region.bands.length
  const seen = new Set<number>()
  for (
    let b = bandOf(box[1], region.bandTop, region.bandHeight, n);
    b <= bandOf(box[3], region.bandTop, region.bandHeight, n);
    b++
  )
    for (const i of region.bands[b]) {
      if (seen.has(i)) continue
      seen.add(i)
      const e = region.edges
      if (segmentMeetsBox(e[i * 4], e[i * 4 + 1], e[i * 4 + 2], e[i * 4 + 3], box)) return 'across'
    }
  // No edge reaches the box, so the whole box lies in one face: its centre says which.
  return regionContains(region, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]) ? 'inside' : 'outside'
}

/**
 * The parts of a line inside the region, split where it crosses an edge. Gaps stay separate paths,
 * as `clipLines` keeps them for a rectangle, rather than inventing joins.
 */
export function clipLineToRegion(path: XY[], region: ClipRegion): XY[][] {
  const out: XY[][] = []
  let current: XY[] = []
  const e = region.edges,
    n = region.bands.length
  const seen = new Set<number>()
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1],
      b = path[k]
    const dx = b[0] - a[0],
      dy = b[1] - a[1]
    if (!dx && !dy) continue
    const cuts = [0, 1]
    if (n) {
      seen.clear()
      const y0 = Math.min(a[1], b[1]),
        y1 = Math.max(a[1], b[1])
      if (!(y1 < region.bbox[1] || y0 > region.bbox[3]))
        for (
          let band = bandOf(y0, region.bandTop, region.bandHeight, n);
          band <= bandOf(y1, region.bandTop, region.bandHeight, n);
          band++
        )
          for (const i of region.bands[band]) {
            if (seen.has(i)) continue
            seen.add(i)
            const ex = e[i * 4 + 2] - e[i * 4],
              ey = e[i * 4 + 3] - e[i * 4 + 1]
            const denominator = dx * ey - dy * ex
            if (denominator === 0) continue
            const fx = e[i * 4] - a[0],
              fy = e[i * 4 + 1] - a[1]
            const t = (fx * ey - fy * ex) / denominator,
              u = (fx * dy - fy * dx) / denominator
            if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
          }
    }
    cuts.sort((p, q) => p - q)
    for (let c = 1; c < cuts.length; c++) {
      const t0 = cuts[c - 1],
        t1 = cuts[c]
      if (t1 - t0 <= 1e-12) continue
      const mid: XY = [a[0] + ((t0 + t1) / 2) * dx, a[1] + ((t0 + t1) / 2) * dy]
      if (!regionContains(region, mid)) {
        current = []
        continue
      }
      const from: XY = [a[0] + t0 * dx, a[1] + t0 * dy],
        to: XY = [a[0] + t1 * dx, a[1] + t1 * dy]
      if (!current.length) {
        current = [from]
        out.push(current)
      }
      current.push(to)
    }
  }
  return out
}

/**
 * Thinning a recovered PDF layer that is over the layer budget to the sheet's own detail, instead
 * of refusing it. Vertices closer to their simplified line than a fraction of a millimetre on paper
 * cannot be told apart on the printed sheet, so Douglas–Peucker at that tolerance (in page points)
 * drops nothing the sheet shows. Lines over the part budget are joined into one feature (a PDF
 * layer's paths are drawing strokes, not GIS records), and areas keep the largest parts first.
 * A layer that would leave out more than `THIN_MAX_LEFT_OUT_SHARE` of its drawing is refused.
 * No DOM or network access.
 */
import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { XY } from './types'

export type PageGeometry =
  | { type: 'LineString'; coordinates: XY[] }
  | { type: 'MultiLineString'; coordinates: XY[][] }
  | { type: 'Polygon'; coordinates: XY[][] }

/** Tolerances tried in order, in millimetres on the printed sheet; the first that fits is kept. */
export const THINNING_TOLERANCES_MM = [0.1, 0.25] as const
/** Largest share of a layer's length (lines) or area (areas) that thinning may leave out. */
export const THIN_MAX_LEFT_OUT_SHARE = 0.05
/** Raw vertices one layer may collect for thinning; past it the layer is refused as before. */
export const THINNABLE_LAYER_VERTICES = 250_000
/** Raw vertices a page may collect before thinning, all layers together. */
export const DRAWN_PAGE_VERTICES = 1_000_000
export const PT_PER_MM = 72 / 25.4

export interface Thinning {
  /** 0 when only the parts were joined or limited, with no vertex removed. */
  toleranceMm: number
  partsBefore: number
  verticesBefore: number
  partsAfter: number
  verticesAfter: number
  /** Lines joined into one feature to fit the part budget. */
  joined: boolean
  leftOutParts: number
  /** Share of the layer's length (lines) or area (areas) left out. */
  leftOutShare: number
}

const segmentDistance = (p: XY, a: XY, b: XY) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Douglas–Peucker, iterative so a long path cannot exhaust the stack. Keeps both ends. */
export function simplifyPath(points: XY[], tolerance: number): XY[] {
  if (tolerance <= 0 || points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [from, to] = stack.pop()!
    let farthest = -1,
      distance = tolerance
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(points[i], points[from], points[to])
      if (d > distance) {
        distance = d
        farthest = i
      }
    }
    if (farthest < 0) continue
    keep[farthest] = 1
    stack.push([from, farthest], [farthest, to])
  }
  return points.filter((_, i) => keep[i])
}

const ringArea = (ring: XY[]) => {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return Math.abs(s / 2)
}
const polygonArea = (rings: XY[][]) => rings.reduce((s, r, i) => s + (i ? -1 : 1) * ringArea(r), 0)
const lineLength = (line: XY[]) =>
  line.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0)
const count = (parts: XY[][][]) => parts.reduce((s, rings) => s + rings.reduce((n, r) => n + r.length, 0), 0)

interface Part {
  rings: XY[][]
  measure: number
}
interface Fit {
  parts: Part[]
  joined: boolean
  leftOutParts: number
  leftOutMeasure: number
  droppedForVertices: boolean
}

function fit(
  parts: Part[],
  shape: 'line' | 'polygon',
  limits: { maxFeatures: number; maxVertices: number },
  compound: boolean,
): Fit {
  const sorted = [...parts].sort((a, b) => b.measure - a.measure)
  // Lines join into one feature; areas cannot, so the largest are kept.
  const joined = shape === 'line' && !compound && sorted.length > limits.maxFeatures
  let kept = shape === 'polygon' ? sorted.slice(0, limits.maxFeatures) : sorted
  let vertices = count(kept.map((p) => p.rings))
  let droppedForVertices = false
  while (vertices > limits.maxVertices && kept.length) {
    const last = kept.at(-1)!
    vertices -= count([last.rings])
    kept = kept.slice(0, -1)
    droppedForVertices = true
  }
  const keptSet = new Set(kept)
  const out = parts.filter((p) => !keptSet.has(p))
  return {
    parts: parts.filter((p) => keptSet.has(p)),
    joined,
    leftOutParts: out.length,
    leftOutMeasure: out.reduce((s, p) => s + p.measure, 0),
    droppedForVertices,
  }
}

function thinnedParts(geometries: PageGeometry[], shape: 'line' | 'polygon', tolerance: number) {
  const parts: Part[] = []
  let collapsed = 0,
    collapsedMeasure = 0
  for (const geometry of geometries) {
    if (shape === 'line') {
      const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates as XY[]]
      for (const line of lines) {
        const thin = simplifyPath(line, tolerance)
        parts.push({ rings: [thin], measure: lineLength(line) })
      }
      continue
    }
    const rings = geometry.coordinates as XY[][]
    const measure = polygonArea(rings)
    if (!tolerance) {
      parts.push({ rings, measure })
      continue
    }
    const outer = simplifyPath(rings[0], tolerance)
    // An area narrower than the tolerance is a speck on the sheet: it is left out and counted.
    if (outer.length < 4 || ringArea(outer) === 0) {
      collapsed++
      collapsedMeasure += measure
      continue
    }
    const simplified = [
      outer,
      ...rings
        .slice(1)
        .map((r) => simplifyPath(r, tolerance))
        .filter((r) => r.length >= 4),
    ]
    let repaired: XY[][][]
    try {
      // Rings simplified one by one may touch or cross; the union draws them as the sheet does.
      repaired = polygonClipping.union(simplified as Polygon) as XY[][][]
    } catch {
      repaired = [rings]
    }
    const total = repaired.reduce((s, r) => s + polygonArea(r), 0) || 1
    for (const r of repaired) parts.push({ rings: r, measure: (measure * polygonArea(r)) / total })
  }
  return { parts, collapsed, collapsedMeasure }
}

/**
 * The layer thinned to fit `limits`, or the share it would leave out when no tolerance up to the
 * last in `THINNING_TOLERANCES_MM` fits without leaving out more than `THIN_MAX_LEFT_OUT_SHARE`.
 * `pointsPerMm` converts paper millimetres to the geometry's page units.
 */
export function thinLayer(
  geometries: PageGeometry[],
  shape: 'line' | 'polygon',
  limits: { maxFeatures: number; maxVertices: number },
  options: { compound?: boolean; pointsPerMm?: number } = {},
): { geometries: PageGeometry[]; thinning: Thinning } | { leftOutShare: number } {
  const compound = !!options.compound,
    perMm = options.pointsPerMm ?? PT_PER_MM
  const original = thinnedParts(geometries, shape, 0)
  const total = original.parts.reduce((s, p) => s + p.measure, 0)
  const verticesBefore = count(original.parts.map((p) => p.rings))
  let chosen: { tolerance: number; fit: Fit; collapsed: number; collapsedMeasure: number } | undefined
  for (const toleranceMm of [0, ...THINNING_TOLERANCES_MM]) {
    const thin = toleranceMm ? thinnedParts(geometries, shape, toleranceMm * perMm) : original
    chosen = { tolerance: toleranceMm, fit: fit(thin.parts, shape, limits, compound), ...thin }
    if (!chosen.fit.droppedForVertices) break
  }
  if (!chosen) return { leftOutShare: 1 }
  const leftOutParts = chosen.fit.leftOutParts + chosen.collapsed
  const leftOutShare = total > 0 ? (chosen.fit.leftOutMeasure + chosen.collapsedMeasure) / total : 0
  if (leftOutShare > THIN_MAX_LEFT_OUT_SHARE || !chosen.fit.parts.length) return { leftOutShare }
  const kept = chosen.fit.parts
  const out: PageGeometry[] =
    shape === 'polygon'
      ? kept.map((p) => ({ type: 'Polygon', coordinates: p.rings }))
      : chosen.fit.joined || compound
        ? [{ type: 'MultiLineString', coordinates: kept.map((p) => p.rings[0]) }]
        : kept.map((p) => ({ type: 'LineString', coordinates: p.rings[0] }))
  return {
    geometries: out,
    thinning: {
      toleranceMm: chosen.tolerance,
      partsBefore: original.parts.length,
      verticesBefore,
      partsAfter: out.length,
      verticesAfter: count(kept.map((p) => p.rings)),
      joined: chosen.fit.joined,
      leftOutParts,
      leftOutShare,
    },
  }
}

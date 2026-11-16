/**
 * Ground read from a TIN's own triangles: the height of the facet under a point, exactly as the
 * TIN gives it, with no grid between. A RoadEng terrain keeps RoadEng's TIN this way
 * (`roadEngProject.ts`, kept as the terrain's `preparation.tin` with operation `roadeng-tin`), so
 * sections, the profile's ground, quantities and every other `elevationAt` reading take RoadEng's
 * facets, while the terrain's grid is drawn on the plan and its fingerprint decides the write back.
 *
 * Why not the grid: RoadEng's TINs are dense along the road and sparse away from it, inside a box
 * far larger than the ground they cover. LongRoad's 100,372 points cover 5.5 km² of a 10.6 ×
 * 17.2 km box, so the 4,194,304-cell grid limit coarsens its cells to 7.73 m where half the median
 * edge is 3.96 m, and bilinear reading of those cells flattens every short facet.
 *
 * Point location is a bucket index over the TIN's box (`TIN_BUCKET_LIMIT` buckets, each about two
 * median edges wide), with the last facet found tried first, since a section's samples walk
 * across neighbouring triangles. A point on a shared edge or vertex reads the same height from
 * either triangle; a point under no triangle is NaN, never extrapolated.
 *
 * Pure: projected metres in and out; the projection is passed in. No DOM or network access.
 */
import type { TerrainMetadata, TerrainSource } from './types'

/** A TIN as a terrain keeps it: x, y pairs, one level per vertex and three vertex indices per triangle. */
export interface TinData {
  coordinates: ArrayLike<number>
  elevations: ArrayLike<number>
  triangles: ArrayLike<number>
}

export interface TinGround {
  /** Height of the facet under (x, y), projected metres; NaN where no triangle lies. */
  heightAt(x: number, y: number): number
  readonly vertexCount: number
  readonly triangleCount: number
}

export interface TinStats {
  vertices: number
  triangles: number
  /** Median triangle edge, m, over the edges of up to `MEDIAN_EDGE_SAMPLE` triangles spread through the TIN. */
  medianEdgeM: number
  /** Plan area the triangles cover, m². */
  areaM2: number
  /** [minX, minY, maxX, maxY] of the vertices. */
  bounds: [number, number, number, number]
}

/** At most this many index buckets: 4 MB of offsets, whatever the TIN's box. */
export const TIN_BUCKET_LIMIT = 1_048_576
/** Triangles sampled for the median edge. */
export const MEDIAN_EDGE_SAMPLE = 20_000
/** At most this many triangle-in-bucket entries (long slivers over a void register in many buckets). */
const MAX_ENTRIES = 50_000_000
/** Barycentric slack: a point this far outside a facet, as a share of it, is still on it. */
const ON_FACET = 1e-9

/** The TIN a terrain's analysis reads: RoadEng's own TIN kept with it, else null for every other terrain. */
export function analysisTin(metadata: Pick<TerrainMetadata, 'preparation'>): TinData | null {
  const p = metadata.preparation
  return p?.operation === 'roadeng-tin' && p.tin && p.tin.triangles.length >= 3 ? p.tin : null
}

/** Median edge, m, over the three edges of up to {@link MEDIAN_EDGE_SAMPLE} triangles spread through the TIN. */
export function tinMedianEdge(coordinates: ArrayLike<number>, triangles: ArrayLike<number>): number {
  const count = Math.floor(triangles.length / 3),
    step = Math.max(1, Math.floor(count / MEDIAN_EDGE_SAMPLE))
  const edges: number[] = []
  const edge = (a: number, b: number) =>
    edges.push(Math.hypot(coordinates[a * 2] - coordinates[b * 2], coordinates[a * 2 + 1] - coordinates[b * 2 + 1]))
  for (let t = 0; t < count; t += step) {
    const a = triangles[t * 3],
      b = triangles[t * 3 + 1],
      d = triangles[t * 3 + 2]
    edge(a, b)
    edge(b, d)
    edge(d, a)
  }
  edges.sort((x, y) => x - y)
  return edges[Math.floor(edges.length / 2)] ?? NaN
}

export function tinStats(tin: TinData): TinStats {
  const { coordinates: c, triangles: t } = tin
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i + 1 < c.length; i += 2) {
    if (c[i] < minX) minX = c[i]
    if (c[i] > maxX) maxX = c[i]
    if (c[i + 1] < minY) minY = c[i + 1]
    if (c[i + 1] > maxY) maxY = c[i + 1]
  }
  let area = 0
  for (let k = 0; k + 2 < t.length; k += 3) {
    const a = t[k] * 2,
      b = t[k + 1] * 2,
      d = t[k + 2] * 2
    area += Math.abs((c[b] - c[a]) * (c[d + 1] - c[a + 1]) - (c[d] - c[a]) * (c[b + 1] - c[a + 1])) / 2
  }
  return {
    vertices: tin.elevations.length,
    triangles: Math.floor(t.length / 3),
    medianEdgeM: tinMedianEdge(c, t),
    areaM2: area,
    bounds: [minX, minY, maxX, maxY],
  }
}

/** Index a TIN for reading heights. Throws on a TIN with no triangles or no horizontal extent. */
export function tinGround(tin: TinData): TinGround {
  const { coordinates: c, elevations: z, triangles: t } = tin
  const count = Math.floor(t.length / 3)
  if (!count) throw Error('The TIN has no triangles.')
  const { bounds } = tinStats({ coordinates: c, elevations: z, triangles: [] })
  const [minX, minY, maxX, maxY] = bounds
  const spanX = maxX - minX,
    spanY = maxY - minY
  if (!(spanX > 0 && spanY > 0)) throw Error('The TIN has no horizontal extent.')
  const edge = tinMedianEdge(c, t)
  let size = Math.max(Number.isFinite(edge) ? 2 * edge : 0, Math.sqrt((spanX * spanY) / TIN_BUCKET_LIMIT), 1e-3)
  while ((Math.floor(spanX / size) + 1) * (Math.floor(spanY / size) + 1) > TIN_BUCKET_LIMIT) size *= 1.25
  const cols = Math.floor(spanX / size) + 1,
    rows = Math.floor(spanY / size) + 1
  const range = (tri: number, out: Int32Array) => {
    const a = t[tri * 3] * 2,
      b = t[tri * 3 + 1] * 2,
      d = t[tri * 3 + 2] * 2
    out[0] = Math.floor((Math.min(c[a], c[b], c[d]) - minX) / size)
    out[1] = Math.min(cols - 1, Math.floor((Math.max(c[a], c[b], c[d]) - minX) / size))
    out[2] = Math.floor((Math.min(c[a + 1], c[b + 1], c[d + 1]) - minY) / size)
    out[3] = Math.min(rows - 1, Math.floor((Math.max(c[a + 1], c[b + 1], c[d + 1]) - minY) / size))
  }
  const box = new Int32Array(4)
  const start = new Int32Array(cols * rows + 1)
  let total = 0
  for (let tri = 0; tri < count; tri++) {
    range(tri, box)
    for (let row = box[2]; row <= box[3]; row++)
      for (let col = box[0]; col <= box[1]; col++) start[row * cols + col + 1]++
    total += (box[1] - box[0] + 1) * (box[3] - box[2] + 1)
    if (total > MAX_ENTRIES) throw Error('The TIN has too many long triangles to index.')
  }
  for (let i = 1; i < start.length; i++) start[i] += start[i - 1]
  const entries = new Int32Array(total),
    fill = start.slice(0, -1)
  for (let tri = 0; tri < count; tri++) {
    range(tri, box)
    for (let row = box[2]; row <= box[3]; row++)
      for (let col = box[0]; col <= box[1]; col++) entries[fill[row * cols + col]++] = tri
  }

  /** The facet's height at (x, y), or NaN when (x, y) is off it. */
  const facet = (tri: number, x: number, y: number) => {
    const a = t[tri * 3],
      b = t[tri * 3 + 1],
      d = t[tri * 3 + 2]
    const x0 = c[a * 2],
      y0 = c[a * 2 + 1]
    const ux = c[b * 2] - x0,
      uy = c[b * 2 + 1] - y0,
      vx = c[d * 2] - x0,
      vy = c[d * 2 + 1] - y0
    const det = ux * vy - vx * uy
    if (!det) return NaN
    const dx = x - x0,
      dy = y - y0
    const wb = (dx * vy - vx * dy) / det,
      wd = (ux * dy - dx * uy) / det
    if (wb < -ON_FACET || wd < -ON_FACET || 1 - wb - wd < -ON_FACET) return NaN
    return z[a] + wb * (z[b] - z[a]) + wd * (z[d] - z[a])
  }
  let last = 0
  return {
    vertexCount: z.length,
    triangleCount: count,
    heightAt(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN
      const hit = facet(last, x, y)
      if (!Number.isNaN(hit)) return hit
      const col = Math.floor((x - minX) / size),
        row = Math.floor((y - minY) / size)
      if (col < 0 || row < 0 || col >= cols || row >= rows) return NaN
      const bucket = row * cols + col
      for (let k = start[bucket], end = start[bucket + 1]; k < end; k++) {
        const tri = entries[k]
        if (tri === last) continue
        const h = facet(tri, x, y)
        if (!Number.isNaN(h)) {
          last = tri
          return h
        }
      }
      return NaN
    },
  }
}

/** A terrain source reading the TIN's facets; `forward` takes longitude, latitude to the TIN's metres. */
export function tinTerrainSource(
  ground: TinGround,
  forward: (lonLat: [number, number]) => readonly number[],
): TerrainSource {
  return {
    elevationAt(lon, lat) {
      const [x, y] = forward([lon, lat])
      return ground.heightAt(x, y)
    },
  }
}

/** What a terrain whose ground is RoadEng's TIN says about it; null for every other terrain. */
export function tinGroundFacts(
  metadata: Pick<TerrainMetadata, 'preparation'>,
): { vertices: number; triangles: number; medianEdgeM: number; areaM2: number } | null {
  const tin = analysisTin(metadata)
  if (!tin) return null
  const p = metadata.preparation!.parameters
  const stated = (key: string) => (typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : null)
  const medianEdgeM = stated('medianEdgeM'),
    areaM2 = stated('areaM2')
  const stats = medianEdgeM === null || areaM2 === null ? tinStats(tin) : null
  return {
    vertices: tin.elevations.length,
    triangles: Math.floor(tin.triangles.length / 3),
    medianEdgeM: medianEdgeM ?? stats!.medianEdgeM,
    areaM2: areaM2 ?? stats!.areaM2,
  }
}

/**
 * The terrain's resolution as Review and the reports state it. A terrain whose ground is RoadEng's
 * kept TIN is as fine as its points: `spacingM` is the TIN's median edge, the distance between
 * neighbouring points, and the grid the plan draws is only a drawing of it. Any other terrain is its
 * grid cell.
 */
export type TerrainResolution =
  | { kind: 'tin'; spacingM: number; vertices: number; triangles: number }
  | { kind: 'grid'; spacingM: number }

export function terrainResolution(metadata: Pick<TerrainMetadata, 'preparation' | 'resolutionM'>): TerrainResolution {
  const facts = tinGroundFacts(metadata)
  return facts && Number.isFinite(facts.medianEdgeM) && facts.medianEdgeM > 0
    ? { kind: 'tin', spacingM: facts.medianEdgeM, vertices: facts.vertices, triangles: facts.triangles }
    : { kind: 'grid', spacingM: metadata.resolutionM }
}

/** `TIN, 7.85 m median point spacing` or `7.69 m cells`, to `digits` decimals (trailing zeros kept). */
export function terrainResolutionText(
  metadata: Pick<TerrainMetadata, 'preparation' | 'resolutionM'>,
  digits = 2,
): string {
  const r = terrainResolution(metadata)
  return r.kind === 'tin'
    ? `TIN, ${r.spacingM.toFixed(digits)} m median point spacing`
    : `${r.spacingM.toFixed(digits)} m cells`
}

/** The finest grid cell a TIN is drawn or routed on, m: RoadEng's `ROADENG_TERRAIN_MIN_CELL_M`. */
export const TIN_MIN_CELL_M = 1

/**
 * The cell a grid made from the terrain's ground should use, m: half a kept TIN's median edge (so
 * the grid keeps what its densest points say), never under {@link TIN_MIN_CELL_M}; any other
 * terrain's own cell. Drainage samples the TIN at this cell, not at the cell of the grid kept over
 * the TIN's box.
 */
export function terrainGridCellM(metadata: Pick<TerrainMetadata, 'preparation' | 'resolutionM'>): number {
  const r = terrainResolution(metadata)
  return r.kind === 'tin' ? Math.max(TIN_MIN_CELL_M, r.spacingM / 2) : r.spacingM
}

/**
 * The share of the terrain's box its ground covers, 0–1: a kept TIN's covered area over its grid's
 * box. 1 for any other terrain, whose grid is its ground. LongRoad's TIN covers 3 % of its box.
 */
export function terrainCoverShare(metadata: Pick<TerrainMetadata, 'preparation' | 'raster'>): number {
  const facts = tinGroundFacts(metadata)
  const r = metadata.raster
  if (!facts || !r) return 1
  const box = r.width * Math.abs(r.pixelSize[0]) * r.height * Math.abs(r.pixelSize[1])
  return box > 0 && facts.areaM2 > 0 ? Math.min(1, facts.areaM2 / box) : 1
}

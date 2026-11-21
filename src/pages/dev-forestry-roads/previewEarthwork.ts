import { isBeyondReachFlag } from './engine'
import { sectionSampleAt } from './sectionGeometry'
import type { TerrainVertex } from './terrainMesh'
import type { RoadStation } from './types'
import { preparationExtent } from './preparationFootprint'

export const PREVIEW_BATTER_STRIPS = 6
/** A batter strip's colour by what it is: cut where the ground stood above the design, fill where it stood below. */
export const CUT_BATTER_FILL = '#dca365'
export const FILL_BATTER_FILL = '#79a9d9'
/** A batter edge that stopped before it met the ground: the canvas preview's dashed edge and the 3D view's curtain. */
export const UNFINISHED_BATTER_COLOUR = '#e11d48'
const EPS = 1e-6
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)

/** Only the contiguous, sampled part of a side is supported. Never jump a terrain gap. */
function supportedSide(station: RoadStation, sign: -1 | 1) {
  const width = sign < 0 ? station.leftWidth : station.rightWidth
  const edge = sectionSampleAt(station, sign * width)
  if (!finite(edge.design) || !finite(edge.ground)) return null
  const daylight = sign < 0 ? station.leftDaylightM : station.rightDaylightM
  let end = width
  const outward = station.section
    .filter((point) => sign * point.offset > width + EPS)
    .sort((a, b) => sign * (a.offset - b.offset))
  for (const point of outward) {
    if (finite(daylight) && sign * point.offset > Math.abs(daylight) + EPS) break
    if (!finite(point.ground) || !finite(point.design)) break
    end = sign * point.offset
  }
  const closed = finite(daylight) && Math.abs(end - Math.abs(daylight)) < EPS
  const beyondReach = station.flags.some(
    (flag) => flag.startsWith(sign < 0 ? 'Left ' : 'Right ') && isBeyondReachFlag(flag),
  )
  return { station, width, end, closed, reason: beyondReach ? ('reach' as const) : ('terrain' as const) }
}

export interface PreviewBatterFace {
  vertices: TerrainVertex[]
  fill: string
  station: number
}
/** An outer batter edge that did not reach the ground, at design level. */
export interface PreviewBatterEdge {
  a: TerrainVertex
  b: TerrainVertex
  /** The sampled ground level under `a` and under `b`, at the same offsets. */
  groundA: number
  groundB: number
  station: number
  reason: 'reach' | 'terrain'
}
/**
 * An outer edge of the drawn formation between two stations whose batters both reached their catch point (or whose
 * road edge is its catch point): where the design meets the ground, so the display ground is brought to it.
 */
export interface PreviewBatterSeam {
  a: TerrainVertex
  b: TerrainVertex
  station: number
}

/**
 * Display known sections even when one side does not meet the ground. Intermediate
 * analysis stations remain in each strip, so decimation cannot bridge an unseen gap.
 * This never changes daylight, completeness, quantities or the analysis terrain.
 */
export function previewEarthwork(
  stations: RoadStation[],
  vertex: (station: RoadStation, offset: number, elevation: number) => TerrainVertex,
): { faces: PreviewBatterFace[]; edges: PreviewBatterEdge[]; seams: PreviewBatterSeam[] } {
  const faces: PreviewBatterFace[] = []
  const edges: PreviewBatterEdge[] = []
  const seams: PreviewBatterSeam[] = []
  if (stations.length < 2) return { faces, edges, seams }
  for (const sign of [-1, 1] as const) {
    const margins = stations.map((station) => {
      const outer = preparationExtent(station, sign),
        inner = sign < 0 ? station.leftDaylightM : station.rightDaylightM
      if (outer === null || inner === null) return null
      const sample = sectionSampleAt(station, sign * outer)
      const catchSample = sectionSampleAt(station, sign * inner)
      const ground = sample.preparedGround ?? sample.ground
      if (ground == null || catchSample.design == null) return null
      return {
        inner,
        outer,
        a: vertex(station, sign * inner, catchSample.design),
        b: vertex(station, sign * outer, ground),
      }
    })
    if (margins.every((m) => m !== null) && margins.some((m) => m!.outer > m!.inner + EPS)) {
      const rows = margins.filter((m) => m !== null)
      faces.push({
        vertices: [...rows.map((m) => m.a), ...rows.map((m) => m.b).reverse()],
        fill: '#a16207',
        station: (stations[0].chainage + stations.at(-1)!.chainage) / 2,
      })
      // The stripped margin's outer edge lies on the prepared ground at every station: it is this side's outline.
      for (let i = 1; i < rows.length; i++)
        seams.push({
          a: rows[i - 1].b,
          b: rows[i].b,
          station: (stations[i - 1].chainage + stations[i].chainage) / 2,
        })
    }
    const supported = stations.map((station) => supportedSide(station, sign))
    // The opposite side is independent; an unsupported side does not hide it.
    if (supported.some((row) => !row)) continue
    const rows = supported.filter((row) => row !== null)
    const offsetAt = (row: (typeof rows)[number], fraction: number) =>
      sign * (row.width + (row.end - row.width) * fraction)
    const point = (row: (typeof rows)[number], fraction: number) => {
      const offset = offsetAt(row, fraction)
      const sample = sectionSampleAt(row.station, offset)
      return finite(sample.design) && finite(sample.ground) ? vertex(row.station, offset, sample.design) : null
    }
    // Component corners are mandatory mesh seams: a narrow retaining face or bench must not
    // disappear between the ordinary six display strips.
    const fractions = new Set(Array.from({ length: PREVIEW_BATTER_STRIPS + 1 }, (_, i) => i / PREVIEW_BATTER_STRIPS))
    for (const row of rows)
      for (const p of row.station.componentPoints ?? []) {
        const distance = sign * p.offset
        if (row.end > row.width + EPS && distance > row.width + EPS && distance < row.end - EPS)
          fractions.add((distance - row.width) / (row.end - row.width))
      }
    const breaks = [...fractions].sort((a, b) => a - b)
    const noBatter = rows.every((row) => row.end <= row.width + EPS)
    if (noBatter) {
      // No batter on this side: the road's own edge is the outline, and its catch point where the section says so.
      // The road face runs straight from the first station to the last, so its seam does too.
      const first = rows[0],
        last = rows[rows.length - 1]
      const va = point(first, 1),
        vb = point(last, 1)
      if (va && vb && rows.every((row) => row.closed))
        seams.push({ a: va, b: vb, station: (first.station.chainage + last.station.chainage) / 2 })
    }
    for (let part = 0; part < breaks.length - 1; part++) {
      const inner = rows.map((row) => point(row, breaks[part]))
      const outer = rows.map((row) => point(row, breaks[part + 1]))
      const vertices = [...inner, ...outer.reverse()]
      if (!vertices.every((v): v is TerrainVertex => v !== null)) continue
      if (noBatter) continue
      const middle = rows[Math.floor(rows.length / 2)]
      const sample = sectionSampleAt(
        middle.station,
        sign * (middle.width + ((middle.end - middle.width) * (breaks[part] + breaks[part + 1])) / 2),
      )
      faces.push({
        vertices,
        fill: sample.ground! >= sample.design! ? CUT_BATTER_FILL : FILL_BATTER_FILL,
        station: (stations[0].chainage + stations.at(-1)!.chainage) / 2,
      })
    }
    const groundAt = (row: (typeof rows)[number]) => sectionSampleAt(row.station, offsetAt(row, 1)).ground
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i]
      const va = point(a, 1),
        vb = point(b, 1)
      if (!va || !vb) continue
      const station = (a.station.chainage + b.station.chainage) / 2
      if (a.closed && b.closed) {
        if (!noBatter) seams.push({ a: va, b: vb, station })
        continue
      }
      const groundA = groundAt(a),
        groundB = groundAt(b)
      // `point` drew both ends only where the ground is sampled, so both levels are known here.
      if (!finite(groundA) || !finite(groundB)) continue
      edges.push({
        a: va,
        b: vb,
        groundA,
        groundB,
        station,
        reason: a.reason === 'reach' || b.reason === 'reach' ? 'reach' : 'terrain',
      })
    }
  }
  return { faces, edges, seams }
}

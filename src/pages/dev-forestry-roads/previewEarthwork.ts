import { isBeyondReachFlag } from './engine'
import { sectionSampleAt } from './sectionGeometry'
import type { TerrainVertex } from './terrainMesh'
import type { RoadStation } from './types'

export const PREVIEW_BATTER_STRIPS = 6
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
export interface PreviewBatterEdge {
  a: TerrainVertex
  b: TerrainVertex
  station: number
  reason: 'reach' | 'terrain'
}

/**
 * Display known sections even when one side does not meet the ground. Intermediate
 * analysis stations remain in each strip, so decimation cannot bridge an unseen gap.
 * This never changes daylight, completeness, quantities or the analysis terrain.
 */
export function previewEarthwork(
  stations: RoadStation[],
  vertex: (station: RoadStation, offset: number, elevation: number) => TerrainVertex,
): { faces: PreviewBatterFace[]; edges: PreviewBatterEdge[] } {
  const faces: PreviewBatterFace[] = []
  const edges: PreviewBatterEdge[] = []
  if (stations.length < 2) return { faces, edges }
  for (const sign of [-1, 1] as const) {
    const supported = stations.map((station) => supportedSide(station, sign))
    // The opposite side is independent; an unsupported side does not hide it.
    if (supported.some((row) => !row)) continue
    const rows = supported.filter((row) => row !== null)
    const point = (row: (typeof rows)[number], fraction: number) => {
      const offset = sign * (row.width + (row.end - row.width) * fraction)
      const sample = sectionSampleAt(row.station, offset)
      return finite(sample.design) && finite(sample.ground) ? vertex(row.station, offset, sample.design) : null
    }
    for (let part = 0; part < PREVIEW_BATTER_STRIPS; part++) {
      const inner = rows.map((row) => point(row, part / PREVIEW_BATTER_STRIPS))
      const outer = rows.map((row) => point(row, (part + 1) / PREVIEW_BATTER_STRIPS))
      const vertices = [...inner, ...outer.reverse()]
      if (!vertices.every((v): v is TerrainVertex => v !== null)) continue
      if (rows.every((row) => row.end <= row.width + EPS)) continue
      const middle = rows[Math.floor(rows.length / 2)]
      const sample = sectionSampleAt(
        middle.station,
        sign * (middle.width + ((middle.end - middle.width) * (part + 0.5)) / PREVIEW_BATTER_STRIPS),
      )
      faces.push({
        vertices,
        fill: sample.ground! >= sample.design! ? '#dca365' : '#79a9d9',
        station: (stations[0].chainage + stations.at(-1)!.chainage) / 2,
      })
    }
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i]
      if (a.closed && b.closed) continue
      const va = point(a, 1),
        vb = point(b, 1)
      if (va && vb)
        edges.push({
          a: va,
          b: vb,
          station: (a.station.chainage + b.station.chainage) / 2,
          reason: a.reason === 'reach' || b.reason === 'reach' ? 'reach' : 'terrain',
        })
    }
  }
  return { faces, edges }
}

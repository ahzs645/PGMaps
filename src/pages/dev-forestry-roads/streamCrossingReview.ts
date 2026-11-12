/**
 * What the Review list measures about a road and its mapped streams beyond the structure and class:
 * where the road runs inside a stream's riparian screening area away from a crossing (FPPR s. 50),
 * and how each crossing meets its stream, its angle off square and the straight road each side
 * (Engineering Manual §2.3.3.1). Free of DOM and network access. Guide:
 * docs/forestry-road-design/review-and-standards.md.
 */
import { resolveConstraint } from './constraints'
import { horizontalGeometry, positionAt } from './engine'
import { riparianArea } from './riparian'
import type { RiparianClass } from './streamClass'
import type { Alignment, ContextFeature, Coordinate } from './types'

/** Engineering Manual §2.3.3.1: horizontal approach tangents of at least 15 m each side of a crossing. */
export const CROSSING_APPROACH_TANGENT_M = 15
/**
 * The Engineering Manual asks for crossings at right angles and states no limit. A crossing more than
 * this far off square is flagged as a screen; 45° is the only published figure found (Maryland SHA's
 * culvert skew limit), not a BC rule.
 */
export const CROSSING_SKEW_SCREEN_DEG = 45
/** Consecutive straight pieces turning less than this read as one straight. */
const STRAIGHT_JOIN_DEG = 0.5

export interface MappedCrossing {
  featureId: string
  name: string
  chainage: number
}

export interface CrossingGeometry extends MappedCrossing {
  /** Angle between the road and the perpendicular to the stream, 0–90°. Null when the stream cannot be read. */
  skewDegrees: number | null
  /** The crossing lies on a curve or spiral: there is no straight approach on either side. */
  onCurve: boolean
  /** Straight road before and after the crossing, to the nearest curve, sharp corner or road end. */
  backM: number
  aheadM: number
}

const RAD = Math.PI / 180
const metric = (origin: Coordinate) => {
  const k = Math.cos(origin[1] * RAD) * 111_320
  return (p: GeoJSON.Position): [number, number] => [(p[0] - origin[0]) * k, (p[1] - origin[1]) * 111_320]
}
/** Bearing difference folded into 0–90°: lines, not directions. */
const lineAngle = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 180) + 180) % 180)
  return Math.min(d, 180 - d)
}

/** Direction of the stream line nearest a point, in degrees from east, counter-clockwise. */
function streamDirectionAt(stream: GeoJSON.LineString, at: Coordinate): number | null {
  const xy = metric(at)
  const line = stream.coordinates.map(xy)
  let best: number | null = null,
    bestD = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i],
      [bx, by] = line[i + 1]
    const vx = bx - ax,
      vy = by - ay,
      len2 = vx * vx + vy * vy
    if (!(len2 > 0)) continue
    const t = Math.max(0, Math.min(1, (-ax * vx - ay * vy) / len2))
    const d = Math.hypot(ax + t * vx, ay + t * vy)
    if (d < bestD) {
      bestD = d
      best = Math.atan2(vy, vx) / RAD
    }
  }
  return best
}

/** Each mapped crossing's angle off square and straight approaches. */
export function crossingGeometry(
  alignment: Alignment,
  context: readonly ContextFeature[],
  crossings: readonly MappedCrossing[],
): CrossingGeometry[] {
  let pieces: ReturnType<typeof horizontalGeometry>
  try {
    pieces = horizontalGeometry(alignment)
  } catch {
    return []
  }
  if (!pieces.length) return []
  const length = pieces.at(-1)!.station + pieces.at(-1)!.length
  const direction = (k: number) => {
    const piece = pieces[k]
    const xy = metric(piece.start)
    const [x, y] = xy(piece.end)
    return Math.atan2(y, x) / RAD
  }
  const continues = (k: number, next: number) =>
    pieces[next]?.kind === 'line' && Math.abs(lineAngle(direction(k), direction(next))) < STRAIGHT_JOIN_DEG
  return crossings.map((crossing) => {
    const s = Math.max(0, Math.min(length, crossing.chainage))
    let k = pieces.findIndex((piece) => s <= piece.station + piece.length + 1e-6)
    if (k < 0) k = pieces.length - 1
    const stream = context.find((feature) => feature.id === crossing.featureId)
    const place = positionAt(alignment, s)
    const streamDirection =
      stream?.geometry.type === 'LineString' ? streamDirectionAt(stream.geometry, place.coordinate) : null
    // positionAt gives a compass bearing (clockwise from north); turn it into the same frame.
    const roadDirection = 90 - place.bearing
    const skewDegrees = streamDirection === null ? null : 90 - lineAngle(roadDirection, streamDirection)
    if (pieces[k].kind !== 'line') return { ...crossing, skewDegrees, onCurve: true, backM: 0, aheadM: 0 }
    let first = k,
      last = k
    while (first > 0 && continues(first, first - 1)) first--
    while (last < pieces.length - 1 && continues(last, last + 1)) last++
    return {
      ...crossing,
      skewDegrees,
      onCurve: false,
      backM: s - pieces[first].station,
      aheadM: pieces[last].station + pieces[last].length - s,
    }
  })
}

/** Whether a crossing falls short of the manual's approach or the skew screen. */
export const crossingNeedsReview = (c: CrossingGeometry) =>
  c.onCurve ||
  Math.min(c.backM, c.aheadM) < CROSSING_APPROACH_TANGENT_M ||
  (c.skewDegrees !== null && c.skewDegrees > CROSSING_SKEW_SCREEN_DEG)

export interface RiparianStretch {
  featureId: string
  name: string
  start: number
  end: number
  /** The stretch contains a crossing of this stream: the road is in the area as part of the crossing. */
  crossing: boolean
  riparianClass: RiparianClass | null
  /** The screen is the 100 m allowance for an unresolved class or unknown channel width. */
  uncertain: boolean
  /** A current conditional-use review records the decision to use the area. */
  reviewed: boolean
}

function ringContains(ring: GeoJSON.Position[], [x, y]: Coordinate): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const polygonContains = (rings: GeoJSON.Position[][], p: Coordinate) =>
  ringContains(rings[0], p) && !rings.slice(1).some((hole) => ringContains(hole, p))

/**
 * Runs of calculated stations inside each mapped stream's riparian screening area. A run that holds
 * a crossing of that stream is the crossing; one that does not is the road running alongside.
 */
export function riparianStretches(
  stations: readonly { chainage: number; coordinate: Coordinate }[],
  context: readonly ContextFeature[],
  crossings: readonly MappedCrossing[],
): RiparianStretch[] {
  if (!stations.length) return []
  const stretches: RiparianStretch[] = []
  for (const stream of context) {
    const area = riparianArea(stream)
    if (!area) continue
    const polygons = area.outer.type === 'Polygon' ? [area.outer.coordinates] : area.outer.coordinates
    const boxes = polygons.map((rings) => {
      const xs = rings[0].map((p) => p[0]),
        ys = rings[0].map((p) => p[1])
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    })
    const inside = (p: Coordinate) =>
      polygons.some((rings, i) => {
        const [x0, y0, x1, y1] = boxes[i]
        return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && polygonContains(rings, p)
      })
    const reviewed = resolveConstraint(stream).reviewStatus === 'current'
    const own = crossings.filter((c) => c.featureId === stream.id)
    let run: { from: number; to: number } | null = null
    const close = () => {
      if (!run) return
      // A crossing between the last station outside and the first inside still belongs to the run.
      const lo = run.from > 0 ? stations[run.from - 1].chainage : stations[run.from].chainage
      const hi = run.to < stations.length - 1 ? stations[run.to + 1].chainage : stations[run.to].chainage
      stretches.push({
        featureId: stream.id,
        name: stream.name,
        start: stations[run.from].chainage,
        end: stations[run.to].chainage,
        crossing: own.some((c) => c.chainage >= lo && c.chainage <= hi),
        riparianClass: area.riparianClass,
        uncertain: area.uncertain,
        reviewed,
      })
      run = null
    }
    stations.forEach((station, i) => {
      if (inside(station.coordinate)) run = run ? { ...run, to: i } : { from: i, to: i }
      else close()
    })
    close()
  }
  return stretches.sort((a, b) => a.start - b.start)
}

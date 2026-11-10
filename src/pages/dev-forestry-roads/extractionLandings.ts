/**
 * Landings the user chooses for an extraction-reach run (Design → Extraction reach → Landings).
 *
 * A landing is a point (picked on the plan, taken from a landing-site candidate, or placed at a
 * station of a road) or a stretch of a counted road. Each is marked **existing** or **proposed**
 * and, for the cable yarder, says where the yarder may stand on lines from it: above the line,
 * below it, or either. When any landing is set, a run takes logs only to those landings; with none
 * the run keeps its usual behaviour (every counted truck-road cell for the skidder and forwarder,
 * one cable landing every **Landing spacing** metres along the counted roads).
 *
 * After Sylvaccess 3.6's cable departure lines (yarder above / below / both, existing / project).
 * Written from a functional specification; no code from Sylvaccess (GPL-3.0-or-later) was used.
 *
 * Pure: projection and grid are arguments; no DOM or network access.
 */
import type { CablePosition } from './cableCoverageRule'
import { lineCells, type ProjectedRoad, type SkidGrid } from './skidReach'
import type { Coordinate } from './types'

type XY = [number, number]

export type LandingStatus = 'existing' | 'proposed'
export type LandingSource = 'plan' | 'site' | 'station' | 'stretch'

export interface LandingInput {
  id: string
  name: string
  status: LandingStatus
  /** Cable yarder only: where the yarder may stand on lines leaving this landing. */
  yarder: CablePosition
  /** One coordinate for a point landing; a road stretch's line otherwise. */
  coordinates: Coordinate[]
  source: LandingSource
  /** A road stretch or station: the road and the distances along it, m. */
  road?: { id: string; name: string; fromM: number; toM: number }
}

/** Most landings one run takes. */
export const MAX_LANDINGS = 40
/** A point landing this close to a counted road is joined to it by the cells between them, m. */
export const LANDING_JOIN_M = 25
/** Longest road stretch, m. */
export const MAX_LANDING_STRETCH_M = 5000
const MAX_NAME = 80

/** The landing's state checked: name, status, yarder side and geometry. Throws a message naming the landing. */
export function validateLandings(landings: readonly LandingInput[]): LandingInput[] {
  if (landings.length > MAX_LANDINGS) throw Error(`Use at most ${MAX_LANDINGS} landings.`)
  const ids = new Set<string>()
  return landings.map((landing, k) => {
    const label = landing.name?.trim() || `Landing ${k + 1}`
    if (!landing.id || ids.has(landing.id)) throw Error(`${label} needs its own id.`)
    ids.add(landing.id)
    if (landing.status !== 'existing' && landing.status !== 'proposed')
      throw Error(`Mark ${label} existing or proposed.`)
    if (landing.yarder !== 'either' && landing.yarder !== 'above' && landing.yarder !== 'below')
      throw Error(`Say where the yarder stands at ${label}: above, below or either.`)
    const c = landing.coordinates
    if (!Array.isArray(c) || !c.length || c.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
      throw Error(`${label} has no position.`)
    return { ...landing, name: label.slice(0, MAX_NAME) }
  })
}

const length = (xy: readonly XY[]) => {
  let sum = 0
  for (let i = 1; i < xy.length; i++) sum += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])
  return sum
}

/** A road's length in the projection, m. */
export const roadLengthM = (coordinates: readonly Coordinate[], toGrid: (c: Coordinate) => XY) =>
  length(coordinates.map(toGrid))

/**
 * The part of a road from `fromM` to `toM` along it (in the projection), as coordinates. Equal
 * distances give the one point there. Throws when the stretch lies off the road or is too long.
 */
export function roadStretch(
  coordinates: readonly Coordinate[],
  fromM: number,
  toM: number,
  toGrid: (c: Coordinate) => XY,
  toLonLat: (xy: XY) => Coordinate,
): Coordinate[] {
  const xy = coordinates.map(toGrid)
  const total = length(xy)
  if (!(Number.isFinite(fromM) && Number.isFinite(toM))) throw Error('Enter the stretch in metres along the road.')
  const a = Math.min(fromM, toM),
    b = Math.max(fromM, toM)
  if (a < -1e-6 || b > total + 1e-6) throw Error(`Keep the stretch within the road's ${Math.round(total)} m.`)
  if (b - a > MAX_LANDING_STRETCH_M) throw Error(`Keep a landing stretch to ${MAX_LANDING_STRETCH_M} m.`)
  const at = (s: number): XY => {
    let along = 0
    for (let i = 1; i < xy.length; i++) {
      const d = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])
      if (along + d >= s - 1e-9 && d > 0) {
        const f = Math.min(1, Math.max(0, (s - along) / d))
        return [xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * f, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * f]
      }
      along += d
    }
    return xy[xy.length - 1]
  }
  if (b - a < 1e-6) return [toLonLat(at(a))]
  const out: XY[] = [at(a)]
  let along = 0
  for (let i = 1; i < xy.length; i++) {
    along += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])
    if (along > a + 1e-9 && along < b - 1e-9) out.push(xy[i])
  }
  out.push(at(b))
  return out.map(toLonLat)
}

/** The nearest point of `roads` to `p`, with its distance, in grid metres; null without roads. */
export function nearestRoadPoint(p: XY, roads: readonly (readonly XY[])[]): { xy: XY; distanceM: number } | null {
  let best: { xy: XY; distanceM: number } | null = null
  for (const line of roads)
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)],
        b = line[i]
      const dx = b[0] - a[0],
        dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
      const q: XY = [a[0] + dx * t, a[1] + dy * t]
      const d = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (!best || d < best.distanceM) best = { xy: q, distanceM: d }
    }
  return best
}

/** A landing on the extraction grid. */
export interface ResolvedLanding {
  /** Index in the run's landing list. */
  index: number
  id: string
  name: string
  status: LandingStatus
  yarder: CablePosition
  /** Grid cells logs may be delivered to: the point's cell (and the cells joining it to a road within `LANDING_JOIN_M`), or the stretch's cells. */
  cells: number[]
  /** The point, or the stretch's line, in grid metres. */
  xy: XY[]
  kind: 'point' | 'stretch'
  /** Distance from a point landing to the nearest truck road, m; null for a stretch or without roads. */
  roadDistanceM: number | null
}

/**
 * Places landings on the grid. A point landing within `LANDING_JOIN_M` of a counted truck road is
 * joined to it by the cells between them, so a machine travelling along that road can deliver to
 * it. A landing with no cell on the grid is reported in `offGrid` and left out.
 */
export function resolveLandings(
  sg: SkidGrid,
  landings: readonly LandingInput[],
  roads: readonly ProjectedRoad[] = sg.roads,
): { landings: ResolvedLanding[]; offGrid: string[] } {
  const valid = validateLandings(landings)
  const truck = roads.filter((road) => road.road.use !== 'track').map((road) => road.xy)
  const out: ResolvedLanding[] = []
  const offGrid: string[] = []
  valid.forEach((landing, index) => {
    const xy = landing.coordinates.map((c) => sg.toGrid(c))
    const point = xy.length === 1
    let cells = lineCells(sg.grid, xy)
    if (!cells.length) {
      offGrid.push(landing.name)
      return
    }
    let roadDistanceM: number | null = null
    if (point) {
      const near = nearestRoadPoint(xy[0], truck)
      roadDistanceM = near ? near.distanceM : null
      if (near && near.distanceM <= LANDING_JOIN_M && near.distanceM > 0)
        cells = [...new Set([...cells, ...lineCells(sg.grid, [xy[0], near.xy])])]
    }
    out.push({
      index,
      id: landing.id,
      name: landing.name,
      status: landing.status,
      yarder: landing.yarder,
      cells,
      xy,
      kind: point ? 'point' : 'stretch',
      roadDistanceM,
    })
  })
  return { landings: out, offGrid }
}

/**
 * Points every `spacingM` along a line in grid metres, from its start (the line's one point when it
 * has one). Used to place cable landings along a road stretch.
 */
export function pointsAlong(xy: readonly XY[], spacingM: number): XY[] {
  if (xy.length === 1) return [xy[0]]
  const out: XY[] = []
  let along = 0,
    next = 0
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1],
      b = xy[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (next <= along + len + 1e-9) {
      const f = len > 0 ? (next - along) / len : 0
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
      next += spacingM
    }
    along += len
  }
  return out
}

/** Labels for the landing choices. */
export const LANDING_STATUS_LABELS: Record<LandingStatus, string> = { existing: 'Existing', proposed: 'Proposed' }
export const LANDING_YARDER_LABELS: Record<CablePosition, string> = {
  either: 'Yarder either side',
  above: 'Yarder above',
  below: 'Yarder below',
}

/**
 * Plan features for the user's landings: a labelled marker at each point landing, and each stretch
 * as a line with a marker at its middle, in `colorOf(index)`.
 */
export function landingInputFeatures(
  landings: readonly LandingInput[],
  colorOf: (index: number) => string,
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = []
  landings.forEach((landing, k) => {
    const color = colorOf(k)
    const label = `${landing.name} · ${LANDING_STATUS_LABELS[landing.status].toLowerCase()}`
    if (landing.coordinates.length > 1)
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: landing.coordinates },
        properties: { kind: 'extraction-landing', color, selected: true, label },
      })
    const c = landing.coordinates[Math.floor((landing.coordinates.length - 1) / 2)]
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: { kind: 'extraction-landing', color, label },
    })
  })
  return out
}

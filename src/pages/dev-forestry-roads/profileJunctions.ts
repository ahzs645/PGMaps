/**
 * Where the other roads of the project meet or cross this one in plan, with the level the profile
 * has to meet there. Pure: no DOM, network or terrain access; it reads the roads' calculated stations.
 *
 * The level is the other road's formation where it has a designed profile, and the ground where it
 * does not (a mapped road follows the ground). Missing terrain stays unknown: a level is never
 * guessed across a gap.
 */
import { JUNCTION_SNAP_M, localFrame } from './junctionTurn'
import type { Alignment, Coordinate, RoadAnalysis, VerticalControl } from './types'

/** Most junction markers one profile shows; the rest are counted. */
export const MAX_PROFILE_JUNCTIONS = 60
/** A vertical control within this distance of a junction's station is that junction's control. */
export const JUNCTION_CONTROL_MATCH_M = 1
/** Grid cell for the segment search, metres. */
const CELL_M = 50

export interface JunctionStation {
  chainage: number
  coordinate: Coordinate
  groundElevation: number | null
  designElevation: number | null
}

export interface JunctionProfileRoad {
  id: string
  name: string
  stations: readonly JunctionStation[]
  /** The road has a designed profile, so its formation is the level to meet. */
  designed: boolean
  /** A design road of the project rather than a mapped one; two design roads from one start are alternatives. */
  design: boolean
  /** The context features a mapped road was loaded from; absent for a design road. */
  contextIds?: readonly string[]
}

export interface ProfileJunction {
  id: string
  otherRoadId: string
  otherRoadName: string
  /** `meets`: an end of one road lies on the other; `crosses`: the lines cross. */
  kind: 'meets' | 'crosses'
  /** Station on this road. */
  chainage: number
  /** Station on the other road. */
  otherChainage: number
  /** The level to meet: the other road's formation or ground there; null where it is unknown. */
  level: number | null
  levelKind: 'design' | 'ground'
  /** This road's formation and ground at `chainage`. */
  designHere: number | null
  groundHere: number | null
  /** `level` − this road's formation; null when either is unknown. */
  difference: number | null
  /** The context features the other road was loaded from, so its context crossing is not drawn twice. */
  otherContextIds?: readonly string[]
}

type XY = [number, number]

/** Linear value at `chainage`; null outside the stations or where a neighbouring value is unknown. */
export function valueAt(
  stations: readonly JunctionStation[],
  chainage: number,
  key: 'groundElevation' | 'designElevation',
): number | null {
  if (!stations.length) return null
  let lo = 0,
    hi = stations.length - 1
  if (chainage < stations[0].chainage - 1e-6 || chainage > stations[hi].chainage + 1e-6) return null
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (stations[mid].chainage <= chainage) lo = mid
    else hi = mid
  }
  const a = stations[lo],
    b = stations[hi]
  const va = a[key],
    vb = b[key]
  if (Math.abs(a.chainage - chainage) < 1e-6) return va
  if (Math.abs(b.chainage - chainage) < 1e-6) return vb
  if (va === null || vb === null) return null
  const t = (chainage - a.chainage) / (b.chainage - a.chainage)
  return va + (vb - va) * t
}

interface Line {
  xy: XY[]
  s: number[]
  box: [number, number, number, number]
}

function line(road: JunctionProfileRoad, toLocal: (c: Coordinate) => XY): Line {
  const xy = road.stations.map((s) => toLocal(s.coordinate))
  const xs = xy.map((p) => p[0]),
    ys = xy.map((p) => p[1])
  return {
    xy,
    s: road.stations.map((s) => s.chainage),
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  }
}

/** Nearest point of `l` to `p`: its station and distance. */
function nearestOn(l: Line, p: XY) {
  let best = { along: l.s[0], distance: Infinity }
  for (let i = 0; i + 1 < l.xy.length; i++) {
    const [ax, ay] = l.xy[i],
      [bx, by] = l.xy[i + 1]
    const dx = bx - ax,
      dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0
    const d = Math.hypot(ax + dx * t - p[0], ay + dy * t - p[1])
    if (d < best.distance) best = { along: l.s[i] + (l.s[i + 1] - l.s[i]) * t, distance: d }
  }
  return best
}

/** Proper crossings of two lines, found through a coarse grid of the second line's segments. */
function crossings(a: Line, b: Line) {
  const cells = new Map<string, number[]>()
  const cover = (p: XY, q: XY, visit: (k: string) => void) => {
    const x0 = Math.floor(Math.min(p[0], q[0]) / CELL_M),
      x1 = Math.floor(Math.max(p[0], q[0]) / CELL_M)
    const y0 = Math.floor(Math.min(p[1], q[1]) / CELL_M),
      y1 = Math.floor(Math.max(p[1], q[1]) / CELL_M)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) visit(`${x}:${y}`)
  }
  for (let j = 0; j + 1 < b.xy.length; j++)
    cover(b.xy[j], b.xy[j + 1], (k) => {
      const list = cells.get(k)
      if (list) list.push(j)
      else cells.set(k, [j])
    })
  const found: { along: number; otherAlong: number }[] = []
  for (let i = 0; i + 1 < a.xy.length; i++) {
    const seen = new Set<number>()
    const p = a.xy[i],
      r: XY = [a.xy[i + 1][0] - p[0], a.xy[i + 1][1] - p[1]]
    cover(a.xy[i], a.xy[i + 1], (k) => {
      for (const j of cells.get(k) ?? []) {
        if (seen.has(j)) continue
        seen.add(j)
        const q = b.xy[j],
          sv: XY = [b.xy[j + 1][0] - q[0], b.xy[j + 1][1] - q[1]]
        const denom = r[0] * sv[1] - r[1] * sv[0]
        if (Math.abs(denom) < 1e-12) continue
        const qp: XY = [q[0] - p[0], q[1] - p[1]]
        const t = (qp[0] * sv[1] - qp[1] * sv[0]) / denom,
          u = (qp[0] * r[1] - qp[1] * r[0]) / denom
        if (t < 0 || t > 1 || u < 0 || u > 1) continue
        found.push({
          along: a.s[i] + (a.s[i + 1] - a.s[i]) * t,
          otherAlong: b.s[j] + (b.s[j + 1] - b.s[j]) * u,
        })
      }
    })
  }
  return found
}

const overlaps = (a: Line['box'], b: Line['box'], pad: number) =>
  a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3]

/**
 * Junctions of `road` with `others`, by station on `road`. A road end within `JUNCTION_SNAP_M` of
 * the other road meets it; lines that cross are a crossing. Two design roads that start at the same
 * point are alternatives from one start, as in `junctionTurn.ts`, and are left out.
 */
export function findProfileJunctions(
  road: JunctionProfileRoad,
  others: readonly JunctionProfileRoad[],
): { junctions: ProfileJunction[]; leftOut: number } {
  if (road.stations.length < 2) return { junctions: [], leftOut: 0 }
  const { toLocal } = localFrame(road.stations[0].coordinate)
  const own = line(road, toLocal)
  const found: ProfileJunction[] = []
  for (const other of others) {
    if (other.id === road.id || other.stations.length < 2) continue
    const theirs = line(other, toLocal)
    if (!overlaps(own.box, theirs.box, JUNCTION_SNAP_M)) continue
    const startGap = Math.hypot(own.xy[0][0] - theirs.xy[0][0], own.xy[0][1] - theirs.xy[0][1])
    if (road.design && other.design && startGap <= JUNCTION_SNAP_M) continue
    const candidates: { along: number; otherAlong: number; kind: ProfileJunction['kind'] }[] = []
    for (const end of [0, theirs.xy.length - 1]) {
      const hit = nearestOn(own, theirs.xy[end])
      if (hit.distance <= JUNCTION_SNAP_M)
        candidates.push({ along: hit.along, otherAlong: theirs.s[end], kind: 'meets' })
    }
    for (const end of [0, own.xy.length - 1]) {
      const hit = nearestOn(theirs, own.xy[end])
      if (hit.distance <= JUNCTION_SNAP_M) candidates.push({ along: own.s[end], otherAlong: hit.along, kind: 'meets' })
    }
    for (const c of crossings(own, theirs)) candidates.push({ ...c, kind: 'crosses' })
    // One place found twice (an end lying on the line also crosses it): keep the meeting.
    candidates.sort((a, b) => (a.kind === b.kind ? a.along - b.along : a.kind === 'meets' ? -1 : 1))
    const kept: typeof candidates = []
    for (const c of candidates) if (!kept.some((k) => Math.abs(k.along - c.along) <= 2 * JUNCTION_SNAP_M)) kept.push(c)
    for (const c of kept) {
      const levelKind = other.designed ? 'design' : 'ground'
      const designHere = valueAt(road.stations, c.along, 'designElevation'),
        groundHere = valueAt(road.stations, c.along, 'groundElevation')
      const level = valueAt(
        other.stations,
        c.otherAlong,
        levelKind === 'design' ? 'designElevation' : 'groundElevation',
      )
      found.push({
        id: `${other.id}@${c.along.toFixed(1)}`,
        otherRoadId: other.id,
        otherRoadName: other.name,
        kind: c.kind,
        chainage: c.along,
        otherChainage: c.otherAlong,
        level,
        levelKind,
        designHere,
        groundHere,
        difference: level !== null && designHere !== null ? level - designHere : null,
        ...(other.contextIds?.length ? { otherContextIds: other.contextIds } : {}),
      })
    }
  }
  found.sort((a, b) => a.chainage - b.chainage || a.otherRoadName.localeCompare(b.otherRoadName))
  return {
    junctions: found.slice(0, MAX_PROFILE_JUNCTIONS),
    leftOut: Math.max(0, found.length - MAX_PROFILE_JUNCTIONS),
  }
}

/** A project road and its calculated stations, as a junction road. */
export function junctionProfileRoad(alignment: Alignment, analysis: RoadAnalysis): JunctionProfileRoad {
  return {
    id: alignment.id,
    name: alignment.name,
    stations: analysis.stations,
    designed: !alignment.mappedRoad && alignment.vertical.length >= 2,
    design: !alignment.mappedRoad,
    ...(alignment.mappedRoad ? { contextIds: alignment.mappedRoad.contextIds } : {}),
  }
}

/** The project's other roads meeting `alignment`, from each road's latest calculation. */
export function projectProfileJunctions(
  alignment: Alignment,
  analysis: RoadAnalysis,
  alignments: readonly Alignment[],
  analyses: ReadonlyMap<string, RoadAnalysis>,
) {
  const others = alignments.flatMap((a) => {
    const result = a.id === alignment.id ? undefined : analyses.get(a.id)
    return result ? [junctionProfileRoad(a, result)] : []
  })
  return findProfileJunctions(junctionProfileRoad(alignment, analysis), others)
}

/** The control already standing at a junction, if any. */
export function junctionControl(controls: readonly VerticalControl[] | undefined, junction: ProfileJunction) {
  return (controls ?? []).find((c) => Math.abs(c.chainage - junction.chainage) <= JUNCTION_CONTROL_MATCH_M)
}

/**
 * A vertical control at the junction's level, exact (no tolerance), checking elevation only. Null
 * where the level is unknown.
 */
export function controlForJunction(junction: ProfileJunction, id: string): VerticalControl | null {
  if (junction.level === null) return null
  return {
    id,
    chainage: Math.round(junction.chainage * 100) / 100,
    elevation: Math.round(junction.level * 100) / 100,
    toleranceAboveM: 0,
    toleranceBelowM: 0,
    gradePercent: null,
    gradeTolerancePercent: 0,
  }
}

/** Most vertical controls a road keeps, as the project parser enforces. */
export const MAX_VERTICAL_CONTROLS = 200

/** `controls` with `control` added in station order; null when the road already holds the most. */
export function withVerticalControl(controls: readonly VerticalControl[] | undefined, control: VerticalControl) {
  const list = controls ?? []
  if (list.length >= MAX_VERTICAL_CONTROLS) return null
  return [...list, control].sort((a, b) => a.chainage - b.chainage)
}

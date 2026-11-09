/**
 * Mapped roads as analysable alignments. A permitted or FSR road from the context layer becomes a
 * road whose formation follows the sampled ground (no vertical controls), so the profile, sections
 * and grade checks describe the road as mapped rather than a new design. Pure: no DOM or network.
 */
import { distance } from './engine'
import { simplifyPath } from './mapNotes'
import type { Alignment, ContextFeature, Coordinate, MappedRoadOrigin, RoadAnalysis, RoadSettings } from './types'

/** Parts of one road further apart than this are not joined: the gap is not on the record. */
export const MAX_JOIN_GAP_M = 25
/** Thinning keeps vertices that move the line by more than half a terrain cell, within these bounds. */
export const MIN_THINNING_M = 0.5
export const MAX_THINNING_M = 5
/** Sustained grades are read over this length of road, so one noisy DEM cell is not a "steep pitch". */
export const SUSTAINED_GRADE_WINDOW_M = 50
/** Bends are read as the circle through points this far either side along the mapped line. */
export const BEND_CHORD_M = 20
/** Coarser terrain than this smooths grades enough that the review says so. */
export const COARSE_TERRAIN_M = 5

const RAD = Math.PI / 180
const EARTH_M = 6371008.8

/** Parts sharing a permit section (or one source row) belong to the same mapped road. */
export function mappedRoadKey(feature: ContextFeature): string {
  const e = feature.roadEvidence
  if (e?.forestFileId && e.roadSectionId) return `${e.source}:section:${e.forestFileId}:${e.roadSectionId}`
  if (e?.sourceId) return `${e.source}:row:${e.sourceId}`
  return `feature:${feature.id}`
}

/** Whether a context feature can be loaded as a road: an existing road drawn as a line. */
export const isLoadableMappedRoad = (feature: ContextFeature | undefined): feature is ContextFeature =>
  !!feature && feature.kind === 'existing-road' && feature.geometry.type === 'LineString'

export interface JoinedMappedRoad {
  coordinates: Coordinate[]
  /** Context features joined into the line, in the line's order. */
  parts: ContextFeature[]
  /** Straight joins between consecutive parts, metres; touching parts add nothing. */
  joinGapsM: number[]
  /** Parts of the same road left out because no end came within MAX_JOIN_GAP_M. */
  partsLeftOut: number
}

/**
 * Joins the seed road with the other parts of its permit section, end to end. Each step attaches
 * the part whose nearer end is closest to either end of the line so far, reversing it if needed,
 * and stops when the closest end is more than MAX_JOIN_GAP_M away.
 */
export function joinMappedRoad(seed: ContextFeature, context: readonly ContextFeature[]): JoinedMappedRoad {
  if (!isLoadableMappedRoad(seed)) throw Error('Only a mapped road line can be loaded as a road.')
  const key = mappedRoadKey(seed)
  const remaining = context.filter((f) => f.id !== seed.id && isLoadableMappedRoad(f) && mappedRoadKey(f) === key)
  let line = [...(seed.geometry.coordinates as Coordinate[])]
  const parts = [seed]
  const joinGapsM: number[] = []
  for (;;) {
    let best: { index: number; gap: number; atStart: boolean; reverse: boolean } | null = null
    remaining.forEach((part, index) => {
      const c = part.geometry.coordinates as Coordinate[]
      const options = [
        { atStart: false, reverse: false, gap: distance(line.at(-1)!, c[0]) },
        { atStart: false, reverse: true, gap: distance(line.at(-1)!, c.at(-1)!) },
        { atStart: true, reverse: false, gap: distance(line[0], c.at(-1)!) },
        { atStart: true, reverse: true, gap: distance(line[0], c[0]) },
      ]
      for (const option of options) if (!best || option.gap < best.gap) best = { index, ...option }
    })
    if (!best || (best as { gap: number }).gap > MAX_JOIN_GAP_M) break
    const { index, gap, atStart, reverse } = best as { index: number; gap: number; atStart: boolean; reverse: boolean }
    const [part] = remaining.splice(index, 1)
    let c = [...(part.geometry.coordinates as Coordinate[])]
    if (reverse) c.reverse()
    if (gap < 0.01) c = atStart ? c.slice(0, -1) : c.slice(1)
    else joinGapsM.push(gap)
    line = atStart ? [...c, ...line] : [...line, ...c]
    if (atStart) parts.unshift(part)
    else parts.push(part)
  }
  // Run the road up its recorded stations when the source gives them.
  const first = parts[0].roadEvidence?.segmentStartStation,
    last = parts.at(-1)!.roadEvidence?.segmentStartStation
  if (parts.length > 1 && first !== undefined && last !== undefined && first > last) {
    line.reverse()
    parts.reverse()
    joinGapsM.reverse()
  }
  return { coordinates: dedupe(line), parts, joinGapsM, partsLeftOut: remaining.length }
}

function dedupe(points: Coordinate[]) {
  return points.filter((p, i) => i === 0 || distance(points[i - 1], p) >= 0.001)
}

/**
 * Thins a mapped line to the vertices the terrain can tell apart: half a cell, 0.5–5 m. A larger
 * tolerance is used only when the line would not otherwise fit `maxPoints`.
 */
export function thinMappedRoad(
  coordinates: Coordinate[],
  terrainResolutionM: number,
  maxPoints: number,
): { coordinates: Coordinate[]; toleranceM: number } {
  let toleranceM = Math.min(MAX_THINNING_M, Math.max(MIN_THINNING_M, terrainResolutionM / 2))
  let thinned = dedupe(simplifyPath(coordinates, toleranceM))
  while (thinned.length > maxPoints && toleranceM < 1000) {
    toleranceM *= 2
    thinned = dedupe(simplifyPath(coordinates, toleranceM))
  }
  return { coordinates: thinned, toleranceM }
}

/** The as-mapped road: horizontal points from the record, no vertical controls, no curves. */
export function mappedRoadAlignment({
  seed,
  context,
  id,
  template,
  terrainResolutionM,
  pointBudget,
}: {
  seed: ContextFeature
  context: readonly ContextFeature[]
  id: string
  template: Alignment['template']
  terrainResolutionM: number
  /** Horizontal points the project can still hold. */
  pointBudget: number
}): Alignment {
  const joined = joinMappedRoad(seed, context)
  if (pointBudget < 2) throw Error('This project holds its maximum of horizontal points. Remove a road first.')
  const sourceVertexCount = joined.coordinates.length
  const { coordinates, toleranceM } = thinMappedRoad(joined.coordinates, terrainResolutionM, pointBudget)
  if (coordinates.length < 2) throw Error('This mapped road has no length to load.')
  const evidence = seed.roadEvidence
  const origin: MappedRoadOrigin = {
    source: evidence?.source ?? 'user',
    roadName: seed.name,
    contextIds: joined.parts.map((part) => part.id),
    sourceIds: [...new Set(joined.parts.map((part) => part.roadEvidence?.sourceId).filter((x): x is string => !!x))],
    ...(evidence?.forestFileId ? { forestFileId: evidence.forestFileId } : {}),
    ...(evidence?.roadSectionId ? { roadSectionId: evidence.roadSectionId } : {}),
    sourceVertexCount,
    thinningToleranceM: Math.round(toleranceM * 100) / 100,
    joinGapsM: joined.joinGapsM.map((gap) => Math.round(gap * 10) / 10),
    partsLeftOut: joined.partsLeftOut,
  }
  return {
    id,
    name: `${seed.name} · as mapped`,
    color: MAPPED_ROAD_COLOR,
    points: coordinates.map((coordinate, index) => ({ id: `${id}-p${index}`, coordinate, radiusM: 0 })),
    vertical: [],
    template: { ...template },
    overrides: [],
    mappedRoad: origin,
  }
}

export const MAPPED_ROAD_COLOR = '#7c3aed'
/** The base name for a road derived from `alignment`; a derived road is never itself "as mapped". */
export const derivedRoadName = (alignment: Pick<Alignment, 'name' | 'mappedRoad'>) =>
  alignment.mappedRoad ? `${alignment.mappedRoad.roadName} alternative` : alignment.name
export const isMappedRoad = (alignment: Pick<Alignment, 'mappedRoad'> | undefined) => !!alignment?.mappedRoad

/** An editable proposal on the mapped road's line: same points, no record attached. */
export function designFromMappedRoad(alignment: Alignment, id: string, color: string): Alignment {
  const { mappedRoad, ...rest } = alignment
  return {
    ...rest,
    id,
    name: `Design on ${mappedRoad?.roadName ?? alignment.name}`,
    color,
    points: alignment.points.map((point, index) => ({ ...point, id: `${id}-p${index}` })),
  }
}

export interface MappedRoadReview {
  lengthM: number
  /** Share of stations with ground under them. */
  terrainCoveragePercent: number
  coarseTerrain: boolean
  /** Steepest grade sustained over SUSTAINED_GRADE_WINDOW_M, signed up-station. */
  steepest: { chainage: number; gradePercent: number } | null
  /** Road length whose sustained grade exceeds the project's grade limit. */
  overLimitM: number
  overLimitRanges: { start: number; end: number; maxGradePercent: number }[]
  /** Tightest bend read at BEND_CHORD_M chords, and road length tighter than the minimum radius. */
  tightestBend: { chainage: number; radiusM: number } | null
  belowMinRadiusM: number
  streamCrossings: number
}

/** Grades and bends of a road as mapped, against the project's own grade and radius limits. */
export function reviewMappedRoad(analysis: RoadAnalysis, settings: RoadSettings, terrainResolutionM: number) {
  const stations = analysis.stations
  const covered = stations.filter((s) => s.groundElevation !== null).length
  const review: MappedRoadReview = {
    lengthM: analysis.length,
    terrainCoveragePercent: stations.length ? (covered / stations.length) * 100 : 0,
    coarseTerrain: terrainResolutionM > COARSE_TERRAIN_M,
    steepest: null,
    overLimitM: 0,
    overLimitRanges: [],
    tightestBend: null,
    belowMinRadiusM: 0,
    streamCrossings: analysis.crossings.filter((c) => c.kind === 'stream').length,
  }
  if (stations.length < 2) return review
  const half = SUSTAINED_GRADE_WINDOW_M / 2
  // Grade at each station: rise between the stations nearest either end of a centred window.
  const sustained = stations.map((s) => {
    const a = nearestWithin(stations, s.chainage - half, s.chainage),
      b = nearestWithin(stations, s.chainage + half, s.chainage)
    if (!a || !b || a.groundElevation === null || b.groundElevation === null) return null
    const run = b.chainage - a.chainage
    return run >= Math.min(half, analysis.length / 2) ? ((b.groundElevation - a.groundElevation) / run) * 100 : null
  })
  let open: { start: number; end: number; maxGradePercent: number } | null = null
  for (let i = 0; i < stations.length; i++) {
    const grade = sustained[i]
    if (grade !== null && (!review.steepest || Math.abs(grade) > Math.abs(review.steepest.gradePercent)))
      review.steepest = { chainage: stations[i].chainage, gradePercent: grade }
    const over = grade !== null && Math.abs(grade) > settings.maxGradePercent + 1e-9
    if (i > 0) {
      const ds = stations[i].chainage - stations[i - 1].chainage
      const prevOver = sustained[i - 1] !== null && Math.abs(sustained[i - 1]!) > settings.maxGradePercent + 1e-9
      review.overLimitM += ((over ? 1 : 0) + (prevOver ? 1 : 0)) * (ds / 2)
    }
    if (over) {
      if (!open) open = { start: stations[i].chainage, end: stations[i].chainage, maxGradePercent: 0 }
      open.end = stations[i].chainage
      open.maxGradePercent = Math.max(open.maxGradePercent, Math.abs(grade))
    } else if (open) {
      review.overLimitRanges.push(open)
      open = null
    }
  }
  if (open) review.overLimitRanges.push(open)
  // Bends: circumradius through the stations a chord either side.
  const radii = stations.map((s) => {
    const a = nearestWithin(stations, s.chainage - BEND_CHORD_M, s.chainage),
      b = nearestWithin(stations, s.chainage + BEND_CHORD_M, s.chainage)
    if (!a || !b || a === s || b === s) return null
    if (s.chainage - a.chainage < BEND_CHORD_M / 2 || b.chainage - s.chainage < BEND_CHORD_M / 2) return null
    return circumradius(a.coordinate, s.coordinate, b.coordinate)
  })
  for (let i = 0; i < stations.length; i++) {
    const r = radii[i]
    if (r !== null && Number.isFinite(r) && (!review.tightestBend || r < review.tightestBend.radiusM))
      review.tightestBend = { chainage: stations[i].chainage, radiusM: r }
    if (i > 0 && settings.minRadius > 0) {
      const ds = stations[i].chainage - stations[i - 1].chainage
      const tight = (x: number | null) => (x !== null && x < settings.minRadius ? 1 : 0)
      review.belowMinRadiusM += (tight(r) + tight(radii[i - 1])) * (ds / 2)
    }
  }
  return review
}

/** The station nearest `target`, never crossing to the other side of `from`. */
function nearestWithin<T extends { chainage: number }>(stations: readonly T[], target: number, from: number) {
  let best: T | null = null
  for (const s of stations) {
    if ((target < from && s.chainage > from) || (target > from && s.chainage < from)) continue
    if (!best || Math.abs(s.chainage - target) < Math.abs(best.chainage - target)) best = s
  }
  return best
}

function circumradius(a: Coordinate, b: Coordinate, c: Coordinate) {
  const kx = Math.cos(b[1] * RAD) * RAD * EARTH_M,
    ky = RAD * EARTH_M
  const p = (q: Coordinate) => [(q[0] - b[0]) * kx, (q[1] - b[1]) * ky]
  const [ax, ay] = p(a),
    [cx, cy] = p(c)
  const ab = Math.hypot(ax, ay),
    bc = Math.hypot(cx, cy),
    ca = Math.hypot(cx - ax, cy - ay)
  const cross = Math.abs(ax * cy - ay * cx)
  return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross)
}

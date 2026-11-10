/**
 * Landing and decking site screen: places along the roads near a block, and at their ends, where a
 * rectangular landing of the entered size sits on ground flat enough to deck logs on. It reads the
 * same ground-trend grid as the skid reach model.
 *
 * A candidate is a footprint to look at in the field, not a landing design: nothing is levelled,
 * no section or earthwork is computed, and a road end gets no turnaround designed. The footprint is
 * reported as a polygon; the skid reach panel says whether the road's design vehicle can loop round
 * inside it at its steering lock (`turningTemplate.ts`).
 *
 * Pure: takes the prepared grid and constraints as arguments; no DOM or network access.
 */
import { resolveConstraint } from './constraints'
import type { ProjectedRoad, SkidGrid } from './skidReach'
import type { ContextFeature, Coordinate } from './types'

type XY = [number, number]

export interface LandingScreenOptions {
  /** Largest mean ground slope over the footprint, percent. */
  maxMeanSlopePercent: number
  /** Footprint across the road, m. */
  widthM: number
  /** Footprint along the road, m. */
  lengthM: number
  /** Candidates closer than this to a better one are dropped, m. */
  minSeparationM: number
  maxCandidates: number
}
export const DEFAULT_LANDING_OPTIONS: LandingScreenOptions = {
  maxMeanSlopePercent: 8,
  widthM: 30,
  lengthM: 40,
  minSeparationM: 100,
  maxCandidates: 8,
}
/** Road positions tried, every this many metres along each road near the block. */
export const LANDING_SAMPLE_SPACING_M = 20
/** Ground read inside a footprint on a lattice this fine, m. */
export const LANDING_LATTICE_M = 5
/** A landing beside the road starts this far from the centreline: half a single-lane road. */
export const LANDING_ROAD_HALF_WIDTH_M = 3
export const MAX_LANDING_FOOTPRINT_M = 200
export const MAX_LANDING_CANDIDATES = 20

export interface LandingCandidate {
  id: string
  rank: number
  /** Footprint centre and its closed outline. */
  centre: Coordinate
  footprint: Coordinate[]
  placement: 'road-end' | 'beside-road'
  roadId: string
  roadName: string
  meanSlopePercent: number
  maxSlopePercent: number
  insideBlock: boolean
}
export interface LandingScreen {
  candidates: LandingCandidate[]
  /** Footprints passed over because part of their ground is missing. */
  unknownGround: number
  /** Footprints passed over because they touch a stream or a blocked area. */
  conflicts: number
  tried: number
}

export function validateLandingOptions(options: LandingScreenOptions): LandingScreenOptions {
  const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  if (!inRange(options.maxMeanSlopePercent, 0.5, 50)) throw Error('Use a landing slope limit from 0.5% to 50%.')
  if (!inRange(options.widthM, 5, MAX_LANDING_FOOTPRINT_M) || !inRange(options.lengthM, 5, MAX_LANDING_FOOTPRINT_M))
    throw Error(`Use a landing footprint from 5 to ${MAX_LANDING_FOOTPRINT_M} m each way.`)
  if (!inRange(options.minSeparationM, 0, 2000)) throw Error('Use a landing separation from 0 to 2,000 m.')
  if (!Number.isInteger(options.maxCandidates) || !inRange(options.maxCandidates, 1, MAX_LANDING_CANDIDATES))
    throw Error(`List 1–${MAX_LANDING_CANDIDATES} landing candidates.`)
  return options
}

const segmentsCross = (a: XY, b: XY, c: XY, d: XY) => {
  const orient = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return orient(a, b, c) > 0 !== orient(a, b, d) > 0 && orient(c, d, a) > 0 !== orient(c, d, b) > 0
}
const inRing = (p: XY, ring: readonly XY[]) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i],
      [bx, by] = ring[j]
    if (ay > p[1] !== by > p[1] && p[0] < ((bx - ax) * (p[1] - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

/**
 * Screens landing footprints along `roads` (and at their ends) inside the skid grid's block band,
 * keeps those whose mean ground slope is within the limit, and ranks them flattest first.
 */
export function screenLandingSites(
  sg: SkidGrid,
  roads: readonly ProjectedRoad[],
  context: readonly ContextFeature[],
  input: LandingScreenOptions = DEFAULT_LANDING_OPTIONS,
): LandingScreen {
  const options = validateLandingOptions(input)
  const { grid, slopePercent } = sg
  const streams = context
    .filter((feature) => feature.kind === 'stream' && feature.geometry.type === 'LineString')
    .map((feature) => (feature.geometry as GeoJSON.LineString).coordinates.map((c) => sg.toGrid([c[0], c[1]])))
  const blocked = context
    .filter(
      (feature) =>
        feature.kind === 'avoid' && feature.geometry.type === 'Polygon' && resolveConstraint(feature).blocked,
    )
    .map((feature) => (feature.geometry as GeoJSON.Polygon).coordinates[0].map((c) => sg.toGrid([c[0], c[1]])))
  const cellAt = (p: XY) => {
    const col = Math.round((p[0] - grid.origin[0]) / grid.cellM),
      row = Math.round((grid.origin[1] - p[1]) / grid.cellM)
    return col >= 0 && row >= 0 && col < grid.width && row < grid.height ? row * grid.width + col : -1
  }
  const nearBlock = (p: XY) => {
    const i = cellAt(p)
    return i >= 0 && sg.travel[i] === 1
  }
  type Raw = Omit<LandingCandidate, 'id' | 'rank'> & { xy: XY }
  const found: Raw[] = []
  let unknownGround = 0,
    conflicts = 0,
    tried = 0
  /** A footprint `along` × `across` m centred at `c`, its long side on bearing unit `u`. */
  const consider = (c: XY, u: XY, placement: Raw['placement'], road: ProjectedRoad) => {
    tried++
    const v: XY = [-u[1], u[0]]
    const halfL = options.lengthM / 2,
      halfW = options.widthM / 2
    const corners: XY[] = [
      [c[0] - u[0] * halfL - v[0] * halfW, c[1] - u[1] * halfL - v[1] * halfW],
      [c[0] + u[0] * halfL - v[0] * halfW, c[1] + u[1] * halfL - v[1] * halfW],
      [c[0] + u[0] * halfL + v[0] * halfW, c[1] + u[1] * halfL + v[1] * halfW],
      [c[0] - u[0] * halfL + v[0] * halfW, c[1] - u[1] * halfL + v[1] * halfW],
    ]
    const nL = Math.max(1, Math.round(options.lengthM / LANDING_LATTICE_M)),
      nW = Math.max(1, Math.round(options.widthM / LANDING_LATTICE_M))
    let sum = 0,
      count = 0,
      max = 0,
      missing = false,
      inBlock = false
    for (let i = 0; i <= nL && !missing; i++)
      for (let j = 0; j <= nW; j++) {
        const a = -halfL + (options.lengthM * i) / nL,
          b = -halfW + (options.widthM * j) / nW
        const p: XY = [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b]
        const cell = cellAt(p)
        const slope = cell < 0 ? NaN : slopePercent[cell]
        if (!Number.isFinite(slope)) {
          missing = true
          break
        }
        if (blocked.some((ring) => inRing(p, ring))) {
          conflicts++
          return
        }
        if (sg.block[cell]) inBlock = true
        sum += slope
        max = Math.max(max, slope)
        count++
      }
    if (missing) {
      unknownGround++
      return
    }
    const ring = [...corners, corners[0]]
    if (
      streams.some((stream) =>
        stream.some((q, k) => k > 0 && ring.some((p, m) => m > 0 && segmentsCross(ring[m - 1], p, stream[k - 1], q))),
      )
    ) {
      conflicts++
      return
    }
    const mean = sum / count
    if (mean > options.maxMeanSlopePercent) return
    found.push({
      xy: c,
      centre: sg.toLonLat(c),
      footprint: ring.map((p) => sg.toLonLat(p)),
      placement,
      roadId: road.road.id,
      roadName: road.road.name,
      meanSlopePercent: mean,
      maxSlopePercent: max,
      insideBlock: inBlock,
    })
  }
  for (const road of roads) {
    const line = road.xy
    if (line.length < 2) continue
    // Road ends: the landing straddles the end, along the road's last direction.
    for (const [end, previous] of [
      [line.at(-1)!, line.at(-2)!],
      [line[0], line[1]],
    ] as [XY, XY][]) {
      const d = Math.hypot(end[0] - previous[0], end[1] - previous[1])
      if (d > 0 && nearBlock(end))
        consider(end, [(end[0] - previous[0]) / d, (end[1] - previous[1]) / d], 'road-end', road)
    }
    // Beside the road, on both sides, every LANDING_SAMPLE_SPACING_M.
    let carried = 0
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i]
      const d = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (!d) continue
      const u: XY = [(b[0] - a[0]) / d, (b[1] - a[1]) / d]
      for (let s = carried; s < d; s += LANDING_SAMPLE_SPACING_M) {
        const p: XY = [a[0] + u[0] * s, a[1] + u[1] * s]
        if (!nearBlock(p)) continue
        const off = LANDING_ROAD_HALF_WIDTH_M + options.widthM / 2
        for (const side of [1, -1])
          consider([p[0] - u[1] * off * side, p[1] + u[0] * off * side], u, 'beside-road', road)
      }
      carried = (((carried - d) % LANDING_SAMPLE_SPACING_M) + LANDING_SAMPLE_SPACING_M) % LANDING_SAMPLE_SPACING_M
    }
  }
  // Flattest first; road ends before roadside places at equal slope; then spaced apart.
  found.sort(
    (a, b) =>
      a.meanSlopePercent - b.meanSlopePercent ||
      Number(b.placement === 'road-end') - Number(a.placement === 'road-end') ||
      a.maxSlopePercent - b.maxSlopePercent,
  )
  const kept: Raw[] = []
  for (const candidate of found) {
    if (kept.length >= options.maxCandidates) break
    if (kept.every((k) => Math.hypot(k.xy[0] - candidate.xy[0], k.xy[1] - candidate.xy[1]) >= options.minSeparationM))
      kept.push(candidate)
  }
  return {
    candidates: kept.map(({ xy: _xy, ...candidate }, i) => ({ ...candidate, id: `landing-${i + 1}`, rank: i + 1 })),
    unknownGround,
    conflicts,
    tried,
  }
}

/** Plan features for landing candidates: each footprint as a closed outline. */
export function landingMapFeatures(screen: LandingScreen): GeoJSON.Feature<GeoJSON.LineString>[] {
  return screen.candidates.map((candidate) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: candidate.footprint },
    properties: {
      kind: 'landing-candidate',
      color: '#0891b2',
      label: `Landing ${candidate.rank} · ${candidate.meanSlopePercent.toFixed(1)}%`,
    },
  }))
}

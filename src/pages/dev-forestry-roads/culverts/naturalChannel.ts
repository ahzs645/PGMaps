/**
 * A natural-channel reading at a stream crossing: a cross-section of the existing ground sampled
 * square to the stream a short way upstream of the road, and from it a **candidate** bankfull
 * width, depth and area, with the screens built on them.
 *
 * Everything here is a candidate for a reviewer. Nothing is written to a stream or a culvert, no
 * riparian class is decided, and no fish-passage status is given: a reviewer's click on **Use**
 * is the only way a width read here reaches a stream's `channelWidthM`.
 *
 * Methods, from the published sources (route A; no plugin code was read):
 * - Bankfull is the lowest stage at which the waterline spreads onto a bench: the first peak of
 *   Riley's bench index, the change of top width per unit rise of stage (Riley, S.J. 1972, "A
 *   comparison of morphometric measures of bankfull", J. Hydrology 17: 23-31). The width-to-depth
 *   ratio's minimum (Wolman, M.G. 1955, USGS Prof. Paper 271) is reported beside it as a second
 *   indicator, never in its place.
 * - The opening check is the Engineering Manual's high-water estimation method for stream culverts:
 *   the high-water (mean annual flood) cross-section times three gives the Q100 opening, for
 *   non-major stream culverts only (BC Ministry of Forests Engineering Manual, rev. 1 Aug 2018,
 *   s. 3.6.7, p. 79, Figure 3-4).
 * - The width screen is the stream width ratio, channel width ÷ culvert width, of BC Ministry of
 *   Environment (2011) "Field Assessment for Determining Fish Passage Status of Closed Bottom
 *   Structures", 4th ed.: under 1.0 low (0 points), 1.0 to 1.3 moderate (3), over 1.3 high (6).
 *   The ratio's definition and the 1.2 → 3 example are from Thompson (MoE), "Assessing Fish Passage
 *   at Culverts"; the band edges are from a secondary listing of the 2011 table (confirm them
 *   against the protocol's own table before relying on the score).
 *
 * Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'
import type { Coordinate, Crossing, TerrainSource } from '../types'
import type { CulvertCheckResult } from './culvertChecks'
import { barrelOpeningArea, culvertBarrels, culvertPurposeOf, culvertShapeOf, culvertSpanM } from './culvertShape'

/** Every stated distance and threshold of the reading, in ground metres. */
export const NATURAL_CHANNEL = {
  /** Section half-width either side of the stream line. */
  halfWidthM: 20,
  /** Distance upstream of the crossing, along the stream line, so road fill is not read as channel. */
  upstreamM: 20,
  /** Half-width of the window around the stream line that the thalweg is looked for in. */
  thalwegSearchM: 8,
  /** Samples within this of the lowest are tied for the thalweg. */
  thalwegTieM: 0.03,
  /** Stage ladder step. */
  stageStepM: 0.05,
  /** The ladder stops this far above the thalweg. */
  maxDepthM: 4,
  /** No bench is accepted below this depth: about a LiDAR ground model's vertical noise. */
  minBankfullDepthM: 0.15,
  /**
   * A bench: top width growing at least this many metres per metre of rise, i.e. ground flatter than
   * 1 in 10 on each side on average.
   */
  benchIndexMin: 20,
  /** …and at least this many times the median index of the stages below it. */
  benchIndexFactor: 3,
  /** Consecutive samples within this of the thalweg elevation read as level. */
  levelToleranceM: 0.01,
  /** A level run this wide (and of at least `levelRunMinSamples` samples) is flagged. */
  levelRunMinM: 2,
  levelRunMinSamples: 3,
  /** A channel narrower than this many cells is too coarse to read. */
  coarseCellsAcross: 4,
  /** Cells coarser than this are named as too coarse for small streams when no bench is found. */
  coarseCellM: 2,
  /** Section samples are capped; the spacing widens rather than exceed it. */
  maxSamples: 401,
} as const

const EARTH_RADIUS_M = 6371008.8
const RAD = Math.PI / 180

/** A local metre frame around `origin` (equirectangular; sections are tens of metres). */
function localFrame(origin: Coordinate) {
  const kx = Math.cos(origin[1] * RAD) * EARTH_RADIUS_M * RAD,
    ky = EARTH_RADIUS_M * RAD
  return {
    toXY: (p: Coordinate): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLngLat: (x: number, y: number): Coordinate => [origin[0] + x / kx, origin[1] + y / ky],
  }
}

const finiteOrNull = (value: number): number | null => (Number.isFinite(value) ? value : null)

export interface ChannelSample {
  /** Metres from the stream line; negative is the left bank looking downstream. */
  offsetM: number
  /** Null where the terrain has no ground: a gap stays unknown. */
  elevationM: number | null
}

export interface ChannelSection {
  centre: Coordinate
  /** Bearing the stream flows toward at the section, degrees clockwise from north. */
  downstreamBearingDeg: number
  spacingM: number
  /** The terrain's cell (or point spacing) the section was read at. */
  cellSizeM: number
  samples: ChannelSample[]
}

export interface SectionInput {
  terrain: TerrainSource
  centre: Coordinate
  downstreamBearingDeg: number
  /** The terrain's cell size or median point spacing, m (`terrainResolution`). */
  cellSizeM: number
  /** Requested spacing; never finer than the cell. Default: the cell. */
  spacingM?: number
  halfWidthM?: number
}

/**
 * Samples a straight section square to the stream, at the terrain's own resolution or coarser,
 * never finer: a finer step only repeats the interpolation between the same cells.
 */
export function sampleChannelSection(input: SectionInput): ChannelSection {
  const { terrain, centre, downstreamBearingDeg, cellSizeM } = input
  if (!(cellSizeM > 0)) throw new Error('The terrain cell size must be positive')
  const halfWidth = input.halfWidthM ?? NATURAL_CHANNEL.halfWidthM
  let spacing = Math.max(input.spacingM ?? cellSizeM, cellSizeM)
  spacing = Math.max(spacing, (2 * halfWidth) / (NATURAL_CHANNEL.maxSamples - 1))
  const n = Math.floor(halfWidth / spacing + 1e-9)
  const frame = localFrame(centre)
  // Right of downstream is the bearing + 90°.
  const across = (downstreamBearingDeg + 90) * RAD
  const ux = Math.sin(across),
    uy = Math.cos(across)
  const samples: ChannelSample[] = []
  for (let k = -n; k <= n; k++) {
    const offsetM = k * spacing
    const [lng, lat] = frame.toLngLat(ux * offsetM, uy * offsetM)
    samples.push({ offsetM, elevationM: finiteOrNull(terrain.elevationAt(lng, lat)) })
  }
  return { centre, downstreamBearingDeg, spacingM: spacing, cellSizeM, samples }
}

/** Where the section was taken and how its upstream side was decided. */
export interface SectionLocation {
  centre: Coordinate
  downstreamBearingDeg: number
  /** Distance upstream of the crossing actually used, m (less where the line ends sooner). */
  upstreamM: number
  /** `terrain`: the line's end that stands higher; `line-order`: the terrain could not tell. */
  upstreamFrom: 'terrain' | 'line-order'
  note: string
}

/** A point at `along` metres on a polyline in a local frame, and the polyline's length. */
function pointAlong(xy: Array<[number, number]>, along: number): [number, number] {
  if (along <= 0) return xy[0]
  let walked = 0
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1],
      [bx, by] = xy[i]
    const len = Math.hypot(bx - ax, by - ay)
    if (walked + len >= along && len > 0) {
      const t = (along - walked) / len
      return [ax + t * (bx - ax), ay + t * (by - ay)]
    }
    walked += len
  }
  return xy[xy.length - 1]
}

const polylineLength = (xy: Array<[number, number]>) =>
  xy.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - xy[i - 1][0], p[1] - xy[i - 1][1]) : 0), 0)

/** The distance along a polyline of the point on it nearest `p`. */
function nearestAlong(xy: Array<[number, number]>, p: [number, number]): number {
  let best = Infinity,
    bestAlong = 0,
    walked = 0
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1],
      [bx, by] = xy[i]
    const dx = bx - ax,
      dy = by - ay,
      len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0
    const d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1])
    if (d < best) {
      best = d
      bestAlong = walked + t * Math.sqrt(len2)
    }
    walked += Math.sqrt(len2)
  }
  return bestAlong
}

/**
 * Chooses where to cut the section for a crossing: `upstreamM` up the stream line from the
 * crossing, the stream's direction there read as a chord over a few cells so a vertex kink does not
 * turn the section. Upstream is the end that stands higher on the terrain; where the terrain cannot
 * tell (a gap, level ground) the line's own order is used and the note says so.
 */
export function locateChannelSection(input: {
  terrain: TerrainSource
  streamLine: Coordinate[]
  crossing: Coordinate
  cellSizeM: number
  upstreamM?: number
}): SectionLocation | null {
  const { terrain, streamLine, crossing, cellSizeM } = input
  if (streamLine.length < 2) return null
  const frame = localFrame(crossing)
  const xy = streamLine.map(frame.toXY)
  const length = polylineLength(xy)
  if (!(length > 0)) return null
  const at = nearestAlong(xy, [0, 0])
  const wanted = input.upstreamM ?? NATURAL_CHANNEL.upstreamM
  const forward = Math.min(length, at + wanted),
    backward = Math.max(0, at - wanted)
  const height = (along: number) => finiteOrNull(terrain.elevationAt(...frame.toLngLat(...pointAlong(xy, along))))
  const ahead = height(forward),
    behind = height(backward)
  let upstreamIsForward: boolean, upstreamFrom: SectionLocation['upstreamFrom']
  if (ahead !== null && behind !== null && Math.abs(ahead - behind) > NATURAL_CHANNEL.levelToleranceM) {
    upstreamIsForward = ahead > behind
    upstreamFrom = 'terrain'
  } else {
    upstreamIsForward = true
    upstreamFrom = 'line-order'
  }
  const along = upstreamIsForward ? forward : backward
  const usedM = Math.abs(along - at)
  const chord = Math.max(5, 2 * cellSizeM)
  // Downstream runs from the upstream side toward the crossing.
  const up = pointAlong(xy, upstreamIsForward ? Math.min(length, along + chord) : Math.max(0, along - chord))
  const down = pointAlong(xy, upstreamIsForward ? Math.max(0, along - chord) : Math.min(length, along + chord))
  const bearing = (Math.atan2(down[0] - up[0], down[1] - up[1]) / RAD + 360) % 360
  const centre = frame.toLngLat(...pointAlong(xy, along))
  const note =
    (upstreamFrom === 'terrain'
      ? `${trim(usedM, 1)} m upstream of the crossing (upstream is the higher end of the stream line)`
      : `${trim(usedM, 1)} m from the crossing toward the stream line's end: the terrain could not tell which way is upstream`) +
    (usedM < wanted - 0.5 ? `; the line ends ${trim(usedM, 1)} m from the crossing` : '')
  return { centre, downstreamBearingDeg: bearing, upstreamM: usedM, upstreamFrom, note }
}

export type ChannelFlagId = 'coarse' | 'level-bed' | 'gap' | 'thalweg-at-edge' | 'no-bench' | 'indicators-differ'

export interface ChannelFlag {
  id: ChannelFlagId
  text: string
}

export interface BankfullReading {
  /** `read` when a bench was found; otherwise every figure is null and `reason` says why. */
  state: 'read' | 'not-read'
  reason?: string
  widthM: number | null
  /** Area ÷ top width. */
  meanDepthM: number | null
  /** Bankfull stage − thalweg. */
  maxDepthM: number | null
  areaM2: number | null
  stageM: number | null
  leftBankOffsetM: number | null
  rightBankOffsetM: number | null
  /** Top width over mean depth at bankfull (Wolman's ratio). */
  widthDepthRatio: number | null
  /** Riley's bench index at the step above bankfull, m of width per m of rise. */
  benchIndex: number | null
  thalweg: { offsetM: number; elevationM: number; how: string } | null
  /**
   * The bed may be a water surface or a flattened DEM: depth and area are then lower bounds, and a
   * check passing on them is not a pass.
   */
  lowerBound: boolean
  /** False when the reading must not be offered as a width (not read, or the terrain too coarse). */
  usable: boolean
  flags: ChannelFlag[]
  method: string
  section: ChannelSection
}

export const BANKFULL_METHOD =
  'Bankfull at the first bench: the lowest stage where top width grows at least 20 m per m of rise and 3 times the median below (Riley 1972 bench index); width-to-depth minimum (Wolman 1955) reported beside it'

const trim = (value: number, digits = 2) => String(Number(value.toFixed(digits)))

interface Wetted {
  ok: true
  left: number
  right: number
  width: number
  area: number
}
interface Blocked {
  ok: false
  why: 'gap' | 'end'
  offsetM: number
}

/** The wetted region connected to the thalweg at `stage`: pockets past ground above it are dry. */
function wettedAt(samples: ChannelSample[], thalweg: number, stage: number): Wetted | Blocked {
  const z = (i: number) => samples[i].elevationM
  let lo = thalweg,
    hi = thalweg
  while (true) {
    if (lo === 0) return { ok: false, why: 'end', offsetM: samples[0].offsetM }
    const next = z(lo - 1)
    if (next === null) return { ok: false, why: 'gap', offsetM: samples[lo - 1].offsetM }
    if (next >= stage) break
    lo--
  }
  while (true) {
    if (hi === samples.length - 1) return { ok: false, why: 'end', offsetM: samples[hi].offsetM }
    const next = z(hi + 1)
    if (next === null) return { ok: false, why: 'gap', offsetM: samples[hi + 1].offsetM }
    if (next >= stage) break
    hi++
  }
  const cross = (wet: number, dry: number) => {
    const zw = z(wet)!,
      zd = z(dry)!
    const t = zd === zw ? 0 : (stage - zw) / (zd - zw)
    return samples[wet].offsetM + t * (samples[dry].offsetM - samples[wet].offsetM)
  }
  const left = cross(lo, lo - 1),
    right = cross(hi, hi + 1)
  // Area: trapezoids between wet samples, triangles out to the two waterline crossings.
  let area = 0
  for (let i = lo; i < hi; i++)
    area += ((stage - z(i)! + (stage - z(i + 1)!)) / 2) * (samples[i + 1].offsetM - samples[i].offsetM)
  area += ((stage - z(lo)!) / 2) * (samples[lo].offsetM - left)
  area += ((stage - z(hi)!) / 2) * (right - samples[hi].offsetM)
  return { ok: true, left, right, width: right - left, area }
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Picks the thalweg near the stream line: never simply the first lowest sample. */
function chooseThalweg(section: ChannelSection): { index: number; how: string; atEdge: boolean } | null {
  const { samples } = section
  const window = samples
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Math.abs(s.offsetM) <= NATURAL_CHANNEL.thalwegSearchM + 1e-9 && s.elevationM !== null)
  if (!window.length) return null
  const lowest = Math.min(...window.map(({ s }) => s.elevationM!))
  const tied = new Set(window.filter(({ s }) => s.elevationM! <= lowest + NATURAL_CHANNEL.thalwegTieM).map((w) => w.i))
  // Contiguous runs of tied samples.
  const runs: number[][] = []
  for (const { i } of window)
    if (tied.has(i)) {
      const last = runs[runs.length - 1]
      if (last && last[last.length - 1] === i - 1) last.push(i)
      else runs.push([i])
    }
  const distance = (run: number[]) => Math.min(...run.map((i) => Math.abs(samples[i].offsetM)))
  runs.sort((a, b) => distance(a) - distance(b) || b.length - a.length)
  const run = runs[0]
  // The run's lowest sample, ties to the run's middle.
  const mid = (run[0] + run[run.length - 1]) / 2
  const index = run.reduce((best, i) => {
    const zi = samples[i].elevationM!,
      zb = samples[best].elevationM!
    return zi < zb - 1e-9 || (Math.abs(zi - zb) <= 1e-9 && Math.abs(i - mid) < Math.abs(best - mid)) ? i : best
  }, run[0])
  const first = window[0].i,
    last = window[window.length - 1].i
  const lower = (i: number) => {
    const z = samples[i]?.elevationM
    return z !== null && z !== undefined && z < samples[index].elevationM!
  }
  const atEdge = (run.includes(first) && lower(first - 1)) || (run.includes(last) && lower(last + 1))
  const how =
    `Lowest ground within ±${NATURAL_CHANNEL.thalwegSearchM} m of the stream line` +
    (tied.size > 1
      ? `; ${tied.size} samples within ${trim(NATURAL_CHANNEL.thalwegTieM * 100, 0)} cm of it in ${runs.length} run${runs.length === 1 ? '' : 's'}, the run nearest the line taken`
      : '')
  return { index, how, atEdge }
}

/** A level run at the bed: samples about the thalweg within `levelToleranceM` of it. */
function levelRunAt(section: ChannelSection, thalweg: number): { widthM: number; count: number } {
  const { samples } = section
  const z0 = samples[thalweg].elevationM!
  const level = (i: number) => {
    const z = samples[i]?.elevationM
    return z !== null && z !== undefined && Math.abs(z - z0) <= NATURAL_CHANNEL.levelToleranceM
  }
  let lo = thalweg,
    hi = thalweg
  while (level(lo - 1)) lo--
  while (level(hi + 1)) hi++
  return { widthM: samples[hi].offsetM - samples[lo].offsetM, count: hi - lo + 1 }
}

function notRead(section: ChannelSection, reason: string, flags: ChannelFlag[], thalweg: BankfullReading['thalweg']) {
  const coarse = section.cellSizeM > NATURAL_CHANNEL.coarseCellM
  if (coarse && !flags.some((f) => f.id === 'coarse'))
    flags.push({
      id: 'coarse',
      text: `Cells of ${trim(section.cellSizeM)} m are coarser than ${NATURAL_CHANNEL.coarseCellM} m: a small channel does not show at this resolution.`,
    })
  return {
    state: 'not-read',
    reason,
    widthM: null,
    meanDepthM: null,
    maxDepthM: null,
    areaM2: null,
    stageM: null,
    leftBankOffsetM: null,
    rightBankOffsetM: null,
    widthDepthRatio: null,
    benchIndex: null,
    thalweg,
    lowerBound: false,
    usable: false,
    flags,
    method: BANKFULL_METHOD,
    section,
  } satisfies BankfullReading
}

/** Reads a candidate bankfull from a section. Never throws on missing ground: it says why not. */
export function readBankfull(section: ChannelSection): BankfullReading {
  const flags: ChannelFlag[] = []
  const gaps = section.samples.filter((s) => s.elevationM === null).length
  if (gaps)
    flags.push({
      id: 'gap',
      text: `${gaps} of ${section.samples.length} samples have no ground; they are left unknown.`,
    })
  const pick = chooseThalweg(section)
  if (!pick)
    return notRead(section, `No ground within ±${NATURAL_CHANNEL.thalwegSearchM} m of the stream line.`, flags, null)
  const { samples } = section
  const zt = samples[pick.index].elevationM!
  const thalweg = { offsetM: samples[pick.index].offsetM, elevationM: zt, how: pick.how }
  if (pick.atEdge) {
    flags.push({
      id: 'thalweg-at-edge',
      text: `The ground keeps falling past ±${NATURAL_CHANNEL.thalwegSearchM} m: the mapped stream line may be off the channel.`,
    })
    return notRead(
      section,
      'The channel bottom is not within the search window around the stream line.',
      flags,
      thalweg,
    )
  }

  const step = NATURAL_CHANNEL.stageStepM
  const ladder: Array<{ stage: number; depth: number; w: Wetted }> = []
  let blocked: Blocked | null = null
  for (let k = 1; k * step <= NATURAL_CHANNEL.maxDepthM + 1e-9; k++) {
    const stage = zt + k * step
    const w = wettedAt(samples, pick.index, stage)
    if (!w.ok) {
      blocked = w
      break
    }
    ladder.push({ stage, depth: k * step, w })
  }
  // Riley's bench index between successive stages.
  const index = ladder.slice(0, -1).map((l, k) => (ladder[k + 1].w.width - l.w.width) / step)
  let bench = -1
  for (let k = 0; k < index.length; k++) {
    if (ladder[k].depth < NATURAL_CHANNEL.minBankfullDepthM - 1e-9) continue
    const below = index.slice(0, k).filter((_, j) => ladder[j].depth >= step - 1e-9)
    const floor = Math.max(NATURAL_CHANNEL.benchIndexMin, NATURAL_CHANNEL.benchIndexFactor * median(below))
    if (index[k] >= floor) {
      bench = k
      break
    }
  }
  if (bench < 0) {
    const reason = blocked
      ? blocked.why === 'gap'
        ? `The water would reach a gap in the terrain at ${trim(blocked.offsetM, 1)} m before a bench is found.`
        : `The water would run past the section's end (±${trim(NATURAL_CHANNEL.halfWidthM, 0)} m) before a bench is found.`
      : `No bench within ${NATURAL_CHANNEL.maxDepthM} m of the channel bottom.`
    flags.push({ id: 'no-bench', text: reason })
    return notRead(section, reason, flags, thalweg)
  }
  const at = ladder[bench]
  const { width, area, left, right } = at.w
  const meanDepth = area / width
  const ratio = width / meanDepth

  // Wolman's indicator: the stage of least width-to-depth ratio from the minimum depth to a step past the bench.
  const candidates = ladder.slice(0, bench + 2).filter((l) => l.depth >= NATURAL_CHANNEL.minBankfullDepthM - 1e-9)
  const leastRatio = candidates.reduce((best, l) =>
    l.w.width ** 2 / l.w.area < best.w.width ** 2 / best.w.area - 1e-9 ? l : best,
  )
  if (Math.abs(leastRatio.stage - at.stage) > 2 * step + 1e-9)
    flags.push({
      id: 'indicators-differ',
      text: `The width-to-depth ratio is least ${trim(at.stage - leastRatio.stage)} m below the bench: the two indicators disagree, so read the section before using the width.`,
    })

  const level = levelRunAt(section, pick.index)
  const lowerBound = level.count >= NATURAL_CHANNEL.levelRunMinSamples && level.widthM >= NATURAL_CHANNEL.levelRunMinM
  if (lowerBound)
    flags.push({
      id: 'level-bed',
      text: `The channel bottom is level for ${trim(level.widthM, 1)} m (within ${trim(NATURAL_CHANNEL.levelToleranceM * 100, 0)} cm): LiDAR often returns the water surface or a flattened surface there, so depth and area are at least these figures.`,
    })
  const coarse = section.cellSizeM > width / NATURAL_CHANNEL.coarseCellsAcross
  if (coarse)
    flags.push({
      id: 'coarse',
      text: `Cells of ${trim(section.cellSizeM)} m against a ${trim(width, 1)} m channel: fewer than ${NATURAL_CHANNEL.coarseCellsAcross} cells across, too coarse to read this channel.`,
    })
  return {
    state: 'read',
    widthM: width,
    meanDepthM: meanDepth,
    maxDepthM: at.depth,
    areaM2: area,
    stageM: at.stage,
    leftBankOffsetM: left,
    rightBankOffsetM: right,
    widthDepthRatio: ratio,
    benchIndex: index[bench],
    thalweg,
    lowerBound,
    usable: !coarse,
    flags,
    method: BANKFULL_METHOD,
    section,
  }
}

export interface CrossingChannelReading {
  location: SectionLocation
  reading: BankfullReading
}

/** Locates, samples and reads one crossing. Null when the stream line cannot place a section. */
export function readCrossingChannel(input: {
  terrain: TerrainSource
  streamLine: Coordinate[]
  crossing: Coordinate
  cellSizeM: number
  upstreamM?: number
  halfWidthM?: number
}): CrossingChannelReading | null {
  const location = locateChannelSection(input)
  if (!location) return null
  const section = sampleChannelSection({
    terrain: input.terrain,
    centre: location.centre,
    downstreamBearingDeg: location.downstreamBearingDeg,
    cellSizeM: input.cellSizeM,
    halfWidthM: input.halfWidthM,
  })
  return { location, reading: readBankfull(section) }
}

/** The stream crossing a culvert sits at: its own stream's nearest crossing, else the nearest within `withinM`. */
export function crossingForCulvert(
  culvert: Pick<Culvert, 'chainage' | 'sourceFeatureId'>,
  crossings: readonly Crossing[],
  withinM = 15,
): Crossing | null {
  const streams = crossings.filter((c) => c.kind === 'stream')
  const own = culvert.sourceFeatureId ? streams.filter((c) => c.featureId === culvert.sourceFeatureId) : []
  const pool = own.length ? own : streams.filter((c) => Math.abs(c.chainage - culvert.chainage) <= withinM)
  return pool.reduce<Crossing | null>(
    (best, c) =>
      !best || Math.abs(c.chainage - culvert.chainage) < Math.abs(best.chainage - culvert.chainage) ? c : best,
    null,
  )
}

// ---------------------------------------------------------------------------------------------
// Checks. Shaped like `CulvertCheckResult` so `culvertChecks` can list them; each is a screen.

export type NaturalChannelCheckId = 'bankfull-area' | 'stream-width-ratio'
export type NaturalChannelCheckResult = Omit<CulvertCheckResult, 'id'> & { id: NaturalChannelCheckId }

/** EM rev. 2018 s. 3.6.7: the Q100 opening is three times the high-water (mean annual flood) section. */
export const HIGH_WATER_AREA_RULE = {
  factor: 3,
  locator: 'Engineering Manual (rev. 1 Aug 2018) s. 3.6.7, p. 79, Figure 3-4',
} as const

/** BC MoE 2011 stream width ratio bands: channel width ÷ culvert width. */
export const STREAM_WIDTH_RATIO = {
  moderateFrom: 1.0,
  highAbove: 1.3,
  points: { low: 0, moderate: 3, high: 6 },
  locator:
    'BC MoE (2011) Field Assessment for Determining Fish Passage Status of Closed Bottom Structures, stream width ratio',
} as const

export interface BankfullAreaCheckInput {
  culvert: Culvert
  /** The crossing's reading; null when none was taken. */
  reading: BankfullReading | null
  /** `classifyCulvert(...).major`: the method is for non-major culverts only. */
  major?: boolean | null
  /** The crossing record that replaces this culvert's allowance names an embedded culvert. */
  embeddedStructure?: boolean
}

/** Stream culverts only; null for a cross-drain. */
export function bankfullAreaCheck(input: BankfullAreaCheckInput): NaturalChannelCheckResult | null {
  const { culvert, reading } = input
  if (culvertPurposeOf(culvert) !== 'stream') return null
  const base = {
    id: 'bankfull-area' as const,
    label: 'Opening is at least 3 × the candidate bankfull area',
    judgedOn: `High-water method: required opening = ${HIGH_WATER_AREA_RULE.factor} × the high-water cross-section, non-major stream culverts only. The section is read from the terrain, a candidate, not a field measurement`,
    locator: HIGH_WATER_AREA_RULE.locator,
  }
  if (!reading || reading.state !== 'read' || reading.areaM2 === null)
    return { ...base, state: 'not-assessed', result: reading?.reason ?? 'No channel reading at this crossing.' }
  if (!reading.usable)
    return {
      ...base,
      state: 'not-assessed',
      result: reading.flags.find((f) => f.id === 'coarse')?.text ?? 'The channel reading is not usable.',
    }
  const embedded = (culvert.embedmentM ?? 0) > 0 || !!input.embeddedStructure
  if (embedded)
    return {
      ...base,
      state: 'not-assessed',
      result: 'Embedded: the streambed inside the barrel is not deducted from the opening.',
    }
  const opening = barrelOpeningArea(culvert),
    barrels = culvertBarrels(culvert)
  const openingM2 = opening.areaM2 * barrels
  const requiredM2 = HIGH_WATER_AREA_RULE.factor * reading.areaM2
  const openingText = `opening ${trim(openingM2)} m²${barrels > 1 ? ` (${barrels} barrels)` : ''}${opening.approximate ? ' (approximate: no end area entered)' : ''}`
  if (input.major === true)
    return {
      ...base,
      state: 'note',
      result: `A major culvert: the high-water method is not for major culverts or professional designs. For reference, 3 × ${trim(reading.areaM2)} m² = ${trim(requiredM2)} m² against the ${openingText}.`,
    }
  if (reading.lowerBound) {
    if (openingM2 < requiredM2 - 1e-9)
      return {
        ...base,
        state: 'not-met',
        result: `Needs at least ${trim(requiredM2)} m² (3 × at least ${trim(reading.areaM2)} m²; the bed may be a water surface); ${openingText}.`,
      }
    return {
      ...base,
      state: 'not-assessed',
      result: `The bed may be a water surface, so the channel's area is at least ${trim(reading.areaM2)} m² and the requirement at least ${trim(requiredM2)} m²; the ${openingText} clears that floor, but the full requirement is not known.`,
    }
  }
  return {
    ...base,
    state: openingM2 >= requiredM2 - 1e-9 ? 'met' : 'not-met',
    result: `Needs ${trim(requiredM2)} m² (3 × ${trim(reading.areaM2)} m²); ${openingText}.`,
  }
}

/** A channel width with what it rests on. */
export interface ChannelWidthEvidence {
  widthM: number
  /** `recorded`: the stream's own channel width; `terrain`: a candidate read here. */
  source: 'recorded' | 'terrain'
  text: string
}

/**
 * The width the ratio uses: the stream's recorded channel width when there is one (the reviewer's),
 * else a usable terrain candidate, else none.
 */
export function channelWidthEvidence(
  recordedWidthM: number | null | undefined,
  reading: BankfullReading | null,
): ChannelWidthEvidence | null {
  if (recordedWidthM != null && Number.isFinite(recordedWidthM) && recordedWidthM > 0)
    return { widthM: recordedWidthM, source: 'recorded', text: `recorded channel width ${trim(recordedWidthM)} m` }
  if (reading?.state === 'read' && reading.usable && reading.widthM !== null)
    return {
      widthM: reading.widthM,
      source: 'terrain',
      text: `candidate bankfull width ${trim(reading.widthM)} m read from the terrain`,
    }
  return null
}

export interface StreamWidthRatioCheckInput {
  culvert: Culvert
  channel: ChannelWidthEvidence | null
}

/**
 * The stream width ratio: channel width ÷ culvert width (barrels side by side add their widths, as
 * the protocol adds pipes at one outlet level). Stream culverts only; null for a cross-drain. A
 * screen: never a fish-passage status, which needs the protocol's other four measures in the field.
 */
export function streamWidthRatioCheck(input: StreamWidthRatioCheckInput): NaturalChannelCheckResult | null {
  const { culvert, channel } = input
  if (culvertPurposeOf(culvert) !== 'stream') return null
  const base = {
    id: 'stream-width-ratio' as const,
    label: 'Culvert is at least as wide as the channel (stream width ratio under 1.0)',
    judgedOn: `Channel width ÷ culvert width: under ${STREAM_WIDTH_RATIO.moderateFrom} low, ${STREAM_WIDTH_RATIO.moderateFrom} to ${STREAM_WIDTH_RATIO.highAbove} moderate, over ${STREAM_WIDTH_RATIO.highAbove} high. One of five measures of the closed-bottom protocol: a screen, not a fish-passage status`,
    locator: STREAM_WIDTH_RATIO.locator,
  }
  if (culvertShapeOf(culvert) === 'open-bottom-arch')
    return { ...base, state: 'note', result: 'Open-bottom: the closed-bottom protocol does not apply.' }
  if (!channel)
    return { ...base, state: 'not-assessed', result: 'No channel width: none recorded and none read from the terrain.' }
  const barrels = culvertBarrels(culvert)
  const culvertWidth = culvertSpanM(culvert) * barrels
  const ratio = channel.widthM / culvertWidth
  const band =
    ratio < STREAM_WIDTH_RATIO.moderateFrom
      ? ('low' as const)
      : ratio <= STREAM_WIDTH_RATIO.highAbove + 1e-9
        ? ('moderate' as const)
        : ('high' as const)
  return {
    ...base,
    state: band === 'low' ? 'met' : 'not-met',
    result: `Ratio ${trim(ratio)}: ${channel.text} over culvert width ${trim(culvertWidth)} m${barrels > 1 ? ` (${barrels} barrels at one level assumed)` : ''}; ${band} (${STREAM_WIDTH_RATIO.points[band]} points).`,
  }
}

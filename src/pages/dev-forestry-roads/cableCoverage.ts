/**
 * Cable coverage of a harvest block: which ground a skyline yarder can yard, from which lines.
 *
 * 1. **Landings** are cells of the counted truck roads within the travel band around the block,
 *    one every `landingSpacingM` along each road.
 * 2. **Candidate lines** leave each landing at bearings `bearingStepDeg` apart. Each is walked out
 *    over the source terrain and cut, before any mechanics, at the grid edge, unknown ground, a
 *    stream barrier (when streams stop extraction), the usable skyline length (the skyline less a
 *    45° guyline to the anchor, measured as the 3D distance from the landing), too long a run
 *    outside the block, or too much side-slope ground (ground steeper than 30 % crossed more than
 *    30° off the fall line, up to 75 m and 15 % of the line at its end). It may end only inside
 *    the block. The far end is then pulled back until the loaded line (the chord less a parabolic
 *    sag at the allowable tension, with a 10 % margin) is nowhere higher above the ground than the
 *    limit.
 * 3. **The screen** (`crates/cable-layout/src/coverage.rs`, through the worker) finds along each
 *    the longest line that works with at most N supports: the support search's span check (elastic
 *    catenary, clearance, tension) and its final analysis (break angles, lift-off).
 * 4. **Coverage.** Each line yards a band `lateralM` either side of its axis from the landing to
 *    its end; a block cell whose centre lies in it is covered. A cell covered by several lines is
 *    yarded by the one whose axis passes closest to it (then the shorter carriage distance), and
 *    its extraction distance is that line's carriage distance: its distance along the axis.
 *
 * Missing ground stays unknown: a line cut by unknown ground (or the grid edge) cannot be shown to
 * reach further, so block cells in its band out to the usable length that no line covers are
 * reported unknown, never beyond reach.
 *
 * Rules after Sylvaccess 3.6's cable module (Dupire et al. 2015, Revue forestière française 67(2):
 * 111–126; Dupire, Bourrier & Berger 2016, Journal of Forest Research 21(1): 1–14; the INRAE user
 * notice, 2024). Written from a functional specification; no code from Sylvaccess
 * (GPL-3.0-or-later) was used.
 *
 * Pure: terrain and projection are arguments; no DOM or network access.
 */
import {
  anchorDistanceM,
  COVER_BATCH_LINES,
  COVER_LOWEST_TENSION_SHARE,
  COVER_TENSION_LEVELS,
  MAX_COVER_LINES,
  MAX_COVER_SPANS_PER_LINE,
  SIDE_SLOPE_MAX_M,
  SIDE_SLOPE_MAX_SHARE,
  SIDE_SLOPE_OFF_FALL_LINE_DEG,
  SIDE_SLOPE_PERCENT,
  SUPPORT_CLEARANCE_ZONE_M,
  usableSkylineM,
  validateCableRule,
  type CableCoverageRule,
  type CablePosition,
} from './cableCoverageRule'
import { pointsAlong } from './extractionLandings'
import { parabolicLoadSagM, riggingForces, STANDARD_GRAVITY } from './cableMechanics'
import type { CableCoverInput, CoverLineResult, LayoutReason } from './cableLayout/cableLayout'
import { LAYOUT_LOAD_POSITIONS } from './cableLayout/settings'
import type { ExtractionCells, ExtractionGrid } from './extractionReach'
import type { SkidProgress, SkidRoad } from './skidReach'
import type { TerrainSource } from './types'

type XY = [number, number]

/** The settings a coverage run uses besides the rule. */
export interface CableRunOptions {
  /** Stream barriers stop lines (the extraction panel's "Streams stop extraction"). */
  barriersStop: boolean
}

export interface CableLanding {
  cell: number
  xy: XY
  roadIndex: number
  /** On a designed road, or a proposed landing: counted only in the "after" run of a comparison. */
  designed: boolean
  /** The user's landing this start belongs to (index into `ExtractionGrid.landings`), when landings are set. */
  group?: number
  /** Where the yarder may stand on lines from here; the rule's choice when absent. */
  position?: CablePosition
}

/** Why a candidate's walk ended. */
export type CableWalkStop = 'length' | 'grid' | 'unknown' | 'barrier' | 'side-slope' | 'outside-block'

export interface CableCandidate {
  landing: number
  bearingDeg: number
  /** Ground every `dx` m from the landing, out past the farthest tail for its anchor. */
  dx: number
  z: Float64Array
  /** Farthest tail the screen tries (horizontal, m); 0 when the walk left no tail. */
  maxTailM: number
  stop: CableWalkStop
  /** The farthest the line could reach were the ground known (horizontal, m); with a gap only. */
  unknownReachM: number | null
}

/** The source terrain at the extraction grid's cell centres; NaN where unknown. */
export function* cableGroundSteps(eg: ExtractionGrid, terrain: TerrainSource): Generator<SkidProgress, Float64Array> {
  const { width, height, origin, cellM } = eg.sg.grid
  const out = new Float64Array(width * height)
  const xy: XY = [0, 0]
  for (let row = 0; row < height; row++) {
    xy[1] = origin[1] - row * cellM
    for (let col = 0; col < width; col++) {
      xy[0] = origin[0] + col * cellM
      const [lon, lat] = eg.sg.toLonLat(xy)
      const z = terrain.elevationAt(lon, lat)
      out[row * width + col] = Number.isFinite(z) ? z : NaN
    }
    yield { phase: 'Reading the ground under the skylines', done: row + 1, total: height }
  }
  return out
}

/**
 * Landings: truck-road cells within the travel band on known ground, `spacingM` apart along each
 * road. With the user's landings set, only those: a point landing's cell, and a road stretch's cells
 * `spacingM` apart along it, on known ground, each with its yarder side; a proposed landing counts
 * only in the "after" run.
 */
export function cableLandings(
  eg: ExtractionGrid,
  ground: Float64Array,
  include: (road: SkidRoad) => boolean,
  spacingM: number,
): CableLanding[] {
  const { sg } = eg
  const { origin, cellM, width } = sg.grid
  const taken = new Set<number>()
  const out: CableLanding[] = []
  if (eg.landings?.length) {
    eg.landings.forEach((landing, group) => {
      for (const [x, y] of pointsAlong(landing.xy, spacingM)) {
        const cell = cellAt(eg, x, y)
        if (cell < 0 || taken.has(cell) || !Number.isFinite(ground[cell])) continue
        taken.add(cell)
        const row = Math.floor(cell / width),
          col = cell - row * width
        out.push({
          cell,
          xy: [origin[0] + col * cellM, origin[1] - row * cellM],
          roadIndex: sg.sourceRoad[cell],
          designed: landing.status === 'proposed',
          group,
          position: landing.yarder,
        })
      }
    })
    return out
  }
  sg.roads.forEach((road, k) => {
    if (!include(road.road) || road.road.use === 'track') return
    let along = 0
    let next = 0
    for (let i = 1; i < road.xy.length + 1; i++) {
      const a = road.xy[Math.max(0, i - 1)],
        b = road.xy[Math.min(i, road.xy.length - 1)]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      while (next <= along + len + 1e-9) {
        const f = len > 0 ? (next - along) / len : 0
        const x = a[0] + (b[0] - a[0]) * f,
          y = a[1] + (b[1] - a[1]) * f
        const col = Math.round((x - origin[0]) / cellM),
          row = Math.round((origin[1] - y) / cellM)
        next += spacingM
        if (col < 0 || row < 0 || col >= width || row >= sg.grid.height) continue
        const cell = row * width + col
        if (taken.has(cell) || !sg.travel[cell] || !Number.isFinite(ground[cell])) continue
        taken.add(cell)
        out.push({
          cell,
          xy: [origin[0] + col * cellM, origin[1] - row * cellM],
          roadIndex: k,
          designed: road.road.kind === 'design',
        })
      }
      along += len
      if (road.xy.length === 1) break
    }
  })
  return out
}

/** Bilinear ground at a point of the grid; NaN off the grid or next to unknown ground. */
function groundAt(eg: ExtractionGrid, ground: Float64Array, x: number, y: number): number {
  const { origin, cellM, width, height } = eg.sg.grid
  const fc = (x - origin[0]) / cellM,
    fr = (origin[1] - y) / cellM
  if (fc < -1e-9 || fr < -1e-9 || fc > width - 1 + 1e-9 || fr > height - 1 + 1e-9) return NaN
  const c0 = Math.min(Math.max(Math.floor(fc), 0), width - 2),
    r0 = Math.min(Math.max(Math.floor(fr), 0), height - 2)
  const tx = Math.min(Math.max(fc - c0, 0), 1),
    ty = Math.min(Math.max(fr - r0, 0), 1)
  const i = r0 * width + c0
  const a = ground[i],
    b = ground[i + 1],
    c = ground[i + width],
    d = ground[i + width + 1]
  const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty]
  let z = 0
  for (const [v, k] of [
    [a, w[0]],
    [b, w[1]],
    [c, w[2]],
    [d, w[3]],
  ] as const) {
    if (k < 1e-12) continue
    if (!Number.isFinite(v)) return NaN
    z += v * k
  }
  return z
}

const cellAt = (eg: ExtractionGrid, x: number, y: number) => {
  const { origin, cellM, width, height } = eg.sg.grid
  const col = Math.round((x - origin[0]) / cellM),
    row = Math.round((origin[1] - y) / cellM)
  return col < 0 || row < 0 || col >= width || row >= height ? -1 : row * width + col
}

/** Profile sample spacing for a grid, m. */
export const cableSampleSpacingM = (cellM: number) => cellM / 2

/**
 * Walks every landing's bearings out over the ground and cuts each line by the rules before any
 * mechanics (module note, step 2). Lines with no tail left are kept, with `maxTailM` 0, for the
 * unknown-ground report.
 */
export function* cableCandidateSteps(
  eg: ExtractionGrid,
  ground: Float64Array,
  rule: CableCoverageRule,
  landings: readonly CableLanding[],
  options: CableRunOptions,
): Generator<SkidProgress, CableCandidate[]> {
  validateCableRule(rule)
  const bearings = Math.max(1, Math.round(360 / rule.bearingStepDeg))
  if (landings.length * bearings > MAX_COVER_LINES)
    throw Error(
      `${landings.length} landings × ${bearings} bearings is over ${MAX_COVER_LINES.toLocaleString('en-CA')} lines. Space the landings or the bearings further apart.`,
    )
  const { sg } = eg
  const dx = cableSampleSpacingM(sg.grid.cellM)
  const usable = usableSkylineM(rule)
  const anchor = anchorDistanceM(rule)
  const forces = riggingForces(rule.rigging)
  const cosOff = Math.cos((SIDE_SLOPE_OFF_FALL_LINE_DEG * Math.PI) / 180)
  const out: CableCandidate[] = []
  for (let l = 0; l < landings.length; l++) {
    const landing = landings[l]
    const z0 = ground[landing.cell]
    for (let k = 0; k < bearings; k++) {
      const bearingDeg = k * (360 / bearings)
      const sx = Math.sin((bearingDeg * Math.PI) / 180),
        sy = Math.cos((bearingDeg * Math.PI) / 180)
      const z: number[] = [z0]
      let steep = 0,
        outside = 0,
        lastTail = 0,
        stop: CableWalkStop = 'length'
      for (let i = 1; ; i++) {
        const x = i * dx
        const px = landing.xy[0] + sx * x,
          py = landing.xy[1] + sy * x
        const cell = cellAt(eg, px, py)
        if (cell < 0) {
          stop = 'grid'
          break
        }
        const zi = groundAt(eg, ground, px, py)
        if (!Number.isFinite(zi)) {
          stop = 'unknown'
          break
        }
        if (Math.hypot(x, zi - z0) > usable) break
        if (options.barriersStop && sg.barrier[cell]) {
          stop = 'barrier'
          break
        }
        // Side slope: steep ground crossed at or more than the limit off the fall line.
        const gx = eg.gradX[cell],
          gy = eg.gradY[cell]
        const g = Math.hypot(gx, gy)
        if (Number.isFinite(g) && 100 * g > SIDE_SLOPE_PERCENT && Math.abs(gx * sx + gy * sy) / g <= cosOff + 1e-9) {
          steep += dx
          if (steep > SIDE_SLOPE_MAX_M) {
            stop = 'side-slope'
            break
          }
        }
        if (sg.block[cell]) outside = 0
        else if ((outside += dx) > rule.maxOutsideBlockM) {
          stop = 'outside-block'
          break
        }
        z.push(zi)
        if (sg.block[cell] && steep <= SIDE_SLOPE_MAX_SHARE * x + 1e-9) lastTail = x
      }
      // Ground behind the tail for its anchor, where it is known.
      if (stop !== 'grid' && stop !== 'unknown')
        for (let i = z.length; i * dx <= (z.length - 1) * dx + anchor + 1e-9; i++) {
          const zi = groundAt(eg, ground, landing.xy[0] + sx * i * dx, landing.xy[1] + sy * i * dx)
          if (!Number.isFinite(zi)) break
          z.push(zi)
        }
      const maxTailM = trimHeight(z, dx, lastTail, rule, forces)
      const gap = stop === 'unknown' || stop === 'grid'
      out.push({
        landing: l,
        bearingDeg,
        dx,
        z: Float64Array.from(z),
        maxTailM,
        stop,
        unknownReachM: gap ? usable : null,
      })
    }
    yield { phase: 'Laying out candidate lines', done: l + 1, total: landings.length }
  }
  return out
}

/**
 * Pulls the tail in until the loaded line (chord less a parabolic sag at the allowable tension,
 * with Sylvaccess's 10 % margin) is nowhere more than the limit above the ground.
 */
function trimHeight(
  z: readonly number[],
  dx: number,
  tail: number,
  rule: CableCoverageRule,
  forces: ReturnType<typeof riggingForces>,
): number {
  const top0 = z[0] + rule.towerHeightM
  for (let t = Math.round(tail / dx); t > 0; t--) {
    const T = t * dx
    const top = z[t] + rule.tailHeightM
    const chord = Math.hypot(T, top - top0)
    const sag = 1.1 * parabolicLoadSagM(chord, forces.loadN, forces.weightNPerM, forces.allowableN)
    let ok = true
    for (let i = 1; i < t && ok; i++) {
      const u = i / t
      const line = top0 + (top - top0) * u - 4 * sag * u * (1 - u)
      if (line - z[i] > rule.maxHeightAboveGroundM) ok = false
    }
    if (ok) return T
  }
  return 0
}

/** The crate's coverage batches for the candidates that have a tail; `index` maps back. */
export function cableCoverBatches(
  rule: CableCoverageRule,
  cellM: number,
  candidates: readonly CableCandidate[],
  /** The landings the candidates leave from: a landing's own yarder side replaces the rule's. */
  landings?: readonly CableLanding[],
): { batches: CableCoverInput[]; index: number[] } {
  const r = rule.rigging
  const forces = riggingForces(r)
  const kNPerKg = STANDARD_GRAVITY / 1000
  const allowableKN = forces.allowableN / 1000
  const low = allowableKN * COVER_LOWEST_TENSION_SHARE
  const settings: CableCoverInput['settings'] = {
    model: 'catenary',
    startKind: 'yarder',
    endKind: 'support',
    towerHeightM: rule.towerHeightM,
    cableSystem: rule.system,
    trafficableFromStartM: 0,
    trafficableBeforeEndM: 0,
    minClearanceM: r.minClearanceM,
    clearanceFromStartM: SUPPORT_CLEARANCE_ZONE_M,
    clearanceBeforeEndM: SUPPORT_CLEARANCE_ZONE_M,
    zoneClearanceM: 0,
    loadKN: (r.payloadKg + r.carriageKg) * kNPerKg,
    ropeKNPerM: r.ropeMassKgPerM * kNPerKg,
    runningLinesKNPerM: r.runningLinesKgPerM * kNPerKg,
    stiffnessKN: forces.stiffnessN / 1000,
    allowableKN,
    tensionLowKN: low,
    tensionHighKN: allowableKN,
    tensionStepKN: (allowableKN - low) / (COVER_TENSION_LEVELS - 1),
    minSupportSpacingM: rule.minSupportSpacingM,
    candidateSpacingM: cellM,
    minHeightM: rule.supportHeightM,
    maxHeightM: rule.supportHeightM,
    heightStepM: 1,
    builtSupportAboveM: 100,
    liftOffDeg: 1,
    holdDownDeg: 0,
    maxLoadedDeg: rule.maxBreakDeg,
    maxLoadedEndDeg: 90,
    anchorDistanceM: anchorDistanceM(rule),
    anchorReferenceHeightM: rule.tailHeightM,
    minGravityGrade: 0,
    maxSpans: MAX_COVER_SPANS_PER_LINE,
    loadPositions: LAYOUT_LOAD_POSITIONS,
  }
  const index: number[] = []
  const batches: CableCoverInput[] = []
  let lines: CableCoverInput['lines'][number][] = []
  const flush = () => {
    if (!lines.length) return
    batches.push({
      settings,
      tailHeightM: rule.tailHeightM,
      maxSupports: rule.maxSupports,
      tailStepM: cellM,
      // The crate's tails are horizontal; the skyline minimum is checked on the chord afterwards.
      minLengthM: rule.minLineM / Math.SQRT2,
      maxSpansPerLine: MAX_COVER_SPANS_PER_LINE,
      lines,
    })
    lines = []
  }
  candidates.forEach((c, i) => {
    if (!(c.maxTailM * Math.SQRT2 >= rule.minLineM)) return
    const position = landings?.[c.landing]?.position ?? rule.position
    if (rule.system === 'two-cable' || position !== 'either') {
      // Level lines count as machine below; a gravity carriage needs the yarder no lower than the tail.
      const drop = c.z[0] - c.z[Math.round(c.maxTailM / c.dx)]
      if (rule.system === 'two-cable' && drop < 0) return
      if (position === 'above' && !(drop > 1e-6)) return
      if (position === 'below' && drop > 1e-6) return
    }
    index.push(i)
    lines.push({ dx: c.dx, z: c.z, maxTailM: c.maxTailM })
    if (lines.length >= COVER_BATCH_LINES) flush()
  })
  flush()
  return { batches, index }
}

export interface CableLineRecord {
  id: number
  landing: number
  bearingDeg: number
  /** Horizontal length, m. */
  horizontalM: number
  /** Skyline length, the sum of the span chords, m. */
  skylineM: number
  /** Where the yarder stands relative to the tail. */
  configuration: 'above' | 'below'
  designedLanding: boolean
  preTensionKN: number
  /** Yarder, supports and tail: station from the yarder, ground and skyline height, plan position. */
  points: { stationM: number; groundM: number; heightM: number; xy: XY }[]
  /** Block cells it yards (known, fellable, not closed to extraction), and their area. */
  cells: number
  areaHa: number
  meanCarriageM: number
}

export interface CableCoverageResult {
  landings: CableLanding[]
  lines: CableLineRecord[]
  /** Per cell, both runs (strict, optimistic): all landings and existing-road landings only. */
  after: [ExtractionCells, ExtractionCells]
  before: [ExtractionCells, ExtractionCells]
  stats: {
    candidates: number
    screened: number
    /** Candidates no line of the shortest length fits, by why the walk or the screen stopped. */
    rejected: Partial<Record<CableWalkStop | LayoutReason | 'position' | 'budget' | 'short' | 'empty', number>>
    machineAbove: number
    machineBelow: number
    meanSupports: number | null
    meanSkylineM: number | null
  }
}

function emptyCells(n: number): ExtractionCells {
  return {
    method: new Uint8Array(n),
    totalM: new Float32Array(n).fill(NaN),
    forestM: new Float32Array(n).fill(NaN),
    trackM: new Float32Array(n).fill(NaN),
    winchM: new Float32Array(n).fill(NaN),
    reach: new Float64Array(n).fill(Infinity),
    exit: new Int32Array(n).fill(-1),
  }
}

/** Method code for cable cells; equals `M_CABLE` in `extractionReach.ts`. */
const CABLE = 7

/** Cells a line may yard: known block ground, fellable, not closed to extraction. */
export function cableYardable(eg: ExtractionGrid): Uint8Array {
  const { sg } = eg
  const out = new Uint8Array(sg.grid.values.length)
  for (const i of sg.blockCells)
    if (!eg.noExtraction[i] && !eg.unfellable[i] && Number.isFinite(sg.grid.values[i])) out[i] = 1
  return out
}

/**
 * Calls `visit(cell, u, v)` for every grid cell whose centre lies in the band `lateralM` either
 * side of the axis from `from` along `bearingDeg`, at axis distance `u` from 0 to `lengthM` and
 * lateral distance `v` (unsigned).
 */
export function forBandCells(
  eg: ExtractionGrid,
  from: XY,
  bearingDeg: number,
  lengthM: number,
  lateralM: number,
  visit: (cell: number, u: number, v: number) => void,
) {
  const { origin, cellM, width, height } = eg.sg.grid
  const sx = Math.sin((bearingDeg * Math.PI) / 180),
    sy = Math.cos((bearingDeg * Math.PI) / 180)
  const ex = from[0] + sx * lengthM,
    ey = from[1] + sy * lengthM
  const minX = Math.min(from[0], ex) - lateralM,
    maxX = Math.max(from[0], ex) + lateralM,
    minY = Math.min(from[1], ey) - lateralM,
    maxY = Math.max(from[1], ey) + lateralM
  const c0 = Math.max(0, Math.ceil((minX - origin[0]) / cellM)),
    c1 = Math.min(width - 1, Math.floor((maxX - origin[0]) / cellM)),
    r0 = Math.max(0, Math.ceil((origin[1] - maxY) / cellM)),
    r1 = Math.min(height - 1, Math.floor((origin[1] - minY) / cellM))
  for (let row = r0; row <= r1; row++) {
    const y = origin[1] - row * cellM - from[1]
    for (let col = c0; col <= c1; col++) {
      const x = origin[0] + col * cellM - from[0]
      const u = x * sx + y * sy
      if (u < -1e-9 || u > lengthM + 1e-9) continue
      const v = Math.abs(x * sy - y * sx)
      if (v > lateralM + 1e-9) continue
      visit(row * width + col, Math.max(0, u), v)
    }
  }
}

/**
 * Turns the screen's answers into line records and per-cell coverage: every line from every
 * landing for "after", lines from landings on existing roads for "before".
 */
export function* cableCoverageSteps(
  eg: ExtractionGrid,
  rule: CableCoverageRule,
  landings: CableLanding[],
  candidates: readonly CableCandidate[],
  screened: readonly CoverLineResult[],
  index: readonly number[],
): Generator<SkidProgress, CableCoverageResult> {
  const { sg } = eg
  const n = sg.grid.values.length
  const cellHa = (sg.grid.cellM * sg.grid.cellM) / 10_000
  const yardable = cableYardable(eg)
  const usable = usableSkylineM(rule)
  const after: [ExtractionCells, ExtractionCells] = [emptyCells(n), emptyCells(n)]
  const before: [ExtractionCells, ExtractionCells] = [emptyCells(n), emptyCells(n)]
  // Lateral distance of the line each cell is yarded by, per result (after/before × strict/optimistic).
  const lateral = new Map<ExtractionCells, Float32Array>()
  for (const c of [...after, ...before]) lateral.set(c, new Float32Array(n).fill(Infinity))
  const mark = (cells: ExtractionCells, i: number, u: number, v: number, exit: number) => {
    const side = lateral.get(cells)!
    if (cells.method[i] === CABLE && (v > side[i] + 1e-6 || (v > side[i] - 1e-6 && !(u < cells.totalM[i])))) return
    side[i] = v
    cells.method[i] = CABLE
    cells.totalM[i] = u
    cells.forestM[i] = u
    cells.trackM[i] = 0
    cells.reach[i] = u / usable
    cells.exit[i] = exit
  }
  const rejected: CableCoverageResult['stats']['rejected'] = {}
  const reject = (key: keyof CableCoverageResult['stats']['rejected']) => (rejected[key] = (rejected[key] ?? 0) + 1)
  const screenedAt = new Map<number, CoverLineResult>()
  index.forEach((c, k) => screenedAt.set(c, screened[k]))
  const lines: CableLineRecord[] = []
  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c]
    const landing = landings[cand.landing]
    const result = screenedAt.get(c)
    let line: CableLineRecord | null = null
    if (!result) {
      if (!(cand.maxTailM * Math.SQRT2 >= rule.minLineM)) reject(cand.stop === 'length' ? 'short' : cand.stop)
      else reject('position')
    } else if (result.status === 'budget') reject('budget')
    else if (result.status !== 'feasible') reject(result.reason === 'none' ? 'short' : result.reason)
    else {
      const sx = Math.sin((cand.bearingDeg * Math.PI) / 180),
        sy = Math.cos((cand.bearingDeg * Math.PI) / 180)
      const zAt = (s: number) => {
        const t = s / cand.dx
        const i = Math.min(Math.floor(t), cand.z.length - 2)
        return cand.z[i] + (cand.z[i + 1] - cand.z[i]) * (t - i)
      }
      const points = result.points.map((p) => ({
        stationM: p.stationM,
        groundM: zAt(p.stationM),
        heightM: p.heightM,
        xy: [landing.xy[0] + sx * p.stationM, landing.xy[1] + sy * p.stationM] as XY,
      }))
      let skylineM = 0
      for (let k = 1; k < points.length; k++)
        skylineM += Math.hypot(
          points[k].stationM - points[k - 1].stationM,
          points[k].groundM + points[k].heightM - points[k - 1].groundM - points[k - 1].heightM,
        )
      if (skylineM < rule.minLineM - 1e-6) reject('short')
      else {
        const tail = points[points.length - 1]
        line = {
          id: lines.length + 1,
          landing: cand.landing,
          bearingDeg: cand.bearingDeg,
          horizontalM: result.lengthM,
          skylineM,
          // Level lines count as machine below, as in Sylvaccess.
          configuration: points[0].groundM > tail.groundM + 1e-6 ? 'above' : 'below',
          designedLanding: landing.designed,
          preTensionKN: result.preTensionKN ?? NaN,
          points,
          cells: 0,
          areaHa: 0,
          meanCarriageM: 0,
        }
        let sum = 0
        const record = line
        forBandCells(eg, landing.xy, cand.bearingDeg, result.lengthM, rule.lateralM, (i, u, v) => {
          if (!yardable[i]) return
          record.cells++
          sum += u
          mark(after[0], i, u, v, landing.cell)
          if (!landing.designed) mark(before[0], i, u, v, landing.cell)
        })
        line.areaHa = line.cells * cellHa
        line.meanCarriageM = line.cells ? sum / line.cells : 0
        if (line.cells) lines.push(line)
        else reject('empty')
      }
    }
    // A gap: ground the line might reach were it known.
    if (cand.unknownReachM !== null) {
      const reach = cand.unknownReachM
      forBandCells(eg, landing.xy, cand.bearingDeg, reach, rule.lateralM, (i, u, v) => {
        if (!sg.block[i]) return
        mark(after[1], i, u, v, landing.cell)
        if (!landing.designed) mark(before[1], i, u, v, landing.cell)
      })
    }
    if ((c & 63) === 63) yield { phase: 'Mapping cable coverage', done: c + 1, total: candidates.length }
  }
  // The optimistic run holds everything the strict one does.
  for (const [strict, optimistic] of [after, before])
    for (let i = 0; i < n; i++)
      if (strict.method[i] === CABLE) mark(optimistic, i, strict.totalM[i], lateral.get(strict)![i], strict.exit[i])
  const above = lines.filter((l) => l.configuration === 'above').length
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)
  return {
    landings,
    lines,
    after,
    before,
    stats: {
      candidates: candidates.length,
      screened: screened.length,
      rejected,
      machineAbove: above,
      machineBelow: lines.length - above,
      meanSupports: mean(lines.map((l) => l.points.length - 2)),
      meanSkylineM: mean(lines.map((l) => l.skylineM)),
    },
  }
}

export const CABLE_LINE_COLOR = '#0e7490'
const SUPPORT_COLOR = '#155e75'

/** Plan features for the given lines: each line from its yarder to its tail, and its supports. */
export function cableLineFeatures(
  eg: ExtractionGrid,
  lines: readonly CableLineRecord[],
  /** A line opened as a profile is drawn selected. */
  selectedId?: number | null,
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = []
  for (const line of lines) {
    const supports = line.points.length - 2
    out.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [line.points[0], line.points.at(-1)!].map((p) => eg.sg.toLonLat(p.xy)),
      },
      properties: {
        kind: 'cable-line',
        color: CABLE_LINE_COLOR,
        ...(line.id === selectedId ? { selected: true } : {}),
        label: `Line ${line.id} · ${Math.round(line.skylineM)} m · ${supports} support${supports === 1 ? '' : 's'} · ${line.areaHa.toFixed(1)} ha`,
      },
    })
    for (const p of line.points.slice(1, -1))
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: eg.sg.toLonLat(p.xy) },
        properties: {
          kind: 'cable-support',
          color: SUPPORT_COLOR,
          marker: 'dot',
          label: `Line ${line.id} support · ${Math.round(p.stationM)} m · ${p.heightM} m`,
        },
      })
  }
  return out
}

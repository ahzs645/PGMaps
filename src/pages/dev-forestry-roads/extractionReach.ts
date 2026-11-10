/**
 * Extraction reach over a harvest block: for each part of the block, whether a ground-based machine
 * can bring its logs to a truck road, how (driving, winching, straight runs, crane), and how far
 * they travel. Two machines:
 *
 * - **Skidder.** Drives where the ground is within its skid limit, along the ground to a truck road
 *   or to a machine-only skid trail and along it, within the directional skid reach of
 *   `skidReach.ts` (the 350 m level / 200 m at 30 % uphill field rule by default). It winches logs
 *   to itself along straight lines (`winchReach.ts`) from roads and trails first ("roads first",
 *   which keeps the machine off the ground near roads) or only from where its driving ends ("drive
 *   to the timber"). Winching reaches across steep ground and across areas closed to machines.
 * - **Forwarder.** Drives freely on gentle ground, in straight runs on steeper ground, and loads
 *   with its crane beyond where it drives (`forwarderReach.ts`).
 *
 * Road classes follow Sylvaccess: a truck road is where every distance ends; a skid trail
 * (machine-only track) carries logs to a truck road, and a trail that does not join one is left
 * out and named. Areas are classified by the user, never by their geometry: "no machines" stops
 * driving but not winching across, "no extraction" stops both.
 *
 * Missing ground stays unknown. Every pass runs twice, once refusing missing cells and once
 * treating them as level and passable; a block cell reached only in the second run is unknown,
 * never within or beyond reach.
 *
 * Cable yarding is modelled in `cableCoverage.ts`, which needs the cable-layout module in a worker:
 * it produces per-cell `ExtractionCells` with method `cable` for the cells its lines cover, and
 * `cableExtractionResult` turns them into a result that classification, statistics, distance
 * classes, the plan layer and the before/after comparison read like any other machine's (see
 * `docs/forestry-road-design/extraction-reach.md`, "How the cable yarder is modelled").
 *
 * Sources: Dupire S., Bourrier F., Monnet J.-M., Berger F. (2015), Sylvaccess : un modèle pour
 * cartographier automatiquement l'accessibilité des forêts, Revue forestière française 67(2):
 * 111–126; the Sylvaccess 3.6 user notice (INRAE, September 2024); Clouet et al. (2010), CARTUVI;
 * Suvinen (2006). Written from a functional specification; no code from Sylvaccess
 * (GPL-3.0-or-later) was used.
 *
 * Pure: terrain and projection are arguments; no DOM or network access.
 */
import {
  CellHeap,
  BEYOND,
  COVERED,
  lineCells,
  maskOutlines,
  MAX_SKID_OUTLINE_VERTICES,
  polygonCells,
  prepareSkidGrid,
  SKID_REPORT_REACHES,
  STEEP,
  summarizeSkidReach,
  UNKNOWN,
  allowedSkidReachM,
  validateSkidRule,
  type ReachField,
  type SkidGrid,
  type SkidProgress,
  type SkidReachInput,
  type SkidReachResult,
  type SkidReachRule,
  type SkidReachSummary,
  type SkidRoad,
} from './skidReach'
import type { SpurReachModel, SpurReachState } from './skidSpurs'
import {
  castWinchLines,
  copyWinchField,
  DEFAULT_WINCH_RULE,
  emptyWinchField,
  validateWinchRule,
  type WinchField,
  type WinchGround,
  type WinchRule,
  type WinchSource,
} from './winchReach'
import {
  castRuns,
  copyRunField,
  craneOffsets,
  DEFAULT_FORWARDER_RULE,
  emptyRunField,
  freeTravelSlopePercent,
  steepestDrivenPercent,
  TRACK_CHOICE_WEIGHT,
  validateForwarderRule,
  type ForwarderGround,
  type ForwarderRule,
  type RunField,
  type RunSource,
} from './forwarderReach'
import type { Coordinate } from './types'
import { DEFAULT_CABLE_RULE, validateCableRule, type CableCoverageRule } from './cableCoverageRule'
import { resolveLandings, type LandingInput, type ResolvedLanding } from './extractionLandings'

type XY = [number, number]

/** The machines modelled. The cable yarder's lines come from `cableCoverage.ts` (see the module note). */
export type ExtractionMachine = 'skidder' | 'forwarder' | 'cable'
/**
 * Where the skidder winches from: `roads` first (Sylvaccess option 1, "limit soil damage"), only
 * from the `edge` of the ground it drives to (option 2, "limit winching"), or `none`.
 */
export type WinchFrom = 'none' | 'edge' | 'roads'

export interface ExtractionSettings {
  machine: ExtractionMachine
  /** The skidder's directional skid reach and ground skid limit. */
  skid: SkidReachRule
  winch: WinchRule
  winchFrom: WinchFrom
  forwarder: ForwarderRule
  /** The cable yarder's rigging and line rules. */
  cable: CableCoverageRule
  /** Ground whose steepest 3 × 3 slope is above this cannot be felled by hand, percent. */
  fellableSlopePercent: number
  /** Lower bounds of the extraction-distance classes, m, ascending from 0. */
  classBoundsM: number[]
}

export const DEFAULT_FELLABLE_SLOPE_PERCENT = 100
export const MIN_FELLABLE_SLOPE_PERCENT = 10
export const MAX_FELLABLE_SLOPE_PERCENT = 300
/** BC-scale classes for a 350 m skid reach; Sylvaccess's default is 0;500;1000;1500. */
export const DEFAULT_CLASS_BOUNDS_M = [0, 100, 200, 300]
export const MAX_DISTANCE_CLASSES = 8
export const MAX_CLASS_BOUND_M = 5000

export const DEFAULT_EXTRACTION_SETTINGS: ExtractionSettings = {
  machine: 'skidder',
  skid: { flatReachM: 350, adverseReachM: 200, adverseSlopePercent: 30, maxGroundSlopePercent: 40 },
  winch: DEFAULT_WINCH_RULE,
  winchFrom: 'edge',
  forwarder: DEFAULT_FORWARDER_RULE,
  cable: DEFAULT_CABLE_RULE,
  fellableSlopePercent: DEFAULT_FELLABLE_SLOPE_PERCENT,
  classBoundsM: DEFAULT_CLASS_BOUNDS_M,
}

/** An area the user has classified for extraction. */
export interface ExtractionArea {
  polygon: GeoJSON.Polygon
  /** `no-machines`: no driving, winching across allowed. `no-extraction`: neither. */
  treatment: 'no-machines' | 'no-extraction'
}

export interface ExtractionInput extends Omit<SkidReachInput, 'rule'> {
  settings: ExtractionSettings
  areas?: readonly ExtractionArea[]
  /**
   * Landings the user chose (`extractionLandings.ts`). When any is set, logs go only to them: the
   * counted roads carry machines to a landing as skid trails do, and the cable yarder's lines start
   * only from them. None keeps the usual behaviour.
   */
  landings?: readonly LandingInput[]
}

/** In-stand distance counts this much against trail distance when choosing a trail to leave by. */
export const OFF_TRAIL_CHOICE_WEIGHT = 2
const REACH_EPS = 1e-9

/** Cell states, by index. */
export const EXTRACTION_STATES = ['outside', 'covered', 'beyond', 'steep', 'unfellable', 'excluded', 'unknown'] as const
export type ExtractionState = (typeof EXTRACTION_STATES)[number]
export const X_OUTSIDE = 0,
  X_COVERED = 1,
  X_BEYOND = 2,
  X_STEEP = 3,
  X_UNFELLABLE = 4,
  X_EXCLUDED = 5,
  X_UNKNOWN = 6

/** How a covered cell's logs leave, by index. `cable` comes from `cableCoverage.ts`. */
export const EXTRACTION_METHODS = [
  'none',
  'road',
  'ground',
  'winch-road',
  'winch-edge',
  'run',
  'crane',
  'cable',
] as const
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number]
export const M_NONE = 0,
  M_ROAD = 1,
  M_GROUND = 2,
  M_WINCH_ROAD = 3,
  M_WINCH_EDGE = 4,
  M_RUN = 5,
  M_CRANE = 6,
  M_CABLE = 7

export function validateExtractionSettings(settings: ExtractionSettings): ExtractionSettings {
  if (settings.machine !== 'skidder' && settings.machine !== 'forwarder' && settings.machine !== 'cable')
    throw Error('Choose a skidder, a forwarder or a cable yarder.')
  validateSkidRule(settings.skid)
  if (settings.machine === 'skidder' && settings.winchFrom !== 'none') validateWinchRule(settings.winch)
  if (settings.machine === 'forwarder') validateForwarderRule(settings.forwarder)
  if (settings.machine === 'cable') validateCableRule(settings.cable)
  const f = settings.fellableSlopePercent
  if (!(Number.isFinite(f) && f >= MIN_FELLABLE_SLOPE_PERCENT && f <= MAX_FELLABLE_SLOPE_PERCENT))
    throw Error(`Use a hand-falling slope limit from ${MIN_FELLABLE_SLOPE_PERCENT}% to ${MAX_FELLABLE_SLOPE_PERCENT}%.`)
  parseClassBounds(settings.classBoundsM.join(';'))
  return settings
}

/**
 * Distance class bounds from text such as `0;100;200;300`: ascending, starting at 0, at most
 * `MAX_DISTANCE_CLASSES` of them. Throws a message naming the problem.
 */
export function parseClassBounds(text: string): number[] {
  const parts = text
    .split(/[;,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const bounds = parts.map(Number)
  if (!bounds.length || bounds.some((b) => !Number.isFinite(b)))
    throw Error('Enter distance classes as numbers separated by semicolons, such as 0;100;200;300.')
  if (bounds[0] !== 0) throw Error('Start the distance classes at 0.')
  if (bounds.length > MAX_DISTANCE_CLASSES) throw Error(`Use at most ${MAX_DISTANCE_CLASSES} distance classes.`)
  for (let i = 1; i < bounds.length; i++)
    if (!(bounds[i] > bounds[i - 1])) throw Error('List the distance classes in increasing order.')
  if (bounds.at(-1)! > MAX_CLASS_BOUND_M) throw Error(`Keep distance classes under ${MAX_CLASS_BOUND_M} m.`)
  return bounds
}

/** The skid grid's own rule for a machine: the skid rule, or the forwarder's free travel. */
function gridRule(settings: ExtractionSettings): SkidReachRule {
  if (settings.machine !== 'forwarder') return settings.skid
  const reach = settings.forwarder.reachM
  return {
    flatReachM: reach,
    adverseReachM: reach,
    adverseSlopePercent: settings.forwarder.loadedUphillPercent,
    maxGroundSlopePercent: freeTravelSlopePercent(settings.forwarder),
  }
}

/** The skid grid with what the extraction model adds: road cells, classified areas, felling and gradient. */
export interface ExtractionGrid {
  sg: SkidGrid
  settings: ExtractionSettings
  /** Cells of each of `sg.roads`. */
  roadCells: number[][]
  noMachines: Uint8Array
  noExtraction: Uint8Array
  /** 1 where the ground is known and too steep to fell by hand. */
  unfellable: Uint8Array
  /** Ground gradient east and north, fractions; NaN where unknown. */
  gradX: Float32Array
  gradY: Float32Array
  /** The user's landings on the grid; empty or absent when the run takes every road cell. */
  landings?: ResolvedLanding[]
  /** Names of landings with no cell on the grid, left out. */
  landingsOffGrid?: string[]
}

/** Gradient components from central differences, one-sided at a missing neighbour; NaN where unknown. */
function gradients(sg: SkidGrid): { gx: Float32Array; gy: Float32Array } {
  const { width, height, cellM, values } = sg.grid
  const gx = new Float32Array(width * height),
    gy = new Float32Array(width * height)
  const diff = (z: number, back: number, forward: number) => {
    if (Number.isFinite(back) && Number.isFinite(forward)) return (forward - back) / (2 * cellM)
    if (Number.isFinite(forward)) return (forward - z) / cellM
    if (Number.isFinite(back)) return (z - back) / cellM
    return NaN
  }
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const z = values[i]
      if (!Number.isFinite(z)) {
        gx[i] = gy[i] = NaN
        continue
      }
      gx[i] = diff(z, col > 0 ? values[i - 1] : NaN, col < width - 1 ? values[i + 1] : NaN)
      // Rows run south, so north is the row above.
      gy[i] = diff(z, row < height - 1 ? values[i + width] : NaN, row > 0 ? values[i - width] : NaN)
    }
  return { gx, gy }
}

/** Ground no hand faller works: the steepest slope of the cell and its eight neighbours is above `limit`. */
export function unfellableCells(sg: SkidGrid, limit: number): Uint8Array {
  const { width, height } = sg.grid
  const out = new Uint8Array(width * height)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (!Number.isFinite(sg.slopePercent[i])) continue
      let steepest = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr,
            c = col + dc
          if (r < 0 || c < 0 || r >= height || c >= width) continue
          const s = sg.slopePercent[r * width + c]
          if (s > steepest) steepest = s
        }
      if (steepest > limit) out[i] = 1
    }
  return out
}

/** Samples the ground and marks block, roads, barriers, areas and unfellable ground. */
export function* prepareExtractionGrid(input: ExtractionInput): Generator<SkidProgress, ExtractionGrid> {
  const settings = validateExtractionSettings({ ...input.settings })
  const sg = yield* prepareSkidGrid({ ...input, rule: gridRule(settings) })
  const cells = sg.grid.width * sg.grid.height
  const noMachines = new Uint8Array(cells),
    noExtraction = new Uint8Array(cells)
  for (const area of input.areas ?? []) {
    const rings = area.polygon.coordinates.map((ring) =>
      ring.map((c) => input.toGrid([c[0], c[1]])).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    )
    if (!rings[0] || rings[0].length < 3) continue
    const mask = polygonCells(sg.grid, rings)
    const target = area.treatment === 'no-extraction' ? noExtraction : noMachines
    for (let i = 0; i < cells; i++) if (mask[i]) target[i] = 1
  }
  const { gx, gy } = gradients(sg)
  const placed = input.landings?.length ? resolveLandings(sg, input.landings) : null
  if (placed && !placed.landings.length)
    throw Error(`No landing lies on the grid around the block: ${placed.offGrid.join(', ')}.`)
  return {
    sg,
    settings,
    roadCells: sg.roads.map((road) => lineCells(sg.grid, road.xy)),
    noMachines,
    noExtraction,
    unfellable: unfellableCells(sg, settings.fellableSlopePercent),
    gradX: gx,
    gradY: gy,
    landings: placed?.landings ?? [],
    landingsOffGrid: placed?.offGrid ?? [],
  }
}

/**
 * The same prepared grid for another machine's settings: the ground, roads, areas and landings are
 * shared, so results on both compare cell for cell (`harvestSystems.ts`). The hand-falling limit
 * and distance classes must match the grid's.
 */
export function extractionGridFor(eg: ExtractionGrid, settings: ExtractionSettings): ExtractionGrid {
  const checked = validateExtractionSettings({ ...settings })
  if (checked.fellableSlopePercent !== eg.settings.fellableSlopePercent)
    throw Error('Use the same hand-falling limit for every machine on one grid.')
  return { ...eg, settings: checked, sg: { ...eg.sg, rule: gridRule(checked) } }
}

/** Which landings a run takes; all of them by default. */
export type LandingFilter = (landing: ResolvedLanding) => boolean

/** Along-ground travel from roads: reach used, its choice key, distances and the cell left by. */
export interface GroundField {
  /** Reach used, in-stand plus trail (1 = all of it). */
  reach: Float64Array
  /** Dijkstra key: trail reach plus weighted in-stand reach. */
  choice: Float64Array
  forestM: Float32Array
  trackM: Float32Array
  exit: Int32Array
}
export function emptyGroundField(cells: number): GroundField {
  return {
    reach: new Float64Array(cells).fill(Infinity),
    choice: new Float64Array(cells).fill(Infinity),
    forestM: new Float32Array(cells).fill(NaN),
    trackM: new Float32Array(cells).fill(NaN),
    exit: new Int32Array(cells).fill(-1),
  }
}
const copyGroundField = (f: GroundField): GroundField => ({
  reach: new Float64Array(f.reach),
  choice: new Float64Array(f.choice),
  forestM: new Float32Array(f.forestM),
  trackM: new Float32Array(f.trackM),
  exit: new Int32Array(f.exit),
})

interface GroundSeed {
  cell: number
  reach: number
  trackM: number
  exit: number
}
interface GroundPass {
  passable: Uint8Array
  rule: SkidReachRule
  optimistic: boolean
  /** Weight of in-stand reach in the choice key. */
  forestWeight: number
  /** Built trails: no ground slope limit. */
  ignoreSlope?: boolean
}

const NEIGHBOURS: XY[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
const POPS_PER_YIELD = 4096

/**
 * Lowers `field` from `seeds` over `passable` cells: Dijkstra on the choice key, eight neighbours,
 * each step using `step length ÷ allowed reach at its grade` of the reach (`allowedSkidReachM`).
 * Running it with new seeds on a computed field gives the field for all seeds.
 */
function* propagateGround(
  eg: ExtractionGrid,
  field: GroundField,
  seeds: readonly GroundSeed[],
  o: GroundPass,
): Generator<SkidProgress, void> {
  const { sg } = eg
  const { width, height, cellM, values: z } = sg.grid
  const { barrier, slopePercent } = sg
  const max = o.rule.maxGroundSlopePercent
  const heap = new CellHeap()
  for (const seed of seeds) {
    if (seed.reach < field.choice[seed.cell]) {
      field.reach[seed.cell] = seed.reach
      field.choice[seed.cell] = seed.reach
      field.forestM[seed.cell] = 0
      field.trackM[seed.cell] = seed.trackM
      field.exit[seed.cell] = seed.exit
    }
    heap.push(seed.cell, field.choice[seed.cell])
  }
  const top = { node: 0, score: 0 }
  let pops = 0
  while (heap.size) {
    heap.pop(top)
    const u = top.node
    if (top.score > field.choice[u]) continue
    if (++pops % POPS_PER_YIELD === 0)
      yield { phase: 'Following ground paths', done: pops, total: sg.blockCells.length }
    const row = (u / width) | 0,
      col = u - row * width
    const zu = z[u]
    for (let k = 0; k < 8; k++) {
      const r = row + NEIGHBOURS[k][0],
        c = col + NEIGHBOURS[k][1]
      if (r < 0 || c < 0 || r >= height || c >= width) continue
      const v = r * width + c
      if (!o.passable[v]) continue
      if (k >= 4 && barrier[row * width + c] && barrier[r * width + col]) continue
      const zv = z[v]
      const h = k < 4 ? cellM : cellM * Math.SQRT2
      const slope = slopePercent[v]
      let step: number, allowed: number
      if (Number.isFinite(zu) && Number.isFinite(zv)) {
        if (!o.ignoreSlope) {
          if (slope > max) continue
          if (!o.optimistic && !(slope <= max)) continue
        }
        const dz = zu - zv
        step = Math.hypot(h, dz)
        allowed = allowedSkidReachM((100 * dz) / h, o.rule)
      } else {
        if (!o.optimistic || (!o.ignoreSlope && slope > max)) continue
        step = h
        allowed = o.rule.flatReachM
      }
      const used = step / allowed
      const reach = field.reach[u] + used
      if (reach > SKID_REPORT_REACHES) continue
      const choice = field.choice[u] + o.forestWeight * used
      if (choice >= field.choice[v] - 1e-12) continue
      field.reach[v] = reach
      field.choice[v] = choice
      field.forestM[v] = field.forestM[u] + step
      field.trackM[v] = field.trackM[u]
      field.exit[v] = field.exit[u]
      heap.push(v, choice)
    }
  }
}

/** Per cell: how the logs leave and how far they travel, for one of the two runs. */
export interface ExtractionCells {
  method: Uint8Array
  /** Total extraction distance (stand + trail + winch), m; for an unreached cell, its ground path if any. */
  totalM: Float32Array
  /** Distance driven or forwarded in the stand, including runs and crane, m. */
  forestM: Float32Array
  /** Distance along a skid trail to the truck road, m. */
  trackM: Float32Array
  winchM: Float32Array
  /** Reach used by the machine's travel (1 = all of it); Infinity when no path was found. */
  reach: Float64Array
  /** The road or trail cell the logs leave by. */
  exit: Int32Array
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

/** The incrementally updated layers of one run; everything else is derived from them. */
interface RunLayers {
  optimistic: boolean
  /** Truck-road cells, including roads added by spur suggestions. */
  truck: Uint8Array
  /** Skid-trail cells joined to a truck road, with their along-trail field. */
  trail: Uint8Array
  trailField: GroundField
  viaRoad: GroundField
  viaTrail: GroundField
  /** Skidder, roads first: winch lines from roads and trails. */
  roadWinch: WinchField | null
  /** Forwarder: straight runs from roads and trails. */
  runs: RunField | null
}

interface Masks {
  /** The machine may drive here (before its slope limit). */
  drive: Uint8Array
  viaRoadPassable: Uint8Array
  viaTrailPassable: Uint8Array
  /** Winch lines may cross and end here. */
  winchCrossable: Uint8Array
  /** Forwarder may drive / crane may load here. */
  forwarderDrivable: Uint8Array
  loadable: Uint8Array
}

function masksFor(eg: ExtractionGrid, roadUse: Uint8Array): Masks {
  const { sg, noMachines, noExtraction, unfellable } = eg
  const n = roadUse.length
  const drive = new Uint8Array(n),
    viaRoadPassable = new Uint8Array(n),
    viaTrailPassable = new Uint8Array(n),
    winchCrossable = new Uint8Array(n),
    forwarderDrivable = new Uint8Array(n),
    loadable = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const road = roadUse[i] > 0
    // A road through a closed area stays usable.
    const closed = !road && (noMachines[i] || noExtraction[i])
    const open = sg.travel[i] && !sg.barrier[i]
    drive[i] = open && !closed ? 1 : 0
    viaRoadPassable[i] = drive[i] && roadUse[i] !== 1 ? 1 : 0
    viaTrailPassable[i] = drive[i] && roadUse[i] !== 2 ? 1 : 0
    winchCrossable[i] = open && !road && !noExtraction[i] && !unfellable[i] ? 1 : 0
    forwarderDrivable[i] = drive[i] && !unfellable[i] ? 1 : 0
    loadable[i] = open && !(noExtraction[i] && !road) && !unfellable[i] ? 1 : 0
  }
  return { drive, viaRoadPassable, viaTrailPassable, winchCrossable, forwarderDrivable, loadable }
}

/**
 * The roads a run counts, as truck (2) and trail (1) cells; a truck road wins a shared cell. With
 * landings set, only the landings `takeLanding` takes are destinations (2): every counted road
 * carries machines to them as a skid trail does (1).
 */
function roadUseFor(
  eg: ExtractionGrid,
  include: (road: SkidRoad) => boolean,
  takeLanding: LandingFilter = () => true,
): Uint8Array {
  const use = new Uint8Array(eg.sg.grid.width * eg.sg.grid.height)
  eg.sg.roads.forEach((road, k) => {
    if (!include(road.road)) return
    const value = road.road.use === 'track' ? 1 : 2
    for (const i of eg.roadCells[k]) if (value > use[i]) use[i] = value
  })
  if (eg.landings?.length) {
    for (let i = 0; i < use.length; i++) if (use[i] === 2) use[i] = 1
    for (const landing of eg.landings) if (takeLanding(landing)) for (const i of landing.cells) use[i] = 2
  }
  return use
}

const passRule = (eg: ExtractionGrid) => eg.sg.rule

function* buildLayers(
  eg: ExtractionGrid,
  roadUse: Uint8Array,
  masks: Masks,
  optimistic: boolean,
): Generator<SkidProgress, RunLayers> {
  const n = roadUse.length
  const rule = passRule(eg)
  const truck = new Uint8Array(n)
  const truckSeeds: GroundSeed[] = []
  const trailCells: number[] = []
  for (let i = 0; i < n; i++) {
    if (roadUse[i] === 2) {
      truck[i] = 1
      truckSeeds.push({ cell: i, reach: 0, trackM: 0, exit: i })
    } else if (roadUse[i] === 1) trailCells.push(i)
  }
  // Trails: along-trail distance from the truck roads they join. A trail joining none is left out.
  const trailField = emptyGroundField(n)
  const trail = new Uint8Array(n)
  if (trailCells.length) {
    const trailPassable = new Uint8Array(n)
    for (const i of trailCells) trailPassable[i] = 1
    yield* propagateGround(eg, trailField, truckSeeds, {
      passable: trailPassable,
      rule,
      optimistic,
      forestWeight: 1,
      ignoreSlope: true,
    })
    for (const i of trailCells) if (Number.isFinite(trailField.reach[i])) trail[i] = 1
  }
  const viaRoad = emptyGroundField(n)
  yield* propagateGround(eg, viaRoad, truckSeeds, {
    passable: masks.viaRoadPassable,
    rule,
    optimistic,
    forestWeight: 1,
  })
  const viaTrail = emptyGroundField(n)
  const trailSeeds: GroundSeed[] = []
  for (const i of trailCells)
    if (trail[i]) trailSeeds.push({ cell: i, reach: trailField.reach[i], trackM: trailField.forestM[i], exit: i })
  if (trailSeeds.length)
    yield* propagateGround(eg, viaTrail, trailSeeds, {
      passable: masks.viaTrailPassable,
      rule,
      optimistic,
      forestWeight: OFF_TRAIL_CHOICE_WEIGHT,
    })
  const layers: RunLayers = { optimistic, truck, trail, trailField, viaRoad, viaTrail, roadWinch: null, runs: null }
  const roadSources = [...truckSeeds.map((s) => s.cell), ...trailCells.filter((i) => trail[i])]
  if (eg.settings.machine === 'skidder' && eg.settings.winchFrom === 'roads') {
    layers.roadWinch = emptyWinchField(n)
    yield* castWinchLines(
      winchGround(eg, masks),
      winchRoadSources(layers, roadSources),
      eg.settings.winch,
      layers.roadWinch,
      optimistic,
    )
  }
  if (eg.settings.machine === 'forwarder') {
    layers.runs = emptyRunField(n)
    yield* castRuns(
      forwarderGround(eg, masks),
      runRoadSources(layers, roadSources),
      eg.settings.forwarder,
      layers.runs,
      optimistic,
    )
  }
  return layers
}

const winchGround = (eg: ExtractionGrid, masks: Masks): WinchGround => ({
  width: eg.sg.grid.width,
  height: eg.sg.grid.height,
  cellM: eg.sg.grid.cellM,
  z: eg.sg.grid.values,
  crossable: masks.winchCrossable,
})
const forwarderGround = (eg: ExtractionGrid, masks: Masks): ForwarderGround => ({
  width: eg.sg.grid.width,
  height: eg.sg.grid.height,
  cellM: eg.sg.grid.cellM,
  z: eg.sg.grid.values,
  slopePercent: eg.sg.slopePercent,
  gradX: eg.gradX,
  gradY: eg.gradY,
  drivable: masks.forwarderDrivable,
  loadable: masks.loadable,
})

/** Winch sources on roads and joined trails within reach; a trail's line counts 0.1 of its trail distance. */
function winchRoadSources(layers: RunLayers, cells: readonly number[]): WinchSource[] {
  const out: WinchSource[] = []
  for (const cell of cells) {
    if (layers.truck[cell]) out.push({ cell, baseM: 0, choiceBase: 0, exit: cell })
    else if (layers.trail[cell] && layers.trailField.reach[cell] <= 1 + REACH_EPS) {
      const trackM = layers.trailField.forestM[cell]
      out.push({ cell, baseM: trackM, choiceBase: TRACK_CHOICE_WEIGHT * trackM, exit: cell })
    }
  }
  return out
}
function runRoadSources(layers: RunLayers, cells: readonly number[]): RunSource[] {
  const out: RunSource[] = []
  for (const cell of cells) {
    if (layers.truck[cell]) out.push({ cell, forestM: 0, trackM: 0, steepUsedM: 0, exit: cell })
    else if (layers.trail[cell] && layers.trailField.reach[cell] <= 1 + REACH_EPS)
      out.push({ cell, forestM: 0, trackM: layers.trailField.forestM[cell], steepUsedM: 0, exit: cell })
  }
  return out
}

/** The ground-travel result a cell would take: via a truck road or via a trail, within reach. */
function groundChoice(layers: RunLayers, i: number): 'road' | 'trail' | null {
  const road = layers.viaRoad.reach[i] <= 1 + REACH_EPS,
    trail = layers.viaTrail.reach[i] <= 1 + REACH_EPS
  if (road && trail)
    return layers.viaRoad.forestM[i] <= layers.viaTrail.forestM[i] + TRACK_CHOICE_WEIGHT * layers.viaTrail.trackM[i]
      ? 'road'
      : 'trail'
  return road ? 'road' : trail ? 'trail' : null
}

/** Combines a run's layers into per-cell results, adding the edge winching or the forwarder's second pass and crane. */
function* deriveCells(eg: ExtractionGrid, layers: RunLayers, masks: Masks): Generator<SkidProgress, ExtractionCells> {
  const { sg, settings } = eg
  const { width, height, values: z } = sg.grid
  const n = width * height
  const out = emptyCells(n)
  const optimistic = layers.optimistic
  const set = (
    i: number,
    method: number,
    forestM: number,
    trackM: number,
    winchM: number,
    reach: number,
    exit: number,
  ) => {
    out.method[i] = method
    out.forestM[i] = forestM
    out.trackM[i] = trackM
    out.winchM[i] = winchM
    out.totalM[i] = forestM + trackM + winchM
    out.reach[i] = reach
    out.exit[i] = exit
  }
  // Ground travel: roads, trails and driven ground within reach.
  for (let i = 0; i < n; i++) {
    if (layers.truck[i]) {
      set(i, M_ROAD, 0, 0, 0, 0, i)
      continue
    }
    if (layers.trail[i] && layers.trailField.reach[i] <= 1 + REACH_EPS) {
      set(i, M_ROAD, 0, layers.trailField.forestM[i], 0, layers.trailField.reach[i], i)
      continue
    }
    const pick = groundChoice(layers, i)
    if (pick) {
      const f = pick === 'road' ? layers.viaRoad : layers.viaTrail
      set(i, M_GROUND, f.forestM[i], f.trackM[i], 0, f.reach[i], f.exit[i])
    } else {
      // Not within reach: keep the nearer ground path, if any, for the farthest-cell report.
      const f = layers.viaRoad.reach[i] <= layers.viaTrail.reach[i] ? layers.viaRoad : layers.viaTrail
      out.reach[i] = f.reach[i]
      if (Number.isFinite(f.reach[i])) out.totalM[i] = f.forestM[i] + f.trackM[i]
    }
  }
  const covered = (i: number) => out.method[i] !== M_NONE
  if (settings.machine === 'skidder') {
    const max = settings.skid.maxGroundSlopePercent
    const canDrive = (v: number) => {
      if (!masks.drive[v]) return false
      const s = sg.slopePercent[v]
      if (Number.isFinite(z[v])) return s <= max || (optimistic && !Number.isFinite(s))
      return optimistic
    }
    // Roads first: a log within winch reach of a road or trail is winched to it.
    if (layers.roadWinch) {
      const w = layers.roadWinch
      for (let i = 0; i < n; i++)
        if (Number.isFinite(w.winchM[i]) && out.method[i] !== M_ROAD) {
          const exit = w.exit[i]
          set(i, M_WINCH_ROAD, 0, w.baseM[i], w.winchM[i], layers.truck[exit] ? 0 : layers.trailField.reach[exit], exit)
        }
    }
    if (settings.winchFrom !== 'none') {
      // From the edge of the driven ground: cells the machine drives to within reach (and, when it
      // drives to the timber, roads and trails) beside ground it cannot enter. Each carries its own
      // ground path, whether or not a road winch serves the cell itself.
      const sources: WinchSource[] = []
      const fromRoads = settings.winchFrom === 'roads'
      for (let i = 0; i < n; i++) {
        let baseM: number, exit: number
        if (out.method[i] === M_ROAD) {
          if (fromRoads) continue
          baseM = out.trackM[i]
          exit = i
        } else {
          const pick = groundChoice(layers, i)
          if (!pick) continue
          const f = pick === 'road' ? layers.viaRoad : layers.viaTrail
          baseM = f.forestM[i] + f.trackM[i]
          exit = f.exit[i]
        }
        const row = (i / width) | 0,
          col = i - row * width
        let edge = false
        for (let k = 0; k < 8 && !edge; k++) {
          const r = row + NEIGHBOURS[k][0],
            c = col + NEIGHBOURS[k][1]
          if (r < 0 || c < 0 || r >= height || c >= width) continue
          if (!canDrive(r * width + c)) edge = true
        }
        if (edge) sources.push({ cell: i, baseM, choiceBase: baseM, exit })
      }
      if (sources.length) {
        const edgeWinch = emptyWinchField(n)
        yield* castWinchLines(winchGround(eg, masks), sources, settings.winch, edgeWinch, optimistic)
        for (let i = 0; i < n; i++) {
          if (covered(i) || !Number.isFinite(edgeWinch.winchM[i])) continue
          const source = edgeWinch.source[i]
          // A line from a road or trail is road winching, whichever pass cast it.
          const fromRoad = out.method[source] === M_ROAD
          let forestM = 0,
            trackM = out.trackM[source],
            reach = out.reach[source]
          if (!fromRoad) {
            const f = groundChoice(layers, source) === 'road' ? layers.viaRoad : layers.viaTrail
            forestM = f.forestM[source]
            trackM = f.trackM[source]
            reach = f.reach[source]
          }
          set(i, fromRoad ? M_WINCH_ROAD : M_WINCH_EDGE, forestM, trackM, edgeWinch.winchM[i], reach, edgeWinch.exit[i])
        }
      }
    }
    return out
  }
  // Forwarder: straight runs from roads replace free travel when shorter.
  const rule = settings.forwarder
  const reachOf = (forestM: number, trackM: number) => (forestM + trackM) / rule.reachM
  const choiceOf = (i: number) => out.forestM[i] + TRACK_CHOICE_WEIGHT * out.trackM[i]
  const steepUsed = new Float32Array(n)
  const runs = layers.runs!
  for (let i = 0; i < n; i++)
    if (out.method[i] !== M_ROAD && Number.isFinite(runs.forestM[i]) && (!covered(i) || runs.choice[i] < choiceOf(i))) {
      set(i, M_RUN, runs.forestM[i], runs.trackM[i], 0, reachOf(runs.forestM[i], runs.trackM[i]), runs.exit[i])
      steepUsed[i] = runs.steepUsedM[i]
    }
  // Second pass: runs from the edge of everything reached, carrying distance and steep ground used.
  // A run is straight because the machine cannot turn across a steep slope, so a new run starts
  // only where it can turn: on ground within the side-slope limit.
  const isEdge = (i: number, test: (v: number) => boolean) => {
    const row = (i / width) | 0,
      col = i - row * width
    for (let k = 0; k < 8; k++) {
      const r = row + NEIGHBOURS[k][0],
        c = col + NEIGHBOURS[k][1]
      if (r < 0 || c < 0 || r >= height || c >= width) continue
      if (test(r * width + c)) return true
    }
    return false
  }
  const second: RunSource[] = []
  for (let i = 0; i < n; i++)
    if (
      (out.method[i] === M_GROUND || out.method[i] === M_RUN) &&
      (sg.slopePercent[i] <= rule.sideSlopePercent || (optimistic && !Number.isFinite(sg.slopePercent[i]))) &&
      isEdge(i, (v) => !covered(v))
    )
      second.push({
        cell: i,
        forestM: out.forestM[i],
        trackM: out.trackM[i],
        steepUsedM: steepUsed[i],
        exit: out.exit[i],
      })
  if (second.length) {
    const field = emptyRunField(n)
    yield* castRuns(forwarderGround(eg, masks), second, rule, field, optimistic)
    for (let i = 0; i < n; i++)
      if (
        out.method[i] !== M_ROAD &&
        Number.isFinite(field.forestM[i]) &&
        (!covered(i) || field.choice[i] < choiceOf(i) - 1e-9)
      )
        set(i, M_RUN, field.forestM[i], field.trackM[i], 0, reachOf(field.forestM[i], field.trackM[i]), field.exit[i])
  }
  // Crane: cells within reach of the reached area's edge.
  const offsets = craneOffsets(sg.grid.cellM, rule.craneReachM)
  const crane: { cell: number; forestM: number; trackM: number; exit: number; choice: number }[] = []
  const best = new Float64Array(n).fill(Infinity)
  for (let i = 0; i < n; i++) {
    if (!covered(i)) continue
    const total = out.totalM[i]
    if (!isEdge(i, (v) => !covered(v) || out.totalM[v] > total + rule.craneReachM)) continue
    const row = (i / width) | 0,
      col = i - row * width
    for (const o of offsets) {
      const r = row + o.dr,
        c = col + o.dc
      if (r < 0 || c < 0 || r >= height || c >= width) continue
      const v = r * width + c
      if (!masks.loadable[v] || (!optimistic && !Number.isFinite(z[v]))) continue
      const forestM = out.forestM[i] + o.d
      if (forestM + out.trackM[i] > rule.reachM + 1e-9) continue
      const choice = forestM + TRACK_CHOICE_WEIGHT * out.trackM[i]
      if (choice >= best[v] || (covered(v) && choice >= choiceOf(v) - 1e-9)) continue
      best[v] = choice
      crane.push({ cell: v, forestM, trackM: out.trackM[i], exit: out.exit[i], choice })
    }
  }
  for (const c of crane)
    if (c.choice === best[c.cell] && out.method[c.cell] !== M_ROAD)
      set(c.cell, M_CRANE, c.forestM, c.trackM, 0, reachOf(c.forestM, c.trackM), c.exit)
  return out
}

/** Block cell states from the two runs, and the spur suggester's coarser states. */
function classify(eg: ExtractionGrid, strict: ExtractionCells, optimistic: ExtractionCells) {
  const { sg, settings } = eg
  const z = sg.grid.values
  const n = z.length
  const states = new Uint8Array(n),
    status = new Uint8Array(n)
  // A skyline has no ground slope limit: unfellable ground is the only "too steep" for cable.
  const steepAbove =
    settings.machine === 'skidder'
      ? settings.skid.maxGroundSlopePercent
      : settings.machine === 'forwarder'
        ? steepestDrivenPercent(settings.forwarder)
        : Infinity
  for (const i of sg.blockCells) {
    let state: number
    if (!Number.isFinite(z[i])) state = X_UNKNOWN
    else if (strict.method[i] === M_ROAD) state = X_COVERED
    else if (eg.unfellable[i]) state = X_UNFELLABLE
    else if (eg.noExtraction[i] && strict.method[i] === M_NONE) state = X_EXCLUDED
    else if (strict.method[i] !== M_NONE) state = X_COVERED
    else if (optimistic.method[i] !== M_NONE) state = X_UNKNOWN
    else if (sg.slopePercent[i] > steepAbove) state = X_STEEP
    else state = X_BEYOND
    states[i] = state
    status[i] = state === X_COVERED ? COVERED : state === X_BEYOND ? BEYOND : state === X_UNKNOWN ? UNKNOWN : STEEP
  }
  return { states, status }
}

export interface DistanceClassRow {
  label: string
  fromM: number
  toM: number | null
  ha: number
  /** Share of the block. */
  share: number
  cumulativeHa: number
  cumulativeShare: number
}

export interface ExtractionSummary {
  machine: ExtractionMachine
  cellM: number
  blockHa: number
  /** Hectares by state. */
  stateHa: Record<ExtractionState, number>
  /** Hectares of covered ground by how its logs leave. */
  methodHa: Record<ExtractionMethod, number>
  /** Covered hectares whose logs travel on a skid trail. */
  viaTrailHa: number
  coveredShare: number
  /** Covered share of the block less unknown, too-steep, unfellable and excluded ground. */
  coveredOfExtractable: number
  meanTotalM: number | null
  p95TotalM: number | null
  meanWinchM: number | null
  farthest: { coordinate: Coordinate; totalM: number; covered: boolean } | null
  classes: DistanceClassRow[]
  /** Names of skid trails with cells joined to no truck road; those cells are left out. */
  disconnectedTrails: string[]
}

function summarize(
  eg: ExtractionGrid,
  strict: ExtractionCells,
  states: Uint8Array,
  roadUse: Uint8Array,
  trail: Uint8Array,
): ExtractionSummary {
  const { sg, settings } = eg
  const cellHa = (sg.grid.cellM * sg.grid.cellM) / 10_000
  const stateCount = new Array(EXTRACTION_STATES.length).fill(0),
    methodCount = new Array(EXTRACTION_METHODS.length).fill(0)
  const totals: number[] = [],
    winches: number[] = []
  let viaTrail = 0,
    farthest = -1
  for (const i of sg.blockCells) {
    stateCount[states[i]]++
    if (states[i] === X_COVERED) {
      methodCount[strict.method[i]]++
      totals.push(strict.totalM[i])
      if (strict.winchM[i] > 0) winches.push(strict.winchM[i])
      if (strict.trackM[i] > 0) viaTrail++
    }
    if ((states[i] === X_COVERED || states[i] === X_BEYOND) && Number.isFinite(strict.totalM[i]))
      if (farthest < 0 || strict.totalM[i] > strict.totalM[farthest]) farthest = i
  }
  const block = sg.blockCells.length
  totals.sort((a, b) => a - b)
  const bounds = settings.classBoundsM
  const classes: DistanceClassRow[] = []
  let cumulative = 0
  bounds.forEach((from, k) => {
    const to = k + 1 < bounds.length ? bounds[k + 1] : null
    const count = totals.filter((m) => m >= from && (to === null || m < to)).length
    cumulative += count
    classes.push({
      label: to === null ? `${from} m and over` : `${from}–${to} m`,
      fromM: from,
      toM: to,
      ha: count * cellHa,
      share: block ? count / block : 0,
      cumulativeHa: cumulative * cellHa,
      cumulativeShare: block ? cumulative / block : 0,
    })
  })
  const extractable =
    block - stateCount[X_UNKNOWN] - stateCount[X_STEEP] - stateCount[X_UNFELLABLE] - stateCount[X_EXCLUDED]
  const disconnected: string[] = []
  sg.roads.forEach((road, k) => {
    if (road.road.use !== 'track') return
    if (eg.roadCells[k].some((i) => roadUse[i] === 1 && !trail[i])) disconnected.push(road.road.name)
  })
  const row = Math.floor(farthest / sg.grid.width)
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null)
  return {
    machine: settings.machine,
    cellM: sg.grid.cellM,
    blockHa: block * cellHa,
    stateHa: Object.fromEntries(EXTRACTION_STATES.map((s, k) => [s, stateCount[k] * cellHa])) as Record<
      ExtractionState,
      number
    >,
    methodHa: Object.fromEntries(EXTRACTION_METHODS.map((m, k) => [m, methodCount[k] * cellHa])) as Record<
      ExtractionMethod,
      number
    >,
    viaTrailHa: viaTrail * cellHa,
    coveredShare: block ? stateCount[X_COVERED] / block : 0,
    coveredOfExtractable: extractable > 0 ? stateCount[X_COVERED] / extractable : 0,
    meanTotalM: mean(totals),
    p95TotalM: totals.length ? totals[Math.min(totals.length - 1, Math.floor(0.95 * totals.length))] : null,
    meanWinchM: mean(winches),
    farthest:
      farthest < 0
        ? null
        : {
            coordinate: sg.toLonLat([
              sg.grid.origin[0] + (farthest - row * sg.grid.width) * sg.grid.cellM,
              sg.grid.origin[1] - row * sg.grid.cellM,
            ]),
            totalM: strict.totalM[farthest],
            covered: states[farthest] === X_COVERED,
          },
    classes,
    disconnectedTrails: disconnected,
  }
}

/** A run's state: the layers spur suggestions extend, and everything derived from them. */
export interface ExtractionRunState extends SpurReachState {
  layers: [RunLayers, RunLayers]
  cells: [ExtractionCells, ExtractionCells]
  states: Uint8Array
  roadUse: Uint8Array
  masks: Masks
}

export interface ExtractionResult {
  grid: ExtractionGrid
  /** The run's state; `state.status` uses the skid-reach codes, `state.states` the extraction states. */
  state: ExtractionRunState
  summary: ExtractionSummary
  /** The skid-reach summary of the same run, for spur suggestions. */
  skidSummary: SkidReachSummary
}

/** A spur-compatible reach field from a run's cells: reach used and total distance. */
const reachField = (cells: ExtractionCells): ReachField => ({
  reach: cells.reach,
  skidM: cells.totalM,
  exit: cells.exit,
})

function* finishState(
  eg: ExtractionGrid,
  layers: [RunLayers, RunLayers],
  roadUse: Uint8Array,
  masks: Masks,
): Generator<SkidProgress, ExtractionRunState> {
  const strict = yield* deriveCells(eg, layers[0], masks)
  const optimistic = yield* deriveCells(eg, layers[1], masks)
  const { states, status } = classify(eg, strict, optimistic)
  return {
    layers,
    cells: [strict, optimistic],
    states,
    status,
    roadUse,
    masks,
    strict: reachField(strict),
    optimistic: reachField(optimistic),
  }
}

function resultOf(eg: ExtractionGrid, state: ExtractionRunState): ExtractionResult {
  return {
    grid: eg,
    state,
    summary: summarize(eg, state.cells[0], state.states, state.roadUse, state.layers[0].trail),
    skidSummary: summarizeSkidReach(eg.sg, state.strict, state.status),
  }
}

/** Runs the model on a prepared grid with the roads `include` accepts (all of them by default). */
export function* extractionOnGrid(
  eg: ExtractionGrid,
  include: (road: SkidRoad) => boolean = () => true,
  takeLanding?: LandingFilter,
): Generator<SkidProgress, ExtractionResult> {
  const roadUse = roadUseFor(eg, include, takeLanding)
  const masks = masksFor(eg, roadUse)
  const strict = yield* buildLayers(eg, roadUse, masks, false)
  const optimistic = yield* buildLayers(eg, roadUse, masks, true)
  const state = yield* finishState(eg, [strict, optimistic], roadUse, masks)
  return resultOf(eg, state)
}

/** The whole run: ground, both runs, cell states and the summary. */
export function* extractionReachSteps(input: ExtractionInput): Generator<SkidProgress, ExtractionResult> {
  const eg = yield* prepareExtractionGrid(input)
  return yield* extractionOnGrid(eg)
}

/**
 * A cable run as an extraction result, from the per-cell coverage `cableCoverage.ts` built for the
 * roads `include` accepts (strict and optimistic runs). Lines start from truck roads only, so skid
 * trails are left out. Truck-road cells in the block are within reach, as for the other machines.
 */
export function cableExtractionResult(
  eg: ExtractionGrid,
  include: (road: SkidRoad) => boolean,
  coverage: readonly [ExtractionCells, ExtractionCells],
  takeLanding?: LandingFilter,
): ExtractionResult {
  if (eg.settings.machine !== 'cable') throw Error('Prepare the grid for the cable yarder.')
  const roadUse = roadUseFor(eg, (road) => include(road) && road.use !== 'track', takeLanding)
  const masks = masksFor(eg, roadUse)
  const n = roadUse.length
  const truck = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (roadUse[i] === 2) truck[i] = 1
  const layers = (optimistic: boolean): RunLayers => ({
    optimistic,
    truck,
    trail: new Uint8Array(n),
    trailField: emptyGroundField(n),
    viaRoad: emptyGroundField(n),
    viaTrail: emptyGroundField(n),
    roadWinch: null,
    runs: null,
  })
  const cells = coverage.map((c) => {
    const copy: ExtractionCells = {
      method: new Uint8Array(c.method),
      totalM: new Float32Array(c.totalM),
      forestM: new Float32Array(c.forestM),
      trackM: new Float32Array(c.trackM),
      winchM: new Float32Array(c.winchM),
      reach: new Float64Array(c.reach),
      exit: new Int32Array(c.exit),
    }
    for (let i = 0; i < n; i++)
      if (truck[i]) {
        copy.method[i] = M_ROAD
        copy.totalM[i] = copy.forestM[i] = copy.trackM[i] = copy.reach[i] = 0
        copy.winchM[i] = NaN
        copy.exit[i] = i
      }
    return copy
  }) as [ExtractionCells, ExtractionCells]
  const { states, status } = classify(eg, cells[0], cells[1])
  return resultOf(eg, {
    layers: [layers(false), layers(true)],
    cells,
    states,
    status,
    roadUse,
    masks,
    strict: reachField(cells[0]),
    optimistic: reachField(cells[1]),
  })
}

/**
 * The spur suggester's reach model for an extraction run: a suggested spur is a truck road, so its
 * cells join the truck-road layers (ground paths, road winching, forwarder runs) and the rest is
 * derived again. Trails keep the truck roads they joined in the base run.
 */
export function extractionSpurModel(result: ExtractionResult): SpurReachModel {
  const eg = result.grid
  const rule = passRule(eg)
  return {
    start: result.state,
    covered: (state) => {
      let count = 0
      for (const i of eg.sg.blockCells) if (state.status[i] === COVERED) count++
      return count
    },
    *withRoad(from, seeds) {
      const base = from as ExtractionRunState
      const next: RunLayers[] = []
      for (const layers of base.layers) {
        const truck = new Uint8Array(layers.truck)
        const fresh = seeds.filter((cell) => !truck[cell])
        for (const cell of fresh) truck[cell] = 1
        const viaRoad = copyGroundField(layers.viaRoad)
        yield* propagateGround(
          eg,
          viaRoad,
          fresh.map((cell) => ({ cell, reach: 0, trackM: 0, exit: cell })),
          { passable: base.masks.viaRoadPassable, rule, optimistic: layers.optimistic, forestWeight: 1 },
        )
        const extended: RunLayers = { ...layers, truck, viaRoad }
        if (layers.roadWinch) {
          extended.roadWinch = copyWinchField(layers.roadWinch)
          yield* castWinchLines(
            winchGround(eg, base.masks),
            winchRoadSources(extended, fresh),
            eg.settings.winch,
            extended.roadWinch,
            layers.optimistic,
          )
        }
        if (layers.runs) {
          extended.runs = copyRunField(layers.runs)
          yield* castRuns(
            forwarderGround(eg, base.masks),
            runRoadSources(extended, fresh),
            eg.settings.forwarder,
            extended.runs,
            layers.optimistic,
          )
        }
        next.push(extended)
      }
      return yield* finishState(eg, [next[0], next[1]], base.roadUse, base.masks)
    },
  }
}

/** The extraction result after spur suggestions, from the suggester's final state. */
export const extractionResultFromState = (eg: ExtractionGrid, state: SpurReachState): ExtractionResult =>
  resultOf(eg, state as ExtractionRunState)

export interface ExtractionComparison {
  /** Block hectares within reach only with the added roads. */
  newlyHa: number
  /** Block hectares within reach only without them (should be none). */
  lostHa: number
  /** Block hectares within reach both times whose distance fell by at least `MIN_SHORTENED_M`. */
  shortenedHa: number
  /** Shortened hectares by how much shorter, on the distance-class bounds. */
  shortenedBy: { label: string; ha: number }[]
  meanShortenedM: number | null
  /** Per cell: 0 unchanged, 1 newly within reach, 2 shortened, 3 lost. */
  change: Uint8Array
}
/** Distances shorter by less than this are unchanged. */
export const MIN_SHORTENED_M = 1

/** Before/after a road project: newly accessible ground and distances shortened, by class. */
export function compareExtraction(before: ExtractionResult, after: ExtractionResult): ExtractionComparison {
  const eg = after.grid
  if (before.grid.sg.grid !== eg.sg.grid) throw Error('Compare two runs on the same grid.')
  const cellHa = (eg.sg.grid.cellM * eg.sg.grid.cellM) / 10_000
  const change = new Uint8Array(eg.sg.grid.values.length)
  const bounds = eg.settings.classBoundsM
  const bins = bounds.map(() => 0)
  let newly = 0,
    lost = 0,
    shortened = 0,
    shortenedSum = 0
  const b = before.state,
    a = after.state
  for (const i of eg.sg.blockCells) {
    const was = b.states[i] === X_COVERED,
      is = a.states[i] === X_COVERED
    if (is && !was) {
      change[i] = 1
      newly++
    } else if (was && !is) {
      change[i] = 3
      lost++
    } else if (was && is) {
      const by = b.cells[0].totalM[i] - a.cells[0].totalM[i]
      if (by >= MIN_SHORTENED_M) {
        change[i] = 2
        shortened++
        shortenedSum += by
        let k = bounds.length - 1
        while (k > 0 && by < bounds[k]) k--
        bins[k]++
      }
    }
  }
  return {
    newlyHa: newly * cellHa,
    lostHa: lost * cellHa,
    shortenedHa: shortened * cellHa,
    shortenedBy: bounds.map((from, k) => ({
      label: k + 1 < bounds.length ? `${from}–${bounds[k + 1]} m shorter` : `${from} m or more shorter`,
      ha: bins[k] * cellHa,
    })),
    meanShortenedM: shortened ? shortenedSum / shortened : null,
    change,
  }
}

/** Colours of the distance classes, nearest first. */
export const DISTANCE_CLASS_COLORS = [
  '#15803d',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#c2410c',
  '#9a3412',
  '#7c2d12',
  '#57534e',
]
export const EXTRACTION_MAP_COLORS = {
  beyond: '#dc2626',
  steep: '#7c3aed',
  unfellable: '#4c1d95',
  excluded: '#334155',
  unknown: '#64748b',
  winched: '#0369a1',
  newly: '#16a34a',
  shortened: '#0d9488',
} as const

/** Rings of a cell mask grouped into polygons: each outer ring with the holes inside it. */
export function maskPolygons(sg: SkidGrid, inMask: (index: number) => boolean): XY[][][] {
  const rings = maskOutlines(sg.grid, inMask)
  const area = (ring: XY[]) => {
    let sum = 0
    for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
    return sum / 2
  }
  const inside = (p: XY, ring: XY[]) => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j],
        [bx, by] = ring[i]
      if (ay > p[1] !== by > p[1] && p[0] < ax + ((p[1] - ay) * (bx - ax)) / (by - ay)) hit = !hit
    }
    return hit
  }
  // Outer rings run anticlockwise (the mask on their left), holes clockwise.
  const outers = rings.filter((ring) => area(ring) > 0).map((ring) => ({ ring, area: area(ring), holes: [] as XY[][] }))
  outers.sort((p, q) => p.area - q.area)
  for (const hole of rings.filter((ring) => area(ring) < 0)) {
    // A hole's corner lies on its outer ring's grid lines; test the middle of its first edge, nudged inward.
    const [a, b] = [hole[0], hole[1]]
    const probe: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const nx = -(b[1] - a[1]),
      ny = b[0] - a[0]
    const len = Math.hypot(nx, ny) || 1
    const p: XY = [probe[0] - (nx / len) * 1e-3, probe[1] - (ny / len) * 1e-3]
    const owner = outers.find((outer) => inside(p, outer.ring))
    owner?.holes.push(hole)
  }
  return outers.map((outer) => [outer.ring, ...outer.holes])
}

/**
 * Plan features: covered ground filled by distance class, and outlines of winched, beyond-reach,
 * too-steep, unfellable, excluded and unknown ground.
 */
export function extractionMapFeatures(result: ExtractionResult): GeoJSON.Feature[] {
  const { grid: eg, state } = result
  const sg = eg.sg
  const strict = state.cells[0]
  const bounds = eg.settings.classBoundsM
  const classOf = (m: number) => {
    let k = bounds.length - 1
    while (k > 0 && m < bounds[k]) k--
    return k
  }
  const toLonLat = (ring: XY[]) => ring.map((p) => sg.toLonLat(p))
  const features: { vertices: number; feature: GeoJSON.Feature }[] = []
  bounds.forEach((from, k) => {
    const label = k + 1 < bounds.length ? `${from}–${bounds[k + 1]} m` : `${from} m and over`
    for (const polygon of maskPolygons(sg, (i) => state.states[i] === X_COVERED && classOf(strict.totalM[i]) === k))
      features.push({
        vertices: polygon.reduce((sum, ring) => sum + ring.length, 0),
        feature: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: polygon.map(toLonLat) },
          properties: {
            kind: 'extraction-class',
            fill: true,
            color: DISTANCE_CLASS_COLORS[k % DISTANCE_CLASS_COLORS.length],
            label: `Extraction ${label}`,
          },
        },
      })
  })
  const outlines: [keyof typeof EXTRACTION_MAP_COLORS, (i: number) => boolean, string][] = [
    [
      'winched',
      (i) => state.states[i] === X_COVERED && (strict.method[i] === M_WINCH_ROAD || strict.method[i] === M_WINCH_EDGE),
      'Winched',
    ],
    ['beyond', (i) => state.states[i] === X_BEYOND, 'Beyond extraction reach'],
    ['steep', (i) => state.states[i] === X_STEEP, 'Too steep for the machine'],
    ['unfellable', (i) => state.states[i] === X_UNFELLABLE, 'Too steep to fell'],
    ['excluded', (i) => state.states[i] === X_EXCLUDED, 'No extraction'],
    ['unknown', (i) => state.states[i] === X_UNKNOWN, 'Extraction reach unknown'],
  ]
  for (const [role, test, label] of outlines)
    for (const ring of maskOutlines(sg.grid, (i) => sg.block[i] === 1 && test(i)))
      features.push({
        vertices: ring.length,
        feature: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: toLonLat(ring) },
          properties: { kind: 'skid-reach', role, color: EXTRACTION_MAP_COLORS[role], label },
        },
      })
  return keepWithinBudget(features)
}

/** The features that fit the plan's vertex budget (`MAX_SKID_OUTLINE_VERTICES`), largest first. */
export function keepWithinBudget(features: { vertices: number; feature: GeoJSON.Feature }[]): GeoJSON.Feature[] {
  const order = [...features].sort((a, b) => b.vertices - a.vertices)
  let vertices = 0
  const kept = new Set(order.filter((entry) => (vertices += entry.vertices) <= MAX_SKID_OUTLINE_VERTICES))
  return features.filter((entry) => kept.has(entry)).map((entry) => entry.feature)
}

/** Plan features for a before/after comparison: newly accessible and shortened ground. */
export function comparisonMapFeatures(after: ExtractionResult, comparison: ExtractionComparison): GeoJSON.Feature[] {
  const sg = after.grid.sg
  const features: { vertices: number; feature: GeoJSON.Feature }[] = []
  for (const [code, role, label] of [
    [1, 'newly', 'Newly within reach'],
    [2, 'shortened', 'Extraction distance shortened'],
  ] as const)
    for (const polygon of maskPolygons(sg, (i) => comparison.change[i] === code))
      features.push({
        vertices: polygon.reduce((sum, ring) => sum + ring.length, 0),
        feature: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: polygon.map((ring) => ring.map((p) => sg.toLonLat(p))) },
          properties: { kind: 'extraction-change', fill: true, role, color: EXTRACTION_MAP_COLORS[role], label },
        },
      })
  return keepWithinBudget(features)
}

/** The run as a skid-reach result, for the spur suggester and the landing screen. */
export const asSkidReachResult = (result: ExtractionResult): SkidReachResult => ({
  skidGrid: result.grid.sg,
  strict: result.state.strict,
  optimistic: result.state.optimistic,
  status: result.state.status,
  summary: result.skidSummary,
})

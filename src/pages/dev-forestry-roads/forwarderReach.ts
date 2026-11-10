/**
 * Forwarder rules for the extraction-reach model: where a forwarder may drive, how it reaches
 * steeper ground in straight runs, and how far its crane loads beyond where it drives.
 *
 * - **Free travel.** Ground no steeper than the least of the side-slope, loaded-uphill and
 *   loaded-downhill limits is driven in any direction (`freeTravelSlopePercent`).
 * - **Straight runs.** From a road or trail cell, and again from the edge of everything reached,
 *   the machine may drive a straight line on steeper ground when every cell on it passes:
 *   - longitudinal: a cell above the departure must be no steeper than the loaded-downhill limit
 *     (the loaded machine comes back down), any other cell no steeper than the loaded-uphill limit;
 *   - side slope: the slope across the line, `slope · |sin Δ|` with Δ the angle between the line and
 *     the fall line, must not exceed the side-slope limit (Suvinen 2006, as used by Dupire et al.
 *     2015). This is the exact tangent form; Sylvaccess applies the same rule to slope angles;
 *   - steep-ground budget: the distance travelled along the run over ground steeper than the side
 *     limit must not exceed the budget, counting what the departure has already used.
 * - **Crane.** Cells within the crane's reach (centre to centre) of the reached area are loaded
 *   from it.
 *
 * Sources: Dupire S., Bourrier F., Monnet J.-M., Berger F. (2015), Sylvaccess, Revue forestière
 * française 67(2): 111–126 (eq. 1); Suvinen A. (2006), A GIS-based simulation model for terrain
 * tractability, Journal of Terramechanics 43(4): 427–449; the Sylvaccess 3.6 user notice (INRAE,
 * September 2024). Written from a functional specification; no code from Sylvaccess
 * (GPL-3.0-or-later) was used.
 *
 * Pure: no DOM or network access.
 */
import { rayTable } from './winchReach'

export interface ForwarderRule {
  /** Steepest slope across the machine's track, percent. */
  sideSlopePercent: number
  /** Steepest ground on a run to timber below the departure (the loaded machine climbs back), percent. */
  loadedUphillPercent: number
  /** Steepest ground on a run to timber above the departure (the loaded machine comes down), percent. */
  loadedDownhillPercent: number
  /** Distance a run may travel on ground steeper than the side-slope limit, m. */
  steepBudgetM: number
  /** Crane reach beyond the ground the machine drives on, m. */
  craneReachM: number
  /** Longest forwarding distance (stand plus trail) counted within reach, m. */
  reachM: number
}

/**
 * Sylvaccess 3.6's effective defaults (15 % side, 30 % loaded uphill, 40 % loaded downhill, 300 m
 * steep budget, 8 m crane) and a 500 m forwarding reach, which Sylvaccess does not have: it grades
 * distance by classes. Editable; not a BC standard.
 */
export const DEFAULT_FORWARDER_RULE: ForwarderRule = {
  sideSlopePercent: 15,
  loadedUphillPercent: 30,
  loadedDownhillPercent: 40,
  steepBudgetM: 300,
  craneReachM: 8,
  reachM: 500,
}
export const MIN_FORWARDER_SLOPE_PERCENT = 1
export const MAX_FORWARDER_SLOPE_PERCENT = 100
export const MAX_STEEP_BUDGET_M = 2000
export const MIN_CRANE_M = 2
export const MAX_CRANE_M = 20
export const MIN_FORWARDER_REACH_M = 20
export const MAX_FORWARDER_REACH_M = 2000

const finiteRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max

export function validateForwarderRule(rule: ForwarderRule): ForwarderRule {
  for (const [value, name] of [
    [rule.sideSlopePercent, 'side-slope limit'],
    [rule.loadedUphillPercent, 'loaded-uphill limit'],
    [rule.loadedDownhillPercent, 'loaded-downhill limit'],
  ] as const)
    if (!finiteRange(value, MIN_FORWARDER_SLOPE_PERCENT, MAX_FORWARDER_SLOPE_PERCENT))
      throw Error(`Use a ${name} from ${MIN_FORWARDER_SLOPE_PERCENT}% to ${MAX_FORWARDER_SLOPE_PERCENT}%.`)
  if (!finiteRange(rule.steepBudgetM, 0, MAX_STEEP_BUDGET_M))
    throw Error(`Use a steep-ground run budget from 0 to ${MAX_STEEP_BUDGET_M} m.`)
  if (!finiteRange(rule.craneReachM, MIN_CRANE_M, MAX_CRANE_M))
    throw Error(`Use a crane reach from ${MIN_CRANE_M} to ${MAX_CRANE_M} m.`)
  if (!finiteRange(rule.reachM, MIN_FORWARDER_REACH_M, MAX_FORWARDER_REACH_M))
    throw Error(`Use a forwarding reach from ${MIN_FORWARDER_REACH_M} to ${MAX_FORWARDER_REACH_M} m.`)
  return rule
}

/** Ground driven in any direction: no steeper than any of the three limits. */
export const freeTravelSlopePercent = (rule: ForwarderRule) =>
  Math.min(rule.sideSlopePercent, rule.loadedUphillPercent, rule.loadedDownhillPercent)
/** Ground no run may cross: steeper than every one of the three limits. */
export const steepestDrivenPercent = (rule: ForwarderRule) =>
  Math.max(rule.sideSlopePercent, rule.loadedUphillPercent, rule.loadedDownhillPercent)

/**
 * The slope across a line on bearing (ux east, uy north) over ground of gradient (gx east, gy
 * north, as fractions), percent: the gradient's component square to the line.
 */
export const sideSlopePercent = (ux: number, uy: number, gx: number, gy: number) => 100 * Math.abs(ux * gy - uy * gx)

/**
 * The widest angle from the fall line a run may take on a uniform slope, degrees, with the exact
 * tangent form used here. 90 when the slope is within the side limit.
 */
export const widestRunAngleDeg = (slopePercent: number, rule: ForwarderRule) =>
  slopePercent <= rule.sideSlopePercent ? 90 : (Math.asin(rule.sideSlopePercent / slopePercent) * 180) / Math.PI

/** What the run and crane passes read. */
export interface ForwarderGround {
  width: number
  height: number
  cellM: number
  z: Float64Array
  /** Steepest gradient, percent; NaN where unknown. */
  slopePercent: Float32Array
  /** Gradient components east and north, fractions. */
  gradX: Float32Array
  gradY: Float32Array
  /** 1 where the machine may drive: in the travel band, fellable, no barrier or closed area. */
  drivable: Uint8Array
  /** 1 where the crane may load: fellable, no barrier or no-extraction area. */
  loadable: Uint8Array
}

export interface RunSource {
  cell: number
  /** Distance already travelled in the stand to this cell, m. */
  forestM: number
  /** Along-trail distance from the cell's trail to the truck road, m. */
  trackM: number
  /** Steep-ground distance already used, m. */
  steepUsedM: number
  exit: number
}

/** Per cell: the best run's total, its parts and the steep distance it used. */
export interface RunField {
  choice: Float64Array
  forestM: Float32Array
  trackM: Float32Array
  steepUsedM: Float32Array
  exit: Int32Array
}

export function emptyRunField(cells: number): RunField {
  return {
    choice: new Float64Array(cells).fill(Infinity),
    forestM: new Float32Array(cells).fill(NaN),
    trackM: new Float32Array(cells).fill(NaN),
    steepUsedM: new Float32Array(cells).fill(NaN),
    exit: new Int32Array(cells).fill(-1),
  }
}
export const copyRunField = (f: RunField): RunField => ({
  choice: new Float64Array(f.choice),
  forestM: new Float32Array(f.forestM),
  trackM: new Float32Array(f.trackM),
  steepUsedM: new Float32Array(f.steepUsedM),
  exit: new Int32Array(f.exit),
})

/** Weight of trail distance when choosing between ways out: in-stand metres count ten times as much. */
export const TRACK_CHOICE_WEIGHT = 0.1
const SOURCES_PER_YIELD = 32

/**
 * Casts straight runs from `sources` into `field`, keeping for each cell the run with the least
 * `forestM + run length + 0.1 · trackM`. A run stops at the first cell that fails a rule, at the
 * steep-ground budget, or at the forwarding reach. `optimistic` lets runs cross missing ground as
 * level.
 */
export function* castRuns(
  ground: ForwarderGround,
  sources: readonly RunSource[],
  rule: ForwarderRule,
  field: RunField,
  optimistic: boolean,
): Generator<{ phase: string; done: number; total: number }, void> {
  const { width, height, z, slopePercent, gradX, gradY, drivable } = ground
  const table = rayTable(ground.cellM, rule.reachM)
  const steepest = steepestDrivenPercent(rule)
  for (let s = 0; s < sources.length; s++) {
    if (s % SOURCES_PER_YIELD === 0) yield { phase: 'Casting forwarder runs', done: s, total: sources.length }
    const source = sources[s]
    const zs = z[source.cell]
    const sourceKnown = Number.isFinite(zs)
    if (!sourceKnown && !optimistic) continue
    const left = rule.reachM - source.forestM - source.trackM
    if (!(left > 0)) continue
    const row0 = (source.cell / width) | 0,
      col0 = source.cell - row0 * width
    for (const ray of table.rays) {
      let steep = source.steepUsedM,
        lastLength = 0
      for (let i = 0; i < ray.dh.length; i++) {
        const dh = ray.dh[i]
        if (dh > left) break
        const r = row0 + ray.dr[i],
          c = col0 + ray.dc[i]
        if (r < 0 || c < 0 || r >= height || c >= width) break
        const v = r * width + c
        if (!drivable[v]) break
        const zv = z[v]
        const known = Number.isFinite(zv) && Number.isFinite(slopePercent[v])
        if (!known && !optimistic) break
        let length = dh
        if (known) {
          const slope = slopePercent[v]
          if (slope > steepest) break
          const dz = sourceKnown ? zv - zs : 0
          if (slope > (dz > 0 ? rule.loadedDownhillPercent : rule.loadedUphillPercent)) break
          if (sideSlopePercent(ray.ux, ray.uy, gradX[v], gradY[v]) > rule.sideSlopePercent + 1e-9) break
          length = Math.hypot(dh, dz)
          if (slope > rule.sideSlopePercent) steep += Math.max(0, length - lastLength)
          if (steep > rule.steepBudgetM + 1e-9) break
        }
        lastLength = Math.max(lastLength, length)
        const forestM = source.forestM + length
        if (forestM + source.trackM > rule.reachM + 1e-9) break
        const choice = forestM + TRACK_CHOICE_WEIGHT * source.trackM
        if (choice < field.choice[v] - 1e-9) {
          field.choice[v] = choice
          field.forestM[v] = forestM
          field.trackM[v] = source.trackM
          field.steepUsedM[v] = steep
          field.exit[v] = source.exit
        }
      }
    }
  }
}

/** Cell offsets within `reachM` of a cell centre, with their distances, nearest first. */
export function craneOffsets(cellM: number, reachM: number): { dc: number; dr: number; d: number }[] {
  const out: { dc: number; dr: number; d: number }[] = []
  const span = Math.floor(reachM / cellM)
  for (let dr = -span; dr <= span; dr++)
    for (let dc = -span; dc <= span; dc++) {
      const d = Math.hypot(dc, dr) * cellM
      if ((dc || dr) && d <= reachM + 1e-9) out.push({ dc, dr, d })
    }
  return out.sort((a, b) => a.d - b.d)
}

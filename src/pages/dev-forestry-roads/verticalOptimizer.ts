/**
 * Vertical profile optimizer: the cheapest cut/fill grade line over a fixed horizontal alignment.
 *
 * PVIs sit at a fixed spacing (plus every control point). At each PVI the formation may take one of
 * a ladder of levels around the ground. Section cut and fill areas are solved once per sample
 * station and level and interpolated in between, so the search never re-runs the whole road.
 * Dynamic programming over (previous level, current level) pairs keeps every grade inside its
 * station-range window, every grade change curvable at the requested K within its tangents, and
 * every control inside its tolerance. Curves are then sized from K and the result is a plain list
 * of PVIs that the ordinary analysis re-checks exactly.
 *
 * It minimizes cut × cut rate + fill × fill rate. Haul, borrow, waste and clearing are evaluated by
 * the full analysis afterwards; they are not optimized. Pure: no DOM or network access.
 *
 * The search is a generator so a caller can run it in slices: `optimizeVerticalProfile` runs it in
 * one go, `optimizeVerticalProfileAsync` hands the page a turn between slices and can be cancelled.
 */
import { runCooperatively, runToCompletion, type CooperativeControl } from './cooperative'
import { analyzeRoad, positionAt, sectionAreasAt } from './engine'
import { gradeWindowAt, curvatureRuleAt, formatStation, type VerticalControl } from './verticalStandards'
import { simplifyProfile } from './verticalTools'
import type { Alignment, ContextFeature, RoadSettings, TerrainSource, VerticalPoint } from './types'
import type { CrossingCostItem } from './crossingPlanTypes'

export interface VerticalOptimizationOptions {
  /** Reference-feature/surface components use the same design inputs as the workspace. */
  context?: ContextFeature[]
  referenceSurfaces?: Record<string, TerrainSource>
  verticalReference?: string
  sharedCrossingCosts?: readonly CrossingCostItem[]
  pviSpacingM: number
  /** Centre the permitted vertical band on ground or the existing fitted profile. */
  bandCenter: 'ground' | 'design'
  /** Formation may move this far above or below the ground at a PVI. */
  maxDepthM: number
  levelStepM: number
  /** K for the fitted curves; also the curvature limit during the search. */
  k: number
  /** Hold both ends at ground level (unless a control point sets them). */
  tieEndsToGround: boolean
  /** Cost added per metre of road whose section cannot close (missing ground or no daylight). */
  incompletePenaltyPerM: number
  maxSectionSolves: number
  /** Total candidate level transitions across all imbalance-price runs. */
  maxTransitions: number
  /**
   * The search places a PVI at every spacing step; afterwards, PVIs that move the line by less than
   * this are dropped, provided the simpler line still meets every limit at no more than 1% extra
   * earthwork cost. 0 keeps every PVI.
   */
  simplifyToleranceM: number
  /**
   * `earthwork`: minimize cut and fill at their rates. `total`: also weigh each PVI interval's
   * imbalance (reusable cut minus fill) at several prices, and keep whichever line the full
   * analysis prices lowest, haul, borrow and waste included when they are entered.
   */
  objective: 'earthwork' | 'total'
}
export const DEFAULT_VERTICAL_OPTIMIZATION: VerticalOptimizationOptions = {
  pviSpacingM: 50,
  bandCenter: 'ground',
  maxDepthM: 5,
  levelStepM: 0.5,
  k: 4,
  tieEndsToGround: true,
  incompletePenaltyPerM: 5000,
  maxSectionSolves: 60000,
  maxTransitions: 5000000,
  simplifyToleranceM: 0.3,
  objective: 'earthwork',
}
export interface VerticalOptimizationResult {
  vertical: VerticalPoint[]
  /**
   * Cut and fill at the entered rates from the full analysis of the returned line (curves and
   * simplification included), not the search's interpolated estimate.
   */
  estimatedEarthworkCost: number
  pviCount: number
  levelsPerPvi: number
  sectionSolves: number
  message: string
  /** What the search used, what it held and what it left unsolved. */
  report: VerticalOptimizationReport
}
export interface VerticalOptimizationProgress {
  /** Share of the search done, 0–1. */
  fraction: number
}
/** The record of one run, for the result log: inputs as used, then the full analysis of the returned line. */
export interface VerticalOptimizationReport {
  roadLengthM: number
  objective: 'earthwork' | 'total'
  /** Stations where section areas were solved, and the widest gap between two of them. */
  sections: { count: number; spacingM: number; solves: number }
  pvis: { searched: number; spacingM: number; kept: number; simplified: boolean; movedOffGaps: number }
  band: { centre: 'ground' | 'design'; depthM: number; levelStepM: number; levelsPerPvi: number }
  limits: {
    maxGradePercent: number
    gradeRanges: number
    curveK: number
    minSagK: number | null
    minCrestK: number | null
    minCurveLengthM: number | null
    minTangentLengthM: number | null
    curvatureRanges: number
  }
  /** How each end's level was set. */
  ends: { start: 'ground' | 'control' | 'free'; end: 'ground' | 'control' | 'free' }
  /** Every control point on the road, with what the returned line does there. */
  controls: {
    chainage: number
    elevation: number | null
    achievedElevation: number
    gradePercent: number | null
    achievedGradePercent: number
  }[]
  /** Total cost only: the price put on each interval's cut/fill imbalance for the chosen line, CAD per m³. */
  imbalancePrice: number | null
  result: {
    maxGradePercent: number
    cutM3: number
    fillM3: number
    /** Usable cut left over after filling, as bank m³ to waste. */
    wasteBankM3: number
    /** Fill still needed after all usable cut is placed, m³. */
    borrowM3: number
    earthworkCost: number
    estimatedCost: number
    coveragePercent: number
    incompleteLengthM: number
  }
  /** What the run could not do, in plain words. Empty when there is nothing to add. */
  notes: string[]
}

const EPS = 1e-9
const pct = (value: number) => `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`

/** Fitted parabolic profile, including endpoint tangent extension; independent of terrain. */
export function designElevationAt(points: readonly VerticalPoint[], station: number): number {
  const pv = [...points].sort((a, b) => a.chainage - b.chainage)
  if (pv.length < 2) throw Error('A design-centred band needs at least two vertical controls.')
  const slope = (i: number) => (pv[i + 1].elevation - pv[i].elevation) / (pv[i + 1].chainage - pv[i].chainage)
  for (let i = 1; i < pv.length - 1; i++) {
    const p = pv[i],
      size = p.curveLength
    if (size <= 0 || station < p.chainage - size / 2 || station > p.chainage + size / 2) continue
    const x = station - (p.chainage - size / 2),
      g1 = slope(i - 1),
      g2 = slope(i)
    return p.elevation - (g1 * size) / 2 + g1 * x + ((g2 - g1) * x * x) / (2 * size)
  }
  let i = pv.findIndex((p) => p.chainage >= station) - 1
  if (i < 0) i = station <= pv[0].chainage ? 0 : pv.length - 2
  return pv[i].elevation + slope(i) * (station - pv[i].chainage)
}

/** Ground sampling repeats the same offsets at every trial level; remember it per coordinate. */
function memoTerrain(terrain: TerrainSource): TerrainSource {
  const cache = new Map<string, number>()
  return {
    elevationAt: (lng: number, lat: number) => {
      const key = `${lng.toFixed(9)},${lat.toFixed(9)}`
      let value = cache.get(key)
      if (value === undefined) {
        value = terrain.elevationAt(lng, lat)
        cache.set(key, value)
      }
      return value
    },
  }
}

export function optimizeVerticalProfile(
  alignment: Alignment,
  length: number,
  terrain: TerrainSource,
  settings: RoadSettings,
  options: Partial<VerticalOptimizationOptions> = {},
): VerticalOptimizationResult {
  return runToCompletion(profileSearch(alignment, length, terrain, settings, options))
}

/** The same search in slices: the page stays responsive, progress is reported and `signal` cancels it. */
export function optimizeVerticalProfileAsync(
  alignment: Alignment,
  length: number,
  terrain: TerrainSource,
  settings: RoadSettings,
  options: Partial<VerticalOptimizationOptions> = {},
  control: CooperativeControl<VerticalOptimizationProgress> = {},
): Promise<VerticalOptimizationResult> {
  return runCooperatively(
    profileSearch(alignment, length, terrain, settings, options),
    control,
    'Profile optimization cancelled.',
  )
}

function* profileSearch(
  alignment: Alignment,
  length: number,
  terrain: TerrainSource,
  settings: RoadSettings,
  options: Partial<VerticalOptimizationOptions>,
): Generator<VerticalOptimizationProgress, VerticalOptimizationResult> {
  const o = { ...DEFAULT_VERTICAL_OPTIMIZATION, ...options }
  if (
    ![
      length,
      o.pviSpacingM,
      o.levelStepM,
      o.maxDepthM,
      o.k,
      o.incompletePenaltyPerM,
      o.maxSectionSolves,
      o.maxTransitions,
      o.simplifyToleranceM,
    ].every(Number.isFinite)
  )
    throw Error('Use finite profile search inputs.')
  if (!(length > 1)) throw Error('The road is too short to optimize.')
  if (o.pviSpacingM < 10 || o.levelStepM <= 0 || o.maxDepthM <= 0)
    throw Error('Use a PVI spacing of at least 10 m and positive depth and level steps.')
  if (!(o.k >= 0)) throw Error('Use a K of 0 or more; 0 fits no vertical curves.')
  if (
    !Number.isInteger(o.maxTransitions) ||
    o.maxTransitions < 1 ||
    !Number.isInteger(o.maxSectionSolves) ||
    o.maxSectionSolves < 1 ||
    o.incompletePenaltyPerM < 0 ||
    o.simplifyToleranceM < 0
  )
    throw Error('Use positive integer search budgets and non-negative penalties and tolerance.')
  if (o.objective !== 'earthwork' && o.objective !== 'total') throw Error('Choose a valid profile objective.')
  if (!['ground', 'design'].includes(o.bandCenter)) throw Error('Choose ground or current design for the profile band.')
  if (o.bandCenter === 'design' && alignment.vertical.length < 2)
    throw Error('A design-centred band needs at least two vertical controls.')
  const source = memoTerrain(terrain)
  const sample = Math.max(2, settings.stationInterval)
  const controls = (alignment.verticalControls ?? []).filter((c) => c.chainage >= 0 && c.chainage <= length)

  const groundAt = (s: number) => {
    const p = positionAt(alignment, s)
    const z = source.elevationAt(...p.coordinate)
    return Number.isFinite(z) ? z : null
  }
  // PVI stations: regular spacing, the ends and every control point.
  const marks = new Set<number>([0, length])
  const count = Math.max(1, Math.round(length / o.pviSpacingM))
  if (count + 1 + controls.length > 500)
    throw Error('The profile search needs too many PVIs; use wider spacing or fewer controls.')
  // Where a station at the regular spacing lands on a gap in the terrain, the PVI slides to the
  // nearest station with ground, up to half a spacing away. The spacing is a search setting, not a
  // design requirement, and a level ladder needs ground to stand on.
  let movedOffGaps = 0
  const reach = length / count / 2
  for (let i = 1; i < count; i++) {
    let s = Math.round(((length * i) / count) * 1000) / 1000
    if (groundAt(s) === null)
      for (let d = 1; d < reach; d++) {
        const near = [s - d, s + d].find((x) => x > 0 && x < length && groundAt(x) !== null)
        if (near === undefined) continue
        s = near
        movedOffGaps++
        break
      }
    marks.add(s)
  }
  for (const c of controls) marks.add(c.chainage)
  for (const range of [
    ...(alignment.verticalStandards?.gradeRanges ?? []),
    ...(alignment.verticalStandards?.curvatureRanges ?? []),
  ])
    for (const s of [range.start, range.end]) if (s !== null && s > 0 && s < length) marks.add(s)
  if (marks.size > 500) throw Error('The profile search needs too many PVI/range events; split the road.')
  const pvis = [...marks].sort((a, b) => a - b).filter((s, i, all) => !i || s - all[i - 1] > 1e-6)
  if (pvis[pvis.length - 1] !== length) pvis[pvis.length - 1] = length

  const pviGround = pvis.map(groundAt)
  const elevationControlAt = (s: number) =>
    controls.find((c) => Math.abs(c.chainage - s) < 1e-6 && c.elevation !== null)
  // A tied end has to stand on ground. Every other station only needs a level to search around.
  if (o.tieEndsToGround)
    for (const i of [0, pvis.length - 1])
      if (pviGround[i] === null && !elevationControlAt(pvis[i]))
        throw Error(
          `The road ${i === 0 ? 'start' : 'end'} (${formatStation(pvis[i])}) is on a gap in the terrain, so it cannot be tied to ground. Move that end onto mapped ground, set a control point there, or untick “Tie both ends to ground”.`,
        )
  /** Ground along the centreline, read across a gap from the nearest stations that have it. */
  const groundAcrossGaps = (s: number) => {
    const here = groundAt(s)
    if (here !== null) return here
    let before: { s: number; z: number } | null = null,
      after: { s: number; z: number } | null = null
    for (let x = s - 1; x > -1 && !before; x--) {
      const z = groundAt(Math.max(0, x))
      if (z !== null) before = { s: Math.max(0, x), z }
    }
    for (let x = s + 1; x < length + 1 && !after; x++) {
      const z = groundAt(Math.min(length, x))
      if (z !== null) after = { s: Math.min(length, x), z }
    }
    if (before && after) return before.z + ((after.z - before.z) * (s - before.s)) / (after.s - before.s)
    const only = before ?? after
    if (!only) throw Error('There is no ground under this centreline. Move the road onto the terrain.')
    return only.z
  }
  const referenceAt = (s: number) =>
    o.bandCenter === 'design' ? designElevationAt(alignment.vertical, s) : groundAcrossGaps(s)
  // Candidate levels per PVI: a ladder around ground, narrowed by any control or tied end.
  const ladder = Math.round(o.maxDepthM / o.levelStepM)
  if (2 * ladder + 1 > o.maxTransitions)
    throw Error('Profile transition budget exceeded; use a coarser level step or a smaller search depth.')
  const levels = pvis.map((s, i) => {
    const control = elevationControlAt(s)
    if (control) {
      const low = control.elevation! - control.toleranceBelowM,
        high = control.elevation! + control.toleranceAboveM
      if ((high - low) / o.levelStepM + 1 > o.maxTransitions)
        throw Error('Profile transition budget exceeded; use a coarser level step or narrower control tolerances.')
      // The control's own elevation is a level exactly as entered. Rounding it to the millimetre put
      // it outside a zero tolerance, and a control at the ground the tool had read left no profile.
      const values = [control.elevation!]
      for (let z = Math.ceil(low / o.levelStepM) * o.levelStepM; z <= high + EPS; z += o.levelStepM)
        values.push(Math.min(high, Math.max(low, Math.round(z * 1000) / 1000)))
      return [...new Set(values)].sort((a, b) => a - b)
    }
    if (o.tieEndsToGround && (i === 0 || i === pvis.length - 1)) return [pviGround[i]!]
    const centre = referenceAt(s)
    return Array.from({ length: 2 * ladder + 1 }, (_, j) => centre + (j - ladder) * o.levelStepM)
  })
  // A control's grade has to be met within its tolerance, and steps of a fixed ladder almost never
  // land on it: a grade read off the current profile, held to ±0, left no line at all. So each free
  // PVI beside a grade control also gets the levels that run at exactly that grade from it. Those
  // PVIs, and every control's own, keep their levels unrounded.
  const exactAt = new Set<number>()
  const isFree = (i: number) =>
    i >= 0 &&
    i < pvis.length &&
    !elevationControlAt(pvis[i]) &&
    !(o.tieEndsToGround && (i === 0 || i === pvis.length - 1))
  for (const control of controls) {
    const at = pvis.findIndex((s) => Math.abs(s - control.chainage) < 1e-6)
    if (at < 0) continue
    exactAt.add(at)
    if (control.gradePercent === null) continue
    const through = [...levels[at]]
    for (const beside of [at - 1, at + 1]) {
      if (!isFree(beside)) continue
      const centre = referenceAt(pvis[beside]),
        rise = (control.gradePercent * (pvis[beside] - pvis[at])) / 100
      const exact = through.map((z) => z + rise).filter((z) => Math.abs(z - centre) <= o.maxDepthM + EPS)
      if (!exact.length) continue
      exactAt.add(beside)
      levels[beside] = [...new Set([...levels[beside], ...exact])].sort((a, b) => a - b)
    }
  }

  // Sample stations within each PVI interval, with trapezoid weights.
  const segments = pvis.slice(1).map((end, i) => {
    const start = pvis[i]
    const n = Math.max(1, Math.ceil((end - start) / sample))
    return Array.from({ length: n + 1 }, (_, j) => {
      const s = start + ((end - start) * j) / n
      return { s, t: j / n, weight: ((end - start) / n) * (j === 0 || j === n ? 0.5 : 1) }
    })
  })
  // Area tables: at each sample, cut and fill area over a level grid relative to ground.
  const rows = Math.ceil((o.maxDepthM + 2 * o.levelStepM) / o.levelStepM) + 2
  let solves = 0
  const tables = new Map<
    number,
    { centre: number; ground: number | null; cut: (number | null)[]; fill: (number | null)[] }
  >()
  const tableAt = (s: number) => {
    const key = Math.round(s * 1000)
    const existing = tables.get(key)
    if (existing) return existing
    const place = positionAt(alignment, s)
    const ground = source.elevationAt(...place.coordinate)
    // A station on a gap has no sections to solve; it is priced as incomplete at every level.
    const centre = Number.isFinite(ground) || o.bandCenter === 'design' ? referenceAt(s) : NaN
    const cut: (number | null)[] = [],
      fill: (number | null)[] = []
    if (Number.isFinite(ground))
      for (let r = -rows; r <= rows; r++) {
        if (++solves > o.maxSectionSolves)
          throw Error('The search needs too many section solves; use a wider PVI spacing or a coarser level step.')
        const areas = sectionAreasAt(
          alignment,
          place,
          s,
          centre + r * o.levelStepM,
          settings.crossSectionHalfWidth,
          source,
          { context: o.context, referenceSurfaces: o.referenceSurfaces, verticalReference: o.verticalReference },
        )
        cut.push(areas.cutAreaM2)
        fill.push(areas.fillAreaM2)
      }
    const table = { centre, ground: Number.isFinite(ground) ? ground : null, cut, fill }
    tables.set(key, table)
    return table
  }
  const areasAt = (s: number, z: number) => {
    const table = tableAt(s)
    if (table.ground === null) return null
    const position = (z - table.centre) / o.levelStepM + rows
    const lo = Math.max(0, Math.min(2 * rows - 1, Math.floor(position)))
    const f = Math.max(0, Math.min(1, position - lo))
    const pick = (values: (number | null)[]) =>
      values[lo] === null || values[lo + 1] === null ? null : values[lo]! + (values[lo + 1]! - values[lo]!) * f
    const cut = pick(table.cut),
      fill = pick(table.fill)
    if (cut === null || fill === null || position < 0 || position > 2 * rows) return null
    return { cut, fill }
  }
  // Per interval: earthwork cost, and the net reusable cut minus fill that would have to move elsewhere.
  const segmentTerms = new Map<string, { cost: number; net: number }>()
  const termsOf = (i: number, a: number, b: number) => {
    const key = `${i}:${a}:${b}`
    let terms = segmentTerms.get(key)
    if (terms === undefined) {
      const za = levels[i][a],
        zb = levels[i + 1][b]
      terms = { cost: 0, net: 0 }
      for (const p of segments[i]) {
        const areas = areasAt(p.s, za + (zb - za) * p.t)
        if (!areas) terms.cost += p.weight * o.incompletePenaltyPerM
        else {
          terms.cost += p.weight * (areas.cut * settings.cutRate + areas.fill * settings.fillRate)
          terms.net += p.weight * (areas.cut * settings.shrinkFactor - areas.fill)
        }
      }
      segmentTerms.set(key, terms)
    }
    return terms
  }
  let imbalancePrice = 0
  const costOf = (i: number, a: number, b: number) => {
    const terms = termsOf(i, a, b)
    return terms.cost + imbalancePrice * Math.abs(terms.net)
  }

  const grade = (i: number, a: number, b: number) => (100 * (levels[i + 1][b] - levels[i][a])) / (pvis[i + 1] - pvis[i])
  /** The signed grade window over the interval after PVI `i`: its station ranges inside the road-wide limit. */
  const gradeLimits = (i: number) => {
    const middle = (pvis[i] + pvis[i + 1]) / 2
    const window = gradeWindowAt(alignment.verticalStandards, middle, length)
    return {
      low: Math.max(window.low, -settings.maxGradePercent),
      high: Math.min(window.high, settings.maxGradePercent),
    }
  }
  const gradeAllowed = (i: number, g: number) => {
    const { low, high } = gradeLimits(i)
    return g >= low - EPS && g <= high + EPS
  }
  /** The first control this interval's line would miss, or null when it holds them all. */
  const missedControl = (i: number, a: number, b: number): VerticalControl | null => {
    const za = levels[i][a],
      zb = levels[i + 1][b],
      start = pvis[i],
      end = pvis[i + 1]
    const g = grade(i, a, b)
    for (const c of controls) {
      if (c.chainage < start - EPS || c.chainage > end + EPS) continue
      if (c.elevation !== null) {
        const z = za + ((zb - za) * (c.chainage - start)) / (end - start)
        if (z > c.elevation + c.toleranceAboveM + 1e-6 || z < c.elevation - c.toleranceBelowM - 1e-6) return c
      }
      if (c.gradePercent !== null && Math.abs(g - c.gradePercent) > c.gradeTolerancePercent + 1e-6) return c
    }
    return null
  }
  // The DP retains three levels so the preceding curve's half-length remains in state.
  // Two histories with the same last grade can otherwise have different available tangent.
  const curveLength = (station: number, g1: number, g2: number) => {
    const delta = Math.abs(g2 - g1)
    if (delta <= 0.05) return 0
    let rule = curvatureRuleAt(alignment.verticalStandards, station - 0.0001, station + 0.0001, length)
    if (rule.linear) return Infinity
    let k = Math.max(o.k, g2 > g1 ? rule.minSagK : rule.minCrestK)
    let size = k > 0 ? Math.max(alignment.verticalStandards?.minCurveLengthM ?? 0, k * delta) : 0
    // A larger range-specific K can expand the curve into a further range. Resolve monotonically.
    for (let pass = 0; pass <= (alignment.verticalStandards?.curvatureRanges?.length ?? 0) + 1; pass++) {
      rule = curvatureRuleAt(alignment.verticalStandards, station - size / 2, station + size / 2, length)
      if (rule.linear) return Infinity
      const nextK = Math.max(k, g2 > g1 ? rule.minSagK : rule.minCrestK)
      if (nextK === k) break
      k = nextK
      size = Math.max(alignment.verticalStandards?.minCurveLengthM ?? 0, k * delta)
    }
    return Math.ceil(size * 10 - 1e-8) / 10
  }
  // DP over the last two levels and nondominated preceding half-curve occupancy.
  type Cell = { cost: number; back: string | null; half: number }
  const n = pvis.length
  let transitions = 0
  const transition = () => {
    if (++transitions > o.maxTransitions)
      throw Error(
        'Profile transition budget exceeded; use a coarser level step, a smaller search depth or wider PVI spacing.',
      )
  }
  /**
   * Why the lines tried over one interval were dropped, in the order the checks run. The check at
   * which nothing is left is the limit that conflicts there.
   */
  type Tally = {
    tried: number
    grade: number
    lowestGrade: number
    highestGrade: number
    controls: Map<VerticalControl, number>
    linear: number
    curve: number
    shortestCurveM: number
    tangent: number
  }
  const tally = (): Tally => ({
    tried: 0,
    grade: 0,
    lowestGrade: Infinity,
    highestGrade: -Infinity,
    controls: new Map(),
    linear: 0,
    curve: 0,
    shortestCurveM: Infinity,
    tangent: 0,
  })
  const controlName = (c: VerticalControl) =>
    `Control ${(alignment.verticalControls ?? []).indexOf(c) + 1} at ${formatStation(c.chainage)}`
  /** What holds the level at a PVI, when something does: the search cannot move it. */
  const heldBy = (i: number) => {
    const control = elevationControlAt(pvis[i])
    if (control) return `${controlName(control)} holds the line at ${control.elevation!.toFixed(2)} m`
    if (o.tieEndsToGround && (i === 0 || i === n - 1))
      return `the road ${i === 0 ? 'start' : 'end'} is tied to ground at ${pviGround[i]!.toFixed(2)} m`
    return ''
  }
  const infeasible = (i: number, t: Tally) => {
    const from = formatStation(pvis[i]),
      to = formatStation(pvis[i + 1]),
      band = `±${o.maxDepthM} m of ${o.bandCenter === 'ground' ? 'the ground' : 'the current design'}`
    const afterGrade = t.tried - t.grade
    const missed = [...t.controls].sort((a, b) => b[1] - a[1])[0]?.[0]
    const afterControls = afterGrade - [...t.controls.values()].reduce((sum, count) => sum + count, 0)
    const afterCurves = afterControls - t.linear - t.curve
    let reason: string
    if (!afterGrade) {
      const { low, high } = gradeLimits(i)
      const held = [heldBy(i), heldBy(i + 1)].filter(Boolean)
      reason =
        `Every line within ${band} would run at ${pct(t.lowestGrade)} to ${pct(t.highestGrade)} there, outside the ${pct(low)} to ${pct(high)} grade limit` +
        `${held.length ? `; ${held.join(' and ')}` : ''}. Widen “Search ±” so the line can cut or fill more, ${held.length ? 'loosen what holds it, ' : ''}or relax the grade limit over that stretch.`
    } else if (!afterControls && missed) {
      const { low, high } = gradeLimits(i)
      const asked = missed.gradePercent,
        tolerance = missed.gradeTolerancePercent
      if (asked === null)
        reason = `${controlName(missed)} holds the line at ${missed.elevation!.toFixed(2)} m (+${missed.toleranceAboveM.toFixed(2)}/−${missed.toleranceBelowM.toFixed(2)} m), which no line within ${band} reaches. Widen that control's tolerance or “Search ±”, or move the control.`
      else if (asked + tolerance < low - EPS || asked - tolerance > high + EPS)
        reason = `${controlName(missed)} asks for a grade of ${pct(asked)} (±${tolerance.toFixed(1)}%), outside the ${pct(low)} to ${pct(high)} grade limit there. Change the control's grade or the limit.`
      else
        reason = `${controlName(missed)} asks for a grade of ${pct(asked)} (±${tolerance.toFixed(1)}%), and no line within ${band} runs through it at that grade. Widen the control's grade tolerance or “Search ±”, or move the control.`
    } else if (!afterCurves && t.linear >= t.curve)
      reason = `The grade has to change at ${from}, which is inside a straight-grade-only range. Move that range or relax the limits around it.`
    else if (!afterCurves)
      reason = `The grade change at ${from} needs a vertical curve of at least ${t.shortestCurveM.toFixed(0)} m, and the PVIs either side are ${(pvis[i] - pvis[i - 1]).toFixed(0)} m and ${(pvis[i + 1] - pvis[i]).toFixed(0)} m away. Lower “Curve K” or the minimum sag and crest K, or widen the PVI spacing.`
    else
      reason = `No line leaves the ${alignment.verticalStandards?.minTangentLengthM ?? 0} m minimum tangent before the curve at ${from}. Shorten “Min tangent”, lower “Curve K” or widen the PVI spacing.`
    return Error(`No profile meets the limits between ${from} and ${to}. ${reason} Nothing was changed.`)
  }
  let run = 0,
    runs = 1
  const progress = (i: number): VerticalOptimizationProgress => ({
    fraction: Math.min(1, (run + i / Math.max(1, n - 1)) / runs),
  })
  const solve = function* (): Generator<VerticalOptimizationProgress, { chosen: number[]; cost: number }> {
    let frontier = new Map<string, Cell>()
    const states: Map<string, Cell>[] = []
    let dropped = tally()
    for (let a = 0; a < levels[0].length; a++) {
      for (let b = 0; b < levels[1].length; b++) {
        transition()
        const g = grade(0, a, b)
        dropped.tried++
        dropped.lowestGrade = Math.min(dropped.lowestGrade, g)
        dropped.highestGrade = Math.max(dropped.highestGrade, g)
        if (!gradeAllowed(0, g)) {
          dropped.grade++
          continue
        }
        const missed = missedControl(0, a, b)
        if (missed) {
          dropped.controls.set(missed, (dropped.controls.get(missed) ?? 0) + 1)
          continue
        }
        frontier.set(`-1:${a}:${b}`, { cost: costOf(0, a, b), back: null, half: 0 })
      }
      yield progress(0)
    }
    if (!frontier.size) throw infeasible(0, dropped)
    states.push(frontier)
    for (let i = 1; i < n - 1; i++) {
      const next = new Map<string, Cell>()
      const groups = new Map<string, string[]>()
      const predecessors = new Map<string, { a: number; b: number; histories: { key: string; cell: Cell }[] }>()
      dropped = tally()
      for (const [key, cell] of frontier) {
        const [, a, b] = key.split(':').map(Number)
        const pair = `${a}:${b}`
        let group = predecessors.get(pair)
        if (!group) {
          group = { a, b, histories: [] }
          predecessors.set(pair, group)
        }
        group.histories.push({ key, cell })
      }
      let visited = 0
      for (const { a, b, histories } of predecessors.values()) {
        if (++visited % 16 === 0) yield progress(i)
        // For a fixed last pair and next level, every feasible history produces the same
        // curve length and output state. Query the cheapest allowable predecessor once,
        // rather than expanding that identical transition from each tangent history.
        histories.sort((x, y) => x.cell.half - y.cell.half || x.cell.cost - y.cell.cost)
        const cheapestPrefix: typeof histories = []
        for (let j = 0; j < histories.length; j++) {
          const previous = cheapestPrefix[j - 1]
          cheapestPrefix.push(!previous || histories[j].cell.cost < previous.cell.cost ? histories[j] : previous)
        }
        const g1 = grade(i - 1, a, b)
        for (let c = 0; c < levels[i + 1].length; c++) {
          transition()
          const g2 = grade(i, b, c)
          dropped.tried++
          dropped.lowestGrade = Math.min(dropped.lowestGrade, g2)
          dropped.highestGrade = Math.max(dropped.highestGrade, g2)
          if (!gradeAllowed(i, g2)) {
            dropped.grade++
            continue
          }
          const missed = missedControl(i, b, c)
          if (missed) {
            dropped.controls.set(missed, (dropped.controls.get(missed) ?? 0) + 1)
            continue
          }
          const half = curveLength(pvis[i], g1, g2) / 2
          const before = pvis[i] - pvis[i - 1],
            after = pvis[i + 1] - pvis[i]
          if (!Number.isFinite(half)) {
            dropped.linear++
            continue
          }
          if (half > before + 1e-6 || half > after + 1e-6) {
            dropped.curve++
            dropped.shortestCurveM = Math.min(dropped.shortestCurveM, half * 2)
            continue
          }
          const minimumTangent = i > 1 && half > 0 ? (alignment.verticalStandards?.minTangentLengthM ?? 0) : 0
          // A preceding straight grade (half=0) does not require an interior tangent.
          const limit = Math.max(0, before - half - minimumTangent) + 1e-6
          let low = 0,
            high = histories.length
          while (low < high) {
            const middle = (low + high) >>> 1
            if (histories[middle].cell.half <= limit) low = middle + 1
            else high = middle
          }
          if (!low) {
            dropped.tangent++
            continue
          }
          const { key, cell } = cheapestPrefix[low - 1]
          const cost = cell.cost + costOf(i, b, c)
          const target = `${a}:${b}:${c}`
          const groupKey = `${b}:${c}`,
            group = groups.get(groupKey) ?? []
          // Future feasibility depends only on the last grade and occupied half-curve.
          // Keep the Pareto frontier of cost and occupied tangent, not every history.
          if (
            group.some((k) => {
              const v = next.get(k)!
              return v.cost <= cost + EPS && v.half <= half + EPS
            })
          )
            continue
          const survivors = group.filter((k) => {
            const v = next.get(k)!
            if (cost <= v.cost + EPS && half <= v.half + EPS) {
              next.delete(k)
              return false
            }
            return true
          })
          next.set(target, { cost, back: key, half })
          groups.set(groupKey, [...survivors, target])
        }
      }
      if (!next.size) throw infeasible(i, dropped)
      states.push(next)
      frontier = next
      yield progress(i)
    }
    let best: { key: string; cell: Cell } | null = null
    for (const [key, cell] of frontier) if (!best || cell.cost < best.cell.cost) best = { key, cell }
    if (!best) throw Error('No profile meets the grade and control limits within the search range.')

    // Walk back: states[k] holds pairs (level at PVI k, level at PVI k + 1); `back` is PVI k − 1.
    const chosen = new Array<number>(n)
    let pair = best.key
    for (let k = n - 2; k >= 0; k--) {
      const [, previous, current] = pair.split(':').map(Number)
      chosen[k] = previous
      chosen[k + 1] = current
      const cell = states[k].get(pair)!
      if (k > 0) pair = cell.back!
    }

    return { chosen, cost: best.cell.cost }
  }

  const fitted = (line: { chainage: number; elevation: number }[]): VerticalPoint[] =>
    line.map((p, i) => ({
      id: `opt-${i}-${Math.round(p.chainage * 10)}`,
      chainage: p.chainage,
      elevation: p.elevation,
      curveLength:
        i === 0 || i === line.length - 1
          ? 0
          : curveLength(
              p.chainage,
              (100 * (p.elevation - line[i - 1].elevation)) / (p.chainage - line[i - 1].chainage),
              (100 * (line[i + 1].elevation - p.elevation)) / (line[i + 1].chainage - p.chainage),
            ),
    }))
  const check = (v: VerticalPoint[]) =>
    analyzeRoad({ ...alignment, vertical: v }, terrain, settings, o.context, {
      referenceSurfaces: o.referenceSurfaces,
      verticalReference: o.verticalReference,
      sharedCrossingCosts: o.sharedCrossingCosts,
    })
  // Curves move the formation away from their PVI elevation. Solve the retained control
  // PVIs against the actual parabola, then recheck all geometry, grades and K limits.
  // This bounded correction never accepts a missed control merely because its tangent fits.
  const fitElevationControls = (input: VerticalPoint[]) => {
    let line = input
    for (let pass = 0; pass < 24; pass++) {
      let worst = 0
      for (const control of controls) {
        if (control.elevation === null) continue
        const index = line.findIndex((p) => Math.abs(p.chainage - control.chainage) < 1e-6)
        if (index < 0) continue
        const actual = designElevationAt(line, control.chainage)
        const target = Math.max(
          control.elevation - control.toleranceBelowM,
          Math.min(control.elevation + control.toleranceAboveM, actual),
        )
        const correction = target - actual
        worst = Math.max(worst, Math.abs(correction))
        if (Math.abs(correction) < 1e-8) continue
        const shifted = line.map((p, i) => (i === index ? { ...p, elevation: p.elevation + 0.001 } : p))
        const refit = fitted(shifted)
        const derivative = (designElevationAt(refit, control.chainage) - actual) / 0.001
        if (!Number.isFinite(derivative) || Math.abs(derivative) < 0.01) continue
        const delta = Math.max(-o.maxDepthM, Math.min(o.maxDepthM, correction / derivative))
        line = fitted(line.map((p, i) => (i === index ? { ...p, elevation: p.elevation + delta } : p)))
      }
      if (worst < 1e-7) break
    }
    return line
  }
  const earthwork = (a: ReturnType<typeof check>) =>
    a.cutVolumeM3 * settings.cutRate + a.fillVolumeM3 * settings.fillRate
  const score = (a: ReturnType<typeof check>) => (o.objective === 'total' ? a.estimatedCost : earthwork(a))
  // Drop PVIs with no grade change, size curves from K within their tangents, then simplify if it costs ≤ 1%.
  const finish = (chosen: number[]) => {
    // A level a control depends on stays exact; every other level is a whole millimetre.
    const raw = pvis.map((s, i) => ({
      chainage: s,
      elevation: exactAt.has(i) ? levels[i][chosen[i]] : Math.round(levels[i][chosen[i]] * 1000) / 1000,
    }))
    const kept = raw.filter((p, i) => {
      if (i === 0 || i === raw.length - 1) return true
      if (controls.some((c) => Math.abs(c.chainage - p.chainage) < 1e-6)) return true
      const g1 = (p.elevation - raw[i - 1].elevation) / (p.chainage - raw[i - 1].chainage)
      const g2 = (raw[i + 1].elevation - p.elevation) / (raw[i + 1].chainage - p.chainage)
      return Math.abs(g2 - g1) * 100 > 0.05
    })
    let vertical = fitElevationControls(fitted(kept))
    let analysis = check(vertical)
    let simplified = false
    if (o.simplifyToleranceM > 0 && vertical.length > 3) {
      const lighter = fitElevationControls(
        fitted(
          simplifyProfile(
            vertical,
            o.simplifyToleranceM,
            controls.map((c) => c.chainage),
          ),
        ),
      )
      if (lighter.length < vertical.length) {
        const light = check(lighter)
        const ok =
          !light.verticalChecks?.length &&
          light.maxGradePercent <= settings.maxGradePercent + 1e-6 &&
          light.coveragePercent >= analysis.coveragePercent - 1e-6 &&
          score(light) <= score(analysis) * 1.01 + 1
        if (ok) {
          vertical = lighter
          analysis = light
          simplified = true
        }
      }
    }
    return { vertical, analysis, simplified }
  }
  // Total cost: the DP cannot carry a running mass balance, so price interval imbalance at a few
  // levels and keep the line the full analysis (haul, borrow, waste) prices lowest.
  const haul = alignment.engineering?.haul
  const unit = Math.max(1, settings.fillRate, haul?.borrowRate ?? 0, haul?.wasteRate ?? 0)
  const prices = o.objective === 'total' ? [0, 0.25, 0.5, 1, 2].map((x) => x * unit) : [0]
  let chosenResult: (ReturnType<typeof finish> & { cost: number; price: number }) | null = null
  let failedCheck = '',
    failedLines = 0
  runs = prices.length
  for (const price of prices) {
    imbalancePrice = price
    const solved = yield* solve()
    const result = finish(solved.chosen)
    run++
    yield progress(0)
    // Fitting curves moves the line off its PVIs, and can shrink K/lengths or move it
    // outside a station-range limit. Only a rechecked candidate can be adopted.
    const checkFailure =
      result.analysis.verticalChecks?.[0]?.message ||
      (o.objective === 'total' && result.analysis.crossingEstimate?.complete === false
        ? 'Stream crossing estimates need review or prices before total-cost optimization.'
        : '') ||
      (result.analysis.engineering?.haul.optimizationStatus === 'infeasible' ||
      (o.objective === 'total' && result.analysis.engineering?.haul.enabled && !result.analysis.engineering.complete)
        ? 'The engineering material/haul prescription is incomplete or infeasible.'
        : '') ||
      (result.analysis.maxGradePercent > settings.maxGradePercent + 1e-6 ? 'Road-wide maximum grade exceeded.' : '')
    if (checkFailure) {
      failedCheck = checkFailure
      failedLines++
      continue
    }
    if (!chosenResult || score(result.analysis) < score(chosenResult.analysis))
      chosenResult = { ...result, cost: solved.cost, price }
  }
  if (!chosenResult)
    throw Error(
      `The fitted profile failed a vertical standard or control: ${failedCheck} Adjust Curve K, PVI spacing, search depth or control tolerances and run again; no road was changed.`,
    )
  const { vertical, simplified, analysis } = chosenResult
  const endSetBy = (i: number) =>
    elevationControlAt(pvis[i]) ? ('control' as const) : o.tieEndsToGround ? ('ground' as const) : ('free' as const)
  const wasteBankM3 = settings.shrinkFactor > 0 ? Math.max(0, analysis.balanceM3) / settings.shrinkFactor : 0,
    borrowM3 = Math.max(0, -analysis.balanceM3)
  const incompleteLengthM = Math.max(0, analysis.length - analysis.completeLength)
  const whole = (value: number) => Math.round(value).toLocaleString('en-CA')
  const notes: string[] = []
  if (incompleteLengthM > 0.05)
    notes.push(
      `${whole(incompleteLengthM)} m of the road has no complete section (a gap in the terrain, or a batter that does not reach ground). Cut, fill and cost leave that length out.`,
    )
  if (movedOffGaps)
    notes.push(
      `${movedOffGaps} PVI${movedOffGaps === 1 ? ' was' : 's were'} moved off a gap in the terrain to the nearest station with ground.`,
    )
  // Past a tenth of the earthwork, the leftover is a result of the line, not of rounding its levels.
  if (Math.max(wasteBankM3, borrowM3) > Math.max(50, 0.1 * (analysis.cutVolumeM3 + analysis.fillVolumeM3))) {
    const weigh =
      o.objective === 'earthwork'
        ? ' “Cut and fill” prices each on its own; “Total cost” weighs the balance once haul, borrow and waste rates are entered.'
        : ''
    notes.push(
      wasteBankM3 > borrowM3
        ? `Cut and fill do not balance: ${whole(wasteBankM3)} m³ of cut (bank) is left over as waste.${weigh}`
        : `Cut and fill do not balance: ${whole(borrowM3)} m³ of fill has to be borrowed.${weigh}`,
    )
  }
  for (const [i, label] of [
    [0, 'start'],
    [n - 1, 'end'],
  ] as const) {
    const ground = pviGround[i],
      at = vertical[i === 0 ? 0 : vertical.length - 1].elevation
    if (endSetBy(i) === 'free' && ground !== null && Math.abs(at - ground) > 0.05)
      notes.push(
        `The road ${label} is not tied: the line is ${Math.abs(at - ground).toFixed(1)} m ${at > ground ? 'above' : 'below'} ground there.`,
      )
  }
  if (failedLines)
    notes.push(
      `${failedLines} of ${prices.length} trial lines failed a check once curves were fitted and were dropped: ${failedCheck}`,
    )
  const gradeOf = (station: number) => {
    const a = Math.max(0, station - 0.01),
      b = Math.min(length, station + 0.01)
    return (100 * (designElevationAt(vertical, b) - designElevationAt(vertical, a))) / (b - a)
  }
  return {
    vertical,
    estimatedEarthworkCost: earthwork(analysis),
    pviCount: vertical.length,
    levelsPerPvi: 2 * ladder + 1,
    sectionSolves: solves,
    message: `Optimized ${vertical.length} PVIs${simplified ? ` (simplified within ${o.simplifyToleranceM} m)` : ''} from a ${o.pviSpacingM} m search, ±${o.maxDepthM} m around ${o.bandCenter} in ${o.levelStepM} m steps, K ≥ ${o.k} plus entered sag/crest/range rules${o.objective === 'total' ? `, lowest total cost with imbalance at $${chosenResult.price.toFixed(2)}/m³` : ''}.`,
    report: {
      roadLengthM: length,
      objective: o.objective,
      sections: {
        count: tables.size,
        spacingM: Math.max(...segments.map((segment) => segment[1].s - segment[0].s)),
        solves,
      },
      pvis: { searched: n, spacingM: length / count, kept: vertical.length, simplified, movedOffGaps },
      band: { centre: o.bandCenter, depthM: o.maxDepthM, levelStepM: o.levelStepM, levelsPerPvi: 2 * ladder + 1 },
      limits: {
        maxGradePercent: settings.maxGradePercent,
        gradeRanges: alignment.verticalStandards?.gradeRanges.length ?? 0,
        curveK: o.k,
        minSagK: alignment.verticalStandards?.minSagK ?? null,
        minCrestK: alignment.verticalStandards?.minCrestK ?? null,
        minCurveLengthM: alignment.verticalStandards?.minCurveLengthM ?? null,
        minTangentLengthM: alignment.verticalStandards?.minTangentLengthM ?? null,
        curvatureRanges: alignment.verticalStandards?.curvatureRanges?.length ?? 0,
      },
      ends: { start: endSetBy(0), end: endSetBy(n - 1) },
      controls: controls.map((c) => ({
        chainage: c.chainage,
        elevation: c.elevation,
        achievedElevation: designElevationAt(vertical, c.chainage),
        gradePercent: c.gradePercent,
        achievedGradePercent: gradeOf(c.chainage),
      })),
      imbalancePrice: o.objective === 'total' ? chosenResult.price : null,
      result: {
        maxGradePercent: analysis.maxGradePercent,
        cutM3: analysis.cutVolumeM3,
        fillM3: analysis.fillVolumeM3,
        wasteBankM3,
        borrowM3,
        earthworkCost: earthwork(analysis),
        estimatedCost: analysis.estimatedCost,
        coveragePercent: analysis.coveragePercent,
        incompleteLengthM,
      },
      notes,
    },
  }
}

/** The run as label and value rows, in the order a designer checks them: what went in, then what came out. */
export function verticalOptimizationLog(report: VerticalOptimizationReport): { label: string; value: string }[] {
  const whole = (value: number) => Math.round(value).toLocaleString('en-CA')
  const metres = (value: number) => `${Number(value.toFixed(1))} m`
  const { sections, pvis, band, limits, ends, result } = report
  const end = { ground: 'tied to ground', control: 'held by a control point', free: 'free' }
  const curves = [
    `K ≥ ${limits.curveK}`,
    limits.minSagK !== null && `sag K ≥ ${limits.minSagK}`,
    limits.minCrestK !== null && `crest K ≥ ${limits.minCrestK}`,
    limits.minCurveLengthM !== null && `curves ≥ ${limits.minCurveLengthM} m`,
    limits.minTangentLengthM !== null && `tangents ≥ ${limits.minTangentLengthM} m`,
    limits.curvatureRanges > 0 && `${limits.curvatureRanges} curvature range${limits.curvatureRanges === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return [
    { label: 'Sections sampled', value: `${whole(sections.count)}, at most ${metres(sections.spacingM)} apart` },
    {
      label: 'PVIs',
      value: `${pvis.searched} searched, ${metres(pvis.spacingM)} apart; ${pvis.kept} kept${pvis.simplified ? ' after simplifying' : ''}`,
    },
    {
      label: 'Search band',
      value: `±${band.depthM} m around ${band.centre === 'ground' ? 'ground' : 'the current design'}, ${band.levelStepM} m steps`,
    },
    {
      label: 'Grade limit',
      value: `${limits.maxGradePercent}%${limits.gradeRanges ? ` and ${limits.gradeRanges} station range${limits.gradeRanges === 1 ? '' : 's'}` : ''}`,
    },
    { label: 'Vertical curves', value: curves.join(', ') },
    { label: 'Road ends', value: `Start ${end[ends.start]}; end ${end[ends.end]}` },
    ...report.controls.map((control) => ({
      label: `Control at ${formatStation(control.chainage)}`,
      value: [
        control.elevation !== null && `${control.achievedElevation.toFixed(2)} m`,
        control.gradePercent !== null && pct(control.achievedGradePercent),
        'held',
      ]
        .filter(Boolean)
        .join(', '),
    })),
    {
      label: 'Objective',
      value:
        report.objective === 'total'
          ? `Total cost; imbalance priced at $${(report.imbalancePrice ?? 0).toFixed(2)}/m³`
          : 'Cut and fill',
    },
    { label: 'Steepest grade', value: pct(result.maxGradePercent) },
    { label: 'Cut / fill', value: `${whole(result.cutM3)} / ${whole(result.fillM3)} m³` },
    result.wasteBankM3 >= 0.5
      ? { label: 'Waste', value: `${whole(result.wasteBankM3)} m³ (bank)` }
      : result.borrowM3 >= 0.5
        ? { label: 'Borrow', value: `${whole(result.borrowM3)} m³` }
        : { label: 'Waste / borrow', value: 'None' },
    { label: 'Cut and fill cost', value: `$${whole(result.earthworkCost)}` },
    {
      label: result.coveragePercent >= 100 - 1e-5 ? 'Base estimate' : 'Base estimate, covered length',
      value: `$${whole(result.estimatedCost)}`,
    },
  ]
}

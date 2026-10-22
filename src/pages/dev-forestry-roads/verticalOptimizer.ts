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
 */
import { analyzeRoad, positionAt, sectionAreasAt } from './engine'
import { gradeWindowAt } from './verticalStandards'
import { curveLengthsForK, simplifyProfile } from './verticalTools'
import type { Alignment, RoadSettings, TerrainSource, VerticalPoint } from './types'

export interface VerticalOptimizationOptions {
  pviSpacingM: number
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
  maxDepthM: 5,
  levelStepM: 0.5,
  k: 4,
  tieEndsToGround: true,
  incompletePenaltyPerM: 5000,
  maxSectionSolves: 60000,
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
}

const EPS = 1e-9

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
  const o = { ...DEFAULT_VERTICAL_OPTIMIZATION, ...options }
  if (!(length > 1)) throw Error('The road is too short to optimize.')
  if (o.pviSpacingM < 10 || o.levelStepM <= 0 || o.maxDepthM <= 0)
    throw Error('Use a PVI spacing of at least 10 m and positive depth and level steps.')
  if (!(o.k >= 0)) throw Error('Use a K of 0 or more; 0 fits no vertical curves.')
  const source = memoTerrain(terrain)
  const sample = Math.max(2, settings.stationInterval)
  const controls = (alignment.verticalControls ?? []).filter((c) => c.chainage >= 0 && c.chainage <= length)

  // PVI stations: regular spacing, the ends and every control point.
  const marks = new Set<number>([0, length])
  const count = Math.max(1, Math.round(length / o.pviSpacingM))
  for (let i = 1; i < count; i++) marks.add(Math.round(((length * i) / count) * 1000) / 1000)
  for (const c of controls) marks.add(c.chainage)
  const pvis = [...marks].sort((a, b) => a - b).filter((s, i, all) => !i || s - all[i - 1] > 1)
  if (pvis[pvis.length - 1] !== length) pvis[pvis.length - 1] = length

  const groundAt = (s: number) => {
    const p = positionAt(alignment, s)
    const z = source.elevationAt(...p.coordinate)
    return Number.isFinite(z) ? z : null
  }
  const pviGround = pvis.map(groundAt)
  if (pviGround.some((z) => z === null)) throw Error('Every PVI station needs ground under the centreline.')

  // Candidate levels per PVI: a ladder around ground, narrowed by any control or tied end.
  const ladder = Math.round(o.maxDepthM / o.levelStepM)
  const levels = pvis.map((s, i) => {
    const ground = pviGround[i]!
    const control = controls.find((c) => Math.abs(c.chainage - s) < 1e-6 && c.elevation !== null)
    if (control) {
      const low = control.elevation! - control.toleranceBelowM,
        high = control.elevation! + control.toleranceAboveM
      const values = [control.elevation!]
      for (let z = Math.ceil(low / o.levelStepM) * o.levelStepM; z <= high + EPS; z += o.levelStepM) values.push(z)
      return [...new Set(values.map((z) => Math.round(z * 1000) / 1000))].sort((a, b) => a - b)
    }
    if (o.tieEndsToGround && (i === 0 || i === pvis.length - 1)) return [ground]
    return Array.from({ length: 2 * ladder + 1 }, (_, j) => ground + (j - ladder) * o.levelStepM)
  })

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
  const tables = new Map<number, { ground: number | null; cut: (number | null)[]; fill: (number | null)[] }>()
  const tableAt = (s: number) => {
    const key = Math.round(s * 1000)
    const existing = tables.get(key)
    if (existing) return existing
    const place = positionAt(alignment, s)
    const ground = source.elevationAt(...place.coordinate)
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
          ground + r * o.levelStepM,
          settings.crossSectionHalfWidth,
          source,
        )
        cut.push(areas.cutAreaM2)
        fill.push(areas.fillAreaM2)
      }
    const table = { ground: Number.isFinite(ground) ? ground : null, cut, fill }
    tables.set(key, table)
    return table
  }
  const areasAt = (s: number, z: number) => {
    const table = tableAt(s)
    if (table.ground === null) return null
    const position = (z - table.ground) / o.levelStepM + rows
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
  const gradeAllowed = (i: number, g: number) => {
    const middle = (pvis[i] + pvis[i + 1]) / 2
    const window = gradeWindowAt(alignment.verticalStandards, middle, length)
    const low = Math.max(window.low, -settings.maxGradePercent),
      high = Math.min(window.high, settings.maxGradePercent)
    return g >= low - EPS && g <= high + EPS
  }
  const controlsAllowed = (i: number, a: number, b: number) => {
    const za = levels[i][a],
      zb = levels[i + 1][b],
      start = pvis[i],
      end = pvis[i + 1]
    const g = grade(i, a, b)
    for (const c of controls) {
      if (c.chainage < start - EPS || c.chainage > end + EPS) continue
      if (c.elevation !== null) {
        const z = za + ((zb - za) * (c.chainage - start)) / (end - start)
        if (z > c.elevation + c.toleranceAboveM + 1e-6 || z < c.elevation - c.toleranceBelowM - 1e-6) return false
      }
      if (c.gradePercent !== null && Math.abs(g - c.gradePercent) > c.gradeTolerancePercent + 1e-6) return false
    }
    return true
  }
  // A grade change is curvable when its K-length curve fits within half of each adjoining tangent.
  const curvable = (i: number, g1: number, g2: number) =>
    o.k * Math.abs(g2 - g1) <= Math.min(pvis[i] - pvis[i - 1], pvis[i + 1] - pvis[i]) + 1e-6

  // DP over (previous level, current level) at each PVI.
  type Cell = { cost: number; back: number }
  const n = pvis.length
  const solve = () => {
    let frontier = new Map<string, Cell>()
    const states: Map<string, Cell>[] = []
    for (let a = 0; a < levels[0].length; a++)
      for (let b = 0; b < levels[1].length; b++) {
        const g = grade(0, a, b)
        if (!gradeAllowed(0, g) || !controlsAllowed(0, a, b)) continue
        frontier.set(`${a}:${b}`, { cost: costOf(0, a, b), back: -1 })
      }
    states.push(frontier)
    for (let i = 1; i < n - 1; i++) {
      const next = new Map<string, Cell>()
      for (const [key, cell] of frontier) {
        const [a, b] = key.split(':').map(Number)
        const g1 = grade(i - 1, a, b)
        for (let c = 0; c < levels[i + 1].length; c++) {
          const g2 = grade(i, b, c)
          if (!gradeAllowed(i, g2) || !curvable(i, g1, g2) || !controlsAllowed(i, b, c)) continue
          const cost = cell.cost + costOf(i, b, c)
          const target = `${b}:${c}`
          const existing = next.get(target)
          if (!existing || cost < existing.cost) next.set(target, { cost, back: a })
        }
      }
      if (!next.size)
        throw Error(
          `No profile meets the grade, curvature and control limits past ${pvis[i].toFixed(0)} m within ±${o.maxDepthM} m of ground. Widen the search, untie the ends, lower K or relax the limits.`,
        )
      states.push(next)
      frontier = next
    }
    let best: { key: string; cell: Cell } | null = null
    for (const [key, cell] of frontier) if (!best || cell.cost < best.cell.cost) best = { key, cell }
    if (!best) throw Error('No profile meets the grade and control limits within the search range.')

    // Walk back: states[k] holds pairs (level at PVI k, level at PVI k + 1); `back` is PVI k − 1.
    const chosen = new Array<number>(n)
    let pair = best.key
    for (let k = n - 2; k >= 0; k--) {
      const [previous, current] = pair.split(':').map(Number)
      chosen[k] = previous
      chosen[k + 1] = current
      const cell = states[k].get(pair)!
      if (k > 0) pair = `${cell.back}:${previous}`
    }

    return { chosen, cost: best.cell.cost }
  }

  const minimum = alignment.verticalStandards?.minCurveLengthM ?? 0
  const fitted = (line: { chainage: number; elevation: number }[]) =>
    curveLengthsForK(
      line.map((p, i) => ({
        id: `opt-${i}-${Math.round(p.chainage * 10)}`,
        chainage: p.chainage,
        elevation: p.elevation,
        curveLength: 0,
      })),
      o.k,
      minimum,
    )
  const check = (v: VerticalPoint[]) => analyzeRoad({ ...alignment, vertical: v }, terrain, settings)
  const earthwork = (a: ReturnType<typeof check>) =>
    a.cutVolumeM3 * settings.cutRate + a.fillVolumeM3 * settings.fillRate
  const score = (a: ReturnType<typeof check>) => (o.objective === 'total' ? a.estimatedCost : earthwork(a))
  // Drop PVIs with no grade change, size curves from K within their tangents, then simplify if it costs ≤ 1%.
  const finish = (chosen: number[]) => {
    const raw = pvis.map((s, i) => ({ chainage: s, elevation: Math.round(levels[i][chosen[i]] * 1000) / 1000 }))
    const kept = raw.filter((p, i) => {
      if (i === 0 || i === raw.length - 1) return true
      if (controls.some((c) => Math.abs(c.chainage - p.chainage) < 1e-6)) return true
      const g1 = (p.elevation - raw[i - 1].elevation) / (p.chainage - raw[i - 1].chainage)
      const g2 = (raw[i + 1].elevation - p.elevation) / (raw[i + 1].chainage - p.chainage)
      return Math.abs(g2 - g1) * 100 > 0.05
    })
    let vertical = fitted(kept)
    let analysis = check(vertical)
    let simplified = false
    if (o.simplifyToleranceM > 0 && vertical.length > 3) {
      const lighter = fitted(
        simplifyProfile(
          vertical,
          o.simplifyToleranceM,
          controls.map((c) => c.chainage),
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
  for (const price of prices) {
    imbalancePrice = price
    const solved = solve()
    const result = finish(solved.chosen)
    if (!chosenResult || score(result.analysis) < score(chosenResult.analysis))
      chosenResult = { ...result, cost: solved.cost, price }
  }
  const { vertical, simplified } = chosenResult!
  return {
    vertical,
    estimatedEarthworkCost: earthwork(chosenResult!.analysis),
    pviCount: vertical.length,
    levelsPerPvi: 2 * ladder + 1,
    sectionSolves: solves,
    message: `Optimized ${vertical.length} PVIs${simplified ? ` (simplified within ${o.simplifyToleranceM} m)` : ''} from a ${o.pviSpacingM} m search, ±${o.maxDepthM} m in ${o.levelStepM} m steps, K ${o.k}${o.objective === 'total' ? `, lowest total cost with imbalance at $${chosenResult!.price.toFixed(2)}/m³` : ''}.`,
  }
}

/**
 * Winching for the extraction-reach model: how far a skidder standing on a road, a skid trail or
 * the edge of drivable ground can pull logs to itself with its winch line, along straight lines.
 *
 * - The longest line depends on its slope. Uphill (timber above the machine) the reach falls to the
 *   uphill length at and beyond a "full length from" slope; downhill it rises to the downhill length
 *   at and beyond its own slope. In between the reach is linear in the line's vertical drop, which
 *   is the rule of CARTUVI (Clouet et al. 2010) as used by Sylvaccess (Dupire et al. 2015).
 * - A line must clear the ground between machine and log: the chord from the machine's ground to
 *   the log's ground may pass at most `WINCH_HUMP_M` below a rise (the log would drag over it) and
 *   at most `WINCH_HOLLOW_M` above a hollow (the log would swing into it).
 * - Lines leave each source at 360 bearings, 1° apart, and stop at the first cell they may not
 *   cross, the first cell that fails the ground check, or the first cell past the reach. A cell
 *   already served by a better line is passed over without those checks and the line goes on;
 *   the cells beyond it are still checked against the whole chord.
 *
 * The ray table here is shared with the forwarder's straight runs (`forwarderReach.ts`).
 *
 * Sources: Dupire S., Bourrier F., Monnet J.-M., Berger F. (2015), Sylvaccess : un modèle pour
 * cartographier automatiquement l'accessibilité des forêts, Revue forestière française 67(2):
 * 111–126; Clouet N., Berger F., Monnet J.-M., Descroix L. (2010), CARTUVI, Revue forestière
 * française 62(2): 155–171; the Sylvaccess 3.6 user notice (INRAE, September 2024).
 * Written from a functional specification; no code from Sylvaccess (GPL-3.0-or-later) was used.
 *
 * Pure: no DOM or network access.
 */

export interface WinchRule {
  /** Longest line to timber above the machine, m along the line. 0 = no uphill winching. */
  upReachM: number
  /** Line slope at and beyond which the uphill length applies in full, percent. */
  upFullSlopePercent: number
  /** Longest line to timber below the machine, m along the line. 0 = no downhill winching. */
  downReachM: number
  /** Downward line slope at and beyond which the downhill length applies in full, percent. */
  downFullSlopePercent: number
}

/** Sylvaccess 3.6's defaults (the 2015 paper used 150 m downhill). Editable; not a BC standard. */
export const DEFAULT_WINCH_RULE: WinchRule = {
  upReachM: 50,
  upFullSlopePercent: 75,
  downReachM: 100,
  downFullSlopePercent: 20,
}
export const MAX_WINCH_M = 300
export const MIN_WINCH_SLOPE_PERCENT = 1
export const MAX_WINCH_SLOPE_PERCENT = 500
/** The ground may rise this far above the line's chord between machine and log, m. Fixed. */
export const WINCH_HUMP_M = 10
/** The ground may fall this far below the line's chord between machine and log, m. Fixed. */
export const WINCH_HOLLOW_M = 20
/** Bearings tried from each source, 1° apart. */
export const RAY_BEARINGS = 360

const finiteRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max

export function validateWinchRule(rule: WinchRule): WinchRule {
  if (!finiteRange(rule.upReachM, 0, MAX_WINCH_M)) throw Error(`Use an uphill winch length from 0 to ${MAX_WINCH_M} m.`)
  if (!finiteRange(rule.downReachM, 0, MAX_WINCH_M))
    throw Error(`Use a downhill winch length from 0 to ${MAX_WINCH_M} m.`)
  if (!(rule.upReachM > 0 || rule.downReachM > 0)) throw Error('Give the winch an uphill or a downhill length.')
  for (const [value, name] of [
    [rule.upFullSlopePercent, 'uphill'],
    [rule.downFullSlopePercent, 'downhill'],
  ] as const)
    if (!finiteRange(value, MIN_WINCH_SLOPE_PERCENT, MAX_WINCH_SLOPE_PERCENT))
      throw Error(`Use a ${name} full-length slope from ${MIN_WINCH_SLOPE_PERCENT}% to ${MAX_WINCH_SLOPE_PERCENT}%.`)
  return rule
}

/**
 * The rule's two calibration numbers: the reach is `l0 + c·Δz` along a line of vertical drop Δz,
 * through (uphill length, its drop at the uphill slope) and (downhill length, its drop at the
 * downhill slope).
 */
export function winchCoefficients(rule: WinchRule): { c: number; l0: number } {
  const pu = rule.upFullSlopePercent / 100,
    pd = rule.downFullSlopePercent / 100
  const dzUp = (rule.upReachM * pu) / Math.sqrt(1 + pu * pu)
  const dzDown = (-rule.downReachM * pd) / Math.sqrt(1 + pd * pd)
  const c = dzUp === dzDown ? 0 : (rule.upReachM - rule.downReachM) / (dzUp - dzDown)
  return { c, l0: rule.upReachM - c * dzUp }
}

/**
 * Longest winch line, m along the line, at line slope `slope` (a fraction: positive when the log
 * lies above the machine). Any line no longer than the shorter of the two lengths is allowed.
 */
export function maxWinchLengthM(slope: number, rule: WinchRule, k = winchCoefficients(rule)): number {
  const pu = rule.upFullSlopePercent / 100,
    pd = rule.downFullSlopePercent / 100
  const lo = Math.min(rule.upReachM, rule.downReachM),
    hi = Math.max(rule.upReachM, rule.downReachM)
  let reach: number
  if (slope <= -pd) reach = rule.downReachM
  else if (slope > pu) reach = rule.upReachM
  else {
    const denominator = 1 - (k.c * slope) / Math.sqrt(1 + slope * slope)
    reach = denominator > 0 ? k.l0 / denominator : hi
    reach = Math.min(hi, Math.max(lo, reach))
  }
  return Math.max(lo, reach)
}

/** The farthest horizontal distance any line of `rule` can reach, m. */
export const maxWinchHorizontalM = (rule: WinchRule) => Math.max(rule.upReachM, rule.downReachM)

/** One bearing's cells, nearest first: column and row offsets and centre-to-centre distance, m. */
export interface Ray {
  /** Unit direction: east and north components. */
  ux: number
  uy: number
  dc: Int16Array
  dr: Int16Array
  dh: Float32Array
}
export interface RayTable {
  cellM: number
  maxM: number
  rays: Ray[]
}

const rayCache = new Map<string, RayTable>()

/**
 * The cells a straight line from a cell centre passes through, for each of `RAY_BEARINGS`
 * bearings (0 = north, clockwise), out to `maxM` horizontally, in order of centre distance.
 * Rows count south, so a step north is `dr = -1`.
 */
export function rayTable(cellM: number, maxM: number): RayTable {
  const key = `${cellM}:${maxM}`
  const cached = rayCache.get(key)
  if (cached) return cached
  const rays: Ray[] = []
  const reach = maxM / cellM
  const step = 1 / 16
  for (let b = 0; b < RAY_BEARINGS; b++) {
    const a = (b * 2 * Math.PI) / RAY_BEARINGS
    const ux = Math.sin(a),
      uy = Math.cos(a)
    const seen = new Set<number>()
    const cells: [number, number, number][] = []
    const span = Math.ceil(reach) + 2
    for (let t = 0; t <= reach + 0.5; t += step) {
      const c = Math.round(ux * t),
        r = -Math.round(uy * t)
      if (!c && !r) continue
      const id = (r + span) * (2 * span + 1) + (c + span)
      if (seen.has(id)) continue
      seen.add(id)
      const dh = Math.hypot(c, r) * cellM
      if (dh <= maxM + 1e-9) cells.push([c, r, dh])
    }
    cells.sort((p, q) => p[2] - q[2])
    rays.push({
      ux,
      uy,
      dc: Int16Array.from(cells, (p) => p[0]),
      dr: Int16Array.from(cells, (p) => p[1]),
      dh: Float32Array.from(cells, (p) => p[2]),
    })
  }
  const table = { cellM, maxM, rays }
  if (rayCache.size > 16) rayCache.clear()
  rayCache.set(key, table)
  return table
}

/** What the winch pass reads: the grid's ground and the cells a line may cross. */
export interface WinchGround {
  width: number
  height: number
  cellM: number
  /** Ground elevation; NaN where missing. */
  z: Float64Array
  /** 1 where a winch line may cross or end: fellable, no barrier, no no-extraction area, not a road. */
  crossable: Uint8Array
}

/** A machine position: the cell, the distance the logs still travel from it, and its choice cost. */
export interface WinchSource {
  cell: number
  /** Distance from the source to the truck road, m (0 on a truck road). */
  baseM: number
  /** Added to the line length when choosing between sources for the same log. */
  choiceBase: number
  /** The road or trail cell the logs leave by. */
  exit: number
}

/** Per cell: the chosen line and its source. */
export interface WinchField {
  choice: Float64Array
  winchM: Float32Array
  baseM: Float32Array
  source: Int32Array
  exit: Int32Array
}

export function emptyWinchField(cells: number): WinchField {
  return {
    choice: new Float64Array(cells).fill(Infinity),
    winchM: new Float32Array(cells).fill(NaN),
    baseM: new Float32Array(cells).fill(NaN),
    source: new Int32Array(cells).fill(-1),
    exit: new Int32Array(cells).fill(-1),
  }
}
export const copyWinchField = (f: WinchField): WinchField => ({
  choice: new Float64Array(f.choice),
  winchM: new Float32Array(f.winchM),
  baseM: new Float32Array(f.baseM),
  source: new Int32Array(f.source),
  exit: new Int32Array(f.exit),
})

/** Sources between progress reports. */
const SOURCES_PER_YIELD = 64

/**
 * Casts winch lines from every source into `field`, keeping for each cell the line with the least
 * `choiceBase + length`. `optimistic` lets lines cross missing ground and treats a missing end as
 * level with the machine; otherwise a line stops at missing ground.
 */
export function* castWinchLines(
  ground: WinchGround,
  sources: readonly WinchSource[],
  rule: WinchRule,
  field: WinchField,
  optimistic: boolean,
): Generator<{ phase: string; done: number; total: number }, void> {
  const { width, height, z, crossable } = ground
  const k = winchCoefficients(rule)
  const table = rayTable(ground.cellM, maxWinchHorizontalM(rule))
  const longest = Math.max(rule.upReachM, rule.downReachM)
  // Per-ray scratch: the elevations and distances of the cells passed so far.
  const passedZ = new Float64Array(4096),
    passedH = new Float64Array(4096)
  for (let s = 0; s < sources.length; s++) {
    if (s % SOURCES_PER_YIELD === 0) yield { phase: 'Casting winch lines', done: s, total: sources.length }
    const source = sources[s]
    const zs = z[source.cell]
    const sourceKnown = Number.isFinite(zs)
    if (!sourceKnown && !optimistic) continue
    const row0 = (source.cell / width) | 0,
      col0 = source.cell - row0 * width
    for (const ray of table.rays) {
      let passed = 0
      for (let i = 0; i < ray.dh.length; i++) {
        const r = row0 + ray.dr[i],
          c = col0 + ray.dc[i]
        if (r < 0 || c < 0 || r >= height || c >= width) break
        const v = r * width + c
        if (!crossable[v]) break
        const zv = z[v]
        const known = Number.isFinite(zv)
        if (!known && !optimistic) break
        const dh = ray.dh[i]
        if (dh > longest) break
        const dz = known && sourceKnown ? zv - zs : 0
        const length = Math.hypot(dh, dz)
        const choice = source.choiceBase + length
        // A cell already served by a better line is passed over untested; the line goes on.
        if (field.choice[v] <= choice + 1e-9) {
          if (passed < passedZ.length) {
            passedZ[passed] = zv
            passedH[passed] = dh
            passed++
          }
          continue
        }
        if (length > maxWinchLengthM(dz / dh, rule, k) + 1e-9) break
        // The chord from the machine's ground to the log's ground must clear every cell between.
        let clear = true
        if (known && sourceKnown)
          for (let j = 0; j < passed; j++) {
            if (!Number.isFinite(passedZ[j])) continue
            const above = passedZ[j] - (zs + (dz * passedH[j]) / dh)
            if (above > WINCH_HUMP_M || -above > WINCH_HOLLOW_M) {
              clear = false
              break
            }
          }
        if (!clear) break
        if (passed < passedZ.length) {
          passedZ[passed] = zv
          passedH[passed] = dh
          passed++
        }
        field.choice[v] = choice
        field.winchM[v] = length
        field.baseM[v] = source.baseM
        field.source[v] = source.cell
        field.exit[v] = source.exit
      }
    }
  }
}

/**
 * What becomes of a prescription's snags over the years after harvest: which still stand, how tall,
 * and which have fallen and lie as logs.
 *
 * Each snag's fate is drawn once from a published survival curve for its species (`SNAG_CURVES`,
 * every row citing its source): a seeded draw per tree gives the year it falls, the inverse of the
 * share still standing, so the same snag falls in the same year every time and a snag standing at
 * year 10 stood at year 5. That is the honest form of a fall rate: WinSVS's snag model re-applied its
 * reductions to the already-reduced stand every cycle, compounding them. Heights shrink only where a
 * source gives breakage. A species no BC source covers takes the nearest curve and says so.
 *
 * Display only, like the snags themselves. DOM-free.
 */

import { mulberry32, type TreeSpeciesId } from '../forest'
import type { PrescriptionResult } from './prescription'
import type { Stand } from './standTrees'

export type SnagCurve = {
  id: string
  label: string
  /** The drawn species it applies to. */
  species: ReadonlyArray<TreeSpeciesId>
  /** Drawn species with no published curve of their own that take this one, said so wherever it is shown. */
  borrowedBy?: ReadonlyArray<TreeSpeciesId>
  /** Whether the standing shares were measured in BC. */
  bcData: boolean
  /** Share still standing by years since the snag was made: [years, share 0–1], years rising, share falling, starting at [0, 1]. */
  standing: ReadonlyArray<readonly [number, number]>
  /** Share of a standing snag's height left by years (breakage); absent where no source gives it. */
  heightLeft?: ReadonlyArray<readonly [number, number]>
  /** The source, cited. */
  source: string
  /** What the curve was measured on, and how it differs from a wildlife-tree stub. */
  note: string
}

/** Most years after harvest the snags are shown at. */
export const SNAG_MAX_YEARS = 60

/**
 * Height left of a standing snag by years, after the Fire and Fuels Extension to FVS (Rebain 2010,
 * rev. 2022, §2.3, Tables 4.10.2–4.10.3; the BC variant takes the Inland Empire rates): a hard snag
 * loses 2.28% × `multiplier` of its height a year until half is gone, then 1% × `multiplier` a year.
 * Expert workshop values, not BC measurements. Sampled every 5 years to `SNAG_MAX_YEARS`.
 */
export function ffeHeightLeft(multiplier: number): Array<[number, number]> {
  const fast = 0.0228 * multiplier
  const slow = 0.01 * multiplier
  const half = Math.log(0.5) / Math.log(1 - fast)
  const points: Array<[number, number]> = []
  for (let years = 0; years <= SNAG_MAX_YEARS; years += 5)
    points.push([years, years <= half ? (1 - fast) ** years : 0.5 * (1 - slow) ** (years - half)])
  return points
}

/** Exponential survival with a stated half-life, as points every 5 years to `SNAG_MAX_YEARS`. */
function halfLife(years: number): Array<[number, number]> {
  return Array.from({ length: SNAG_MAX_YEARS / 5 + 1 }, (_, i) => [i * 5, 0.5 ** ((i * 5) / years)] as [number, number])
}

/**
 * The survival curves, one per species group, each citing where its numbers were read. Only lodgepole
 * pine has a BC-measured fall curve; the rest are the nearest published curves, and say so. All are
 * for full-height snags of 23–41 cm, the size of the trees a prescription leaves; no study of topped
 * wildlife-tree stubs was found, and pine fails at its base, so topping is not assumed to slow a fall.
 * See `docs/forestry-visual-quality.md`, **Snags over time**.
 */
export const SNAG_CURVES: ReadonlyArray<SnagCurve> = [
  {
    id: 'pine-bc',
    label: 'Lodgepole pine',
    species: ['pine'],
    bcData: true,
    standing: [
      [0, 1],
      [5, 0.99],
      [8, 0.72],
      [17.5, 0.2],
    ],
    heightLeft: ffeHeightLeft(1.1),
    source:
      'Lewis & Thompson 2008, CFS Mountain Pine Beetle Working Paper 2008-30 (SBSdk/SBSmc3 near Vanderhoof: under 1% fallen by 5 years, a mean 28% fallen at 6–10 years); Lewis & Hrinkevich 2013, Foothills Research Institute (over 80% fallen by 15–20 years, a literature synthesis)',
    note: 'Beetle-killed pine. Fall nearly doubles on dry sites (51% at 6–10 years). Height loss after the FVS Fire and Fuels Extension.',
  },
  {
    id: 'fir-everett',
    label: 'Subalpine fir',
    species: ['fir'],
    bcData: false,
    standing: [
      [0, 1],
      [25, 0.5],
      [80, 0.03],
    ],
    heightLeft: ffeHeightLeft(1.1),
    source:
      'Everett et al. 1999, International Journal of Wildland Fire 9(4):223–234 (Washington Cascades burns, 23–41 cm: half down by 25 years, 3% standing at 80)',
    note: 'No year-by-year BC curve: Huggard 1997 (ESSF, Sicamous Creek) measured slow early fall by decay class (0.2% a year in class 3), consistent with this. Height loss after the FVS Fire and Fuels Extension.',
  },
  {
    id: 'spruce-everett',
    label: 'Spruce',
    species: ['spruce'],
    bcData: false,
    standing: [
      [0, 1],
      [25, 0.5],
      [80, 0.18],
    ],
    heightLeft: ffeHeightLeft(1.1),
    source: 'Everett et al. 1999 (Engelmann spruce, 23–41 cm: half down by 25 years, 18% standing at 80)',
    note: 'No BC data. Height loss after the FVS Fire and Fuels Extension.',
  },
  {
    id: 'douglas-fir-everett',
    label: 'Douglas-fir',
    species: ['douglasFir'],
    bcData: false,
    standing: [
      [0, 1],
      [15, 0.5],
      [80, 0.1],
    ],
    heightLeft: ffeHeightLeft(0.9),
    source: 'Everett et al. 1999 (Douglas-fir, 23–41 cm: half down by 15 years, 10% standing at 80)',
    note: 'No BC interior data. Height loss after the FVS Fire and Fuels Extension.',
  },
  {
    id: 'aspen-angers',
    label: 'Trembling aspen',
    species: ['aspen'],
    borrowedBy: ['birch'],
    bcData: false,
    standing: halfLife(15.1),
    heightLeft: ffeHeightLeft(1),
    source:
      'Angers et al. 2010, Forest Ecology and Management 259:246–256 (boreal Quebec, stems: half-life 15.1 years)',
    note: 'No BC fall curve; aspen cavity trees at Riske Creek (Edworthy et al. 2012) lasted a median 9 years, so this may be slow. Paper birch has no western data and takes this curve. Height loss after the FVS Fire and Fuels Extension.',
  },
]

/** The curve a species takes, and whether it is its own (`false`: borrowed from another species). */
export function snagCurveFor(
  species: TreeSpeciesId,
  curves: ReadonlyArray<SnagCurve> = SNAG_CURVES,
): { curve: SnagCurve; own: boolean } | null {
  const own = curves.find((curve) => curve.species.includes(species))
  if (own) return { curve: own, own: true }
  const named = curves.find((curve) => curve.borrowedBy?.includes(species))
  if (named) return { curve: named, own: false }
  const fallback = curves.find((curve) => curve.species.length > 0) ?? null
  return fallback ? { curve: fallback, own: false } : null
}

/** Linear interpolation along a curve's points; past the last point, its last value. */
export function curveAt(points: ReadonlyArray<readonly [number, number]>, years: number): number {
  if (points.length === 0) return 1
  if (years <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i]
    if (years <= x1) {
      const [x0, y0] = points[i - 1]
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (years - x0)) / (x1 - x0)
    }
  }
  return points[points.length - 1][1]
}

/** The last span's exponential rate, or 0 when the curve ends level (or has one point). */
function tailRate(standing: ReadonlyArray<readonly [number, number]>): number {
  if (standing.length < 2) return 0
  const [xa, ya] = standing[standing.length - 2]
  const [xb, yb] = standing[standing.length - 1]
  return yb > 0 && ya > yb && xb > xa ? Math.log(ya / yb) / (xb - xa) : 0
}

/** Share still standing at `years`: the curve, then its last span's rate on past its end (`fallYear`'s rule). */
export function standingShare(standing: ReadonlyArray<readonly [number, number]>, years: number): number {
  if (standing.length === 0) return 1
  const [lastYears, lastShare] = standing[standing.length - 1]
  if (years <= lastYears) return curveAt(standing, years)
  return lastShare * Math.exp(-tailRate(standing) * (years - lastYears))
}

/**
 * The year a snag falls, for a draw `u` in (0, 1): when the share still standing first drops to `u`.
 * Past the curve's last point the share falls on at the rate of its last span, exponentially; a
 * curve that ends level never drops further and the snag outlasts it (Infinity).
 */
export function fallYear(standing: ReadonlyArray<readonly [number, number]>, u: number): number {
  if (standing.length === 0) return Infinity
  if (u >= standing[0][1]) return standing[0][0]
  for (let i = 1; i < standing.length; i += 1) {
    const [x0, y0] = standing[i - 1]
    const [x1, y1] = standing[i]
    if (u >= y1) return y0 === y1 ? x0 : x0 + ((y0 - u) * (x1 - x0)) / (y0 - y1)
  }
  const [xb, yb] = standing[standing.length - 1]
  if (!(yb > 0)) return xb
  // Exponential tail at the last span's rate; a level end never drops further.
  const rate = tailRate(standing)
  return rate > 0 ? xb + Math.log(yb / u) / rate : Infinity
}

/** A stable draw in (0, 1) per tree, independent of the prescription's own seed. */
function treeDraw(key: number): number {
  const low = Math.abs(key) % 2_147_483_647
  const high = Math.floor(Math.abs(key) / 2_147_483_647)
  const random = mulberry32(
    (Math.imul(low, 0x27d4eb2d) ^ Math.imul(high + (key < 0 ? 7 : 0), 0x165667b1) ^ 0x5a17) >>> 0,
  )
  return Math.min(1 - 1e-9, Math.max(1e-9, random()))
}

export type SnagFate = {
  /** Index into `stand.trees`. */
  index: number
  curveId: string | null
  /** Whether the curve is the species' own, or borrowed. */
  ownCurve: boolean
  /** Years after harvest the snag falls (Infinity: outlasts its curve). */
  fallsAfterYears: number
}

/** Every snag's fate. */
export function snagFates(
  stand: Stand,
  result: PrescriptionResult,
  curves: ReadonlyArray<SnagCurve> = SNAG_CURVES,
): SnagFate[] {
  const fates: SnagFate[] = []
  stand.trees.forEach((tree, index) => {
    if (!result.snags[index]) return
    const chosen = snagCurveFor(tree.species, curves)
    fates.push({
      index,
      curveId: chosen?.curve.id ?? null,
      ownCurve: chosen?.own ?? false,
      fallsAfterYears: chosen ? fallYear(chosen.curve.standing, treeDraw(tree.key)) : Infinity,
    })
  })
  return fates
}

export type SnagState = { index: number; standing: boolean; heightShare: number }

/** Each snag at `years` after harvest: standing (with the share of its height left) or fallen. */
export function snagStatesAt(
  fates: ReadonlyArray<SnagFate>,
  years: number,
  curves: ReadonlyArray<SnagCurve> = SNAG_CURVES,
): SnagState[] {
  const byId = new Map(curves.map((curve) => [curve.id, curve]))
  return fates.map((fate) => {
    const curve = fate.curveId ? byId.get(fate.curveId) : undefined
    const standing = years < fate.fallsAfterYears
    return {
      index: fate.index,
      standing,
      heightShare: standing && curve?.heightLeft ? Math.max(0.05, curveAt(curve.heightLeft, years)) : 1,
    }
  })
}

/**
 * Snags standing per year, 0 to `maxYears`: the drawn count (these snags' own fall years) and the
 * expected count (the curves' shares summed), which the drawn count follows only on average.
 */
export function snagsStandingByYear(
  fates: ReadonlyArray<SnagFate>,
  maxYears = SNAG_MAX_YEARS,
  curves: ReadonlyArray<SnagCurve> = SNAG_CURVES,
): Array<{ years: number; drawn: number; expected: number }> {
  const byId = new Map(curves.map((curve) => [curve.id, curve]))
  return Array.from({ length: maxYears + 1 }, (_, years) => ({
    years,
    drawn: fates.filter((fate) => years < fate.fallsAfterYears).length,
    expected: fates.reduce((sum, fate) => {
      const curve = fate.curveId ? byId.get(fate.curveId) : undefined
      return sum + (curve ? standingShare(curve.standing, years) : 1)
    }, 0),
  }))
}

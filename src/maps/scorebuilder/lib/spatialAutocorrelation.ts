/**
 * Spatial autocorrelation over region values: global Moran's I, local Moran's I (LISA),
 * Getis-Ord Gi* and the Moran scatter, on the row-standardised contiguity weights of
 * `spatialWeights.ts`.
 *
 * Implemented from the published methods, not from another package's code:
 * - Global Moran's I, its expectation and its variance under normality and under
 *   randomisation: Cliff & Ord (1981), Spatial Processes, eqs. 1.35–1.38.
 * - Local Moran's I and conditional permutation: Anselin (1995), "Local Indicators of
 *   Spatial Association — LISA", Geographical Analysis 27(2).
 * - Gi*: Ord & Getis (1995), "Local Spatial Autocorrelation Statistics", Geographical
 *   Analysis 27(4), the standardised form with the region itself included.
 * - False discovery rate: Benjamini & Hochberg (1995).
 *
 * Every figure here is computed by PGMaps from the mapped values; none is a published
 * statistic. Permutations draw from a seeded generator, so a run is repeatable.
 *
 * DOM-free: the unit tests pin it against hand figures and PySAL's esda.
 */
import type { SpatialWeights } from './spatialWeights'

export type LisaClass = 'HH' | 'LL' | 'HL' | 'LH' | 'ns'

export const DEFAULT_PERMUTATIONS = 999
export const DEFAULT_SIGNIFICANCE = 0.05
/** Fixed so the same map gives the same clusters on every visit. */
export const DEFAULT_SEED = 20_261_118

/** mulberry32: a small public-domain 32-bit generator; deterministic for a seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Upper tail of the standard normal, Q(x) = 1 − Φ(x), to about 1e-14 relative. */
export function normalUpperTail(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x < 0) return 1 - normalUpperTail(-x)
  const density = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
  if (x < 3) {
    // Φ(x) − ½ = φ(x)(x + x³/3 + x⁵/(3·5) + …) (Marsaglia 2004).
    let term = x
    let sum = x
    for (let k = 3; k < 200; k += 2) {
      term *= (x * x) / k
      sum += term
      if (term < sum * 1e-17) break
    }
    return 0.5 - density * sum
  }
  // Laplace's continued fraction, Q(x) = φ(x) / (x + 1/(x + 2/(x + 3/(x + …)))), evaluated
  // from the tail up.
  let fraction = x
  for (let k = 60; k >= 1; k -= 1) fraction = x + k / fraction
  return density / fraction
}

/** Two-sided p-value of a standard normal z. */
export function twoSidedP(z: number): number {
  if (!Number.isFinite(z)) return Number.NaN
  return Math.min(1, 2 * normalUpperTail(Math.abs(z)))
}

/**
 * Benjamini–Hochberg: the largest p-value cut-off that keeps the expected share of false
 * discoveries at `alpha`. Returns 0 when nothing passes.
 */
export function falseDiscoveryCutoff(pValues: readonly number[], alpha = DEFAULT_SIGNIFICANCE): number {
  const sorted = pValues.filter(Number.isFinite).sort((a, b) => a - b)
  const m = sorted.length
  let cutoff = 0
  for (let k = 1; k <= m; k += 1) {
    if (sorted[k - 1] <= (k * alpha) / m) cutoff = sorted[k - 1]
  }
  return cutoff
}

/**
 * A draw that gives the observed statistic counts as at least as extreme. Summing the same
 * neighbour values in another order moves the last bits, and data with few distinct values
 * (counts, rounded shares) tie often, so an exact comparison would decide ties by rounding.
 */
function tieTolerance(statistic: number): number {
  return 1e-10 * Math.max(1, Math.abs(statistic))
}

function centred(values: readonly number[]): { z: number[]; m2: number } {
  let mean = 0
  for (const value of values) mean += value
  mean /= values.length || 1
  const z = values.map((value) => value - mean)
  let m2 = 0
  for (const d of z) m2 += d * d
  return { z, m2 }
}

/** Σ_j w_ij v_j with row-standardised weights: the mean of the neighbours' values. */
export function spatialLag(weights: Pick<SpatialWeights, 'neighbors'>, v: readonly number[]): number[] {
  return weights.neighbors.map((row) => {
    if (!row.length) return 0
    let sum = 0
    for (const j of row) sum += v[j]
    return sum / row.length
  })
}

export interface GlobalMoranResult {
  n: number
  I: number
  expected: number
  varianceNormality: number
  zNormality: number
  pNormality: number
  varianceRandomisation: number
  zRandomisation: number
  pRandomisation: number
  permutations: number
  /** (extremes + 1) / (permutations + 1), folded to the observed side; NaN without permutations. */
  pPermutation: number
}

/**
 * Global Moran's I on row-standardised weights. Null when fewer than four regions remain
 * (the randomisation variance divides by n − 3) or every value is the same.
 */
export function globalMoran(
  weights: Pick<SpatialWeights, 'neighbors' | 'values'>,
  options: { permutations?: number; seed?: number } = {},
): GlobalMoranResult | null {
  const n = weights.values.length
  if (n < 4) return null
  const { z, m2 } = centred(weights.values)
  if (!(m2 > 0)) return null

  // Row-standardised: w_ij = 1 / k_i. The graph is symmetric, so w_ji = 1 / k_j.
  const k = weights.neighbors.map((row) => row.length)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i += 1) {
    if (!k[i]) continue
    s0 += 1
    let columnSum = 0
    for (const j of weights.neighbors[i]) {
      const both = 1 / k[i] + 1 / k[j]
      s1 += both * both
      columnSum += 1 / k[j]
    }
    s2 += (1 + columnSum) ** 2
  }
  s1 /= 2
  if (!(s0 > 0)) return null

  const statistic = (zValues: readonly number[]) => {
    const lag = spatialLag(weights, zValues)
    let numerator = 0
    for (let i = 0; i < n; i += 1) numerator += zValues[i] * lag[i]
    return ((n / s0) * numerator) / m2
  }
  const I = statistic(z)
  const expected = -1 / (n - 1)
  const s02 = s0 * s0
  const varianceNormality = (n * n * s1 - n * s2 + 3 * s02) / ((n * n - 1) * s02) - expected * expected
  let m4 = 0
  for (const d of z) m4 += d ** 4
  const b2 = (n * m4) / (m2 * m2)
  const varianceRandomisation =
    (n * ((n * n - 3 * n + 3) * s1 - n * s2 + 3 * s02) - b2 * ((n * n - n) * s1 - 2 * n * s2 + 6 * s02)) /
      ((n - 1) * (n - 2) * (n - 3) * s02) -
    expected * expected
  const zNormality = (I - expected) / Math.sqrt(varianceNormality)
  const zRandomisation = (I - expected) / Math.sqrt(varianceRandomisation)

  const permutations = Math.max(0, Math.floor(options.permutations ?? DEFAULT_PERMUTATIONS))
  let pPermutation = Number.NaN
  if (permutations > 0) {
    const random = seededRandom(options.seed ?? DEFAULT_SEED)
    const shuffled = [...z]
    let atLeast = 0
    for (let p = 0; p < permutations; p += 1) {
      for (let i = n - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1))
        const swap = shuffled[i]
        shuffled[i] = shuffled[j]
        shuffled[j] = swap
      }
      if (statistic(shuffled) >= I - tieTolerance(I)) atLeast += 1
    }
    const extremes = Math.min(atLeast, permutations - atLeast)
    pPermutation = (extremes + 1) / (permutations + 1)
  }

  return {
    n,
    I,
    expected,
    varianceNormality,
    zNormality,
    pNormality: twoSidedP(zNormality),
    varianceRandomisation,
    zRandomisation,
    pRandomisation: twoSidedP(zRandomisation),
    permutations,
    pPermutation,
  }
}

export interface LocalMoranResult {
  ids: string[]
  /** Anselin's I_i = (z_i / m2) Σ_j w_ij z_j, with m2 = Σ z² / n. */
  I: number[]
  /** Standardised values (z / sd, sd with divisor n) and their spatial lags: the Moran scatter. */
  standardised: number[]
  lag: number[]
  /** Conditional-permutation pseudo p-values, folded to the observed side. */
  pPermutation: number[]
  quadrant: Array<Exclude<LisaClass, 'ns'>>
  cluster: LisaClass[]
  /** The p-value a region must reach to be called a cluster: alpha, or the FDR cut-off. */
  cutoff: number
  alpha: number
  fdr: boolean
  permutations: number
}

/** Which quadrant of the Moran scatter a region sits in. Zero counts as high, as in GeoDa. */
function quadrantOf(z: number, lag: number): Exclude<LisaClass, 'ns'> {
  if (z >= 0) return lag >= 0 ? 'HH' : 'HL'
  return lag >= 0 ? 'LH' : 'LL'
}

/**
 * Local Moran's I with conditional permutation: each region keeps its own value and its
 * neighbours' values are redrawn, without replacement, from the other n − 1 regions.
 * One table of draws is shared by every region (as in PySAL's `crand`), so the run is
 * O(permutations × neighbours) per region and repeatable for a seed.
 */
export function localMoran(
  weights: SpatialWeights,
  options: { permutations?: number; seed?: number; alpha?: number; fdr?: boolean } = {},
): LocalMoranResult | null {
  const n = weights.values.length
  if (n < 3) return null
  const { z, m2 } = centred(weights.values)
  if (!(m2 > 0)) return null
  const sd = Math.sqrt(m2 / n)
  const standardised = z.map((value) => value / sd)
  const lag = spatialLag(weights, standardised)
  // With z standardised (divisor n), Anselin's I_i is simply z_i × lag_i.
  const I = standardised.map((value, i) => value * lag[i])
  const quadrant = standardised.map((value, i) => quadrantOf(value, lag[i]))

  const permutations = Math.max(1, Math.floor(options.permutations ?? DEFAULT_PERMUTATIONS))
  const alpha = options.alpha ?? DEFAULT_SIGNIFICANCE
  const fdr = options.fdr ?? false
  let maxNeighbours = 0
  for (const row of weights.neighbors) maxNeighbours = Math.max(maxNeighbours, row.length)
  const draws = Math.min(maxNeighbours, n - 1)
  // draws[p * draws + r]: distinct positions in 0..n−2. Position q stands for region
  // q < i ? q : q + 1, which skips region i itself.
  const table = new Int32Array(permutations * draws)
  const random = seededRandom(options.seed ?? DEFAULT_SEED)
  for (let p = 0; p < permutations; p += 1) {
    const offset = p * draws
    for (let r = 0; r < draws; r += 1) {
      let candidate: number
      let repeated: boolean
      do {
        candidate = Math.floor(random() * (n - 1))
        repeated = false
        for (let earlier = 0; earlier < r; earlier += 1) {
          if (table[offset + earlier] === candidate) {
            repeated = true
            break
          }
        }
      } while (repeated)
      table[offset + r] = candidate
    }
  }

  const pPermutation = new Array<number>(n)
  for (let i = 0; i < n; i += 1) {
    const k = weights.neighbors[i].length
    let atLeast = 0
    for (let p = 0; p < permutations; p += 1) {
      const offset = p * draws
      let sum = 0
      for (let r = 0; r < k; r += 1) {
        const q = table[offset + r]
        sum += standardised[q < i ? q : q + 1]
      }
      if (standardised[i] * (sum / k) >= I[i] - tieTolerance(I[i])) atLeast += 1
    }
    pPermutation[i] = (Math.min(atLeast, permutations - atLeast) + 1) / (permutations + 1)
  }

  const cutoff = fdr ? falseDiscoveryCutoff(pPermutation, alpha) : alpha
  const cluster = pPermutation.map<LisaClass>((p, i) => (p <= cutoff ? quadrant[i] : 'ns'))
  return {
    ids: weights.ids,
    I,
    standardised,
    lag,
    pPermutation,
    quadrant,
    cluster,
    cutoff,
    alpha,
    fdr,
    permutations,
  }
}

export interface GiStarResult {
  ids: string[]
  z: number[]
  p: number[]
  hot: boolean[]
  cold: boolean[]
  cutoff: number
}

/**
 * Getis-Ord Gi* (Ord & Getis 1995): each region's neighbourhood includes the region itself,
 * with binary weights. The z-score is
 *   (Σ_j w_ij x_j − x̄ W_i) / (s √((n S1_i − W_i²) / (n − 1))),
 * with x̄ and s the mean and standard deviation (divisor n) of all values, W_i = Σ_j w_ij
 * and S1_i = Σ_j w_ij². It is unchanged by row-standardising, which scales numerator and
 * denominator alike.
 */
export function getisOrdGiStar(
  weights: SpatialWeights,
  options: { alpha?: number; fdr?: boolean } = {},
): GiStarResult | null {
  const n = weights.values.length
  if (n < 3) return null
  let sum = 0
  let sumSquares = 0
  for (const value of weights.values) {
    sum += value
    sumSquares += value * value
  }
  const mean = sum / n
  const s = Math.sqrt(Math.max(0, sumSquares / n - mean * mean))
  if (!(s > 0)) return null
  const z = weights.neighbors.map((row, i) => {
    const w = row.length + 1
    let local = weights.values[i]
    for (const j of row) local += weights.values[j]
    // Binary weights: S1_i = W_i.
    return (local - mean * w) / (s * Math.sqrt((n * w - w * w) / (n - 1)))
  })
  const p = z.map(twoSidedP)
  const alpha = options.alpha ?? DEFAULT_SIGNIFICANCE
  const cutoff = options.fdr ? falseDiscoveryCutoff(p, alpha) : alpha
  return {
    ids: weights.ids,
    z,
    p,
    hot: z.map((value, i) => value > 0 && p[i] <= cutoff),
    cold: z.map((value, i) => value < 0 && p[i] <= cutoff),
    cutoff,
  }
}

export interface SpatialPatternSummary {
  global: GlobalMoranResult | null
  local: LocalMoranResult | null
  /** Region id → LISA class, for the regions analysed. */
  clusterById: Map<string, LisaClass>
  counts: Record<LisaClass, number>
  analysedCount: number
  islands: string[]
  missing: string[]
}

/** Global and local Moran's I for one variable, with each region's cluster class. */
export function summariseSpatialPattern(
  weights: SpatialWeights,
  options: { permutations?: number; seed?: number; alpha?: number; fdr?: boolean; local?: boolean } = {},
): SpatialPatternSummary {
  const global = globalMoran(weights, options)
  const local = options.local === false ? null : localMoran(weights, options)
  const counts: Record<LisaClass, number> = { HH: 0, LL: 0, HL: 0, LH: 0, ns: 0 }
  const clusterById = new Map<string, LisaClass>()
  if (local) {
    local.ids.forEach((id, i) => {
      clusterById.set(id, local.cluster[i])
      counts[local.cluster[i]] += 1
    })
  }
  return {
    global,
    local,
    clusterById,
    counts,
    analysedCount: weights.ids.length,
    islands: weights.islands,
    missing: weights.missing,
  }
}

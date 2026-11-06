/**
 * Bounded, sequential structural metrics inspired by PEMlidr's lascanopy recipe.
 * Normalization is supplied by the caller. No point arrays, quantile approximations,
 * DOM or network access. This is an independent browser implementation.
 */
import { indexAt, MAX_GRID_CELLS, type Grid, type Raster } from './model'
import { DEFAULT_LOCALE } from '@/lib/format'

export const PEM_SOURCE = 'https://github.com/bcgov/PEMlidr/tree/946738c4212466d8e99274f45723c6e09eb508a6'
export const PEM_STRUCTURE_CELL_M = 5
export const PEM_HEIGHT_CUTOFF_M = 2
export const PEM_HEIGHT_CEILING_M = 100

export const PEM_PRODUCTS = {
  pemEligible: {
    label: 'PEM-style non-ground return count',
    unit: 'returns',
    description: 'All accepted non-ground returns at or below 100 m, including heights at or below 2 m.',
  },
  pemAbove2: {
    label: 'PEM-style returns above 2 m',
    unit: 'returns',
    description: 'Accepted non-ground returns strictly above 2 m and at or below 100 m.',
  },
  pemMean: {
    label: 'PEM-style mean height above 2 m',
    unit: 'm',
    description: 'Arithmetic mean normalized height of accepted non-ground returns above 2 m and at or below 100 m.',
  },
  pemRms: {
    label: 'PEM-style RMS height above 2 m',
    unit: 'm',
    description: 'Square root of the mean squared normalized height above 2 m; not the arithmetic mean.',
  },
  pemStd: {
    label: 'PEM-style sample height deviation',
    unit: 'm',
    description: 'Sample standard deviation of heights above 2 m (n − 1 denominator); two returns required.',
  },
  pemCover: {
    label: 'PEM-style first-return canopy cover',
    unit: '%',
    description:
      'Eligible first returns above 2 m divided by all eligible first returns; ground and noise excluded before both counts.',
  },
  pemCv: {
    label: 'Height coefficient of variation',
    unit: 'ratio',
    description:
      'Sample height deviation divided by mean height above 2 m. Additional browser metric; PEM cov means first-return canopy cover.',
  },
} as const

export type PemProduct = keyof typeof PEM_PRODUCTS
export type PemStructureRasters = Record<PemProduct, Raster>

export const PEM_STRUCTURE_METHOD = {
  id: 'pem-structure-welford-v1',
  source: PEM_SOURCE,
  defaultCellM: PEM_STRUCTURE_CELL_M,
  heightCutoffM: PEM_HEIGHT_CUTOFF_M,
  heightCeilingM: PEM_HEIGHT_CEILING_M,
  cutoffBoundary: 'strictly greater than 2 m; 100 m included',
  momentPopulation: 'accepted non-ground normalized returns above 2 m and at or below 100 m',
  allCountPopulation: 'accepted non-ground normalized returns at or below 100 m, including negative heights',
  excludedClasses: [2, 7, 18],
  excludesWithheld: 'caller must reject withheld returns before add',
  canopyCover:
    'eligible first returns above 2 m / all eligible first returns × 100; class 2/7/18 and heights >100 m excluded before both counts',
  standardDeviation: 'sample standard deviation: sqrt(M2 / (n - 1)); NoData for fewer than two returns',
  coefficientOfVariation: 'sample standard deviation / mean; ratio, not percent; an additional browser metric',
  differences: [
    'Source normalization uses LAStools lasheight; browser normalization is supplied separately.',
    'The browser also excludes high-noise class 18 and withheld returns.',
    'No percentile, skewness or kurtosis output is inferred from these moments.',
    'LAStools cov is first-return canopy cover, not coefficient of variation.',
  ],
} as const

/**
 * One accumulator per shared source-aligned 5 m grid. Negative normalized heights
 * count in pemEligible, following PEM's structural recipe (which has no lower Z filter).
 * If any otherwise eligible return lacks terrain support, every output in that
 * cell stays NoData. Call add for missing heights too so this completeness check
 * can distinguish an observed zero from incomplete ground normalization.
 */
export function pemStructureAccumulator(grid: Grid) {
  const cells = grid.width * grid.height
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > MAX_GRID_CELLS)
    throw Error(`PEM structure grid must contain 1–${MAX_GRID_CELLS.toLocaleString(DEFAULT_LOCALE)} cells.`)
  const all = new Uint32Array(cells)
  const above = new Uint32Array(cells)
  const unsupported = new Uint32Array(cells)
  const firstCount = new Uint32Array(cells)
  const firstAbove = new Uint32Array(cells)
  const mean = new Float64Array(cells)
  const m2 = new Float64Array(cells)

  return {
    add(x: number, y: number, height: number, classification: number, first = false) {
      if (classification === 2 || classification === 7 || classification === 18) return
      const i = indexAt(grid, x, y)
      if (i < 0) return
      if (!Number.isFinite(height)) {
        unsupported[i]++
        return
      }
      if (height > PEM_HEIGHT_CEILING_M) return
      all[i]++
      if (first) firstCount[i]++
      if (height <= PEM_HEIGHT_CUTOFF_M) return
      if (first) firstAbove[i]++
      const n = ++above[i]
      const delta = height - mean[i]
      mean[i] += delta / n
      m2[i] += delta * (height - mean[i])
    },
    finish(): PemStructureRasters {
      const raster = (value: (i: number) => number): Raster => ({
        ...grid,
        values: Float32Array.from(all, (n, i) => (n > 0 && unsupported[i] === 0 ? value(i) : NaN)),
      })
      const sampleStd = (i: number) => (above[i] > 1 ? Math.sqrt(Math.max(0, m2[i]) / (above[i] - 1)) : NaN)
      return {
        pemEligible: raster((i) => all[i]),
        pemAbove2: raster((i) => above[i]),
        pemMean: raster((i) => (above[i] ? mean[i] : NaN)),
        pemRms: raster((i) => (above[i] ? Math.sqrt(Math.max(0, m2[i]) / above[i] + mean[i] ** 2) : NaN)),
        pemStd: raster(sampleStd),
        pemCover: raster((i) => (firstCount[i] ? (100 * firstAbove[i]) / firstCount[i] : NaN)),
        pemCv: raster((i) => (mean[i] > 0 ? sampleStd(i) / mean[i] : NaN)),
      }
    },
  }
}

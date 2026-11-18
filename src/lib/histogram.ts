/**
 * Histogram binning for `ValueHistogram` (`src/components/ui/value-histogram.tsx`). DOM-free.
 *
 * Bins are equal-width over a domain. A value on a break belongs to the bin above it, and the top
 * edge belongs to the last bin. Values outside the domain are counted as below or above, never
 * folded into the end bins, and NaN or infinite values (masked pixels, missing rows) are counted
 * as missing, never as zero.
 */

export interface HistogramBin {
  /** Inclusive lower edge. */
  from: number
  /** Exclusive upper edge (inclusive for the last bin). */
  to: number
  count: number
}

export interface Histogram {
  bins: HistogramBin[]
  /** Values counted in a bin. */
  binned: number
  below: number
  above: number
  /** NaN or infinite values, or values left out by `include`. */
  missing: number
  /** Mean of the binned values; NaN when none were. */
  mean: number
  /** The domain the bins cover. */
  domain: readonly [number, number]
}

export interface HistogramOptions {
  /** Bins cover this range. Omitted: the finite values' own minimum and maximum. */
  domain?: readonly [number, number]
  /** Number of bins; at least 1. */
  bins?: number
  /** Only values whose index passes are counted at all (a mask): the others are missing. */
  include?: (index: number) => boolean
}

/** The finite values' minimum and maximum, or null when there are none. */
export function finiteExtent(values: ArrayLike<number>): [number, number] | null {
  let min = Infinity,
    max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  return min <= max ? [min, max] : null
}

export function histogram(values: ArrayLike<number>, { domain, bins = 20, include }: HistogramOptions = {}): Histogram {
  const count = Math.max(1, Math.floor(bins))
  const extent = domain ?? finiteExtent(values) ?? [0, 1]
  let [low, high] = extent[0] <= extent[1] ? extent : [extent[1], extent[0]]
  // A single value still gets a bin of some width.
  if (high === low) [low, high] = [low - 0.5, high + 0.5]
  const width = (high - low) / count
  const counts = new Array<number>(count).fill(0)
  let binned = 0,
    below = 0,
    above = 0,
    missing = 0,
    sum = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!Number.isFinite(value) || (include && !include(i))) {
      missing++
      continue
    }
    if (value < low) {
      below++
      continue
    }
    if (value > high) {
      above++
      continue
    }
    const bin = Math.min(count - 1, Math.floor((value - low) / width))
    counts[bin]++
    binned++
    sum += value
  }
  return {
    bins: counts.map((n, i) => ({
      from: low + i * width,
      to: i === count - 1 ? high : low + (i + 1) * width,
      count: n,
    })),
    binned,
    below,
    above,
    missing,
    mean: binned ? sum / binned : NaN,
    domain: [low, high],
  }
}

/** The largest bin count, for scaling bars; 0 for an empty histogram. */
export const histogramPeak = (h: Pick<Histogram, 'bins'>) => h.bins.reduce((peak, bin) => Math.max(peak, bin.count), 0)

/** Pure sizing rules for `ResizableSplit`; no DOM, so the limits can be unit tested. */

export type PaneLimits = { min: number; max?: number }

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

/** Scale positive weights to fractions that sum to one; anything unusable falls back to equal panes. */
export function normalizeFractions(values: readonly number[], count: number): number[] {
  if (values.length !== count || values.some((value) => !Number.isFinite(value) || value <= 0))
    return Array.from({ length: count }, () => 1 / count)
  const total = sum(values)
  return values.map((value) => value / total)
}

/**
 * Move the boundary after pane `index` by `deltaPx`. Only the two panes either side of the
 * boundary change, so every other pane keeps its size; both stay inside their pixel limits.
 */
export function resizeFractions(
  fractions: readonly number[],
  index: number,
  deltaPx: number,
  containerPx: number,
  limits: readonly PaneLimits[],
): number[] {
  if (index < 0 || index >= fractions.length - 1 || !(containerPx > 0) || !Number.isFinite(deltaPx))
    return [...fractions]
  const pair = fractions[index] + fractions[index + 1]
  const pairPx = pair * containerPx
  const minA = limits[index]?.min ?? 0,
    minB = limits[index + 1]?.min ?? 0
  const maxA = limits[index]?.max ?? Infinity,
    maxB = limits[index + 1]?.max ?? Infinity
  const low = Math.max(minA, pairPx - maxB),
    high = Math.min(maxA, pairPx - minB)
  const wanted = fractions[index] * containerPx + deltaPx
  // A pair too small for both minimums shares the space in proportion to the minimums.
  const nextPx = low > high ? (pairPx * minA) / Math.max(1, minA + minB) : Math.min(high, Math.max(low, wanted))
  const next = [...fractions]
  next[index] = nextPx / containerPx
  next[index + 1] = pair - next[index]
  return next
}

/** Stacked panes have pixel heights of their own; a boundary changes only the pane above it. */
export function resizeStacked(heights: readonly number[], index: number, deltaPx: number, limits: readonly PaneLimits[]) {
  if (index < 0 || index >= heights.length || !Number.isFinite(deltaPx)) return [...heights]
  const next = [...heights]
  next[index] = Math.round(
    Math.min(limits[index]?.max ?? Infinity, Math.max(limits[index]?.min ?? 0, heights[index] + deltaPx)),
  )
  return next
}

export function readStoredSizes(key: string | undefined, count: number): number[] | null {
  if (!key) return null
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return Array.isArray(value) && value.length === count && value.every((n) => typeof n === 'number' && n > 0)
      ? value
      : null
  } catch {
    return null
  }
}

export function writeStoredSizes(key: string | undefined, sizes: readonly number[] | null) {
  if (!key) return
  try {
    if (sizes) localStorage.setItem(key, JSON.stringify(sizes.map((n) => Math.round(n * 10000) / 10000)))
    else localStorage.removeItem(key)
  } catch {
    /* Pane sizes are a convenience; private windows may refuse storage. */
  }
}

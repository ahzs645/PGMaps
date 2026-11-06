import type { CanueVariableSelection } from '../canueV2'

/** A resolved colour domain. A clipped end means real values lie beyond it. */
export interface CanueColorScale {
  low: number
  high: number
  clippedLow: boolean
  clippedHigh: boolean
}

/**
 * One year can dwarf the rest: BC's area PM2.5 sits at 4.1-14 for 98% of area
 * years and reaches 48.2 in 2023. A raw min-max scale would push nearly every
 * year into the bottom of the ramp, so the timeline scale drops 1% at each end.
 */
export const TIMELINE_SCALE_PERCENTILES = [0.01, 0.99] as const

function quantile(sorted: Float64Array, fraction: number) {
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.min(lower + 1, sorted.length - 1)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function withSpan(low: number, high: number): [number, number] {
  return high > low ? [low, high] : [low, low + 1]
}

/** The scale for one period on its own: its full range, never clipped. */
export function resolvePeriodScale(minValue: number | null, maxValue: number | null): CanueColorScale {
  const [low, high] = withSpan(minValue ?? 0, maxValue ?? minValue ?? 0)
  return { low, high, clippedLow: false, clippedHigh: false }
}

/** One scale for every area value on a timeline, so a colour means the same in every year. */
export function resolveBoundaryTimelineScale(values: readonly number[]): CanueColorScale | null {
  const sorted = Float64Array.from(values.filter(Number.isFinite)).sort()
  if (!sorted.length) return null
  const [low, high] = withSpan(
    quantile(sorted, TIMELINE_SCALE_PERCENTILES[0]),
    quantile(sorted, TIMELINE_SCALE_PERCENTILES[1]),
  )
  return { low, high, clippedLow: sorted[0] < low, clippedHigh: sorted[sorted.length - 1] > high }
}

/**
 * The grid equivalent. The catalog only publishes each period's min and max, not
 * its cells, so a percentile is unavailable. The top of the scale is the median
 * period's peak: one wildfire year cannot set it, and its cells clamp to the top.
 */
export function resolveGridTimelineScale(selections: readonly CanueVariableSelection[]): CanueColorScale | null {
  const peaks = selections.map((selection) => selection.max).filter((value) => value != null)
  const floors = selections.map((selection) => selection.min).filter((value) => value != null)
  if (!peaks.length || !floors.length) return null
  const lowest = Math.min(...floors)
  const [low, high] = withSpan(lowest, quantile(Float64Array.from(peaks).sort(), 0.5))
  return { low, high, clippedLow: false, clippedHigh: Math.max(...peaks) > high }
}

/** Every value a timeline shows, read from its loaded aggregates. */
export function collectTimelineValues(
  selections: readonly CanueVariableSelection[],
  rowsFor: (selection: CanueVariableSelection) => readonly { values: Record<string, number> }[] | null,
) {
  const values: number[] = []
  for (const selection of selections) {
    for (const row of rowsFor(selection) ?? []) {
      const value = row.values[selection.property]
      if (typeof value === 'number' && Number.isFinite(value)) values.push(value)
    }
  }
  return values
}

/**
 * The periods within `radius` archives of `current`, nearest first. Months of a
 * year share an archive, so the walk counts distinct archives rather than steps.
 */
export function selectionsAround(
  selections: readonly CanueVariableSelection[],
  current: CanueVariableSelection,
  radius: number,
) {
  const start = selections.findIndex((selection) => selection.pmtilesUrl === current.pmtilesUrl)
  if (start < 0) return []
  const seen = new Set([current.pmtilesUrl])
  const nearby: CanueVariableSelection[] = []
  const walk = (direction: 1 | -1) => {
    const found: CanueVariableSelection[] = []
    for (let index = start + direction; index >= 0 && index < selections.length; index += direction) {
      const selection = selections[index]
      if (seen.has(selection.pmtilesUrl)) continue
      seen.add(selection.pmtilesUrl)
      found.push(selection)
      if (found.length === radius) break
    }
    return found
  }
  const after = walk(1)
  const before = walk(-1)
  for (let offset = 0; offset < radius; offset += 1) {
    if (after[offset]) nearby.push(after[offset])
    if (before[offset]) nearby.push(before[offset])
  }
  return nearby
}

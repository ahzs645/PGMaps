/**
 * Colours for the plan's "Colour road by → Cost per metre": each station interval of the active
 * road takes the class `costIntensityClasses` (`costAttribution.ts`) gives it for one cost row or
 * the whole estimate, against the road's own average $/m. The sibling of `gradeClassRoadLines`
 * (`gradeClasses.ts`): it rewrites only the active road's segments, and each one carries its class
 * label and legend order, so the legend lists the classes cheapest first rather than in road order.
 *
 * Pure: no DOM or network access.
 */
import {
  COST_INTENSITY_BINS,
  COST_INTENSITY_SPECIAL_LABELS,
  costIntensityClasses,
  type CostAttribution,
  type CostIntensityClass,
  type CostSeriesId,
} from './costAttribution'

/**
 * Pale yellow to deep purple (viridis): no step reads as the plan's amber road, its red over-grade
 * segment or the grey of missing terrain, and the ramp stays ordered under colour-vision deficiency.
 */
export const COST_INTENSITY_COLORS: Record<CostIntensityClass, string> = {
  0: '#fde725',
  1: '#5ec962',
  2: '#21918c',
  3: '#3b528b',
  4: '#440154',
  /** A very light neutral: nothing of this row is placed there. */
  none: '#d6d3d1',
  /** The plan's own grey for a stretch without complete sections. */
  unknown: '#9ca3af',
}

/** Legend order: the bins cheapest first, then nothing placed, then unknown. */
export const COST_INTENSITY_ORDER: Record<CostIntensityClass, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  none: 5,
  unknown: 6,
}

/** One formatter for every label: three significant figures reads $3.45/m and $12,300/m alike. */
const PER_METRE = new Intl.NumberFormat('en-CA', { maximumSignificantDigits: 3 })
const dollars = (value: number) => `$${PER_METRE.format(value)}`

/** Whether `id` names a row of `attribution` (or is the whole estimate). */
export function hasCostSeries(attribution: CostAttribution, id: CostSeriesId): boolean {
  return id === 'total' || attribution.rows.some((row) => row.rowId === id)
}

/** The legend label of a class, in dollars per metre and as a multiple of the road's average. */
export function costIntensityLabel(cls: CostIntensityClass, averagePerMetre: number | null): string {
  if (cls === 'unknown' || cls === 'none') return COST_INTENSITY_SPECIAL_LABELS[cls]
  const bin = COST_INTENSITY_BINS[cls]
  if (averagePerMetre === null || !(averagePerMetre > 0)) return bin.label
  const low = bin.minRatio * averagePerMetre,
    high = bin.maxRatio * averagePerMetre
  if (bin.minRatio === 0) return `Under ${dollars(high)}/m (under ${bin.maxRatio}× avg)`
  if (!Number.isFinite(bin.maxRatio)) return `${dollars(low)}/m or more (${bin.minRatio}× avg or more)`
  return `${dollars(low)}–${dollars(high)}/m (${bin.minRatio}–${bin.maxRatio}× avg)`
}

/**
 * The legend's heading for the road: what is coloured (a row, or the whole estimate) and the
 * average every class is read against.
 */
export function costColourHeading(
  attribution: CostAttribution,
  id: CostSeriesId,
): { title: string; description: string } {
  const known = hasCostSeries(attribution, id) ? id : 'total'
  const { averagePerMetre } = costIntensityClasses(attribution, known)
  const what =
    known === 'total' ? 'Whole estimate' : (attribution.rows.find((row) => row.rowId === known)?.label ?? known)
  return {
    title: 'Cost per metre',
    description:
      averagePerMetre === null
        ? `${what} · no complete stretch to average`
        : `${what} · road average ${dollars(averagePerMetre)}/m`,
  }
}

/**
 * The active road's plan segments recoloured by cost per metre for one row (`'total'`: the whole
 * estimate). A segment is named by the station that ends it (`chainage`), which is the end of its
 * interval. A segment the attribution has no interval for is unknown. Other roads keep their own
 * colour. An unknown row id colours by the whole estimate.
 */
export function costColourLines(
  roads: GeoJSON.FeatureCollection,
  attribution: CostAttribution,
  id: CostSeriesId,
): GeoJSON.FeatureCollection {
  const known = hasCostSeries(attribution, id) ? id : 'total'
  const { classes, averagePerMetre } = costIntensityClasses(attribution, known)
  const byEnd = new Map(attribution.intervals.map((interval, k) => [interval.end, k]))
  const labels = new Map<CostIntensityClass, string>()
  const labelOf = (cls: CostIntensityClass) => {
    let label = labels.get(cls)
    if (label === undefined) labels.set(cls, (label = costIntensityLabel(cls, averagePerMetre)))
    return label
  }
  return {
    ...roads,
    features: roads.features.map((feature) => {
      const p = feature.properties ?? {}
      if (!p.selected || p.chainage === undefined) return feature
      const k = byEnd.get(Number(p.chainage))
      const cls: CostIntensityClass = k === undefined ? 'unknown' : classes[k]
      return {
        ...feature,
        properties: {
          ...p,
          color: COST_INTENSITY_COLORS[cls],
          legendLabel: labelOf(cls),
          legendOrder: COST_INTENSITY_ORDER[cls],
          costClass: String(cls),
        },
      }
    }),
  }
}

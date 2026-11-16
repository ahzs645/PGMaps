/**
 * Colours for the plan's "Colour road by → Cost per metre": each station interval of the active
 * road takes a colour from a continuous ramp by its cost per metre against the road's own average
 * $/m (`costIntensityClasses`, `costAttribution.ts`), for one cost row or the whole estimate. The
 * sibling of `gradeClassRoadLines` (`gradeClasses.ts`): it rewrites only the active road's
 * segments. A costed segment is read off the legend's ramp (`legendRamp`); a segment with nothing
 * placed or incomplete sections keeps a class label and legend order of its own.
 *
 * Pure: no DOM or network access.
 */
import {
  COST_INTENSITY_SPECIAL_LABELS,
  costIntensityClasses,
  type CostAttribution,
  type CostIntensityClass,
  type CostSeriesId,
} from './costAttribution'

/**
 * Pale yellow to deep purple (viridis), evenly spaced along the ramp: no step reads as the plan's
 * amber road, its red over-grade segment or the grey of missing terrain, and the ramp stays
 * ordered under colour-vision deficiency. The legend draws the same stops as a CSS gradient, which
 * interpolates in sRGB as `costRampColour` does, so the bar and the road agree.
 */
export const COST_RAMP_COLORS = ['#fde725', '#5ec962', '#21918c', '#3b528b', '#440154'] as const

/** Where the ramp starts and ends, as multiples of the road average; it is even in log scale, so 1× is its middle. */
export const COST_RAMP_MIN_RATIO = 0.25
export const COST_RAMP_MAX_RATIO = 4

/** The colours of the two kinds of segment that are not on the ramp. */
export const COST_INTENSITY_COLORS: Record<'none' | 'unknown', string> = {
  /** A very light neutral: nothing of this row is placed there. */
  none: '#d6d3d1',
  /** The plan's own grey for a stretch without complete sections. */
  unknown: '#9ca3af',
}

/** Legend order of the segments off the ramp: nothing placed, then unknown. */
export const COST_INTENSITY_ORDER: Record<'none' | 'unknown', number> = { none: 5, unknown: 6 }

/** A ratio to the road average as a place on the ramp, 0–1; past either end it holds the end. */
export function costRampPosition(ratio: number): number {
  if (!(ratio > COST_RAMP_MIN_RATIO)) return 0
  const t = Math.log(ratio / COST_RAMP_MIN_RATIO) / Math.log(COST_RAMP_MAX_RATIO / COST_RAMP_MIN_RATIO)
  return Math.min(1, t)
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const RAMP_RGB = COST_RAMP_COLORS.map(channels)

/** The ramp's colour at `t` (0–1), interpolated in sRGB between its even stops. */
export function costRampColour(t: number): string {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (RAMP_RGB.length - 1)
  const k = Math.min(RAMP_RGB.length - 2, Math.floor(x))
  const f = x - k
  const [a, b] = [RAMP_RGB[k], RAMP_RGB[k + 1]]
  return `#${a
    .map((v, i) =>
      Math.round(v + (b[i] - v) * f)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** One formatter for every label: three significant figures reads $3.45/m and $12,300/m alike. */
const PER_METRE = new Intl.NumberFormat('en-CA', { maximumSignificantDigits: 3 })
const dollars = (value: number) => `$${PER_METRE.format(value)}`

/** Whether `id` names a row of `attribution` (or is the whole estimate). */
export function hasCostSeries(attribution: CostAttribution, id: CostSeriesId): boolean {
  return id === 'total' || attribution.rows.some((row) => row.rowId === id)
}

/** One tick under the legend's ramp: a $/m figure and the multiple of the average it stands for. */
export interface CostRampTick {
  label: string
  note: string
}

/** The ramp's three ticks, its ends and its middle; the bare multiples without an average. */
export function costRampTicks(averagePerMetre: number | null): CostRampTick[] {
  const known = averagePerMetre !== null && averagePerMetre > 0
  const at = (ratio: number) => (known ? `${dollars(ratio * averagePerMetre)}/m` : `${ratio}×`)
  return [
    { label: `≤ ${at(COST_RAMP_MIN_RATIO)}`, note: '¼× avg' },
    { label: at(1), note: 'average' },
    { label: `≥ ${at(COST_RAMP_MAX_RATIO)}`, note: `${COST_RAMP_MAX_RATIO}× avg` },
  ]
}

/**
 * The legend's heading for the road: what is coloured (a row, or the whole estimate) and the
 * average every class is read against.
 */
export function costColourHeading(
  attribution: CostAttribution,
  id: CostSeriesId,
): {
  title: string
  description: string
  ramp: { colors: readonly string[]; ticks: CostRampTick[]; ariaLabel: string }
} {
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
    ramp: {
      colors: COST_RAMP_COLORS,
      ticks: costRampTicks(averagePerMetre),
      ariaLabel: `Cost per metre from a quarter of the road average or less to ${COST_RAMP_MAX_RATIO} times it or more`,
    },
  }
}

/**
 * The active road's plan segments recoloured by cost per metre for one row (`'total'`: the whole
 * estimate), on the ramp by their multiple of the road average. A segment is named by the station
 * that ends it (`chainage`), which is the end of its interval. A segment the attribution has no
 * interval for is unknown. Other roads keep their own colour. An unknown row id colours by the
 * whole estimate.
 */
export function costColourLines(
  roads: GeoJSON.FeatureCollection,
  attribution: CostAttribution,
  id: CostSeriesId,
): GeoJSON.FeatureCollection {
  const known = hasCostSeries(attribution, id) ? id : 'total'
  const { classes, perMetre, averagePerMetre } = costIntensityClasses(attribution, known)
  const byEnd = new Map(attribution.intervals.map((interval, k) => [interval.end, k]))
  return {
    ...roads,
    features: roads.features.map((feature) => {
      const p = feature.properties ?? {}
      if (!p.selected || p.chainage === undefined) return feature
      const k = byEnd.get(Number(p.chainage))
      const cls: CostIntensityClass = k === undefined ? 'unknown' : classes[k]
      if (cls === 'unknown' || cls === 'none')
        return {
          ...feature,
          properties: {
            ...p,
            color: COST_INTENSITY_COLORS[cls],
            legendLabel: COST_INTENSITY_SPECIAL_LABELS[cls],
            legendOrder: COST_INTENSITY_ORDER[cls],
            costClass: cls,
          },
        }
      // A class on the ramp has a known $/m and a positive average (`costIntensityClasses`).
      const ratio = perMetre[k!]! / averagePerMetre!
      return {
        ...feature,
        properties: {
          ...p,
          color: costRampColour(costRampPosition(ratio)),
          legendRamp: true,
          costRatio: ratio,
          costClass: String(cls),
        },
      }
    }),
  }
}

/**
 * Colours for the plan's "Colour road by → Cost per metre": each station interval of the active
 * road takes a colour from a continuous ramp by its cost per metre against the road's own average
 * $/m or a target the person sets (`costIntensityClasses`, `costAttribution.ts`; the ramp, its ends
 * and the reference are the person's, `roadColouring.ts`), for one cost row or the whole estimate. The
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
import { costRampColors, DEFAULT_COST_COLOURING, ratioText, type CostColourSettings } from './roadColouring'

/**
 * The default ramp's colours (`DEFAULT_COST_COLOURING`, viridis: pale yellow to deep purple): no
 * step reads as the plan's amber road, its red over-grade segment or the grey of missing terrain,
 * and it stays ordered under colour-vision deficiency. The person can choose another ramp
 * (`roadColouring.ts`); the legend draws the chosen ramp's stops as a CSS gradient, which
 * interpolates in sRGB as `costRampColour` does, so the bar and the road agree.
 */
export const COST_RAMP_COLORS = costRampColors(DEFAULT_COST_COLOURING)

/** The default ramp's ends, as multiples of the reference; even in log scale, so 1× is its middle. */
export const COST_RAMP_MIN_RATIO = DEFAULT_COST_COLOURING.minRatio
export const COST_RAMP_MAX_RATIO = DEFAULT_COST_COLOURING.maxRatio

/** The colours of the two kinds of segment that are not on the ramp. */
export const COST_INTENSITY_COLORS: Record<'none' | 'unknown', string> = {
  /** A very light neutral: nothing of this row is placed there. */
  none: '#d6d3d1',
  /** The plan's own grey for a stretch without complete sections. */
  unknown: '#9ca3af',
}

/** Legend order of the segments off the ramp: nothing placed, then unknown. */
export const COST_INTENSITY_ORDER: Record<'none' | 'unknown', number> = { none: 5, unknown: 6 }

type RampScale = Pick<CostColourSettings, 'minRatio' | 'maxRatio'>

/** A ratio to the reference as a place on the ramp, 0–1; past either end it holds the end. */
export function costRampPosition(ratio: number, scale: RampScale = DEFAULT_COST_COLOURING): number {
  const { minRatio, maxRatio } = scale
  if (!(ratio > minRatio)) return 0
  const t = Math.log(ratio / minRatio) / Math.log(maxRatio / minRatio)
  return Math.min(1, t)
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** The ramp's colour at `t` (0–1), interpolated in sRGB between its even stops. */
export function costRampColour(t: number, colors: readonly string[] = COST_RAMP_COLORS): string {
  const rgb = colors.map(channels)
  if (rgb.length === 1) return colors[0]
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (rgb.length - 1)
  const k = Math.min(rgb.length - 2, Math.floor(x))
  const f = x - k
  const [a, b] = [rgb[k], rgb[k + 1]]
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

/** One tick under the legend's ramp: a $/m figure and the multiple of the reference it stands for. */
export interface CostRampTick {
  label: string
  note: string
}

/**
 * The $/m every colour is read against: the road's average, or the person's target. Null when the
 * road has no average to read against (no complete stretch, or nothing costed).
 */
export function costReferencePerMetre(averagePerMetre: number | null, settings: CostColourSettings): number | null {
  if (averagePerMetre === null || !(averagePerMetre > 0)) return null
  return settings.reference === 'target' ? settings.targetPerMetre : averagePerMetre
}

/** The ramp's three ticks, its ends and its middle; the bare multiples without a reference. */
export function costRampTicks(
  referencePerMetre: number | null,
  settings: CostColourSettings = DEFAULT_COST_COLOURING,
): CostRampTick[] {
  const known = referencePerMetre !== null && referencePerMetre > 0
  const at = (ratio: number) => (known ? `${dollars(ratio * referencePerMetre)}/m` : `${ratioText(ratio)}×`)
  const short = settings.reference === 'target' ? 'target' : 'avg'
  return [
    { label: `≤ ${at(settings.minRatio)}`, note: `${ratioText(settings.minRatio)}× ${short}` },
    { label: at(1), note: settings.reference === 'target' ? 'target' : 'average' },
    { label: `≥ ${at(settings.maxRatio)}`, note: `${ratioText(settings.maxRatio)}× ${short}` },
  ]
}

/**
 * The legend's heading for the road: what is coloured (a row, or the whole estimate), the average
 * and, when the person set one, the target every colour is read against.
 */
export function costColourHeading(
  attribution: CostAttribution,
  id: CostSeriesId,
  settings: CostColourSettings = DEFAULT_COST_COLOURING,
): {
  title: string
  description: string
  ramp: { colors: readonly string[]; ticks: CostRampTick[]; ariaLabel: string }
} {
  const known = hasCostSeries(attribution, id) ? id : 'total'
  const { averagePerMetre } = costIntensityClasses(attribution, known)
  const what =
    known === 'total' ? 'Whole estimate' : (attribution.rows.find((row) => row.rowId === known)?.label ?? known)
  const target = settings.reference === 'target'
  const referenceName = target ? `the target of ${dollars(settings.targetPerMetre)}/m` : 'the road average'
  return {
    title: 'Cost per metre',
    description:
      averagePerMetre === null
        ? `${what} · no complete stretch to average`
        : target
          ? `${what} · target ${dollars(settings.targetPerMetre)}/m · road average ${dollars(averagePerMetre)}/m`
          : `${what} · road average ${dollars(averagePerMetre)}/m`,
    ramp: {
      colors: costRampColors(settings),
      ticks: costRampTicks(costReferencePerMetre(averagePerMetre, settings), settings),
      ariaLabel: `Cost per metre from ${ratioText(settings.minRatio)} times ${referenceName} or less to ${ratioText(settings.maxRatio)} times it or more`,
    },
  }
}

/**
 * The active road's plan segments recoloured by cost per metre for one row (`'total'`: the whole
 * estimate), on the ramp by their multiple of the reference (the road average, or the person's
 * target). A segment is named by the station that ends it (`chainage`), which is the end of its
 * interval. A segment the attribution has no interval for is unknown. Other roads keep their own
 * colour. An unknown row id colours by the whole estimate.
 */
export function costColourLines(
  roads: GeoJSON.FeatureCollection,
  attribution: CostAttribution,
  id: CostSeriesId,
  settings: CostColourSettings = DEFAULT_COST_COLOURING,
): GeoJSON.FeatureCollection {
  const known = hasCostSeries(attribution, id) ? id : 'total'
  const { classes, perMetre, averagePerMetre } = costIntensityClasses(attribution, known)
  const reference = costReferencePerMetre(averagePerMetre, settings)
  const colors = costRampColors(settings)
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
      const ratio = perMetre[k!]! / reference!
      return {
        ...feature,
        properties: {
          ...p,
          color: costRampColour(costRampPosition(ratio, settings), colors),
          legendRamp: true,
          costRatio: ratio,
          costClass: String(cls),
        },
      }
    }),
  }
}

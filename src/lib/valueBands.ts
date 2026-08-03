import { hexToRgb, rgbToHex } from './color'

/**
 * Ordered numeric bands — the shape shared by every scale on the site that maps
 * a measurement onto a laballed, coloured step: AQHI+ levels, walkability
 * Mobility Index bands, and anything added later.
 *
 * A scale owns its own band list and domain rules; this module owns the shape
 * and the derivations every consumer repeats — value lookup, legend rows, ramp
 * colours, and merging metadata that ships with generated data.
 *
 * Bands are expected to be ordered ascending and non-overlapping, with the top
 * band open-ended (`max: Infinity`). Lookups do not clamp: a value outside every
 * band returns null so callers can render their own "no data" state rather than
 * silently snapping to an end band.
 */

export interface ValueBand<TId extends string | number = string | number> {
  /**
   * Stable identity for the band — the value generated data stores, or the
   * published level number of a standard scale.
   */
  id: TId
  /** Inclusive lower bound. */
  min: number
  /** Exclusive upper bound; `Infinity` for the open-ended top band. */
  max: number
  /** Display label for legends, e.g. `28-45`. */
  label: string
  color: string
  /** Optional rollup grouping, e.g. an AQHI+ risk category. */
  category?: string
}

/** Colours and labels keyed by band id, as generated data tends to carry them. */
export interface ValueBandMetadata {
  colors?: Record<string, string> | null
  labels?: Record<string, string> | null
}

export interface MergeValueBandOptions {
  /**
   * Normalises a label from generated data. Return null to reject it and keep
   * the band's own label — used to drop generator prefixes and blank values.
   */
  formatLabel?: (rawLabel: string) => string | null
}

/** The band containing `value`, or null when it falls outside every band. */
export function findValueBand<TBand extends ValueBand>(
  bands: readonly TBand[],
  value: number | null | undefined,
): TBand | null {
  if (value == null || !Number.isFinite(value)) return null
  return bands.find((band) => value >= band.min && value < band.max) ?? null
}

/** Label/colour pairs for `MapSteppedLegend`. */
export function valueBandLegendItems(bands: readonly ValueBand[]): Array<{ label: string; color: string }> {
  return bands.map(({ label, color }) => ({ label, color }))
}

/** Ordered colour ramp, lowest band first. */
export function valueBandRampColors(bands: readonly ValueBand[]): string[] {
  return bands.map((band) => band.color)
}

/** Colours keyed by band id, for raster painters that index by stored value. */
export function valueBandColorsById(bands: readonly ValueBand[]): Record<string, string> {
  return Object.fromEntries(bands.map((band) => [String(band.id), band.color]))
}

// ---------------------------------------------------------------------------
// Colour-stop ramps
// ---------------------------------------------------------------------------
// Bands above describe labelled ranges a value falls *into*. A ramp instead
// describes colours a value is measured *against*, and can be read either as
// discrete steps or blended between neighbours. Choropleths over continuous
// quantities (assessed value, year built) want the ramp; scales with published
// levels (AQHI+, Mobility Index) want the bands.

/** `[threshold, colour]` pairs in ascending order. Each threshold is the range's *upper* bound. */
export type ColorStops = readonly (readonly [number, string])[]

/** Index of the first stop at or above `value`, or -1 when it exceeds every stop. */
function findStopIndex(stops: ColorStops, value: number): number {
  return stops.findIndex(([threshold]) => value <= threshold)
}

/** The colour of the range `value` falls in, as a hard step. Clamps to the end stops. */
export function stopColor(stops: ColorStops, value: number): string {
  if (!stops.length) return '#000000'
  const index = findStopIndex(stops, value)
  return index === -1 ? stops[stops.length - 1][1] : stops[index][1]
}

/**
 * Like {@link stopColor} but blended between the two stops bracketing `value`,
 * for a continuous ramp rather than visible banding. Clamps to the end stops.
 */
export function interpolateStopColor(stops: ColorStops, value: number): string {
  if (!stops.length) return '#000000'
  const index = findStopIndex(stops, value)
  if (index === -1) return stops[stops.length - 1][1]
  if (index === 0) return stops[0][1]

  const [lowerValue, lowerColor] = stops[index - 1]
  const [upperValue, upperColor] = stops[index]
  // Guard against duplicate thresholds, which would divide by zero.
  const span = upperValue - lowerValue || 1
  const ratio = Math.min(1, Math.max(0, (value - lowerValue) / span))

  const lower = hexToRgb(lowerColor)
  const upper = hexToRgb(upperColor)
  return rgbToHex([
    lower[0] + (upper[0] - lower[0]) * ratio,
    lower[1] + (upper[1] - lower[1]) * ratio,
    lower[2] + (upper[2] - lower[2]) * ratio,
  ])
}

function readText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return raw.trim() || null
}

/**
 * Overlays generated metadata onto a band list, per band and per field, so a
 * dataset that defines only colours keeps its labels (and vice versa). Blank or
 * non-textual entries fall back rather than rendering empty.
 *
 * Ranges are never taken from metadata: `min`/`max` stay as the scale defines
 * them, because the code that bins values is what they have to agree with.
 */
export function mergeValueBandMetadata<TBand extends ValueBand>(
  bands: readonly TBand[],
  metadata?: ValueBandMetadata | null,
  options?: MergeValueBandOptions,
): TBand[] {
  const formatLabel = options?.formatLabel ?? readText
  return bands.map((band) => {
    const key = String(band.id)
    const rawLabel = readText(metadata?.labels?.[key])
    return {
      ...band,
      color: readText(metadata?.colors?.[key]) ?? band.color,
      label: (rawLabel == null ? null : formatLabel(rawLabel)) ?? band.label,
    }
  })
}

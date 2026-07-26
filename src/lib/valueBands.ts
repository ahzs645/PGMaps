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

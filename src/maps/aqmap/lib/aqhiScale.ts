// Canonical AQHI+ (PM2.5-derived) colour scale.
//
// Mirrors the `aqhi` R package that powers aqmapr
// (https://github.com/B-Nilson/aqhi): ten equal 10 µg/m³ bins from 0–100 plus an
// open-ended "+" band above 100, each tied to the official AQHI+ colour. The ten
// numbered levels collapse into the four AQHI+ risk categories (Low / Moderate /
// High / Very High) on the usual 30 / 60 / 100 boundaries.
//
// This is the single source of truth for monitor colouring on the AQmap page —
// markers, popups, the forecast-zone fill, plot thresholds and the legend all
// call into it so the palette stays in lockstep.

import { findValueBand, valueBandRampColors, type ValueBand } from '@/lib/valueBands'

export type AqhiCategory = 'Low' | 'Moderate' | 'High' | 'Very High' | 'No Data'

/**
 * An AQHI+ level, expressed as a {@link ValueBand} so it shares the site's band
 * lookups and legend derivations. `id` is the published level (1–10, or '+' for
 * the open-ended band); `min`/`max` are PM2.5 bounds in µg/m³.
 *
 * Unlike the walkability MI bands, this scale is a published standard: the
 * colours and cut points come from the `aqhi` R package, so they are never
 * overridden from fetched data.
 */
export interface AqhiLevel extends ValueBand<number | '+'> {
  category: AqhiCategory
}

/** Colour used when a monitor has no recent valid reading. */
export const AQHI_NO_DATA_COLOR = '#bbbbbb'

/** The eleven AQHI+ levels, ordered from cleanest (1) to worst ("+"). */
export const AQHI_LEVELS: readonly AqhiLevel[] = [
  { id: 1, min: 0, max: 10, label: '0-10', color: '#21c6f5', category: 'Low' },
  { id: 2, min: 10, max: 20, label: '10-20', color: '#189aca', category: 'Low' },
  { id: 3, min: 20, max: 30, label: '20-30', color: '#0d6797', category: 'Low' },
  { id: 4, min: 30, max: 40, label: '30-40', color: '#fffd37', category: 'Moderate' },
  { id: 5, min: 40, max: 50, label: '40-50', color: '#ffcc2e', category: 'Moderate' },
  { id: 6, min: 50, max: 60, label: '50-60', color: '#fe9a3f', category: 'Moderate' },
  { id: 7, min: 60, max: 70, label: '60-70', color: '#fd6769', category: 'High' },
  { id: 8, min: 70, max: 80, label: '70-80', color: '#ff3b3b', category: 'High' },
  { id: 9, min: 80, max: 90, label: '80-90', color: '#ff0101', category: 'High' },
  { id: 10, min: 90, max: 100, label: '90-100', color: '#cb0713', category: 'High' },
  { id: '+', min: 100, max: Number.POSITIVE_INFINITY, label: '100+', color: '#650205', category: 'Very High' },
]

/** Ordered colour ramp (level 1 → "+") for gradient / stepped legends. */
export const AQHI_RAMP_COLORS: readonly string[] = valueBandRampColors(AQHI_LEVELS)

/** Representative colour for each risk category (used by the compact legend rows). */
export const AQHI_CATEGORY_COLORS: Record<Exclude<AqhiCategory, 'No Data'>, string> = {
  Low: '#189aca',
  Moderate: '#ffcc2e',
  High: '#ff3b3b',
  'Very High': '#650205',
}

/** Resolve the AQHI+ level for a PM2.5 reading, or null when there is no data. */
export function getAqhiLevel(pm25: number | null | undefined): AqhiLevel | null {
  // Negative readings fall below the first band, so the shared lookup rejects
  // them the same way it rejects null/NaN.
  return findValueBand(AQHI_LEVELS, pm25)
}

/** AQHI+ colour for a PM2.5 reading; the no-data grey when missing/invalid. */
export function getAqhiPlusColor(pm25: number | null | undefined): string {
  return getAqhiLevel(pm25)?.color ?? AQHI_NO_DATA_COLOR
}

/** AQHI+ risk category for a PM2.5 reading. */
export function getAqhiPlusCategory(pm25: number | null | undefined): AqhiCategory {
  return getAqhiLevel(pm25)?.category ?? 'No Data'
}

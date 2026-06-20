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

export type AqhiCategory = 'Low' | 'Moderate' | 'High' | 'Very High' | 'No Data'

export interface AqhiLevel {
  /** AQHI+ level: 1–10, or '+' for the open-ended >100 band. */
  level: number | '+'
  /** Inclusive lower PM2.5 bound (µg/m³). */
  min: number
  /** Exclusive upper PM2.5 bound (µg/m³); null for the open-ended "+" band. */
  max: number | null
  /** Official AQHI+ hex colour for this level. */
  color: string
  /** Risk category this level rolls up into. */
  category: AqhiCategory
}

/** Colour used when a monitor has no recent valid reading. */
export const AQHI_NO_DATA_COLOR = '#bbbbbb'

/** The eleven AQHI+ levels, ordered from cleanest (1) to worst ("+"). */
export const AQHI_LEVELS: readonly AqhiLevel[] = [
  { level: 1, min: 0, max: 10, color: '#21c6f5', category: 'Low' },
  { level: 2, min: 10, max: 20, color: '#189aca', category: 'Low' },
  { level: 3, min: 20, max: 30, color: '#0d6797', category: 'Low' },
  { level: 4, min: 30, max: 40, color: '#fffd37', category: 'Moderate' },
  { level: 5, min: 40, max: 50, color: '#ffcc2e', category: 'Moderate' },
  { level: 6, min: 50, max: 60, color: '#fe9a3f', category: 'Moderate' },
  { level: 7, min: 60, max: 70, color: '#fd6769', category: 'High' },
  { level: 8, min: 70, max: 80, color: '#ff3b3b', category: 'High' },
  { level: 9, min: 80, max: 90, color: '#ff0101', category: 'High' },
  { level: 10, min: 90, max: 100, color: '#cb0713', category: 'High' },
  { level: '+', min: 100, max: null, color: '#650205', category: 'Very High' },
]

/** Ordered colour ramp (level 1 → "+") for gradient / stepped legends. */
export const AQHI_RAMP_COLORS: readonly string[] = AQHI_LEVELS.map((entry) => entry.color)

/** Representative colour for each risk category (used by the compact legend rows). */
export const AQHI_CATEGORY_COLORS: Record<Exclude<AqhiCategory, 'No Data'>, string> = {
  Low: '#189aca',
  Moderate: '#ffcc2e',
  High: '#ff3b3b',
  'Very High': '#650205',
}

function isValidPm(pm25: number | null | undefined): pm25 is number {
  return pm25 !== null && pm25 !== undefined && Number.isFinite(pm25) && pm25 >= 0
}

/** Resolve the AQHI+ level for a PM2.5 reading, or null when there is no data. */
export function getAqhiLevel(pm25: number | null | undefined): AqhiLevel | null {
  if (!isValidPm(pm25)) return null
  return AQHI_LEVELS.find((entry) => entry.max === null || pm25 < entry.max) ?? AQHI_LEVELS[AQHI_LEVELS.length - 1]
}

/** AQHI+ colour for a PM2.5 reading; the no-data grey when missing/invalid. */
export function getAqhiPlusColor(pm25: number | null | undefined): string {
  return getAqhiLevel(pm25)?.color ?? AQHI_NO_DATA_COLOR
}

/** AQHI+ risk category for a PM2.5 reading. */
export function getAqhiPlusCategory(pm25: number | null | undefined): AqhiCategory {
  return getAqhiLevel(pm25)?.category ?? 'No Data'
}

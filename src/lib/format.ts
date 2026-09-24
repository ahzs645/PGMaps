/**
 * Every formatter here pins this locale so output does not change with the
 * viewer's browser settings. Call sites that need `toLocaleString` directly
 * (custom units, compact suffixes) should pass this rather than `undefined`.
 */
export const DEFAULT_LOCALE = 'en-CA'

export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  fallback?: string
}

export function formatDate(
  value: string | number | Date | null | undefined,
  { fallback = 'Unknown', ...options }: FormatDateOptions = {},
): string {
  if (value == null || value === '') return fallback
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString(DEFAULT_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  })
}

export interface FormatNumberOptions extends Intl.NumberFormatOptions {
  fallback?: string
}

export function formatNumber(
  value: number | null | undefined,
  { fallback = 'No value', ...options }: FormatNumberOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return fallback
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0, ...options })
}

export function formatCurrency(
  value: number | null | undefined,
  { fallback = 'No value', ...options }: FormatNumberOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return fallback
  return value.toLocaleString(DEFAULT_LOCALE, {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
    ...options,
  })
}

export function formatPercent(
  value: number | null | undefined,
  { fallback = 'No value', ...options }: FormatNumberOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return fallback
  return value.toLocaleString(DEFAULT_LOCALE, {
    style: 'percent',
    maximumFractionDigits: 1,
    ...options,
  })
}

/**
 * Formats a value that is already scaled to 0-100 (e.g. 12.3 -> "12.3%").
 * Use formatPercent for 0-1 fractions.
 */
export function formatPercentValue(
  value: number | null | undefined,
  { fallback = 'No value', ...options }: FormatNumberOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return fallback
  return `${value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1, ...options })}%`
}

/** Square metres as m² below a hectare, hectares above. Empty string for 0/null. */
export function formatArea(squareMetres: number | null | undefined): string {
  if (!squareMetres) return ''
  if (squareMetres >= 10_000) return `${(squareMetres / 10_000).toFixed(1)} ha`
  return `${Math.round(squareMetres)} m²`
}

/** Metres as m below a kilometre, km above. Empty string for 0/null. */
export function formatLength(metres: number | null | undefined): string {
  if (!metres) return ''
  if (metres >= 1_000) return `${(metres / 1_000).toFixed(1)} km`
  return `${Math.round(metres)} m`
}

/** Abbreviated currency for tight UI (e.g. $1.2B / $3.4M / $560K). */
export function formatCompactCurrency(
  value: number | null | undefined,
  { fallback = 'No value' }: { fallback?: string } = {},
): string {
  if (value == null || !Number.isFinite(value)) return fallback
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })}B`
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })}M`
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0 })}K`
  }
  return `${sign}$${abs.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0 })}`
}

/** Binary-scaled file size (B, KB, MB, GB). `fallback` for null/NaN. */
export function formatBytes(
  bytes: number | null | undefined,
  { fallback = 'Unknown size', digits = 1 }: { fallback?: string; digits?: number } = {},
): string {
  if (bytes == null || !Number.isFinite(bytes)) return fallback
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(digits)} ${units[unit]}`
}

/** Square kilometres, e.g. "12.3 km²". Empty string for 0/null. */
export function formatSquareKm(squareKm: number | null | undefined, { digits = 1 }: { digits?: number } = {}): string {
  if (!squareKm || !Number.isFinite(squareKm)) return ''
  return `${squareKm.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: digits })} km²`
}

/** Month names in the pinned locale, January first. */
export const MONTH_NAMES: readonly string[] = Array.from({ length: 12 }, (_, month) =>
  new Date(2000, month, 1).toLocaleDateString(DEFAULT_LOCALE, { month: 'long' }),
)

/** Three-letter month names, January first ("Jan", "Feb", ...). */
export const MONTH_SHORT_NAMES: readonly string[] = MONTH_NAMES.map((name) => name.slice(0, 3))

/** "Sep 2026" */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(DEFAULT_LOCALE, { month: 'short', year: 'numeric' })
}

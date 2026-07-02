const DEFAULT_LOCALE = 'en-CA'

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

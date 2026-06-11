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

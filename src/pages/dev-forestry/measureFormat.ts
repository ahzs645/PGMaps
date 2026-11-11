import { formatMeasure } from '@/lib/format'

/**
 * Distances and areas as the visual-quality panels print them. Station positions
 * keep two decimals of a kilometre so stations a few metres apart stay apart.
 */
export function formatKm(metres: number | null | undefined, digits = 2, fallback = '—'): string {
  return formatMeasure(metres == null ? null : metres / 1000, 'km', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    fallback,
  })
}

/** Hectares from square metres, up to one decimal ("131.2 ha", "12 ha"). */
export function formatHa(squareMetres: number, maximumFractionDigits = 1): string {
  return formatMeasure(squareMetres / 10_000, 'ha', { maximumFractionDigits })
}

/** A value already on a 0–100 scale, at a fixed number of decimals ("12.5%"). */
export function formatPct(value: number | null | undefined, digits = 1, fallback = '—'): string {
  return formatMeasure(value, '%', { minimumFractionDigits: digits, maximumFractionDigits: digits, fallback })
}

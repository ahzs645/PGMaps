import { formatNumber } from '@/lib/format'

export const formatRoadNumber = (value: number | null | undefined, decimals = 1) =>
  formatNumber(value, { maximumFractionDigits: decimals, fallback: '—' })

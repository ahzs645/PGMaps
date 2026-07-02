import { useFetchData } from '@/hooks/useFetchData'

export { formatDate } from '@/lib/format'

// Not migrated to @/lib/format's formatNumber: this intentionally formats with the
// runtime's default locale (`toLocaleString(undefined, ...)`), while the shared
// helper pins 'en-CA'. Outputs differ for non-en-CA runtimes.
export function formatNullableNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'No value'
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

export function useJsonManifest<T>(path: string | null) {
  return useFetchData<T>(path)
}

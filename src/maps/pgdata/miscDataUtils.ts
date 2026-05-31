export function formatFileSize(bytes?: number | null): string {
  if (!Number.isFinite(bytes ?? NaN)) return 'Unknown size'
  const value = bytes ?? 0
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

export function formatVectorStatus(status: string): string {
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

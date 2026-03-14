import type { CrimeCategory } from './types'

export const CRIME_CATEGORY_COLORS: Record<CrimeCategory, string> = {
  'Break & Enter': '#ef4444',
  'Bike Theft': '#a855f7',
  'Other Theft': '#f97316',
  'Mischief': '#eab308',
  'Theft of Vehicle': '#3b82f6',
  'Theft from Vehicle': '#14b8a6',
}

export function getCrimeCategory(crimeType: string): CrimeCategory {
  if (crimeType.startsWith('Break')) return 'Break & Enter'
  if (crimeType.startsWith('Bike')) return 'Bike Theft'
  if (crimeType.startsWith('Mischief')) return 'Mischief'
  if (crimeType.startsWith('Theft of Vehicle')) return 'Theft of Vehicle'
  if (crimeType.startsWith('Theft from Vehicle')) return 'Theft from Vehicle'
  return 'Other Theft'
}

export function getCrimeCategoryColor(crimeType: string): string {
  return CRIME_CATEGORY_COLORS[getCrimeCategory(crimeType)] ?? '#64748b'
}

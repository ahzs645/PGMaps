import type { PropertyCategory, ColorMetric } from './types'

export const ASSESSMENT_HISTORY_START_YEAR = 2017

export const CATEGORY_COLORS: Record<PropertyCategory, string> = {
  residential: '#3b82f6',
  'multi-family': '#8b5cf6',
  commercial: '#f59e0b',
  industrial: '#6b7280',
  institutional: '#06b6d4',
  vacant: '#84cc16',
  farm: '#22c55e',
  other: '#a3a3a3',
}

export const CATEGORY_LABELS: Record<PropertyCategory, string> = {
  residential: 'Residential',
  'multi-family': 'Multi-Family',
  commercial: 'Commercial',
  industrial: 'Industrial',
  institutional: 'Institutional',
  vacant: 'Vacant',
  farm: 'Farm',
  other: 'Other',
}

export const ALL_CATEGORIES: PropertyCategory[] = [
  'residential',
  'multi-family',
  'commercial',
  'industrial',
  'institutional',
  'vacant',
  'farm',
  'other',
]

export const COLOR_METRICS: { value: ColorMetric; label: string }[] = [
  { value: 'totalAssessed', label: 'Total Assessed' },
  { value: 'totalLand', label: 'Land Value' },
  { value: 'totalBuilding', label: 'Building Value' },
  { value: 'yearBuilt', label: 'Year Built' },
]

/** Value-to-color stops for the assessed value choropleth. */
export const VALUE_STOPS: [number, string][] = [
  [0, '#eff6ff'],
  [100_000, '#bfdbfe'],
  [200_000, '#93c5fd'],
  [350_000, '#60a5fa'],
  [500_000, '#3b82f6'],
  [750_000, '#2563eb'],
  [1_000_000, '#1d4ed8'],
  [2_000_000, '#1e3a8a'],
  [5_000_000, '#172554'],
]

/** Year-built color stops (older = warmer, newer = cooler). */
export const YEAR_STOPS: [number, string][] = [
  [1900, '#dc2626'],
  [1940, '#f97316'],
  [1960, '#eab308'],
  [1980, '#22c55e'],
  [2000, '#06b6d4'],
  [2010, '#3b82f6'],
  [2020, '#8b5cf6'],
]

export function getCategoryColor(category: PropertyCategory): string {
  return CATEGORY_COLORS[category] ?? '#a3a3a3'
}


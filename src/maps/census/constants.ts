import type { CensusHierarchyOption, CensusMetricOption } from './types'

export const CENSUS_METRICS: CensusMetricOption[] = [
  { key: 'populationDensity', label: 'Population Density (/km²)', format: 'decimal' },
  { key: 'population', label: 'Population (2021)', format: 'int' },
  { key: 'households', label: 'Households', format: 'int' },
  { key: 'dwellings', label: 'Dwellings', format: 'int' },
  { key: 'areaSqKm', label: 'Land Area (km²)', format: 'decimal' }
]

export const CENSUS_HIERARCHIES: CensusHierarchyOption[] = [
  { key: 'da', label: 'Dissemination Area (DA)' },
  { key: 'rpid', label: 'RPID' },
  { key: 'rgid', label: 'RGID' },
  { key: 'ruid', label: 'RUID' },
  { key: 'rguid', label: 'RGUID' }
]

export function formatMetricValue(value: number | null, format: 'int' | 'decimal'): string {
  if (value == null || !Number.isFinite(value)) return 'N/A'
  if (format === 'decimal') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return Math.round(value).toLocaleString()
}

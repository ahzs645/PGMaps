import type { CensusHierarchyOption, CensusMetricOption } from './types'
import { DEFAULT_LOCALE } from '@/lib/format'

export const CENSUS_METRICS: CensusMetricOption[] = [
  {
    key: 'populationDensity',
    label: 'Population Density (/km²)',
    format: 'decimal',
    levels: ['cd', 'csd', 'ct', 'da', 'db']
  },
  {
    key: 'population',
    label: 'Population (2021)',
    format: 'int',
    levels: ['cd', 'csd', 'ct', 'da', 'db']
  },
  {
    key: 'households',
    label: 'Households',
    format: 'int',
    levels: ['cd', 'csd', 'ct', 'da', 'db']
  },
  {
    key: 'dwellings',
    label: 'Dwellings',
    format: 'int',
    levels: ['cd', 'csd', 'ct', 'da', 'db']
  },
  {
    key: 'areaSqKm',
    label: 'Land Area (km²)',
    format: 'decimal',
    levels: ['cd', 'csd', 'ct', 'da', 'db']
  },
  {
    key: 'daCount',
    label: 'DA Count',
    format: 'int',
    levels: ['cd', 'csd', 'ct']
  },
  {
    key: 'dbCount',
    label: 'DB Count',
    format: 'int',
    levels: ['cd', 'csd', 'ct', 'da']
  }
]

export const CENSUS_HIERARCHIES: CensusHierarchyOption[] = [
  { key: 'cd', label: 'Census Division (CD)' },
  { key: 'csd', label: 'Census Subdivision (CSD)' },
  { key: 'ct', label: 'Census Tract (CT)' },
  { key: 'da', label: 'Dissemination Area (DA)' },
  { key: 'db', label: 'Dissemination Block (DB)' }
]

export function formatMetricValue(value: number | null, format: 'int' | 'decimal'): string {
  if (value == null || !Number.isFinite(value)) return 'N/A'
  if (format === 'decimal') {
    return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })
  }
  return Math.round(value).toLocaleString()
}

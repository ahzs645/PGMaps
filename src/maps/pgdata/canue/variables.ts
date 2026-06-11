import type { CanueVariableSelection } from '../canueV2'
import {
  CANUE_ANNUAL_YEAR_PATTERN,
  CANUE_DATASET_SUFFIX_LABELS,
  CANUE_DEFAULT_VARIABLE_BY_DATASET,
  CANUE_EXACT_VARIABLE_LABELS,
  CANUE_MONTH_BY_KEY,
  CANUE_MONTH_BY_VALUE,
  CANUE_MONTH_PATTERN,
  CANUE_SUFFIX_LABELS_BY_DATASET,
  CANUE_V2_PREFERRED_MEASURE_KEYS,
} from './constants'
import type { CanueFile, CanueV2Cadence, CanueYearMode } from './types'

export function getCanueVariableLabel(file: CanueFile | null, variable: string): string {
  if (!file) return variable
  if (CANUE_EXACT_VARIABLE_LABELS[variable]) return CANUE_EXACT_VARIABLE_LABELS[variable]
  if (file.cadence === 'monthly') {
    if (variable === 'pm25') return 'Monthly PM2.5'
    if (variable.startsWith('aqsmk')) return 'Monthly smoke PM2.5'
    if (variable.startsWith('aqozn_8h')) return 'Monthly ozone 8-hour'
    if (variable.startsWith('aqozn_mn')) return 'Monthly ozone mean'
    if (variable.startsWith('aqno2')) return 'Monthly NO2'
    return `${file.label} monthly measure`
  }

  const match = variable.match(/_(\d+)$/)
  const suffix = match?.[1]
  const datasetLabel = suffix ? CANUE_SUFFIX_LABELS_BY_DATASET[file.datasetId]?.[suffix] : null
  if (datasetLabel) return datasetLabel

  if (
    (file.datasetId === 'nhbld_ava' ||
      file.datasetId === 'nhfac_ava' ||
      file.datasetId === 'nhscn_ava' ||
      file.datasetId === 'nhtsp_ava') &&
    suffix
  ) {
    const buffers = ['100m', '250m', '300m', '500m', '750m', '1000m']
    const buffer = buffers[Number(suffix) - 1]
    if (file.datasetId === 'nhbld_ava' && buffer) return `Building density at ${buffer}`
    if (file.datasetId === 'nhscn_ava' && buffer) return `Intersections within ${buffer}`
    if (file.datasetId === 'nhtsp_ava' && buffer) return `Bus stops within ${buffer}`
    if (file.datasetId === 'nhfac_ava' && buffer) return `Facility richness at ${buffer}`
    if (file.datasetId === 'nhfac_ava' && Number(suffix) > 6)
      return `Facility density at ${buffers[Number(suffix) - 7]}`
  }

  const measure = suffix ? Number(suffix).toLocaleString(undefined, { minimumIntegerDigits: 2 }) : variable
  return `${file.label} measure ${measure}`
}

export function getDefaultCanueVariable(file: CanueFile): string | null {
  const preferred = CANUE_DEFAULT_VARIABLE_BY_DATASET[file.datasetId]
  if (preferred && file.variables.includes(preferred)) return preferred
  return getSelectableCanueVariables(file)[0] ?? null
}

export function getCanueVariableSuffix(variable: string | null): string | null {
  return variable?.match(/_(\d+)$/)?.[1] ?? null
}

export function getCanueDatasetSuffixLabel(dataset: string): string | null {
  const match = dataset.match(/^([a-z]+)_(\d+)$/i)
  if (!match) return null
  return CANUE_DATASET_SUFFIX_LABELS[match[1].toLowerCase()]?.[match[2]] ?? null
}

export function getCanueVariableFamily(variable: string): string {
  return variable.replace(CANUE_MONTH_PATTERN, '')
}

export function getSelectableCanueVariables(file: CanueFile): string[] {
  if (file.cadence !== 'monthly') return file.variables
  return Array.from(new Set(file.variables.map(getCanueVariableFamily)))
}

export function findCanueVariablesForFile(file: CanueFile, selectedVariable: string, month: number | null): string[] {
  if (file.cadence === 'monthly') {
    const family = getCanueVariableFamily(selectedVariable)
    const monthKey = month ? CANUE_MONTH_BY_VALUE.get(month)?.key : null
    return file.variables.filter((variable) => {
      if (getCanueVariableFamily(variable) !== family) return false
      return monthKey ? variable.toLowerCase().includes(`_${monthKey}_`) : true
    })
  }

  if (file.variables.includes(selectedVariable)) return [selectedVariable]
  const suffix = getCanueVariableSuffix(selectedVariable)
  if (!suffix) return []
  const matched = file.variables.find((variable) => getCanueVariableSuffix(variable) === suffix)
  return matched ? [matched] : []
}

export function getCanuePeriodLabel(files: CanueFile[], mode: CanueYearMode, month: number | null): string {
  if (!files.length) return 'No years'
  if (mode === 'month') {
    const monthLabel = CANUE_MONTH_BY_VALUE.get(month ?? 1)?.label ?? 'Month'
    return `${monthLabel} ${files[0].year}`
  }
  if (files.length === 1) return files[0].cadence === 'monthly' ? `${files[0].year} average` : String(files[0].year)
  const years = files.map((file) => file.year).sort((a, b) => a - b)
  const range = `${years[0]}-${years[years.length - 1]}`
  return mode === 'single' ? String(files[0].year) : `${range} average`
}

export function getCanueV2MonthKey(variable: string): string | null {
  return variable.match(CANUE_MONTH_PATTERN)?.[1]?.toLowerCase() ?? null
}

export function getCanueV2SelectionDate(selection: CanueVariableSelection): Date {
  const month = getCanueV2MonthKey(selection.variable)
  return new Date(selection.year, month ? (CANUE_MONTH_BY_KEY.get(month)?.value ?? 1) - 1 : 0, 1)
}

export function getCanueV2TimelineKey(selection: CanueVariableSelection, monthly: boolean): string {
  if (!monthly) return String(selection.year)
  const month = getCanueV2MonthKey(selection.variable)
  const monthIndex = month ? (CANUE_MONTH_BY_KEY.get(month)?.value ?? 1) - 1 : 0
  return `${selection.year}-${String(monthIndex).padStart(2, '0')}`
}

export function getCanueV2Cadence(selection: CanueVariableSelection): CanueV2Cadence {
  return getCanueV2MonthKey(selection.variable) ? 'monthly' : 'annual'
}

export function getCanueV2MeasureVariable(variable: string): string {
  return variable.replace(CANUE_MONTH_PATTERN, '').replace(CANUE_ANNUAL_YEAR_PATTERN, '$1$3')
}

export function getCanueV2MeasureKey(selection: Pick<CanueVariableSelection, 'dataset' | 'variable'>): string {
  return `${selection.dataset}__${getCanueV2MeasureVariable(selection.variable)}`
}

export function getPreferredCanueV2MeasureKey(options: Array<{ value: string }>): string | null {
  return (
    CANUE_V2_PREFERRED_MEASURE_KEYS.find((key) => options.some((option) => option.value === key)) ??
    options.find((option) => option.value.includes('pm25'))?.value ??
    options[0]?.value ??
    null
  )
}

export function getPreferredCanueV2Selection(selections: CanueVariableSelection[]): CanueVariableSelection | null {
  const preferredKey = getPreferredCanueV2MeasureKey(
    selections.map((selection) => ({ value: getCanueV2MeasureKey(selection) })),
  )
  return preferredKey
    ? (selections.find((selection) => getCanueV2MeasureKey(selection) === preferredKey) ?? null)
    : (selections[0] ?? null)
}

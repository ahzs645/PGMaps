import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { CANUE_V2_CATALOG_URL, type CanueVariableSelection } from '../canueV2'
import { CANUE_MONTH_BY_KEY, CANUE_SUFFIX_LABELS_BY_DATASET, CANUE_V2_DATASET_LABELS } from './constants'
import {
  getCanueDatasetSuffixLabel,
  getCanueV2MeasureVariable,
  getCanueV2MonthKey,
  getCanueVariableSuffix,
} from './variables'
import type { CanueV2MetadataLookup } from './types'

export function getCanueV2VariableLabel(selection: CanueVariableSelection | null): string {
  if (!selection) return 'CANUE grid'
  const variable = getCanueV2MeasureVariable(selection.variable)
  const suffix = getCanueVariableSuffix(variable)
  const datasetLabels = CANUE_SUFFIX_LABELS_BY_DATASET[selection.dataset]
  if (suffix && datasetLabels?.[suffix]) return datasetLabels[suffix]
  const datasetSuffixLabel = getCanueDatasetSuffixLabel(selection.dataset)
  if (datasetSuffixLabel) return datasetSuffixLabel
  if (variable === 'pm25') return 'PM2.5'
  if (variable === 'aqsmk_01') return 'Smoke PM2.5'
  if (variable === 'aqsmk_02') return 'Smoke PM2.5 median'
  if (variable === 'aqsmk_03') return 'Smoke PM2.5 minimum'
  if (variable === 'aqsmk_04') return 'Smoke PM2.5 maximum'
  if (variable === 'aqsmk_05') return 'Smoke PM2.5 standard deviation'
  if (variable === 'no2_lur') return 'NO2 land-use regression'
  if (variable === 'o3_8h') return 'O3 8-hour'
  if (variable === 'o3_mn') return 'O3 mean'
  if (variable.startsWith('pm25dal') && suffix === '01') return 'Annual mean PM2.5'
  if (variable.startsWith('aqfpm_avf') && suffix === '01') return 'Annual mean PM2.5'
  if (variable.startsWith('so2omi') && suffix === '01') return 'SO2 OMI'
  return variable.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function resolveCanueV2AssetUrl(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    return new URL(path, CANUE_V2_CATALOG_URL).href
  } catch {
    return null
  }
}

export function cleanCanueV2DatasetName(name: string): string {
  return name
    .replace(/\s+v\d+\)/gi, ')')
    .replace(/\s+v\d+\b/gi, '')
    .replace(/\bPM2\.5\b/g, 'PM2.5')
    .replace(/\s+/g, ' ')
    .trim()
}

export function humanizeCanueDatasetCode(dataset: string): string {
  return dataset.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function firstMetadataValue(values: string[] | undefined): string | null {
  return values?.find((value) => value.trim())?.trim() ?? null
}

export function getCanueV2DatasetLabel(
  dataset: string,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  if (CANUE_V2_DATASET_LABELS[dataset]) return CANUE_V2_DATASET_LABELS[dataset]
  const metadata = metadataLookup?.datasets?.[dataset]
  const label =
    firstMetadataValue(metadata?.metadata?.portalNames) ??
    firstMetadataValue(metadata?.metadata?.downloadNames) ??
    metadata?.label ??
    humanizeCanueDatasetCode(dataset)
  return cleanCanueV2DatasetName(label)
}

export function getCanueV2DatasetTitle(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  const metadata = metadataLookup?.datasets?.[selection.dataset]?.metadata
  const parts = [
    `CANUE code: ${selection.dataset}`,
    firstMetadataValue(metadata?.shortCodes) ? `Source code: ${firstMetadataValue(metadata?.shortCodes)}` : null,
    firstMetadataValue(metadata?.samplingFrequency)
      ? `Frequency: ${firstMetadataValue(metadata?.samplingFrequency)}`
      : null,
    firstMetadataValue(metadata?.yearCoverage) ? `Coverage: ${firstMetadataValue(metadata?.yearCoverage)}` : null,
    `Grid property: ${selection.property}`,
  ]
  return parts.filter(Boolean).join(' | ')
}

export function getCanueV2DatasetHelp(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  const metadata = metadataLookup?.datasets?.[selection.dataset]?.metadata
  const description = firstMetadataValue(metadata?.descriptions)
  if (selection.dataset.startsWith('pm25dal') || selection.dataset === 'aqfpm_avf') {
    return 'PM2.5 DAL is the van Donkelaar/Dalhousie satellite-derived PM2.5 product indexed by CANUE. It combines satellite aerosol optical depth, GEOS-Chem chemical transport modelling, and ground-monitor calibration. The v2-v5 choices are successive product releases with different source years and method updates.'
  }
  if (selection.dataset === 'aqfpm_01') {
    return 'Monthly PM2.5 estimates from the same satellite/model/ground-monitor family, provided as month-specific values instead of annual averages.'
  }
  if (selection.dataset === 'no2lur_a' || selection.dataset === 'aqno2_ra') {
    return 'NO2 land-use regression estimates nitrogen dioxide using monitoring data plus land-use, traffic, satellite, industrial land-use, and weather predictors.'
  }
  if (selection.dataset === 'aqaix_ava') {
    return 'Air quality health index variables include three combined pollution principal-component indices plus individual pollutants such as CO, HCHO, NH3, NO2, O3, PM2.5, and SO2.'
  }
  if (selection.dataset.startsWith('wtutv')) {
    return 'Ultraviolet variables are long-term monthly UV/Vitamin-D exposure estimates. The metric number chooses dose/index, sea-level/altitude adjustment, and mean versus 95th percentile.'
  }
  if (selection.dataset === 'wbnrc_a' || selection.dataset.startsWith('wtwbm')) {
    return 'Water-balance variables describe precipitation, rainfall, snowfall, snowpack, evapotranspiration, soil moisture, surplus, deficit, and wetness/dryness.'
  }
  if (
    selection.dataset.startsWith('grlan') ||
    selection.dataset.startsWith('grmod') ||
    selection.dataset === 'gravh_amn' ||
    selection.dataset === 'grtcc_ava'
  ) {
    return 'Greenness variables differ by vegetation source, season, summary statistic, and buffer distance around the postal/grid location.'
  }
  return description ? description.replace(/\s+/g, ' ').trim() : getCanueV2DatasetTitle(selection, metadataLookup)
}

export function getCanueV2GraphVariableLabel(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  const datasetLabel = getCanueV2DatasetLabel(selection.dataset, metadataLookup)
  const variableLabel = getCanueV2VariableLabel(selection)
  const baseLabel = normalizedCanueLabelToken(datasetLabel).includes(normalizedCanueLabelToken(variableLabel))
    ? datasetLabel
    : `${datasetLabel} - ${variableLabel}`
  const monthKey = getCanueV2MonthKey(selection.variable)
  const monthLabel = monthKey ? (CANUE_MONTH_BY_KEY.get(monthKey)?.label ?? monthKey.toUpperCase()) : null
  return monthLabel ? `${baseLabel} - ${monthLabel}` : baseLabel
}

export function normalizedCanueLabelToken(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function formatCanueDisplayLabel(label: string): string {
  return label
}

export function renderCanueDisplayLabel(label: string): ReactNode {
  return label.split(/\b(PM2\.5|NO2|SO2|CO2|O3|NH3|m3|cm2)\b/gi).map((part, index) => {
    const normalized = part.toLowerCase()
    if (normalized === 'pm2.5')
      return (
        <span key={index}>
          PM<sub>2.5</sub>
        </span>
      )
    if (normalized === 'no2')
      return (
        <span key={index}>
          NO<sub>2</sub>
        </span>
      )
    if (normalized === 'so2')
      return (
        <span key={index}>
          SO<sub>2</sub>
        </span>
      )
    if (normalized === 'co2')
      return (
        <span key={index}>
          CO<sub>2</sub>
        </span>
      )
    if (normalized === 'o3')
      return (
        <span key={index}>
          O<sub>3</sub>
        </span>
      )
    if (normalized === 'nh3')
      return (
        <span key={index}>
          NH<sub>3</sub>
        </span>
      )
    if (normalized === 'm3')
      return (
        <span key={index}>
          m<sup>3</sup>
        </span>
      )
    if (normalized === 'cm2')
      return (
        <span key={index}>
          cm<sup>2</sup>
        </span>
      )
    return part
  })
}

export function CanueHelpIcon({ label, help }: { label: string; help: string | null | undefined }) {
  if (!help) return null
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      title={help}
      aria-label={`${label} help: ${help}`}
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  )
}

export function stripCanueV2DatasetVersion(label: string): string {
  return label
    .replace(/\s+\(?v\d+\)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getCanueV2GridVariableLabel(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  return stripCanueV2DatasetVersion(getCanueV2DatasetLabel(selection.dataset, metadataLookup))
    .replace(/^(annual|monthly|daily|yearly)\s+/i, '')
    .trim()
}

export function getCanueV2GridVariableKey(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  return normalizedCanueLabelToken(getCanueV2GridVariableLabel(selection, metadataLookup))
}

export function getCanueV2VariableOptionLabel(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  const datasetLabel = getCanueV2DatasetLabel(selection.dataset, metadataLookup)
  const gridVariableLabel = getCanueV2GridVariableLabel(selection, metadataLookup)
  const datasetVersion = datasetLabel.match(/\bv\d+\b/i)?.[0] ?? null
  const topicLabel = gridVariableLabel
    .replace(/\b(annual|monthly|daily|yearly)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const escapedTopic = topicLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const variableLabel = getCanueV2VariableLabel(selection)
  const measureLabel = escapedTopic
    ? variableLabel.replace(new RegExp(`^${escapedTopic}\\s*`, 'i'), '').trim()
    : variableLabel
  const inferredMeanLabel =
    !measureLabel && getCanueVariableSuffix(getCanueV2MeasureVariable(selection.variable)) === '01' ? 'mean' : null
  const normalizedMeasure =
    inferredMeanLabel ??
    (measureLabel && normalizedCanueLabelToken(measureLabel) !== normalizedCanueLabelToken(gridVariableLabel)
      ? measureLabel
      : null)

  return [datasetVersion, normalizedMeasure ?? variableLabel].filter(Boolean).join(' - ')
}

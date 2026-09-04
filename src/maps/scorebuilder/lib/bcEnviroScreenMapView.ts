import { BC_ENVIRO_SCREEN_METRICS, type BcEnviroScreenComponent } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricDefinition } from '../types'

export const BC_ENVIRO_SCREEN_DEFAULT_MAP_VARIABLE = 'overallScore'
export const BC_ENVIRO_SCREEN_DEFAULT_COLOR_BINS = 4
export const BC_ENVIRO_SCREEN_MIN_COLOR_BINS = 2
export const BC_ENVIRO_SCREEN_MAX_COLOR_BINS = 10
export const BC_ENVIRO_SCREEN_MISSING_COLOR = '#94a3b8'

const PALETTE_STOPS = ['#008837', '#a6dba0', '#f7f7f7', '#c2a5cf', '#7b3294'] as const

export type BcEnviroScreenMapVariable =
  | 'overallScore'
  | 'landscapeBurdenScore'
  | 'populationCharacteristicsScore'
  | `component:${BcEnviroScreenComponent}`
  | `indicator:${string}`

export interface BcEnviroScreenMapOption {
  value: BcEnviroScreenMapVariable
  label: string
}

export interface BcEnviroScreenMapOptionGroup {
  label: string
  options: BcEnviroScreenMapOption[]
}

export interface BcEnviroScreenMapBand {
  color: string
  label: string
  lower: number
  upper: number
}

export interface BcEnviroScreenMapView {
  variable: BcEnviroScreenMapVariable
  label: string
  binCount: number
  bands: BcEnviroScreenMapBand[]
  legendLabels: string[]
  regionFillColors: Record<string, string>
  min: number
  max: number
  average: number
  valueCount: number
  missingCount: number
}

export interface BcEnviroScreenMapViewCache {
  get: (variable: BcEnviroScreenMapVariable, requestedBinCount: number) => BcEnviroScreenMapView
  readonly size: number
}

const MAX_DENSE_LEGEND_LABELS = 4

/**
 * Keep every colour band while thinning only the printed labels when the
 * historical 2–10 bin control produces a dense legend.
 */
export function getBcEnviroScreenLegendLabels(bands: readonly BcEnviroScreenMapBand[]): string[] {
  if (bands.length <= 5) return bands.map((band) => band.label)

  const visibleIndexes = new Set(
    Array.from({ length: MAX_DENSE_LEGEND_LABELS }, (_, index) =>
      Math.round((index * (bands.length - 1)) / (MAX_DENSE_LEGEND_LABELS - 1)),
    ),
  )
  return bands.map((band, index) => (visibleIndexes.has(index) ? band.label : ''))
}

const COMPONENT_OPTIONS: Array<{ key: BcEnviroScreenComponent; label: string }> = [
  { key: 'exposures', label: 'Exposures' },
  { key: 'environmentalEffects', label: 'Environmental Effects' },
  { key: 'sensitivePopulations', label: 'Sensitive Populations' },
  { key: 'socioeconomicFactors', label: 'Socioeconomic Factors' },
]

const COMPONENT_GROUP_LABELS: Record<BcEnviroScreenComponent, string> = {
  exposures: 'Exposures Indicators',
  environmentalEffects: 'Environmental Effects Indicators',
  sensitivePopulations: 'Sensitive Populations Indicators',
  socioeconomicFactors: 'Socioeconomic Factors Indicators',
}

const SHINY_LABELS: Record<string, string> = {
  future_precipitation: 'Future precipitation',
  future_temperature: 'Future temperature',
  water_quality_exceedances: 'Water quality exceedances',
  hypertension: 'Hypertension',
  employment_insurance_beneficiaries: 'Employment Insurance beneficiaries',
  housing_burdened_renters: 'Housing burdened renters',
}

function indicatorId(metric: ScoreMetricDefinition): string {
  return metric.key.slice(metric.key.indexOf('.') + 1)
}

function indicatorLabel(metric: ScoreMetricDefinition): string {
  return SHINY_LABELS[indicatorId(metric)] ?? metric.label
}

export const BC_ENVIRO_SCREEN_MAP_OPTION_GROUPS: BcEnviroScreenMapOptionGroup[] = [
  {
    label: 'Meta-Level Scores',
    options: [
      { value: 'overallScore', label: 'Overall Score' },
      { value: 'landscapeBurdenScore', label: 'Landscape Burden Score' },
      { value: 'populationCharacteristicsScore', label: 'Population Characteristics Score' },
    ],
  },
  {
    label: 'Component Scores',
    options: COMPONENT_OPTIONS.map(({ key, label }) => ({ value: `component:${key}`, label })),
  },
  ...COMPONENT_OPTIONS.map(({ key }) => ({
    label: COMPONENT_GROUP_LABELS[key],
    options: BC_ENVIRO_SCREEN_METRICS.filter((metric) => metric.bcEnviroScreenComponent === key).map((metric) => ({
      value: `indicator:${indicatorId(metric)}` as BcEnviroScreenMapVariable,
      label: indicatorLabel(metric),
    })),
  })),
]

const OPTION_BY_VALUE = new Map(
  BC_ENVIRO_SCREEN_MAP_OPTION_GROUPS.flatMap((group) => group.options).map((option) => [option.value, option]),
)

function metricForVariable(variable: BcEnviroScreenMapVariable): ScoreMetricDefinition | undefined {
  if (!variable.startsWith('indicator:')) return undefined
  const id = variable.slice('indicator:'.length)
  return BC_ENVIRO_SCREEN_METRICS.find((metric) => indicatorId(metric) === id)
}

export function getBcEnviroScreenMapValue(
  region: ScoredBoundaryRegion,
  variable: BcEnviroScreenMapVariable,
): number | null {
  const profile = region.bcEnviroScreen
  if (!profile) return null
  if (variable === 'overallScore') return Number.isFinite(region.score) ? region.score : null
  if (variable === 'landscapeBurdenScore') return profile.landscapeBurdenScore
  if (variable === 'populationCharacteristicsScore') return profile.populationCharacteristicsScore
  if (variable.startsWith('component:')) {
    return profile.components[variable.slice('component:'.length) as BcEnviroScreenComponent]
  }
  const metric = metricForVariable(variable)
  if (!metric || profile.missingIndicators.includes(metric.key)) return null
  const value = region.metrics[metric.key]
  return Number.isFinite(value) ? value : null
}

function clampBinCount(value: number): number {
  if (!Number.isFinite(value)) return BC_ENVIRO_SCREEN_DEFAULT_COLOR_BINS
  return Math.min(BC_ENVIRO_SCREEN_MAX_COLOR_BINS, Math.max(BC_ENVIRO_SCREEN_MIN_COLOR_BINS, Math.round(value)))
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function colorAt(position: number): string {
  const bounded = Math.min(1, Math.max(0, position))
  const scaled = bounded * (PALETTE_STOPS.length - 1)
  const lowerIndex = Math.floor(scaled)
  const upperIndex = Math.min(PALETTE_STOPS.length - 1, lowerIndex + 1)
  const mix = scaled - lowerIndex
  const lower = hexToRgb(PALETTE_STOPS[lowerIndex])
  const upper = hexToRgb(PALETTE_STOPS[upperIndex])
  return rgbToHex([
    lower[0] + (upper[0] - lower[0]) * mix,
    lower[1] + (upper[1] - lower[1]) * mix,
    lower[2] + (upper[2] - lower[2]) * mix,
  ])
}

function valueDecimals(min: number, max: number): number {
  const span = Math.abs(max - min)
  if (span >= 100) return 0
  if (span >= 10) return 1
  if (span >= 1) return 2
  return 3
}

function formatBandValue(value: number, decimals: number): string {
  return new Intl.NumberFormat('en-CA', { maximumFractionDigits: decimals }).format(value)
}

export function buildBcEnviroScreenMapView(
  regions: ScoredBoundaryRegion[],
  variable: BcEnviroScreenMapVariable,
  requestedBinCount: number,
): BcEnviroScreenMapView {
  const binCount = clampBinCount(requestedBinCount)
  const valuesByRegion = regions.map((region) => ({
    id: region.region.id,
    value: getBcEnviroScreenMapValue(region, variable),
  }))
  const finiteValues = valuesByRegion
    .map((entry) => entry.value)
    .filter((value): value is number => value != null && Number.isFinite(value))
  const min = finiteValues.length ? Math.min(...finiteValues) : 0
  const max = finiteValues.length ? Math.max(...finiteValues) : 0
  const average = finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : 0
  const span = max - min
  const decimals = valueDecimals(min, max)
  const boundaries = Array.from({ length: binCount + 1 }, (_, index) =>
    span === 0 ? min : min + (span * index) / binCount,
  )
  const bands = Array.from({ length: binCount }, (_, index) => ({
    color: colorAt(binCount === 1 ? 0.5 : index / (binCount - 1)),
    label: `${formatBandValue(boundaries[index], decimals)}–${formatBandValue(boundaries[index + 1], decimals)}`,
    lower: boundaries[index],
    upper: boundaries[index + 1],
  }))
  const regionFillColors = Object.fromEntries(
    valuesByRegion.map(({ id, value }) => {
      if (value == null || !Number.isFinite(value)) return [id, BC_ENVIRO_SCREEN_MISSING_COLOR]
      const bandIndex = span === 0 ? 0 : Math.min(binCount - 1, Math.floor(((value - min) / span) * binCount))
      return [id, bands[bandIndex].color]
    }),
  )
  return {
    variable,
    label: OPTION_BY_VALUE.get(variable)?.label ?? variable,
    binCount,
    bands,
    legendLabels: getBcEnviroScreenLegendLabels(bands),
    regionFillColors,
    min,
    max,
    average,
    valueCount: finiteValues.length,
    missingCount: regions.length - finiteValues.length,
  }
}

/**
 * Cache recent map-variable/bin combinations for one immutable set of scored
 * regions. The caller replaces this cache when those regions are no longer
 * current; the LRU bound prevents old display choices from accumulating.
 */
export function createBcEnviroScreenMapViewCache(
  regions: ScoredBoundaryRegion[],
  maxEntries = 18,
): BcEnviroScreenMapViewCache {
  const entries = new Map<string, BcEnviroScreenMapView>()
  const entryLimit = Math.max(1, Math.floor(maxEntries))

  return {
    get(variable, requestedBinCount) {
      const binCount = clampBinCount(requestedBinCount)
      const key = `${variable}\u0000${binCount}`
      const cached = entries.get(key)
      if (cached) {
        entries.delete(key)
        entries.set(key, cached)
        return cached
      }

      const view = buildBcEnviroScreenMapView(regions, variable, binCount)
      entries.set(key, view)
      if (entries.size > entryLimit) {
        const leastRecentlyUsedKey = entries.keys().next().value
        if (leastRecentlyUsedKey !== undefined) entries.delete(leastRecentlyUsedKey)
      }
      return view
    },
    get size() {
      return entries.size
    },
  }
}

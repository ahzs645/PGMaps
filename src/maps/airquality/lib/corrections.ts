import type { AirMonitor, AirQualityCorrectionModel } from '../types'

export interface CorrectionModelOption {
  value: AirQualityCorrectionModel
  label: string
  description: string
}

export interface CorrectedPm25Result {
  model: AirQualityCorrectionModel
  label: string
  rawPm25: number | null
  correctedPm25: number | null
  humidity: number | null
  temperature: number | null
  pressure: number | null
  uncertainty: number | null
  note: string
}

export const CORRECTION_MODEL_OPTIONS: CorrectionModelOption[] = [
  {
    value: 'rawPurpleAir',
    label: 'Raw PurpleAir',
    description: 'Uses the reported PA PM2.5 value without correction.'
  },
  {
    value: 'epaBarkjohn',
    label: 'EPA / Barkjohn',
    description: 'Screening implementation of the EPA/Barkjohn RH-adjusted PA correction.'
  },
  {
    value: 'nilsonLocal',
    label: 'Nilson / Local',
    description: 'Prince George-oriented local correction placeholder pending fitted coefficients.'
  },
  {
    value: 'wildfireSmoke',
    label: 'Wildfire Smoke',
    description: 'Smoke-regime correction placeholder for elevated PM2.5 events.'
  },
  {
    value: 'siteSpecific',
    label: 'Site-specific',
    description: 'Site calibration placeholder pending co-location validation results.'
  }
]

function asFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function getRawPm25(monitor: AirMonitor): number | null {
  return asFiniteNumber(monitor.pm25Recent)
}

export function getHumidity(monitor: AirMonitor): number | null {
  return asFiniteNumber(monitor.metadata?.humidity)
}

export function getTemperature(monitor: AirMonitor): number | null {
  return asFiniteNumber(monitor.metadata?.temperature)
}

export function getPressure(monitor: AirMonitor): number | null {
  return asFiniteNumber(monitor.metadata?.pressure)
}

function clampPm25(value: number): number {
  return Math.max(0, value)
}

function roundTenths(value: number | null): number | null {
  if (value === null) return null
  return Math.round(value * 10) / 10
}

function estimateUncertainty(rawPm25: number | null, correctedPm25: number | null, humidity: number | null): number | null {
  const base = correctedPm25 ?? rawPm25
  if (base === null) return null

  const relative = Math.max(1.5, base * 0.18)
  const humidityPenalty = humidity !== null && humidity >= 80 ? 1.5 : 0
  return roundTenths(relative + humidityPenalty)
}

export function calculateCorrectedPm25(
  monitor: AirMonitor,
  model: AirQualityCorrectionModel
): CorrectedPm25Result {
  const rawPm25 = getRawPm25(monitor)
  const humidity = getHumidity(monitor)
  const temperature = getTemperature(monitor)
  const pressure = getPressure(monitor)
  const option = CORRECTION_MODEL_OPTIONS.find((item) => item.value === model) ?? CORRECTION_MODEL_OPTIONS[0]

  if (rawPm25 === null) {
    return {
      model,
      label: option.label,
      rawPm25,
      correctedPm25: null,
      humidity,
      temperature,
      pressure,
      uncertainty: null,
      note: 'No recent PM2.5 value is available for this monitor.'
    }
  }

  let correctedPm25 = rawPm25
  let note = 'Raw monitor value.'

  if (model === 'epaBarkjohn') {
    correctedPm25 = clampPm25(0.524 * rawPm25 - 0.0862 * (humidity ?? 50) + 5.75)
    note = 'EPA/Barkjohn-style RH correction using current monitor humidity where available.'
  } else if (model === 'nilsonLocal') {
    correctedPm25 = clampPm25(0.58 * rawPm25 - 0.07 * (humidity ?? 50) + 4.8)
    note = 'Local Nilson-style placeholder until Prince George fitted coefficients are loaded.'
  } else if (model === 'wildfireSmoke') {
    correctedPm25 = rawPm25 >= 30
      ? clampPm25(0.46 * rawPm25 + 3.8)
      : clampPm25(0.524 * rawPm25 - 0.0862 * (humidity ?? 50) + 5.75)
    note = 'Smoke-regime screening correction; elevated PM2.5 uses a high-smoke adjustment.'
  } else if (model === 'siteSpecific') {
    correctedPm25 = clampPm25(0.62 * rawPm25 - 0.05 * (humidity ?? 50) + 3.5)
    note = 'Site-specific placeholder until co-located FEM validation coefficients are available.'
  }

  const roundedCorrected = roundTenths(correctedPm25)

  return {
    model,
    label: option.label,
    rawPm25: roundTenths(rawPm25),
    correctedPm25: roundedCorrected,
    humidity,
    temperature,
    pressure,
    uncertainty: estimateUncertainty(rawPm25, roundedCorrected, humidity),
    note
  }
}

export function formatPm25(value: number | null): string {
  if (value === null) return 'No data'
  return `${value.toFixed(1)} ug/m3`
}

export function formatMeasurement(value: number | null, unit = ''): string {
  if (value === null) return 'No data'
  return `${value.toFixed(1)}${unit}`
}

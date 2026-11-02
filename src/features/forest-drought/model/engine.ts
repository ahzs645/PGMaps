// SPDX-License-Identifier: Apache-2.0
// Copyright 2019 Province of British Columbia.
// TypeScript adaptation of asmrCalc.R at e02ddcbf8203e65bada1a36655887e1d0c8fe2f5.
// The recurrence intentionally retains upstream snow/runoff/storage behavior.

import {
  classifyAsmr,
  DAY_LENGTH,
  DEFAULT_SOILS,
  MAX_SCENARIOS,
  MAX_SOIL_DAY_EVALUATIONS,
  MODEL_INFO,
} from './constants'
import { applyMonthlyAnomalies, validateClimate, validateSoils } from './inputs'
import type {
  ClimateDay,
  DailyResult,
  Latitude,
  MonthlySummary,
  ScenarioResult,
  SimulationInput,
  SimulationResult,
  Soil,
  SoilSummary,
  SummaryPolicy,
} from './types'

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function summarize(days: readonly DailyResult[], soils: readonly Soil[], policy: SummaryPolicy): SoilSummary[] {
  const totalPet = days.reduce((total, day) => total + day.pet, 0)
  return soils.map((soil, index) => {
    const totalAet = days.reduce((total, day) => total + day.soils[index].aet, 0)
    let meanRatio: number
    if (policy === 'equal-month') {
      const months = new Map<number, { count: number; sum: number }>()
      for (const day of days) {
        const group = months.get(day.month) ?? { count: 0, sum: 0 }
        group.count++
        group.sum += day.soils[index].ratio
        months.set(day.month, group)
      }
      meanRatio = sum([...months.values()].map((group) => group.sum / group.count)) / months.size
    } else {
      meanRatio = days.reduce((total, day) => total + day.soils[index].ratio, 0) / days.length
    }
    return {
      soilId: soil.id,
      soilLabel: soil.label,
      meanRatio,
      ratioOfTotals: totalPet > 0 ? totalAet / totalPet : null,
      totalPet,
      totalAet,
      asmrClass: classifyAsmr(meanRatio),
    }
  })
}

/** Pure daily recurrence. Called only after public input validation. */
function calculate(
  climate: readonly ClimateDay[],
  latitude: Latitude,
  soils: readonly Soil[],
  progress: (fraction: number) => void,
): { daily: DailyResult[]; initialSnowpack: number } {
  const daylight = DAY_LENGTH[latitude]
  const prepared = climate.map((day) => {
    const tav = (day.tmn + day.tmx) / 2
    const snow = tav <= 0 ? day.ppt : 0
    const esat = 0.61078 * Math.exp((17.269 * day.tmx) / (237 + day.tmx))
    const edew = 0.61078 * Math.exp((17.269 * day.tmn) / (237 + day.tmn))
    const vdd = esat - edew
    const delta = Math.abs(day.tmx - day.tmn)
    const radiation =
      (1 - 0.15) *
        (0.7 * (1 - Math.exp(-1 * (0.036 * Math.exp(-0.154 * delta)) * delta ** 2.4)) * daylight[day.month - 1]) +
      0.465 * (vdd / (273.15 + tav)) +
      0.96 * (0.0000000567 * (273.15 + tav) ** 4) -
      0.0000000567 * (273.15 - 38) ** 4
    const harPet = Math.max(0, 0.0135 * (tav + 17.78) * (radiation / 11.576) * (238.8 / (595.5 - 0.55 * tav)))
    return { ...day, tav, radiation, pet: day.tmx <= 0 ? 0 : harPet, snow }
  })
  // Complete-year validation ensures these are Nov 15–Dec 31 of the final input year.
  const initialSnowpack = prepared.slice(-47).reduce((total, day) => total + day.snow, 0)
  const daily: DailyResult[] = []
  for (let j = 0; j < prepared.length; j++) {
    const day = prepared[j]
    const previous = j > 0 ? daily[j - 1] : undefined
    const snowStart = previous?.snowpack ?? initialSnowpack
    const melt = day.tav < 0 ? 0 : (0.026 * day.radiation + 0.2 * day.tav) / 10
    const snowpack = Math.max(0, Math.max(0, day.snow + snowStart - day.pet) - melt)
    let potentialWaterBalance = day.snow > 0 ? day.snow - day.pet : day.ppt + snowpack - day.pet
    if (!previous) potentialWaterBalance = day.ppt === 0 ? snowpack - day.pet : day.ppt - day.pet
    const changes = soils.map((_soil, k) => {
      if (!previous) return potentialWaterBalance
      const priorStorage = previous.soils[k].storage
      return potentialWaterBalance > 0
        ? potentialWaterBalance
        : priorStorage <= 0
          ? 0
          : priorStorage < Math.abs(potentialWaterBalance)
            ? -priorStorage
            : potentialWaterBalance
    })
    const runoff = [0, 0, 0, 0, 0]
    if (previous) {
      const direct = (k: number) => (previous.soils[k].storage > soils[k].awsc ? soils[k].infiltrationRate : 0)
      runoff[0] = direct(0)
      runoff[1] = direct(1)
      const lateral = (k: number, upstreamRunoff: number) => {
        const rate = soils[k].infiltrationRate
        if (rate >= 0) return direct(k)
        if (upstreamRunoff > 0) return rate
        if (previous.ppt === 0) return 0
        return previous.ppt > rate ? rate : previous.ppt
      }
      runoff[2] = lateral(2, runoff[0] + runoff[1])
      runoff[3] = direct(3)
      runoff[4] = lateral(4, sum(runoff.slice(0, 4)))
    }
    const balances = soils.map((soil, k) => {
      const aet = snowpack > 0 ? day.pet : day.ppt > day.pet ? day.pet : day.ppt + Math.abs(changes[k])
      const priorStorage = previous?.soils[k].storage ?? 0
      // Upstream clamps BEFORE runoff. Do not clamp again after drainage/recharge.
      const storage = previous
        ? Math.min(soil.afc, Math.max(0, priorStorage < 0 ? 0 : priorStorage + changes[k])) - runoff[k]
        : soil.afc
      const ratio = day.pet <= 0 ? 1 : aet / day.pet
      if (![storage, changes[k], runoff[k], aet, ratio, day.pet, snowpack].every(Number.isFinite)) {
        throw new Error(
          `${day.date}: model produced a non-finite value for soil ${soil.id}; review climate and soil inputs.`,
        )
      }
      return { soilId: soil.id, storage, change: changes[k], runoff: runoff[k], aet, ratio }
    })
    daily.push({ ...day, snowpack, potentialWaterBalance, soils: balances })
    if (j % 128 === 0 || j === prepared.length - 1) progress((j + 1) / prepared.length)
  }
  return { daily, initialSnowpack }
}

function summarizeScenario(
  id: string,
  label: string,
  calculated: ReturnType<typeof calculate>,
  soils: readonly Soil[],
  policy: SummaryPolicy,
): ScenarioResult {
  const { daily, initialSnowpack } = calculated
  const monthly: MonthlySummary[] = Array.from({ length: 12 }, (_, monthIndex) => {
    const days = daily.filter((day) => day.month === monthIndex + 1)
    return { month: monthIndex + 1, dayCount: days.length, soils: summarize(days, soils, 'day-weighted') }
  })
  const years = [...new Set(daily.map((day) => day.year))]
  const annual = years.map((year) => {
    const days = daily.filter((day) => day.year === year)
    return { year, dayCount: days.length, soils: summarize(days, soils, policy) }
  })
  return { id, label, initialSnowpack, daily, monthly, annual, summary: summarize(daily, soils, policy) }
}

/** Runs entirely in memory with no DOM, network, clock, random sampling or file access. */
export function runSimulation(
  input: SimulationInput,
  onProgress: (fraction: number) => void = () => {},
): SimulationResult {
  validateClimate(input.climate)
  if (input.latitude !== 50 && input.latitude !== 55 && input.latitude !== 60)
    throw new Error('Latitude must be exactly 50, 55 or 60 degrees; interpolation is not part of this model.')
  const soils = (input.soils ?? DEFAULT_SOILS).map((soil) => ({ ...soil }))
  validateSoils(soils)
  const summaryPolicy = input.summaryPolicy ?? 'day-weighted'
  if (summaryPolicy !== 'day-weighted' && summaryPolicy !== 'equal-month')
    throw new Error('Choose day-weighted or equal-month annual summaries.')
  if (input.scenarios !== undefined && !Array.isArray(input.scenarios))
    throw new Error('Scenarios must be an array of scenario objects.')
  const scenarios = input.scenarios ?? []
  if (scenarios.length > MAX_SCENARIOS) throw new Error(`At most ${MAX_SCENARIOS} custom scenarios can run together.`)
  const seen = new Set(['current'])
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario))
      throw new Error('Each scenario must be an object with a string ID, label and monthly anomalies.')
    if (
      typeof scenario.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(scenario.id) ||
      seen.has(scenario.id)
    )
      throw new Error(
        'Scenario IDs must be unique, 1–80 letters/numbers/dots/underscores/hyphens; current is reserved.',
      )
    if (typeof scenario.label !== 'string' || !scenario.label.trim() || scenario.label.length > 200)
      throw new Error('Each scenario needs a label of 1–200 characters.')
    seen.add(scenario.id)
  }
  const evaluations = input.climate.length * 5 * (scenarios.length + 1)
  if (evaluations > MAX_SOIL_DAY_EVALUATIONS)
    throw new Error(
      `Run exceeds the ${MAX_SOIL_DAY_EVALUATIONS.toLocaleString()} soil-day budget; shorten the continuous year range or run fewer scenarios.`,
    )
  // Validate every adjusted scenario before spending time on the baseline.
  const scenarioClimates = scenarios.map((scenario) => applyMonthlyAnomalies(input.climate, scenario))
  const jobs = scenarios.length + 1
  onProgress(0)
  const baseline = summarizeScenario(
    'current',
    'Imported climate',
    calculate(input.climate, input.latitude, soils, (fraction) => onProgress(fraction / jobs)),
    soils,
    summaryPolicy,
  )
  const results = scenarios.map((scenario, index) =>
    summarizeScenario(
      scenario.id,
      scenario.label,
      calculate(scenarioClimates[index], input.latitude, soils, (fraction) =>
        onProgress((index + 1 + fraction) / jobs),
      ),
      soils,
      summaryPolicy,
    ),
  )
  onProgress(1)
  return {
    model: { ...MODEL_INFO },
    latitude: input.latitude,
    years: [...new Set(input.climate.map((day) => day.year))],
    soils,
    summaryPolicy,
    baseline,
    scenarioInputs: scenarios.map((scenario) => ({
      ...scenario,
      monthly: scenario.monthly.map((month) => ({ ...month })),
    })),
    scenarios: results,
    warnings: [
      MODEL_INFO.validation,
      'This is the older forestDroughtTool recurrence, not the model that produced published forDRAT results.',
      'Initial snowpack is snowfall in the final 47 input days. Daily snowpack, runoff and storage behavior follows the upstream code, including storage outside 0–AFC after runoff.',
      `Annual mean daily AET/PET uses ${summaryPolicy === 'day-weighted' ? 'all days with equal weight' : 'the 12 monthly means with equal weight'} for both baseline and custom scenarios. The upstream wrapper uses different weights for current and future runs.`,
      'Days with PET ≤ 0 have a daily ratio of 1. Mean daily AET/PET and total AET ÷ total PET are different summaries.',
      'Custom anomalies are user-defined sensitivity scenarios, not automatically a named ClimateBC projection. ASMR classes are not species risk ratings or planting advice.',
    ],
  }
}

/**
 * Safe analogue of asmrSelect: keep continuous-run state and select output years.
 * This deliberately does not reproduce asmrRun's concatenated random input years.
 */
export function summarizeCalculatedYears(result: SimulationResult, years: readonly number[]) {
  if (
    !years.length ||
    years.some((year) => !Number.isInteger(year) || !result.years.includes(year)) ||
    new Set(years).size !== years.length
  ) {
    throw new Error('Select unique complete years present in the calculated result.')
  }
  const selectedYears = [...years].sort((a, b) => a - b)
  const select = (scenario: ScenarioResult) => {
    const summaries = summarizeScenario(
      scenario.id,
      scenario.label,
      {
        initialSnowpack: scenario.initialSnowpack,
        daily: scenario.daily.filter((day) => selectedYears.includes(day.year)),
      },
      result.soils,
      result.summaryPolicy,
    )
    return {
      id: summaries.id,
      label: summaries.label,
      monthly: summaries.monthly,
      annual: summaries.annual,
      summary: summaries.summary,
    }
  }
  return {
    model: result.model,
    sourceYears: [...result.years],
    selectedYears,
    summaryPolicy: result.summaryPolicy,
    baseline: select(result.baseline),
    scenarios: result.scenarios.map(select),
    warning:
      'Years are selected after the complete continuous climate run. Snow and soil state still reflect the original run, including intervening years. This differs from the legacy asmrRun random-year input concatenation.',
  }
}

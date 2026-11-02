// SPDX-License-Identifier: Apache-2.0
// Browser adaptation of bcgov/forestDroughtTool; see docs/forest-drought-model.md.

export type Latitude = 50 | 55 | 60
export type SummaryPolicy = 'day-weighted' | 'equal-month'

export interface ClimateDay {
  date: string
  year: number
  month: number
  day: number
  tmn: number
  tmx: number
  ppt: number
}

export interface Soil {
  id: number
  label: string
  afc: number
  awsc: number
  infiltrationRate: number
}

export interface MonthlyAnomaly {
  month: number
  tminDelta: number
  tmaxDelta: number
  precipMultiplier: number
}

export interface ScenarioInput {
  id: string
  label: string
  monthly: MonthlyAnomaly[]
}

export interface SimulationInput {
  climate: ClimateDay[]
  latitude: Latitude
  soils?: Soil[]
  scenarios?: ScenarioInput[]
  summaryPolicy?: SummaryPolicy
}

export interface DailySoilResult {
  soilId: number
  storage: number
  change: number
  runoff: number
  aet: number
  ratio: number
}

export interface DailyResult extends ClimateDay {
  tav: number
  radiation: number
  pet: number
  snow: number
  snowpack: number
  potentialWaterBalance: number
  soils: DailySoilResult[]
}

export interface SoilSummary {
  soilId: number
  soilLabel: string
  meanRatio: number
  ratioOfTotals: number | null
  totalPet: number
  totalAet: number
  asmrClass: string | null
}

export interface MonthlySummary {
  month: number
  dayCount: number
  soils: SoilSummary[]
}

export interface YearSummary {
  year: number
  dayCount: number
  soils: SoilSummary[]
}

export interface ScenarioResult {
  id: string
  label: string
  initialSnowpack: number
  daily: DailyResult[]
  monthly: MonthlySummary[]
  annual: YearSummary[]
  summary: SoilSummary[]
}

export interface SimulationResult {
  model: {
    id: string
    name: string
    sourceRepository: string
    sourceCommit: string
    methodVersion: string
    validation: string
  }
  latitude: Latitude
  years: number[]
  soils: Soil[]
  summaryPolicy: SummaryPolicy
  scenarioInputs: ScenarioInput[]
  baseline: ScenarioResult
  scenarios: ScenarioResult[]
  warnings: string[]
}

export type HealthyPlanVariableKind = 'demographic' | 'environment'

export type HealthyPlanBenefitDirection = 'higherIsBetter' | 'lowerIsBetter'

export type HealthyPlanValueFormat = 'count' | 'ratio' | 'percent' | 'temperatureC' | 'ppb' | 'index'

export interface HealthyPlanColourRamp {
  id: string
  stops: readonly string[]
}

export interface HealthyPlanVariableScale {
  variableId: string
  label: string
  kind: HealthyPlanVariableKind
  colourRampId: string
  stops: readonly number[]
  format: HealthyPlanValueFormat
  benefitDirection: HealthyPlanBenefitDirection
}

export interface HealthyPlanRecord {
  id: string
  cityId: string | number
  cityName?: string
  population?: number | null
  demographic: Record<string, number | null | undefined>
  environment: Record<string, number | null | undefined>
  metadata?: Record<string, unknown>
}

export interface HealthyPlanRankedRecord extends HealthyPlanRecord {
  demographicRanks: Record<string, number | null>
  environmentRanks: Record<string, number | null>
}

export interface HealthyPlanEquityResult {
  recordId: string
  cityId: string | number
  demographicVariable: string
  environmentVariable: string
  demographicPercent: number | null
  environmentValue: number | null
  demographicRank: number | null
  environmentRank: number | null
  equityPriority: boolean
  priorityScore: number | null
  priorityColor: string | null
}

export interface HealthyPlanCitySummary {
  cityId: string | number
  demographicVariable: string
  environmentVariable: string
  affectedPopulation: number
  totalDemographicPopulation: number
  affectedShare: number | null
}

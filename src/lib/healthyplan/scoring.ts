import { HEALTHYPLAN_EQUITY_PRIORITY_RAMP, getHealthyPlanVariableScale } from './config'
import type {
  HealthyPlanBenefitDirection,
  HealthyPlanCitySummary,
  HealthyPlanEquityResult,
  HealthyPlanRankedRecord,
  HealthyPlanRecord,
  HealthyPlanVariableScale,
} from './types'

export function benefitAdjustedValue(
  value: number | null | undefined,
  direction: HealthyPlanBenefitDirection,
): number | null {
  if (!isFiniteNumber(value)) return null
  return direction === 'higherIsBetter' ? value : -value
}

export function decileRank(value: number | null | undefined, sortedValues: readonly number[]): number | null {
  if (!isFiniteNumber(value)) return null
  const finiteValues = sortedValues.filter(isFiniteNumber)
  if (!finiteValues.length) return null

  const below = finiteValues.filter((candidate) => candidate < value).length
  const equal = finiteValues.filter((candidate) => candidate === value).length
  const midpointRank = (below + equal / 2) / finiteValues.length
  return Math.max(1, Math.min(10, Math.ceil(midpointRank * 10)))
}

export function rankHealthyPlanRecords(
  records: readonly HealthyPlanRecord[],
  demographicVariables: readonly string[],
  environmentScales: readonly HealthyPlanVariableScale[],
): HealthyPlanRankedRecord[] {
  const recordsByCity = groupBy(records, (record) => String(record.cityId))

  return records.map((record) => {
    const cityRecords = recordsByCity.get(String(record.cityId)) ?? []
    const demographicRanks = Object.fromEntries(
      demographicVariables.map((variableId) => {
        const values = cityRecords
          .map((cityRecord) => cityRecord.demographic[variableId])
          .filter(isFiniteNumber)
          .sort(sortNumber)
        return [variableId, decileRank(record.demographic[variableId], values)]
      }),
    )
    const environmentRanks = Object.fromEntries(
      environmentScales.map((scale) => {
        const values = cityRecords
          .map((cityRecord) => benefitAdjustedValue(cityRecord.environment[scale.variableId], scale.benefitDirection))
          .filter(isFiniteNumber)
          .sort(sortNumber)
        const adjusted = benefitAdjustedValue(record.environment[scale.variableId], scale.benefitDirection)
        return [scale.variableId, decileRank(adjusted, values)]
      }),
    )

    return {
      ...record,
      demographicRanks,
      environmentRanks,
    }
  })
}

export function calculateEquityPriority({
  record,
  demographicVariable,
  environmentVariable,
}: {
  record: HealthyPlanRankedRecord
  demographicVariable: string
  environmentVariable: string
}): HealthyPlanEquityResult {
  const demographicRank = record.demographicRanks[demographicVariable] ?? null
  const environmentRank = record.environmentRanks[environmentVariable] ?? null
  const priorityScore =
    demographicRank !== null && environmentRank !== null && demographicRank > 5 && environmentRank < 6
      ? demographicRank - environmentRank
      : null

  return {
    recordId: record.id,
    cityId: record.cityId,
    demographicVariable,
    environmentVariable,
    demographicPercent: record.demographic[demographicVariable] ?? null,
    environmentValue: record.environment[environmentVariable] ?? null,
    demographicRank,
    environmentRank,
    equityPriority: priorityScore !== null,
    priorityScore,
    priorityColor: getEquityPriorityColor(priorityScore),
  }
}

export function getEquityPriorityColor(priorityScore: number | null | undefined): string | null {
  if (!isFiniteNumber(priorityScore)) return null
  const index = Math.max(1, Math.min(9, Math.round(priorityScore))) - 1
  return HEALTHYPLAN_EQUITY_PRIORITY_RAMP[index] ?? null
}

export function buildHealthyPlanEquityResults(
  records: readonly HealthyPlanRankedRecord[],
  demographicVariable: string,
  environmentVariable: string,
): HealthyPlanEquityResult[] {
  return records.map((record) => calculateEquityPriority({ record, demographicVariable, environmentVariable }))
}

export function summarizeHealthyPlanCity({
  records,
  demographicVariable,
  environmentVariable,
}: {
  records: readonly HealthyPlanRankedRecord[]
  demographicVariable: string
  environmentVariable: string
}): HealthyPlanCitySummary[] {
  const recordsByCity = groupBy(records, (record) => String(record.cityId))

  return Array.from(recordsByCity.values()).map((cityRecords) => {
    const cityId = cityRecords[0]?.cityId ?? ''
    const totals = cityRecords.reduce(
      (summary, record) => {
        const demographicPopulation = estimateDemographicPopulation(record, demographicVariable)
        const environmentRank = record.environmentRanks[environmentVariable]
        summary.totalDemographicPopulation += demographicPopulation
        if (environmentRank !== null && environmentRank < 6) {
          summary.affectedPopulation += demographicPopulation
        }
        return summary
      },
      { affectedPopulation: 0, totalDemographicPopulation: 0 },
    )

    return {
      cityId,
      demographicVariable,
      environmentVariable,
      affectedPopulation: totals.affectedPopulation,
      totalDemographicPopulation: totals.totalDemographicPopulation,
      affectedShare:
        totals.totalDemographicPopulation > 0 ? totals.affectedPopulation / totals.totalDemographicPopulation : null,
    }
  })
}

export function healthyPlanFieldNames(demographicVariable: string, environmentVariable: string) {
  return {
    demographicPercent: `${demographicVariable}_p`,
    environmentValue: `${environmentVariable}_v`,
    demographicRank: `sd_city_${demographicVariable}_r`,
    environmentRank: `nbe_city_${environmentVariable}_r`,
  }
}

export function getEnvironmentScaleOrDefault(variableId: string): HealthyPlanVariableScale {
  return (
    getHealthyPlanVariableScale(variableId) ?? {
      variableId,
      label: variableId,
      kind: 'environment',
      colourRampId: 'default',
      stops: [],
      format: 'count',
      benefitDirection: 'higherIsBetter',
    }
  )
}

function estimateDemographicPopulation(record: HealthyPlanRankedRecord, demographicVariable: string): number {
  const demographicValue = record.demographic[demographicVariable]
  const population = record.population
  if (!isFiniteNumber(demographicValue) || !isFiniteNumber(population)) return 0
  return demographicValue <= 1 ? demographicValue * population : demographicValue
}

function groupBy<T>(items: readonly T[], getKey: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  items.forEach((item) => {
    const key = getKey(item)
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  })
  return grouped
}

function sortNumber(left: number, right: number): number {
  return left - right
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

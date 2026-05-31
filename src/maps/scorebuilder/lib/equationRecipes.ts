import type { MetricRecipe } from './metricRecipes'

export type RankMethod = 'decile'
export type ComparisonOperator = '>' | '>=' | '<' | '<=' | '==='

export interface PairwiseEquityRuleRecipe {
  id: string
  label: string
  vulnerableMetricId: string
  environmentMetricId: string
  rankMethod: RankMethod
  vulnerableThreshold: {
    operator: ComparisonOperator
    rank: number
  }
  environmentThreshold: {
    operator: ComparisonOperator
    rank: number
  }
  scoreExpression: 'vulnerableRankMinusEnvironmentRank'
}

export interface PopulationSummaryRecipe {
  id: string
  label: string
  populationField: string
  condition: PairwiseEquityRuleRecipe
  groupByField?: string
}

export interface ProjectRecipe {
  id: string
  label: string
  description?: string
  metricRecipes: MetricRecipe[]
  pairwiseRules: PairwiseEquityRuleRecipe[]
  summaries: PopulationSummaryRecipe[]
  legendSettings?: Record<string, unknown>
}

export interface PairwiseMetricRow {
  id: string
  label?: string
  group?: string
  population?: number
  vulnerableCount?: number
  vulnerableValue: number
  environmentValue: number
}

export interface PairwiseEquityResult extends PairwiseMetricRow {
  vulnerableRank: number | null
  environmentBenefitRank: number | null
  equityPriority: boolean
  priorityScore: number | null
}

export interface PopulationSummaryResult {
  totalVulnerablePopulation: number
  affectedPopulation: number
  affectedShare: number
  priorityPopulation: number
  priorityShare: number
  groups: Array<{
    group: string
    totalVulnerablePopulation: number
    priorityPopulation: number
    priorityShareOfGroup: number
    shareOfCitywidePriority: number
  }>
}

export const DEFAULT_HEALTHYPLAN_PAIRWISE_RULE: PairwiseEquityRuleRecipe = {
  id: 'healthyplan_pairwise_priority',
  label: 'HealthyPlan pairwise equity priority',
  vulnerableMetricId: '',
  environmentMetricId: '',
  rankMethod: 'decile',
  vulnerableThreshold: { operator: '>', rank: 5 },
  environmentThreshold: { operator: '<', rank: 6 },
  scoreExpression: 'vulnerableRankMinusEnvironmentRank',
}

export function pairwiseRuleFormulaPreview(rule: PairwiseEquityRuleRecipe): string {
  return [
    `priority = ${rule.vulnerableMetricId}_decile ${rule.vulnerableThreshold.operator} ${rule.vulnerableThreshold.rank}`,
    `        and ${rule.environmentMetricId}_benefit_decile ${rule.environmentThreshold.operator} ${rule.environmentThreshold.rank}`,
    'score = vulnerable_decile - environment_benefit_decile',
  ].join('\n')
}

export function decileRank(value: number, sortedValues: readonly number[]): number | null {
  const finiteValues = sortedValues.filter(Number.isFinite)
  if (!Number.isFinite(value) || !finiteValues.length) return null
  const below = finiteValues.filter((candidate) => candidate < value).length
  const equal = finiteValues.filter((candidate) => candidate === value).length
  return Math.max(1, Math.min(10, Math.ceil(((below + equal / 2) / finiteValues.length) * 10)))
}

export function evaluatePairwiseEquityRule(rows: PairwiseMetricRow[]): PairwiseEquityResult[] {
  const vulnerableValues = rows
    .map((row) => row.vulnerableValue)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const environmentValues = rows
    .map((row) => row.environmentValue)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  return rows.map((row) => {
    const vulnerableRank = decileRank(row.vulnerableValue, vulnerableValues)
    const environmentBenefitRank = decileRank(row.environmentValue, environmentValues)
    const equityPriority =
      vulnerableRank !== null &&
      environmentBenefitRank !== null &&
      compareRank(vulnerableRank, '>', 5) &&
      compareRank(environmentBenefitRank, '<', 6)
    return {
      ...row,
      vulnerableRank,
      environmentBenefitRank,
      equityPriority,
      priorityScore: equityPriority && vulnerableRank !== null && environmentBenefitRank !== null
        ? vulnerableRank - environmentBenefitRank
        : null,
    }
  })
}

export function summarizePairwisePopulation(results: PairwiseEquityResult[]): PopulationSummaryResult {
  const totalVulnerablePopulation = results.reduce((sum, row) => sum + rowVulnerableCount(row), 0)
  const affectedPopulation = results
    .filter((row) => row.environmentBenefitRank !== null && row.environmentBenefitRank < 6)
    .reduce((sum, row) => sum + rowVulnerableCount(row), 0)
  const priorityPopulation = results
    .filter((row) => row.equityPriority)
    .reduce((sum, row) => sum + rowVulnerableCount(row), 0)
  const groups = summarizeGroups(results, priorityPopulation)

  return {
    totalVulnerablePopulation,
    affectedPopulation,
    affectedShare: safeShare(affectedPopulation, totalVulnerablePopulation),
    priorityPopulation,
    priorityShare: safeShare(priorityPopulation, totalVulnerablePopulation),
    groups,
  }
}

function compareRank(rank: number, operator: ComparisonOperator, threshold: number): boolean {
  if (operator === '>') return rank > threshold
  if (operator === '>=') return rank >= threshold
  if (operator === '<') return rank < threshold
  if (operator === '<=') return rank <= threshold
  return rank === threshold
}

function rowVulnerableCount(row: PairwiseMetricRow): number {
  if (Number.isFinite(row.vulnerableCount)) return Math.max(0, row.vulnerableCount ?? 0)
  if (Number.isFinite(row.population) && Number.isFinite(row.vulnerableValue)) {
    return Math.max(0, (row.population ?? 0) * row.vulnerableValue)
  }
  return 0
}

function safeShare(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function summarizeGroups(
  results: PairwiseEquityResult[],
  citywidePriorityPopulation: number,
): PopulationSummaryResult['groups'] {
  const groupRows = new Map<string, PairwiseEquityResult[]>()
  for (const row of results) {
    const group = row.group || 'Ungrouped'
    groupRows.set(group, [...(groupRows.get(group) ?? []), row])
  }

  return [...groupRows.entries()]
    .map(([group, rows]) => {
      const totalVulnerablePopulation = rows.reduce((sum, row) => sum + rowVulnerableCount(row), 0)
      const priorityPopulation = rows
        .filter((row) => row.equityPriority)
        .reduce((sum, row) => sum + rowVulnerableCount(row), 0)
      return {
        group,
        totalVulnerablePopulation,
        priorityPopulation,
        priorityShareOfGroup: safeShare(priorityPopulation, totalVulnerablePopulation),
        shareOfCitywidePriority: safeShare(priorityPopulation, citywidePriorityPopulation),
      }
    })
    .sort((left, right) => right.shareOfCitywidePriority - left.shareOfCitywidePriority)
}

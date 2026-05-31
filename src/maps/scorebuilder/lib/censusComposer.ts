import type { CensusHierarchyLevel, CensusCategoryData } from '@/maps/census/types'
import type { CensusVariableRef, MetricRecipe } from './metricRecipes'

export interface CensusComposerPreset {
  id: string
  label: string
  description: string
  numerator: CensusVariableRef
  denominator?: CensusVariableRef
  format: 'count' | 'percent'
  direction: 'higherIsBetter' | 'higherIsWorse'
}

export const CENSUS_COMPOSER_PRESETS: CensusComposerPreset[] = [
  {
    id: 'children_0_14_share',
    label: 'Children 0-14 share',
    description: 'Share of population aged 0 to 14 years.',
    numerator: { category: 'age', vector: 'v_CA21_11', label: '0 to 14 years' },
    denominator: { category: 'age', vector: 'v_CA21_8', label: 'Total - Age' },
    format: 'percent',
    direction: 'higherIsWorse',
  },
  {
    id: 'older_adults_65_plus_share',
    label: 'Older adults 65+ share',
    description: 'Share of population aged 65 years and over.',
    numerator: { category: 'age', vector: 'v_CA21_251', label: '65 years and over' },
    denominator: { category: 'age', vector: 'v_CA21_8', label: 'Total - Age' },
    format: 'percent',
    direction: 'higherIsWorse',
  },
  {
    id: 'visible_minority_share',
    label: 'Visible minority share',
    description: 'Share of private-household population identified as visible minority.',
    numerator: {
      category: 'visible_minority_and_ethnic_origin',
      vector: 'v_CA21_4875',
      label: 'Total visible minority population',
    },
    denominator: {
      category: 'visible_minority_and_ethnic_origin',
      vector: 'v_CA21_4872',
      label: 'Total - Visible minority universe',
    },
    format: 'percent',
    direction: 'higherIsWorse',
  },
  {
    id: 'immigrant_share',
    label: 'Immigrant share',
    description: 'Share of private-household population who are immigrants.',
    numerator: { category: 'citizenship_and_immigration', vector: 'v_CA21_4410', label: 'Immigrants' },
    denominator: {
      category: 'citizenship_and_immigration',
      vector: 'v_CA21_4404',
      label: 'Total - Immigrant status universe',
    },
    format: 'percent',
    direction: 'higherIsWorse',
  },
  {
    id: 'recent_immigrant_share',
    label: 'Recent immigrant share',
    description: 'Share of private-household population who immigrated from 2016 to 2021.',
    numerator: { category: 'citizenship_and_immigration', vector: 'v_CA21_4431', label: '2016 to 2021' },
    denominator: {
      category: 'citizenship_and_immigration',
      vector: 'v_CA21_4404',
      label: 'Total - Immigrant status universe',
    },
    format: 'percent',
    direction: 'higherIsWorse',
  },
  {
    id: 'living_alone_share',
    label: 'Living alone share',
    description: 'Share of private-household population living alone.',
    numerator: { category: 'households', vector: 'v_CA21_534', label: 'Living alone' },
    denominator: { category: 'households', vector: 'v_CA21_510', label: 'Persons in private households' },
    format: 'percent',
    direction: 'higherIsWorse',
  },
  {
    id: 'low_income_lim_at_share',
    label: 'Low-income LIM-AT share',
    description: 'Share of private-household population in low income by LIM-AT.',
    numerator: { category: 'income_100', vector: 'v_CA21_1025', label: 'In low income based on LIM-AT' },
    denominator: { category: 'income_100', vector: 'v_CA21_1010', label: 'LIM low-income status universe' },
    format: 'percent',
    direction: 'higherIsWorse',
  },
]

export function censusPresetToMetricRecipe(preset: CensusComposerPreset): MetricRecipe {
  return {
    id: preset.id,
    label: preset.label,
    description: preset.description,
    source: 'census',
    operation: 'censusVariable',
    censusNumerator: preset.numerator,
    censusDenominator: preset.denominator,
    direction: preset.direction,
    format: preset.format,
    proxyLevel: 'official',
    sourcePath: '/data/census/variables/catalog.json',
    caveats: ['Small-area Census counts are subject to random rounding and suppression.'],
  }
}

export function getCensusRecipeCategories(recipes: MetricRecipe[]): string[] {
  const categories = new Set<string>()
  recipes.forEach((recipe) => {
    if (recipe.operation !== 'censusVariable') return
    if (recipe.censusNumerator?.category) categories.add(recipe.censusNumerator.category)
    if (recipe.censusDenominator?.category) categories.add(recipe.censusDenominator.category)
  })
  return Array.from(categories)
}

function getVectorValue(data: CensusCategoryData | undefined, geoId: string, vector: string): number | null {
  if (!data) return null
  const index = data.vectors.indexOf(vector)
  if (index < 0) return null
  const values = data.data[geoId]
  const value = values?.[index]
  return Number.isFinite(value) ? Number(value) : null
}

export function computeCensusMetricValue(
  recipe: MetricRecipe,
  geoId: string,
  categoryData: Partial<Record<string, CensusCategoryData>>,
): number {
  if (recipe.operation !== 'censusVariable' || !recipe.censusNumerator) return 0
  const numerator = getVectorValue(
    categoryData[recipe.censusNumerator.category],
    geoId,
    recipe.censusNumerator.vector,
  )
  if (!Number.isFinite(numerator)) return 0
  if (!recipe.censusDenominator || recipe.format === 'count') return numerator ?? 0
  const denominator = getVectorValue(
    categoryData[recipe.censusDenominator.category],
    geoId,
    recipe.censusDenominator.vector,
  )
  if (!denominator || denominator <= 0) return 0
  return Math.max(0, Math.min(1, (numerator ?? 0) / denominator))
}

export function censusVariableDataPath(level: CensusHierarchyLevel, category: string): string {
  return `/data/census/variables/${level}/${category}.json`
}

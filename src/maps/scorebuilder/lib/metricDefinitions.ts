import { SCORE_BUILDER_DATASETS } from './datasetCatalog'
import { recipeFormulaPreview, type MetricRecipe } from './metricRecipes'
import type { ScoreMetricDefinition } from '../types'

/** Adapts a user-created metric recipe to the shared score-metric definition shape. */
export function metricRecipeToDefinition(recipe: MetricRecipe): ScoreMetricDefinition {
  return {
    key: recipe.id,
    label: recipe.label,
    shortLabel: recipe.label.length > 18 ? `${recipe.label.slice(0, 17)}...` : recipe.label,
    description: recipe.description || recipeFormulaPreview(recipe),
    format: recipe.format === 'index' ? ('ratio' as const) : recipe.format,
    category: recipe.source === 'census' ? ('demographics' as const) : ('custom' as const),
    direction: recipe.direction,
    component: recipe.source === 'census' ? ('sensitivity' as const) : ('serviceAccess' as const),
    dataSourceLabel: SCORE_BUILDER_DATASETS.find((dataset) => dataset.id === recipe.source)?.label || 'Custom recipe',
    spatialMethod: recipe.operation === 'derivedExpression' ? ('derivedRatio' as const) : ('pointInPolygon' as const),
    uncertainty:
      recipe.proxyLevel === 'official' ? ('low' as const) : recipe.proxyLevel === 'proxy' ? ('medium' as const) : ('high' as const),
    caveat: recipe.caveats?.join(' '),
    directionLabel: recipe.direction === 'higherIsWorse' ? 'lower helps' : 'higher helps',
    sourceUrl: recipe.sourcePath,
    freshnessLabel: 'User-created recipe',
    comparisonBasis: 'Compared within the currently loaded boundary level',
    indexModule: recipe.source === 'census' ? ('socialVulnerability' as const) : ('localContext' as const),
    indexDomain: recipe.source === 'census' ? ('demographics' as const) : ('services' as const),
    valueBehavior: recipe.direction === 'higherIsWorse' ? ('continuous' as const) : ('inverseContinuous' as const),
    missingDataPolicy: 'neutral' as const,
    proxyLevel: recipe.proxyLevel,
  }
}

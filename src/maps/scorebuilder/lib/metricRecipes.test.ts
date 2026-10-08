import { describe, expect, it } from 'vitest'
import {
  computeDerivedExpressionMetric,
  computePointMetricRecipe,
  filterRecipePoints,
  type MetricRecipe,
  type MetricRecipeRegion,
  type RecipePointRecord,
} from '@pgmaps/geo-toolkit/index-lab/metricRecipes'

const region: MetricRecipeRegion = {
  id: 'district',
  areaKm2: 10,
  feature: {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  },
}
const records: RecipePointRecord[] = [
  { longitude: 0.4, latitude: 0.4, properties: { count: 2, category: 'museum' } },
  { longitude: 0.41, latitude: 0.4, properties: { count: 4, category: 'gallery' } },
  { longitude: 2, latitude: 2, properties: { count: 100, category: 'museum' } },
]
const base: MetricRecipe = {
  id: 'culturalAccess',
  label: 'Cultural access',
  source: 'another-website.cultural-places',
  operation: 'pointCountInPolygon',
  direction: 'higherIsBetter',
  format: 'count',
  proxyLevel: 'official',
}

describe('reusable point recipe pipeline', () => {
  it.each([
    ['pointCountInPolygon', 2, 2],
    ['pointDensityInPolygon', 0.2, 2],
    ['averagePropertyInPolygon', 3, 2],
    ['countWithinCentroidRadius', 1, 1],
    ['accessWithinCentroidRadius', 1, 1],
  ] as const)('computes %s for consumer-defined sources', (operation, value, matchedFeatureCount) => {
    const recipe: MetricRecipe = { ...base, operation, propertyField: 'count', radiusMeters: 1000 }
    expect(computePointMetricRecipe(recipe, [region], records)).toEqual([
      { regionId: 'district', value, matchedFeatureCount },
    ])
  })

  it('applies category filters before aggregation and preserves empty/bad-source behavior', () => {
    const recipe: MetricRecipe = { ...base, filters: [{ field: 'category', operator: 'equals', value: 'museum' }] }
    expect(computePointMetricRecipe(recipe, [region], records)[0].value).toBe(1)
    expect(
      computePointMetricRecipe(
        { ...recipe, operation: 'pointDensityInPolygon' },
        [{ ...region, areaKm2: 0 }],
        records,
      )[0].value,
    ).toBe(0)
    expect(filterRecipePoints(records, [{ field: 'missing', operator: 'exists' }])).toEqual([])
    expect(() =>
      computePointMetricRecipe({ ...base, operation: 'countWithinCentroidRadius' }, [region], records),
    ).toThrow('positive radiusMeters')
  })

  it('keeps arithmetic recipes finite and treats missing inputs as zero', () => {
    const recipe: MetricRecipe = { ...base, operation: 'derivedExpression', expression: 'access * pressure + absent' }
    expect(computeDerivedExpressionMetric(recipe, { access: 0.5, pressure: 8 })).toBe(4)
    expect(computeDerivedExpressionMetric({ ...recipe, expression: 'access / 0' }, { access: 1 })).toBe(0)
    expect(computeDerivedExpressionMetric({ ...recipe, expression: 'globalThis.process.exit()' }, {})).toBe(0)
  })
})

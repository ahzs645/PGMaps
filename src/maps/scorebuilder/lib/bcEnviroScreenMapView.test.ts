import { describe, expect, it } from 'vitest'
import type { ScoredBoundaryRegion } from '../types'
import {
  BC_ENVIRO_SCREEN_MAP_OPTION_GROUPS,
  BC_ENVIRO_SCREEN_MISSING_COLOR,
  buildBcEnviroScreenMapView,
  getBcEnviroScreenLegendLabels,
  getBcEnviroScreenMapValue,
} from './bcEnviroScreenMapView'

function region(
  id: string,
  score: number,
  indicator: number,
  missingIndicators: string[] = [],
): ScoredBoundaryRegion {
  return {
    region: { id },
    score,
    metrics: { 'bcEnviroScreen.ozone': indicator },
    bcEnviroScreen: {
      components: {
        exposures: 0.2,
        environmentalEffects: 0.3,
        sensitivePopulations: 0.4,
        socioeconomicFactors: 0.5,
      },
      landscapeBurdenScore: 4,
      populationCharacteristicsScore: 6,
      formulaMode: 'reconstruction',
      formulaExpression: 'landscape_burden * population_characteristics',
      formulaError: null,
      missingIndicators,
      sourceStatusWarnings: [],
    },
  } as unknown as ScoredBoundaryRegion
}

describe('BC EnviroScreen map view', () => {
  it('exposes the same 28 grouped map choices as the reference selector', () => {
    expect(BC_ENVIRO_SCREEN_MAP_OPTION_GROUPS.map((group) => group.label)).toEqual([
      'Meta-Level Scores',
      'Component Scores',
      'Exposures Indicators',
      'Environmental Effects Indicators',
      'Sensitive Populations Indicators',
      'Socioeconomic Factors Indicators',
    ])
    expect(BC_ENVIRO_SCREEN_MAP_OPTION_GROUPS.flatMap((group) => group.options)).toHaveLength(28)
  })

  it('reads live overall, meta, component, and raw indicator values', () => {
    const sample = region('a', 42, 7.5)
    expect(getBcEnviroScreenMapValue(sample, 'overallScore')).toBe(42)
    expect(getBcEnviroScreenMapValue(sample, 'landscapeBurdenScore')).toBe(4)
    expect(getBcEnviroScreenMapValue(sample, 'component:exposures')).toBe(0.2)
    expect(getBcEnviroScreenMapValue(sample, 'indicator:ozone')).toBe(7.5)
  })

  it('builds the requested number of equal-interval bands and colors regions', () => {
    const view = buildBcEnviroScreenMapView([region('low', 0, 1), region('high', 100, 2)], 'overallScore', 4)
    expect(view.bands).toHaveLength(4)
    expect(view.bands[0].label).toBe('0–25')
    expect(view.bands[3].label).toBe('75–100')
    expect(view.regionFillColors.low).toBe(view.bands[0].color)
    expect(view.regionFillColors.high).toBe(view.bands[3].color)
  })

  it('clamps bins to 2–10 and keeps missing indicators out of the range', () => {
    const missingKey = 'bcEnviroScreen.ozone'
    const view = buildBcEnviroScreenMapView(
      [region('present', 1, 3), region('missing', 2, 99, [missingKey])],
      'indicator:ozone',
      50,
    )
    expect(view.bands).toHaveLength(10)
    expect(view.valueCount).toBe(1)
    expect(view.missingCount).toBe(1)
    expect(view.regionFillColors.missing).toBe(BC_ENVIRO_SCREEN_MISSING_COLOR)
  })

  it('keeps every dense colour band but prints only four evenly spaced legend labels', () => {
    const view = buildBcEnviroScreenMapView([region('low', 0, 1), region('high', 100, 2)], 'overallScore', 10)

    expect(view.bands).toHaveLength(10)
    expect(view.legendLabels).toEqual(['0–10', '', '', '30–40', '', '', '60–70', '', '', '90–100'])
    expect(getBcEnviroScreenLegendLabels(view.bands).filter(Boolean)).toHaveLength(4)
  })
})

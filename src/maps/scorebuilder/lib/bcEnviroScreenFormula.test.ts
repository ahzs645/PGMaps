import { describe, expect, it } from 'vitest'
import {
  BC_ENVIRO_SCREEN_DEFAULT_FORMULA,
  compileBcEnviroScreenFormula,
  validateBcEnviroScreenFormula,
} from './bcEnviroScreenFormula'

const indicators = ['pm25', 'low_income', 'traffic_density']

describe('BC EnviroScreen formula language', () => {
  it('evaluates the reconstruction formula', () => {
    const formula = compileBcEnviroScreenFormula(BC_ENVIRO_SCREEN_DEFAULT_FORMULA, indicators)
    expect(formula.evaluate({ landscape_burden: 7.5, population_characteristics: 8 })).toBe(60)
  })

  it('supports arithmetic, precedence, functions, and indicator percentiles', () => {
    const formula = compileBcEnviroScreenFormula(
      'clamp((pm25 + traffic_density) / 2 * 100 + abs(-5), 0, 100)',
      indicators,
    )
    expect(formula.evaluate({ pm25: 0.8, traffic_density: 0.6 })).toBe(75)
  })

  it('lets mean, min, and max ignore missing inputs', () => {
    const formula = compileBcEnviroScreenFormula('mean(pm25, low_income) * 100', indicators)
    expect(formula.evaluate({ pm25: 0.7, low_income: null })).toBe(70)
  })

  it('rejects unknown variables and unsafe syntax', () => {
    expect(validateBcEnviroScreenFormula('unknown * 10', indicators)).toContain('Unknown variable')
    expect(validateBcEnviroScreenFormula('globalThis.alert(1)', indicators)).toContain('Unexpected character')
    expect(validateBcEnviroScreenFormula('pm25 / 0', indicators)).toBeNull()
    expect(compileBcEnviroScreenFormula('pm25 / 0', indicators).evaluate({ pm25: 1 })).toBeNull()
  })
})

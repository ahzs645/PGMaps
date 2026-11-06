import { describe, expect, it } from 'vitest'
import { SCORE_METRICS } from '../constants'
import {
  formatMetricValue,
  formatRegionCount,
  getMetricUnavailability,
  latestObservationMonth,
  monitorIsActive,
} from './metrics'

describe('formatMetricValue density units', () => {
  it('reads people per km², not per thousand km²', () => {
    expect(formatMetricValue('populationDensity', 1605.4654, true)).toBe('1,605/km²')
  })

  it('keeps sparse sensors per 1,000 km²', () => {
    expect(formatMetricValue('overallDensity', 3.1654, true)).toBe('3,165/1,000 km²')
  })

  it('keeps small densities readable', () => {
    expect(formatMetricValue('parkDensity', 0.0837, true)).toBe('0.084/km²')
    expect(formatMetricValue('parkDensity', 0, true)).toBe('0/km²')
  })
})

describe('monitorIsActive', () => {
  it.each(['ON', 'yes', 'active', ' Active '])('counts %j as active', (status) => {
    expect(monitorIsActive(status)).toBe(true)
  })

  it.each(['inactive', 'planned', 'OFF'])('counts %j as inactive', (status) => {
    expect(monitorIsActive(status)).toBe(false)
  })

  it.each([null, undefined, '', 'unknown value'])('treats %j as unknown, not inactive', (status) => {
    expect(monitorIsActive(status)).toBeNull()
  })
})

describe('getMetricUnavailability with a level', () => {
  const enviroScreen = SCORE_METRICS.find((metric) => metric.category === 'bcEnviroScreen')!

  it('allows EnviroScreen at LHA and refuses it elsewhere in the health hierarchy', () => {
    expect(getMetricUnavailability(enviroScreen, ['bcEnviroScreen'], 'bcHealth', 'lha')).toBeNull()
    expect(getMetricUnavailability(enviroScreen, ['bcEnviroScreen'], 'bcHealth', 'chsa')?.reason).toBe('boundary')
  })
})

describe('latestObservationMonth', () => {
  it('ignores the "None" a feed sends, which sorts above every real date', () => {
    expect(latestObservationMonth(['2025-09-17 21:00:00', '2025-10-17 21:00', 'None', null])).toBe('Oct 2025')
  })

  it('has nothing to say without a real date', () => {
    expect(latestObservationMonth(['None', null, undefined, ''])).toBeNull()
  })
})

describe('formatRegionCount', () => {
  it('agrees with the count', () => {
    expect(formatRegionCount(1)).toBe('1 region')
    expect(formatRegionCount(1234)).toBe('1,234 regions')
  })
})

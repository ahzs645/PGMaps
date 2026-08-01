import { describe, expect, it } from 'vitest'
import {
  createInitialScoreBuilderState,
  scoreBuilderReducer,
  type ScoreBuilderControlState,
} from './scoreBuilderReducer'

function baseState(): ScoreBuilderControlState {
  return {
    ...createInitialScoreBuilderState(new URLSearchParams('w=0&ds=parks,census')),
    enabledDataSources: ['parks', 'census'],
    selectedNetworks: [],
    pendingNetworkSelectAll: false,
    showPoints: false,
  }
}

describe('scoreBuilderReducer correlation lens data sources', () => {
  it('enables the selected metric source for correlation axes', () => {
    const state = baseState()

    const next = scoreBuilderReducer(state, {
      type: 'setCorrelateMetricY',
      metric: 'commercialShare',
      allNetworks: [],
    })

    expect(next.correlateMetricY).toBe('commercialShare')
    expect(next.enabledDataSources).toContain('bcAssessment')
  })

  it('enables both sources when applying a top correlation pair', () => {
    const state = baseState()

    const next = scoreBuilderReducer(state, {
      type: 'applyCorrelatePair',
      metricX: 'commercialShare',
      metricY: 'crimePerCapita',
      allNetworks: [],
    })

    expect(next.correlateMetricX).toBe('commercialShare')
    expect(next.correlateMetricY).toBe('crimePerCapita')
    expect(next.enabledDataSources).toEqual(expect.arrayContaining(['bcAssessment', 'crime', 'census']))
  })

  it('selects available networks when an air-quality correlation metric is selected', () => {
    const state = baseState()

    const next = scoreBuilderReducer(state, {
      type: 'setCorrelateMetricX',
      metric: 'overallDensity',
      allNetworks: ['PurpleAir', 'AQHI'],
    })

    expect(next.enabledDataSources).toContain('airQuality')
    expect(next.selectedNetworks).toEqual(['PurpleAir', 'AQHI'])
    expect(next.showPoints).toBe(true)
  })
})

describe('scoreBuilderReducer derives data sources from the equation', () => {
  it('turns a source on when its first metric starts counting', () => {
    const next = scoreBuilderReducer(baseState(), { type: 'setWeight', metric: 'crimeDensity', value: 30 })

    expect(next.enabledDataSources).toContain('crime')
  })

  it('turns a source off when its last metric leaves the equation', () => {
    const state = { ...baseState(), weights: { ...baseState().weights, parkDensity: 25 } }

    const next = scoreBuilderReducer(state, { type: 'setWeight', metric: 'parkDensity', value: 0 })

    expect(next.enabledDataSources).not.toContain('parks')
    expect(next.enabledDataSources).toContain('census')
  })

  it('keeps a source that still backs another weighted metric', () => {
    const base = baseState()
    const state = { ...base, weights: { ...base.weights, parkDensity: 25, trailDensity: 20 } }

    const next = scoreBuilderReducer(state, { type: 'setWeight', metric: 'parkDensity', value: 0 })

    expect(next.enabledDataSources).toContain('parks')
  })

  it('keeps census while per-capita crime still borrows its population denominator', () => {
    const base = baseState()
    const state = {
      ...base,
      weights: { ...base.weights, populationDensity: 20, crimePerCapita: -30 },
      enabledDataSources: ['census', 'crime'] as typeof base.enabledDataSources,
    }

    const next = scoreBuilderReducer(state, { type: 'setWeight', metric: 'populationDensity', value: 0 })

    expect(next.enabledDataSources).toContain('census')
  })

  it('leaves sources alone when a weight only changes magnitude', () => {
    const base = baseState()
    const state = { ...base, weights: { ...base.weights, parkDensity: 25 } }

    const next = scoreBuilderReducer(state, { type: 'setWeight', metric: 'parkDensity', value: 60 })

    expect(next.enabledDataSources).toEqual(state.enabledDataSources)
  })
})

describe('scoreBuilderReducer enableDataSource', () => {
  it('adds a source without touching the rest', () => {
    const next = scoreBuilderReducer(baseState(), { type: 'enableDataSource', source: 'transit', allNetworks: [] })

    expect(next.enabledDataSources).toEqual(['parks', 'census', 'transit'])
  })

  it('is a no-op when the source is already on', () => {
    const state = baseState()

    expect(scoreBuilderReducer(state, { type: 'enableDataSource', source: 'parks', allNetworks: [] })).toBe(state)
  })

  it('selects every network when air quality is switched back on with none chosen', () => {
    const next = scoreBuilderReducer(baseState(), {
      type: 'enableDataSource',
      source: 'airQuality',
      allNetworks: ['PurpleAir', 'AQHI'],
    })

    expect(next.selectedNetworks).toEqual(['PurpleAir', 'AQHI'])
  })
})

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

import { describe, expect, it } from 'vitest'
import { computeIndexLabResults, createIndexLabState, indexLabReducer, setMetricWeight } from './state.js'
import type { IndexLabMetric, IndexLabRecord, IndexLabSettings } from './types.js'

type Key = 'heat' | 'access'
const metrics: IndexLabMetric<Key>[] = [
  {
    key: 'heat',
    label: 'Heat pressure',
    shortLabel: 'Heat',
    description: 'Measured heat',
    category: 'climate',
    format: 'index',
    defaultWeight: -70,
  },
  {
    key: 'access',
    label: 'Service access',
    shortLabel: 'Access',
    description: 'Measured access',
    category: 'services',
    format: 'ratio',
  },
]
const records: IndexLabRecord<Key>[] = [
  { id: 'alpha', label: 'Alpha', values: { heat: 8, access: 0.9 } },
  { id: 'bravo', label: 'Bravo', values: { heat: 2, access: 0.1 } },
]
const settings: IndexLabSettings = { normalization: 'minMax', aggregation: 'additive', missingData: 'neutral' }

describe('reusable Index Lab state and calculation', () => {
  it('changes signed influence and rankings without mutating the initial model or another lab', () => {
    const first = createIndexLabState({ metrics, weights: { heat: -70, access: 30 }, settings })
    const second = createIndexLabState({ metrics, weights: { heat: -70, access: 30 }, settings })
    expect(computeIndexLabResults(records, metrics, first).map((entry) => [entry.id, entry.score])).toEqual([
      ['bravo', 70],
      ['alpha', 30],
    ])
    const changed = indexLabReducer(first, { type: 'setWeight', key: 'heat', value: 70 })
    expect(computeIndexLabResults(records, metrics, changed).map((entry) => [entry.id, entry.score])).toEqual([
      ['alpha', 100],
      ['bravo', 0],
    ])
    expect(first.weights.heat).toBe(-70)
    expect(second.weights.heat).toBe(-70)
  })

  it('keeps calculation ranks stable when selecting or searching a result', () => {
    const state = createIndexLabState({ metrics, weights: { heat: 70, access: 30 }, settings })
    const searched = indexLabReducer(indexLabReducer(state, { type: 'setQuery', query: 'Bravo' }), {
      type: 'selectResult',
      id: 'bravo',
    })
    expect(computeIndexLabResults(records, metrics, searched)).toEqual(computeIndexLabResults(records, metrics, state))
    expect(searched.query).toBe('Bravo')
    expect(searched.selectedResultId).toBe('bravo')
  })

  it('distinguishes valid measured zero from missing data with configurable source availability', () => {
    const state = createIndexLabState({ metrics, weights: { heat: 1, access: 0 }, settings })
    const result = computeIndexLabResults(
      [
        { id: 'zero', label: 'Zero', values: { heat: 0 } },
        { id: 'missing', label: 'Missing', values: { heat: null } },
        { id: 'source-off', label: 'Source off', values: { heat: 100 }, coverage: { heat: false } },
      ],
      metrics,
      state,
    )
    expect(result.find((entry) => entry.id === 'zero')).toMatchObject({ score: 0, dataCoverageScore: 1 })
    expect(result.find((entry) => entry.id === 'missing')).toMatchObject({ score: 50, dataCoverageScore: 0 })
    expect(result.find((entry) => entry.id === 'source-off')).toMatchObject({ score: 50, dataCoverageScore: 0 })
  })

  it('preserves host-defined fractional weights and settings rather than silently applying UI policy', () => {
    expect(setMetricWeight({ heat: 5, access: 3 }, 'heat', 1.25)).toEqual({ heat: 1.25, access: 3 })
    const state = createIndexLabState({ metrics, settings: { domainMethod: 'custom' } })
    expect(
      indexLabReducer(state, { type: 'setSettings', settings: { domainMethod: 'alternate' } }).settings.domainMethod,
    ).toBe('alternate')
  })

  it('keeps non-finite weights out of controller state', () => {
    const weights = { heat: 5, access: 3 }
    expect(setMetricWeight(weights, 'heat', NaN)).toBe(weights)
    expect(createIndexLabState({ metrics, weights: { heat: Infinity }, settings }).weights).toEqual({
      heat: 0,
      access: 0,
    })
  })
})

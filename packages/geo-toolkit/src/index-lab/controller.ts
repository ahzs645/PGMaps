import { useCallback, useMemo, useReducer } from 'react'
import type { IndexLabMetric, IndexLabState } from './types.js'
import { createIndexLabState, indexLabReducer } from './state.js'

export interface IndexLabControllerOptions<TKey extends string, TSettings, TResult> {
  metrics: readonly IndexLabMetric<TKey>[]
  initialWeights?: Partial<Record<TKey, number>>
  initialSettings: TSettings
  /** Calculate against the complete comparison universe; result searching is presentation only. */
  compute: (state: IndexLabState<TKey, TSettings>) => readonly TResult[]
}

/** Local, isolated control state. Routing, persistence, history, and datasets can be host adapters.
 * Initial values are applied once. Catalog changes update controls/calculations without
 * discarding existing weights; temporarily removed keys remain available if reintroduced.
 * Use replaceState for an explicit model reset or loading a saved configuration.
 */
export function useIndexLabController<TKey extends string, TSettings, TResult>({
  metrics,
  initialWeights,
  initialSettings,
  compute,
}: IndexLabControllerOptions<TKey, TSettings, TResult>) {
  const [state, dispatch] = useReducer(indexLabReducer<TKey, TSettings>, undefined, () =>
    createIndexLabState({
      metrics,
      weights: initialWeights,
      settings: initialSettings,
    }),
  )
  // A query or selected row cannot redefine the normalization universe.
  const results = useMemo(
    () => compute({ weights: state.weights, settings: state.settings, query: '', selectedResultId: null }),
    [compute, state.weights, state.settings],
  )
  const totalAbsoluteWeight = useMemo(
    () => metrics.reduce((sum, metric) => sum + Math.abs(state.weights[metric.key] ?? 0), 0),
    [metrics, state.weights],
  )
  const setWeight = useCallback(
    (key: TKey, value: number) => {
      if (metrics.some((metric) => metric.key === key) && Number.isFinite(value))
        dispatch({ type: 'setWeight', key, value })
    },
    [metrics],
  )
  const setSettings = useCallback((settings: TSettings) => dispatch({ type: 'setSettings', settings }), [])
  const setQuery = useCallback((query: string) => dispatch({ type: 'setQuery', query }), [])
  const selectResult = useCallback((id: string | null) => dispatch({ type: 'selectResult', id }), [])
  const replaceState = useCallback(
    (next: IndexLabState<TKey, TSettings>) =>
      dispatch({
        type: 'replaceState',
        state: {
          ...next,
          weights: createIndexLabState({ metrics, weights: next.weights, settings: next.settings }).weights,
        },
      }),
    [metrics],
  )
  return { state, results, totalAbsoluteWeight, setWeight, setSettings, setQuery, selectResult, replaceState }
}

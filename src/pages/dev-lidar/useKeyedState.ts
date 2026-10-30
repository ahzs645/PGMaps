import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * State owned by a request/source identity. A changed key resets before commit,
 * and late asynchronous updates from an obsolete identity cannot replace it.
 * Disabled lazy resources can retain their previous state until requested again.
 */
export function useKeyedState<T>(key: unknown, initial: () => T, resetWhen = true): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(() => ({ key, value: initial(), enabled: resetWhen, generation: 0 }))
  const currentKey = resetWhen ? key : state.key
  const reset = resetWhen && (!state.enabled || !Object.is(state.key, key))
  const generation = state.generation + (reset ? 1 : 0)
  if (reset) setState({ key, value: initial(), enabled: true, generation })
  else if (state.enabled !== resetWhen) setState({ ...state, enabled: resetWhen })
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      setState((current) => {
        if (!Object.is(current.key, currentKey) || current.generation !== generation) return current
        const value = typeof action === 'function' ? (action as (previous: T) => T)(current.value) : action
        return Object.is(value, current.value) ? current : { ...current, value }
      })
    },
    [currentKey, generation],
  )
  return [state.value, setValue]
}

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  normalizeObservations,
  normalizeStations,
  SERIES_COLORS,
  type Observation,
  type Series,
  type Station,
} from './data'

const BASE = import.meta.env.DEV
  ? '/__dev_water_temp/'
  : 'https://raw.githubusercontent.com/ahzs645/unbcwatertemp-viz/main/public/data/'
async function readJson(file: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${BASE}${file}`, { signal })
  if (!response.ok)
    throw new Error(
      `Could not load ${file}. ${import.meta.env.DEV ? 'Check the local UNBC snapshot directory.' : 'The reference repository snapshot is unavailable. Try again shortly.'}`,
    )
  return response.json()
}

interface Selection {
  id: string
  slot: number
}
interface SelectionState {
  items: Selection[]
  notice: string
}
type SelectionAction = { type: 'toggle'; id: string } | { type: 'clear' }
function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  if (action.type === 'clear') return { items: [], notice: '' }
  if (state.items.some((item) => item.id === action.id))
    return { items: state.items.filter((item) => item.id !== action.id), notice: '' }
  if (state.items.length === 4)
    return { ...state, notice: 'Compare up to four stations. Remove a selected station to add another.' }
  const slot = [0, 1, 2, 3].find((value) => !state.items.some((item) => item.slot === value))!
  return { items: [...state.items, { id: action.id, slot }], notice: '' }
}

export function useWaterTemperature() {
  const [stations, setStations] = useState<Station[]>([])
  const [config, setConfig] = useState<{ updated: string | null; airYear: number | null }>({
    updated: null,
    airYear: null,
  })
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selection, dispatch] = useReducer(selectionReducer, { items: [], notice: '' })
  const [observations, setObservations] = useState<Record<string, Observation[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const cache = useRef(new Map<string, Observation[]>())

  useEffect(() => {
    const controller = new AbortController()
    setCatalogLoading(true)
    setCatalogError('')
    void (async () => {
      try {
        const [catalog, metadata] = await Promise.all([
          readJson('stations.json', controller.signal),
          readJson('config.json', controller.signal).catch(() => null),
        ])
        if (controller.signal.aborted) return
        const normalized = normalizeStations(catalog)
        if (!normalized.length) throw new Error('The snapshot has no valid station locations.')
        setStations(normalized)
        const source = metadata as { last_updated?: unknown; daymet_last_year?: unknown } | null
        setConfig({
          updated: typeof source?.last_updated === 'string' ? source.last_updated : null,
          airYear: typeof source?.daymet_last_year === 'number' ? source.daymet_last_year : null,
        })
      } catch (error) {
        if (!controller.signal.aborted)
          setCatalogError(error instanceof Error ? error.message : 'Could not load station catalog')
      } finally {
        if (!controller.signal.aborted) setCatalogLoading(false)
      }
    })()
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    const controller = new AbortController()
    for (const selected of selection.items) {
      const station = stations.find((item) => item.station_id === selected.id)
      if (!station || cache.current.has(selected.id)) continue
      void readJson(`data/${station.filename}`, controller.signal)
        .then(normalizeObservations)
        .then((data) => {
          if (controller.signal.aborted) return
          cache.current.set(selected.id, data)
          setObservations((previous) => ({ ...previous, [selected.id]: data }))
          setErrors((previous) => {
            const next = { ...previous }
            delete next[selected.id]
            return next
          })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setErrors((previous) => ({
              ...previous,
              [selected.id]: error instanceof Error ? error.message : 'Could not load observations',
            }))
        })
    }
    return () => controller.abort()
  }, [selection.items, stations, attempt])

  const series = useMemo<Series[]>(
    () =>
      selection.items.flatMap((selected) => {
        const station = stations.find((item) => item.station_id === selected.id)
        return station && observations[selected.id]
          ? [{ station, color: SERIES_COLORS[selected.slot], data: observations[selected.id] }]
          : []
      }),
    [selection.items, stations, observations],
  )
  return {
    stations,
    config,
    catalogLoading,
    catalogError,
    selection,
    series,
    errors,
    loading: selection.items.some((item) => !observations[item.id] && !errors[item.id]),
    toggle: (id: string) => dispatch({ type: 'toggle', id }),
    clear: () => dispatch({ type: 'clear' }),
    retry: () => {
      setErrors({})
      setAttempt((value) => value + 1)
    },
  }
}

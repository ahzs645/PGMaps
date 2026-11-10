import { useEffect, useState } from 'react'
import type { FeatureCollection, Geometry } from 'geojson'
import {
  countUrl,
  coverageUrl,
  parseCount,
  parseYearCounts,
  TILE_PAGE,
  tilesUrl,
  yearCountsUrl,
  type LidarBcProduct,
  type LidarBcTile,
  type LonLatBounds,
} from './bcLidarIndex'

export type TileCollection = FeatureCollection<Geometry, LidarBcTile>

async function getJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw Error(`The BC LiDAR index returned ${response.status}`)
  const json = await response.json()
  if (json?.error) throw Error(`BC LiDAR index: ${json.error.message ?? 'query failed'}`)
  return json
}

const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
const message = (error: unknown) => (error instanceof Error ? error.message : 'The BC LiDAR index could not be read')

/** Province-wide coverage outlines by year: loaded once. */
export function useLidarBcCoverage() {
  const [state, setState] = useState<{ data: FeatureCollection | null; error: string }>({ data: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    getJson(coverageUrl(), abort.signal)
      .then((data: FeatureCollection) => setState({ data, error: '' }))
      .catch((error) => !aborted(error) && setState({ data: null, error: message(error) }))
    return () => abort.abort()
  }, [attempt])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

/** Tiles per acquisition year for every product, counted by the service (six small requests). */
export function useLidarBcYearCounts(products: readonly LidarBcProduct[]) {
  const [counts, setCounts] = useState<Record<string, { year: number; tiles: number }[]>>({})
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    for (const product of products)
      getJson(yearCountsUrl(product), abort.signal)
        .then((json) => setCounts((previous) => ({ ...previous, [product.id]: parseYearCounts(json) })))
        .catch((e) => !aborted(e) && setError(message(e)))
    return () => abort.abort()
  }, [products])
  return { counts, error }
}

export interface ViewTiles {
  /** Tiles in the view, or null below the product's drawing zoom. */
  tiles: TileCollection | null
  /** All tiles intersecting the view, even when only `TILE_PAGE` are drawn. */
  count: number | null
  loading: boolean
  error: string
}

/** The view's tiles, re-queried after the camera settles, with stale requests cancelled. */
export function useLidarBcViewTiles(
  product: LidarBcProduct,
  view: { bounds: LonLatBounds; zoom: number } | null,
  year: number | null,
): ViewTiles {
  const [state, setState] = useState<ViewTiles>({ tiles: null, count: null, loading: false, error: '' })
  const key = view
    ? `${product.id}|${year}|${view.zoom.toFixed(1)}|${Object.values(view.bounds)
        .map((n) => n.toFixed(4))
        .join(',')}`
    : ''
  useEffect(() => {
    if (!view) return
    const abort = new AbortController()
    const draw = view.zoom >= product.minZoom
    const timer = window.setTimeout(() => {
      setState((previous) => ({ ...previous, loading: true, error: '' }))
      Promise.all([
        getJson(countUrl(product, view.bounds, year), abort.signal).then(parseCount),
        draw ? (getJson(tilesUrl(product, view.bounds, year), abort.signal) as Promise<TileCollection>) : null,
      ])
        .then(([count, tiles]) => setState({ count, tiles, loading: false, error: '' }))
        .catch((error) => !aborted(error) && setState((p) => ({ ...p, loading: false, error: message(error) })))
    }, 250)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
    // `key` stands for the view, product and year.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

export const isCapped = (view: ViewTiles) =>
  view.tiles != null &&
  view.count != null &&
  view.count > view.tiles.features.length &&
  view.tiles.features.length >= TILE_PAGE

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Shared, reusable URL <-> map-view plumbing.
 *
 * Two readable URL styles are supported, both built on the same pure helpers:
 *
 *   1. Query params  ?lng=-122.75&lat=53.91&z=10
 *   2. Compact hash  #/10.00/53.91/-122.75/B1/L1/L2   (zoom/lat/lng/...codes)
 *
 * The compact hash is the format aqmap uses; `serializeMapViewHash` /
 * `parseMapViewHash` are the single source of truth for it (aqmap's
 * `serializeAqmapHash` / `parseAqmapHash` delegate here).
 *
 * Adoption (census / parks / explorer): call {@link useMapViewUrlState} and
 * spread the result into the base `<Map>`:
 *
 *   const { initialView, hasUrlView, onViewportChange } = useMapViewUrlState({
 *     defaultView: { center: PG_CENTER, zoom: 10 },
 *   })
 *   <Map center={initialView.center} zoom={initialView.zoom}
 *        onViewportChange={onViewportChange} />
 *
 * The hook writes through react-router's `setSearchParams` (functional updater,
 * `{ replace: true }`) so it composes with other `useUrlState` params on the
 * same page without clobbering them. Maps that own the entire URL themselves
 * (aqmap, via `window.history.replaceState`) use the pure helpers directly
 * instead of the hook.
 */

export interface MapViewState {
  /** `[longitude, latitude]` */
  center: [number, number]
  zoom: number
}

export interface MapViewBounds {
  /** Views with a zoom outside [minZoom, maxZoom] fall back to the default. */
  minZoom?: number
  maxZoom?: number
}

export interface MapViewFormat extends MapViewBounds {
  /** Decimal places for longitude/latitude. Default 4. */
  lngLatPrecision?: number
  /** Decimal places for zoom. Default 2. */
  zoomPrecision?: number
}

export interface MapViewQueryKeys {
  lng?: string
  lat?: string
  zoom?: string
}

export interface MapViewUrlOptions extends MapViewFormat {
  /** View used when the URL carries no (valid) view. */
  defaultView: MapViewState
  /** Query param names. Default `{ lng: 'lng', lat: 'lat', zoom: 'z' }`. */
  queryKeys?: MapViewQueryKeys
  /** Debounce for view writes from {@link useMapViewUrlState}. Default {@link MAP_VIEW_URL_DEBOUNCE_MS}. */
  debounceMs?: number
}

const DEFAULT_MIN_ZOOM = 0
const DEFAULT_MAX_ZOOM = 22
const DEFAULT_LNGLAT_PRECISION = 4
const DEFAULT_ZOOM_PRECISION = 2
const DEFAULT_QUERY_KEYS: Required<MapViewQueryKeys> = { lng: 'lng', lat: 'lat', zoom: 'z' }

/** Debounce for view writes; matches aqmap's URL_UPDATE_DELAY_MS. */
export const MAP_VIEW_URL_DEBOUNCE_MS = 350

function minZoomOf(o: MapViewBounds): number {
  return o.minZoom ?? DEFAULT_MIN_ZOOM
}

function maxZoomOf(o: MapViewBounds): number {
  return o.maxZoom ?? DEFAULT_MAX_ZOOM
}

function lngLatPrecisionOf(o: MapViewFormat): number {
  return o.lngLatPrecision ?? DEFAULT_LNGLAT_PRECISION
}

function zoomPrecisionOf(o: MapViewFormat): number {
  return o.zoomPrecision ?? DEFAULT_ZOOM_PRECISION
}

function queryKeysOf(o: MapViewUrlOptions): Required<MapViewQueryKeys> {
  return { ...DEFAULT_QUERY_KEYS, ...o.queryKeys }
}

/** Finite number from a raw string, else `fallback`. */
export function parseNumberField(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === '') return fallback
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : fallback
}

/** Zoom from a raw string; out-of-range or invalid falls back to the default view's zoom. */
export function parseZoomField(raw: string | null, options: MapViewUrlOptions): number {
  const numeric = parseNumberField(raw, options.defaultView.zoom)
  return numeric >= minZoomOf(options) && numeric <= maxZoomOf(options) ? numeric : options.defaultView.zoom
}

/** A view is valid when lng/lat are finite, lat is within Web Mercator range, and zoom is in bounds. */
export function isMapViewValid(view: MapViewState, bounds: MapViewBounds = {}): boolean {
  const [lng, lat] = view.center
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lat >= -85 &&
    lat <= 85 &&
    view.zoom >= minZoomOf(bounds) &&
    view.zoom <= maxZoomOf(bounds)
  )
}

// --- Compact hash: `#/<zoom>/<lat>/<lng>[/<...codes>]` ----------------------

/**
 * Serialize a view (plus optional ordered short codes such as `B1`/`L1`) into a
 * compact, bookmarkable hash fragment. Order is zoom/lat/lng so the leading
 * numbers read like a typical map permalink.
 */
export function serializeMapViewHash(view: MapViewState, codes: readonly string[], format: MapViewFormat = {}): string {
  const zoom = view.zoom.toFixed(zoomPrecisionOf(format))
  const lat = view.center[1].toFixed(lngLatPrecisionOf(format))
  const lng = view.center[0].toFixed(lngLatPrecisionOf(format))
  return ['#', zoom, lat, lng, ...codes.filter(Boolean)].join('/')
}

/**
 * Parse a compact view hash. Returns `null` when the hash is not a `#/` view
 * hash, so callers can fall back to other sources (e.g. query params).
 */
export function parseMapViewHash(
  hash: string,
  options: MapViewUrlOptions,
): { view: MapViewState; codes: string[] } | null {
  if (!hash.startsWith('#/')) return null
  const parts = hash.slice(2).split('/').filter(Boolean)
  const zoom = parseZoomField(parts[0] ?? null, options)
  const lat = parseNumberField(parts[1] ?? null, options.defaultView.center[1])
  const lng = parseNumberField(parts[2] ?? null, options.defaultView.center[0])
  return { view: { center: [lng, lat], zoom }, codes: parts.slice(3) }
}

// --- Query params: ?lng&lat&z -----------------------------------------------

export function readMapViewFromQuery(params: URLSearchParams, options: MapViewUrlOptions): MapViewState {
  const keys = queryKeysOf(options)
  return {
    center: [
      parseNumberField(params.get(keys.lng), options.defaultView.center[0]),
      parseNumberField(params.get(keys.lat), options.defaultView.center[1]),
    ],
    zoom: parseZoomField(params.get(keys.zoom), options),
  }
}

/** True when any of the view query params are present (i.e. the URL pins a view). */
export function queryHasMapView(params: URLSearchParams, options: MapViewUrlOptions): boolean {
  const keys = queryKeysOf(options)
  return params.has(keys.lng) || params.has(keys.lat) || params.has(keys.zoom)
}

/**
 * Write the view into `params` in place. The params are removed when the view
 * rounds to the default (keeps pristine URLs clean); invalid views are left
 * untouched. Mutates and returns the same `URLSearchParams`.
 */
export function applyMapViewToQuery(
  params: URLSearchParams,
  view: MapViewState,
  options: MapViewUrlOptions,
): URLSearchParams {
  const keys = queryKeysOf(options)
  if (!isMapViewValid(view, options)) return params

  const lngP = lngLatPrecisionOf(options)
  const zoomP = zoomPrecisionOf(options)
  const lng = view.center[0].toFixed(lngP)
  const lat = view.center[1].toFixed(lngP)
  const zoom = view.zoom.toFixed(zoomP)

  const isDefault =
    lng === options.defaultView.center[0].toFixed(lngP) &&
    lat === options.defaultView.center[1].toFixed(lngP) &&
    zoom === options.defaultView.zoom.toFixed(zoomP)

  if (isDefault) {
    params.delete(keys.lng)
    params.delete(keys.lat)
    params.delete(keys.zoom)
  } else {
    params.set(keys.lng, lng)
    params.set(keys.lat, lat)
    params.set(keys.zoom, zoom)
  }
  return params
}

// --- React-router hook ------------------------------------------------------

export interface UseMapViewUrlStateResult {
  /** View read from the URL once, at mount. Use to seed an uncontrolled map. */
  initialView: MapViewState
  /** Whether the mount URL pinned a view (use to suppress an initial auto-fit). */
  hasUrlView: boolean
  /** Debounced writer; wire to the base `<Map onViewportChange>`. */
  onViewportChange: (viewport: { center: [number, number]; zoom: number }) => void
}

/**
 * Persist a map's center/zoom in the URL query so the view is bookmarkable and
 * shareable, without making the map controlled (avoids the URL-mirrored-in-state
 * feedback loop). Reads the initial view once; writes subsequent moves through
 * `setSearchParams` (debounced, `{ replace: true }`, functional updater).
 */
export function useMapViewUrlState(options: MapViewUrlOptions): UseMapViewUrlStateResult {
  const [, setSearchParams] = useSearchParams()

  // Keep the latest options reachable from the (async, debounced) write callback
  // without re-subscribing every render — callers usually pass an inline object.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  // Read the initial view from the URL exactly once at mount (lazy initializer).
  const [initial] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      view: readMapViewFromQuery(params, options),
      hasUrlView: queryHasMapView(params, options),
    }
  })

  const debounceMs = options.debounceMs ?? MAP_VIEW_URL_DEBOUNCE_MS
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onViewportChange = useCallback(
    (viewport: { center: [number, number]; zoom: number }) => {
      const opts = optionsRef.current
      const view: MapViewState = { center: viewport.center, zoom: viewport.zoom }
      if (!isMapViewValid(view, opts)) return

      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setSearchParams(
          (current) => {
            const params = new URLSearchParams(current)
            applyMapViewToQuery(params, view, opts)
            return params
          },
          { replace: true },
        )
      }, debounceMs)
    },
    [setSearchParams, debounceMs],
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return { initialView: initial.view, hasUrlView: initial.hasUrlView, onViewportChange }
}

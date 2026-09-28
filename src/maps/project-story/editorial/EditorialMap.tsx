import type MapLibreGL from 'maplibre-gl'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Map as NativeMap } from '@/components/ui/map'
import { MapSwipe } from '@/components/ui/map-swipe'
import { MapMarker, MarkerContent } from '@/components/ui/map-markers'
import { EditorialBasemapContext, EDITORIAL_BASEMAP_STYLE, type EditorialBasemap } from './editorialBasemap'
import { FeatureViewportCache } from './adapters/featureViewportCache'
import { loadFeaturePages } from './adapters/featurePages'
import { useEditorialBasemapTheme } from './useEditorialBasemapTheme'
import { useNativeFeaturePopups } from './nativeFeaturePopups'
import {
  authoredCamera,
  normalizeWebMap,
  record,
  sourceLayerId,
  type ArcgisRecord,
  type NativeWebMap,
} from './adapters/arcgisWebMap'

export interface EditorialTourPoint {
  id: string
  coordinates: [number, number]
  label: string
  scale?: number
}
export interface EditorialMapProps {
  resource: ArcgisRecord
  override?: ArcgisRecord
  tourPoints?: EditorialTourPoint[]
  activeTourPoint?: string
  onSelectTourPoint?: (id: string) => void
  onReady?: () => void
  onViewReady?: (view: MapLibreGL.Map | null) => void
  passive?: boolean
  /** Visible horizontal interval when this map belongs to a comparison. */
  popupRange?: [number, number]
  acceptPopupPoint?: (x: number, width: number) => boolean
  /** Query the driving viewport only after it settles, not each mirrored frame. */
  featureViewport?: MapLibreGL.Map | null
  popupDisplayMap?: MapLibreGL.Map | null
}
const retiredMaps = new WeakSet<MapLibreGL.Map>()
const jsonCache = new globalThis.Map<string, Promise<ArcgisRecord>>()
function fetchSourceJson(url: string): Promise<ArcgisRecord> {
  const cached = jsonCache.get(url)
  if (cached) return cached
  const result = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`)
      const json = record(await response.json())
      if (json.error) throw new Error(String(record(json.error).message ?? 'Original source unavailable'))
      return json
    })
    .catch((error) => {
      jsonCache.delete(url)
      throw error
    })
  jsonCache.set(url, result)
  return result
}
const documentCache = new globalThis.Map<string, Promise<NativeWebMap>>()
function loadDocument(url: string, basemap: EditorialBasemap) {
  const key = `${basemap}:${url}`
  const cached = documentCache.get(key)
  if (cached) return cached
  const result = Promise.all([
    fetchSourceJson(url),
    basemap !== 'source' ? fetchSourceJson(EDITORIAL_BASEMAP_STYLE) : undefined,
  ])
    .then(([data, style]) => normalizeWebMap(data, fetchSourceJson, style as MapLibreGL.StyleSpecification | undefined))
    .catch((error) => {
      documentCache.delete(key)
      throw error
    })
  documentCache.set(key, result)
  return result
}
function moveToAuthored(map: MapLibreGL.Map, settings: ArcgisRecord, animate: boolean) {
  const camera = authoredCamera(settings)
  const duration = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 650 : 0
  if (camera.center && camera.zoom !== undefined)
    map.easeTo({ center: camera.center, zoom: camera.zoom, bearing: camera.bearing, duration, roll: 0 })
  else if (camera.bounds) map.fitBounds(camera.bounds, { padding: 12, bearing: camera.bearing, duration, roll: 0 })
  else if (camera.center) map.easeTo({ center: camera.center, bearing: camera.bearing, duration, roll: 0 })
}

/** Original cartography and feature renderers adapted into the shared PGMaps map. */
export function EditorialMap(props: EditorialMapProps) {
  const { resource, override, tourPoints, activeTourPoint, onSelectTourPoint, passive = false } = props
  const basemap = useContext(EditorialBasemapContext)
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const [nearby, setNearby] = useState(false)
  const [document, setDocument] = useState<NativeWebMap | null>(null)
  const [documentUrl, setDocumentUrl] = useState('')
  const [documentRevision, setDocumentRevision] = useState(0)
  const [map, setMap] = useState<MapLibreGL.Map | null>(null)
  useEditorialBasemapTheme(map, document, basemap)
  const [renderedMap, setRenderedMap] = useState<MapLibreGL.Map | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const featureCache = useRef(new FeatureViewportCache())
  const featureDrawState = useRef<{ map: MapLibreGL.Map; document: NativeWebMap; counts: Map<string, number> } | null>(
    null,
  )
  const [featuresLoading, setFeaturesLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [revision, setRevision] = useState(0)
  const itemId = typeof resource.itemId === 'string' ? resource.itemId : ''
  const webmapUrl =
    typeof resource.webmapUrl === 'string'
      ? resource.webmapUrl
      : `https://www.arcgis.com/sharing/rest/content/items/${itemId}/data?f=json`
  const documentKey = `${basemap}:${webmapUrl}`
  const acceptPopupClick = useCallback((x: number, width: number) => {
    if (callbacks.current.acceptPopupPoint) return callbacks.current.acceptPopupPoint(x, width)
    const range = callbacks.current.popupRange
    const percent = (x / width) * 100
    return !range || (percent >= range[0] && percent <= range[1])
  }, [])
  useNativeFeaturePopups(map, document, true, acceptPopupClick, props.popupDisplayMap)
  const settingsKey = JSON.stringify({ ...resource, ...override })
  const pointsKey = JSON.stringify(tourPoints ?? [])
  const initialCamera = document ? authoredCamera({ ...document.initial, ...resource, ...override }) : undefined
  const styles = useMemo(() => (document ? { light: document.style, dark: document.style } : undefined), [document])
  const receiveMap = useCallback((next: MapLibreGL.Map | null) => {
    if (mapRef.current && mapRef.current !== next) {
      retiredMaps.add(mapRef.current)
      callbacks.current.onViewReady?.(null)
    }
    // StrictMode can detach and replay a callback ref for the same live map.
    // Retirement protects detached views; reattachment restores ownership.
    if (next) retiredMaps.delete(next)
    mapRef.current = next
    setMap(next)
  }, [])
  useEffect(() => {
    if (!host.current) return
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), { rootMargin: '350px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!nearby || (documentUrl === documentKey && retry === 0)) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setStatus('loading')
        setFeaturesLoading(false)
        setError('')
        // Keep the current canvas and style while the next branch is fetched.
        // Clearing the document here remounts MapLibre on every scroll step.
      }
    })
    void loadDocument(webmapUrl, basemap)
      .then((data) => {
        if (cancelled) return
        setDocument(data)
        setDocumentUrl(documentKey)
        setDocumentRevision((value) => value + 1)
        if (data.warnings.length) setError(`Some original map layers are unavailable. ${data.warnings.join(' ')}`)
      })
      .catch((failure) => {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : 'Original map unavailable')
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [nearby, webmapUrl, documentKey, documentUrl, retry, basemap])
  useEffect(() => {
    if (!map || !document || documentUrl !== documentKey) return
    let disposed = false
    let sourceFailed = false
    let announced = false
    const ready = () => {
      if (disposed || retiredMaps.has(map) || announced) return
      announced = true
      moveToAuthored(map, { ...document.initial, ...callbacks.current.resource, ...callbacks.current.override }, false)
      setStatus(document.warnings.length || sourceFailed ? 'error' : 'ready')
      setRenderedMap(map)
      setRevision((value) => value + 1)
      callbacks.current.onReady?.()
      callbacks.current.onViewReady?.(map)
    }
    const failed = (event: MapLibreGL.ErrorEvent) => {
      if (disposed || retiredMaps.has(map)) return
      // Empty cached raster tiles use the service's transparent blankTile response.
      // Any remaining source failure is surfaced rather than hidden behind a ready label.
      sourceFailed = true
      setError(`An original map source could not be loaded: ${event.error.message}`)
      setStatus('error')
    }
    map.on('load', ready)
    // The shared map can emit its one-shot load before this ref effect attaches.
    // A camera/style change can meanwhile make loaded() false; idle completes
    // that missed-load path without treating a pending map as ready.
    map.on('idle', ready)
    map.on('error', failed)
    if (map.loaded()) ready()
    return () => {
      disposed = true
      map.off('load', ready)
      map.off('idle', ready)
      map.off('error', failed)
    }
  }, [map, document, documentUrl, documentRevision, documentKey])
  useEffect(() => {
    if (!map || !document || documentUrl !== documentKey || retiredMaps.has(map) || !map.isStyleLoaded()) return
    const settings = { ...document.initial, ...callbacks.current.resource, ...callbacks.current.override }
    const overrides = new globalThis.Map(
      (Array.isArray(settings.mapLayers) ? settings.mapLayers : []).map((value) => {
        const entry = record(value)
        return [entry.id, entry]
      }),
    )
    for (const layer of document.layers) {
      const id = sourceLayerId(layer.id)
      const override = overrides.get(layer.id)
      const visible = typeof override?.visible === 'boolean' ? override.visible : layer.visibility !== false
      for (const rendered of map.getStyle().layers) {
        if (rendered.id !== id && !rendered.id.startsWith(`${id}-`)) continue
        const original = document.style.layers.find((entry) => entry.id === rendered.id)
        map.setLayoutProperty(rendered.id, 'visibility', visible ? (original?.layout?.visibility ?? 'visible') : 'none')
        if (['raster', 'fill'].includes(rendered.type))
          map.setPaintProperty(rendered.id, `${rendered.type}-opacity`, override?.opacity ?? layer.opacity ?? 1)
      }
    }
    moveToAuthored(map, settings, true)
  }, [map, document, documentUrl, documentKey, settingsKey, revision])
  useEffect(() => {
    if (!map || retiredMaps.has(map) || !revision) return
    const selected = callbacks.current.tourPoints?.find((point) => point.id === callbacks.current.activeTourPoint)
    if (selected) {
      const settings = { ...callbacks.current.resource, ...callbacks.current.override }
      moveToAuthored(
        map,
        {
          viewpoint: {
            targetGeometry: { x: selected.coordinates[0], y: selected.coordinates[1] },
            scale: selected.scale ?? (typeof settings.defaultScale === 'number' ? settings.defaultScale : 5000),
          },
        },
        true,
      )
    }
  }, [map, pointsKey, activeTourPoint, revision])
  useEffect(() => {
    if (!map || !document?.features.length || documentUrl !== documentKey || !revision) return
    let disposed = false
    let pending: AbortController | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    if (featureDrawState.current?.map !== map || featureDrawState.current.document !== document)
      featureDrawState.current = { map, document, counts: new globalThis.Map() }
    const drawn = featureDrawState.current.counts
    const viewport = props.featureViewport ?? map
    const refresh = async () => {
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      if (retiredMaps.has(map)) return
      setFeaturesLoading(true)
      const bounds = viewport.getBounds()
      const bbox: [number, number, number, number] = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ]
      const resolution = 360 / (512 * 2 ** viewport.getZoom()) / 2
      await Promise.all(
        document.features.map(async (plan) => {
          if (map.getLayoutProperty(plan.id, 'visibility') === 'none') return
          const publish = (features: GeoJSON.Feature[]) => {
            if (disposed || controller.signal.aborted || retiredMaps.has(map)) return
            ;(map.getSource(plan.id) as MapLibreGL.GeoJSONSource | undefined)?.setData({
              type: 'FeatureCollection',
              features,
            })
            drawn.set(plan.id, features.length)
          }
          const cached = featureCache.current.get(plan, bbox, resolution)
          if (cached) {
            publish(cached)
            return
          }
          // A cached coarser view can bridge a remount while finer geometry arrives.
          if (!drawn.get(plan.id)) {
            const preview = featureCache.current.get(plan, bbox, Infinity)
            if (preview) publish(preview)
          }
          const retainPrevious = (drawn.get(plan.id) ?? 0) > 0
          let featureCount = 0
          try {
            const complete = await loadFeaturePages(plan, bbox, resolution, controller.signal, (page) => {
              featureCount = page.length
              // Replacing a complete view with the first 2,000 rows makes most
              // buildings disappear on each zoom. Only initial loads draw in batches.
              if (!retainPrevious) publish(page)
            })
            if (disposed || controller.signal.aborted || retiredMaps.has(map)) return
            featureCache.current.put(plan, bbox, resolution, complete)
            if (retainPrevious) publish(complete)
          } catch (failure) {
            if (!disposed && !controller.signal.aborted) {
              setError(
                `Original layer “${plan.title}” ${retainPrevious ? 'could not update; the previous view is retained' : featureCount ? 'is only partly loaded' : 'is unavailable'}: ${failure instanceof Error ? failure.message : 'Query failed'}`,
              )
              setStatus('error')
            }
          }
        }),
      )
      if (!disposed && !controller.signal.aborted && pending === controller) setFeaturesLoading(false)
    }
    const stop = () => {
      clearTimeout(refreshTimer)
      pending?.abort()
    }
    const update = () => {
      stop()
      refreshTimer = setTimeout(() => {
        void refresh()
      }, 150)
    }
    viewport.on('movestart', stop)
    viewport.on('moveend', update)
    if (!viewport.isMoving()) void refresh()
    return () => {
      disposed = true
      stop()
      viewport.off('movestart', stop)
      viewport.off('moveend', update)
    }
  }, [map, document, documentUrl, documentKey, revision, settingsKey, props.featureViewport])
  return (
    <div
      ref={host}
      className="editorial-native-map"
      data-testid="editorial-map"
      data-engine="maplibre"
      data-basemap={basemap}
      data-state={status}
      data-map-status={status}
      data-map-item={itemId}
      data-features-loading={featuresLoading}
      style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--editorial-surface)' }}
    >
      {nearby && document && (
        <NativeMap
          ref={receiveMap}
          styles={styles}
          theme="dark"
          center={initialCamera?.center ?? [0, 0]}
          zoom={initialCamera?.zoom ?? 1}
          bounds={initialCamera?.center ? undefined : initialCamera?.bounds}
          fitBoundsOptions={{ padding: 12 }}
          minZoom={0}
          maxZoom={22}
          controls={passive ? null : undefined}
          interactive={!passive}
          scrollZoom={false}
          cooperativeGestures={!passive}
          showStyleLoadingOverlay={false}
          showLoadingOverlay={false}
          className="h-full w-full"
        >
          {tourPoints?.map((point, index) => (
            <MapMarker key={point.id} longitude={point.coordinates[0]} latitude={point.coordinates[1]}>
              <MarkerContent>
                <button
                  type="button"
                  aria-label={`Tour stop ${index + 1}: ${point.label}`}
                  aria-pressed={point.id === activeTourPoint}
                  onClick={() => onSelectTourPoint?.(point.id)}
                  style={{
                    width: point.id === activeTourPoint ? 32 : 27,
                    height: point.id === activeTourPoint ? 32 : 27,
                    borderRadius: '50%',
                    border: '2px solid var(--editorial-fg)',
                    background: point.id === activeTourPoint ? 'var(--editorial-fg)' : 'var(--editorial-bg)',
                    color: point.id === activeTourPoint ? 'var(--editorial-bg)' : 'var(--editorial-fg)',
                    fontSize: 12,
                    fontWeight: 'bold',
                    boxShadow: '0 1px 4px #0008',
                  }}
                >
                  {index + 1}
                </button>
              </MarkerContent>
            </MapMarker>
          ))}
        </NativeMap>
      )}
      {(status === 'idle' || status === 'loading') && (!map || renderedMap !== map) && (
        <div role="status" className="sr-only">
          Loading original map…
        </div>
      )}
      {((status === 'loading' && map && renderedMap === map) || (featuresLoading && status !== 'loading')) && (
        <div
          role="status"
          style={{
            position: 'absolute',
            bottom: 30,
            left: 12,
            padding: '4px 8px',
            color: 'var(--editorial-fg)',
            background: 'var(--editorial-control)',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {status === 'loading' ? 'Updating map…' : 'Updating map detail…'}
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            bottom: 32,
            left: 16,
            right: 16,
            background: 'var(--editorial-bg)',
            padding: 14,
            color: 'var(--editorial-fg)',
            fontSize: 13,
            pointerEvents: 'auto',
            maxHeight: '40%',
            overflow: 'auto',
          }}
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              documentCache.delete(documentKey)
              setRetry((value) => value + 1)
            }}
            style={{ textDecoration: 'underline', marginTop: 8 }}
          >
            Retry map
          </button>
        </div>
      )}
    </div>
  )
}
export interface EditorialSwipeProps {
  left: ArcgisRecord
  right: ArcgisRecord
  leftOverride?: ArcgisRecord
  rightOverride?: ArcgisRecord
  leftLabel?: string
  rightLabel?: string
}

/** Two full-size original WebMaps share one viewpoint; clipping never changes map dimensions. */
export function EditorialSwipe({
  left,
  right,
  leftOverride,
  rightOverride,
  leftLabel = 'Earlier map',
  rightLabel = 'Later map',
}: EditorialSwipeProps) {
  const positionRef = useRef(50)
  const updatePosition = useCallback((position: number) => {
    positionRef.current = position
  }, [])
  const acceptLeft = useCallback((x: number, width: number) => (x / width) * 100 < positionRef.current, [])
  const acceptRight = useCallback((x: number, width: number) => (x / width) * 100 >= positionRef.current, [])
  const [leftView, setLeftView] = useState<MapLibreGL.Map | null>(null)
  const [rightView, setRightView] = useState<MapLibreGL.Map | null>(null)
  const onLeftReady = useCallback((view: MapLibreGL.Map | null) => setLeftView(view), [])
  const onRightReady = useCallback((view: MapLibreGL.Map | null) => setRightView(view), [])
  useEffect(() => {
    if (!leftView || !rightView) return
    let disposed = false
    const mirror = () => {
      if (disposed || retiredMaps.has(leftView) || retiredMaps.has(rightView)) return
      rightView.jumpTo({
        center: leftView.getCenter(),
        zoom: leftView.getZoom(),
        bearing: leftView.getBearing(),
        pitch: leftView.getPitch(),
        roll: 0,
      })
    }
    const routeClick = (event: MapLibreGL.MapMouseEvent) => {
      if (disposed || retiredMaps.has(leftView) || retiredMaps.has(rightView)) return
      if ((event.point.x / leftView.getCanvas().clientWidth) * 100 < positionRef.current) return
      rightView.fire('click', { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent })
    }
    leftView.on('click', routeClick)
    leftView.on('move', mirror)
    leftView.on('resize', mirror)
    mirror()
    return () => {
      disposed = true
      leftView.off('click', routeClick)
      leftView.off('move', mirror)
      leftView.off('resize', mirror)
    }
  }, [leftView, rightView])
  return (
    <MapSwipe
      testId="editorial-swipe"
      leftLabel={leftLabel}
      rightLabel={rightLabel}
      onPositionChange={updatePosition}
      left={
        <EditorialMap resource={left} override={leftOverride} onViewReady={onLeftReady} acceptPopupPoint={acceptLeft} />
      }
      right={
        <EditorialMap
          resource={right}
          override={rightOverride ?? leftOverride}
          onViewReady={onRightReady}
          acceptPopupPoint={acceptRight}
          popupDisplayMap={leftView}
          featureViewport={leftView}
          passive
        />
      }
    />
  )
}

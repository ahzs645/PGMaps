import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type LayerSpecification } from 'maplibre-gl'
import { LidarControl } from 'maplibre-gl-lidar'
import 'maplibre-gl/dist/maplibre-gl.css'
import 'maplibre-gl-lidar/style.css'
import {
  initialLidarStyle,
  prepareVectorContext,
  installVectorContext,
  applyBasemap,
  VECTOR_STYLE_URL,
  type Basemap,
} from '../basemaps'
import { rasterPreview, rasterValue } from './raster'
import { featureName } from './vector'
import { hideNativeLoadSection } from './las'
import { loadPointSource, POINT_BUDGET } from './pointSource'
import { unionBounds } from './coordinates'
import type { ImportedLayer, ImportSession } from './types'
const EMPTY = { type: 'FeatureCollection' as const, features: [] }
const colour = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return 'hsl(' + (Math.abs(hash) % 360) + ',70%,48%)'
}
interface Props {
  session: ImportSession
  basemap: Basemap
  fit: number
  selected: string
  feature: number | null
  view3d: boolean
  onPick: (layer: string, index: number) => void
  onSample: (text: string) => void
  onPointStatus: (text: string) => void
}
export function ImportMap(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    latest = useRef(props),
    context = useRef<LayerSpecification[]>([]),
    installed = useRef(new Map<string, ImportedLayer>())
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [contextError, setContextError] = useState('')
  latest.current = props
  useEffect(() => {
    if (!container.current) return
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 20000)
    let instance: maplibregl.Map
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: initialLidarStyle(latest.current.basemap),
        center: [-122.812, 53.894],
        zoom: 13,
        maxPitch: 75,
        attributionControl: { compact: true },
      })
    } catch (e) {
      setError(String(e))
      return () => {
        clearTimeout(timer)
        abort.abort()
      }
    }
    map.current = instance
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    instance.on('error', (e) => {
      if (active) setError(e.error?.message ?? 'Map resource unavailable')
    })
    instance.on('load', () => {
      if (!active) return
      instance.addLayer({ id: 'analysis-height', type: 'background', paint: { 'background-opacity': 0 } })
      instance.addSource('import-selected', { type: 'geojson', data: EMPTY })
      instance.addLayer({
        id: 'import-selected-fill',
        type: 'fill',
        source: 'import-selected',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.2 },
      })
      instance.addLayer({
        id: 'import-selected-line',
        type: 'line',
        source: 'import-selected',
        paint: { 'line-color': '#ef4444', 'line-width': 3 },
      })
      instance.addLayer({
        id: 'import-selected-point',
        type: 'circle',
        source: 'import-selected',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#ef4444',
          'circle-opacity': 0.4,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      })
      setReady(true)
      fetch(VECTOR_STYLE_URL, { signal: abort.signal })
        .then(async (r) => {
          if (!r.ok) throw Error()
          return r.json()
        })
        .then((style) => {
          if (!active) return
          const prepared = prepareVectorContext(style)
          installVectorContext(instance, prepared)
          context.current = prepared.layers
          applyBasemap(instance, context.current, latest.current.basemap, true)
        })
        .catch(() => {
          if (active) setContextError('Vector provider unavailable; satellite and imported layers remain available.')
        })
        .finally(() => clearTimeout(timer))
    })
    instance.on('click', (event) => {
      const layers = latest.current.session.layers
        .filter((l) => l.visible && l.kind === 'vector')
        .flatMap((l) => ['-point', '-fill', '-line'].map((suffix) => 'import-' + l.id + suffix))
        .filter((id) => !!instance.getLayer(id))
      const hit = layers.length ? instance.queryRenderedFeatures(event.point, { layers })[0] : undefined
      if (hit) latest.current.onPick(String(hit.properties?._pg_layer), Number(hit.properties?._pg_index))
      else {
        const l = latest.current.session.layers.find((l) => l.id === latest.current.selected)
        if (l?.kind === 'raster' && l.visible) {
          const value = rasterValue(l, event.lngLat.lng, event.lngLat.lat)
          latest.current.onSample(
            l.name + ': ' + (value === null ? 'NoData / outside extent' : String(value)) + ' · native cell value',
          )
        }
      }
    })
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    return () => {
      active = false
      observer.disconnect()
      clearTimeout(timer)
      abort.abort()
      instance.remove()
      map.current = null
      installed.current.clear()
    }
  }, [])
  useEffect(() => {
    if (ready && map.current) applyBasemap(map.current, context.current, props.basemap, true)
  }, [ready, props.basemap])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    try {
      for (const id of installed.current.keys())
        if (!props.session.layers.some((l) => l.id === id)) {
          for (const suffix of ['-point', '-fill', '-line', '-raster']) {
            const key = 'import-' + id + suffix
            if (m.getLayer(key)) m.removeLayer(key)
          }
          if (m.getSource('import-' + id)) m.removeSource('import-' + id)
          installed.current.delete(id)
        }
      for (const layer of props.session.layers) {
        const id = 'import-' + layer.id
        if (!m.getSource(id)) {
          if (layer.kind === 'raster') {
            const image = rasterPreview(layer)
            m.addSource(id, {
              type: 'image',
              url: image.url,
              coordinates: image.coordinates as [
                [number, number],
                [number, number],
                [number, number],
                [number, number],
              ],
            })
            const before = props.session.layers.find(
              (l) => l.kind === 'vector' && m.getLayer('import-' + l.id + '-fill'),
            )
            m.addLayer(
              {
                id: id + '-raster',
                type: 'raster',
                source: id,
                paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
              },
              before ? 'import-' + before.id + '-fill' : 'import-selected-fill',
            )
          } else {
            const data = {
              ...layer.data,
              features: layer.data.features.map((f, i) => ({
                ...f,
                id: i,
                properties: {
                  ...f.properties,
                  _pg_index: i,
                  _pg_layer: layer.id,
                  _pg_colour: colour(layer.source.sha256 + ':' + featureName(f, i)),
                },
              })),
            }
            m.addSource(id, { type: 'geojson', data })
            m.addLayer(
              {
                id: id + '-fill',
                type: 'fill',
                source: id,
                filter: ['==', '$type', 'Polygon'],
                paint: { 'fill-color': ['get', '_pg_colour'], 'fill-opacity': 0.4 },
              },
              'import-selected-fill',
            )
            m.addLayer(
              {
                id: id + '-line',
                type: 'line',
                source: id,
                filter: ['!=', '$type', 'Point'],
                paint: { 'line-color': ['get', '_pg_colour'], 'line-width': 1.5 },
              },
              'import-selected-fill',
            )
            m.addLayer(
              {
                id: id + '-point',
                type: 'circle',
                source: id,
                filter: ['==', '$type', 'Point'],
                paint: {
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 18, 5],
                  'circle-color': ['get', '_pg_colour'],
                  'circle-stroke-color': '#fff',
                  'circle-stroke-width': 0.5,
                },
              },
              'import-selected-fill',
            )
          }
          installed.current.set(layer.id, layer)
        }
        for (const suffix of ['-point', '-fill', '-line', '-raster'])
          if (m.getLayer(id + suffix)) {
            m.setLayoutProperty(id + suffix, 'visibility', layer.visible ? 'visible' : 'none')
            m.setPaintProperty(
              id + suffix,
              suffix === '-point'
                ? 'circle-opacity'
                : suffix === '-fill'
                  ? 'fill-opacity'
                  : suffix === '-line'
                    ? 'line-opacity'
                    : 'raster-opacity',
              layer.opacity,
            )
          }
      }
    } catch (e) {
      setError(String(e))
    }
  }, [ready, props.session.layers])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const bounds = unionBounds(props.session.layers.filter((l) => l.visible).map((l) => l.bounds))
    if (bounds) m.fitBounds(bounds, { padding: 45, maxZoom: 20, duration: 0 })
  }, [ready, props.fit])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const l = props.session.layers.find((l) => l.id === props.selected)
    const f = l?.kind === 'vector' && l.visible && props.feature !== null ? l.data.features[props.feature] : null
    ;(m.getSource('import-selected') as GeoJSONSource).setData(f ? { type: 'FeatureCollection', features: [f] } : EMPTY)
  }, [ready, props.selected, props.feature, props.session.layers])
  useEffect(() => {
    if (ready && map.current) map.current.easeTo({ pitch: props.view3d ? 60 : 0, duration: 0 })
  }, [ready, props.view3d])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    let active = true
    const control = new LidarControl({
      title: 'GeoLibre · imported LiDAR',
      collapsed: true,
      panelWidth: 290,
      maxHeight: 440,
      closeOnOutsideClick: false,
      autoZoom: true,
      autoZOffset: true,
      pickable: true,
      pointBudget: POINT_BUDGET,
      streamingPointBudget: POINT_BUDGET,
      restoreFromUrl: false,
      shareUrl: false,
    })
    m.addControl(control, 'top-left')
    hideNativeLoadSection(control.getContainer())
    control.on('loaderror', (event) => {
      if (active) latest.current.onPointStatus(String(event.error ?? 'Point-cloud load failed'))
    })
    control.on('streamingprogress', () => {
      const progress = control.getStreamingProgress()
      if (active && progress)
        latest.current.onPointStatus(
          progress.loadedPoints.toLocaleString() + ' loaded points · streaming budget 750,000',
        )
    })
    control.on('pointclick', (event) => {
      if (active && event.point)
        latest.current.onPointStatus('Picked point: ' + JSON.stringify(event.point).slice(0, 1800))
    })
    const point = props.session.point
    latest.current.onPointStatus(
      point
        ? 'Loading ' + point.name + '…'
        : 'Choose a point cloud or the BC sample stream. GeoLibre styling and cross-sections are in the map control.',
    )
    if (point)
      loadPointSource(control, point)
        .then((info) => {
          if (active) {
            const fields = Object.keys(control.getPointCloudData(info.id)?.extraAttributes ?? {})
            latest.current.onPointStatus(
              info.name +
                ' · ' +
                info.pointCount.toLocaleString() +
                ' points · extra fields: ' +
                (fields.join(', ') || 'none reported'),
            )
          }
        })
        .catch((e) => {
          if (active) latest.current.onPointStatus(String(e))
        })
    return () => {
      active = false
      m.removeControl(control)
    }
  }, [ready, props.session.point?.id])
  return (
    <div className="relative h-full min-h-0" aria-label="Imported data map">
      <div ref={container} className="absolute inset-0" />
      {(error || contextError) && (
        <p role="alert" className="absolute bottom-2 left-2 right-12 rounded bg-background/95 p-2 text-xs">
          {error || contextError}
          <button
            className="ml-2 underline"
            onClick={() => {
              setError('')
              setContextError('')
            }}
          >
            Dismiss
          </button>
        </p>
      )}
    </div>
  )
}

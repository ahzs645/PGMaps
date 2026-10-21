import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type ImageSource, type LayerSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import {
  initialLidarStyle,
  prepareVectorContext,
  installVectorContext,
  applyBasemap,
  VECTOR_STYLE_URL,
  LABEL_ANCHOR,
  type Basemap,
} from '../basemaps'
import { treePointLayer } from '../treePointLayer'
import type { TreeCrop } from '../treeIsolation'
import { EMPTY_FEATURES } from './data'

/** Relative centres let cameras stay linked even for two different crown locations. */
export interface ComparisonCamera {
  dx: number
  dy: number
  zoom: number
  bearing: number
  pitch: number
}
export function sameCamera(a: ComparisonCamera | null | undefined, b: ComparisonCamera) {
  return (
    !!a &&
    Math.abs(a.dx - b.dx) < 1e-8 &&
    Math.abs(a.dy - b.dy) < 1e-8 &&
    Math.abs(a.zoom - b.zoom) < 1e-5 &&
    Math.abs(a.pitch - b.pitch) < 1e-4 &&
    Math.abs(a.bearing - b.bearing) < 1e-4
  )
}
interface Props {
  label: string
  centre: [number, number]
  focusKey: string
  zoom?: number
  bounds?: [number, number, number, number]
  view: 'top' | '3d'
  basemap: Basemap
  crop?: TreeCrop | null
  assignments?: Record<string, string>
  features?: FeatureCollection
  references?: FeatureCollection
  image?: { url: string; coordinates: [number, number][] }
  camera?: ComparisonCamera | null
  onCamera?: (camera: ComparisonCamera) => void
  pointSize?: number
  overlayOpacity?: number
  onFeaturePick?: (id: string) => void
  onReferencePick?: (id: string) => void
}
export function ComparisonMap(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    latest = useRef(props),
    applying = useRef(false)
  const context = useRef<LayerSpecification[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState('')
  latest.current = props
  useEffect(() => {
    if (!container.current) return
    let active = true,
      instance: maplibregl.Map
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 20000)
    try {
      const p = latest.current
      const style = initialLidarStyle(p.basemap)
      style.layers.splice(style.layers.length - 1, 0, {
        id: 'analysis-height',
        type: 'background',
        paint: { 'background-opacity': 0 },
      })
      instance = new maplibregl.Map({
        container: container.current,
        style,
        center: p.centre,
        zoom: p.zoom ?? 19,
        pitch: p.view === '3d' ? 50 : 0,
        maxPitch: 75,
        attributionControl: { compact: true },
      })
    } catch (e) {
      setError(`Map unavailable: ${String(e)}`)
      return () => {
        abort.abort()
        clearTimeout(timer)
      }
    }
    map.current = instance
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    instance.on('error', (e) => {
      if (active) setError(e.error?.message ?? 'A map resource failed to load')
    })
    instance.on('load', () => {
      if (!active) return
      for (const [id, colour] of [
        ['comparison-output', '#f59e0b'],
        ['comparison-reference', '#06b6d4'],
      ] as const) {
        instance.addSource(id, { type: 'geojson', data: EMPTY_FEATURES })
        instance.addLayer(
          {
            id: `${id}-fill`,
            type: 'fill',
            source: id,
            paint: {
              'fill-color': ['coalesce', ['get', 'colour'], colour],
              'fill-opacity': id === 'comparison-reference' ? 0 : 0.25,
            },
          },
          LABEL_ANCHOR,
        )
        instance.addLayer(
          {
            id: `${id}-line`,
            type: 'line',
            source: id,
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'selected'], true],
                '#111827',
                ['coalesce', ['get', 'colour'], colour],
              ],
              'line-width': ['case', ['==', ['get', 'selected'], true], 3, 1.5],
            },
          },
          LABEL_ANCHOR,
        )
        instance.addLayer(
          {
            id: `${id}-tops`,
            type: 'circle',
            source: id,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': 3,
              'circle-color': colour,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
            },
          },
          LABEL_ANCHOR,
        )
      }
      instance.on('click', 'comparison-output-fill', (event) => {
        const p = event.features?.[0]?.properties
        if (typeof p?.id === 'string' && latest.current.onFeaturePick) {
          latest.current.onFeaturePick(p.id)
          return
        }
        if (p)
          new maplibregl.Popup()
            .setLngLat(event.lngLat)
            .setText(
              `${p.id ?? p.part ?? 'Output'}${typeof p.score === 'number' ? ` · score ${p.score.toFixed(3)}` : ''}`,
            )
            .addTo(instance)
      })
      instance.on('click', 'comparison-reference-tops', (event) => {
        const p = event.features?.[0]?.properties
        if (typeof p?.id === 'string') latest.current.onReferencePick?.(p.id)
      })
      setReady(true)
      fetch(VECTOR_STYLE_URL, { signal: abort.signal })
        .then((r) => {
          if (!r.ok) throw Error('Vector context unavailable')
          return r.json()
        })
        .then((style) => {
          if (!active) return
          const vector = prepareVectorContext(style)
          installVectorContext(instance, vector)
          context.current = vector.layers
          applyBasemap(instance, context.current, latest.current.basemap, true)
        })
        .catch((e) => {
          if (active) setError(`Context unavailable; model output retained. ${String(e)}`)
        })
        .finally(() => clearTimeout(timer))
    })
    instance.on('moveend', () => {
      if (applying.current) return
      const p = latest.current,
        c = instance.getCenter()
      p.onCamera?.({
        dx: c.lng - p.centre[0],
        dy: c.lat - p.centre[1],
        zoom: instance.getZoom(),
        bearing: instance.getBearing(),
        pitch: instance.getPitch(),
      })
    })
    const resize = new ResizeObserver(() => instance.resize())
    resize.observe(container.current)
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
      resize.disconnect()
      instance.remove()
      map.current = null
      context.current = []
    }
  }, [])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    applyBasemap(m, context.current, props.basemap, true)
  }, [ready, props.basemap])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    ;(m.getSource('comparison-output') as GeoJSONSource).setData(props.features ?? EMPTY_FEATURES)
    ;(m.getSource('comparison-reference') as GeoJSONSource).setData(props.references ?? EMPTY_FEATURES)
    m.setPaintProperty('comparison-output-fill', 'fill-opacity', props.overlayOpacity ?? 0.25)
  }, [ready, props.features, props.references, props.overlayOpacity])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    if (m.getLayer('analysis-tree-points')) m.removeLayer('analysis-tree-points')
    if (props.crop)
      m.addLayer(
        treePointLayer(props.crop, {
          colour: props.assignments ? 'segment' : 'height',
          assignments: props.assignments,
          pointSize: props.pointSize ?? 2,
        }),
      )
  }, [ready, props.crop, props.assignments, props.pointSize])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const id = 'comparison-image'
    if (props.image) {
      const coordinates = props.image.coordinates as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ]
      if (m.getSource(id)) (m.getSource(id) as ImageSource).updateImage({ url: props.image.url, coordinates })
      else {
        m.addSource(id, { type: 'image', url: props.image.url, coordinates })
        m.addLayer(
          { id, type: 'raster', source: id, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } },
          'comparison-output-fill',
        )
      }
    } else if (m.getSource(id)) {
      m.removeLayer(id)
      m.removeSource(id)
    }
  }, [ready, props.image])
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    applying.current = true
    if (props.bounds)
      m.fitBounds(props.bounds, {
        padding: 20,
        maxZoom: props.zoom ?? 19,
        pitch: props.view === '3d' ? 50 : 0,
        bearing: 0,
        duration: 0,
      })
    else m.jumpTo({ center: props.centre, zoom: props.zoom ?? 19, pitch: props.view === '3d' ? 50 : 0, bearing: 0 })
    applying.current = false
    // focusKey deliberately owns re-fitting; model/point styling updates retain the user's camera.
  }, [ready, props.focusKey, props.view, props.bounds])
  useEffect(() => {
    const m = map.current,
      c = props.camera
    if (!ready || !m || !c) return
    const ll = m.getCenter(),
      current = {
        dx: ll.lng - props.centre[0],
        dy: ll.lat - props.centre[1],
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
      }
    if (sameCamera(current, c)) return
    applying.current = true
    m.jumpTo({
      center: [props.centre[0] + c.dx, props.centre[1] + c.dy],
      zoom: c.zoom,
      bearing: c.bearing,
      pitch: c.pitch,
    })
    applying.current = false
  }, [ready, props.camera, props.centre])
  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={container} className="absolute inset-0" aria-label={props.label} />
      {error && (
        <p className="absolute bottom-8 left-2 right-12 rounded bg-background/95 p-2 text-[10px]" role="status">
          {error}
        </p>
      )}
    </div>
  )
}

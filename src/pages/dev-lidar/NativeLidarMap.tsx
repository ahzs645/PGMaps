import { useEffect, useRef, useState } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { LidarControl, type ColorSchemeType } from 'maplibre-gl-lidar'
import 'maplibre-gl/dist/maplibre-gl.css'
import 'maplibre-gl-lidar/style.css'
import type { AnalysisSummary, RasterKey } from './types'
import { heightAtLocation } from './data'

interface Props {
  summary: AnalysisSummary
  analysisBase: string
  cloudUrl: string
  raster: RasterKey
  trees: boolean
  buildings: boolean
  reference: boolean
  cloud: boolean
  minTreeHeight: number
  focus: { index: number; revision: number }
  color: ColorSchemeType
}

export function NativeLidarMap(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const lidar = useRef<LidarControl | null>(null)
  const cloudId = useRef<string | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('Loading map and analysis layers…')
  const [error, setError] = useState('')
  const [height, setHeight] = useState<string | null>(null)
  const loadingCloud = useRef(false)

  useEffect(() => {
    if (!container.current) return
    let active = true
    let samples: Float32Array | null = null
    const abort = new AbortController()
    let instance: MapLibreMap
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors',
            },
          },
          layers: [
            { id: 'base', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.9, 'raster-opacity': 0.42 } },
          ],
        },
        bounds: [
          [props.summary.bounds_wgs84[0], props.summary.bounds_wgs84[1]],
          [props.summary.bounds_wgs84[2], props.summary.bounds_wgs84[3]],
        ],
        fitBoundsOptions: { padding: 35 },
        maxPitch: 75,
        attributionControl: { compact: true },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WebGL map could not start')
      return
    }
    map.current = instance
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    instance.on('error', (event) => {
      if (active) setError(event.error?.message ?? 'A map resource could not load')
    })
    instance.on('load', () => {
      if (!active) return
      for (const [key, layer] of Object.entries(props.summary.rasters)) {
        instance.addSource(`analysis-${key}`, {
          type: 'image',
          url: new URL(layer.file, props.analysisBase).href,
          coordinates: props.summary.image_coordinates as [
            [number, number],
            [number, number],
            [number, number],
            [number, number],
          ],
        })
        instance.addLayer({
          id: `analysis-${key}`,
          type: 'raster',
          source: `analysis-${key}`,
          layout: { visibility: key === latest.current.raster ? 'visible' : 'none' },
          paint: {
            'raster-opacity': 0.94,
            'raster-resampling': key === 'crowns' ? 'nearest' : 'linear',
            'raster-fade-duration': 0,
          },
        })
      }
      instance.addSource('roof-candidates', {
        type: 'geojson',
        data: new URL('building-candidates.geojson', props.analysisBase).href,
      })
      instance.addLayer({
        id: 'roofs-fill',
        type: 'fill',
        source: 'roof-candidates',
        layout: { visibility: latest.current.buildings ? 'visible' : 'none' },
        paint: { 'fill-color': '#ffb347', 'fill-opacity': 0.3 },
      })
      instance.addLayer({
        id: 'roofs-line',
        type: 'line',
        source: 'roof-candidates',
        layout: { visibility: latest.current.buildings ? 'visible' : 'none' },
        paint: { 'line-color': '#ffb347', 'line-width': 2 },
      })
      instance.addSource('tree-candidates', {
        type: 'geojson',
        data: new URL('tree-candidates.geojson', props.analysisBase).href,
      })
      instance.addLayer({
        id: 'trees',
        type: 'circle',
        source: 'tree-candidates',
        layout: { visibility: latest.current.trees ? 'visible' : 'none' },
        filter: ['>=', ['get', 'height_m'], latest.current.minTreeHeight],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.3, 17, 4.2, 20, 7],
          'circle-color': '#e9ffac',
          'circle-stroke-color': '#284b25',
          'circle-stroke-width': 0.7,
          'circle-opacity': 0.92,
        },
      })
      instance.addSource('reference-trees', {
        type: 'geojson',
        data: new URL('geolibre-tree-reference.geojson', props.analysisBase).href,
      })
      instance.addSource('reference-area', {
        type: 'geojson',
        data: new URL('reference-area.geojson', props.analysisBase).href,
      })
      instance.addLayer({
        id: 'reference-area',
        type: 'line',
        source: 'reference-area',
        layout: { visibility: latest.current.reference ? 'visible' : 'none' },
        paint: { 'line-color': '#e052d2', 'line-width': 2, 'line-dasharray': [3, 2] },
      })
      instance.addLayer({
        id: 'reference-trees',
        type: 'circle',
        source: 'reference-trees',
        layout: { visibility: latest.current.reference ? 'visible' : 'none' },
        paint: {
          'circle-color': '#e052d2',
          'circle-radius': 4.5,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
        },
      })
      const control = new LidarControl({
        title: 'Point cloud · advanced',
        collapsed: true,
        autoZoom: false,
        autoZOffset: true,
        pointSize: 2,
        pickable: true,
        streamingPointBudget: 750_000,
        streamingMaxConcurrentRequests: 4,
        colorScheme: latest.current.color,
      })
      instance.addControl(control, 'top-left')
      lidar.current = control
      control.on('loaderror', (event) => {
        if (active) setError(String(event.error ?? 'Point-cloud loading failed'))
      })
      control.on('streamingprogress', () => {
        const progress = control.getStreamingProgress()
        if (active && latest.current.cloud && progress)
          setStatus(`3D points stream as you explore · display budget 750,000 points`)
      })
      setReady(true)
      setStatus('Native MapLibre viewer · processed layers at 1 m source resolution')
    })
    fetch(new URL(props.summary.sample_grid.file, props.analysisBase), { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error('Height samples unavailable')
        return r.arrayBuffer()
      })
      .then((buffer) => {
        samples = new Float32Array(buffer)
      })
      .catch(() => {})
    instance.on('click', (event) => {
      if (!active) return
      const features = instance.getStyle()?.layers?.some((l) => l.id === 'trees')
        ? instance.queryRenderedFeatures(event.point, { layers: ['trees', 'roofs-fill', 'reference-trees'] })
        : []
      if (features.length) {
        const feature = features[0]
        const p = feature.properties ?? {}
        const content = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent =
          feature.layer.id === 'trees'
            ? 'Crown candidate'
            : feature.layer.id === 'reference-trees'
              ? 'GeoLibre tree-test candidate'
              : 'Roof-like patch'
        const detail = document.createElement('p')
        detail.textContent = `Height ${Number(p.height_m).toFixed(1)} m${p.crown_area_m2 || p.area_m2 ? ` · area ${Number(p.crown_area_m2 ?? p.area_m2).toFixed(0)} m²` : ' · GeoLibre integer-Z attribute'}. Unvalidated candidate.`
        content.append(title, detail)
        new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(instance)
      }
      if (samples) {
        const value = heightAtLocation(samples, props.summary.sample_grid, event.lngLat.lng, event.lngLat.lat)
        setHeight(
          value !== null
            ? `${value.toFixed(1)} m above terrain · resampled web-grid value`
            : 'No supported height value at this location',
        )
      }
    })
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    return () => {
      active = false
      abort.abort()
      observer.disconnect()
      lidar.current = null
      map.current = null
      instance.remove()
    }
  }, [props.analysisBase, props.summary])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    for (const key of Object.keys(props.summary.rasters))
      instance.setLayoutProperty(`analysis-${key}`, 'visibility', key === props.raster ? 'visible' : 'none')
    instance.setLayoutProperty('trees', 'visibility', props.trees ? 'visible' : 'none')
    instance.setFilter('trees', ['>=', ['get', 'height_m'], props.minTreeHeight])
    for (const id of ['reference-trees', 'reference-area'])
      instance.setLayoutProperty(id, 'visibility', props.reference ? 'visible' : 'none')
    for (const id of ['roofs-fill', 'roofs-line'])
      instance.setLayoutProperty(id, 'visibility', props.buildings ? 'visible' : 'none')
  }, [ready, props.raster, props.trees, props.buildings, props.reference, props.minTreeHeight, props.summary])

  useEffect(() => {
    const control = lidar.current
    if (!ready || !control) return
    control.setColorScheme(props.color)
    control.setOpacity(props.cloud ? 1 : 0)
    if (cloudId.current) {
      if (props.cloud) control.resumeStreaming(cloudId.current)
      else control.pauseStreaming(cloudId.current)
    }
    if (props.cloud && !cloudId.current && !loadingCloud.current) {
      loadingCloud.current = true
      setStatus('Loading the original full-resolution cloud…')
      control
        .loadPointCloud(props.cloudUrl)
        .then((info) => {
          if (lidar.current !== control) return
          cloudId.current = info.id
          loadingCloud.current = false
          if (!latest.current.cloud) {
            control.setOpacity(0)
            control.pauseStreaming(info.id)
          } else map.current?.easeTo({ pitch: 50, duration: 700 })
        })
        .catch((e) => {
          if (lidar.current === control) {
            loadingCloud.current = false
            setError(String(e))
          }
        })
    }
  }, [ready, props.cloud, props.cloudUrl, props.color])

  useEffect(() => {
    if (!ready || !map.current) return
    const place = props.summary.highlights[props.focus.index]
    if (place) map.current.easeTo({ center: place.center, zoom: place.zoom, pitch: 0, duration: 900 })
    else
      map.current.fitBounds(
        [
          [props.summary.bounds_wgs84[0], props.summary.bounds_wgs84[1]],
          [props.summary.bounds_wgs84[2], props.summary.bounds_wgs84[3]],
        ],
        { padding: 35, pitch: 0 },
      )
  }, [ready, props.focus, props.summary])

  return (
    <div className="relative h-full min-h-[460px] overflow-hidden rounded-lg">
      <div ref={container} className="absolute inset-0" aria-label="Interactive native LiDAR analysis map" />
      <div
        className="pointer-events-none absolute bottom-9 left-3 right-14 rounded bg-background/90 px-3 py-2 text-xs text-foreground shadow"
        role="status"
      >
        {height ?? status}
      </div>
      {error && (
        <div
          className="absolute bottom-24 left-3 right-3 rounded border border-amber-500 bg-background/95 p-3 text-xs"
          role="alert"
        >
          {error}
          <button className="ml-3 underline" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

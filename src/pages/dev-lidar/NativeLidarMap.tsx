import { useEffect, useRef, useState } from 'react'
import maplibregl, { type LayerSpecification, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import { LidarControl, type ColorSchemeType } from 'maplibre-gl-lidar'
import 'maplibre-gl/dist/maplibre-gl.css'
import 'maplibre-gl-lidar/style.css'
import type { AnalysisSummary, RasterKey } from './types'
import { heightAtLocation } from './data'
import { applyAnalysisLayers, applyPointCloudVisibility } from './mapLayers'
import { installWorkflowLayers, applyWorkflowLayers, WORKFLOW_LAYERS } from './workflowMapLayers'
import { buildingMeshLayer } from './buildingMesh'
import type { BuildingModel, WorkflowFeature, WorkflowOptions } from './analysisWorkflows'
import { sceneOffset } from './roofInspection'
import {
  applyBasemap,
  installVectorContext,
  initialLidarStyle,
  LABEL_ANCHOR,
  prepareVectorContext,
  VECTOR_STYLE_URL,
  type Basemap,
} from './basemaps'

interface Props {
  workflowOptions: WorkflowOptions
  workflowFeatures: WorkflowFeature[]
  selectedWorkflowId: string | null
  onWorkflowSelect: (id: string) => void
  buildingModel: BuildingModel | null
  modelActive: boolean
  summary: AnalysisSummary
  analysisBase: string
  cloudUrl: string
  raster: RasterKey
  trees: boolean
  buildings: boolean
  reference: boolean
  cloud: boolean
  minTreeHeight: number
  focus: { index: number; revision: number; center?: [number, number]; zoom?: number }
  color: ColorSchemeType
  toolsOpen: boolean
  onToolsOpenChange: (open: boolean) => void
  basemap: Basemap
  surfaceVisible: boolean
  surfaceOpacity: number
  labels: boolean
  sceneGround: number | null
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
  const contextLayers = useRef<LayerSpecification[]>([])
  const [contextError, setContextError] = useState('')

  useEffect(() => {
    if (!container.current) return
    let active = true
    let samples: Float32Array | null = null
    const abort = new AbortController()
    const contextAbort = new AbortController()
    let contextTimeout: number | undefined
    let instance: MapLibreMap
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: initialLidarStyle(latest.current.basemap),
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
        instance.addLayer(
          {
            id: `analysis-${key}`,
            type: 'raster',
            source: `analysis-${key}`,
            layout: { visibility: latest.current.surfaceVisible && key === latest.current.raster ? 'visible' : 'none' },
            paint: {
              'raster-opacity': latest.current.surfaceOpacity,
              'raster-resampling': key === 'crowns' ? 'nearest' : 'linear',
              'raster-fade-duration': 0,
            },
          },
          LABEL_ANCHOR,
        )
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
      installWorkflowLayers(instance)
      const control = new LidarControl({
        title: 'GeoLibre · 3D LiDAR',
        collapsed: !latest.current.toolsOpen,
        panelWidth: 290,
        closeOnOutsideClick: false,
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
      control.on('expand', () => {
        if (active) latest.current.onToolsOpenChange(true)
      })
      control.on('collapse', () => {
        if (active) latest.current.onToolsOpenChange(false)
      })
      control.on('loaderror', (event) => {
        if (active) setError(String(event.error ?? 'Point-cloud loading failed'))
      })
      control.on('streamingprogress', () => {
        const progress = control.getStreamingProgress()
        if (active && latest.current.cloud && progress)
          setStatus(
            `Original points · ${latest.current.sceneGround === null ? 'whole-tile origin' : `local ground origin ${latest.current.sceneGround.toFixed(1)} m`} · budget 750,000`,
          )
      })
      setReady(true)
      setStatus('Native MapLibre viewer · processed layers at 1 m source resolution')
      // Fetch context independently: a provider outage must not block the LiDAR workspace.
      contextTimeout = window.setTimeout(() => contextAbort.abort(), 20_000)
      fetch(VECTOR_STYLE_URL, { signal: contextAbort.signal })
        .then(async (response) => {
          if (!response.ok) throw Error(`Vector basemap returned ${response.status}`)
          return prepareVectorContext((await response.json()) as StyleSpecification)
        })
        .then((context) => {
          if (!active) return
          installVectorContext(instance, context)
          contextLayers.current = context.layers
          applyBasemap(instance, context.layers, latest.current.basemap, latest.current.labels)
          setContextError('')
        })
        .catch(() => {
          if (active)
            setContextError('Vector context unavailable. Satellite is still available; LiDAR layers remain loaded.')
        })
        .finally(() => window.clearTimeout(contextTimeout))
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
      const workflowHits = instance.getLayer('workflow-gaps')
        ? instance.queryRenderedFeatures(event.point, {
            layers: WORKFLOW_LAYERS.filter((id) => id !== 'workflow-selected'),
          })
        : []
      if (workflowHits[0]?.properties?.id) latest.current.onWorkflowSelect(String(workflowHits[0].properties.id))
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
      contextAbort.abort()
      window.clearTimeout(contextTimeout)
      observer.disconnect()
      lidar.current = null
      contextLayers.current = []
      map.current = null
      instance.remove()
    }
  }, [props.analysisBase, props.summary])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    applyAnalysisLayers(instance, Object.keys(props.summary.rasters), props)
  }, [
    ready,
    props.raster,
    props.surfaceVisible,
    props.surfaceOpacity,
    props.trees,
    props.buildings,
    props.reference,
    props.minTreeHeight,
    props.summary,
  ])

  useEffect(() => {
    if (!ready || !map.current) return
    applyWorkflowLayers(map.current, props.workflowOptions, props.workflowFeatures, props.selectedWorkflowId)
  }, [ready, props.workflowOptions, props.workflowFeatures, props.selectedWorkflowId])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    if (instance.getLayer('analysis-building-model')) instance.removeLayer('analysis-building-model')
    if (props.buildingModel) {
      try {
        instance.addLayer(buildingMeshLayer(props.buildingModel, -sceneOffset(props.sceneGround)))
      } catch (e) {
        setError(`Building mesh could not render: ${String(e)}`)
      }
    }
  }, [ready, props.buildingModel, props.sceneGround])

  useEffect(() => {
    if (ready && map.current) applyBasemap(map.current, contextLayers.current, props.basemap, props.labels)
  }, [ready, props.basemap, props.labels])

  useEffect(() => {
    const control = lidar.current
    if (!ready || !control) return
    control.setZOffsetEnabled(true)
    control.setZOffset(sceneOffset(props.sceneGround))
  }, [ready, props.sceneGround])

  useEffect(() => {
    const control = lidar.current
    if (!ready || !control) return
    control.setColorScheme(props.color)
    applyPointCloudVisibility(control, cloudId.current, props.cloud)
    if (props.cloud && !cloudId.current && !loadingCloud.current) {
      loadingCloud.current = true
      setStatus('Loading the original full-resolution cloud…')
      control
        .loadPointCloud(props.cloudUrl)
        .then((info) => {
          if (lidar.current !== control) return
          cloudId.current = info.id
          loadingCloud.current = false
          // Loading can replace the native automatic offset; restore the current local origin.
          control.setZOffsetEnabled(true)
          control.setZOffset(sceneOffset(latest.current.sceneGround))
          applyPointCloudVisibility(control, info.id, latest.current.cloud)
          if (latest.current.cloud) map.current?.easeTo({ pitch: 50, duration: 700 })
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
    if (!ready) return
    if (props.cloud && props.toolsOpen) lidar.current?.expand()
    else lidar.current?.collapse()
  }, [ready, props.cloud, props.toolsOpen])

  useEffect(() => {
    if (!ready) return
    setHeight(null)
    setStatus(
      props.cloud
        ? `Original points · ${props.sceneGround === null ? 'whole-tile' : `local ground ${props.sceneGround.toFixed(1)} m`} viewing origin · budget 750,000`
        : props.modelActive
          ? 'Experimental Roofer model · amber roofs / blue walls · unverified patch input'
          : 'Processed layers · click to sample height',
    )
    map.current?.easeTo({ pitch: props.cloud || props.modelActive ? 50 : 0, duration: 700 })
  }, [ready, props.cloud, props.modelActive, props.sceneGround])

  useEffect(() => {
    if (!ready || !map.current) return
    const place = props.summary.highlights[props.focus.index]
    if (props.focus.center)
      map.current.easeTo({
        center: props.focus.center,
        zoom: props.focus.zoom ?? 18,
        pitch: latest.current.cloud || latest.current.modelActive ? 50 : 0,
        duration: 900,
      })
    else if (place)
      map.current.easeTo({
        center: place.center,
        zoom: place.zoom,
        pitch: latest.current.cloud || latest.current.modelActive ? 50 : 0,
        duration: 900,
      })
    else
      map.current.fitBounds(
        [
          [props.summary.bounds_wgs84[0], props.summary.bounds_wgs84[1]],
          [props.summary.bounds_wgs84[2], props.summary.bounds_wgs84[3]],
        ],
        { padding: 35, pitch: latest.current.cloud || latest.current.modelActive ? 50 : 0 },
      )
  }, [ready, props.focus, props.summary])

  return (
    <div className="relative h-full min-h-0 overflow-hidden" data-lidar-map>
      <div ref={container} className="absolute inset-0" aria-label="Interactive native LiDAR analysis map" />
      <div
        className="pointer-events-none absolute bottom-9 left-3 right-14 truncate rounded bg-background/90 px-2 py-1 text-[10px] text-foreground shadow"
        role="status"
        title={height ?? status}
      >
        {height ?? status}
      </div>
      {error && (
        <div
          className="absolute bottom-20 left-3 right-3 max-h-[40%] overflow-y-auto overscroll-contain rounded border border-amber-500 bg-background/95 p-3 text-xs"
          role="alert"
        >
          {error}
          <button className="ml-3 underline" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
      {contextError && props.basemap === 'vector' && (
        <div role="status" className="absolute left-3 right-14 top-3 rounded border bg-background/95 p-2 text-[10px]">
          {contextError}
        </div>
      )}
    </div>
  )
}

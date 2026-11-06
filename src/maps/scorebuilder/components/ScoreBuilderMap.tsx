import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapTableBridge, type MapTableController } from '@/components/map/useMapTable'
import { Map as PgMap, MapClusterLayer, MapScaleBar, type MapRef } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { PG_CENTER, PG_DEFAULT_ZOOM } from '@/components/ui/map-styles'
import { hexToRgbaArray } from '@/lib/color'
import { escapeHtml } from '@/lib/escapeHtml'
import { useMap } from '@/components/ui/map'
import { useJsonManifest } from '@/maps/pgdata/shared'
import {
  WALKABILITY_HEATMAP_MANIFEST_PATH,
  WALKABILITY_MI_BAND_COLORS,
  WALKABILITY_MI_GRID_FALLBACK_PATH,
} from '@/maps/pgdata/walkabilityMiBands'
import type { AirMonitor } from '@/maps/airquality'
import { resolveWalkabilitySurfaceModel, type WalkabilitySurfaceTuning } from '../lib/walkabilitySurface'
import type { ScoreMetricWeightMap, ScoredBoundaryRegion } from '../types'

interface ScoreBuilderMapProps {
  regions: ScoredBoundaryRegion[]
  selectedRegionId: string | null
  monitors: AirMonitor[]
  showPoints: boolean
  onRegionClick: (regionId: string) => void
  regionFillColors?: Record<string, string> | null
  walkabilitySourceSurface?: boolean
  sourceGridWeights?: ScoreMetricWeightMap
  walkabilitySurfaceTuning?: WalkabilitySurfaceTuning
  loading?: boolean
  onMapInstance?: (map: MapRef | null) => void
  /** Bounds of the whole study area; the map frames them when nothing is selected. */
  studyAreaBounds?: [number, number, number, number] | null
  /** Study-area regions without enough data to rank, drawn so the area does not look empty. */
  unrankedRegions?: ScoredBoundaryRegion[]
  /** Hover text per region id, as HTML the caller has already escaped. */
  regionTooltips?: Record<string, string>
  /** The Explore view's table. The Build view and project previews have none. */
  table?: MapTableController
}

interface WalkabilityHeatmapManifest {
  citywideGrid?: { path?: string | null } | null
}

interface WalkabilityGridData {
  rows: number
  cols: number
  imageCoordinates: [[number, number], [number, number], [number, number], [number, number]]
  bandColors?: Record<string, string>
  defaultVariant: string
  grids: Record<string, Array<[number, number]>>
}

interface WalkabilityLiveGrid {
  rows: number
  cols: number
  imageCoordinates: [[number, number], [number, number], [number, number], [number, number]]
  rle: Array<[number, number]>
}

interface WalkabilityLiveGridState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  requestKey: string
  grid: WalkabilityLiveGrid | null
}

const ZOOM = PG_DEFAULT_ZOOM
const NO_REGIONS: ScoredBoundaryRegion[] = []

function regionTooltip(properties: Record<string, unknown>): string | null {
  return typeof properties.tooltip === 'string' ? properties.tooltip : null
}

function unrankedTooltip(properties: Record<string, unknown>): string {
  return `<strong>${escapeHtml(String(properties.name ?? ''))}</strong><br />Not ranked: too little data`
}

export function ScoreBuilderMap({
  regions,
  selectedRegionId,
  monitors,
  showPoints,
  onRegionClick,
  regionFillColors = null,
  walkabilitySourceSurface = false,
  sourceGridWeights,
  walkabilitySurfaceTuning,
  loading = false,
  onMapInstance,
  studyAreaBounds = null,
  unrankedRegions = NO_REGIONS,
  regionTooltips,
  table,
}: ScoreBuilderMapProps) {
  const mapRef = useRef<MapRef | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const setMapRef = useCallback(
    (instance: MapRef | null) => {
      mapRef.current = instance
      setMapReady(instance !== null)
      onMapInstance?.(instance)
    },
    [onMapInstance],
  )

  const featureCollection = useMemo<
    GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, GeoJSON.GeoJsonProperties>
  >(() => {
    return {
      type: 'FeatureCollection',
      features: regions.map((entry) => ({
        type: 'Feature',
        geometry: entry.region.feature.geometry,
        properties: {
          id: entry.region.id,
          code: entry.region.code,
          name: entry.region.name,
          score: entry.score,
          scoreColor: regionFillColors?.[entry.region.id] ?? entry.scoreColor,
          tooltip: regionTooltips?.[entry.region.id],
          monitorCount: entry.counts.monitorCount,
          density: entry.metrics.overallDensity,
        },
      })),
    }
  }, [regions, regionFillColors, regionTooltips])

  const unrankedCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: unrankedRegions.map((entry) => ({
        type: 'Feature',
        geometry: entry.region.feature.geometry,
        properties: { id: entry.region.id, name: entry.region.name },
      })),
    }),
    [unrankedRegions],
  )

  const points = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, GeoJSON.GeoJsonProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: monitors.map((monitor) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [monitor.longitude, monitor.latitude],
        },
        properties: {
          id: monitor.id,
          network: monitor.network,
          name: monitor.name,
        },
      })),
    }
  }, [monitors])

  // A string, so editing a weight (which rebuilds `regions`) does not move the map.
  const selectedBounds = regions.find((entry) => entry.region.id === selectedRegionId)?.region.bounds
  const frame = selectedBounds ? selectedBounds.join(',') : studyAreaBounds?.join(',')
  const framesSelection = Boolean(selectedBounds)
  const framedOnce = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !frame) return
    const [west, south, east, north] = frame.split(',').map(Number)
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      framesSelection
        ? // Above the default zoom: a neighbourhood must get larger when it is selected.
          { padding: 80, duration: 500, maxZoom: 14 }
        : { padding: 36, duration: framedOnce.current ? 500 : 0, maxZoom: 13 },
    )
    framedOnce.current = true
  }, [frame, framesSelection, mapReady])

  return (
    <div className="h-full w-full">
      <PgMap ref={setMapRef} center={PG_CENTER} zoom={ZOOM} loading={loading} deferResize={table?.deferResize}>
        {table && <MapTableBridge table={table} />}
        <MapScaleBar position="bottom-left" />
        {walkabilitySourceSurface && (
          <ScoreBuilderWalkabilitySourceGrid weights={sourceGridWeights} tuning={walkabilitySurfaceTuning} />
        )}

        {unrankedCollection.features.length > 0 && !walkabilitySourceSurface && (
          <MapFillLayer
            data={unrankedCollection}
            fillColor="#94a3b8"
            fillOpacity={0.14}
            lineColor="#64748b"
            lineWidth={0.6}
            lineOpacity={0.5}
            hoverHtml={unrankedTooltip}
          />
        )}

        <MapFillLayer
          data={featureCollection}
          fillColor={['coalesce', ['get', 'scoreColor'], '#475569']}
          fillOpacity={walkabilitySourceSurface ? 0 : 0.72}
          hoverHtml={regionTooltip}
          hoverFillOpacity={walkabilitySourceSurface ? 0 : 0.88}
          lineColor="#0f172a"
          lineWidth={0.7}
          lineOpacity={walkabilitySourceSurface ? 0 : 0.45}
          selectedId={selectedRegionId}
          onFeatureClick={onRegionClick}
        />

        {showPoints && points.features.length > 0 && (
          <MapClusterLayer
            data={points}
            clusterRadius={40}
            clusterThresholds={[40, 180]}
            clusterColors={['#38bdf8', '#22c55e', '#f59e0b']}
            pointColor="#0ea5e9"
          />
        )}
      </PgMap>
    </div>
  )
}

function ScoreBuilderWalkabilitySourceGrid({
  weights,
  tuning,
}: {
  weights?: ScoreMetricWeightMap
  tuning?: WalkabilitySurfaceTuning
}) {
  const { map, isLoaded } = useMap()
  // Grid path follows the heatmap manifest, like the Walkability tab, so a
  // regenerated grid is picked up without touching this component.
  const heatmapManifest = useJsonManifest<WalkabilityHeatmapManifest>(WALKABILITY_HEATMAP_MANIFEST_PATH)
  const grid = useJsonManifest<WalkabilityGridData>(
    heatmapManifest.data?.citywideGrid?.path || WALKABILITY_MI_GRID_FALLBACK_PATH,
  )
  const sourceId = 'score-builder-walkability-source-grid'
  const layerId = 'score-builder-walkability-source-grid-layer'
  const { factorWeights, options } = useMemo(() => resolveWalkabilitySurfaceModel(tuning, weights), [tuning, weights])
  const liveRequestKey = useMemo(() => JSON.stringify({ options, factorWeights }), [factorWeights, options])
  const [liveGrid, setLiveGrid] = useState<WalkabilityLiveGridState>({
    status: 'idle',
    requestKey: '',
    grid: null,
  })

  useEffect(() => {
    if (!grid.data) return
    let cancelled = false
    const requestKey = liveRequestKey
    const worker = new Worker(new URL('../../pgdata/walkabilityLiveHeatmap.worker.js', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent) => {
      if (cancelled) return
      const message = event.data as {
        type: 'result' | 'error' | 'progress'
        requestKey: string
        grid?: WalkabilityLiveGrid
      }
      if (message.requestKey !== requestKey) return
      if (message.type === 'result' && message.grid) {
        setLiveGrid({ status: 'ready', requestKey, grid: message.grid })
      }
      if (message.type === 'error') {
        setLiveGrid({ status: 'error', requestKey, grid: null })
      }
    }
    worker.onerror = () => {
      if (!cancelled) setLiveGrid({ status: 'error', requestKey, grid: null })
    }
    worker.postMessage({ type: 'compute', requestKey, options: { ...options, factorWeights } })
    return () => {
      cancelled = true
      worker.terminate()
    }
  }, [factorWeights, grid.data, liveRequestKey, options])

  useEffect(() => {
    const data = grid.data
    const activeLiveGrid = liveGrid.status === 'ready' && liveGrid.requestKey === liveRequestKey ? liveGrid.grid : null
    const rows = activeLiveGrid?.rows ?? data?.rows
    const cols = activeLiveGrid?.cols ?? data?.cols
    const imageCoordinates = activeLiveGrid?.imageCoordinates ?? data?.imageCoordinates
    const variantKey = data?.grids.report_fidelity ? 'report_fidelity' : data?.defaultVariant
    const rle = activeLiveGrid?.rle ?? (variantKey ? data?.grids[variantKey] : null)
    if (!isLoaded || !map || !data || !rows || !cols || !imageCoordinates || !rle) return

    const canvas = document.createElement('canvas')
    canvas.width = cols
    canvas.height = rows
    const context = canvas.getContext('2d')
    if (!context) return

    const fallbackColors = WALKABILITY_MI_BAND_COLORS
    const colors = data.bandColors ?? fallbackColors
    const image = context.createImageData(cols, rows)
    let pixel = 0
    for (const [value, count] of rle) {
      const sourceColor = colors[String(value)] ?? fallbackColors[String(value)]
      const color = sourceColor ? hexToRgbaArray(sourceColor, 217) : ([0, 0, 0, 0] as [number, number, number, number])
      for (let index = 0; index < count; index += 1) {
        const offset = pixel * 4
        image.data[offset] = color[0]
        image.data[offset + 1] = color[1]
        image.data[offset + 2] = color[2]
        image.data[offset + 3] = color[3]
        pixel += 1
      }
    }
    context.putImageData(image, 0, 0)

    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)
    map.addSource(sourceId, {
      type: 'image',
      url: canvas.toDataURL('image/png'),
      coordinates: imageCoordinates,
    })
    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 0.78,
          'raster-resampling': 'nearest',
        },
      },
      undefined,
    )

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map may already be tearing down.
      }
    }
  }, [grid.data, isLoaded, liveGrid, liveRequestKey, map])

  return null
}

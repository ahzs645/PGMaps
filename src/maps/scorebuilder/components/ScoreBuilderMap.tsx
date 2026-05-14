import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as PgMap, MapClusterLayer, MapControls, type MapRef } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { useMap } from '@/components/ui/map'
import { useJsonManifest } from '@/maps/pgdata/shared'
import type { AirMonitor } from '@/maps/airquality'
import { WALKABILITY_REPORT_MI_COLORS } from '../constants'
import type { ScoreMetricKey, ScoreMetricWeightMap, ScoredBoundaryRegion } from '../types'

interface ScoreBuilderMapProps {
  regions: ScoredBoundaryRegion[]
  selectedRegionId: string | null
  monitors: AirMonitor[]
  showPoints: boolean
  onRegionClick: (regionId: string) => void
  regionFillColors?: Record<string, string> | null
  walkabilitySourceSurface?: boolean
  sourceGridWeights?: ScoreMetricWeightMap
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

const WALKABILITY_REPORT_FACTOR_REFS = [
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
  'B0', 'B1', 'B2', 'B3',
  'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
  'D0', 'D1', 'D2', 'D3', 'D4',
  'E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6',
  'F0', 'F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9',
  'G0', 'G1', 'G2', 'G3', 'G4', 'G5',
]

const SCORE_METRIC_TO_REPORT_REFS: Partial<Record<ScoreMetricKey, string[]>> = {
  sidewalkDensity: ['G1', 'G5'],
  walkwayDensity: ['G1'],
  walkabilityIntersectionDensity: ['F1', 'G2', 'G3', 'G4', 'G5'],
  walkabilityCrossingDensity: ['F0'],
  class3CrosswalkDensity: ['F0'],
  childcareDensity: ['C0'],
  transitStopDensity: ['F9', 'G0'],
  accessibleTransitStopDensity: ['F9', 'G0'],
  frequentTransitStopAccess: ['F9', 'G0'],
  accessibleFrequentTransitAccess: ['F9', 'G0'],
  transitServiceSpan: ['F9', 'G0'],
  transitTripsPerStop: ['F9', 'G0'],
  parkWalk10Access: ['A2', 'A3', 'A4', 'A5'],
  parkWalk20Access: ['A2', 'A3', 'A4', 'A5'],
  parkTransit20Access: ['A2', 'A3', 'A4', 'A5', 'F9', 'G0'],
  walkabilityPoiDensity: [
    'A0', 'A1', 'B0', 'B1', 'B2', 'B3',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
    'D0', 'D1', 'D2', 'D3', 'D4',
    'E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6',
  ],
}

const LIVE_GRID_OPTIONS = {
  dropGtfsHf: true,
  narrowCivic: true,
  narrowGrowth: true,
  dropPopAge: true,
}

const ZOOM = 12

export function ScoreBuilderMap({
  regions,
  selectedRegionId,
  monitors,
  showPoints,
  onRegionClick,
  regionFillColors = null,
  walkabilitySourceSurface = false,
  sourceGridWeights,
}: ScoreBuilderMapProps) {
  const mapRef = useRef<MapRef>(null)

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
          monitorCount: entry.counts.monitorCount,
          density: entry.metrics.overallDensity,
        },
      })),
    }
  }, [regions, regionFillColors])

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

  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null
    return regions.find((entry) => entry.region.id === selectedRegionId)?.region || null
  }, [regions, selectedRegionId])

  useEffect(() => {
    if (!selectedRegion || !mapRef.current) return

    mapRef.current.fitBounds(
      [
        [selectedRegion.bounds[0], selectedRegion.bounds[1]],
        [selectedRegion.bounds[2], selectedRegion.bounds[3]],
      ],
      {
        padding: 80,
        duration: 500,
        maxZoom: 10,
      },
    )
  }, [selectedRegion])

  return (
    <div className="h-full w-full">
      <PgMap ref={mapRef} center={PG_CENTER} zoom={ZOOM} styles={MAP_STYLES}>
        <MapControls position="top-right" showZoom showCompass />

        {walkabilitySourceSurface && <ScoreBuilderWalkabilitySourceGrid weights={sourceGridWeights} />}

        <MapFillLayer
          data={featureCollection}
          fillColor={['coalesce', ['get', 'scoreColor'], '#475569']}
          fillOpacity={walkabilitySourceSurface ? 0 : 0.72}
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

function hexToRgba(hex: string, alpha = 217): [number, number, number, number] {
  const clean = hex.replace('#', '')
  const value = Number.parseInt(clean.length === 3
    ? clean.split('').map((char) => `${char}${char}`).join('')
    : clean, 16)
  if (!Number.isFinite(value)) return [0, 0, 0, 0]
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha]
}

function buildSourceGridFactorWeights(weights?: ScoreMetricWeightMap): Record<string, number> {
  const factorScores = Object.fromEntries(WALKABILITY_REPORT_FACTOR_REFS.map((ref) => [ref, 0])) as Record<string, number>
  if (!weights) return factorScores

  for (const [metricKey, weight] of Object.entries(weights) as Array<[ScoreMetricKey, number]>) {
    if (!weight) continue
    const refs = SCORE_METRIC_TO_REPORT_REFS[metricKey]
    if (!refs?.length) continue
    const contribution = weight / refs.length
    for (const ref of refs) {
      factorScores[ref] = Math.max(0, (factorScores[ref] ?? 0) + contribution)
    }
  }

  const maxScore = Math.max(...Object.values(factorScores))
  if (maxScore <= 0) return factorScores
  return Object.fromEntries(
    WALKABILITY_REPORT_FACTOR_REFS.map((ref) => [ref, Math.max(0, Math.min(2, (factorScores[ref] / maxScore) * 2))]),
  )
}

function ScoreBuilderWalkabilitySourceGrid({ weights }: { weights?: ScoreMetricWeightMap }) {
  const { map, isLoaded } = useMap()
  const grid = useJsonManifest<WalkabilityGridData>('/data/walkability/heatmap/citywide_mi_grid.json')
  const sourceId = 'score-builder-walkability-source-grid'
  const layerId = 'score-builder-walkability-source-grid-layer'
  const factorWeights = useMemo(() => buildSourceGridFactorWeights(weights), [weights])
  const liveRequestKey = useMemo(
    () => JSON.stringify({ options: LIVE_GRID_OPTIONS, factorWeights }),
    [factorWeights],
  )
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
    worker.postMessage({ type: 'compute', requestKey, options: { ...LIVE_GRID_OPTIONS, factorWeights } })
    return () => {
      cancelled = true
      worker.terminate()
    }
  }, [factorWeights, grid.data, liveRequestKey])

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

    const fallbackColors: Record<string, string> = {
      1: WALKABILITY_REPORT_MI_COLORS[0],
      2: WALKABILITY_REPORT_MI_COLORS[1],
      3: WALKABILITY_REPORT_MI_COLORS[2],
      4: WALKABILITY_REPORT_MI_COLORS[3],
      5: WALKABILITY_REPORT_MI_COLORS[4],
    }
    const colors = data.bandColors ?? fallbackColors
    const image = context.createImageData(cols, rows)
    let pixel = 0
    for (const [value, count] of rle) {
      const sourceColor = colors[String(value)] ?? fallbackColors[String(value)]
      const color = sourceColor ? hexToRgba(sourceColor, 217) : [0, 0, 0, 0] as [number, number, number, number]
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

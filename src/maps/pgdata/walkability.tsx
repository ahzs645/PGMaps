import { useEffect, useId, useMemo, useState } from 'react'
import { Footprints } from 'lucide-react'
import { MapFillLayer } from '@/components/ui/map-layers'
import { useMap } from '@/components/ui/map'
import { AppSelect } from '@/components/ui/select'
import { formatDate, formatNullableNumber, useJsonManifest } from './shared'

interface WalkabilityVariant {
  id: string
  label: string
  description: string
}

interface WalkabilityMetric {
  id: string
  label: string
  direction: string
}

interface WalkabilitySource {
  id: string
  label: string
  url: string
  localPath: string
}

export interface WalkabilityManifest {
  generatedAt: string
  geography: string
  output: string
  sourcePolicy: string
  variants: WalkabilityVariant[]
  metrics: WalkabilityMetric[]
  sources: WalkabilitySource[]
  caveats: string[]
}

interface WalkabilityHeatmapVariant {
  key: string
  label: string
  path: string
  area_buffer_m: number
  band_counts: Record<string, number>
}

interface WalkabilityHeatmapManifest {
  generatedAt: string
  defaultLayer: string
  citywideGrid?: {
    path: string
    rows: number
    cols: number
    cellSizeM: number
    variants: number
    defaultVariant: string
    calculation: string
  }
  assetBinned: {
    path: string
    featureCount: number
    bandCounts: Record<string, number>
    bandLabels: Record<string, string>
    caveat: string
  }
  cellSizeM: number
  defaultVariant: string
  coordinates: [[number, number], [number, number], [number, number], [number, number]]
  variants: WalkabilityHeatmapVariant[]
  caveats: string[]
}

interface WalkabilityGridVariant {
  key: string
  label: string
  config: Record<string, boolean>
  areaBufferM: number
  factorCount: number
  bandCounts: Record<string, number>
}

interface WalkabilityGridData {
  generatedAt: string
  calculation: string
  cellSizeM: number
  rows: number
  cols: number
  noData: number
  imageCoordinates: [[number, number], [number, number], [number, number], [number, number]]
  bandColors: Record<string, string>
  bandLabels: Record<string, string>
  defaultVariant: string
  variants: WalkabilityGridVariant[]
  grids: Record<string, Array<[number, number]>>
  caveats: string[]
}

interface WalkabilityRenderedHeatmapVariant {
  key: string
  label: string
  path?: string
  areaBufferM: number
  bandCounts: Record<string, number>
}

type WalkabilityProperties = {
  communityId: string
  communityName: string
  areaSqKm: number
  sidewalkKm: number
  walkwayKm: number
  intersectionCount: number
  transitStopCount: number
  parkAmenityCount: number
  pedestrianCrashCount: number
  supplementalPoiCount: number
  crossingCount: number
  class3CrosswalkCount: number
  sidewalkDensity: number
  walkwayDensity: number
  intersectionDensity: number
  transitStopDensity: number
  parkAmenityDensity: number
  pedestrianCrashDensity: number
  supplementalPoiDensity: number
  crossingDensity: number
  class3CrosswalkDensity: number
  balancedScore: number
  infrastructureScore: number
  accessScore: number
  safetyAdjustedScore: number
  supplementedLocalScore: number
}

type WalkabilityFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, WalkabilityProperties>
type WalkabilityFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, WalkabilityProperties>
export const WALKABILITY_DEFAULT_VARIANT = 'balanced'
export const WALKABILITY_DEFAULT_DISPLAY_MODE = 'heatmap'
const WALKABILITY_DEFAULT_HEATMAP_VARIANT = 'report_fidelity'

type WalkabilityDisplayMode = 'heatmap' | 'community'

const WALKABILITY_SCORE_FIELD_BY_VARIANT: Record<string, keyof WalkabilityProperties> = {
  balanced: 'balancedScore',
  infrastructure: 'infrastructureScore',
  access: 'accessScore',
  safetyAdjusted: 'safetyAdjustedScore',
  supplementedLocal: 'supplementedLocalScore',
}

export function useWalkabilityData(
  active: boolean,
  initialVariantId: string,
  initialDisplayMode: string | null,
  initialHeatmapVariantId: string | null,
) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(initialVariantId || WALKABILITY_DEFAULT_VARIANT)
  const [displayMode, setDisplayMode] = useState<WalkabilityDisplayMode>(
    initialDisplayMode === 'community' ? 'community' : WALKABILITY_DEFAULT_DISPLAY_MODE,
  )
  const [selectedHeatmapVariantId, setSelectedHeatmapVariantId] = useState<string>(initialHeatmapVariantId || WALKABILITY_DEFAULT_HEATMAP_VARIANT)
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null)
  const manifest = useJsonManifest<WalkabilityManifest>(active ? '/data/walkability/manifest.json' : null)
  const heatmapManifest = useJsonManifest<WalkabilityHeatmapManifest>(active ? '/data/walkability/heatmap/manifest.json' : null)
  const gridHeatmap = useJsonManifest<WalkabilityGridData>(
    active ? (heatmapManifest.data?.citywideGrid?.path ?? '/data/walkability/heatmap/citywide_mi_grid.json') : null,
  )
  const data = useJsonManifest<WalkabilityFeatureCollection>(
    active ? (manifest.data?.output ?? '/data/walkability/community_walkability.geojson') : null,
  )

  const variants = manifest.data?.variants ?? []
  const selectedVariant = useMemo(() => {
    if (!variants.length) return null
    return variants.find((variant) => variant.id === selectedVariantId) ?? variants[0]
  }, [selectedVariantId, variants])
  const selectedScoreField = WALKABILITY_SCORE_FIELD_BY_VARIANT[selectedVariant?.id ?? WALKABILITY_DEFAULT_VARIANT] ?? 'balancedScore'
  const features = data.data?.features ?? []
  const heatmapVariants = useMemo<WalkabilityRenderedHeatmapVariant[]>(() => {
    const overlayVariants = heatmapManifest.data?.variants ?? []
    if (overlayVariants.length) {
      return overlayVariants.map((variant) => ({
        key: variant.key,
        label: variant.label,
        path: variant.path,
        areaBufferM: variant.area_buffer_m,
        bandCounts: variant.band_counts,
      }))
    }
    return (gridHeatmap.data?.variants ?? []).map((variant) => ({
      key: variant.key,
      label: variant.label,
      areaBufferM: variant.areaBufferM,
      bandCounts: variant.bandCounts,
    }))
  }, [gridHeatmap.data?.variants, heatmapManifest.data?.variants])
  const selectedHeatmapVariant = useMemo<WalkabilityRenderedHeatmapVariant | null>(() => {
    if (!heatmapVariants.length) return null
    return heatmapVariants.find((variant) => variant.key === selectedHeatmapVariantId)
      ?? heatmapVariants.find((variant) => variant.key === heatmapManifest.data?.defaultVariant)
      ?? heatmapVariants.find((variant) => variant.key === gridHeatmap.data?.defaultVariant)
      ?? heatmapVariants[0]
  }, [gridHeatmap.data?.defaultVariant, heatmapManifest.data?.defaultVariant, heatmapVariants, selectedHeatmapVariantId])
  const selectedCommunity = useMemo<WalkabilityFeature | null>(() => {
    if (!selectedCommunityId) return null
    return features.find((feature) => String(feature.properties.communityId) === selectedCommunityId) ?? null
  }, [selectedCommunityId, features])
  const scores = useMemo(() => (
    features.map((feature) => Number(feature.properties[selectedScoreField])).filter(Number.isFinite)
  ), [selectedScoreField, features])
  const minScore = scores.length ? Math.min(...scores) : 0
  const maxScore = scores.length ? Math.max(...scores) : 100
  const fillColor = useMemo(() => {
    const low = minScore
    const high = maxScore !== low ? maxScore : low + 1
    const mid = low + ((high - low) / 2)

    return [
      'case',
      ['!', ['has', selectedScoreField]],
      '#e5e7eb',
      ['==', ['get', selectedScoreField], null],
      '#e5e7eb',
      [
        'interpolate',
        ['linear'],
        ['to-number', ['get', selectedScoreField]],
        low,
        '#f97316',
        mid,
        '#facc15',
        high,
        '#22c55e',
      ],
    ]
  }, [selectedScoreField, maxScore, minScore])

  useEffect(() => {
    if (!variants.length) return
    if (!variants.some((variant) => variant.id === selectedVariantId)) {
      setSelectedVariantId(variants[0].id)
    }
  }, [selectedVariantId, variants])

  useEffect(() => {
    setSelectedCommunityId(null)
  }, [selectedVariantId])

  useEffect(() => {
    if (displayMode === 'heatmap') setSelectedCommunityId(null)
  }, [displayMode])

  useEffect(() => {
    if (!heatmapVariants.length) return
    if (!heatmapVariants.some((variant) => variant.key === selectedHeatmapVariantId)) {
      setSelectedHeatmapVariantId(heatmapManifest.data?.defaultVariant ?? gridHeatmap.data?.defaultVariant ?? heatmapVariants[0].key)
    }
  }, [gridHeatmap.data?.defaultVariant, heatmapManifest.data?.defaultVariant, heatmapVariants, selectedHeatmapVariantId])

  return {
    manifest,
    heatmapManifest,
    gridHeatmap,
    data,
    displayMode,
    setDisplayMode,
    variants,
    selectedVariant,
    selectedVariantId,
    setSelectedVariantId,
    heatmapVariants,
    selectedHeatmapVariant,
    selectedHeatmapVariantId,
    setSelectedHeatmapVariantId,
    selectedScoreField,
    features,
    selectedCommunity,
    selectedCommunityId,
    setSelectedCommunityId,
    minScore,
    maxScore,
    fillColor,
  }
}

export type WalkabilityState = ReturnType<typeof useWalkabilityData>

export function WalkabilitySidebar({ walkability }: { walkability: WalkabilityState }) {
  const selectedCommunity = walkability.selectedCommunity

  return (
    <>
      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Footprints className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold text-foreground">Walkability Variants</h2>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">
            Display
            <AppSelect
              value={walkability.displayMode}
              onValueChange={(value) => walkability.setDisplayMode(value as WalkabilityDisplayMode)}
              options={[
                { value: 'heatmap', label: 'Raw MI heat map' },
                { value: 'community', label: 'Community polygons' },
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          {walkability.displayMode === 'heatmap' && (
            <label className="block text-xs font-medium text-foreground">
              Heat map variant
              <AppSelect
                value={walkability.selectedHeatmapVariant?.key ?? walkability.selectedHeatmapVariantId}
                onValueChange={walkability.setSelectedHeatmapVariantId}
                options={walkability.heatmapVariants.map((variant) => ({
                  value: variant.key,
                  label: variant.label,
                }))}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
          )}

          {walkability.displayMode === 'community' && <label className="block text-xs font-medium text-foreground">
            Variant
            <AppSelect
              value={walkability.selectedVariant?.id ?? walkability.selectedVariantId}
              onValueChange={walkability.setSelectedVariantId}
              options={walkability.variants.map((variant) => ({
                value: variant.id,
                label: variant.label,
              }))}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>}

          {walkability.displayMode === 'heatmap' ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">
                {Object.values(walkability.selectedHeatmapVariant?.bandCounts ?? {}).reduce((sum, count) => sum + count, 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">cells</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">5</div>
              <div className="text-[10px] text-muted-foreground">bins</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{formatNullableNumber(walkability.heatmapManifest.data?.cellSizeM ?? walkability.gridHeatmap.data?.cellSizeM)}</div>
              <div className="text-[10px] text-muted-foreground">metres</div>
            </div>
          </div>
          ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{walkability.features.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">communities</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{formatNullableNumber(walkability.minScore)}</div>
              <div className="text-[10px] text-muted-foreground">low score</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{formatNullableNumber(walkability.maxScore)}</div>
              <div className="text-[10px] text-muted-foreground">high score</div>
            </div>
          </div>
          )}

          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
            {walkability.displayMode === 'heatmap'
              ? 'Exact binned Mobility Index overlay imported from the local reconstruction map variants and rendered in MapLibre. The Node/Turf grid rebuild remains in the repo as a recalculation reference.'
              : walkability.selectedVariant?.description ?? 'Community walkability is recalculated from web-source layers.'}
          </div>
          {walkability.heatmapManifest.error && <div className="text-xs text-red-500">{walkability.heatmapManifest.error}</div>}
          {walkability.gridHeatmap.error && <div className="text-xs text-red-500">{walkability.gridHeatmap.error}</div>}
          {walkability.manifest.error && <div className="text-xs text-red-500">{walkability.manifest.error}</div>}
          {walkability.data.error && <div className="text-xs text-red-500">{walkability.data.error}</div>}
        </div>
      </div>

      {selectedCommunity && (
        <div className="border-b border-border p-4">
          <div className="mb-2 text-sm font-semibold text-foreground">Selected Community</div>
          <div className="rounded-md border border-border bg-background p-3 text-xs">
            <div className="font-semibold leading-5 text-foreground">{selectedCommunity.properties.communityName}</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{walkability.selectedVariant?.label ?? 'Score'}</span>
              <span className="font-semibold text-foreground">
                {formatNullableNumber(Number(selectedCommunity.properties[walkability.selectedScoreField]))}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
              <span>Sidewalk km</span>
              <span className="text-right text-foreground">{formatNullableNumber(selectedCommunity.properties.sidewalkKm)}</span>
              <span>Walkway km</span>
              <span className="text-right text-foreground">{formatNullableNumber(selectedCommunity.properties.walkwayKm)}</span>
              <span>Intersections</span>
              <span className="text-right text-foreground">{selectedCommunity.properties.intersectionCount.toLocaleString()}</span>
              <span>Transit stops</span>
              <span className="text-right text-foreground">{selectedCommunity.properties.transitStopCount.toLocaleString()}</span>
              <span>Park amenities</span>
              <span className="text-right text-foreground">{selectedCommunity.properties.parkAmenityCount.toLocaleString()}</span>
              <span>Pedestrian crashes</span>
              <span className="text-right text-foreground">{selectedCommunity.properties.pedestrianCrashCount.toLocaleString()}</span>
              <span>Supplemental POIs</span>
              <span className="text-right text-foreground">{selectedCommunity.properties.supplementalPoiCount.toLocaleString()}</span>
              <span>Crossings</span>
              <span className="text-right text-foreground">{selectedCommunity.properties.crossingCount.toLocaleString()}</span>
              <span>Class-3 crosswalks</span>
              <span className="text-right text-foreground">{selectedCommunity.properties.class3CrosswalkCount.toLocaleString()}</span>
            </div>
            <button
              type="button"
              onClick={() => walkability.setSelectedCommunityId(null)}
              className="mt-3 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function WalkabilitySourceNotes({ walkability }: { walkability: WalkabilityState }) {
  return (
    <>
      <p>Walkability variants updated {formatDate(walkability.manifest.data?.generatedAt)}.</p>
      {walkability.displayMode === 'heatmap' && <p>Citywide MI overlay updated {formatDate(walkability.heatmapManifest.data?.generatedAt)}.</p>}
      <p>{walkability.manifest.data?.sourcePolicy ?? 'Web-source-only community scores from public map layers.'}</p>
      {walkability.displayMode === 'heatmap' && (
        <>
          <p>The displayed heat map uses the imported reconstruction overlay PNGs, so it matches the Folium map variants from the Walkability folder.</p>
          <p>The Node/Turf citywide grid is still stored in the repo as a recalculation reference, but it is not the default rendered layer.</p>
        </>
      )}
      {(walkability.manifest.data?.caveats ?? []).slice(0, 2).map((caveat) => (
        <p key={caveat}>{caveat}</p>
      ))}
    </>
  )
}

export function WalkabilityLayer({ walkability }: { walkability: WalkabilityState }) {
  if (walkability.displayMode === 'heatmap') {
    return <WalkabilityHeatmapLayer walkability={walkability} />
  }

  if (!walkability.features.length) return null

  return (
    <MapFillLayer
      data={walkability.data.data ?? { type: 'FeatureCollection', features: [] }}
      fillColor={walkability.fillColor}
      fillOpacity={0.76}
      lineColor="#047857"
      lineWidth={0.9}
      lineOpacity={0.65}
      idProperty="communityId"
      selectedId={walkability.selectedCommunityId}
      selectionColor="#064e3b"
      selectionWidth={2.2}
      onFeatureClick={walkability.setSelectedCommunityId}
    />
  )
}

function WalkabilityHeatmapLayer({ walkability }: { walkability: WalkabilityState }) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `walkability-grid-src-${uid}`
  const layerId = `walkability-grid-layer-${uid}`
  const manifest = walkability.heatmapManifest.data
  const grid = walkability.gridHeatmap.data
  const selectedVariant = walkability.selectedHeatmapVariant
  const variantKey = selectedVariant?.key ?? grid?.defaultVariant

  useEffect(() => {
    if (isLoaded && map && manifest?.coordinates && selectedVariant?.path) {
      map.addSource(sourceId, {
        type: 'image',
        url: selectedVariant.path,
        coordinates: manifest.coordinates,
      })
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 0.75,
          'raster-resampling': 'nearest',
        },
      })

      return () => {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
          if (map.getSource(sourceId)) map.removeSource(sourceId)
        } catch {
          // Map may already be destroyed during unmount.
        }
      }
    }

    if (!isLoaded || !map || !grid || !variantKey || !grid.grids[variantKey]) return

    const canvas = document.createElement('canvas')
    canvas.width = grid.cols
    canvas.height = grid.rows
    const context = canvas.getContext('2d')
    if (!context) return

    const image = context.createImageData(grid.cols, grid.rows)
    const colors: Record<number, [number, number, number, number]> = {
      1: [79, 154, 214, 217],
      2: [158, 201, 156, 217],
      3: [245, 228, 81, 217],
      4: [232, 156, 74, 217],
      5: [211, 59, 59, 217],
    }
    let pixel = 0
    for (const [value, count] of grid.grids[variantKey]) {
      const color = colors[value] ?? [0, 0, 0, 0]
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
    const url = canvas.toDataURL('image/png')

    map.addSource(sourceId, {
      type: 'image',
      url,
      coordinates: grid.imageCoordinates,
    })
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 0.78,
        'raster-resampling': 'nearest',
      },
    })

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map may already be destroyed during unmount.
      }
    }
  }, [grid, isLoaded, layerId, manifest?.coordinates, map, selectedVariant?.path, sourceId, variantKey])

  return null
}

export function WalkabilityLegend({ walkability }: { walkability: WalkabilityState }) {
  if (walkability.displayMode === 'heatmap') {
    return (
      <div className="w-64 space-y-2 text-xs text-muted-foreground">
        <div className="font-medium text-foreground">{walkability.selectedHeatmapVariant?.label ?? 'Citywide MI grid'}</div>
        <div className="grid grid-cols-5 overflow-hidden rounded-sm border border-border">
          <span className="block h-3" style={{ backgroundColor: '#4f9ad6' }} />
          <span className="block h-3" style={{ backgroundColor: '#9ec99c' }} />
          <span className="block h-3" style={{ backgroundColor: '#f5e451' }} />
          <span className="block h-3" style={{ backgroundColor: '#e89c4a' }} />
          <span className="block h-3" style={{ backgroundColor: '#d33b3b' }} />
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span>1-27</span>
          <span>28-45</span>
          <span>46-63</span>
          <span>64-82</span>
          <span>83-170</span>
        </div>
        <div>{Object.values(walkability.selectedHeatmapVariant?.bandCounts ?? {}).reduce((sum, count) => sum + count, 0).toLocaleString()} non-pathlocked grid cells</div>
      </div>
    )
  }

  return (
    <div className="w-56 space-y-2 text-xs text-muted-foreground">
      <div className="font-medium text-foreground">{walkability.selectedVariant?.label ?? 'Walkability score'}</div>
      <div
        className="h-3 w-full rounded-sm border border-border bg-gradient-to-r from-orange-500 via-yellow-300 to-green-500"
        aria-hidden="true"
      />
      <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums">
        <span>{formatNullableNumber(walkability.minScore)}</span>
        <span>{formatNullableNumber(walkability.maxScore)}</span>
      </div>
      <div>{walkability.features.length.toLocaleString()} community polygons</div>
    </div>
  )
}

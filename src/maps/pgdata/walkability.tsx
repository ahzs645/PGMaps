import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Calculator, Footprints, RotateCcw } from 'lucide-react'
import { MapFillLayer } from '@/components/ui/map-layers'
import { useMap } from '@/components/ui/map'
import { InlineAlert, KeyValueRows, MapGradientLegendItem, SelectedItemCard, SidebarSection, StatGrid } from '@/components/ui/map-panels'
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

interface WalkabilityLiveGrid {
  key: string
  label: string
  generatedAt: string
  cellSizeM: number
  rows: number
  cols: number
  noData: number
  imageCoordinates: [[number, number], [number, number], [number, number], [number, number]]
  bandCounts: Record<string, number>
  rle: Array<[number, number]>
}

interface WalkabilityLiveHeatmapState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  requestKey: string
  progress: string
  grid: WalkabilityLiveGrid | null
  error: string | null
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
type HeatmapOptionKey =
  | 'dropGtfsHf'
  | 'narrowCivic'
  | 'narrowGrowth'
  | 'dropPopAge'
  | 'dropF0'
  | 'dropC0'
  | 'dropF8'
  | 'dropSuppPoi'
  | 'tightBuffer'

type HeatmapOptionState = Record<HeatmapOptionKey, boolean>
type HeatmapFactorWeightState = Record<string, number>

const HEATMAP_EMPTY_OPTIONS: HeatmapOptionState = {
  dropGtfsHf: false,
  narrowCivic: false,
  narrowGrowth: false,
  dropPopAge: false,
  dropF0: false,
  dropC0: false,
  dropF8: false,
  dropSuppPoi: false,
  tightBuffer: false,
}

const HEATMAP_REPORT_FIDELITY_OPTIONS: HeatmapOptionState = {
  ...HEATMAP_EMPTY_OPTIONS,
  dropGtfsHf: true,
  narrowCivic: true,
  narrowGrowth: true,
  dropPopAge: true,
}

const HEATMAP_OPTIONS: Array<{ key: HeatmapOptionKey; label: string; description: string }> = [
  { key: 'dropGtfsHf', label: 'Remove GTFS high-frequency bonus', description: 'Drops the extra band 4-5 transit stop bonus.' },
  { key: 'narrowCivic', label: 'Narrow civic factors', description: 'Keeps Cultural, Aquatic, and Administration only.' },
  { key: 'narrowGrowth', label: 'Narrow growth factors', description: 'Keeps Growth Priority and Future growth only.' },
  { key: 'dropPopAge', label: 'Drop population and age factors', description: 'Removes F2/F3/F4/F6/F7 for report fidelity.' },
  { key: 'dropF0', label: 'Drop crosswalks', description: 'Removes F0 crosswalk scoring.' },
  { key: 'dropC0', label: 'Drop daycares', description: 'Removes C0 daycare scoring.' },
  { key: 'dropF8', label: 'Drop intercity bus', description: 'Removes F8 intercity bus scoring.' },
  { key: 'dropSuppPoi', label: 'Drop supplemental POIs', description: 'Removes A1/E0/E1/E2/E3 supplemental POIs.' },
  { key: 'tightBuffer', label: 'Use 10m area buffer', description: 'Uses 10m instead of the default 20m area/line buffer.' },
]

const WALKABILITY_SCORE_FIELD_BY_VARIANT: Record<string, keyof WalkabilityProperties> = {
  balanced: 'balancedScore',
  infrastructure: 'infrastructureScore',
  access: 'accessScore',
  safetyAdjusted: 'safetyAdjustedScore',
  supplementedLocal: 'supplementedLocalScore',
}

const WALKABILITY_FACTOR_GROUPS = [
  { ref: 'A0', label: 'Community space', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A1', label: 'Entertainment', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A2', label: 'Parks', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A3', label: 'Activity areas', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A4', label: 'Playgrounds', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A5', label: 'Recreation facilities', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'B0', label: 'Community centres', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'B1', label: 'Future community facility', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'B2', label: 'Religious assembly', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'B3', label: 'Schools', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'C0', label: 'Daycares', group: 'Community services', method: '400/250/100m proximity' },
  { ref: 'C1', label: 'Government services', group: 'Community services', method: '400/250/100m proximity' },
  { ref: 'C2', label: 'Health centres', group: 'Community services', method: '400/250/100m proximity' },
  { ref: 'C3', label: 'Commercial land use', group: 'Community services', method: 'area association' },
  { ref: 'C4', label: 'Recreation/institutional', group: 'Community services', method: 'area association' },
  { ref: 'C5', label: 'Business industrial', group: 'Community services', method: 'area association' },
  { ref: 'C6', label: 'Residential land use', group: 'Community services', method: 'area association' },
  { ref: 'D0', label: 'Downtown commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D1', label: 'Service commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D2', label: 'Corridor commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D3', label: 'Commercial recreation', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D4', label: 'Regional commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'E0', label: 'Low-income housing', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E1', label: 'Apartment buildings', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E2', label: 'Assisted housing', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E3', label: 'Senior housing', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E4', label: 'Growth priority areas', group: 'Economic housing', method: 'area association' },
  { ref: 'E5', label: 'Future growth areas', group: 'Economic housing', method: 'area association' },
  { ref: 'E6', label: 'Intensive residential', group: 'Economic housing', method: 'area association' },
  { ref: 'F0', label: 'Crosswalks', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'F1', label: 'Traffic signals', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'F2', label: 'High population density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F3', label: 'Medium population density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F4', label: 'Low population density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F6', label: 'Senior density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F7', label: 'Youth density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F8', label: 'Intercity bus', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'F9', label: 'Transit stops', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'G0', label: 'Transit corridors', group: 'Environment routes', method: '400/250/100m proximity' },
  { ref: 'G1', label: 'Active corridors', group: 'Environment routes', method: 'line association' },
  { ref: 'G2', label: 'Arterial/freeway roads', group: 'Environment routes', method: 'line association' },
  { ref: 'G3', label: 'Major collectors', group: 'Environment routes', method: 'line association' },
  { ref: 'G4', label: 'Minor collectors', group: 'Environment routes', method: 'line association' },
  { ref: 'G5', label: 'Local roads', group: 'Environment routes', method: 'line association' },
]

const HEATMAP_DEFAULT_FACTOR_WEIGHTS: HeatmapFactorWeightState = Object.fromEntries(
  WALKABILITY_FACTOR_GROUPS.map((factor) => [factor.ref, 1]),
)

const WALKABILITY_HEATMAP_BASE_LOGIC = [
  'Uses all report factor references A0-G5 where public or reconstructed layers are available.',
  'Proximity layers use cumulative 400m / 250m / 100m buffers worth 1 / 2 / 2 points.',
  'Area and line layers use source geometry buffers, defaulting to 20m unless the tight-buffer option is active.',
]

function describeHeatmapLogic(options: HeatmapOptionState): string[] {
  const logic = [...WALKABILITY_HEATMAP_BASE_LOGIC]
  if (options.dropGtfsHf) logic.push('F9 high-frequency GTFS bonus is removed.')
  if (options.narrowCivic) logic.push('A0/A5/C1 civic groups are narrowed to the closest report-matching facility classes.')
  if (options.narrowGrowth) logic.push('E4/E5 growth-area groups are narrowed to Growth Priority and Future growth classes.')
  if (options.dropPopAge) logic.push('F2/F3/F4 population-density and F6/F7 age-density factors are dropped for report fidelity.')
  if (options.dropF0) logic.push('F0 crosswalk proximity is excluded.')
  if (options.dropC0) logic.push('C0 daycare proximity is excluded.')
  if (options.dropF8) logic.push('F8 intercity bus proximity is excluded.')
  if (options.dropSuppPoi) logic.push('A1/E0/E1/E2/E3 supplemental housing and entertainment POIs are excluded.')
  if (options.tightBuffer) logic.push('Area and line association buffer is 10m instead of 20m.')
  return logic
}

function isFactorDroppedByOptions(ref: string, options: HeatmapOptionState): boolean {
  if (options.dropPopAge && ['F2', 'F3', 'F4', 'F6', 'F7'].includes(ref)) return true
  if (options.dropF0 && ref === 'F0') return true
  if (options.dropC0 && ref === 'C0') return true
  if (options.dropF8 && ref === 'F8') return true
  if (options.dropSuppPoi && ['A1', 'E0', 'E1', 'E2', 'E3'].includes(ref)) return true
  return false
}

function factorWeightKey(weights: HeatmapFactorWeightState): string {
  return WALKABILITY_FACTOR_GROUPS
    .map((factor) => `${factor.ref}:${Number(weights[factor.ref] ?? 1).toFixed(2)}`)
    .join('|')
}

function optionsForHeatmapVariant(variant?: WalkabilityGridVariant | null): HeatmapOptionState {
  if (!variant) return HEATMAP_EMPTY_OPTIONS
  return {
    dropGtfsHf: Boolean(variant.config.drop_gtfs_hf),
    narrowCivic: Boolean(variant.config.narrow_civic),
    narrowGrowth: Boolean(variant.config.narrow_growth),
    dropPopAge: Boolean(variant.config.drop_pop_age),
    dropF0: Boolean(variant.config.drop_f0),
    dropC0: Boolean(variant.config.drop_c0),
    dropF8: Boolean(variant.config.drop_f8),
    dropSuppPoi: Boolean(variant.config.drop_supp_poi),
    tightBuffer: variant.areaBufferM === 10,
  }
}

function normalizeHeatmapOptions(options: HeatmapOptionState): HeatmapOptionState {
  return { ...HEATMAP_EMPTY_OPTIONS, ...options }
}

function variantKeyForHeatmapOptions(options: HeatmapOptionState): string {
  const extraDrops = [options.dropF0, options.dropC0, options.dropF8, options.dropSuppPoi].filter(Boolean).length
  if (options.dropPopAge && options.tightBuffer && options.dropF0 && options.dropC0 && options.dropF8 && options.dropSuppPoi) return 'most_conservative'
  if (options.dropPopAge && options.tightBuffer && extraDrops === 0) return 'rf_tight_buffer_10m'
  if (options.dropPopAge && !options.tightBuffer && extraDrops === 1) {
    if (options.dropF0) return 'rf_drop_f0'
    if (options.dropC0) return 'rf_drop_c0'
    if (options.dropF8) return 'rf_drop_f8'
    return 'rf_drop_supp_poi'
  }
  if (options.dropPopAge) return 'report_fidelity'
  if (options.narrowGrowth) return 'narrow_growth'
  if (options.narrowCivic) return 'narrow_civic'
  if (options.dropGtfsHf) return 'no_gtfs_hf'
  return 'full'
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
  const [heatmapOptionState, setHeatmapOptionState] = useState<HeatmapOptionState>(() => (
    normalizeHeatmapOptions(HEATMAP_REPORT_FIDELITY_OPTIONS)
  ))
  const [heatmapFactorWeights, setHeatmapFactorWeights] = useState<HeatmapFactorWeightState>(() => ({
    ...HEATMAP_DEFAULT_FACTOR_WEIGHTS,
  }))
  const initializedHeatmapOptionsRef = useRef(false)
  const [liveHeatmap, setLiveHeatmap] = useState<WalkabilityLiveHeatmapState>({
    status: 'idle',
    requestKey: '',
    progress: '',
    grid: null,
    error: null,
  })
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
  const heatmapVariants = gridHeatmap.data?.variants ?? []
  const selectedHeatmapVariant = useMemo(() => {
    if (!heatmapVariants.length) return null
    return heatmapVariants.find((variant) => variant.key === selectedHeatmapVariantId)
      ?? heatmapVariants.find((variant) => variant.key === gridHeatmap.data?.defaultVariant)
      ?? heatmapVariants[0]
  }, [gridHeatmap.data?.defaultVariant, heatmapVariants, selectedHeatmapVariantId])
  const setHeatmapOption = (key: HeatmapOptionKey, checked: boolean) => {
    const requested = normalizeHeatmapOptions({ ...heatmapOptionState, [key]: checked })
    const nextVariantKey = variantKeyForHeatmapOptions(requested)
    setHeatmapOptionState(requested)
    if (heatmapVariants.some((variant) => variant.key === nextVariantKey)) {
      setSelectedHeatmapVariantId(nextVariantKey)
    }
  }
  const setHeatmapFactorWeight = (ref: string, value: number) => {
    const normalizedValue = Math.max(0, Math.min(2, Number.isFinite(value) ? value : 1))
    setHeatmapFactorWeights((current) => ({ ...current, [ref]: normalizedValue }))
  }
  const resetHeatmapFactorWeights = () => {
    setHeatmapFactorWeights({ ...HEATMAP_DEFAULT_FACTOR_WEIGHTS })
  }
  const heatmapOptionKey = useMemo(() => (
    JSON.stringify({
      options: heatmapOptionState,
      factorWeights: factorWeightKey(heatmapFactorWeights),
    })
  ), [heatmapFactorWeights, heatmapOptionState])
  const selectedHeatmapBandCounts = liveHeatmap.status === 'ready' && liveHeatmap.requestKey === heatmapOptionKey
    ? liveHeatmap.grid?.bandCounts
    : selectedHeatmapVariant?.bandCounts
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
      setSelectedHeatmapVariantId(gridHeatmap.data?.defaultVariant ?? heatmapVariants[0].key)
    }
  }, [gridHeatmap.data?.defaultVariant, heatmapVariants, selectedHeatmapVariantId])

  useEffect(() => {
    if (!heatmapVariants.length || initializedHeatmapOptionsRef.current) return
    const initialKey = initialHeatmapVariantId || gridHeatmap.data?.defaultVariant || WALKABILITY_DEFAULT_HEATMAP_VARIANT
    const initialVariant = heatmapVariants.find((variant) => variant.key === initialKey)
      ?? heatmapVariants.find((variant) => variant.key === WALKABILITY_DEFAULT_HEATMAP_VARIANT)
      ?? heatmapVariants.find((variant) => variant.key === gridHeatmap.data?.defaultVariant)
      ?? heatmapVariants[0]
    setHeatmapOptionState(normalizeHeatmapOptions(optionsForHeatmapVariant(initialVariant)))
    initializedHeatmapOptionsRef.current = true
  }, [gridHeatmap.data?.defaultVariant, heatmapVariants, initialHeatmapVariantId])

  useEffect(() => {
    if (!active || displayMode !== 'heatmap' || !gridHeatmap.data) return
    let cancelled = false
    const requestKey = heatmapOptionKey
    const worker = new Worker(new URL('./walkabilityLiveHeatmap.worker.js', import.meta.url), { type: 'module' })
    setLiveHeatmap({
      status: 'loading',
      requestKey,
      progress: 'Loading source layers',
      grid: null,
      error: null,
    })
    worker.onmessage = (event: MessageEvent) => {
      if (cancelled) return
      const message = event.data as {
        type: 'progress' | 'result' | 'error'
        requestKey: string
        progress?: string
        grid?: WalkabilityLiveGrid
        error?: string
      }
      if (message.requestKey !== requestKey) return
      if (message.type === 'progress') {
        setLiveHeatmap((current) => current.requestKey === requestKey
          ? { ...current, progress: message.progress ?? current.progress }
          : current)
      }
      if (message.type === 'result' && message.grid) {
        setLiveHeatmap({
          status: 'ready',
          requestKey,
          progress: 'Live grid ready',
          grid: message.grid,
          error: null,
        })
      }
      if (message.type === 'error') {
        setLiveHeatmap({
          status: 'error',
          requestKey,
          progress: '',
          grid: null,
          error: message.error ?? 'Live heat map calculation failed',
        })
      }
    }
    worker.onerror = (event) => {
      if (cancelled) return
      setLiveHeatmap({
        status: 'error',
        requestKey,
        progress: '',
        grid: null,
        error: event.message || 'Live heat map calculation failed',
      })
    }
    worker.postMessage({ type: 'compute', requestKey, options: { ...heatmapOptionState, factorWeights: heatmapFactorWeights } })
    return () => {
      cancelled = true
      worker.terminate()
    }
  }, [active, displayMode, gridHeatmap.data, heatmapOptionKey, heatmapOptionState])

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
    heatmapOptionState,
    setHeatmapOption,
    heatmapFactorWeights,
    setHeatmapFactorWeight,
    resetHeatmapFactorWeights,
    heatmapOptionKey,
    liveHeatmap,
    selectedHeatmapBandCounts,
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
  const heatmapLogic = useMemo(
    () => describeHeatmapLogic(walkability.heatmapOptionState),
    [walkability.heatmapOptionState],
  )

  return (
    <>
      <SidebarSection title="Walkability Variants" icon={Footprints} iconClassName="text-emerald-600">
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
            <div className="space-y-2">
              <div>
                <div className="text-xs font-medium text-foreground">Heat map options</div>
                <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  {walkability.selectedHeatmapVariant?.label ?? 'Citywide MI grid'}
                </div>
              </div>
              <div className="space-y-1.5">
                {HEATMAP_OPTIONS.map((option) => (
                  <label
                    key={option.key}
                    className="flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={walkability.heatmapOptionState[option.key]}
                      onChange={(event) => walkability.setHeatmapOption(option.key, event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-emerald-600"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium leading-4 text-foreground">{option.label}</span>
                      <span className="block leading-4 text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
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
          <StatGrid
            stats={[
              {
                label: 'cells',
                value: Object.values(walkability.selectedHeatmapBandCounts ?? {}).reduce((sum, count) => sum + count, 0).toLocaleString(),
              },
              { label: 'bins', value: '5' },
              { label: 'metres', value: formatNullableNumber(walkability.heatmapManifest.data?.cellSizeM ?? walkability.gridHeatmap.data?.cellSizeM) },
            ]}
          />
          ) : (
          <StatGrid
            stats={[
              { label: 'communities', value: walkability.features.length.toLocaleString() },
              { label: 'low score', value: formatNullableNumber(walkability.minScore) },
              { label: 'high score', value: formatNullableNumber(walkability.maxScore) },
            ]}
          />
          )}

          <InlineAlert>
            {walkability.displayMode === 'heatmap'
              ? 'Citywide binned Mobility Index grid recalculated in a browser Web Worker from projected JSTS source layers. The prebuilt grid remains visible while live scoring runs.'
              : walkability.selectedVariant?.description ?? 'Community walkability is recalculated from web-source layers.'}
          </InlineAlert>
          {walkability.displayMode === 'heatmap' && walkability.liveHeatmap.status === 'loading' && (
            <div className="text-xs text-muted-foreground">{walkability.liveHeatmap.progress || 'Live heat map recalculating'}</div>
          )}
          {walkability.displayMode === 'heatmap' && walkability.liveHeatmap.status === 'ready' && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400">Live browser-calculated grid active.</div>
          )}
          {walkability.displayMode === 'heatmap' && walkability.liveHeatmap.status === 'error' && (
            <InlineAlert tone="error">{walkability.liveHeatmap.error}</InlineAlert>
          )}
          {walkability.heatmapManifest.error && <InlineAlert tone="error">{walkability.heatmapManifest.error}</InlineAlert>}
          {walkability.gridHeatmap.error && <InlineAlert tone="error">{walkability.gridHeatmap.error}</InlineAlert>}
          {walkability.manifest.error && <InlineAlert tone="error">{walkability.manifest.error}</InlineAlert>}
          {walkability.data.error && <InlineAlert tone="error">{walkability.data.error}</InlineAlert>}
        </div>
      </SidebarSection>

      <SidebarSection title="Equation Builder" icon={Calculator} iconClassName="text-cyan-600">
        {walkability.displayMode === 'heatmap' ? (
          <div className="space-y-3 text-xs">
            <div className="rounded border border-border bg-background px-2.5 py-2">
              <div className="break-words font-mono text-[11px] leading-5 text-foreground">
                MI(cell) = SUM(weight_ref x term_ref)
              </div>
              <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                proximity term = 1[d &lt;= 400m] + 2[d &lt;= 250m] + 2[d &lt;= 100m]; association term = report points inside the source buffer.
              </div>
              <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Bands: 1 &lt;27.4, 2 &lt;45.7, 3 &lt;63.9, 4 &lt;82.2, 5 &gt;=82.2.
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">Live factor weights</div>
                <div className="text-[10px] leading-4 text-muted-foreground">
                  0 disables a report factor; 1 is report weight; 2 doubles it.
                </div>
              </div>
              <button
                type="button"
                onClick={walkability.resetHeatmapFactorWeights}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground"
                title="Reset factor weights"
                aria-label="Reset factor weights"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="max-h-[24rem] space-y-1.5 overflow-y-auto pr-1">
              {WALKABILITY_FACTOR_GROUPS.map((factor) => {
                const dropped = isFactorDroppedByOptions(factor.ref, walkability.heatmapOptionState)
                const value = walkability.heatmapFactorWeights[factor.ref] ?? 1
                return (
                  <label
                    key={factor.ref}
                    className="block rounded border border-border bg-background px-2 py-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-medium leading-4 text-foreground">
                          {factor.ref} · {factor.label}
                        </span>
                        <span className="block leading-4 text-muted-foreground">
                          {factor.group} · {factor.method}
                        </span>
                      </span>
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                        {dropped ? 'off' : `${value.toFixed(2)}x`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.25"
                      disabled={dropped}
                      value={value}
                      onChange={(event) => walkability.setHeatmapFactorWeight(factor.ref, Number(event.target.value))}
                      className="mt-1.5 h-2 w-full accent-emerald-600 disabled:opacity-40"
                    />
                  </label>
                )
              })}
            </div>

            <div className="rounded border border-border bg-muted/30 px-2.5 py-2">
              <div className="font-medium text-foreground">Active variant rules</div>
              <ul className="mt-1.5 space-y-1 leading-4 text-muted-foreground">
                {heatmapLogic.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="rounded border border-border bg-background px-2.5 py-2">
              <div className="break-words font-mono text-[11px] leading-5 text-foreground">
                score(community) = SUM(weight_metric x normalized_metric) / SUM(weight_metric)
              </div>
              <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Community polygons are a planning summary; switch to Raw MI heat map for the report-style live equation.
              </div>
            </div>
            <InlineAlert>
              {walkability.selectedVariant?.description ?? 'Community score uses the selected normalized metric weights.'}
            </InlineAlert>
          </div>
        )}
      </SidebarSection>

      {selectedCommunity && (
        <SidebarSection title="Selected Community">
          <SelectedItemCard
            title={selectedCommunity.properties.communityName}
            onClear={() => walkability.setSelectedCommunityId(null)}
            rows={[
              {
                label: walkability.selectedVariant?.label ?? 'Score',
                value: formatNullableNumber(Number(selectedCommunity.properties[walkability.selectedScoreField])),
              },
            ]}
          >
            <KeyValueRows
              className="mt-3"
              rows={[
                { label: 'Sidewalk km', value: formatNullableNumber(selectedCommunity.properties.sidewalkKm) },
                { label: 'Walkway km', value: formatNullableNumber(selectedCommunity.properties.walkwayKm) },
                { label: 'Intersections', value: selectedCommunity.properties.intersectionCount.toLocaleString() },
                { label: 'Transit stops', value: selectedCommunity.properties.transitStopCount.toLocaleString() },
                { label: 'Park amenities', value: selectedCommunity.properties.parkAmenityCount.toLocaleString() },
                { label: 'Pedestrian crashes', value: selectedCommunity.properties.pedestrianCrashCount.toLocaleString() },
                { label: 'Supplemental POIs', value: selectedCommunity.properties.supplementalPoiCount.toLocaleString() },
                { label: 'Crossings', value: selectedCommunity.properties.crossingCount.toLocaleString() },
                { label: 'Class-3 crosswalks', value: selectedCommunity.properties.class3CrosswalkCount.toLocaleString() },
              ]}
            />
          </SelectedItemCard>
        </SidebarSection>
      )}
    </>
  )
}

export function WalkabilitySourceNotes({ walkability }: { walkability: WalkabilityState }) {
  return (
    <>
      <p>Walkability variants updated {formatDate(walkability.manifest.data?.generatedAt)}.</p>
      {walkability.displayMode === 'heatmap' && (
        <p>
          Citywide MI grid {walkability.liveHeatmap.status === 'ready'
            ? `live recalculated ${formatDate(walkability.liveHeatmap.grid?.generatedAt)}`
            : `prebuilt fallback updated ${formatDate(walkability.gridHeatmap.data?.generatedAt)}`}.
        </p>
      )}
      <p>{walkability.manifest.data?.sourcePolicy ?? 'Web-source-only community scores from public map layers.'}</p>
      {walkability.displayMode === 'heatmap' && (walkability.gridHeatmap.data?.caveats ?? []).slice(0, 2).map((caveat) => (
        <p key={caveat}>{caveat}</p>
      ))}
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
  const grid = walkability.gridHeatmap.data
  const variantKey = walkability.selectedHeatmapVariant?.key ?? grid?.defaultVariant
  const liveGrid = walkability.liveHeatmap.status === 'ready' && walkability.liveHeatmap.requestKey === walkability.heatmapOptionKey
    ? walkability.liveHeatmap.grid
    : null

  useEffect(() => {
    const rows = liveGrid?.rows ?? grid?.rows
    const cols = liveGrid?.cols ?? grid?.cols
    const imageCoordinates = liveGrid?.imageCoordinates ?? grid?.imageCoordinates
    const rle = liveGrid?.rle ?? (variantKey && grid?.grids[variantKey])
    if (!isLoaded || !map || !rows || !cols || !imageCoordinates || !rle) return

    const canvas = document.createElement('canvas')
    canvas.width = cols
    canvas.height = rows
    const context = canvas.getContext('2d')
    if (!context) return

    const image = context.createImageData(cols, rows)
    const colors: Record<number, [number, number, number, number]> = {
      1: [79, 154, 214, 217],
      2: [158, 201, 156, 217],
      3: [245, 228, 81, 217],
      4: [232, 156, 74, 217],
      5: [211, 59, 59, 217],
    }
    let pixel = 0
    for (const [value, count] of rle) {
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
      coordinates: imageCoordinates,
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
  }, [grid, isLoaded, layerId, liveGrid, map, sourceId, variantKey])

  return null
}

export function WalkabilityLegend({ walkability }: { walkability: WalkabilityState }) {
  if (walkability.displayMode === 'heatmap') {
    return (
      <div className="w-full space-y-2 text-xs text-muted-foreground md:w-64">
        <div className="break-words font-medium leading-4 text-foreground">
          {walkability.liveHeatmap.status === 'ready' ? 'Live recalculated grid' : (walkability.selectedHeatmapVariant?.label ?? 'Citywide MI grid')}
        </div>
        <div className="grid grid-cols-5 overflow-hidden rounded-sm border border-border">
          <span className="block h-3" style={{ backgroundColor: '#4f9ad6' }} />
          <span className="block h-3" style={{ backgroundColor: '#9ec99c' }} />
          <span className="block h-3" style={{ backgroundColor: '#f5e451' }} />
          <span className="block h-3" style={{ backgroundColor: '#e89c4a' }} />
          <span className="block h-3" style={{ backgroundColor: '#d33b3b' }} />
        </div>
        <div className="flex items-center justify-between gap-1 text-[9px] tabular-nums sm:text-[10px]">
          <span>1-27</span>
          <span>28-45</span>
          <span>46-63</span>
          <span>64-82</span>
          <span>83-170</span>
        </div>
        <div>{Object.values(walkability.selectedHeatmapBandCounts ?? {}).reduce((sum, count) => sum + count, 0).toLocaleString()} non-pathlocked grid cells</div>
      </div>
    )
  }

  return (
    <div className="w-56 space-y-2 text-xs text-muted-foreground">
      <div className="font-medium text-foreground">{walkability.selectedVariant?.label ?? 'Walkability score'}</div>
      <MapGradientLegendItem
        colors={['#f97316', '#fde047', '#22c55e']}
        minLabel={formatNullableNumber(walkability.minScore)}
        maxLabel={formatNullableNumber(walkability.maxScore)}
      />
      <div>{walkability.features.length.toLocaleString()} community polygons</div>
    </div>
  )
}

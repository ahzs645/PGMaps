import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, ChevronDown, Footprints, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import {
  InlineAlert,
  KeyValueRows,
  MapGradientLegendItem,
  MapSteppedLegend,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { formatDate, formatNullableNumber, useJsonManifest } from './shared'
import {
  HEATMAP_DEFAULT_FACTOR_WEIGHTS,
  HEATMAP_OPTIONS,
  HEATMAP_REPORT_FIDELITY_OPTIONS,
  WALKABILITY_FACTOR_GROUPS,
  describeHeatmapLogic,
  factorWeightKey,
  isFactorDroppedByOptions,
  normalizeHeatmapOptions,
  optionsForHeatmapVariant,
  variantKeyForHeatmapOptions,
  type HeatmapFactorWeightState,
  type HeatmapOptionKey,
  type HeatmapOptionState,
} from './walkabilityFactors'

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
type WalkabilityFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  WalkabilityProperties
>
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

const WalkabilityDeckHeatmapLayer = lazy(() =>
  import('./WalkabilityDeckHeatmapLayer').then((module) => ({ default: module.WalkabilityDeckHeatmapLayer })),
)

export function useWalkabilityData(
  active: boolean,
  initialVariantId: string,
  initialDisplayMode: string | null,
  initialHeatmapVariantId: string | null,
) {
  const [selectedVariantId, setSelectedVariantIdState] = useState<string>(
    initialVariantId || WALKABILITY_DEFAULT_VARIANT,
  )
  const [displayMode, setDisplayModeState] = useState<WalkabilityDisplayMode>(
    initialDisplayMode === 'community' ? 'community' : WALKABILITY_DEFAULT_DISPLAY_MODE,
  )
  const [selectedHeatmapVariantId, setSelectedHeatmapVariantId] = useState<string>(
    initialHeatmapVariantId || WALKABILITY_DEFAULT_HEATMAP_VARIANT,
  )
  // null means "no user override yet"; the effective options derive from the
  // initial heat map variant once the grid manifest arrives.
  const [heatmapOptionOverride, setHeatmapOptionOverride] = useState<HeatmapOptionState | null>(null)
  const [heatmapFactorWeights, setHeatmapFactorWeights] = useState<HeatmapFactorWeightState>(() => ({
    ...HEATMAP_DEFAULT_FACTOR_WEIGHTS,
  }))
  const [liveHeatmap, setLiveHeatmap] = useState<WalkabilityLiveHeatmapState>({
    status: 'idle',
    requestKey: '',
    progress: '',
    grid: null,
    error: null,
  })
  const liveHeatmapWorkerRef = useRef<Worker | null>(null)
  const liveHeatmapDebounceRef = useRef<number | null>(null)
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null)
  const manifest = useJsonManifest<WalkabilityManifest>(active ? '/data/walkability/manifest.json' : null)
  const heatmapManifest = useJsonManifest<WalkabilityHeatmapManifest>(
    active ? '/data/walkability/heatmap/manifest.json' : null,
  )
  const gridHeatmap = useJsonManifest<WalkabilityGridData>(
    active ? (heatmapManifest.data?.citywideGrid?.path ?? '/data/walkability/heatmap/citywide_mi_grid.json') : null,
  )
  const data = useJsonManifest<WalkabilityFeatureCollection>(
    active ? (manifest.data?.output ?? '/data/walkability/community_walkability.geojson') : null,
  )

  const variants = useMemo(() => manifest.data?.variants ?? [], [manifest.data])
  const selectedVariant = useMemo(() => {
    if (!variants.length) return null
    return variants.find((variant) => variant.id === selectedVariantId) ?? variants[0]
  }, [selectedVariantId, variants])
  // The selection state holds the requested id; the effective id comes from
  // the resolved variant, so no state sync is needed when the manifest loads.
  const effectiveVariantId = selectedVariant?.id ?? selectedVariantId
  const setSelectedVariantId = useCallback((variantId: string) => {
    setSelectedVariantIdState(variantId)
    setSelectedCommunityId(null)
  }, [])
  const setDisplayMode = useCallback((mode: WalkabilityDisplayMode) => {
    setDisplayModeState(mode)
    if (mode === 'heatmap') setSelectedCommunityId(null)
  }, [])
  const selectedScoreField =
    WALKABILITY_SCORE_FIELD_BY_VARIANT[selectedVariant?.id ?? WALKABILITY_DEFAULT_VARIANT] ?? 'balancedScore'
  const features = useMemo(() => data.data?.features ?? [], [data.data])
  const heatmapVariants = useMemo(() => gridHeatmap.data?.variants ?? [], [gridHeatmap.data])
  const selectedHeatmapVariant = useMemo(() => {
    if (!heatmapVariants.length) return null
    return (
      heatmapVariants.find((variant) => variant.key === selectedHeatmapVariantId) ??
      heatmapVariants.find((variant) => variant.key === gridHeatmap.data?.defaultVariant) ??
      heatmapVariants[0]
    )
  }, [gridHeatmap.data?.defaultVariant, heatmapVariants, selectedHeatmapVariantId])
  const effectiveHeatmapVariantId = selectedHeatmapVariant?.key ?? selectedHeatmapVariantId
  const defaultHeatmapOptions = useMemo(() => {
    if (!heatmapVariants.length) return normalizeHeatmapOptions(HEATMAP_REPORT_FIDELITY_OPTIONS)
    const initialKey =
      initialHeatmapVariantId || gridHeatmap.data?.defaultVariant || WALKABILITY_DEFAULT_HEATMAP_VARIANT
    const initialVariant =
      heatmapVariants.find((variant) => variant.key === initialKey) ??
      heatmapVariants.find((variant) => variant.key === WALKABILITY_DEFAULT_HEATMAP_VARIANT) ??
      heatmapVariants.find((variant) => variant.key === gridHeatmap.data?.defaultVariant) ??
      heatmapVariants[0]
    return normalizeHeatmapOptions(optionsForHeatmapVariant(initialVariant))
  }, [gridHeatmap.data?.defaultVariant, heatmapVariants, initialHeatmapVariantId])
  const heatmapOptionState = heatmapOptionOverride ?? defaultHeatmapOptions
  const setHeatmapOption = (key: HeatmapOptionKey, checked: boolean) => {
    const requested = normalizeHeatmapOptions({ ...heatmapOptionState, [key]: checked })
    const nextVariantKey = variantKeyForHeatmapOptions(requested)
    setHeatmapOptionOverride(requested)
    if (heatmapVariants.some((variant) => variant.key === nextVariantKey)) {
      setSelectedHeatmapVariantId(nextVariantKey)
    }
  }
  const setHeatmapOptions = (options: HeatmapOptionState) => {
    const requested = normalizeHeatmapOptions(options)
    const nextVariantKey = variantKeyForHeatmapOptions(requested)
    setHeatmapOptionOverride(requested)
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
  const heatmapOptionKey = useMemo(
    () =>
      JSON.stringify({
        options: heatmapOptionState,
        factorWeights: factorWeightKey(heatmapFactorWeights),
      }),
    [heatmapFactorWeights, heatmapOptionState],
  )
  const selectedHeatmapBandCounts =
    liveHeatmap.status === 'ready' && liveHeatmap.requestKey === heatmapOptionKey
      ? liveHeatmap.grid?.bandCounts
      : selectedHeatmapVariant?.bandCounts
  const selectedCommunity = useMemo<WalkabilityFeature | null>(() => {
    if (!selectedCommunityId) return null
    return features.find((feature) => String(feature.properties.communityId) === selectedCommunityId) ?? null
  }, [selectedCommunityId, features])
  const scores = useMemo(
    () => features.map((feature) => Number(feature.properties[selectedScoreField])).filter(Number.isFinite),
    [selectedScoreField, features],
  )
  const minScore = scores.length ? Math.min(...scores) : 0
  const maxScore = scores.length ? Math.max(...scores) : 100
  const fillColor = useMemo(() => {
    const low = minScore
    const high = maxScore !== low ? maxScore : low + 1
    const mid = low + (high - low) / 2

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
    if (!active || displayMode !== 'heatmap' || !gridHeatmap.data) {
      if (liveHeatmapDebounceRef.current !== null) {
        window.clearTimeout(liveHeatmapDebounceRef.current)
        liveHeatmapDebounceRef.current = null
      }
      liveHeatmapWorkerRef.current?.terminate()
      liveHeatmapWorkerRef.current = null
      return
    }

    const requestKey = heatmapOptionKey
    let worker = liveHeatmapWorkerRef.current
    if (!worker) {
      worker = new Worker(new URL('./walkabilityLiveHeatmap.worker.js', import.meta.url), { type: 'module' })
      liveHeatmapWorkerRef.current = worker
    }

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        type: 'progress' | 'result' | 'error'
        requestKey: string
        progress?: string
        grid?: WalkabilityLiveGrid
        error?: string
        cache?: { inputReady?: boolean; maskCount?: number }
      }
      if (message.requestKey !== requestKey) return
      if (message.type === 'progress') {
        setLiveHeatmap({
          status: 'loading',
          requestKey,
          progress: message.progress ?? 'Loading source layers',
          grid: null,
          error: null,
        })
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
      setLiveHeatmap({
        status: 'error',
        requestKey,
        progress: '',
        grid: null,
        error: event.message || 'Live heat map calculation failed',
      })
    }

    if (liveHeatmapDebounceRef.current !== null) window.clearTimeout(liveHeatmapDebounceRef.current)
    liveHeatmapDebounceRef.current = window.setTimeout(() => {
      liveHeatmapDebounceRef.current = null
      worker?.postMessage({
        type: 'compute',
        requestKey,
        options: { ...heatmapOptionState, factorWeights: heatmapFactorWeights },
      })
    }, 300)

    return () => {
      if (liveHeatmapDebounceRef.current !== null) {
        window.clearTimeout(liveHeatmapDebounceRef.current)
        liveHeatmapDebounceRef.current = null
      }
    }
  }, [active, displayMode, gridHeatmap.data, heatmapFactorWeights, heatmapOptionKey, heatmapOptionState])

  useEffect(
    () => () => {
      if (liveHeatmapDebounceRef.current !== null) window.clearTimeout(liveHeatmapDebounceRef.current)
      liveHeatmapWorkerRef.current?.terminate()
      liveHeatmapWorkerRef.current = null
    },
    [],
  )

  // Until the worker reports in for the current request, the visible state is
  // a synthetic loading entry; this replaces a synchronous setState on launch.
  const liveHeatmapView = useMemo<WalkabilityLiveHeatmapState>(() => {
    if (active && displayMode === 'heatmap' && gridHeatmap.data && liveHeatmap.requestKey !== heatmapOptionKey) {
      return {
        status: 'loading',
        requestKey: heatmapOptionKey,
        progress: 'Loading source layers',
        grid: null,
        error: null,
      }
    }
    return liveHeatmap
  }, [active, displayMode, gridHeatmap.data, heatmapOptionKey, liveHeatmap])

  return {
    manifest,
    heatmapManifest,
    gridHeatmap,
    data,
    displayMode,
    setDisplayMode,
    variants,
    selectedVariant,
    selectedVariantId: effectiveVariantId,
    setSelectedVariantId,
    heatmapVariants,
    heatmapOptionState,
    setHeatmapOption,
    setHeatmapOptions,
    heatmapFactorWeights,
    setHeatmapFactorWeight,
    resetHeatmapFactorWeights,
    heatmapOptionKey,
    liveHeatmap: liveHeatmapView,
    selectedHeatmapBandCounts,
    selectedHeatmapVariant,
    selectedHeatmapVariantId: effectiveHeatmapVariantId,
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

const WALKABILITY_MODEL_PRESETS: Array<{
  key: string
  label: string
  description: string
  options: HeatmapOptionState
  weights?: Partial<HeatmapFactorWeightState>
}> = [
  {
    key: 'report',
    label: 'Report fidelity',
    description: 'Closest public-data reconstruction of the Pedestrian Network Study Mobility Index.',
    options: HEATMAP_REPORT_FIDELITY_OPTIONS,
  },
  {
    key: 'full',
    label: 'Full source model',
    description: 'Uses every available public and reconstructed factor without report-fidelity exclusions.',
    options: normalizeHeatmapOptions({
      dropGtfsHf: false,
      narrowCivic: false,
      narrowGrowth: false,
      dropPopAge: false,
      dropF0: false,
      dropC0: false,
      dropF8: false,
      dropSuppPoi: false,
      tightBuffer: false,
    }),
  },
  {
    key: 'access',
    label: 'Access emphasis',
    description: 'Prioritizes community destinations, services, parks, schools, and transit reach.',
    options: HEATMAP_REPORT_FIDELITY_OPTIONS,
    weights: Object.fromEntries(
      WALKABILITY_FACTOR_GROUPS.map((factor) => [
        factor.ref,
        ['Community activities', 'Community facilities', 'Community services', 'Environment mobility'].includes(
          factor.group,
        )
          ? 1.5
          : 0.5,
      ]),
    ),
  },
  {
    key: 'network',
    label: 'Network emphasis',
    description: 'Focuses on crossings, signals, transit corridors, and street-network association.',
    options: normalizeHeatmapOptions({ ...HEATMAP_REPORT_FIDELITY_OPTIONS, dropF0: false }),
    weights: Object.fromEntries(
      WALKABILITY_FACTOR_GROUPS.map((factor) => [
        factor.ref,
        ['Environment mobility', 'Environment routes'].includes(factor.group) ? 1.6 : 0.45,
      ]),
    ),
  },
]

function heatmapOptionsMatch(a: HeatmapOptionState, b: HeatmapOptionState) {
  return HEATMAP_OPTIONS.every((option) => a[option.key] === b[option.key])
}

function heatmapWeightsMatch(
  current: HeatmapFactorWeightState,
  expected: Partial<HeatmapFactorWeightState> | undefined,
) {
  return WALKABILITY_FACTOR_GROUPS.every((factor) => {
    const currentValue = Number(current[factor.ref] ?? 1)
    const expectedValue = Number(expected?.[factor.ref] ?? 1)
    return Math.abs(currentValue - expectedValue) < 0.001
  })
}

function activeWalkabilityPreset(walkability: WalkabilityState) {
  return (
    WALKABILITY_MODEL_PRESETS.find(
      (preset) =>
        heatmapOptionsMatch(walkability.heatmapOptionState, preset.options) &&
        heatmapWeightsMatch(walkability.heatmapFactorWeights, preset.weights),
    ) ?? null
  )
}

function WalkabilityBuilderControls({ walkability }: { walkability: WalkabilityState }) {
  const [sourceRulesOpen, setSourceRulesOpen] = useState(false)
  const [factorTermsOpen, setFactorTermsOpen] = useState(false)
  const [showDisabledTerms, setShowDisabledTerms] = useState(false)
  const activePreset = activeWalkabilityPreset(walkability)
  const activeFactors = WALKABILITY_FACTOR_GROUPS.filter(
    (factor) =>
      !isFactorDroppedByOptions(factor.ref, walkability.heatmapOptionState) &&
      (walkability.heatmapFactorWeights[factor.ref] ?? 1) > 0,
  )
  const activeRuleCount = HEATMAP_OPTIONS.filter((option) => walkability.heatmapOptionState[option.key]).length
  const visibleFactorTerms = WALKABILITY_FACTOR_GROUPS.filter(
    (factor) => showDisabledTerms || !isFactorDroppedByOptions(factor.ref, walkability.heatmapOptionState),
  )
  const heatmapLogic = describeHeatmapLogic(walkability.heatmapOptionState)

  const applyPreset = (preset: (typeof WALKABILITY_MODEL_PRESETS)[number]) => {
    walkability.setHeatmapOptions(preset.options)
    WALKABILITY_FACTOR_GROUPS.forEach((factor) => {
      walkability.setHeatmapFactorWeight(factor.ref, preset.weights?.[factor.ref] ?? 1)
    })
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Model</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">
              {activePreset?.label ?? 'Custom walkability index'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => applyPreset(WALKABILITY_MODEL_PRESETS[0])}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            title="Reset to report fidelity model"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {activePreset?.description ?? 'Custom factor weights and source rules are recalculated directly on the map.'}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {WALKABILITY_MODEL_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              className={cn(
                'rounded-md border px-2 py-1.5 text-left transition-colors',
                activePreset?.key === preset.key
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-100'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
              title={preset.description}
            >
              <span className="block truncate font-medium">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Equation</div>
            <div className="mt-0.5 break-words font-mono text-[11px] leading-5 text-foreground">
              MI(cell) = SUM(weight_ref x term_ref)
            </div>
          </div>
          <span className="shrink-0 rounded bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
            {activeFactors.length} active terms
          </span>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Proximity terms use cumulative 400m / 250m / 100m buffers. Area and line terms use report points inside
          source buffers.
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <button
          type="button"
          onClick={() => setSourceRulesOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
          aria-expanded={sourceRulesOpen}
        >
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Source Rules
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {activeRuleCount} active; open to change included logic.
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              !sourceRulesOpen && '-rotate-90',
            )}
          />
        </button>
        {sourceRulesOpen && (
          <div className="space-y-3 border-t border-border px-3 py-3">
            <div className="flex flex-wrap gap-1.5">
              {HEATMAP_OPTIONS.map((option) => {
                const active = walkability.heatmapOptionState[option.key]
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => walkability.setHeatmapOption(option.key, !active)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full border px-2 py-1 text-[10px] font-medium transition-colors',
                      active
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-100'
                        : 'border-input text-muted-foreground hover:text-foreground',
                    )}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div className="rounded border border-border bg-muted/30 px-2.5 py-2">
              <div className="font-medium text-foreground">Active rule logic</div>
              <ul className="mt-1.5 space-y-1 leading-4 text-muted-foreground">
                {heatmapLogic.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background">
        <button
          type="button"
          onClick={() => setFactorTermsOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
          aria-expanded={factorTermsOpen}
        >
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Factor Weights
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {activeFactors.length} active terms; open to tune A0-G5.
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              !factorTermsOpen && '-rotate-90',
            )}
          />
        </button>
        {factorTermsOpen && (
          <div className="border-t border-border px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] leading-4 text-muted-foreground">
                0 disables a factor; 1 is report weight; 2 doubles it.
              </div>
              <button
                type="button"
                onClick={() => setShowDisabledTerms((current) => !current)}
                className="shrink-0 rounded-full border border-input px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {showDisabledTerms ? 'Hide off' : 'Show off'}
              </button>
            </div>
            <div className="max-h-[24rem] space-y-1.5 overflow-y-auto pr-1">
              {visibleFactorTerms.map((factor) => {
                const dropped = isFactorDroppedByOptions(factor.ref, walkability.heatmapOptionState)
                const value = walkability.heatmapFactorWeights[factor.ref] ?? 1
                return (
                  <div key={factor.ref} className="block rounded border border-border bg-background px-2 py-1.5">
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
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function WalkabilitySidebar({
  walkability,
  showSelectedCommunity = true,
}: {
  walkability: WalkabilityState
  showSelectedCommunity?: boolean
}) {
  const selectedCommunity = walkability.selectedCommunity

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

          {walkability.displayMode === 'community' && (
            <label className="block text-xs font-medium text-foreground">
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
            </label>
          )}

          {walkability.displayMode === 'heatmap' ? (
            <StatGrid
              stats={[
                {
                  label: 'cells',
                  value: Object.values(walkability.selectedHeatmapBandCounts ?? {})
                    .reduce((sum, count) => sum + count, 0)
                    .toLocaleString(),
                },
                { label: 'bins', value: '5' },
                {
                  label: 'metres',
                  value: formatNullableNumber(
                    walkability.heatmapManifest.data?.cellSizeM ?? walkability.gridHeatmap.data?.cellSizeM,
                  ),
                },
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

          {walkability.displayMode === 'community' && (
            <InlineAlert>
              {walkability.selectedVariant?.description ??
                'Community walkability is recalculated from web-source layers.'}
            </InlineAlert>
          )}
          {walkability.displayMode === 'heatmap' && walkability.liveHeatmap.status === 'loading' && (
            <div className="text-xs text-muted-foreground">
              {walkability.liveHeatmap.progress || 'Live heat map recalculating'}
            </div>
          )}
          {walkability.displayMode === 'heatmap' && walkability.liveHeatmap.status === 'error' && (
            <InlineAlert tone="error">{walkability.liveHeatmap.error}</InlineAlert>
          )}
          {walkability.heatmapManifest.error && (
            <InlineAlert tone="error">{walkability.heatmapManifest.error}</InlineAlert>
          )}
          {walkability.gridHeatmap.error && <InlineAlert tone="error">{walkability.gridHeatmap.error}</InlineAlert>}
          {walkability.manifest.error && <InlineAlert tone="error">{walkability.manifest.error}</InlineAlert>}
          {walkability.data.error && <InlineAlert tone="error">{walkability.data.error}</InlineAlert>}
        </div>
      </SidebarSection>

      <SidebarSection title="Equation Builder" icon={Calculator} iconClassName="text-cyan-600">
        {walkability.displayMode === 'heatmap' ? (
          <div className="space-y-3">
            <WalkabilityBuilderControls walkability={walkability} />
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
              {walkability.selectedVariant?.description ??
                'Community score uses the selected normalized metric weights.'}
            </InlineAlert>
          </div>
        )}
      </SidebarSection>

      {showSelectedCommunity && selectedCommunity && (
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
                {
                  label: 'Pedestrian crashes',
                  value: selectedCommunity.properties.pedestrianCrashCount.toLocaleString(),
                },
                {
                  label: 'Supplemental POIs',
                  value: selectedCommunity.properties.supplementalPoiCount.toLocaleString(),
                },
                { label: 'Crossings', value: selectedCommunity.properties.crossingCount.toLocaleString() },
                {
                  label: 'Class-3 crosswalks',
                  value: selectedCommunity.properties.class3CrosswalkCount.toLocaleString(),
                },
              ]}
            />
          </SelectedItemCard>
        </SidebarSection>
      )}
    </>
  )
}

export function MobileWalkabilityFeatureCard({ walkability }: { walkability: WalkabilityState }) {
  const selectedCommunity = walkability.selectedCommunity
  if (!selectedCommunity) return null

  const scoreLabel = walkability.selectedVariant?.label ?? 'Score'
  const scoreValue = formatNullableNumber(Number(selectedCommunity.properties[walkability.selectedScoreField]))

  return (
    <MobileFeatureCard
      cardKey={selectedCommunity.properties.communityId}
      title={selectedCommunity.properties.communityName}
      subtitle={`${scoreLabel}: ${scoreValue}`}
      onClose={() => walkability.setSelectedCommunityId(null)}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <KeyValueRows
          rows={[
            { label: scoreLabel, value: scoreValue },
            { label: 'Sidewalk km', value: formatNullableNumber(selectedCommunity.properties.sidewalkKm) },
            { label: 'Walkway km', value: formatNullableNumber(selectedCommunity.properties.walkwayKm) },
            { label: 'Intersections', value: selectedCommunity.properties.intersectionCount.toLocaleString() },
            { label: 'Transit stops', value: selectedCommunity.properties.transitStopCount.toLocaleString() },
            { label: 'Park amenities', value: selectedCommunity.properties.parkAmenityCount.toLocaleString() },
            { label: 'Pedestrian crashes', value: selectedCommunity.properties.pedestrianCrashCount.toLocaleString() },
            { label: 'Crossings', value: selectedCommunity.properties.crossingCount.toLocaleString() },
          ]}
        />
      </div>
    </MobileFeatureCard>
  )
}

export function WalkabilitySourceNotes({ walkability }: { walkability: WalkabilityState }) {
  return (
    <>
      <p>Walkability variants updated {formatDate(walkability.manifest.data?.generatedAt)}.</p>
      {walkability.displayMode === 'heatmap' && (
        <p>
          Citywide MI grid{' '}
          {walkability.liveHeatmap.status === 'ready'
            ? `live recalculated ${formatDate(walkability.liveHeatmap.grid?.generatedAt)}`
            : `prebuilt fallback updated ${formatDate(walkability.gridHeatmap.data?.generatedAt)}`}
          .
        </p>
      )}
      {walkability.displayMode === 'heatmap' && (
        <div className="rounded-md border p-2 text-xs leading-5 border-border bg-muted/20 text-muted-foreground">
          Citywide binned Mobility Index grid recalculated in a browser Web Worker from projected JSTS source layers.
          The prebuilt grid remains visible while live scoring runs.
        </div>
      )}
      <p>{walkability.manifest.data?.sourcePolicy ?? 'Web-source-only community scores from public map layers.'}</p>
      {walkability.displayMode === 'heatmap' &&
        (walkability.gridHeatmap.data?.caveats ?? []).slice(0, 2).map((caveat) => <p key={caveat}>{caveat}</p>)}
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
      onFeatureClick={(id) => walkability.setSelectedCommunityId(walkability.selectedCommunityId === id ? null : id)}
    />
  )
}

function WalkabilityHeatmapLayer({ walkability }: { walkability: WalkabilityState }) {
  const grid = walkability.gridHeatmap.data
  const variantKey = walkability.selectedHeatmapVariant?.key ?? grid?.defaultVariant
  const liveGrid =
    walkability.liveHeatmap.status === 'ready' && walkability.liveHeatmap.requestKey === walkability.heatmapOptionKey
      ? walkability.liveHeatmap.grid
      : null
  const rows = liveGrid?.rows ?? grid?.rows
  const cols = liveGrid?.cols ?? grid?.cols
  const imageCoordinates = liveGrid?.imageCoordinates ?? grid?.imageCoordinates
  const rle = liveGrid?.rle ?? (variantKey && grid?.grids[variantKey])

  if (!rows || !cols || !imageCoordinates || !rle) return null

  return (
    <Suspense fallback={null}>
      <WalkabilityDeckHeatmapLayer
        rows={rows}
        cols={cols}
        imageCoordinates={imageCoordinates}
        rle={rle}
        layerKey={liveGrid ? walkability.heatmapOptionKey : (variantKey ?? 'walkability-grid')}
      />
    </Suspense>
  )
}

export function WalkabilityLegend({ walkability }: { walkability: WalkabilityState }) {
  if (walkability.displayMode === 'heatmap') {
    const bands = [
      { label: '1-27', color: '#4f9ad6' },
      { label: '28-45', color: '#9ec99c' },
      { label: '46-63', color: '#f5e451' },
      { label: '64-82', color: '#e89c4a' },
      { label: '83-170', color: '#d33b3b' },
    ]
    return (
      <div className="w-full space-y-2 text-xs text-muted-foreground md:w-64">
        <MapSteppedLegend bands={bands} />
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
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Footprints } from 'lucide-react'
import { MapFillLayer } from '@/components/ui/map-layers'
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

const WALKABILITY_SCORE_FIELD_BY_VARIANT: Record<string, keyof WalkabilityProperties> = {
  balanced: 'balancedScore',
  infrastructure: 'infrastructureScore',
  access: 'accessScore',
  safetyAdjusted: 'safetyAdjustedScore',
  supplementedLocal: 'supplementedLocalScore',
}

export function useWalkabilityData(active: boolean, initialVariantId: string) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(initialVariantId || WALKABILITY_DEFAULT_VARIANT)
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null)
  const manifest = useJsonManifest<WalkabilityManifest>(active ? '/data/walkability/manifest.json' : null)
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

  return {
    manifest,
    data,
    variants,
    selectedVariant,
    selectedVariantId,
    setSelectedVariantId,
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

          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
            {walkability.selectedVariant?.description ?? 'Community walkability is recalculated from web-source layers.'}
          </div>
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
      <p>{walkability.manifest.data?.sourcePolicy ?? 'Web-source-only community scores from public map layers.'}</p>
      {(walkability.manifest.data?.caveats ?? []).slice(0, 2).map((caveat) => (
        <p key={caveat}>{caveat}</p>
      ))}
    </>
  )
}

export function WalkabilityLayer({ walkability }: { walkability: WalkabilityState }) {
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

export function WalkabilityLegend({ walkability }: { walkability: WalkabilityState }) {
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

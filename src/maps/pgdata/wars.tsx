import { useEffect, useMemo, useState } from 'react'
import { PawPrint } from 'lucide-react'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatDate, useJsonManifest } from './shared'

interface WarsSpeciesSummary {
  name: string
  count: number
}

interface WarsYearSummary {
  year: number
  count: number
}

export interface WarsManifest {
  source: string
  sourcePage: string
  sourceLicense: string
  sourceCitation: string
  coverage: string
  generatedAt: string
  csv: string
  geojson: string
  rows: number
  totalQuantity: number
  yearStart: number | null
  yearEnd: number | null
  species: WarsSpeciesSummary[]
  years: WarsYearSummary[]
  fields: string[]
}

interface WarsCrashProperties {
  id: string
  accidentDate: string
  year: number
  timeOfKill: string
  nearestTown: string
  species: string
  sex: string
  age: string
  quantity: number
  serviceArea: number
  dataSet: string
  sourceFile: string
}

type WarsFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, WarsCrashProperties>
type WarsDisplayMode = 'points' | 'heatmap'

const ALL_SPECIES = 'all'
const RECENT_YEARS = 'recent'

function getWarsMarkerSize(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 1) return 8
  return Math.max(8, Math.min(24, 7 + Math.sqrt(quantity) * 6))
}

function getWarsFeatureKey(feature: GeoJSON.Feature<GeoJSON.Point, WarsCrashProperties>, index: number): string {
  return `${feature.properties.sourceFile}-${feature.properties.id}-${feature.properties.accidentDate}-${index}`
}

export function useWarsData(active: boolean, initialSpecies: string | null, initialDisplayMode: string | null = null) {
  const [selectedSpecies, setSelectedSpecies] = useState<string>(initialSpecies || ALL_SPECIES)
  const [displayMode, setDisplayMode] = useState<WarsDisplayMode>(initialDisplayMode === 'heatmap' ? 'heatmap' : 'points')
  const [yearMode, setYearMode] = useState<string>(RECENT_YEARS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const manifest = useJsonManifest<WarsManifest>(active ? '/data/wars/manifest.json' : null)
  const crashes = useJsonManifest<WarsFeatureCollection>(active && manifest.data ? manifest.data.geojson : null)
  const features = crashes.data?.features ?? []
  const yearEnd = manifest.data?.yearEnd ?? null
  const recentYearStart = yearEnd == null ? null : yearEnd - 9

  const filteredFeatures = useMemo(() => (
    features.filter((feature) => {
      if (selectedSpecies !== ALL_SPECIES && feature.properties.species !== selectedSpecies) return false
      if (yearMode === RECENT_YEARS && recentYearStart != null) return feature.properties.year >= recentYearStart
      return true
    })
  ), [features, recentYearStart, selectedSpecies, yearMode])

  const selectedCrash = useMemo(() => {
    if (!selectedId) return null
    return filteredFeatures.find((feature, index) => getWarsFeatureKey(feature, index) === selectedId) ?? null
  }, [filteredFeatures, selectedId])

  const totalQuantity = useMemo(() => (
    filteredFeatures.reduce((sum, feature) => sum + (Number(feature.properties.quantity) || 0), 0)
  ), [filteredFeatures])

  const heatmapData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: filteredFeatures.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        weight: Math.max(1, Number(feature.properties.quantity) || 1),
      },
    })),
  }), [filteredFeatures])

  useEffect(() => {
    setSelectedId(null)
  }, [selectedSpecies, yearMode])

  return {
    manifest,
    crashes,
    selectedSpecies,
    setSelectedSpecies,
    displayMode,
    setDisplayMode,
    yearMode,
    setYearMode,
    selectedId,
    setSelectedId,
    features,
    filteredFeatures,
    heatmapData,
    selectedCrash,
    totalQuantity,
    recentYearStart,
  }
}

export type WarsState = ReturnType<typeof useWarsData>

export function WarsSidebar({ wars }: { wars: WarsState }) {
  const manifest = wars.manifest.data
  const yearLabel = wars.yearMode === RECENT_YEARS && wars.recentYearStart && manifest?.yearEnd
    ? `${wars.recentYearStart}-${manifest.yearEnd}`
    : manifest?.yearStart && manifest.yearEnd
      ? `${manifest.yearStart}-${manifest.yearEnd}`
      : 'All years'

  return (
    <>
      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <PawPrint className="h-4 w-4 text-amber-700" />
          <h2 className="text-sm font-semibold text-foreground">Wildlife Accident Records</h2>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">
            Species
            <AppSelect
              value={wars.selectedSpecies}
              onValueChange={wars.setSelectedSpecies}
              options={[
                { value: ALL_SPECIES, label: 'All species' },
                ...(manifest?.species ?? []).slice(0, 40).map((species) => ({
                  value: species.name,
                  label: `${species.name} (${species.count.toLocaleString()})`,
                })),
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          <label className="block text-xs font-medium text-foreground">
            Years
            <AppSelect
              value={wars.yearMode}
              onValueChange={wars.setYearMode}
              options={[
                { value: RECENT_YEARS, label: 'Most recent 10 years' },
                { value: 'all', label: 'All years' },
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/30 p-1">
            {[
              { value: 'points' as const, label: 'Points' },
              { value: 'heatmap' as const, label: 'Heatmap' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => wars.setDisplayMode(option.value)}
                className={cn(
                  'h-8 rounded px-2 text-xs font-medium transition-colors',
                  wars.displayMode === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{wars.filteredFeatures.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">records</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{wars.totalQuantity.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">animals</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{yearLabel}</div>
              <div className="text-[10px] text-muted-foreground">period</div>
            </div>
          </div>

          {wars.crashes.error && <div className="text-xs text-red-500">{wars.crashes.error}</div>}
          {wars.manifest.error && <div className="text-xs text-red-500">{wars.manifest.error}</div>}
          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
            Records are filtered to WARS rows whose nearest town is Prince George and include mapped coordinates from the source spreadsheets.
          </div>
        </div>
      </div>

      {wars.selectedCrash && (
        <div className="border-b border-border p-4">
          <div className="mb-2 text-sm font-semibold text-foreground">Selected Record</div>
          <div className="rounded-md border border-border bg-background p-3 text-xs">
            <div className="font-semibold leading-5 text-foreground">{wars.selectedCrash.properties.species}</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Date</span>
              <span className="font-semibold text-foreground">{wars.selectedCrash.properties.accidentDate || 'Unknown'}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Quantity</span>
              <span className="font-semibold text-foreground">{wars.selectedCrash.properties.quantity.toLocaleString()}</span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Nearest town</span>
              <span className="max-w-[12rem] text-right text-foreground">{wars.selectedCrash.properties.nearestTown}</span>
            </div>
            <button
              type="button"
              onClick={() => wars.setSelectedId(null)}
              className="mt-3 text-xs font-medium text-amber-700 hover:text-amber-800 dark:text-amber-400"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function WarsSourceNotes({ wars }: { wars: WarsState }) {
  return (
    <>
      <p>WARS extracts updated {formatDate(wars.manifest.data?.generatedAt)}.</p>
      <p>{wars.manifest.data?.sourceCitation ?? 'BC Ministry of Transportation and Transit Wildlife Accident Reporting System.'}</p>
    </>
  )
}

export function WarsLayer({ wars }: { wars: WarsState }) {
  return (
    <>
      {wars.displayMode === 'heatmap' && (
        <MapHeatmapLayer
          data={wars.heatmapData}
          weight={['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 1], 1, 0.25, 4, 1]}
          intensityStops={[
            [8, 0.7],
            [11, 1.25],
            [14, 1.9],
          ]}
          radiusStops={[
            [8, 16],
            [11, 30],
            [14, 46],
          ]}
          opacity={[
            [8, 0.58],
            [14, 0.76],
          ]}
          colorRamp="crime"
        />
      )}

      {wars.displayMode === 'points' && wars.filteredFeatures.map((feature, index) => {
        const [longitude, latitude] = feature.geometry.coordinates
        const featureKey = getWarsFeatureKey(feature, index)
        const selected = wars.selectedId === featureKey
        const size = getWarsMarkerSize(feature.properties.quantity)

        return (
          <MapMarker
            key={featureKey}
            longitude={longitude}
            latitude={latitude}
            onClick={() => wars.setSelectedId(featureKey)}
          >
            <MarkerContent>
              <div
                className={cn(
                  'rounded-full border-2 border-white shadow-md transition-transform',
                  selected ? 'scale-125 bg-amber-800 ring-2 ring-amber-300' : 'bg-amber-600/85 hover:bg-amber-700',
                )}
                style={{ width: size, height: size }}
                title={`${feature.properties.species}: ${feature.properties.accidentDate || feature.properties.year}`}
              />
            </MarkerContent>
          </MapMarker>
        )
      })}
    </>
  )
}

export function WarsLegend({ wars }: { wars: WarsState }) {
  return (
    <div className="w-52 space-y-2 text-xs text-muted-foreground">
      <div className="font-medium text-foreground">
        {wars.selectedSpecies === ALL_SPECIES ? 'All species' : wars.selectedSpecies}
      </div>
      {wars.displayMode === 'points' ? (
        <div className="flex items-center justify-between gap-2">
          <span>Single</span>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-white bg-amber-600 shadow-sm" />
            <span className="h-4 w-4 rounded-full border border-white bg-amber-600 shadow-sm" />
            <span className="h-6 w-6 rounded-full border border-white bg-amber-600 shadow-sm" />
          </div>
          <span>Multiple</span>
        </div>
      ) : (
        <div>
          <div className="h-3 w-full rounded-sm border border-border bg-gradient-to-r from-cyan-300 via-yellow-300 to-red-600" aria-hidden="true" />
          <div className="mt-1 flex justify-between text-[10px]">
            <span>Lower density</span>
            <span>Higher density</span>
          </div>
        </div>
      )}
      <div>{wars.filteredFeatures.length.toLocaleString()} mapped records</div>
    </div>
  )
}

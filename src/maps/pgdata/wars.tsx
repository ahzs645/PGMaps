import { useCallback, useEffect, useMemo, useState } from 'react'
import { PawPrint } from 'lucide-react'
import { MapClusterLayer, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { AppSelect } from '@/components/ui/select'
import type { TimelineWindowOption } from '@/components/ui/timeline'
import { cn } from '@/lib/utils'
import { formatDate, useJsonManifest } from './shared'

export const WARS_TIMELINE_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 mo' },
  { value: 12, label: '1 yr' },
  { value: 60, label: '5 yr' },
  { value: -1, label: 'Cumul.' },
]

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

type WarsPointProperties = WarsCrashProperties & {
  featureKey: string
}

type WarsFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, WarsCrashProperties>

const ALL_SPECIES = 'all'
const ALL_YEARS = 'all'
const RECENT_YEARS = 'recent'

const SPECIES_COLORS: Record<string, string> = {
  Moose: '#92400e',
  Deer: '#d97706',
  Bear: '#171717',
  Elk: '#dc2626',
  Porcupine: '#525252',
  Coyote: '#facc15',
  Fox: '#ea580c',
  Wolf: '#1d4ed8',
  Beaver: '#15803d',
  Caribou: '#0d9488',
  Buffalo: '#7c2d12',
  Lynx: '#9333ea',
  Unknown: '#94a3b8',
}

const SPECIES_FALLBACK_COLORS = ['#0891b2', '#65a30d', '#db2777', '#0369a1', '#ca8a04', '#be185d', '#4338ca', '#059669']

function hashSpeciesName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function getSpeciesColor(species: string): string {
  if (SPECIES_COLORS[species]) return SPECIES_COLORS[species]
  return SPECIES_FALLBACK_COLORS[hashSpeciesName(species) % SPECIES_FALLBACK_COLORS.length]
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '')
  const full = cleaned.length === 3
    ? cleaned.split('').map((char) => char + char).join('')
    : cleaned

  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getWarsMarkerSize(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 1) return 8
  return Math.max(8, Math.min(24, 7 + Math.sqrt(quantity) * 6))
}

function getWarsFeatureKey(feature: GeoJSON.Feature<GeoJSON.Point, WarsCrashProperties>, index: number): string {
  return `${feature.properties.sourceFile}-${feature.properties.id}-${feature.properties.accidentDate}-${index}`
}

function parseAccidentDate(properties: WarsCrashProperties): Date | null {
  if (properties.accidentDate) {
    const parsed = new Date(properties.accidentDate)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  if (Number.isFinite(properties.year) && properties.year > 0) {
    return new Date(properties.year, 0, 1)
  }
  return null
}

export function useWarsData(
  active: boolean,
  initialSpecies: string | null,
  initialShowPoints: string | null = null,
  initialShowHeatmap: string | null = null,
) {
  const [selectedSpecies, setSelectedSpecies] = useState<string>(initialSpecies || ALL_SPECIES)
  const [showPoints, setShowPoints] = useState<boolean>(initialShowPoints !== '0')
  const [showHeatmap, setShowHeatmap] = useState<boolean>(initialShowHeatmap === '1')
  const [yearMode, setYearMode] = useState<string>(ALL_YEARS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(12)
  const manifest = useJsonManifest<WarsManifest>(active ? '/data/wars/manifest.json' : null)
  const crashes = useJsonManifest<WarsFeatureCollection>(active && manifest.data ? manifest.data.geojson : null)
  const features = crashes.data?.features ?? []
  const yearEnd = manifest.data?.yearEnd ?? null
  const recentYearStart = yearEnd == null ? null : yearEnd - 9

  const baseFilteredFeatures = useMemo(() => (
    features.filter((feature) => {
      if (selectedSpecies !== ALL_SPECIES && feature.properties.species !== selectedSpecies) return false
      if (yearMode === RECENT_YEARS && recentYearStart != null) return feature.properties.year >= recentYearStart
      return true
    })
  ), [features, recentYearStart, selectedSpecies, yearMode])

  const accidentDateRange = useMemo(() => {
    if (features.length === 0) {
      const now = new Date()
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    }
    let min: Date | null = null
    let max: Date | null = null
    for (const feature of features) {
      const date = parseAccidentDate(feature.properties)
      if (!date) continue
      if (!min || date < min) min = date
      if (!max || date > max) max = date
    }
    if (!min || !max) {
      const now = new Date()
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    }
    return { start: min, end: max }
  }, [features])

  useEffect(() => {
    if (timelineEnabled && !timelineDate && features.length > 0) {
      setTimelineDate(new Date(accidentDateRange.end.getFullYear(), accidentDateRange.end.getMonth(), 1))
    }
  }, [timelineEnabled, timelineDate, features.length, accidentDateRange.end])

  const timelineFilterRange = useMemo(() => {
    if (!timelineEnabled || !timelineDate) return null
    const isCumulative = timelineWindowSize === -1
    const startMonth = isCumulative
      ? new Date(accidentDateRange.start.getFullYear(), accidentDateRange.start.getMonth(), 1)
      : new Date(timelineDate.getFullYear(), timelineDate.getMonth(), 1)
    const monthsForward = isCumulative ? 1 : timelineWindowSize
    const endMonth = new Date(
      timelineDate.getFullYear(),
      timelineDate.getMonth() + monthsForward,
      0,
      23,
      59,
      59,
      999,
    )
    return { start: startMonth.getTime(), end: endMonth.getTime() }
  }, [timelineEnabled, timelineDate, timelineWindowSize, accidentDateRange.start])

  const filteredFeatures = useMemo(() => {
    if (!timelineFilterRange) return baseFilteredFeatures
    const { start, end } = timelineFilterRange
    return baseFilteredFeatures.filter((feature) => {
      const date = parseAccidentDate(feature.properties)
      if (!date) return false
      const t = date.getTime()
      return t >= start && t <= end
    })
  }, [baseFilteredFeatures, timelineFilterRange])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  const selectedCrash = useMemo(() => {
    if (!selectedId) return null
    return filteredFeatures.find((feature, index) => getWarsFeatureKey(feature, index) === selectedId) ?? null
  }, [filteredFeatures, selectedId])

  const totalQuantity = useMemo(() => (
    filteredFeatures.reduce((sum, feature) => sum + (Number(feature.properties.quantity) || 0), 0)
  ), [filteredFeatures])

  const speciesBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    filteredFeatures.forEach((feature) => {
      const name = feature.properties.species || 'Unknown'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, color: getSpeciesColor(name) }))
      .sort((a, b) => b.count - a.count)
  }, [filteredFeatures])

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
    showPoints,
    setShowPoints,
    showHeatmap,
    setShowHeatmap,
    yearMode,
    setYearMode,
    selectedId,
    setSelectedId,
    features,
    baseFilteredFeatures,
    filteredFeatures,
    heatmapData,
    selectedCrash,
    totalQuantity,
    speciesBreakdown,
    recentYearStart,
    timelineEnabled,
    setTimelineEnabled,
    timelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    accidentDateRange,
    handleTimelineDisable,
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PawPrint className="h-4 w-4 text-amber-700" />
            <h2 className="text-sm font-semibold text-foreground">Wildlife Accident Records</h2>
          </div>
          <button
            type="button"
            onClick={() => wars.setTimelineEnabled(!wars.timelineEnabled)}
            className={cn(
              'rounded border px-2 py-1 text-xs transition-colors',
              wars.timelineEnabled
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-input text-muted-foreground hover:text-foreground'
            )}
          >
            Timeline
          </button>
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
                { value: ALL_YEARS, label: 'All years' },
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => wars.setShowPoints(!wars.showPoints)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                wars.showPoints
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {wars.showPoints ? 'Hide points' : 'Show points'}
            </button>
            <button
              type="button"
              onClick={() => wars.setShowHeatmap(!wars.showHeatmap)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                wars.showHeatmap
                  ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              Heatmap
            </button>
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
  const collectionsBySpecies = useMemo(() => {
    const grouped = new Map<string, GeoJSON.FeatureCollection<GeoJSON.Point, WarsPointProperties>>()

    wars.filteredFeatures.forEach((feature, index) => {
      const species = feature.properties.species || 'Unknown'
      if (!grouped.has(species)) {
        grouped.set(species, {
          type: 'FeatureCollection',
          features: [],
        })
      }

      grouped.get(species)?.features.push({
        ...feature,
        properties: {
          ...feature.properties,
          species,
          featureKey: getWarsFeatureKey(feature, index),
        },
      })
    })

    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [wars.filteredFeatures])

  return (
    <>
      {wars.showHeatmap && (
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

      {wars.showPoints && collectionsBySpecies.map(([species, collection]) => {
        const color = getSpeciesColor(species)
        const clusterColors: [string, string, string] = [
          hexToRgba(color, 0.65),
          hexToRgba(color, 0.8),
          color,
        ]

        return (
          <MapClusterLayer<WarsPointProperties>
            key={species}
            data={collection}
            pointColor={color}
            clusterColors={clusterColors}
            clusterThresholds={[25, 100]}
            onPointClick={(feature) => {
              const featureKey = feature.properties?.featureKey
              if (featureKey) wars.setSelectedId(featureKey)
            }}
          />
        )
      })}

      {wars.showPoints && wars.selectedCrash && (() => {
        const [longitude, latitude] = wars.selectedCrash.geometry.coordinates
        const size = getWarsMarkerSize(wars.selectedCrash.properties.quantity)
        const color = getSpeciesColor(wars.selectedCrash.properties.species || 'Unknown')

        return (
          <MapMarker
            longitude={longitude}
            latitude={latitude}
          >
            <MarkerContent>
              <div
                className="rounded-full border-2 border-white shadow-md ring-2 ring-cyan-400"
                style={{ width: size, height: size, backgroundColor: color }}
                title={`${wars.selectedCrash.properties.species}: ${wars.selectedCrash.properties.accidentDate || wars.selectedCrash.properties.year}`}
              />
            </MarkerContent>
          </MapMarker>
        )
      })()}
    </>
  )
}

export function WarsLegend({ wars }: { wars: WarsState }) {
  return (
    <div className="w-56 space-y-2 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          {wars.selectedSpecies === ALL_SPECIES ? 'Species' : wars.selectedSpecies}
        </span>
        <span className="tabular-nums text-[10px]">{wars.filteredFeatures.length.toLocaleString()}</span>
      </div>
      {wars.showPoints && (
        <>
          {wars.speciesBreakdown.length === 0 ? (
            <div className="text-[10px] italic">No records in current filter.</div>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
              {wars.speciesBreakdown.map((entry) => (
                <li key={entry.name} className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-white shadow-sm"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="truncate text-foreground">{entry.name}</span>
                  </div>
                  <span className="shrink-0 tabular-nums text-[10px]">{entry.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <span>Single</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-white bg-muted-foreground/60 shadow-sm" />
              <span className="h-4 w-4 rounded-full border border-white bg-muted-foreground/60 shadow-sm" />
              <span className="h-6 w-6 rounded-full border border-white bg-muted-foreground/60 shadow-sm" />
            </div>
            <span>Multiple</span>
          </div>
        </>
      )}
      {wars.showHeatmap && (
        <div className={cn(wars.showPoints && 'border-t border-border pt-2')}>
          <div className="h-3 w-full rounded-sm border border-border bg-gradient-to-r from-cyan-300 via-yellow-300 to-red-600" aria-hidden="true" />
          <div className="mt-1 flex justify-between text-[10px]">
            <span>Lower density</span>
            <span>Higher density</span>
          </div>
          <div className="mt-2 text-[10px]">Heatmap aggregates all selected species.</div>
        </div>
      )}
      {!wars.showPoints && !wars.showHeatmap && (
        <div className="text-[10px] italic">Both layers are hidden.</div>
      )}
    </div>
  )
}

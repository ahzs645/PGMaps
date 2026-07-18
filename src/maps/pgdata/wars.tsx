import { useCallback, useMemo, useState } from 'react'
import { PawPrint } from 'lucide-react'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapHeatmapLayer, MapPieClusterLayer } from '@/components/ui/map-layers'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { InlineAlert, LegendItem, MapGradientLegendItem, MapLegendNote, MapSizeLegend, SelectedItemCard, SidebarSection, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import type { TimelineWindowOption } from '@/components/ui/timeline'
import { cn } from '@/lib/utils'
import { formatDate, useJsonManifest } from './shared'

export const WARS_TIMELINE_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 yr' },
  { value: 2, label: '2 yr' },
  { value: 5, label: '5 yr' },
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
  const [selectedSpecies, setSelectedSpeciesState] = useState<string>(initialSpecies || ALL_SPECIES)
  const [hiddenSpecies, setHiddenSpecies] = useState<string[]>([])
  const [showPoints, setShowPoints] = useState<boolean>(initialShowPoints !== '0')
  const [showHeatmap, setShowHeatmap] = useState<boolean>(initialShowHeatmap === '1')
  const [yearMode, setYearModeState] = useState<string>(ALL_YEARS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(1)
  const manifest = useJsonManifest<WarsManifest>(active ? '/data/wars/manifest.json' : null)
  const crashes = useJsonManifest<WarsFeatureCollection>(active && manifest.data ? manifest.data.geojson : null)
  const features = useMemo(() => crashes.data?.features ?? [], [crashes.data])
  // Changing the species or year filter invalidates the current selection, so
  // the setters clear it together instead of an effect doing it a render late.
  const setSelectedSpecies = useCallback((species: string) => {
    setSelectedSpeciesState(species)
    setSelectedId(null)
  }, [])
  const setYearMode = useCallback((mode: string) => {
    setYearModeState(mode)
    setSelectedId(null)
  }, [])
  const yearEnd = manifest.data?.yearEnd ?? null
  const recentYearStart = yearEnd == null ? null : yearEnd - 9

  const baseFilteredFeatures = useMemo(() => (
    features.filter((feature) => {
      const species = feature.properties.species || 'Unknown'
      if (hiddenSpecies.includes(species)) return false
      if (selectedSpecies !== ALL_SPECIES && species !== selectedSpecies) return false
      if (yearMode === RECENT_YEARS && recentYearStart != null) return feature.properties.year >= recentYearStart
      return true
    })
  ), [features, hiddenSpecies, recentYearStart, selectedSpecies, yearMode])

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

  // The scrub defaults to the most recent accident year until the user picks
  // one explicitly; deriving it avoids a state write when the timeline opens.
  const effectiveTimelineDate = useMemo(() => {
    if (timelineDate) return timelineDate
    return features.length > 0 ? new Date(accidentDateRange.end.getFullYear(), 0, 1) : null
  }, [timelineDate, features.length, accidentDateRange.end])

  const timelineFilterRange = useMemo(() => {
    if (!timelineEnabled || !effectiveTimelineDate) return null
    const timelineDate = effectiveTimelineDate
    const isCumulative = timelineWindowSize === -1
    const startYear = isCumulative ? accidentDateRange.start.getFullYear() : timelineDate.getFullYear()
    const endYear = isCumulative ? timelineDate.getFullYear() : timelineDate.getFullYear() + timelineWindowSize - 1
    return {
      start: new Date(startYear, 0, 1).getTime(),
      end: new Date(endYear, 11, 31, 23, 59, 59, 999).getTime(),
    }
  }, [timelineEnabled, effectiveTimelineDate, timelineWindowSize, accidentDateRange.start])

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

  const speciesLegendFeatures = useMemo(() => {
    const yearFiltered = features.filter((feature) => {
      if (yearMode === RECENT_YEARS && recentYearStart != null) return feature.properties.year >= recentYearStart
      return true
    })
    if (!timelineFilterRange) return yearFiltered
    const { start, end } = timelineFilterRange
    return yearFiltered.filter((feature) => {
      const date = parseAccidentDate(feature.properties)
      if (!date) return false
      const t = date.getTime()
      return t >= start && t <= end
    })
  }, [features, recentYearStart, timelineFilterRange, yearMode])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  const toggleSpeciesVisibility = useCallback((species: string) => {
    setHiddenSpecies((current) => (
      current.includes(species)
        ? current.filter((item) => item !== species)
        : [...current, species]
    ))
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

  const speciesLegendBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    speciesLegendFeatures.forEach((feature) => {
      const name = feature.properties.species || 'Unknown'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, color: getSpeciesColor(name) }))
      .sort((a, b) => b.count - a.count)
  }, [speciesLegendFeatures])

  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const feature of baseFilteredFeatures) {
      const date = parseAccidentDate(feature.properties)
      if (!date) continue
      const key = String(date.getFullYear())
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [baseFilteredFeatures])

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

  return {
    manifest,
    crashes,
    selectedSpecies,
    setSelectedSpecies,
    hiddenSpecies,
    toggleSpeciesVisibility,
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
    speciesLegendBreakdown,
    bucketCounts,
    recentYearStart,
    timelineEnabled,
    setTimelineEnabled,
    timelineDate: effectiveTimelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    accidentDateRange,
    handleTimelineDisable,
  }
}

export type WarsState = ReturnType<typeof useWarsData>

export function WarsLayerControls({ wars }: { wars: WarsState }) {
  return (
    <div className="flex items-center gap-1.5">
      <ToggleChip
        active={wars.showPoints}
        onClick={() => wars.setShowPoints(!wars.showPoints)}
      >
        {wars.showPoints ? 'Hide points' : 'Show points'}
      </ToggleChip>
      <ToggleChip
        active={wars.showHeatmap}
        onClick={() => wars.setShowHeatmap(!wars.showHeatmap)}
        tone="orange"
      >
        Heatmap
      </ToggleChip>
    </div>
  )
}

export function WarsSidebar({
  wars,
  showSelectedRecord = true,
}: {
  wars: WarsState
  showSelectedRecord?: boolean
}) {
  const manifest = wars.manifest.data
  const yearLabel = wars.yearMode === RECENT_YEARS && wars.recentYearStart && manifest?.yearEnd
    ? `${wars.recentYearStart}-${manifest.yearEnd}`
    : manifest?.yearStart && manifest.yearEnd
      ? `${manifest.yearStart}-${manifest.yearEnd}`
      : 'All years'

  return (
    <>
      <SidebarSection
        title="Wildlife Accident Records"
        icon={PawPrint}
        iconClassName="text-amber-700"
        actions={(
          <ToggleChip
            active={wars.timelineEnabled}
            onClick={() => wars.setTimelineEnabled(!wars.timelineEnabled)}
          >
            Timeline
          </ToggleChip>
        )}
      >
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
                  selectedLabel: species.name,
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

          <StatGrid
            stats={[
              { label: 'records', value: wars.filteredFeatures.length.toLocaleString() },
              { label: 'animals', value: wars.totalQuantity.toLocaleString() },
              { label: 'period', value: yearLabel },
            ]}
          />

          {wars.crashes.error && <InlineAlert tone="error">{wars.crashes.error}</InlineAlert>}
          {wars.manifest.error && <InlineAlert tone="error">{wars.manifest.error}</InlineAlert>}
          <InlineAlert>
            Records are filtered to WARS rows whose nearest town is Prince George and include mapped coordinates from the source spreadsheets.
          </InlineAlert>
        </div>
      </SidebarSection>

      {showSelectedRecord && wars.selectedCrash && (
        <SidebarSection title="Selected Record">
          <SelectedItemCard
            title={wars.selectedCrash.properties.species}
            onClear={() => wars.setSelectedId(null)}
            rows={[
              { label: 'Date', value: wars.selectedCrash.properties.accidentDate || 'Unknown' },
              { label: 'Quantity', value: wars.selectedCrash.properties.quantity.toLocaleString() },
              { label: 'Nearest town', value: wars.selectedCrash.properties.nearestTown },
            ]}
          />
        </SidebarSection>
      )}
    </>
  )
}

export function MobileWarsFeatureCard({ wars }: { wars: WarsState }) {
  const crash = wars.selectedCrash
  if (!crash) return null

  return (
    <MobileFeatureCard
      cardKey={wars.selectedId ?? crash.properties.id}
      title={crash.properties.species || 'Wildlife record'}
      subtitle={crash.properties.accidentDate || String(crash.properties.year)}
      onClose={() => wars.setSelectedId(null)}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Date</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {crash.properties.accidentDate || 'Unknown'}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Quantity</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {crash.properties.quantity.toLocaleString()}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Nearest town</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {crash.properties.nearestTown}
            </span>
          </div>
        </div>
      </div>
    </MobileFeatureCard>
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
  // Clusters render as species-split donut charts with the record count in
  // the centre (shared MapPieClusterLayer, as on the food map); wedge order
  // follows the speciesBreakdown so it matches the legend.
  const bandColors = useMemo(() => wars.speciesBreakdown.map((entry) => entry.color), [wars.speciesBreakdown])

  const clusterData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const bandIndexBySpecies = new Map(wars.speciesBreakdown.map((entry, index) => [entry.name, index]))
    return {
      type: 'FeatureCollection',
      features: wars.filteredFeatures.map((feature, index) => {
        const species = feature.properties.species || 'Unknown'
        return {
          type: 'Feature' as const,
          geometry: feature.geometry,
          properties: {
            color: getSpeciesColor(species),
            bandIndex: bandIndexBySpecies.get(species) ?? 0,
            featureKey: getWarsFeatureKey(feature, index),
          },
        }
      }),
    }
  }, [wars.filteredFeatures, wars.speciesBreakdown])

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

      {wars.showPoints && (
        <MapPieClusterLayer
          data={clusterData}
          bandColors={bandColors}
          onPointClick={(properties) => {
            const featureKey = String(properties.featureKey ?? '')
            if (featureKey) wars.setSelectedId(wars.selectedId === featureKey ? null : featureKey)
          }}
        />
      )}

      {wars.showPoints && wars.selectedCrash && (() => {
        const [longitude, latitude] = wars.selectedCrash.geometry.coordinates
        const size = getWarsMarkerSize(wars.selectedCrash.properties.quantity)
        const color = getSpeciesColor(wars.selectedCrash.properties.species || 'Unknown')

        return (
          <MapMarker
            longitude={longitude}
            latitude={latitude}
            onClick={() => wars.setSelectedId(null)}
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
    <div className="w-full space-y-1.5 text-xs text-muted-foreground md:w-56 md:space-y-2 md:text-xs">
      {wars.showPoints && (
        <>
          {wars.speciesLegendBreakdown.length === 0 ? (
            <MapLegendNote className="italic">No records in current filter.</MapLegendNote>
          ) : (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto pr-1 md:max-h-44 md:space-y-1">
              {wars.speciesLegendBreakdown.map((entry) => (
                <li key={entry.name}>
                  <LegendItem
                    color={entry.color}
                    label={entry.name}
                    active={!wars.hiddenSpecies.includes(entry.name)}
                    className="md:gap-2"
                    onClick={() => wars.toggleSpeciesVisibility(entry.name)}
                  />
                </li>
              ))}
            </ul>
          )}
          <MapSizeLegend
            className="border-t border-border pt-1.5 md:pt-2"
            minLabel="Single"
            maxLabel="Multiple"
            sizes={[8, 16, 24]}
            color="rgb(100 116 139 / 0.6)"
          />
        </>
      )}
      {wars.showHeatmap && (
        <div className={cn(wars.showPoints && 'border-t border-border pt-2')}>
          <MapGradientLegendItem colors={['#67e8f9', '#fde047', '#dc2626']} minLabel="Lower density" maxLabel="Higher density" />
          <div className="mt-2 text-xs">Heatmap aggregates all selected species.</div>
        </div>
      )}
      {!wars.showPoints && !wars.showHeatmap && (
        <MapLegendNote className="italic">Both layers are hidden.</MapLegendNote>
      )}
    </div>
  )
}

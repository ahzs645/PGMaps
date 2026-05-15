import { useCallback, useEffect, useMemo, useState } from 'react'
import { PawPrint } from 'lucide-react'
import { MapClusterLayer, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { InlineAlert, LegendItem, MapGradientLegendItem, SelectedItemCard, SidebarSection, StatGrid, ToggleChip } from '@/components/ui/map-panels'
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
  const [timelineWindowSize, setTimelineWindowSize] = useState(1)
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
      setTimelineDate(new Date(accidentDateRange.end.getFullYear(), 0, 1))
    }
  }, [timelineEnabled, timelineDate, features.length, accidentDateRange.end])

  const timelineFilterRange = useMemo(() => {
    if (!timelineEnabled || !timelineDate) return null
    const isCumulative = timelineWindowSize === -1
    const startYear = isCumulative ? accidentDateRange.start.getFullYear() : timelineDate.getFullYear()
    const endYear = isCumulative ? timelineDate.getFullYear() : timelineDate.getFullYear() + timelineWindowSize - 1
    return {
      start: new Date(startYear, 0, 1).getTime(),
      end: new Date(endYear, 11, 31, 23, 59, 59, 999).getTime(),
    }
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
    speciesLegendBreakdown,
    bucketCounts,
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

export function WarsSidebar({ wars }: { wars: WarsState }) {
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

      {wars.selectedCrash && (
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
    <div className="w-full space-y-1.5 text-[11px] text-muted-foreground md:w-56 md:space-y-2 md:text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          {wars.selectedSpecies === ALL_SPECIES ? 'Species' : wars.selectedSpecies}
        </span>
        <span className="tabular-nums text-[10px]">{wars.filteredFeatures.length.toLocaleString()}</span>
      </div>
      <div className="space-y-1">
        <LegendItem
          color="#64748b"
          label="Collision points"
          value={wars.filteredFeatures.length.toLocaleString()}
          active={wars.showPoints}
          onClick={() => wars.setShowPoints((current) => !current)}
        />
        <LegendItem
          color="#f97316"
          label="Collision heatmap"
          active={wars.showHeatmap}
          onClick={() => wars.setShowHeatmap((current) => !current)}
        />
      </div>
      {wars.showPoints && (
        <>
          {wars.speciesLegendBreakdown.length === 0 ? (
            <div className="text-[10px] italic">No records in current filter.</div>
          ) : (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto pr-1 md:max-h-44 md:space-y-1">
              {wars.speciesLegendBreakdown.map((entry) => (
                <li key={entry.name}>
                  <LegendItem
                    color={entry.color}
                    label={entry.name}
                    value={entry.count.toLocaleString()}
                    active={wars.selectedSpecies === ALL_SPECIES || wars.selectedSpecies === entry.name}
                    className="md:gap-2"
                    onClick={() => wars.setSelectedSpecies(wars.selectedSpecies === entry.name ? ALL_SPECIES : entry.name)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5 md:pt-2">
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
          <MapGradientLegendItem colors={['#67e8f9', '#fde047', '#dc2626']} minLabel="Lower density" maxLabel="Higher density" />
          <div className="mt-2 text-[10px]">Heatmap aggregates all selected species.</div>
        </div>
      )}
      {!wars.showPoints && !wars.showHeatmap && (
        <div className="text-[10px] italic">Both layers are hidden.</div>
      )}
    </div>
  )
}

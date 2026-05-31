import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { InlineAlert, LegendItem, MapGradientLegendItem, MapLegendNote, MapLegendSection, MapSizeLegend, SidebarSection, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import type { TimelineWindowOption } from '@/components/ui/timeline'
import { cn } from '@/lib/utils'
import { formatDate, useJsonManifest } from './shared'

export const ICBC_TIMELINE_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 yr' },
  { value: 2, label: '2 yr' },
  { value: 5, label: '5 yr' },
  { value: -1, label: 'Cumul.' },
]

interface IcbcManifestDataset {
  id: string
  title: string
  sourceUrl: string
  csv: string
  geojson: string
  rows: number
  geocodedRows: number
  yearStart?: number
  yearEnd?: number
  fields: string[]
}

export interface IcbcManifest {
  source: string
  sourceProfile: string
  sourceLicense: string
  city: string
  yearStart?: number
  yearEnd?: number
  generatedAt: string
  datasets: IcbcManifestDataset[]
}

interface IcbcCrashProperties {
  dataset: string
  datasetTitle: string
  year: number
  location: string
  municipality: string
  crashCount: number
  sourceLocationName: string
  geocodeMatchType: string
}

type IcbcCrashFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, IcbcCrashProperties>

const ICBC_DATASET_LABELS: Record<string, string> = {
  all_crashes: 'All crashes',
  car_crashes: 'Car crashes',
  pedestrian_crashes: 'Person crashes',
  cyclist_crashes: 'Bike crashes',
  motorcycle_crashes: 'Motorcycle crashes',
}

const ICBC_DATASET_HELP: Record<string, string> = {
  all_crashes: 'All ICBC reported crash locations.',
  car_crashes: 'Derived from all crashes by subtracting pedestrian, cyclist, and motorcycle crash counts at matching locations.',
  pedestrian_crashes: 'Crashes involving pedestrians.',
  cyclist_crashes: 'Crashes involving cyclists.',
  motorcycle_crashes: 'Crashes involving motorcycles.',
}

const ICBC_CRASH_TYPE_LEGEND = [
  { id: 'car_crashes', label: 'Car crashes', color: '#2563eb' },
  { id: 'pedestrian_crashes', label: 'Person crashes', color: '#dc2626' },
  { id: 'cyclist_crashes', label: 'Bike crashes', color: '#16a34a' },
  { id: 'motorcycle_crashes', label: 'Motorcycle crashes', color: '#9333ea' },
]

function getIcbcDatasetLabel(dataset: IcbcManifestDataset | null | undefined): string {
  if (!dataset) return 'Crash locations'
  return ICBC_DATASET_LABELS[dataset.id] ?? dataset.title
}

function getIcbcDatasetLabelById(datasetId: string, fallback: string): string {
  return ICBC_DATASET_LABELS[datasetId] ?? fallback
}

function getIcbcCrashTypeColor(datasetId: string): string {
  return ICBC_CRASH_TYPE_LEGEND.find((item) => item.id === datasetId)?.color ?? '#f97316'
}

function getIcbcMarkerSize(crashCount: number, maxCrashCount: number): number {
  if (!Number.isFinite(crashCount) || crashCount <= 0) return 8
  if (!Number.isFinite(maxCrashCount) || maxCrashCount <= 0) return 8
  return Math.max(8, Math.min(28, 7 + Math.sqrt(crashCount / maxCrashCount) * 22))
}

function getIcbcLocationKey(feature: GeoJSON.Feature<GeoJSON.Point, IcbcCrashProperties>): string {
  return `${feature.properties.dataset}:${feature.properties.location}`
}

function aggregateIcbcCrashFeatures(
  features: Array<GeoJSON.Feature<GeoJSON.Point, IcbcCrashProperties>>,
  timelineEnabled: boolean,
  timelineDate: Date | null,
  timelineWindowSize: number,
  yearStart: number | null,
) {
  let filtered = features
  if (timelineEnabled && timelineDate) {
    const currentYear = timelineDate.getFullYear()
    const isCumulative = timelineWindowSize === -1
    const rangeStart = isCumulative ? (yearStart ?? currentYear) : currentYear
    const rangeEnd = isCumulative ? currentYear : currentYear + timelineWindowSize - 1
    filtered = features.filter((feature) => {
      const year = feature.properties.year
      return year >= rangeStart && year <= rangeEnd
    })
  }

  const byLocation = new Map<string, typeof features[number]>()
  for (const feature of filtered) {
    const key = getIcbcLocationKey(feature)
    const existing = byLocation.get(key)
    if (existing) {
      existing.properties = {
        ...existing.properties,
        crashCount: existing.properties.crashCount + feature.properties.crashCount,
      }
    } else {
      byLocation.set(key, {
        ...feature,
        properties: { ...feature.properties },
      })
    }
  }
  return Array.from(byLocation.values())
}

export function useIcbcData(
  active: boolean,
  initialDatasetId: string | null,
  initialShowPoints: string | null = null,
  initialShowHeatmap: string | null = null,
) {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(initialDatasetId)
  const [showPoints, setShowPoints] = useState<boolean>(initialShowPoints !== '0')
  const [showHeatmap, setShowHeatmap] = useState<boolean>(initialShowHeatmap === '1')
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(1)
  const manifest = useJsonManifest<IcbcManifest>(active ? '/data/icbc/manifest.json' : null)
  const datasets = manifest.data?.datasets ?? []
  const selectedDataset = useMemo(() => {
    if (!datasets.length) return null
    if (selectedDatasetId) {
      const selected = datasets.find((dataset) => dataset.id === selectedDatasetId)
      if (selected) return selected
    }
    return datasets[0]
  }, [datasets, selectedDatasetId])
  const crashes = useJsonManifest<IcbcCrashFeatureCollection>(
    active && selectedDataset ? selectedDataset.geojson : null,
  )
  const carCrashes = useJsonManifest<IcbcCrashFeatureCollection>(
    active && selectedDataset?.id === 'all_crashes' ? '/data/icbc/prince_george_car_crashes.geojson' : null,
  )
  const pedestrianCrashes = useJsonManifest<IcbcCrashFeatureCollection>(
    active && selectedDataset?.id === 'all_crashes' ? '/data/icbc/prince_george_pedestrian_crashes.geojson' : null,
  )
  const cyclistCrashes = useJsonManifest<IcbcCrashFeatureCollection>(
    active && selectedDataset?.id === 'all_crashes' ? '/data/icbc/prince_george_cyclist_crashes.geojson' : null,
  )
  const motorcycleCrashes = useJsonManifest<IcbcCrashFeatureCollection>(
    active && selectedDataset?.id === 'all_crashes' ? '/data/icbc/prince_george_motorcycle_crashes.geojson' : null,
  )
  const rawCrashFeatures = crashes.data?.features ?? []

  const yearStart = manifest.data?.yearStart ?? selectedDataset?.yearStart ?? null
  const yearEnd = manifest.data?.yearEnd ?? selectedDataset?.yearEnd ?? null

  const crashDateRange = useMemo(() => {
    if (yearStart != null && yearEnd != null) {
      return {
        start: new Date(yearStart, 0, 1),
        end: new Date(yearEnd, 0, 1),
      }
    }
    const now = new Date()
    return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 0, 1) }
  }, [yearStart, yearEnd])

  // Default the scrub to the most recent available year when the timeline opens.
  useEffect(() => {
    if (timelineEnabled && !timelineDate && yearEnd != null) {
      setTimelineDate(new Date(yearEnd, 0, 1))
    }
  }, [timelineEnabled, timelineDate, yearEnd])

  const crashFeatures = useMemo(() => {
    return aggregateIcbcCrashFeatures(rawCrashFeatures, timelineEnabled, timelineDate, timelineWindowSize, yearStart)
  }, [rawCrashFeatures, timelineEnabled, timelineDate, timelineWindowSize, yearStart])

  const typedCrashFeatures = useMemo(() => {
    if (selectedDataset?.id !== 'all_crashes') return crashFeatures
    return [
      ...aggregateIcbcCrashFeatures(carCrashes.data?.features ?? [], timelineEnabled, timelineDate, timelineWindowSize, yearStart),
      ...aggregateIcbcCrashFeatures(pedestrianCrashes.data?.features ?? [], timelineEnabled, timelineDate, timelineWindowSize, yearStart),
      ...aggregateIcbcCrashFeatures(cyclistCrashes.data?.features ?? [], timelineEnabled, timelineDate, timelineWindowSize, yearStart),
      ...aggregateIcbcCrashFeatures(motorcycleCrashes.data?.features ?? [], timelineEnabled, timelineDate, timelineWindowSize, yearStart),
    ]
  }, [
    carCrashes.data?.features,
    crashFeatures,
    cyclistCrashes.data?.features,
    motorcycleCrashes.data?.features,
    pedestrianCrashes.data?.features,
    selectedDataset?.id,
    timelineDate,
    timelineEnabled,
    timelineWindowSize,
    yearStart,
  ])

  // Per-year totals across the dataset (regardless of current scrub) — used to render the histogram.
  const yearCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const feature of rawCrashFeatures) {
      const key = String(feature.properties.year)
      counts.set(key, (counts.get(key) ?? 0) + (Number(feature.properties.crashCount) || 0))
    }
    return counts
  }, [rawCrashFeatures])

  const selectedCrash = useMemo(() => {
    if (!selectedLocation) return null
    return typedCrashFeatures.find((feature) => getIcbcLocationKey(feature) === selectedLocation) ?? null
  }, [selectedLocation, typedCrashFeatures])
  const maxCrashCount = useMemo(() => (
    crashFeatures.reduce((max, feature) => Math.max(max, Number(feature.properties.crashCount) || 0), 0)
  ), [crashFeatures])
  const totalCrashes = useMemo(() => (
    crashFeatures.reduce((sum, feature) => sum + (Number(feature.properties.crashCount) || 0), 0)
  ), [crashFeatures])
  const heatmapData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: crashFeatures.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        weight: Math.max(1, Number(feature.properties.crashCount) || 1),
      },
    })),
  }), [crashFeatures])

  useEffect(() => {
    if (!selectedDataset && datasets[0]) {
      setSelectedDatasetId(datasets[0].id)
      return
    }
    if (selectedDataset && selectedDatasetId !== selectedDataset.id) {
      setSelectedDatasetId(selectedDataset.id)
    }
  }, [datasets, selectedDataset, selectedDatasetId])

  useEffect(() => {
    setSelectedLocation(null)
  }, [selectedDatasetId])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  return {
    manifest,
    crashes,
    datasets,
    selectedDataset,
    selectedDatasetId,
    setSelectedDatasetId,
    showPoints,
    setShowPoints,
    showHeatmap,
    setShowHeatmap,
    selectedLocation,
    setSelectedLocation,
    crashFeatures,
    typedCrashFeatures,
    heatmapData,
    selectedCrash,
    maxCrashCount,
    totalCrashes,
    timelineEnabled,
    setTimelineEnabled,
    timelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    crashDateRange,
    yearCounts,
    handleTimelineDisable,
  }
}

export type IcbcState = ReturnType<typeof useIcbcData>

export function IcbcLayerControls({ icbc }: { icbc: IcbcState }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleChip
        active={icbc.showPoints}
        onClick={() => icbc.setShowPoints(!icbc.showPoints)}
      >
        {icbc.showPoints ? 'Hide points' : 'Show points'}
      </ToggleChip>
      <ToggleChip
        active={icbc.showHeatmap}
        onClick={() => icbc.setShowHeatmap(!icbc.showHeatmap)}
        tone="orange"
      >
        Heatmap
      </ToggleChip>
      <ToggleChip
        active={icbc.timelineEnabled}
        onClick={() => icbc.setTimelineEnabled(!icbc.timelineEnabled)}
      >
        Timeline
      </ToggleChip>
    </div>
  )
}

export function IcbcSidebar({
  icbc,
  showSelectedLocation = true,
}: {
  icbc: IcbcState
  showSelectedLocation?: boolean
}) {
  return (
    <>
      <SidebarSection title="ICBC Crash Locations" icon={ShieldAlert} iconClassName="text-rose-600">
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">
            Crash type
            <AppSelect
              value={icbc.selectedDataset?.id ?? ''}
              onValueChange={icbc.setSelectedDatasetId}
              options={icbc.datasets.map((dataset) => ({
                value: dataset.id,
                label: getIcbcDatasetLabel(dataset),
              }))}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          <StatGrid
            stats={[
              { label: 'rows', value: icbc.selectedDataset?.rows.toLocaleString() ?? '0' },
              { label: 'mapped', value: icbc.crashFeatures.length.toLocaleString() },
              { label: 'crashes', value: icbc.totalCrashes.toLocaleString() },
            ]}
          />

          {icbc.crashes.error && <InlineAlert tone="error">{icbc.crashes.error}</InlineAlert>}
          {icbc.manifest.error && <InlineAlert tone="error">{icbc.manifest.error}</InlineAlert>}
          <InlineAlert>
            {icbc.selectedDataset ? ICBC_DATASET_HELP[icbc.selectedDataset.id] : 'ICBC crash-location summaries.'} Locations are matched to CityPG road-intersection centroids where possible.
          </InlineAlert>
        </div>
      </SidebarSection>

      {showSelectedLocation && <IcbcSelectedLocationSection icbc={icbc} />}
    </>
  )
}

export function IcbcSelectedLocationSection({ icbc }: { icbc: IcbcState }) {
  if (!icbc.selectedCrash) return null

  return (
    <section className="border-b border-border bg-background/95 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground">Selected Location</h2>
        </div>
      </div>
      <div className="rounded-md border p-3 text-xs border-border bg-background text-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold leading-5">{icbc.selectedCrash.properties.location}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="shrink-0 transition-colors hover:text-foreground text-muted-foreground"
              aria-label="Clear selection"
              onClick={() => icbc.setSelectedLocation(null)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="space-y-1 text-xs mt-2">
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Crash type</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {getIcbcDatasetLabelById(icbc.selectedCrash.properties.dataset, icbc.selectedCrash.properties.datasetTitle)}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Crash count</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {icbc.selectedCrash.properties.crashCount.toLocaleString()}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Matched to</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {icbc.selectedCrash.properties.sourceLocationName}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

export function MobileIcbcFeatureCard({ icbc }: { icbc: IcbcState }) {
  const crash = icbc.selectedCrash
  if (!crash) return null

  const crashType = getIcbcDatasetLabelById(crash.properties.dataset, crash.properties.datasetTitle)

  return (
    <MobileFeatureCard
      cardKey={getIcbcLocationKey(crash)}
      title={crash.properties.location}
      subtitle={crashType}
      onClose={() => icbc.setSelectedLocation(null)}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Crash type</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">{crashType}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Crash count</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {crash.properties.crashCount.toLocaleString()}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Matched to</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {crash.properties.sourceLocationName}
            </span>
          </div>
        </div>
      </div>
    </MobileFeatureCard>
  )
}

export function IcbcSourceNotes({ icbc }: { icbc: IcbcState }) {
  return (
    <>
      <p>ICBC exports updated {formatDate(icbc.manifest.data?.generatedAt)}.</p>
      {icbc.selectedDataset && (
        <p>{icbc.selectedDataset.geocodedRows.toLocaleString()} of {icbc.selectedDataset.rows.toLocaleString()} source rows have map coordinates.</p>
      )}
    </>
  )
}

export function IcbcLayer({ icbc }: { icbc: IcbcState }) {
  return (
    <>
      {icbc.showHeatmap && (
        <MapHeatmapLayer
          data={icbc.heatmapData}
          weight={['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 1], 1, 0.15, Math.max(icbc.maxCrashCount, 1), 1]}
          intensityStops={[
            [8, 0.8],
            [11, 1.35],
            [14, 2.1],
          ]}
          radiusStops={[
            [8, 18],
            [11, 34],
            [14, 52],
          ]}
          opacity={[
            [8, 0.62],
            [14, 0.78],
          ]}
          colorRamp="crime"
        />
      )}

      {icbc.showPoints && icbc.typedCrashFeatures.map((feature) => {
        const [longitude, latitude] = feature.geometry.coordinates
        const size = getIcbcMarkerSize(feature.properties.crashCount, icbc.maxCrashCount)
        const color = getIcbcCrashTypeColor(feature.properties.dataset)
        const locationKey = getIcbcLocationKey(feature)
        const selected = icbc.selectedLocation === locationKey

        return (
          <MapMarker
            key={locationKey}
            longitude={longitude}
            latitude={latitude}
            onClick={() => icbc.setSelectedLocation(selected ? null : locationKey)}
          >
            <MarkerContent>
              <div
                className={cn(
                  'rounded-full border-2 border-white shadow-md transition-transform',
                  selected ? 'scale-125 ring-2 ring-sky-300' : 'hover:brightness-110',
                )}
                style={{ width: size, height: size, backgroundColor: color, opacity: selected ? 1 : 0.9 }}
                title={`${feature.properties.location}: ${feature.properties.crashCount.toLocaleString()} crashes`}
              />
            </MarkerContent>
          </MapMarker>
        )
      })}
    </>
  )
}

export function IcbcLegend({ icbc }: { icbc: IcbcState }) {
  return (
    <div className="w-52 space-y-2 text-xs text-muted-foreground">
      <div className="font-medium text-foreground">{getIcbcDatasetLabel(icbc.selectedDataset)}</div>
      {icbc.showPoints && (
        <div className="space-y-2">
          <MapLegendSection title="Crash type" columns={2}>
            {ICBC_CRASH_TYPE_LEGEND.map((item) => (
              <LegendItem key={item.label} color={item.color} label={item.label} />
            ))}
          </MapLegendSection>
          <MapSizeLegend className="border-t border-border pt-2" minLabel="Small" maxLabel="High" />
        </div>
      )}
      {icbc.showHeatmap && (
        <div className="border-t border-border pt-2">
          <MapGradientLegendItem colors={['#7dd3fc', '#fde047', '#dc2626']} minLabel="Lower density" maxLabel="Higher density" />
        </div>
      )}
      {!icbc.showPoints && !icbc.showHeatmap && (
        <MapLegendNote className="italic">Both layers are hidden.</MapLegendNote>
      )}
    </div>
  )
}

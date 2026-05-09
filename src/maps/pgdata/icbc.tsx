import { useEffect, useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatDate, useJsonManifest } from './shared'

interface IcbcManifestDataset {
  id: string
  title: string
  sourceUrl: string
  csv: string
  geojson: string
  rows: number
  geocodedRows: number
  fields: string[]
}

export interface IcbcManifest {
  source: string
  sourceProfile: string
  sourceLicense: string
  city: string
  generatedAt: string
  datasets: IcbcManifestDataset[]
}

interface IcbcCrashProperties {
  dataset: string
  datasetTitle: string
  location: string
  municipality: string
  crashCount: number
  sourceLocationName: string
  geocodeMatchType: string
}

type IcbcCrashFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, IcbcCrashProperties>

const ICBC_DATASET_LABELS: Record<string, string> = {
  all_crashes: 'All crashes',
  pedestrian_crashes: 'Person crashes',
  cyclist_crashes: 'Bike crashes',
  motorcycle_crashes: 'Motorcycle crashes',
}

const ICBC_DATASET_HELP: Record<string, string> = {
  all_crashes: 'All ICBC reported crash locations. ICBC does not expose a car-only field in this downloaded layer.',
  pedestrian_crashes: 'Crashes involving pedestrians.',
  cyclist_crashes: 'Crashes involving cyclists.',
  motorcycle_crashes: 'Crashes involving motorcycles.',
}

function getIcbcDatasetLabel(dataset: IcbcManifestDataset | null | undefined): string {
  if (!dataset) return 'Crash locations'
  return ICBC_DATASET_LABELS[dataset.id] ?? dataset.title
}

function getIcbcMarkerSize(crashCount: number, maxCrashCount: number): number {
  if (!Number.isFinite(crashCount) || crashCount <= 0) return 8
  if (!Number.isFinite(maxCrashCount) || maxCrashCount <= 0) return 8
  return Math.max(8, Math.min(28, 7 + Math.sqrt(crashCount / maxCrashCount) * 22))
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
  const crashFeatures = crashes.data?.features ?? []
  const selectedCrash = useMemo(() => {
    if (!selectedLocation) return null
    return crashFeatures.find((feature) => feature.properties.location === selectedLocation) ?? null
  }, [crashFeatures, selectedLocation])
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
    heatmapData,
    selectedCrash,
    maxCrashCount,
    totalCrashes,
  }
}

export type IcbcState = ReturnType<typeof useIcbcData>

export function IcbcSidebar({ icbc }: { icbc: IcbcState }) {
  return (
    <>
      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-600" />
          <h2 className="text-sm font-semibold text-foreground">ICBC Crash Locations</h2>
        </div>
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

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => icbc.setShowPoints(!icbc.showPoints)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                icbc.showPoints
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {icbc.showPoints ? 'Hide points' : 'Show points'}
            </button>
            <button
              type="button"
              onClick={() => icbc.setShowHeatmap(!icbc.showHeatmap)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                icbc.showHeatmap
                  ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              Heatmap
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{icbc.selectedDataset?.rows.toLocaleString() ?? '0'}</div>
              <div className="text-[10px] text-muted-foreground">rows</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{icbc.crashFeatures.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">mapped</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{icbc.totalCrashes.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">crashes</div>
            </div>
          </div>

          {icbc.crashes.error && <div className="text-xs text-red-500">{icbc.crashes.error}</div>}
          {icbc.manifest.error && <div className="text-xs text-red-500">{icbc.manifest.error}</div>}
          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
            {icbc.selectedDataset ? ICBC_DATASET_HELP[icbc.selectedDataset.id] : 'ICBC crash-location summaries.'} Locations are matched to CityPG road-intersection centroids where possible.
          </div>
        </div>
      </div>

      {icbc.selectedCrash && (
        <div className="border-b border-border p-4">
          <div className="mb-2 text-sm font-semibold text-foreground">Selected Location</div>
          <div className="rounded-md border border-border bg-background p-3 text-xs">
            <div className="font-semibold leading-5 text-foreground">{icbc.selectedCrash.properties.location}</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Crash count</span>
              <span className="font-semibold text-foreground">{icbc.selectedCrash.properties.crashCount.toLocaleString()}</span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Matched to</span>
              <span className="max-w-[12rem] text-right text-foreground">{icbc.selectedCrash.properties.sourceLocationName}</span>
            </div>
            <button
              type="button"
              onClick={() => icbc.setSelectedLocation(null)}
              className="mt-3 text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </>
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

      {icbc.showPoints && icbc.crashFeatures.map((feature) => {
        const [longitude, latitude] = feature.geometry.coordinates
        const size = getIcbcMarkerSize(feature.properties.crashCount, icbc.maxCrashCount)
        const selected = icbc.selectedLocation === feature.properties.location

        return (
          <MapMarker
            key={`${feature.properties.dataset}-${feature.properties.location}`}
            longitude={longitude}
            latitude={latitude}
            onClick={() => icbc.setSelectedLocation(feature.properties.location)}
          >
            <MarkerContent>
              <div
                className={cn(
                  'rounded-full border-2 border-white shadow-md transition-transform',
                  selected ? 'scale-125 bg-rose-700 ring-2 ring-rose-300' : 'bg-rose-500/85 hover:bg-rose-600',
                )}
                style={{ width: size, height: size }}
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
        <div className="flex items-center justify-between gap-2">
          <span>Small</span>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-white bg-rose-500 shadow-sm" />
            <span className="h-4 w-4 rounded-full border border-white bg-rose-500 shadow-sm" />
            <span className="h-7 w-7 rounded-full border border-white bg-rose-500 shadow-sm" />
          </div>
          <span>High</span>
        </div>
      )}
      {icbc.showHeatmap && (
        <div className={cn(icbc.showPoints && 'border-t border-border pt-2')}>
          <div className="h-3 w-full rounded-sm border border-border bg-gradient-to-r from-sky-300 via-yellow-300 to-red-600" aria-hidden="true" />
          <div className="mt-1 flex justify-between text-[10px]">
            <span>Lower density</span>
            <span>Higher density</span>
          </div>
        </div>
      )}
      {!icbc.showPoints && !icbc.showHeatmap && (
        <div className="text-[10px] italic">Both layers are hidden.</div>
      )}
      <div>{icbc.crashFeatures.length.toLocaleString()} mapped locations</div>
    </div>
  )
}

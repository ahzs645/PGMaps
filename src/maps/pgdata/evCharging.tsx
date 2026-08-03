import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import {
  BOUNDARY_SOURCE_OPTIONS as ALL_BOUNDARY_SOURCE_OPTIONS,
  type BoundarySource,
  type RegionLevel,
} from '@/lib/studyArea'
import { formatPercentValue } from '@/lib/format'
import { useJsonManifest } from './shared'
import { formatFileSize } from './miscDataUtils'
import { DEFAULT_LOCALE } from '@/lib/format'

interface EvChargingResource {
  id: string
  title: string
  geometry: string
  format: string
  url: string
  rawBytes: number
  gzipBytes: number
}

export interface EvChargingManifest {
  generatedAt: string
  title: string
  description: string
  source: string
  coverage: string
  license: string
  apiDocumentationUrl: string
  recommendedUse: string
  counts: {
    stations: number
    stationFeatures: number
    chargingUnits: number
  }
  resources: EvChargingResource[]
}

export type EvChargingFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    id?: number
    name?: string
    city?: string
    province?: string
    network?: string
    access?: string
    connectors?: string
    level2?: number | null
    dcFast?: number | null
  }
>

export type EvChargingFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  EvChargingFeature['properties']
>

export interface EvChargingSummaryStats {
  stationCount: number
  stationSharePercent: number
  level2Ports: number
  dcFastPorts: number
  totalPorts: number
  level2StationCount: number
  dcFastStationCount: number
  dcFastPortPercent: number
  densityPer1000Km2: number | null
  areaKm2: number | null
  topNetwork: string
  topNetworkCount: number
}

export interface EvChargingBoundarySummary extends EvChargingSummaryStats {
  boundaryId: string
  boundaryName: string
}

function formatPercent(value: number): string {
  return formatPercentValue(value, { fallback: '0%', maximumFractionDigits: value < 10 ? 1 : 0 })
}

function formatDensity(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a'
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: value < 10 ? 1 : 0 })
}

function EvSummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function EvSummarySection({
  title,
  stats,
  onClear,
}: {
  title: string
  stats: EvChargingSummaryStats | EvChargingBoundarySummary
  onClear?: () => void
}) {
  const subtitle =
    'boundaryName' in stats
      ? stats.boundaryName
      : `${stats.stationCount.toLocaleString()} stations in the current map scope`

  return (
    <section className="rounded border border-border bg-muted/30 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {onClear && (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <EvSummaryCard label="Stations" value={stats.stationCount.toLocaleString()} />
        <EvSummaryCard label="Ports" value={stats.totalPorts.toLocaleString()} />
        <EvSummaryCard label="DC fast mix" value={formatPercent(stats.dcFastPortPercent)} />
        <EvSummaryCard label="Stations / 1K km²" value={formatDensity(stats.densityPer1000Km2)} />
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Level 2 ports</span>
        <span className="text-right font-medium text-foreground">{stats.level2Ports.toLocaleString()}</span>
        <span className="text-muted-foreground">DC fast ports</span>
        <span className="text-right font-medium text-foreground">{stats.dcFastPorts.toLocaleString()}</span>
        <span className="text-muted-foreground">Station share</span>
        <span className="text-right font-medium text-foreground">{formatPercent(stats.stationSharePercent)}</span>
        <span className="text-muted-foreground">Top network</span>
        <span className="truncate text-right font-medium text-foreground">
          {stats.topNetworkCount > 0 ? `${stats.topNetwork} (${stats.topNetworkCount.toLocaleString()})` : 'n/a'}
        </span>
      </div>
    </section>
  )
}

export function EvChargingSidebar({
  manifest,
  summaryStats,
  selectedBoundary,
  boundariesVisible,
  boundarySource,
  selectedRegionLevel,
  regionLevelOptions,
  boundaryLoading,
  boundaryError,
  onBoundarySourceChange,
  onClearBoundaries,
  onClearSelectedBoundary,
  onRegionLevelChange,
}: {
  manifest: ReturnType<typeof useJsonManifest<EvChargingManifest>>
  summaryStats: EvChargingSummaryStats
  selectedBoundary: EvChargingBoundarySummary | null
  boundariesVisible: boolean
  boundarySource: BoundarySource
  selectedRegionLevel: RegionLevel
  regionLevelOptions: Array<{ value: RegionLevel; label: string }>
  boundaryLoading: boolean
  boundaryError: string | null
  onBoundarySourceChange: (source: BoundarySource) => void
  onClearBoundaries: () => void
  onClearSelectedBoundary: () => void
  onRegionLevelChange: (level: RegionLevel) => void
}) {
  const resources = manifest.data?.resources ?? []

  return (
    <div className="space-y-4 p-4">
      {!manifest.data && !manifest.error && (
        <div className="text-sm text-muted-foreground">Loading EV charging manifest...</div>
      )}
      {manifest.error && <div className="text-sm text-red-500">{manifest.error}</div>}
      <EvSummarySection title="Current scope" stats={summaryStats} />
      {selectedBoundary && (
        <EvSummarySection title="Selected region" stats={selectedBoundary} onClear={onClearSelectedBoundary} />
      )}
      <StudyAreaSelector<BoundarySource, RegionLevel>
        source={boundariesVisible ? boundarySource : undefined}
        sourceOptions={ALL_BOUNDARY_SOURCE_OPTIONS}
        level={selectedRegionLevel}
        levelOptions={boundariesVisible ? regionLevelOptions : []}
        onSourceChange={onBoundarySourceChange}
        onSelectedSourceClick={onClearBoundaries}
        onLevelChange={onRegionLevelChange}
        levelSelectId="ev-charging-study-area-level"
      />
      {(boundaryLoading || boundaryError) && (
        <section className="rounded border border-border bg-card p-3 text-xs">
          {boundaryLoading && <p className="text-muted-foreground">Loading boundaries...</p>}
          {boundaryError && <p className="text-red-600 dark:text-red-400">{boundaryError}</p>}
        </section>
      )}
      {manifest.data?.counts && (
        <section className="grid grid-cols-3 gap-2">
          <div className="rounded border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Stations</div>
            <div className="text-sm font-semibold text-foreground">
              {manifest.data.counts.stations.toLocaleString()}
            </div>
          </div>
          <div className="rounded border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Map points</div>
            <div className="text-sm font-semibold text-foreground">
              {manifest.data.counts.stationFeatures.toLocaleString()}
            </div>
          </div>
          <div className="rounded border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Units</div>
            <div className="text-sm font-semibold text-foreground">
              {manifest.data.counts.chargingUnits.toLocaleString()}
            </div>
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Exports</h2>
        <div className="space-y-2">
          {resources.map((resource) => (
            <article key={resource.id} className="rounded border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{resource.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {resource.geometry} | {resource.format}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <div>{formatFileSize(resource.rawBytes)} raw</div>
                  <div>{formatFileSize(resource.gzipBytes)} gzip -9</div>
                </div>
              </div>
              <a
                className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                href={resource.url}
                target="_blank"
                rel="noreferrer"
              >
                Open resource
              </a>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

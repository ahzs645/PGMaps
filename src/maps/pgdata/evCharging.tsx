import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import {
  BOUNDARY_SOURCE_OPTIONS as ALL_BOUNDARY_SOURCE_OPTIONS,
  type BoundarySource,
  type RegionLevel,
} from '@/lib/studyArea'
import { InlineAlert, KeyValueRows, SidebarSection } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink, TextButton } from '@/components/ui/text-button'
import { formatBytes, formatNumber, formatPercentValue } from '@/lib/format'
import { useJsonManifest } from './shared'

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
  return formatNumber(value, { fallback: 'n/a', maximumFractionDigits: value != null && value < 10 ? 1 : 0 })
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
      : `${formatNumber(stats.stationCount)} stations in the current map scope`

  return (
    <SidebarSection
      title={title}
      subtitle={<span className="block truncate">{subtitle}</span>}
      actions={onClear && (
        <TextButton tone="muted" onClick={onClear}>
          Clear
        </TextButton>
      )}
    >
      <StatGroup
        variant="tiles"
        size="sm"
        columns={2}
        items={[
          { label: 'Stations', value: formatNumber(stats.stationCount) },
          { label: 'Ports', value: formatNumber(stats.totalPorts) },
          { label: 'DC fast mix', value: formatPercent(stats.dcFastPortPercent) },
          { label: 'Stations / 1K km²', value: formatDensity(stats.densityPer1000Km2) },
        ]}
      />
      <KeyValueRows
        className="mt-3"
        rows={[
          { label: 'Level 2 ports', value: formatNumber(stats.level2Ports) },
          { label: 'DC fast ports', value: formatNumber(stats.dcFastPorts) },
          { label: 'Station share', value: formatPercent(stats.stationSharePercent) },
          {
            label: 'Top network',
            value: stats.topNetworkCount > 0 ? `${stats.topNetwork} (${formatNumber(stats.topNetworkCount)})` : 'n/a',
          },
        ]}
      />
    </SidebarSection>
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
    <>
      {(!manifest.data || manifest.error) && (
        <SidebarSection>
          {manifest.error ? (
            <InlineAlert tone="error">{manifest.error}</InlineAlert>
          ) : (
            <InlineAlert loading>Loading EV charging manifest...</InlineAlert>
          )}
        </SidebarSection>
      )}
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
        <SidebarSection className="space-y-2">
          {boundaryLoading && <InlineAlert loading>Loading boundaries...</InlineAlert>}
          {boundaryError && <InlineAlert tone="error">{boundaryError}</InlineAlert>}
        </SidebarSection>
      )}
      <SidebarSection title="Exports">
        {manifest.data?.counts && (
          <StatGroup
            variant="tiles"
            size="sm"
            columns={3}
            className="mb-3"
            items={[
              { label: 'Stations', value: formatNumber(manifest.data.counts.stations) },
              { label: 'Map points', value: formatNumber(manifest.data.counts.stationFeatures) },
              { label: 'Units', value: formatNumber(manifest.data.counts.chargingUnits) },
            ]}
          />
        )}
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
                  <div>{formatBytes(resource.rawBytes)} raw</div>
                  <div>{formatBytes(resource.gzipBytes)} gzip -9</div>
                </div>
              </div>
              <ExternalLink href={resource.url} className="mt-2 touch:min-h-9">
                Open resource
              </ExternalLink>
            </article>
          ))}
        </div>
      </SidebarSection>
    </>
  )
}

import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import {
  BOUNDARY_SOURCE_OPTIONS as ALL_BOUNDARY_SOURCE_OPTIONS,
  type BoundarySource,
  type RegionLevel,
} from '@/lib/studyArea'
import { useJsonManifest } from './shared'
import { formatFileSize } from './miscDataUtils'

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

export type EvChargingFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point>

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

export function EvChargingSidebar({
  manifest,
  stationCount,
  boundariesVisible,
  boundarySource,
  selectedRegionLevel,
  regionLevelOptions,
  boundaryLoading,
  boundaryError,
  onBoundarySourceChange,
  onClearBoundaries,
  onRegionLevelChange,
}: {
  manifest: ReturnType<typeof useJsonManifest<EvChargingManifest>>
  stationCount: number
  boundariesVisible: boolean
  boundarySource: BoundarySource
  selectedRegionLevel: RegionLevel
  regionLevelOptions: Array<{ value: RegionLevel; label: string }>
  boundaryLoading: boolean
  boundaryError: string | null
  onBoundarySourceChange: (source: BoundarySource) => void
  onClearBoundaries: () => void
  onRegionLevelChange: (level: RegionLevel) => void
}) {
  const resources = manifest.data?.resources ?? []

  return (
    <div className="space-y-4 p-4">
      {!manifest.data && !manifest.error && (
        <div className="text-sm text-muted-foreground">Loading EV charging manifest...</div>
      )}
      {manifest.error && <div className="text-sm text-red-500">{manifest.error}</div>}
      <section className="rounded border border-border bg-muted/30 p-3">
        <div className="text-xs text-muted-foreground">
          {stationCount.toLocaleString()} stations in current study area.
        </div>
      </section>
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
      {manifest.data?.recommendedUse && (
        <section className="rounded border border-border bg-muted/30 p-3">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Recommended Use</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{manifest.data.recommendedUse}</p>
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
                className="mt-2 inline-block text-[11px] font-medium text-primary hover:underline"
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

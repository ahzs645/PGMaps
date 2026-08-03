import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/fetchJson'
import { formatDate, useJsonManifest } from './shared'
import { formatFileSize, formatVectorStatus } from './miscDataUtils'

interface NetworkAvailabilityDataset {
  id: string
  title: string
  source: string
  category: string
  geometry: string
  formats: string[]
  url: string
  apiUrl?: string
  schemaUrl?: string
  notes?: string
  years?: number[]
  path?: string
  featureCount?: number
  rawBytes?: number
  gzipBytes?: number
  http?: {
    ok?: boolean
    status?: number | null
    contentType?: string | null
    contentLength?: number | null
    lastModified?: string | null
    etag?: string | null
    error?: string
  }
}

interface NetworkAvailabilityCarrierFinding {
  provider: string
  vectorStatus: string
  recommendedUse: string
  endpoints: string[]
}

export interface NetworkAvailabilityManifest {
  generatedAt: string
  title: string
  description: string
  historicalCoverage?: string
  cartovistaResources?: NetworkAvailabilityDataset[]
  recommendedUse?: string
  datasets: NetworkAvailabilityDataset[]
  carrierFindings: NetworkAvailabilityCarrierFinding[]
}

export type NetworkAvailabilityProperties = {
  id?: string | number
  OBJECTID?: string | number
  Year?: string | number
  Speed?: string
  year?: string | number
  technology?: string
  title?: string
  source?: string
  sourceLayer?: string
  category?: string
}

export type NetworkAvailabilityFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  NetworkAvailabilityProperties
>

export type NetworkAvailabilityFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  NetworkAvailabilityProperties
>

const CRTC_WIRELESS_COVERAGE_GEOJSON_URL = '/data/network-availability/crtc-wireless-coverage-current.geojson.gz'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

export function networkAvailabilityTooltipHtml(properties: Record<string, unknown>): string {
  const technology = String(properties.technology ?? properties.title ?? 'Network coverage')
  const year = String(properties.year ?? properties.Year ?? '2024')
  return `
    <div class="min-w-36 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div class="font-semibold">Network availability</div>
      <div class="mt-1 text-muted-foreground">${escapeHtml(technology)} coverage</div>
      <div class="text-muted-foreground">Year ${escapeHtml(year)}</div>
    </div>
  `
}

export function useNetworkAvailabilityLayer(enabled: boolean, version?: string | null) {
  const [data, setData] = useState<NetworkAvailabilityFeatureCollection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const url = version
      ? `${CRTC_WIRELESS_COVERAGE_GEOJSON_URL}?v=${encodeURIComponent(version)}`
      : CRTC_WIRELESS_COVERAGE_GEOJSON_URL

    async function load() {
      try {
        setError(null)
        const geojson = await fetchJson<NetworkAvailabilityFeatureCollection>(url, controller.signal)
        setData({
          ...geojson,
          features: geojson.features
            .map((feature, index) => ({
              ...feature,
              properties: {
                ...(feature.properties ?? {}),
                id: feature.properties?.id ?? feature.properties?.OBJECTID ?? index,
              },
            }))
            .sort((a, b) => {
              const order = { LTE: 0, '5G': 1 } as Record<string, number>
              return (order[String(a.properties?.technology ?? '')] ?? 2) - (order[String(b.properties?.technology ?? '')] ?? 2)
            }),
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load network availability geometry')
      }
    }

    void load()
    return () => controller.abort()
  }, [enabled, version])

  return { data, error }
}

export function NetworkAvailabilitySidebar({
  manifest,
  layer,
}: {
  manifest: ReturnType<typeof useJsonManifest<NetworkAvailabilityManifest>>
  layer: ReturnType<typeof useNetworkAvailabilityLayer>
}) {
  const mapDatasets = manifest.data?.datasets.filter((dataset) => dataset.geometry !== 'table') ?? []
  const carrierFindings = manifest.data?.carrierFindings ?? []
  const snapshotFeatures = layer.data?.features ?? []
  const snapshotBytes = manifest.data?.cartovistaResources?.find(
    (dataset) => dataset.path === 'crtc-wireless-coverage-current.geojson.gz',
  )?.gzipBytes

  return (
    <div className="space-y-4 p-4">
      {!manifest.data && !manifest.error && (
        <div className="text-sm text-muted-foreground">Loading network availability manifest...</div>
      )}
      {manifest.error && <div className="text-sm text-red-500">{manifest.error}</div>}
      <section className="rounded border border-border bg-card p-3">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Current Map Layer</h2>
        {layer.error ? (
          <p className="text-xs leading-relaxed text-red-500">{layer.error}</p>
        ) : layer.data ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Status</div>
              <div className="font-medium text-foreground">Loaded</div>
            </div>
            <div>
              <div className="text-muted-foreground">Features</div>
              <div className="font-medium text-foreground">{snapshotFeatures.length.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Snapshot</div>
              <div className="font-medium text-foreground">{formatFileSize(snapshotBytes)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Year</div>
              <div className="font-medium text-foreground">2024</div>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">Loading CRTC LTE/5G coverage snapshot...</p>
        )}
      </section>
      {manifest.data?.recommendedUse && (
        <section className="rounded border border-border bg-muted/30 p-3">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Recommended Source Strategy</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{manifest.data.recommendedUse}</p>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Map Availability Sources</h2>
        <div className="space-y-2">
          {mapDatasets.map((dataset) => (
            <article key={dataset.id} className="rounded border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{dataset.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {dataset.source} | {dataset.geometry} | {dataset.formats.join(', ')}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <div>{formatFileSize(dataset.http?.contentLength)}</div>
                  <div>{dataset.http?.lastModified ? formatDate(dataset.http.lastModified) : 'No date'}</div>
                </div>
              </div>
              {dataset.notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{dataset.notes}</p>}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <a
                  className="font-medium text-primary hover:underline"
                  href={dataset.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
                {dataset.apiUrl && (
                  <a
                    className="font-medium text-primary hover:underline"
                    href={dataset.apiUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    API
                  </a>
                )}
                {dataset.schemaUrl && (
                  <a
                    className="font-medium text-primary hover:underline"
                    href={dataset.schemaUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Schema
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Carrier API Findings</h2>
        <div className="space-y-2">
          {carrierFindings.map((finding) => (
            <article key={finding.provider} className="rounded border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">{finding.provider}</div>
                <div className="text-xs font-medium text-muted-foreground">
                  {formatVectorStatus(finding.vectorStatus)}
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{finding.recommendedUse}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

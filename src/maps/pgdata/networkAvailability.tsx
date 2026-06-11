import { useEffect, useState } from 'react'
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
  recommendedUse?: string
  datasets: NetworkAvailabilityDataset[]
  carrierFindings: NetworkAvailabilityCarrierFinding[]
}

export type NetworkAvailabilityFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

const NRCAN_WIRELESS_GEOJSON_URL =
  'https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/Wireless_Data_Network_Reseau_donnees_sans_fil/MapServer/0/query?where=1%3D1&outFields=OBJECTID%2CYear%2CSpeed&returnGeometry=true&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.01&f=geojson'

export function useNetworkAvailabilityLayer(enabled: boolean) {
  const [data, setData] = useState<NetworkAvailabilityFeatureCollection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()

    async function load() {
      try {
        setError(null)
        const response = await fetch(NRCAN_WIRELESS_GEOJSON_URL, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to fetch NRCan wireless layer: ${response.status}`)
        const geojson = (await response.json()) as NetworkAvailabilityFeatureCollection
        setData({
          ...geojson,
          features: geojson.features.map((feature, index) => ({
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              id: feature.properties?.OBJECTID ?? index,
            },
          })),
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load network availability geometry')
      }
    }

    void load()
    return () => controller.abort()
  }, [enabled])

  return { data, error }
}

export function NetworkAvailabilitySidebar({
  manifest,
}: {
  manifest: ReturnType<typeof useJsonManifest<NetworkAvailabilityManifest>>
}) {
  const mapDatasets = manifest.data?.datasets.filter((dataset) => dataset.geometry !== 'table') ?? []
  const carrierFindings = manifest.data?.carrierFindings ?? []

  return (
    <div className="space-y-4 p-4">
      {!manifest.data && !manifest.error && (
        <div className="text-sm text-muted-foreground">Loading network availability manifest...</div>
      )}
      {manifest.error && <div className="text-sm text-red-500">{manifest.error}</div>}
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
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
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
                <div className="text-[11px] font-medium text-muted-foreground">
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

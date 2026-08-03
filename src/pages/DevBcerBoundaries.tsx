import area from '@turf/area'
import intersect from '@turf/intersect'
import { ExternalLink, GitCompareArrows, Loader2, MapPinned } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Map, MapControls } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { escapeHtml } from '@/lib/escapeHtml'

type BoundaryCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  Record<string, unknown>
> & {
  metadata?: {
    mapshaperVersion?: string
    simplificationToleranceMetres?: number
    topologyPreserving?: boolean
  }
}

type Viewport = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

type PayloadStats = {
  bytes: number
  gzipBytes: number | null
  features: number
  vertices: number
  loadMs: number
}

type ComparisonData = {
  optimized: BoundaryCollection
  raw: BoundaryCollection
  optimizedStats: PayloadStats
  rawStats: PayloadStats
  maxAreaDeltaPercent: number
  sharedEdgeCount: number
  overlappingPairCount: number
}

const OPTIMIZED_DATA_URL = '/data/boundaries/BCER/admin_zones.geojson'
const RAW_DATA_URL = 'https://geoweb-ags.bc-er.ca/arcgis/rest/services/ADMIN/ADMINISTRATIVE_ZONES_PY/MapServer/1/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson'
const SOURCE_PAGE_URL = 'https://data-bc-er.opendata.arcgis.com/datasets/032cac78a0264d23b7461ba2f8e1a8d7_1/explore'

const INITIAL_VIEWPORT: Viewport = {
  center: [-122.6, 56.1],
  zoom: 5.2,
  bearing: 0,
  pitch: 0,
}

const VIEWPORT_PRESETS: Array<{ label: string; viewport: Viewport }> = [
  {
    label: 'Overview',
    viewport: INITIAL_VIEWPORT,
  },
  {
    label: 'Northern junction',
    viewport: {
      center: [-124.181123, 57.270786],
      zoom: 10,
      bearing: 0,
      pitch: 0,
    },
  },
  {
    label: 'Central / South junction',
    viewport: {
      center: [-122.672038, 56.146247],
      zoom: 10,
      bearing: 0,
      pitch: 0,
    },
  },
]

const ZONE_FILL_EXPRESSION = [
  'match',
  ['get', 'NAME'],
  'North',
  '#2563eb',
  'Central',
  '#8b5cf6',
  'South East',
  '#f59e0b',
  'South West',
  '#14b8a6',
  '#64748b',
]

const ZONE_LINE_EXPRESSION = [
  'match',
  ['get', 'NAME'],
  'North',
  '#1e3a8a',
  'Central',
  '#5b21b6',
  'South East',
  '#92400e',
  'South West',
  '#0f766e',
  '#334155',
]

function countVertices(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0)
  }
  return geometry.coordinates.reduce(
    (sum, polygon) => sum + polygon.reduce((inner, ring) => inner + ring.length, 0),
    0,
  )
}

function collectionVertexCount(collection: BoundaryCollection) {
  return collection.features.reduce((sum, feature) => sum + countVertices(feature.geometry), 0)
}

async function gzipByteLength(buffer: ArrayBuffer) {
  if (typeof CompressionStream === 'undefined') return null
  const compressed = new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'))
  return (await new Response(compressed).arrayBuffer()).byteLength
}

async function fetchCollection(url: string, signal: AbortSignal) {
  const startedAt = performance.now()
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  const loadMs = performance.now() - startedAt
  const collection = JSON.parse(new TextDecoder().decode(buffer)) as BoundaryCollection
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error(`Invalid GeoJSON response from ${url}`)
  }

  const gzipBytes = await gzipByteLength(buffer)
  return {
    collection,
    stats: {
      bytes: buffer.byteLength,
      gzipBytes,
      features: collection.features.length,
      vertices: collectionVertexCount(collection),
      loadMs,
    } satisfies PayloadStats,
  }
}

function maxZoneAreaDeltaPercent(optimized: BoundaryCollection, raw: BoundaryCollection) {
  const rawAreaByName = new globalThis.Map(
    raw.features.map((feature) => [String(feature.properties?.NAME ?? ''), area(feature)]),
  )
  return optimized.features.reduce((maxDelta, feature) => {
    const rawArea = rawAreaByName.get(String(feature.properties?.NAME ?? ''))
    if (!rawArea || rawArea <= 0) return maxDelta
    const delta = Math.abs(area(feature) - rawArea) / rawArea * 100
    return Math.max(maxDelta, delta)
  }, 0)
}

function topologyStats(collection: BoundaryCollection) {
  const edges = new globalThis.Map<string, string[]>()
  const rings = (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) => (
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
  )

  collection.features.forEach((feature) => {
    rings(feature.geometry).forEach((ring) => {
      for (let index = 1; index < ring.length; index += 1) {
        const first = `${ring[index - 1][0]},${ring[index - 1][1]}`
        const second = `${ring[index][0]},${ring[index][1]}`
        const key = first < second ? `${first}|${second}` : `${second}|${first}`
        const names = edges.get(key) ?? []
        names.push(String(feature.properties?.NAME ?? ''))
        edges.set(key, names)
      }
    })
  })

  let overlappingPairCount = 0
  for (let left = 0; left < collection.features.length; left += 1) {
    for (let right = left + 1; right < collection.features.length; right += 1) {
      if (intersect(collection.features[left], collection.features[right])) {
        overlappingPairCount += 1
      }
    }
  }

  return {
    sharedEdgeCount: [...edges.values()].filter((names) => new Set(names).size === 2).length,
    overlappingPairCount,
  }
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return 'Unavailable'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
  return `${(bytes / 1024).toFixed(bytes >= 100 * 1024 ? 0 : 1)} KiB`
}

function reductionPercent(smaller: number, larger: number) {
  if (larger <= 0) return 0
  return (1 - smaller / larger) * 100
}

function BoundaryMap({
  title,
  subtitle,
  collection,
  stats,
  viewport,
  selectedZone,
  onViewportChange,
  onSelectZone,
}: {
  title: string
  subtitle: string
  collection: BoundaryCollection
  stats: PayloadStats
  viewport: Viewport
  selectedZone: string | null
  onViewportChange: (viewport: Viewport) => void
  onSelectZone: (zone: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-1">{formatBytes(stats.bytes)}</span>
          <span className="rounded-full bg-muted px-2 py-1">{stats.vertices.toLocaleString()} vertices</span>
        </div>
      </div>
      <div className="relative h-[430px] min-h-80">
        <Map
          viewport={viewport}
          onViewportChange={onViewportChange}
          attributionControl={false}
         controls={<MapControls position="top-right" />}>
          <MapFillLayer
            data={collection}
            fillColor={ZONE_FILL_EXPRESSION}
            fillOpacity={0.25}
            lineColor={ZONE_LINE_EXPRESSION}
            lineOpacity={0.95}
            lineWidth={1.5}
            idProperty="NAME"
            selectedId={selectedZone}
            selectionColor="#f8fafc"
            selectionWidth={3}
            onFeatureClick={(name) => onSelectZone(name)}
            hoverHtml={(properties) => (
              `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                <div class="font-semibold">${escapeHtml(properties.NAME)}</div>
                <div class="mt-1 text-muted-foreground">${escapeHtml(title)}</div>
              </div>`
            )}
          />
        </Map>
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border/80 bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          Pan or zoom either map — both stay synchronized
        </div>
      </div>
    </section>
  )
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  )
}

function DevBcerBoundaries() {
  const [comparison, setComparison] = useState<ComparisonData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT)
  const [selectedZone, setSelectedZone] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchCollection(OPTIMIZED_DATA_URL, controller.signal),
      fetchCollection(RAW_DATA_URL, controller.signal),
    ])
      .then(([optimized, raw]) => {
        const topology = topologyStats(optimized.collection)
        setComparison({
          optimized: optimized.collection,
          raw: raw.collection,
          optimizedStats: optimized.stats,
          rawStats: raw.stats,
          maxAreaDeltaPercent: maxZoneAreaDeltaPercent(optimized.collection, raw.collection),
          ...topology,
        })
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Unable to load the BCER comparison.')
      })

    return () => controller.abort()
  }, [])

  const handleViewportChange = useCallback((next: Viewport) => {
    setViewport(next)
  }, [])

  const summary = useMemo(() => {
    if (!comparison) return null
    const gzipReduction = comparison.optimizedStats.gzipBytes != null && comparison.rawStats.gzipBytes != null
      ? reductionPercent(comparison.optimizedStats.gzipBytes, comparison.rawStats.gzipBytes)
      : null
    return {
      payloadReduction: reductionPercent(comparison.optimizedStats.bytes, comparison.rawStats.bytes),
      gzipReduction,
      vertexReduction: reductionPercent(comparison.optimizedStats.vertices, comparison.rawStats.vertices),
    }
  }, [comparison])

  return (
    <div className="min-h-full overflow-auto bg-gradient-to-b from-muted/40 via-background to-background">
      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
              <GitCompareArrows className="size-4" />
              Boundary geometry comparison
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              BCER admin zones: optimized vs raw
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The left map uses the deployable PGMaps snapshot. The right map renders the untouched live BCER
              GeoJSON. Their viewports and selected zones stay synchronized so you can inspect boundary detail.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/dev/boundaries"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
            >
              <MapPinned className="size-4" />
              Boundary explorer
            </Link>
            <a
              href={SOURCE_PAGE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
            >
              BCER source
              <ExternalLink className="size-4" />
            </a>
          </div>
        </div>

        {!comparison && !error && (
          <div className="mt-6 flex min-h-[520px] items-center justify-center rounded-xl border border-border bg-card">
            <div className="text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-3 size-6 animate-spin" />
              Loading 7 MiB of raw geometry and the optimized snapshot…
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {comparison && summary && (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <StatCard
                label="Raw payload"
                value={formatBytes(comparison.rawStats.bytes)}
                note={`${formatBytes(comparison.rawStats.gzipBytes)} browser gzip`}
              />
              <StatCard
                label="Optimized payload"
                value={formatBytes(comparison.optimizedStats.bytes)}
                note={`${formatBytes(comparison.optimizedStats.gzipBytes)} browser gzip`}
              />
              <StatCard
                label="Payload reduction"
                value={`${summary.payloadReduction.toFixed(1)}%`}
                note={summary.gzipReduction == null ? 'Gzip unavailable' : `${summary.gzipReduction.toFixed(1)}% smaller gzip`}
              />
              <StatCard
                label="Vertex reduction"
                value={`${summary.vertexReduction.toFixed(1)}%`}
                note={`${comparison.rawStats.vertices.toLocaleString()} → ${comparison.optimizedStats.vertices.toLocaleString()}`}
              />
              <StatCard
                label="Maximum area change"
                value={`${comparison.maxAreaDeltaPercent.toFixed(4)}%`}
                note="Largest change among the four zones"
              />
              <StatCard
                label="Topology check"
                value={(comparison.overlappingPairCount ?? 0) === 0 ? 'Pass' : 'Review'}
                note={`${(comparison.sharedEdgeCount ?? 0).toLocaleString()} exact shared edges · ${comparison.overlappingPairCount ?? 0} overlaps`}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span className="mr-1 font-medium text-muted-foreground">Inspection presets</span>
              {VIEWPORT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setViewport(preset.viewport)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 font-medium text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <BoundaryMap
                title="Optimized snapshot"
                subtitle={`Local PGMaps asset · loaded in ${Math.round(comparison.optimizedStats.loadMs)} ms`}
                collection={comparison.optimized}
                stats={comparison.optimizedStats}
                viewport={viewport}
                selectedZone={selectedZone}
                onViewportChange={handleViewportChange}
                onSelectZone={setSelectedZone}
              />
              <BoundaryMap
                title="Raw BCER service"
                subtitle={`Live ArcGIS GeoJSON · loaded in ${Math.round(comparison.rawStats.loadMs)} ms`}
                collection={comparison.raw}
                stats={comparison.rawStats}
                viewport={viewport}
                selectedZone={selectedZone}
                onViewportChange={handleViewportChange}
                onSelectZone={setSelectedZone}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
              {['North', 'Central', 'South East', 'South West'].map((zone) => (
                <button
                  key={zone}
                  type="button"
                  onClick={() => setSelectedZone((current) => current === zone ? null : zone)}
                  className="inline-flex items-center gap-2 rounded-md px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className="size-2.5 rounded-sm"
                    style={{
                      backgroundColor: zone === 'North'
                        ? '#2563eb'
                        : zone === 'Central'
                          ? '#8b5cf6'
                          : zone === 'South East'
                            ? '#f59e0b'
                            : '#14b8a6',
                    }}
                  />
                  <span className={selectedZone === zone ? 'font-semibold text-foreground' : undefined}>{zone}</span>
                </button>
              ))}
              {selectedZone && (
                <button
                  type="button"
                  onClick={() => setSelectedZone(null)}
                  className="ml-auto font-medium text-foreground hover:underline"
                >
                  Clear selection
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default DevBcerBoundaries

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { MVTLayer, TileLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import maplibregl from 'maplibre-gl'
import { Eye, EyeOff, Image, Layers, RadioTower, Shapes } from 'lucide-react'

import { Map as AppMap, useMap } from '@/components/ui/map'
import { Button } from '@/components/ui/button'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { fetchGzipJson } from '@/maps/aqmap/lib/pm25Grid'
import { cn } from '@/lib/utils'

const DEV_NETWORK_DATA_BASE = '/__dev_network_data'

type RgbColor = [number, number, number, number]

type NetworkLayerDefinition = {
  id: string
  label: string
  color: RgbColor
}

type BellFeatureProperties = {
  provider?: string
  layerId?: string
  label?: string
  colorHex?: string
  mapZoom?: number
  tileX?: number
  tileY?: number
  pixelCount?: number
}

type BellFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  BellFeatureProperties
>

type BellManifest = {
  generatedAt?: string
  bellTimestamp?: string
  layers?: Array<{
    id: string
    label: string
    polygonize?: {
      outputBytes?: number
      stats?: {
        sourceTiles?: number
        featureCount?: number
      }
    }
  }>
}

type RogersManifest = {
  generatedAt?: string
  coverageUpdated?: string
  requested?: {
    minZoom?: number
    maxZoom?: number
  }
  layers?: Array<{
    layerId: string
    label: string
    style: string
    configuredZoomRange?: {
      from?: number | null
      to?: number | null
    }
    stats?: {
      downloaded?: number
      bytesSaved?: number
      failed?: number
    }
  }>
}

type TelusManifest = {
  generatedAt?: string
  layers?: TelusManifestLayer[]
}

type TelusManifestLayer = {
  id: string
  label: string
  archives?: Array<{ type?: string; path?: string; bytes?: number }>
  stats?: {
    saved?: number
    bytes?: number
  }
}

const TELUS_LAYERS: NetworkLayerDefinition[] = [
  { id: 'telus-lte', label: 'TELUS LTE', color: [30, 116, 255, 145] },
  { id: 'telus-lte-advanced', label: 'TELUS LTE Advanced', color: [15, 118, 110, 145] },
  { id: 'telus-5g', label: 'TELUS 5G', color: [139, 92, 246, 145] },
  { id: 'telus-5g-3500', label: 'TELUS 5G+ / 3500 MHz', color: [217, 70, 239, 150] },
  { id: 'telus-hspa', label: 'TELUS HSPA+', color: [100, 116, 139, 130] },
  { id: 'telus-lte-m', label: 'TELUS LTE-M', color: [249, 115, 22, 135] },
]

const BELL_LAYERS: NetworkLayerDefinition[] = [
  { id: 'lte', label: 'Bell LTE', color: [0, 155, 135, 120] },
  { id: 'lte-advanced', label: 'Bell LTE Advanced', color: [0, 122, 255, 120] },
  { id: '5g', label: 'Bell 5G', color: [126, 87, 194, 125] },
  { id: '5g-plus', label: 'Bell 5G+', color: [196, 54, 151, 130] },
  { id: '5g-plus-advanced', label: 'Bell 5G+ Advanced', color: [236, 72, 153, 150] },
  { id: 'hspa', label: 'Bell HSPA+', color: [71, 85, 105, 115] },
  { id: 'lte-m', label: 'Bell LTE-M', color: [245, 158, 11, 120] },
]

const ROGERS_LAYERS: NetworkLayerDefinition[] = [
  { id: '4g5g-only', label: 'Rogers 5G/5G+ only', color: [218, 41, 28, 145] },
  { id: '4g', label: 'Rogers 4G LTE', color: [252, 128, 118, 130] },
  { id: '3g', label: 'Rogers HSPA+', color: [252, 128, 118, 105] },
  { id: 'ltem', label: 'Rogers LTE-M', color: [0, 160, 183, 140] },
  { id: 'nbiot', label: 'Rogers NB-IoT', color: [34, 34, 34, 150] },
  { id: 'comp_sat', label: 'Rogers All + Satellite', color: [161, 37, 27, 145] },
]

const DEFAULT_TELUS_VISIBLE = new Set(['telus-lte', 'telus-5g'])
const DEFAULT_BELL_VISIBLE = new Set(['lte'])
const DEFAULT_ROGERS_VISIBLE = new Set(['4g5g-only'])
const BELL_RASTER_MIN_ZOOM = 4
const BELL_RASTER_MAX_ZOOM = 10
const ROGERS_RASTER_MIN_ZOOM = 3
const ROGERS_RASTER_MAX_ZOOM = 8

type BellLayerDataState = Record<string, {
  data: BellFeatureCollection | null
  loading: boolean
  error: string | null
}>
type BellRenderMode = 'raster' | 'polygon'
type TileBoundingBox = [[number, number], [number, number]]
type DeckTileIndex = { x: number; y: number; z: number }

function formatBytes(bytes?: number | null) {
  if (!Number.isFinite(bytes ?? NaN)) return 'unknown'
  const value = Number(bytes)
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function themedTooltipHtml(title: string, rows: Array<[string, string | number | undefined | null]>): string {
  return `
    <div class="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div class="font-semibold text-foreground">${escapeHtml(title)}</div>
      <div class="mt-1 space-y-0.5 text-muted-foreground">
        ${rows
          .filter(([, value]) => value != null && value !== '')
          .map(([label, value]) => `<div><span>${escapeHtml(label)}:</span> <span class="font-medium text-foreground">${escapeHtml(String(value))}</span></div>`)
          .join('')}
      </div>
    </div>
  `
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function rgbaCss(color: RgbColor) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`
}

function bellRasterTileUrl(layerId: string, index: DeckTileIndex) {
  return `${DEV_NETWORK_DATA_BASE}/bell/output/tiles/${layerId}/${index.z}/${index.x}/${index.y}.png`
}

function rogersRasterTileUrl(layerId: string, index: DeckTileIndex) {
  return `${DEV_NETWORK_DATA_BASE}/rogers/output/tiles/${layerId}/${index.z}/${index.x}/${index.y}.png`
}

function DevNetworkDeckOverlay({
  visibleTelusLayerIds,
  visibleBellLayerIds,
  visibleRogersLayerIds,
  bellRenderMode,
  bellDataById,
}: {
  visibleTelusLayerIds: string[]
  visibleBellLayerIds: string[]
  visibleRogersLayerIds: string[]
  bellRenderMode: BellRenderMode
  bellDataById: BellLayerDataState
}) {
  const { map, isLoaded } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const tooltipRef = useRef<maplibregl.Popup | null>(null)

  useEffect(() => {
    if (!isLoaded || !map) return
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'mapcn-tooltip pointer-events-none',
      offset: 12,
    })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay
    tooltipRef.current = popup

    const removeTooltip = () => popup.remove()
    const canvas = map.getCanvas()
    const handleDocumentPointerMove = (event: PointerEvent) => {
      if (event.target instanceof Node && canvas.contains(event.target)) return
      removeTooltip()
    }
    const handleVisibilityChange = () => {
      if (document.hidden) removeTooltip()
    }
    canvas.addEventListener('mouseleave', removeTooltip)
    document.addEventListener('pointermove', handleDocumentPointerMove, true)
    window.addEventListener('blur', removeTooltip)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      canvas.removeEventListener('mouseleave', removeTooltip)
      document.removeEventListener('pointermove', handleDocumentPointerMove, true)
      window.removeEventListener('blur', removeTooltip)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      popup.remove()
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl)
      } catch {
        // MapLibre can throw during teardown.
      }
      overlayRef.current = null
      tooltipRef.current = null
    }
  }, [isLoaded, map])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay || !map) return

    const layers: Layer[] = []
    for (const layerDefinition of TELUS_LAYERS) {
      if (!visibleTelusLayerIds.includes(layerDefinition.id)) continue
      layers.push(
        new MVTLayer({
          id: `dev-network-${layerDefinition.id}`,
          data: `${DEV_NETWORK_DATA_BASE}/telus/output/tiles/${layerDefinition.id}/{z}/{x}/{y}.mvt`,
          minZoom: 0,
          maxZoom: layerDefinition.id === 'telus-lte' ? 6 : 5,
          binary: false,
          pickable: true,
          stroked: false,
          filled: true,
          opacity: 0.72,
          getFillColor: layerDefinition.color,
          getLineColor: [255, 255, 255, 0],
          lineWidthMinPixels: 0,
          onTileError: () => null,
          onHover: (info: { object?: unknown; coordinate?: [number, number] }) => {
            const popup = tooltipRef.current
            if (!popup || !map) return
            if (!info.object || !info.coordinate) {
              popup.remove()
              return
            }
            popup
              .setLngLat(info.coordinate)
              .setHTML(themedTooltipHtml('TELUS coverage', [
                ['Layer', layerDefinition.label],
                ['Source', 'Saved MVT tile snapshot'],
              ]))
              .addTo(map)
          },
        } as unknown as ConstructorParameters<typeof MVTLayer>[0]),
      )
    }

    for (const layerDefinition of ROGERS_LAYERS) {
      if (!visibleRogersLayerIds.includes(layerDefinition.id)) continue
      layers.push(
        new TileLayer({
          id: `dev-network-rogers-raster-${layerDefinition.id}`,
          minZoom: ROGERS_RASTER_MIN_ZOOM,
          maxZoom: ROGERS_RASTER_MAX_ZOOM,
          tileSize: 256,
          opacity: 1,
          pickable: true,
          getTileData: async (tile: { index?: DeckTileIndex; signal?: AbortSignal | null }) => {
            if (!tile.index) return null
            try {
              const response = await fetch(rogersRasterTileUrl(layerDefinition.id, tile.index), {
                signal: tile.signal ?? undefined,
              })
              if (!response.ok) return null
              return await createImageBitmap(await response.blob())
            } catch (error) {
              if ((error as Error).name !== 'AbortError') return null
              throw error
            }
          },
          renderSubLayers: (props: { id: string; data: ImageBitmap | null; tile: { boundingBox: unknown } }) => {
            if (!props.data) return null
            const [[west, south], [east, north]] = props.tile.boundingBox as TileBoundingBox
            return new BitmapLayer({
              id: `${props.id}-bitmap`,
              image: props.data,
              bounds: [west, south, east, north],
              pickable: true,
              opacity: 0.82,
              onHover: (info: { object?: unknown; coordinate?: number[] }) => {
                const popup = tooltipRef.current
                if (!popup || !map) return
                if (!info.object || !info.coordinate || info.coordinate.length < 2) {
                  popup.remove()
                  return
                }
                popup
                  .setLngLat([info.coordinate[0], info.coordinate[1]])
                  .setHTML(themedTooltipHtml('Rogers coverage', [
                    ['Layer', layerDefinition.label],
                    ['Source', 'Saved SpatialBuzz PNG tile snapshot'],
                    ['Zooms', `z${ROGERS_RASTER_MIN_ZOOM}-z${ROGERS_RASTER_MAX_ZOOM}`],
                  ]))
                  .addTo(map)
              },
            })
          },
          onTileError: () => null,
        } as unknown as ConstructorParameters<typeof TileLayer>[0]),
      )
    }

    for (const layerDefinition of BELL_LAYERS) {
      if (!visibleBellLayerIds.includes(layerDefinition.id)) continue
      if (bellRenderMode === 'raster') {
        layers.push(
          new TileLayer({
            id: `dev-network-bell-raster-${layerDefinition.id}`,
            minZoom: BELL_RASTER_MIN_ZOOM,
            maxZoom: BELL_RASTER_MAX_ZOOM,
            tileSize: 256,
            opacity: layerDefinition.color[3] / 255,
            getTileData: async (tile: { index?: DeckTileIndex; signal?: AbortSignal | null }) => {
              if (!tile.index) return null
              try {
                const response = await fetch(bellRasterTileUrl(layerDefinition.id, tile.index), {
                  signal: tile.signal ?? undefined,
                })
                if (!response.ok) return null
                return await createImageBitmap(await response.blob())
              } catch (error) {
                if ((error as Error).name !== 'AbortError') return null
                throw error
              }
            },
            renderSubLayers: (props: { id: string; data: ImageBitmap | null; tile: { boundingBox: unknown } }) => {
              if (!props.data) return null
              const [[west, south], [east, north]] = props.tile.boundingBox as TileBoundingBox
              return new BitmapLayer({
                id: `${props.id}-bitmap`,
                image: props.data,
                bounds: [west, south, east, north],
                opacity: layerDefinition.color[3] / 255,
              })
            },
          } as unknown as ConstructorParameters<typeof TileLayer>[0]),
        )
        continue
      }

      const bellData = bellDataById[layerDefinition.id]?.data
      if (!bellData?.features.length) continue
      layers.push(
        new GeoJsonLayer({
          id: `dev-network-bell-${layerDefinition.id}`,
          data: bellData,
          pickable: true,
          stroked: false,
          filled: true,
          opacity: 0.68,
          parameters: { depthTest: false },
          getFillColor: (feature: { properties?: BellFeatureProperties }) => {
            const colorHex = feature.properties?.colorHex
            if (typeof colorHex === 'string' && /^#[0-9a-f]{6}$/i.test(colorHex)) {
              const n = parseInt(colorHex.slice(1), 16)
              return [(n >> 16) & 255, (n >> 8) & 255, n & 255, layerDefinition.color[3]]
            }
            return layerDefinition.color
          },
          onHover: (info: { object?: { properties?: BellFeatureProperties } | null; coordinate?: [number, number] }) => {
            const popup = tooltipRef.current
            if (!popup || !map) return
            if (!info.object || !info.coordinate) {
              popup.remove()
              return
            }
            const properties = info.object.properties
            popup
              .setLngLat(info.coordinate)
              .setHTML(themedTooltipHtml('Bell coverage', [
                ['Layer', properties?.label ?? layerDefinition.label],
                ['Source', 'Polygonized PNG tile snapshot'],
                ['Map zoom', properties?.mapZoom],
                ['Tile', properties?.tileX != null && properties.tileY != null ? `${properties.tileX}/${properties.tileY}` : null],
                ['Pixels', properties?.pixelCount],
              ]))
              .addTo(map)
          },
        } as unknown as ConstructorParameters<typeof GeoJsonLayer>[0]),
      )
    }

    overlay.setProps({ layers })
  }, [bellDataById, bellRenderMode, map, visibleBellLayerIds, visibleRogersLayerIds, visibleTelusLayerIds])

  return null
}

function layerButtonClass(active: boolean) {
  return cn(
    'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
    active
      ? 'border-primary/50 bg-primary/10 text-foreground'
      : 'border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground',
  )
}

export default function DevNetworks() {
  const [visibleTelusLayerIds, setVisibleTelusLayerIds] = useState<string[]>([...DEFAULT_TELUS_VISIBLE])
  const [visibleBellLayerIds, setVisibleBellLayerIds] = useState<string[]>([...DEFAULT_BELL_VISIBLE])
  const [visibleRogersLayerIds, setVisibleRogersLayerIds] = useState<string[]>([...DEFAULT_ROGERS_VISIBLE])
  const [bellRenderMode, setBellRenderMode] = useState<BellRenderMode>('raster')
  const [showSidebar, setShowSidebar] = useState(true)
  const [bellDataById, setBellDataById] = useState<BellLayerDataState>({})
  const [bellManifest, setBellManifest] = useState<BellManifest | null>(null)
  const [rogersManifest, setRogersManifest] = useState<RogersManifest | null>(null)
  const [telusManifest, setTelusManifest] = useState<TelusManifest | null>(null)
  const visibleBellKey = visibleBellLayerIds.join('|')

  useEffect(() => {
    fetch(`${DEV_NETWORK_DATA_BASE}/bell/output/manifest.json`)
      .then((response) => response.ok ? response.json() : null)
      .then(setBellManifest)
      .catch(() => setBellManifest(null))
    fetch(`${DEV_NETWORK_DATA_BASE}/telus/output/manifest.json`)
      .then((response) => response.ok ? response.json() : null)
      .then(setTelusManifest)
      .catch(() => setTelusManifest(null))
    fetch(`${DEV_NETWORK_DATA_BASE}/rogers/output/tiles/sync-manifest.json`)
      .then((response) => response.ok ? response.json() : null)
      .then(setRogersManifest)
      .catch(() => setRogersManifest(null))
  }, [])

  useEffect(() => {
    const controllers: AbortController[] = []
    if (bellRenderMode !== 'polygon') {
      setBellDataById({})
      return () => {}
    }

    setBellDataById((current) => {
      const next: BellLayerDataState = {}
      for (const id of visibleBellLayerIds) {
        next[id] = current[id] ?? { data: null, loading: true, error: null }
      }
      return next
    })

    for (const id of visibleBellLayerIds) {
      if (bellDataById[id]?.data || bellDataById[id]?.loading) continue
      const controller = new AbortController()
      controllers.push(controller)
      setBellDataById((current) => ({
        ...current,
        [id]: { data: current[id]?.data ?? null, loading: true, error: null },
      }))
      fetchGzipJson<BellFeatureCollection>(
        `${DEV_NETWORK_DATA_BASE}/bell/output/polygons/${id}.geojson.gz`,
        controller.signal,
      )
        .then((data) => {
          setBellDataById((current) => ({
            ...current,
            [id]: { data, loading: false, error: null },
          }))
        })
        .catch((error) => {
          if ((error as Error).name !== 'AbortError') {
            setBellDataById((current) => ({
              ...current,
              [id]: { data: current[id]?.data ?? null, loading: false, error: (error as Error).message },
            }))
          }
        })
    }

    return () => {
      controllers.forEach((controller) => controller.abort())
    }
    // Only react to visibility changes. Data state updates inside this effect should not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bellRenderMode, visibleBellKey])

  const visibleBellFeatureCount = visibleBellLayerIds.reduce(
    (sum, id) => sum + (bellDataById[id]?.data?.features.length ?? 0),
    0,
  )
  const visibleBellLoadingCount = visibleBellLayerIds.filter((id) => bellDataById[id]?.loading).length
  const telusStatsById = useMemo(() => {
    const byId = new globalThis.Map<string, TelusManifestLayer>()
    for (const layer of telusManifest?.layers ?? []) byId.set(layer.id, layer)
    return byId
  }, [telusManifest])
  const rogersStatsById = useMemo(() => {
    const byId = new globalThis.Map<string, NonNullable<RogersManifest['layers']>[number]>()
    for (const layer of rogersManifest?.layers ?? []) byId.set(layer.layerId, layer)
    return byId
  }, [rogersManifest])

  function toggleTelusLayer(id: string) {
    setVisibleTelusLayerIds((current) =>
      current.includes(id) ? current.filter((layerId) => layerId !== id) : [...current, id],
    )
  }

  function toggleBellLayer(id: string) {
    setVisibleBellLayerIds((current) =>
      current.includes(id) ? current.filter((layerId) => layerId !== id) : [...current, id],
    )
  }

  function toggleRogersLayer(id: string) {
    setVisibleRogersLayerIds((current) =>
      current.includes(id) ? current.filter((layerId) => layerId !== id) : [...current, id],
    )
  }

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <RadioTower className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">Network Coverage Dev Map</h1>
              <p className="text-xs text-muted-foreground">TELUS MVT, Bell PNG, and Rogers SpatialBuzz PNG snapshots</p>
            </div>
          </div>
        </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                TELUS MVT
              </h2>
              <span className="text-xs text-muted-foreground">{visibleTelusLayerIds.length} visible</span>
            </div>
            <div className="space-y-1.5">
              {TELUS_LAYERS.map((layer) => {
                const active = visibleTelusLayerIds.includes(layer.id)
                const stats = telusStatsById.get(layer.id)
                const archiveBytes = stats?.archives?.find((archive) => archive.type === 'tar.gz')?.bytes
                return (
                  <button key={layer.id} type="button" className={layerButtonClass(active)} onClick={() => toggleTelusLayer(layer.id)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: rgbaCss(layer.color) }} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{layer.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {stats?.stats?.saved ?? 'unknown'} saved tiles · {formatBytes(archiveBytes ?? stats?.stats?.bytes)}
                        </span>
                      </span>
                    </span>
                    {active ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Rogers PNG
              </h2>
              <span className="text-xs text-muted-foreground">{visibleRogersLayerIds.length} visible</span>
            </div>
            <div className="space-y-1.5">
              {ROGERS_LAYERS.map((layer) => {
                const active = visibleRogersLayerIds.includes(layer.id)
                const stats = rogersStatsById.get(layer.id)
                const sourceZooms = stats?.configuredZoomRange?.from != null && stats?.configuredZoomRange?.to != null
                  ? `source z${stats.configuredZoomRange.from}-z${stats.configuredZoomRange.to}`
                  : 'source zoom unknown'
                return (
                  <button key={layer.id} type="button" className={layerButtonClass(active)} onClick={() => toggleRogersLayer(layer.id)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: rgbaCss(layer.color) }} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{layer.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {stats?.stats?.downloaded?.toLocaleString() ?? 'unknown'} saved tiles · {formatBytes(stats?.stats?.bytesSaved)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          pulled z{rogersManifest?.requested?.minZoom ?? ROGERS_RASTER_MIN_ZOOM}-z{rogersManifest?.requested?.maxZoom ?? ROGERS_RASTER_MAX_ZOOM} · {sourceZooms}
                        </span>
                      </span>
                    </span>
                    {active ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Bell PNG
              </h2>
              <span className="text-xs text-muted-foreground">
                {bellRenderMode === 'polygon' && visibleBellLoadingCount ? `${visibleBellLoadingCount} loading` : `${visibleBellLayerIds.length} visible`}
              </span>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className={layerButtonClass(bellRenderMode === 'raster')}
                onClick={() => setBellRenderMode('raster')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Image className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">Raster tiles</span>
                </span>
              </button>
              <button
                type="button"
                className={layerButtonClass(bellRenderMode === 'polygon')}
                onClick={() => setBellRenderMode('polygon')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Shapes className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">Polygon debug</span>
                </span>
              </button>
            </div>
            <div className="space-y-1.5">
              {BELL_LAYERS.map((layer) => {
                const active = visibleBellLayerIds.includes(layer.id)
                const stats = bellManifest?.layers?.find((manifestLayer) => manifestLayer.id === layer.id)?.polygonize
                const state = bellDataById[layer.id]
                return (
                  <button key={layer.id} type="button" className={layerButtonClass(active)} onClick={() => toggleBellLayer(layer.id)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: rgbaCss(layer.color) }} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{layer.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {bellRenderMode === 'raster'
                            ? `PNG tiles · z${BELL_RASTER_MIN_ZOOM}-z${BELL_RASTER_MAX_ZOOM}`
                            : state?.loading
                            ? 'loading'
                            : `${stats?.stats?.featureCount?.toLocaleString() ?? 'unknown'} features · ${formatBytes(stats?.outputBytes)}`}
                        </span>
                        {bellRenderMode === 'polygon' && state?.error && <span className="block truncate text-xs text-destructive">{state.error}</span>}
                      </span>
                    </span>
                    {active ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Visible Bell layers</div>
            <div className="mt-1">
              {visibleBellLayerIds.length} Bell layer{visibleBellLayerIds.length === 1 ? '' : 's'} ·{' '}
              {visibleRogersLayerIds.length} Rogers layer{visibleRogersLayerIds.length === 1 ? '' : 's'} ·{' '}
              {bellRenderMode === 'raster'
                ? `deck.gl raster tiles, z${BELL_RASTER_MIN_ZOOM}-z${BELL_RASTER_MAX_ZOOM}`
                : `${visibleBellFeatureCount.toLocaleString()} loaded polygon rectangles`}
            </div>
            <div className="mt-1">
              {bellRenderMode === 'raster'
                ? 'This is the recommended web path: only visible PNG tiles are fetched.'
                : 'Debug mode loads flat GeoJSON rectangles and should stay low-zoom only.'}
            </div>
          </section>
        </div>

      <div className="border-t border-border px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setVisibleTelusLayerIds(visibleTelusLayerIds.length ? [] : [...DEFAULT_TELUS_VISIBLE])}
            >
              {visibleTelusLayerIds.length ? 'Hide TELUS' : 'Show TELUS'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setVisibleBellLayerIds(visibleBellLayerIds.length ? [] : [...DEFAULT_BELL_VISIBLE])}
            >
              {visibleBellLayerIds.length ? 'Hide Bell' : 'Show Bell'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="col-span-2 h-8 text-xs"
              onClick={() => setVisibleRogersLayerIds(visibleRogersLayerIds.length ? [] : [...DEFAULT_ROGERS_VISIBLE])}
            >
              {visibleRogersLayerIds.length ? 'Hide Rogers' : 'Show Rogers'}
            </Button>
          </div>
        </div>
    </div>
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((value) => !value)}
      desktopSidebarWidth={384}
      mobileInitialSheetState="half"
      mobilePeek={<div className="text-sm font-semibold text-foreground">Network Coverage</div>}
    >
      <AppMap
        className="h-full w-full"
        center={[-101.5, 56.2]}
        zoom={3.2}
        minZoom={2}
        maxZoom={10}
        showStyleLoadingOverlay={false}
      >
        <DevNetworkDeckOverlay
          visibleTelusLayerIds={visibleTelusLayerIds}
          visibleBellLayerIds={visibleBellLayerIds}
          visibleRogersLayerIds={visibleRogersLayerIds}
          bellRenderMode={bellRenderMode}
          bellDataById={bellDataById}
        />
      </AppMap>
    </MapSectionLayout>
  )
}

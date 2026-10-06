import { useEffect, useMemo, useRef, useState } from 'react'
import { MVTLayer, TileLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import maplibregl from 'maplibre-gl'
import { Eye, EyeOff, Grid2X2, Image, Layers, RadioTower, Shapes } from 'lucide-react'

import { Map as AppMap, useMap } from '@/components/ui/map'
import { useDeckOverlay } from '@/components/ui/map-deck'
import { Button } from '@/components/ui/button'
import { MapLineLayer } from '@/components/ui/map-layers'
import { MapOverlay, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ToggleRow } from '@/components/ui/toggle-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createRasterGridLayer, type RasterGridPick } from '@/components/ui/map-raster-grid'
import { GRID_NO_DATA, GRID_UNCERTAIN } from '@/lib/rasterClassGrid'
import { networkGridPalette } from '@/maps/pgdata/networkGridPalette'
import { networkSourceLevels } from '@/maps/pgdata/networkSourceLevels'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { fetchJson } from '@/lib/fetchJson'
import { formatBytes, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'

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

type CrtcSnapshot = { id: string; title: string; path: string; featureCount?: number }
type CrtcLayerData = { resource: CrtcSnapshot; data: GeoJSON.FeatureCollection }

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
  { id: '4g5g', label: 'Rogers combined LTE / 5G / 5G+', color: [218, 41, 28, 145] },
  { id: '5g-only', label: 'Rogers 5G only (derived)', color: [218, 41, 28, 145] },
  { id: '5g-plus-only', label: 'Rogers 5G+ only (derived)', color: [102, 21, 16, 145] },
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
const ROGERS_RASTER_MAX_ZOOM = 10

type BellLayerDataState = Record<string, {
  data: BellFeatureCollection | null
  loading: boolean
  error: string | null
}>
type BellRenderMode = 'raster' | 'polygon'
type RasterView = 'image' | 'grid'
type TileBoundingBox = [[number, number], [number, number]]
type DeckTileIndex = { x: number; y: number; z: number }

const BYTES_FORMAT = { fallback: 'unknown', digits: 2 }

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
  rasterView,
  cellPixels,
  showGridLines,
  onGridError,
  sourceLevel,
  crtcLayers,
}: {
  visibleTelusLayerIds: string[]
  visibleBellLayerIds: string[]
  visibleRogersLayerIds: string[]
  bellRenderMode: BellRenderMode
  bellDataById: BellLayerDataState
  rasterView: RasterView
  cellPixels: number
  showGridLines: boolean
  onGridError: (error: string) => void
  sourceLevel: string
  crtcLayers: CrtcLayerData[]
}) {
  const { map, isLoaded } = useMap()
  const tooltipRef = useRef<maplibregl.Popup | null>(null)

  const overlayRef = useDeckOverlay({
    onDismiss: () => tooltipRef.current?.remove(),
    onAttach: () => {
      tooltipRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'mapcn-tooltip pointer-events-none',
        offset: 12,
      })
    },
    onDetach: () => {
      tooltipRef.current = null
    },
  })

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay || !map) return

    const layers: Layer[] = []
    tooltipRef.current?.remove()
    const addGrid = (provider: 'bell' | 'rogers', definition: NetworkLayerDefinition) => {
      const sourceZoom = networkSourceLevels(provider, definition.id, sourceLevel)
      if (!sourceZoom) return
      const palette = networkGridPalette(provider, definition.id)
      const showPick = (pick: RasterGridPick | null) => {
        const popup = tooltipRef.current
        if (!popup || !map) return
        if (!pick) { popup.remove(); return }
        const label = pick.value === GRID_NO_DATA ? 'Uncoloured in saved image'
          : pick.value === GRID_UNCERTAIN ? cellPixels === 1 ? 'Unclassified source pixel' : 'Uncertain / mixed box'
          : provider === 'rogers' && ['4g5g', '4g5g-only'].includes(definition.id) ? pick.value === 2 ? '5G+ display class' : pick.value === 3 ? 'LTE display class' : '5G display class'
          : definition.label
        popup.setLngLat([pick.longitude, pick.latitude]).setHTML(mapTooltipHtml({
          title: label,
          subtitle: cellPixels === 1 ? 'Original source pixel · colour and transparency preserved' : 'Simplified box grid · inferred from saved imagery',
          rows: [['Box', `${pick.tile.x * 256 / cellPixels + pick.column}, ${pick.tile.y * 256 / cellPixels + pick.row}`],
            ['Source level', `z${pick.tile.z}`], ['Box size', `${cellPixels} × ${cellPixels} source pixels`], ['Agreement', `${Math.round(pick.agreement * 100)}%`]],
        })).addTo(map)
      }
      layers.push(createRasterGridLayer({
        id: `dev-network-${provider}-grid-${definition.id}-${sourceLevel}-${cellPixels}`,
        tileUrl: tile => provider === 'bell' ? bellRasterTileUrl(definition.id, tile) : rogersRasterTileUrl(definition.id, tile),
        sourceZoom, palette, cellPixels, showGridLines,
        preserveSourcePixels: cellPixels === 1,
        opacity: provider === 'rogers' ? 0.82 : definition.color[3] / 255,
        colorForValue: value => value === GRID_NO_DATA ? [0, 0, 0, 0]
          : value === GRID_UNCERTAIN ? [148, 163, 184, 160]
          : [...(palette.find(entry => entry.value === value)?.rgb ?? definition.color.slice(0, 3)), 150] as [number, number, number, number],
        onHover: showPick,
        onPick: showPick,
        onTileError: error => onGridError(error.message),
      }))
    }
    for (const layerDefinition of TELUS_LAYERS) {
      if (!visibleTelusLayerIds.includes(layerDefinition.id)) continue
      const levels = networkSourceLevels('telus', layerDefinition.id, sourceLevel)
      if (!levels) continue
      layers.push(
        new MVTLayer({
          id: `dev-network-${layerDefinition.id}-${sourceLevel}`,
          data: `${DEV_NETWORK_DATA_BASE}/telus/output/tiles/${layerDefinition.id}/{z}/{x}/{y}.mvt`,
          minZoom: levels.min,
          maxZoom: levels.max,
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
              .setHTML(mapTooltipHtml({ title: 'TELUS coverage', rows: [
                ['Layer', layerDefinition.label],
                ['Source', 'Saved MVT tile snapshot'],
              ]}))
              .addTo(map)
          },
        } as unknown as ConstructorParameters<typeof MVTLayer>[0]),
      )
    }

    for (const layerDefinition of ROGERS_LAYERS) {
      if (!visibleRogersLayerIds.includes(layerDefinition.id)) continue
      const levels = networkSourceLevels('rogers', layerDefinition.id, sourceLevel)
      if (!levels) continue
      if (rasterView === 'grid') { addGrid('rogers', layerDefinition); continue }
      layers.push(
        new TileLayer({
          id: `dev-network-rogers-raster-${layerDefinition.id}-${sourceLevel}`,
          minZoom: levels.min,
          maxZoom: levels.max,
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
              return await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
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
              // Compare the actual saved pixels, without interpolating neighbouring colours.
              textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
              _imageCoordinateSystem: 'cartesian',
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
                  .setHTML(mapTooltipHtml({ title: 'Rogers coverage', rows: [
                    ['Layer', layerDefinition.label],
                    ['Source', 'Saved SpatialBuzz PNG tile snapshot'],
                    ['Zooms', `z${ROGERS_RASTER_MIN_ZOOM}-z${ROGERS_RASTER_MAX_ZOOM}`],
                  ]}))
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
      const levels = networkSourceLevels('bell', layerDefinition.id, sourceLevel)
      if (!levels) continue
      if (rasterView === 'grid') { addGrid('bell', layerDefinition); continue }
      if (bellRenderMode === 'raster') {
        layers.push(
          new TileLayer({
            id: `dev-network-bell-raster-${layerDefinition.id}-${sourceLevel}`,
            minZoom: levels.min,
            maxZoom: levels.max,
            tileSize: 256,
            opacity: layerDefinition.color[3] / 255,
            getTileData: async (tile: { index?: DeckTileIndex; signal?: AbortSignal | null }) => {
              if (!tile.index) return null
              try {
                const response = await fetch(bellRasterTileUrl(layerDefinition.id, tile.index), {
                  signal: tile.signal ?? undefined,
                })
                if (!response.ok) return null
                return await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
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
                textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
                _imageCoordinateSystem: 'cartesian',
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
              .setHTML(mapTooltipHtml({ title: 'Bell coverage', rows: [
                ['Layer', properties?.label ?? layerDefinition.label],
                ['Source', 'Polygonized PNG tile snapshot'],
                ['Map zoom', properties?.mapZoom],
                ['Tile', properties?.tileX != null && properties.tileY != null ? `${properties.tileX}/${properties.tileY}` : null],
                ['Pixels', properties?.pixelCount],
              ]}))
              .addTo(map)
          },
        } as unknown as ConstructorParameters<typeof GeoJsonLayer>[0]),
      )
    }

    for (const { resource, data } of crtcLayers) {
      // Country-wide roads use MapLibre's worker tiling; keep the full source
      // geometry and disable simplification instead of expanding every line on the main thread.
      if (resource.id.includes('major-roads')) continue
      layers.push(new GeoJsonLayer({
        id: `dev-network-${resource.id}`,
        data,
        pickable: true,
        filled: true,
        stroked: true,
        getFillColor: [73, 120, 180, 90],
        getLineColor: [35, 87, 145, 180],
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        getPointRadius: 4,
        pointRadiusUnits: 'pixels',
        onHover: info => {
          const popup = tooltipRef.current
          if (!popup || !map) return
          if (!info.object || !info.coordinate) { popup.remove(); return }
          popup.setLngLat([info.coordinate[0], info.coordinate[1]]).setHTML(mapTooltipHtml({
            title: resource.title, subtitle: 'Original saved CRTC vector geometry',
            rows: [['Layer', resource.id]],
          })).addTo(map)
        },
      }))
    }

    overlay.setProps({ layers })
  }, [overlayRef, bellDataById, bellRenderMode, map, isLoaded, visibleBellLayerIds, visibleRogersLayerIds, visibleTelusLayerIds, rasterView, cellPixels, showGridLines, onGridError, sourceLevel, crtcLayers])

  return null
}

function NetworkGridNavigation({ sourceLevel }: { sourceLevel: string }) {
  const { map } = useMap()
  return <MapOverlay position="top-left" className="p-2 text-xs">
    <p className="mb-2">{sourceLevel === 'auto' ? 'Grid follows each saved source level.' : `Comparing saved level z${sourceLevel}.`}</p>
    <Button variant="outline" size="sm" onClick={() => map?.flyTo({ center: [-122.75, 53.915], zoom: 13 })}>Inspect Prince George</Button>
  </MapOverlay>
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
  const [rasterView, setRasterView] = useState<RasterView>('image')
  const [cellPixels, setCellPixels] = useState('1')
  const [showGridLines, setShowGridLines] = useState(false)
  const [sourceLevel, setSourceLevel] = useState('auto')
  const [crtcResources, setCrtcResources] = useState<CrtcSnapshot[]>([])
  const [visibleCrtcIds, setVisibleCrtcIds] = useState<string[]>([])
  const [crtcDataById, setCrtcDataById] = useState<Record<string, { data?: GeoJSON.FeatureCollection; error?: string; loading?: boolean }>>({})
  const [gridError, setGridError] = useState<string | null>(null)
  const [bellDataById, setBellDataById] = useState<BellLayerDataState>({})
  const [bellManifest, setBellManifest] = useState<BellManifest | null>(null)
  const [rogersManifest, setRogersManifest] = useState<RogersManifest | null>(null)
  const [telusManifest, setTelusManifest] = useState<TelusManifest | null>(null)
  const visibleBellKey = visibleBellLayerIds.join('|')
  const visibleCrtcKey = visibleCrtcIds.join('|')
  const crtcLayers = useMemo(() => crtcResources.flatMap(resource => {
    const data = crtcDataById[resource.id]?.data
    return visibleCrtcIds.includes(resource.id) && data ? [{ resource, data }] : []
  }), [crtcResources, crtcDataById, visibleCrtcIds])
  useEffect(() => { setGridError(null) }, [rasterView, cellPixels, sourceLevel, visibleBellKey, visibleRogersLayerIds])

  useEffect(() => {
    const controller = new AbortController()
    void fetchJson<{ cartovistaResources?: CrtcSnapshot[] }>(`${DEV_NETWORK_DATA_BASE}/crtc-network-availability/output/manifest.json`, controller.signal)
      .then(manifest => setCrtcResources((manifest.cartovistaResources ?? []).filter(resource => resource.path?.endsWith('.geojson.gz'))))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    for (const resource of crtcResources) {
      if (!visibleCrtcIds.includes(resource.id) || crtcDataById[resource.id]?.data) continue
      setCrtcDataById(current => ({ ...current, [resource.id]: { loading: true } }))
      void fetchJson<GeoJSON.FeatureCollection>(`${DEV_NETWORK_DATA_BASE}/crtc-network-availability/output/${resource.path}`, controller.signal)
        .then(data => setCrtcDataById(current => ({ ...current, [resource.id]: { data, loading: false } })))
        .catch(error => { if (!controller.signal.aborted) setCrtcDataById(current => ({ ...current, [resource.id]: { error: String(error), loading: false } })) })
    }
    return () => controller.abort()
    // Cached payloads stay unchanged; only visibility or inventory starts a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCrtcKey, crtcResources])

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
    if (bellRenderMode !== 'polygon' || rasterView === 'grid') {
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
      fetchJson<BellFeatureCollection>(
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
  }, [bellRenderMode, visibleBellKey, rasterView])

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
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Network Coverage Dev Map"
      subtitle="TELUS MVT, Bell PNG, and Rogers SpatialBuzz PNG snapshots"
      icon={RadioTower}
      iconClassName="bg-primary text-primary-foreground"
      titleClassName="text-base"
    >
      <SidebarSection title="Raster view" icon={Grid2X2}>
        <SegmentedControl label="Raster representation" value={rasterView} onChange={setRasterView}
          options={[{ value: 'image', label: 'Source image', icon: Image }, { value: 'grid', label: 'Box grid', icon: Grid2X2 }]} />
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium" htmlFor="network-source-level">Saved tile level</label>
          <Select value={sourceLevel} onValueChange={setSourceLevel}>
            <SelectTrigger id="network-source-level" aria-label="Saved tile level"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic · all saved levels</SelectItem>
              {Array.from({ length: 11 }, (_, zoom) => <SelectItem key={zoom} value={String(zoom)}>Level {zoom}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">Bell: levels 4–10. Rogers: 3–10. TELUS: 0–5, with partial LTE at 6. Bands without the selected level stay blank.</p>
        </div>
        {rasterView === 'grid' && <div className="mt-3 space-y-3">
          <SegmentedControl label="Grid detail" value={cellPixels} onChange={setCellPixels} size="sm"
            options={[{ value: '1', label: 'Original pixels' }, { value: '4', label: 'Simplified 4 × 4' }, { value: '8', label: 'Simplified 8 × 8' }]} />
          <ToggleRow label="Show box outlines" active={showGridLines} onClick={() => setShowGridLines(value => !value)} />
          <p className="text-xs text-muted-foreground">{cellPixels === '1' ? 'One box per original pixel. Source colours, transparency and small gaps stay intact. No averaging or palette replacement. Turn outlines off for the closest visual match.' : 'Simplified view: larger boxes use an 80% vote over their interior and can change small gaps or boundaries. Grey boxes have mixed or uncertain evidence.'}</p>
          <p className="text-xs text-muted-foreground">Each saved level keeps its own original pixels. Missing saved imagery stays blank. TELUS retains its native vectors.</p>
          {gridError && <p role="status" className="text-xs text-muted-foreground">Some saved imagery is unavailable; blank areas have no verified class.</p>}
        </div>}
        <p className="mt-3 text-xs text-muted-foreground">Switch views to compare the same location. Source imagery uses its saved pixels without smoothing. Both views use the same layer opacity.</p>
      </SidebarSection>
      <SidebarSection
        title="TELUS MVT"
        icon={Layers}
        actions={<span className="text-xs text-muted-foreground">{visibleTelusLayerIds.length} visible</span>}
      >
        <div className="space-y-1.5">
          {TELUS_LAYERS.map((layer) => {
            const active = visibleTelusLayerIds.includes(layer.id)
            const stats = telusStatsById.get(layer.id)
            const archiveBytes = stats?.archives?.find((archive) => archive.type === 'tar.gz')?.bytes
            return (
              <button key={layer.id} type="button" className={layerButtonClass(active)} aria-pressed={active} onClick={() => toggleTelusLayer(layer.id)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: rgbaCss(layer.color) }} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{layer.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {stats?.stats?.saved ?? 'unknown'} saved tiles · {formatBytes(archiveBytes ?? stats?.stats?.bytes, BYTES_FORMAT)}
                    </span>
                  </span>
                </span>
                {active ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>
      </SidebarSection>

      <SidebarSection
        title="Rogers PNG"
        icon={Layers}
        actions={<span className="text-xs text-muted-foreground">{visibleRogersLayerIds.length} visible</span>}
      >
        <div className="space-y-1.5">
          {ROGERS_LAYERS.map((layer) => {
            const active = visibleRogersLayerIds.includes(layer.id)
            const stats = rogersStatsById.get(layer.id)
            const sourceZooms = stats?.configuredZoomRange?.from != null && stats?.configuredZoomRange?.to != null
              ? `source z${stats.configuredZoomRange.from}-z${stats.configuredZoomRange.to}`
              : 'source zoom unknown'
            return (
              <button key={layer.id} type="button" className={layerButtonClass(active)} aria-pressed={active} onClick={() => toggleRogersLayer(layer.id)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: rgbaCss(layer.color) }} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{layer.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatNumber(stats?.stats?.downloaded, { fallback: 'unknown' })} saved tiles · {formatBytes(stats?.stats?.bytesSaved, BYTES_FORMAT)}
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
      </SidebarSection>

      <SidebarSection
        title="Bell PNG"
        icon={Layers}
        actions={(
          <span className="text-xs text-muted-foreground">
            {bellRenderMode === 'polygon' && visibleBellLoadingCount ? `${visibleBellLoadingCount} loading` : `${visibleBellLayerIds.length} visible`}
          </span>
        )}
      >
        {rasterView === 'image' && <div className="mb-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={layerButtonClass(bellRenderMode === 'raster')}
            aria-pressed={bellRenderMode === 'raster'}
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
            aria-pressed={bellRenderMode === 'polygon'}
            onClick={() => setBellRenderMode('polygon')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Shapes className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-medium">Polygon debug</span>
            </span>
          </button>
        </div>}
        <div className="space-y-1.5">
          {BELL_LAYERS.map((layer) => {
            const active = visibleBellLayerIds.includes(layer.id)
            const stats = bellManifest?.layers?.find((manifestLayer) => manifestLayer.id === layer.id)?.polygonize
            const state = bellDataById[layer.id]
            return (
              <button key={layer.id} type="button" className={layerButtonClass(active)} aria-pressed={active} onClick={() => toggleBellLayer(layer.id)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: rgbaCss(layer.color) }} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{layer.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {rasterView === 'grid' ? sourceLevel === 'auto' ? 'Original box grid · source z4–10' : `Original box grid · source z${sourceLevel}` : bellRenderMode === 'raster'
                        ? `PNG tiles · z${BELL_RASTER_MIN_ZOOM}-z${BELL_RASTER_MAX_ZOOM}`
                        : state?.loading
                        ? 'loading'
                        : `${formatNumber(stats?.stats?.featureCount, { fallback: 'unknown' })} features · ${formatBytes(stats?.outputBytes, BYTES_FORMAT)}`}
                    </span>
                    {bellRenderMode === 'polygon' && state?.error && <span className="block truncate text-xs text-destructive">{state.error}</span>}
                  </span>
                </span>
                {active ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>
      </SidebarSection>

      <SidebarSection title="CRTC native vectors" icon={Layers} actions={<span className="text-xs text-muted-foreground">{visibleCrtcIds.length} visible</span>}>
        <p className="mb-2 text-xs text-muted-foreground">Coverage, road lines, broadcast contours and stations retain their original vector geometry at every map zoom.</p>
        <div className="space-y-1.5">
          {crtcResources.map(resource => {
            const active = visibleCrtcIds.includes(resource.id), state = crtcDataById[resource.id]
            return <button key={resource.id} type="button" className={layerButtonClass(active)} aria-pressed={active}
              onClick={() => setVisibleCrtcIds(current => active ? current.filter(id => id !== resource.id) : [...current, resource.id])}>
              <span className="min-w-0"><span className="block truncate font-medium">{resource.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{state?.loading ? 'Loading saved vectors' : state?.error ? state.error : `${formatNumber(resource.featureCount)} original features`}</span></span>
              {active ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
            </button>
          })}
          {!crtcResources.length && <p className="text-xs text-muted-foreground">Restore the CRTC archive to view its 15 saved layers here.</p>}
        </div>
      </SidebarSection>

      <SidebarSection title="Source references" icon={RadioTower}>
        <p className="text-xs text-muted-foreground">The cell-coverage archive contains source links. Videotron LTE and Freedom nationwide / extended LTE have no saved imagery in this folder, so there is no original tile data to convert or compare.</p>
      </SidebarSection>

      <SidebarSection>
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Visible network layers</div>
          <div className="mt-1">
            {visibleBellLayerIds.length} Bell layer{visibleBellLayerIds.length === 1 ? '' : 's'} ·{' '}
            {visibleRogersLayerIds.length} Rogers layer{visibleRogersLayerIds.length === 1 ? '' : 's'} ·{' '}
            {rasterView === 'grid' ? `${cellPixels} × ${cellPixels} source-pixel boxes` : bellRenderMode === 'raster'
              ? `deck.gl raster tiles, z${BELL_RASTER_MIN_ZOOM}-z${BELL_RASTER_MAX_ZOOM}`
              : `${formatNumber(visibleBellFeatureCount)} loaded polygon rectangles`}
          </div>
          <div className="mt-1">
            {rasterView === 'grid' ? cellPixels === '1' ? 'Original source pixels stay intact at every saved level; labels are inferred only for picking.' : 'Simplified boxes can alter boundaries; grey boxes retain uncertain evidence.' : bellRenderMode === 'raster'
              ? 'This is the recommended web path: only visible PNG tiles are fetched.'
              : 'Debug mode loads flat GeoJSON rectangles and should stay low-zoom only.'}
          </div>
        </div>
      </SidebarSection>

      <div className="sticky bottom-0 border-t border-border bg-background px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8 text-xs touch:h-10"
            onClick={() => setVisibleTelusLayerIds(visibleTelusLayerIds.length ? [] : [...DEFAULT_TELUS_VISIBLE])}
          >
            {visibleTelusLayerIds.length ? 'Hide TELUS' : 'Show TELUS'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 text-xs touch:h-10"
            onClick={() => setVisibleBellLayerIds(visibleBellLayerIds.length ? [] : [...DEFAULT_BELL_VISIBLE])}
          >
            {visibleBellLayerIds.length ? 'Hide Bell' : 'Show Bell'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="col-span-2 h-8 text-xs touch:h-10"
            onClick={() => setVisibleRogersLayerIds(visibleRogersLayerIds.length ? [] : [...DEFAULT_ROGERS_VISIBLE])}
          >
            {visibleRogersLayerIds.length ? 'Hide Rogers' : 'Show Rogers'}
          </Button>
        </div>
      </div>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={384}
      mobileInitialSheetState="half"
      mobilePeek={<div className="text-sm font-semibold text-foreground">Network Coverage</div>}
    >
      <AppMap
        className="h-full w-full"
        center={[-101.5, 56.2]}
        zoom={3.2}
        minZoom={2}
        maxZoom={18}
        showStyleLoadingOverlay={false}
      >
        <DevNetworkDeckOverlay
          visibleTelusLayerIds={visibleTelusLayerIds}
          visibleBellLayerIds={visibleBellLayerIds}
          visibleRogersLayerIds={visibleRogersLayerIds}
          bellRenderMode={bellRenderMode}
          bellDataById={bellDataById}
          rasterView={rasterView}
          cellPixels={Number(cellPixels)}
          showGridLines={showGridLines}
          onGridError={setGridError}
          sourceLevel={sourceLevel}
          crtcLayers={crtcLayers}
        />
        {crtcLayers.filter(({ resource }) => resource.id.includes('major-roads')).map(({ resource, data }) => <MapLineLayer
          key={resource.id} sourceKey={resource.id} data={data} sourceTolerance={0}
          color="#235791" width={1} opacity={0.72}
          hoverHtml={() => mapTooltipHtml({ title: resource.title, subtitle: 'Original saved CRTC road geometry' })}
        />)}
        {rasterView === 'grid' && <NetworkGridNavigation sourceLevel={sourceLevel} />}
      </AppMap>
    </MapSectionLayout>
  )
}

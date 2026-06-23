import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { TileLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import maplibregl from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { WMS_LAYERS, type WmsLayerKey } from '../lib/wmsLayers'
import {
  fetchGzipJson,
  pm25GridBounds,
  pm25ValueAt,
  PM25_GRID_SNAPSHOT_URL,
  PM25_MAX,
  PM25_RAW_SCALE,
  PM25_VECTOR_COLORS,
  type AsciiGrid,
} from '../lib/pm25Grid'
import {
  FIRE_DANGER_CLASS_LABELS,
  FIRE_DANGER_VECTOR_TILE_MAX_ZOOM,
  FIRE_DANGER_VECTOR_TILE_MIN_ZOOM,
  FIRE_DANGER_VECTOR_TILE_URL_TEMPLATE,
} from '../lib/fireDangerGrid'
import { FIRE_DANGER_FILL_COLORS } from '../lib/aqMapConstants'

const EARTH_RADIUS = 6378137
const MAX_MERCATOR_LAT = 85.0511287798

function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clampedLat = Math.max(Math.min(lat, MAX_MERCATOR_LAT), -MAX_MERCATOR_LAT)
  const x = (EARTH_RADIUS * lng * Math.PI) / 180
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))
  return [x, y]
}
function latToMercY(lat: number): number {
  const clamped = Math.max(Math.min(lat, MAX_MERCATOR_LAT), -MAX_MERCATOR_LAT)
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))
}
function mercYToLat(y: number): number {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const FIRE_RGB: [number, number, number][] = [0, 1, 2, 3, 4].map((c) => hexToRgb(FIRE_DANGER_FILL_COLORS[c]))
const PM25_RGB: [number, number, number][] = PM25_VECTOR_COLORS.map((stop) => hexToRgb(stop.color))

function themedTooltipHtml(title: string, body: string): string {
  return `
    <div class="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <span class="tooltip_title font-semibold text-foreground">${title}</span>
      <span class="text-muted-foreground">${body}</span>
    </div>
  `
}

/** Smooth 11-stop PM2.5 ramp (µg/m³ → rgb). */
function pm25RampRgb(pm25: number): [number, number, number] {
  const t = Math.min(Math.max(pm25, 0), PM25_MAX) / 10
  const i = Math.min(Math.floor(t), PM25_RGB.length - 2)
  const f = t - i
  const a = PM25_RGB[i]
  const b = PM25_RGB[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** Substitute the layer's {bbox-epsg-3857} placeholder with this tile's bbox in metres. */
function buildWmsTileUrl(template: string, west: number, south: number, east: number, north: number): string {
  const [minX, minY] = lngLatToMercator(west, south)
  const [maxX, maxY] = lngLatToMercator(east, north)
  return template.replace('{bbox-epsg-3857}', `${minX},${minY},${maxX},${maxY}`)
}

function getFirstMonitorLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.id.startsWith('aqmap-monitor-'))?.id
}

const TILE_SIZE = 256
type TileBBox = { west: number; south: number; east: number; north: number }
type PixelEncoder = (data: Uint8ClampedArray, idx: number, value: number | undefined, grid: AsciiGrid) => void

function encodePm25(data: Uint8ClampedArray, idx: number, value: number | undefined, grid: AsciiGrid): void {
  if (value === undefined || value === grid.nodata || !Number.isFinite(value)) return
  const pm25 = (value as number) * PM25_RAW_SCALE
  if (!Number.isFinite(pm25) || pm25 < 0.25) return
  const [r, g, b] = pm25RampRgb(pm25)
  data[idx] = r
  data[idx + 1] = g
  data[idx + 2] = b
  data[idx + 3] = 255
}

/**
 * Sample the in-memory lat/lon grid into one 256px Web-Mercator tile of final
 * RGBA colours. Rendering the snapshot as small mercator tiles via a deck.gl
 * TileLayer (not one big BitmapLayer) is what makes it render at native
 * resolution — exactly how the WMS tile path (which renders crisply) works.
 */
function sampleNumericTile(grid: AsciiGrid, bbox: TileBBox, encode: PixelEncoder): ImageData {
  const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  const [gWest, gSouth, gEast, gNorth] = pm25GridBounds(grid)
  const mercNorth = latToMercY(bbox.north)
  const mercSouth = latToMercY(bbox.south)
  const lonStep = bbox.east - bbox.west

  for (let j = 0; j < TILE_SIZE; j += 1) {
    const lat = mercYToLat(mercNorth + ((j + 0.5) / TILE_SIZE) * (mercSouth - mercNorth))
    if (lat < gSouth || lat > gNorth) continue
    const row = Math.floor((gNorth - lat) / grid.dy)
    const rowValues = grid.values[row]
    if (!rowValues) continue

    for (let i = 0; i < TILE_SIZE; i += 1) {
      const lng = bbox.west + ((i + 0.5) / TILE_SIZE) * lonStep
      if (lng < gWest || lng > gEast) continue
      const col = Math.floor((lng - gWest) / grid.dx)
      if (col < 0 || col >= grid.ncols) continue
      encode(data, (j * TILE_SIZE + i) * 4, rowValues[col], grid)
    }
  }

  return new ImageData(data, TILE_SIZE, TILE_SIZE)
}

/**
 * Convert ImageData → ImageBitmap via a canvas. createImageBitmap(ImageData)
 * directly can yield a degenerate (downsampled) bitmap; going through a 2D
 * canvas matches the WMS tile path (createImageBitmap of a decoded image) and
 * uploads at full resolution.
 */
async function imageDataToBitmap(imageData: ImageData): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height)
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(imageData, 0, 0)
  // Round-trip through a PNG blob — the exact path the (sharp) WMS tiles use.
  const blob = await canvas.convertToBlob()
  return createImageBitmap(blob)
}

type GeoBBox = { west: number; south: number; east: number; north: number }
type TileBoundingBox = [[number, number], [number, number]]
type FireDangerDeckProperties = { g?: number; GRIDCODE?: number }
type FireDangerDeckFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  FireDangerDeckProperties
>
type DeckTileIndex = { x: number; y: number; z: number }
type DeckTileConfig = {
  tileSize: number
  minZoom: number
  maxZoom: number
  opacity: number
  getTileData: (tile: { bbox: unknown; signal?: AbortSignal | null }) => Promise<ImageBitmap | null>
  renderSubLayers: (props: { id: string; data: ImageBitmap | null; tile: { boundingBox: unknown } }) => BitmapLayer | null
}

type NumericTileSpec = {
  id: string
  gridRef: { current: AsciiGrid | null }
  version: number
  getTileData: (tile: { bbox: unknown }) => Promise<ImageBitmap> | null
  opacity: number
  smooth: boolean
}

function fireDangerClass(properties: FireDangerDeckProperties | null | undefined): number {
  return Math.max(0, Math.min(4, Math.round(Number(properties?.g ?? properties?.GRIDCODE ?? 0))))
}

function buildFireDangerTileUrl({ x, y, z }: DeckTileIndex): string {
  return FIRE_DANGER_VECTOR_TILE_URL_TEMPLATE
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
}

async function fetchFireDangerTile(index: DeckTileIndex, signal?: AbortSignal | null): Promise<FireDangerDeckFeatureCollection | null> {
  try {
    return await fetchGzipJson<FireDangerDeckFeatureCollection>(buildFireDangerTileUrl(index), signal ?? undefined)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return null
  }
}

/**
 * Single interleaved deck.gl overlay for the AQ map's experimental "deck.gl"
 * render modes:
 *  - Modelled PM2.5 deck mode re-renders the same WMS tiles as raster mode so
 *    both modes stay visually and temporally aligned.
 *  - Fire Danger loads prebuilt gzip GeoJSON polygon tiles generated from the
 *    CWFIS polygon snapshot.
 *  - The remaining WMS layers (fires, perimeters, forecast zones) are redrawn
 *    from their existing GetMap tiles via TileLayer + BitmapLayer.
 *
 * Layers are slotted below the monitor symbol layers via `beforeId` so markers
 * stay on top, matching the native MapLibre raster behaviour.
 */
export function AqMapDeckOverlay({
  tileKeys,
  pm25Active,
  fireDangerActive,
}: {
  tileKeys: WmsLayerKey[]
  pm25Active: boolean
  fireDangerActive: boolean
}) {
  const { map, isLoaded } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const pm25GridRef = useRef<AsciiGrid | null>(null)
  const fireDangerTooltipRef = useRef<maplibregl.Popup | null>(null)
  const [pm25Version, setPm25Version] = useState(0)
  const rebuildRef = useRef<() => void>(() => {})
  const tileKey = [...tileKeys].sort().join(',')

  // Create / destroy the single deck overlay.
  useEffect(() => {
    if (!isLoaded || !map) return
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay
    rebuildRef.current()
    return () => {
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl)
      } catch {
        // MapLibre can throw during teardown.
      }
      overlayRef.current = null
    }
  }, [isLoaded, map])

  // Load the committed PM2.5 numeric grid snapshot once.
  useEffect(() => {
    if (!isLoaded || !map || !pm25Active) {
      pm25GridRef.current = null
      setPm25Version(0)
      return
    }
    let aborted = false
    const controller = new AbortController()
    fetchGzipJson<AsciiGrid>(PM25_GRID_SNAPSHOT_URL, controller.signal)
      .then((grid) => {
        if (aborted) return
        if (!grid || !Array.isArray(grid.values)) throw new Error('Invalid PM2.5 grid snapshot')
        pm25GridRef.current = grid
        setPm25Version((value) => value + 1)
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') console.error('Modelled PM2.5 deck.gl snapshot failed', error)
      })
    return () => {
      aborted = true
      controller.abort()
    }
  }, [isLoaded, map, pm25Active])

  useEffect(() => {
    if (!isLoaded || !map || !fireDangerActive) {
      fireDangerTooltipRef.current?.remove()
      fireDangerTooltipRef.current = null
      return
    }

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'mapcn-tooltip aqmap-tooltip pointer-events-none',
      offset: 12,
    })
    fireDangerTooltipRef.current = popup

    return () => {
      popup.remove()
      if (fireDangerTooltipRef.current === popup) fireDangerTooltipRef.current = null
    }
  }, [isLoaded, map, fireDangerActive])

  // Hover readout of the value(s) under the cursor (skips over monitors).
  useEffect(() => {
    // PM2.5 hover reads the raster grid; fire danger hover uses deck picking.
    if (!isLoaded || !map || !pm25Active) return
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'mapcn-tooltip aqmap-tooltip pointer-events-none',
      offset: 12,
    })

    const handleMove = (event: maplibregl.MapMouseEvent) => {
      const overMonitor = map
        .queryRenderedFeatures(event.point)
        .some((feature) => feature.layer.id.startsWith('aqmap-monitor-'))
      const value = overMonitor || !pm25GridRef.current
        ? null
        : pm25ValueAt(pm25GridRef.current, event.lngLat.lng, event.lngLat.lat)
      if (value === null) {
        popup.remove()
        return
      }
      popup
        .setLngLat(event.lngLat)
        .setHTML(themedTooltipHtml('Modelled PM2.5', ` <span class="tabular-nums">${value.toFixed(1)}</span> µg/m³`))
        .addTo(map)
    }
    const handleLeave = () => popup.remove()

    map.on('mousemove', handleMove)
    map.on('mouseout', handleLeave)
    return () => {
      map.off('mousemove', handleMove)
      map.off('mouseout', handleLeave)
      popup.remove()
    }
  }, [isLoaded, map, pm25Active])

  // Stable per-layer WMS tile config (re-render existing GetMap tiles via deck).
  const tileConfigs = useMemo(() => {
    const configs = new Map<WmsLayerKey, DeckTileConfig>()
    for (const definition of WMS_LAYERS) {
      if (definition.key === 'fireDanger') continue
      const key = definition.key
      const template = definition.tiles[0]
      const opacity = definition.opacity
      configs.set(key, {
        tileSize: 256,
        minZoom: definition.minzoom ?? 0,
        maxZoom: definition.maxzoom ?? 19,
        opacity,
        getTileData: async (tile) => {
          const { west, south, east, north } = tile.bbox as GeoBBox
          try {
            const response = await fetch(buildWmsTileUrl(template, west, south, east, north), {
              signal: tile.signal ?? undefined,
            })
            if (!response.ok) return null
            return await createImageBitmap(await response.blob())
          } catch (error) {
            if ((error as Error).name !== 'AbortError') console.error(`deck.gl WMS tile failed for ${key}`, error)
            return null
          }
        },
        renderSubLayers: (props) => {
          const image = props.data
          if (!image) return null
          const [[w, s], [e, n]] = props.tile.boundingBox as unknown as TileBoundingBox
          return new BitmapLayer({ id: `${props.id}-bitmap`, image, bounds: [w, s, e, n], opacity })
        },
      })
    }
    return configs
  }, [])

  // Stable getTileData for the numeric (snapshot-backed) layers. They read the
  // grid refs (stable identity); `version` in updateTriggers re-tiles on reload.
  // Returns an ImageBitmap — the same input shape as the WMS tile path that
  // renders crisply (passing raw ImageData to a single big layer does not).
  const pm25GetTileData = useCallback((tile: { bbox: unknown }) => {
    const grid = pm25GridRef.current
    if (!grid) return null
    return imageDataToBitmap(sampleNumericTile(grid, tile.bbox as TileBBox, encodePm25))
  }, [])

  // Rebuild the deck layer list.
  useEffect(() => {
    const activeTileKeys = (tileKey ? tileKey.split(',') : []) as WmsLayerKey[]

    const numericTileLayer = (spec: NumericTileSpec, beforeId: string | undefined): Layer | null => {
      const grid = spec.gridRef.current
      if (!grid) return null
      const [west, south, east, north] = pm25GridBounds(grid)
      const filter = spec.smooth ? 'linear' : 'nearest'
      return new TileLayer({
        id: spec.id,
        tileSize: TILE_SIZE,
        minZoom: 0,
        maxZoom: 12,
        extent: [west, south, east, north],
        getTileData: spec.getTileData,
        updateTriggers: { getTileData: spec.version },
        renderSubLayers: (props: { id: string; data: ImageBitmap | null; tile: { boundingBox: unknown } }) => {
          if (!props.data) return null
          const [[w, s], [e, n]] = props.tile.boundingBox as unknown as TileBoundingBox
          return new BitmapLayer({
            id: `${props.id}-bitmap`,
            image: props.data,
            bounds: [w, s, e, n],
            opacity: spec.opacity,
            textureParameters: {
              minFilter: filter,
              magFilter: filter,
              addressModeU: 'clamp-to-edge',
              addressModeV: 'clamp-to-edge',
            },
          })
        },
        beforeId,
      } as unknown as ConstructorParameters<typeof TileLayer>[0])
    }

    const rebuild = () => {
      const overlay = overlayRef.current
      if (!overlay || !map) return
      const beforeId = getFirstMonitorLayerId(map)
      const layers: Layer[] = []

      for (const key of activeTileKeys) {
        const config = tileConfigs.get(key)
        if (!config) continue
        layers.push(
          new TileLayer({
            id: `aqdeck-tile-${key}`,
            ...config,
            beforeId,
          } as unknown as ConstructorParameters<typeof TileLayer>[0]),
        )
      }

      if (pm25Active) {
        const layer = numericTileLayer(
          {
            id: 'aqdeck-pm25-tiles',
            gridRef: pm25GridRef,
            version: pm25Version,
            getTileData: pm25GetTileData,
            opacity: 0.72,
            smooth: true,
          },
          beforeId,
        )
        if (layer) layers.push(layer)
      }
      if (fireDangerActive) {
        layers.push(
          new TileLayer({
            id: 'aqdeck-fire-danger-vector-tiles',
            tileSize: 512,
            minZoom: FIRE_DANGER_VECTOR_TILE_MIN_ZOOM,
            maxZoom: FIRE_DANGER_VECTOR_TILE_MAX_ZOOM,
            extent: [-180, 30, 180, 86],
            getTileData: (tile: { index: DeckTileIndex; signal?: AbortSignal | null }) =>
              fetchFireDangerTile(tile.index, tile.signal),
            renderSubLayers: (props: { id: string; data: FireDangerDeckFeatureCollection | null }) => {
              if (!props.data?.features?.length) return null
              return new GeoJsonLayer({
                id: `${props.id}-geojson`,
                data: props.data,
                pickable: true,
                stroked: false,
                filled: true,
                opacity: 0.6,
                getFillColor: (feature: { properties?: FireDangerDeckProperties }) =>
                  FIRE_RGB[fireDangerClass(feature.properties)],
                onHover: (info: { object?: { properties?: FireDangerDeckProperties } | null; coordinate?: [number, number] }) => {
                  const popup = fireDangerTooltipRef.current
                  if (!popup || !map) return
                  if (!info.object || !info.coordinate) {
                    popup.remove()
                    return
                  }
                  const cls = fireDangerClass(info.object.properties)
                  popup
                    .setLngLat(info.coordinate)
                    .setHTML(themedTooltipHtml('Fire danger', ` ${FIRE_DANGER_CLASS_LABELS[cls]}`))
                    .addTo(map)
                },
              } as unknown as ConstructorParameters<typeof GeoJsonLayer>[0])
            },
            beforeId,
          } as unknown as ConstructorParameters<typeof TileLayer>[0]),
        )
      }

      overlay.setProps({
        layers,
      })
    }

    rebuildRef.current = rebuild
    rebuild()
  }, [map, tileKey, pm25Active, fireDangerActive, pm25Version, tileConfigs, pm25GetTileData])

  return null
}

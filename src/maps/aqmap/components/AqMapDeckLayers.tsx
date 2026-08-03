import { useEffect, useMemo, useRef, useState } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { TileLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import maplibregl from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { WMS_LAYERS, type WmsLayerKey } from '../lib/wmsLayers'
import { fetchJson } from '@/lib/fetchJson'
import { PM25_NATIVE_VECTOR_URL } from '../lib/pm25Grid'
import {
  FIRE_DANGER_CLASS_LABELS,
  FIRE_DANGER_VECTOR_TILE_MAX_ZOOM,
  FIRE_DANGER_VECTOR_TILE_MIN_ZOOM,
  FIRE_DANGER_VECTOR_TILE_URL_TEMPLATE,
} from '../lib/fireDangerGrid'
import { FIRE_DANGER_FILL_COLORS } from '../lib/aqMapConstants'
import { hexToRgb } from '@/lib/color'

const EARTH_RADIUS = 6378137
const MAX_MERCATOR_LAT = 85.0511287798
const DECK_ANCHOR_SOURCE_ID = 'aqdeck-anchor-source'
const DECK_ANCHOR_LAYER_ID = 'aqdeck-anchor-layer'

function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clampedLat = Math.max(Math.min(lat, MAX_MERCATOR_LAT), -MAX_MERCATOR_LAT)
  const x = (EARTH_RADIUS * lng * Math.PI) / 180
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))
  return [x, y]
}
const FIRE_RGB: [number, number, number][] = [0, 1, 2, 3, 4].map((c) => hexToRgb(FIRE_DANGER_FILL_COLORS[c]))

function themedTooltipHtml(title: string, body: string): string {
  return `
    <div class="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div class="tooltip_title font-semibold text-foreground">${title}</div>
      <div class="text-muted-foreground">${body.trim()}</div>
    </div>
  `
}

/** Substitute the layer's {bbox-epsg-3857} placeholder with this tile's bbox in metres. */
function buildWmsTileUrl(template: string, west: number, south: number, east: number, north: number): string {
  const [minX, minY] = lngLatToMercator(west, south)
  const [maxX, maxY] = lngLatToMercator(east, north)
  return template.replace('{bbox-epsg-3857}', `${minX},${minY},${maxX},${maxY}`)
}

function buildRasterTileUrl(template: string, tile: { bbox: GeoBBox; index?: DeckTileIndex }): string {
  if (template.includes('{bbox-epsg-3857}')) {
    const { west, south, east, north } = tile.bbox
    return buildWmsTileUrl(template, west, south, east, north)
  }
  if (tile.index) {
    return template
      .replace('{z}', String(tile.index.z))
      .replace('{x}', String(tile.index.x))
      .replace('{y}', String(tile.index.y))
  }
  return template
}

function getFirstMonitorLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.id.startsWith('aqmap-monitor-'))?.id
}

function ensureDeckAnchorLayer(map: maplibregl.Map): string {
  if (!map.getSource(DECK_ANCHOR_SOURCE_ID)) {
    map.addSource(DECK_ANCHOR_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer(DECK_ANCHOR_LAYER_ID)) {
    const beforeId = getFirstMonitorLayerId(map)
    map.addLayer({
      id: DECK_ANCHOR_LAYER_ID,
      type: 'circle',
      source: DECK_ANCHOR_SOURCE_ID,
      paint: {
        'circle-opacity': 0,
        'circle-radius': 0,
      },
    }, beforeId)
  }
  return DECK_ANCHOR_LAYER_ID
}

function removeDeckAnchorLayer(map: maplibregl.Map): void {
  try {
    if (map.getLayer(DECK_ANCHOR_LAYER_ID)) map.removeLayer(DECK_ANCHOR_LAYER_ID)
    if (map.getSource(DECK_ANCHOR_SOURCE_ID)) map.removeSource(DECK_ANCHOR_SOURCE_ID)
  } catch {
    // MapLibre can throw during style teardown.
  }
}

type GeoBBox = { west: number; south: number; east: number; north: number }
type TileBoundingBox = [[number, number], [number, number]]
type FireDangerDeckProperties = { g?: number; GRIDCODE?: number }
type Pm25DeckProperties = {
  c?: number
  label?: string
  pm25_min?: number
  pm25_max?: number | null
  fill?: string
}
type FireDangerDeckFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  FireDangerDeckProperties
>
type Pm25DeckFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  Pm25DeckProperties
>
type DeckTileIndex = { x: number; y: number; z: number }
type DeckTileConfig = {
  tileSize: number
  minZoom: number
  maxZoom: number
  opacity: number
  getTileData: (tile: { bbox: unknown; index?: DeckTileIndex; signal?: AbortSignal | null }) => Promise<ImageBitmap | null>
  renderSubLayers: (props: { id: string; data: ImageBitmap | null; tile: { boundingBox: unknown } }) => BitmapLayer | null
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
    return await fetchJson<FireDangerDeckFeatureCollection>(buildFireDangerTileUrl(index), signal ?? undefined)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    return null
  }
}

function pm25FillColor(properties: Pm25DeckProperties | null | undefined): [number, number, number] {
  const fill = properties?.fill
  return typeof fill === 'string' && /^#[0-9a-f]{6}$/i.test(fill) ? hexToRgb(fill) : [33, 197, 244]
}

function pm25TooltipBody(properties: Pm25DeckProperties | null | undefined): string {
  const label = properties?.label
  if (label) return ` ${label} ug/m3`
  const min = properties?.pm25_min
  const max = properties?.pm25_max
  if (Number.isFinite(min) && Number.isFinite(max)) return ` ${min}-${max} ug/m3`
  if (Number.isFinite(min)) return ` ${min}+ ug/m3`
  return ''
}

/**
 * Single interleaved deck.gl overlay for the AQ map's experimental "deck.gl"
 * render modes:
 *  - Modelled PM2.5 loads a classified polygon snapshot generated from the
 *    native RAQDPS GRIB2 rotated-lat-lon grid.
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
  fireDangerActive,
  suppressHoverPopups = false,
}: {
  tileKeys: WmsLayerKey[]
  fireDangerActive: boolean
  suppressHoverPopups?: boolean
}) {
  const { map, isLoaded } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const fireDangerTooltipRef = useRef<maplibregl.Popup | null>(null)
  const pm25TooltipRef = useRef<maplibregl.Popup | null>(null)
  const suppressHoverPopupsRef = useRef(suppressHoverPopups)
  const [pm25NativeVectorData, setPm25NativeVectorData] = useState<Pm25DeckFeatureCollection | null>(null)
  const rebuildRef = useRef<() => void>(() => {})
  const tileKey = [...tileKeys].sort().join(',')
  const pm25DeckActive = tileKeys.includes('modelledPm25')
  const pm25NativeVector = pm25DeckActive ? pm25NativeVectorData : null
  const pm25OrderedVector = useMemo<Pm25DeckFeatureCollection | null>(() => {
    if (!pm25NativeVector) return null
    return {
      ...pm25NativeVector,
      features: [...pm25NativeVector.features].sort((a, b) =>
        Number(a.properties?.c ?? 0) - Number(b.properties?.c ?? 0),
      ),
    }
  }, [pm25NativeVector])

  function removeDeckHoverPopups() {
    fireDangerTooltipRef.current?.remove()
    pm25TooltipRef.current?.remove()
  }

  // Create / destroy the single deck overlay.
  useEffect(() => {
    if (!isLoaded || !map) return
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay
    rebuildRef.current()

    const canvas = map.getCanvas()
    const handleDocumentPointerMove = (event: PointerEvent) => {
      if (event.target instanceof Node && canvas.contains(event.target)) return
      removeDeckHoverPopups()
    }
    const handleVisibilityChange = () => {
      if (document.hidden) removeDeckHoverPopups()
    }

    canvas.addEventListener('mouseleave', removeDeckHoverPopups)
    document.addEventListener('pointermove', handleDocumentPointerMove, true)
    window.addEventListener('blur', removeDeckHoverPopups)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      canvas.removeEventListener('mouseleave', removeDeckHoverPopups)
      document.removeEventListener('pointermove', handleDocumentPointerMove, true)
      window.removeEventListener('blur', removeDeckHoverPopups)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      removeDeckHoverPopups()
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl)
      } catch {
        // MapLibre can throw during teardown.
      }
      removeDeckAnchorLayer(map)
      overlayRef.current = null
    }
  }, [isLoaded, map])

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

  useEffect(() => {
    if (!isLoaded || !map || !pm25DeckActive) {
      pm25TooltipRef.current?.remove()
      pm25TooltipRef.current = null
      return
    }

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'mapcn-tooltip aqmap-tooltip pointer-events-none',
      offset: 12,
    })
    pm25TooltipRef.current = popup

    return () => {
      popup.remove()
      if (pm25TooltipRef.current === popup) pm25TooltipRef.current = null
    }
  }, [isLoaded, map, pm25DeckActive])

  useEffect(() => {
    suppressHoverPopupsRef.current = suppressHoverPopups
    if (suppressHoverPopups) {
      removeDeckHoverPopups()
    }
  }, [suppressHoverPopups])

  useEffect(() => {
    if (!pm25DeckActive || pm25NativeVectorData) return
    const controller = new AbortController()
    fetchJson<Pm25DeckFeatureCollection>(PM25_NATIVE_VECTOR_URL, controller.signal)
      .then(setPm25NativeVectorData)
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') console.error('PM2.5 native vector failed', error)
      })
    return () => controller.abort()
  }, [pm25DeckActive, pm25NativeVectorData])

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
          try {
            const response = await fetch(buildRasterTileUrl(template, {
              bbox: tile.bbox as GeoBBox,
              index: tile.index,
            }), {
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

  // Rebuild the deck layer list.
  useEffect(() => {
    const activeTileKeys = (tileKey ? tileKey.split(',') : []) as WmsLayerKey[]
    const pm25Active = activeTileKeys.includes('modelledPm25')
    const rasterTileKeys = activeTileKeys.filter((key) => key !== 'modelledPm25')

    const rebuild = () => {
      const overlay = overlayRef.current
      if (!overlay || !map) return
      const beforeId = ensureDeckAnchorLayer(map)
      const layers: Layer[] = []

      for (const key of rasterTileKeys) {
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

      if (pm25Active && pm25OrderedVector?.features?.length) {
        layers.push(
          new GeoJsonLayer({
            id: 'aqdeck-pm25-native-vector',
            data: pm25OrderedVector,
            pickable: true,
            stroked: false,
            filled: true,
            opacity: 0.6,
            parameters: {
              depthTest: false,
            },
            getFillColor: (feature: { properties?: Pm25DeckProperties }) =>
              pm25FillColor(feature.properties),
            onHover: (info: { object?: { properties?: Pm25DeckProperties } | null; coordinate?: [number, number] }) => {
              const popup = pm25TooltipRef.current
              if (!popup || !map) return
              if (suppressHoverPopupsRef.current || !info.object || !info.coordinate) {
                popup.remove()
                return
              }
              popup
                .setLngLat(info.coordinate)
                .setHTML(themedTooltipHtml('Modelled PM2.5', pm25TooltipBody(info.object.properties)))
                .addTo(map)
            },
            beforeId,
          } as unknown as ConstructorParameters<typeof GeoJsonLayer>[0]),
        )
      }

      if (fireDangerActive) {
        const handleFireDangerHover = (info: { object?: { properties?: FireDangerDeckProperties } | null; coordinate?: [number, number] }) => {
          const popup = fireDangerTooltipRef.current
          if (!popup || !map) return
          if (suppressHoverPopupsRef.current || !info.object || !info.coordinate) {
            popup.remove()
            return
          }
          const cls = fireDangerClass(info.object.properties)
          popup
            .setLngLat(info.coordinate)
            .setHTML(themedTooltipHtml('Fire danger', ` ${FIRE_DANGER_CLASS_LABELS[cls]}`))
            .addTo(map)
        }

        layers.push(
          new TileLayer({
            id: 'aqdeck-fire-danger-vector-tiles',
            tileSize: 512,
            minZoom: FIRE_DANGER_VECTOR_TILE_MIN_ZOOM,
            maxZoom: FIRE_DANGER_VECTOR_TILE_MAX_ZOOM,
            extent: [-180, 30, 180, 86],
            pickable: true,
            onHover: handleFireDangerHover,
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
                onHover: handleFireDangerHover,
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
  }, [map, tileKey, fireDangerActive, suppressHoverPopups, tileConfigs, pm25OrderedVector])

  return null
}

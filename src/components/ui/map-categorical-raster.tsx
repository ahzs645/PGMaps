import { useEffect, useId, useRef, useState } from 'react'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'
import { useMap } from './map'
import { useDeckOverlay } from './map-deck'
import { fetchJson } from '@/lib/fetchJson'
import { withBase } from '@/lib/dataUrl'
import { CategoricalPolygonWorkerPool } from '@/lib/categoricalPolygonWorkerPool'
import type { PreparedPolygons } from '@/lib/categoricalPolygonGeometry'
import { ViewportBlockLoader, type BlockLoadScope } from '@/lib/viewportBlockLoader'
import { canPublishRasterLevel, selectRasterLevel, type RasterLevel } from '@/lib/categoricalRasterLevels'
import { ResidentRasterBlocks } from '@/lib/residentRasterBlocks'
import { SharedRequestCache } from '@/lib/sharedRequestCache'

type Tile = { id: string; path: string; bounds: [number, number, number, number] }
type Manifest = { format: string; tiles: Tile[] }
type Pyramid = { format: 'categorical-raster-pyramid-v1'; levels: RasterLevel[] }
export type CategoricalRasterPick = { value: number; longitude: number; latitude: number; overview?: boolean }
export type CategoricalRasterStatus = { state: 'loading' | 'ready' | 'error'; message: string }
type Block = { id: string; data: PreparedPolygons }

/** Camera `move` events start block work at most this often (Leaflet's GridLayer uses 200 ms). */
export const BLOCK_MOVE_THROTTLE_MS = 120
/**
 * During a camera gesture, at most this many blocks are handed to deck.gl for a first GPU upload per
 * animation frame; the rest follow on later frames. A settled view uploads everything at once, as before.
 */
export const GESTURE_BLOCK_UPLOADS_PER_FRAME = 2

/** Data saver asks for fewer bytes: wait for the settled view rather than load during a gesture. */
/**
 * Polygon indexes and decoded blocks outlive the layer that read them, so a story scene, a period or a
 * scenario shown again draws from memory instead of reading and decoding its files a second time, and a
 * page reading a manifest for its legend shares that read with the layer. Bounded: 48 indexes, and decoded
 * blocks up to `DECODED_BLOCK_BUDGET_BYTES`.
 */
const DECODED_BLOCK_BUDGET_BYTES = 96 * 1024 * 1024
const manifestCache = new SharedRequestCache<unknown>({ maxEntries: 48 })
const blockCache = new SharedRequestCache<PreparedPolygons>({
  maxEntries: 512,
  maxBytes: DECODED_BLOCK_BUDGET_BYTES,
  sizeOf: preparedPolygonBytes,
})

/** One read of a raster polygon manifest per URL for the page's life, shared by every caller. */
export function fetchRasterManifest<T>(url: string, signal?: AbortSignal): Promise<T> {
  return manifestCache.load(url, (shared) => fetchJson<unknown>(url, shared), signal) as Promise<T>
}

function preparedPolygonBytes(data: PreparedPolygons): number {
  let bytes = data.values.byteLength
  const seen = new Set<ArrayBufferLike>()
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 4) return
    if (ArrayBuffer.isView(value)) {
      if (!seen.has(value.buffer)) {
        seen.add(value.buffer)
        bytes += value.byteLength
      }
      return
    }
    for (const child of Object.values(value)) visit(child, depth + 1)
  }
  visit(data.binary, 0)
  return bytes
}

function prefersSavingData() {
  const connection = (globalThis.navigator as (Navigator & { connection?: { saveData?: boolean } }) | undefined)
    ?.connection
  return connection?.saveData === true
}

/** Draw native numeric/class polygons; colour and picking use the same source value. */
export function MapCategoricalRaster({
  manifestUrl,
  colorForValue,
  onPick,
  onStatus,
  opacity = 0.8,
  attribution,
  beforeId,
  onLayers,
  loadWhileMoving = true,
}: {
  manifestUrl: string
  colorForValue: (value: number) => [number, number, number, number]
  onPick: (pick: CategoricalRasterPick) => void
  onStatus: (status: CategoricalRasterStatus) => void
  opacity?: number
  attribution?: string
  /** Place polygon surfaces beneath an existing MapLibre context anchor. */
  beforeId?: string
  /** Use a shared map overlay when composing several native-grid surfaces. */
  onLayers?: (layers: GeoJsonLayer[]) => void
  /**
   * Load and draw blocks the view shows while the camera moves (default). `false` waits for the
   * settled view: during a gesture only blocks already on the GPU show, and no request starts. A
   * browser asking to save data (`navigator.connection.saveData`) gets `false` whatever is passed.
   */
  loadWhileMoving?: boolean
}) {
  const { map, isLoaded } = useMap()
  const [result, setResult] = useState<{
    source: string
    level?: RasterLevel
    tiles: Block[]
    /** Another level's blocks, given GPU state hidden so a level switch during a gesture uploads nothing. */
    warm?: Block[]
  }>({
    source: '',
    tiles: [],
  })
  const statusRef = useRef(onStatus)
  const loadWhileMovingRef = useRef(loadWhileMoving)
  useEffect(() => {
    loadWhileMovingRef.current = loadWhileMoving
  }, [loadWhileMoving])
  const residentRef = useRef(new ResidentRasterBlocks<PreparedPolygons>())
  const residentSourceRef = useRef('')
  useEffect(() => {
    statusRef.current = onStatus
  }, [onStatus])
  const rebuildRef = useRef<() => void>(() => {})
  const uid = useId().replace(/:/g, '')
  const anchor = `categorical-raster-${uid}`
  const overlayRef = useDeckOverlay({
    enabled: !onLayers,
    onAttach: (_overlay, instance) => {
      instance.addSource(anchor, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution })
      instance.addLayer({ id: anchor, source: anchor, type: 'circle', paint: { 'circle-opacity': 0 } })
      rebuildRef.current()
    },
    onDetach: (instance) => {
      residentRef.current.clear()
      if (!instance.getStyle()) return
      if (instance.getLayer(anchor)) instance.removeLayer(anchor)
      if (instance.getSource(anchor)) instance.removeSource(anchor)
    },
  })

  useEffect(() => {
    if (!onLayers || !map || !isLoaded) return
    const resident = residentRef.current
    map.addSource(anchor, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution })
    map.addLayer({ id: anchor, source: anchor, type: 'circle', paint: { 'circle-opacity': 0 } })
    return () => {
      resident.clear()
      if (!map.getStyle()) return
      if (map.getLayer(anchor)) map.removeLayer(anchor)
      if (map.getSource(anchor)) map.removeSource(anchor)
    }
  }, [map, isLoaded, anchor, attribution, onLayers])

  useEffect(() => {
    if (!map || !isLoaded) return
    let active = true
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const manifestController = new AbortController()
    let levels: RasterLevel[] = []
    let selected: RasterLevel | undefined
    const resources = new Map<string, { manifest: Manifest; loader: ViewportBlockLoader<PreparedPolygons> }>()
    const workers = new CategoricalPolygonWorkerPool()
    const loading = new Set<string>()
    let displayed: string | undefined
    // Blocks handed to deck.gl by the previous frame, whose GPU state may not be resident yet.
    let handed = new Set<string>()
    let lastStatus = ''
    const status = (value: CategoricalRasterStatus) => {
      // Called once a frame while blocks arrive; tell the page only when the wording changes.
      const key = `${value.state}:${value.message}`
      if (key === lastStatus) return
      lastStatus = key
      statusRef.current(value)
    }
    const publish = () => {
      if (!active || frame) return
      // Batch completions to one render per frame; never wait for the slowest block.
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!active || !selected) return
        const level = selected
        const loader = resources.get(level.id)?.loader
        if (!loader) return
        const snapshot = loader.snapshot()
        const { loaded, total, errors } = snapshot
        const key = (block: Block) => `${level.id}/${block.id}`
        const onGpu = (block: Block) =>
          handed.has(key(block)) ||
          (residentSourceRef.current === manifestUrl && residentRef.current.get(key(block)) === block.data)
        const moving = map.isMoving()
        let blocks = snapshot.blocks
        const warm: Block[] = []
        let more = false
        let switchNow = true
        if (moving && !loadsWhileMoving()) {
          // Settled-view mode: during a gesture, toggle only buffers that are already on the GPU.
          blocks = snapshot.visibleBlocks
          if (loaded !== total || !blocks.every(onGpu)) return
        } else if (moving) {
          // Visible blocks get their first upload a few per frame; the prefetch ring's wait for moveend.
          const visible = new Set(snapshot.visibleBlocks.map((block) => block.id))
          const levelShown = !displayed || displayed === level.id
          let budget = GESTURE_BLOCK_UPLOADS_PER_FRAME
          blocks = snapshot.blocks.filter((block) => {
            if (onGpu(block)) return true
            if (!visible.has(block.id)) return false
            if (budget <= 0) {
              more = true
              return false
            }
            budget--
            if (!levelShown) warm.push(block)
            return true
          })
          // A new level replaces the shown one only once all its visible blocks are on the GPU;
          // until then they are uploaded hidden, within the same per-frame budget.
          switchNow = levelShown || (!more && loaded === total)
        }
        if (switchNow && canPublishRasterLevel(displayed, level.id, loaded, total)) {
          displayed = level.id
          handed = new Set(blocks.map(key))
          setResult({ source: manifestUrl, level, tiles: blocks })
        } else if (warm.length) {
          handed = new Set(warm.map(key))
          setResult((current) => ({ ...current, warm: warm.map((block) => ({ ...block, id: key(block) })) }))
        } else {
          handed = new Set()
        }
        if (more) publish()
        const detail = level.overview
          ? 'Generalized display; zoom in for full cells.'
          : 'Click a polygon to read its value.'
        status(
          errors.length
            ? {
                state: 'error',
                message: `${level.label}: ${loaded}/${total} blocks loaded. ${errors[0]}${displayed !== level.id ? ' Keeping the previous detail level.' : ''}`,
              }
            : loaded < total
              ? {
                  state: 'loading',
                  message: `${level.label}: ${loaded}/${total} visible blocks ready…${displayed && displayed !== level.id ? ' Keeping the previous detail level while loading.' : ''}`,
                }
              : {
                  state: 'ready',
                  message: `${level.label}: ${total} visible ${total === 1 ? 'block' : 'blocks'} ready. ${detail}`,
                },
        )
      })
    }
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)
    const install = (level: RasterLevel, value: Manifest) => {
      if (
        !['categorical-raster-polygons-v1', 'numeric-raster-polygons-v1'].includes(value.format) ||
        !Array.isArray(value.tiles)
      ) {
        throw new Error('Unsupported raster polygon manifest')
      }
      const paths = new Map(value.tiles.map((tile) => [tile.id, tile.path]))
      const path = `${base}${level.manifest}`
      const tileBase = path.slice(0, path.lastIndexOf('/') + 1)
      resources.set(level.id, {
        manifest: value,
        loader: new ViewportBlockLoader((id, signal) => {
          // A retained GPU layer may outlive the loader's separate decoded-data LRU.
          const resident =
            residentSourceRef.current === manifestUrl ? residentRef.current.get(`${level.id}/${id}`) : undefined
          if (resident) return Promise.resolve(resident)
          const url = new URL(withBase(`${tileBase}${paths.get(id)!}`), window.location.href).href
          const kept = blockCache.peek(url)
          if (kept) return Promise.resolve(kept)
          // Decoded blocks are kept, not shared in flight: each layer's workers end with the layer.
          return workers.load(url, signal).then((data) => {
            blockCache.set(url, data)
            return data
          })
        }, publish),
      })
    }
    const loadsWhileMoving = () => loadWhileMovingRef.current && !prefersSavingData()
    const moveScope = (): BlockLoadScope => (!map.isMoving() ? 'all' : loadsWhileMoving() ? 'visible' : 'none')
    let lastZoom = Number.NaN
    const update = (retry = false) => {
      if (!levels.length) return
      const zoom = map.getZoom()
      const zoomingNow = map.isMoving() && zoom !== lastZoom
      lastZoom = zoom
      let next = selectRasterLevel(levels, zoom, selected)
      // While a gesture is still zooming in, a finer level would only be requested to be replaced: the
      // coarser level stays drawn (scaled up) and keeps loading the view; the finer one starts once the
      // zoom holds for a throttle interval or the camera settles. A coarser level loads at once, because
      // zooming out exposes ground the finer level has not loaded.
      if (zoomingNow && selected && next.minZoom > selected.minZoom && loadsWhileMoving()) next = selected
      if (selected !== next) {
        // Cancel obsolete requests but retain each level's bounded LRU cache.
        if (selected) resources.get(selected.id)?.loader.update([])
        selected = next
      }
      const resource = resources.get(next.id)
      if (!resource) {
        if (loading.has(next.id)) return
        loading.add(next.id)
        status({ state: 'loading', message: `Loading ${next.label.toLowerCase()} index…` })
        fetchRasterManifest<Manifest>(`${base}${next.manifest}`, manifestController.signal)
          .then((value) => {
            if (!active) return
            install(next, value)
            if (selected === next) update()
          })
          .catch((cause: unknown) => {
            if (active && selected === next) status({ state: 'error', message: String(cause) })
          })
          .finally(() => loading.delete(next.id))
        return
      }
      const { manifest, loader } = resource
      const bounds = map.getBounds()
      const w = bounds.getWest(),
        e = bounds.getEast(),
        s = bounds.getSouth(),
        n = bounds.getNorth()
      const dx = (e - w) * 0.25,
        dy = (n - s) * 0.25
      const intersects = (tile: Tile, margin: boolean) => {
        const [tw, ts, te, tn] = tile.bounds
        return (
          tw <= e + (margin ? dx : 0) &&
          te >= w - (margin ? dx : 0) &&
          ts <= n + (margin ? dy : 0) &&
          tn >= s - (margin ? dy : 0)
        )
      }
      const distance = ({ bounds: [tw, ts, te, tn] }: Tile) =>
        ((tw + te - w - e) / Math.max(e - w, 1e-9)) ** 2 + ((ts + tn - s - n) / Math.max(n - s, 1e-9)) ** 2
      const nearby = manifest.tiles.filter((tile) => intersects(tile, true)).sort((a, b) => distance(a) - distance(b))
      loader.update(
        nearby.filter((tile) => intersects(tile, false)).map((tile) => tile.id),
        nearby.filter((tile) => !intersects(tile, false)).map((tile) => tile.id),
        retry,
        moveScope(),
      )
    }
    const moving = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        update()
      }, BLOCK_MOVE_THROTTLE_MS)
    }
    const settled = () => {
      clearTimeout(timer)
      timer = undefined
      update(true)
    }
    status({ state: 'loading', message: 'Loading polygon index…' })
    fetchRasterManifest<Manifest | Pyramid>(manifestUrl, manifestController.signal)
      .then((value) => {
        if (!active) return
        if ('levels' in value && value.format === 'categorical-raster-pyramid-v1') {
          levels = [...value.levels].sort((a, b) => a.minZoom - b.minZoom)
          if (!levels.length || levels.some((l) => !l.id || !l.manifest || !Number.isFinite(l.minZoom))) {
            throw new Error('Invalid categorical raster zoom levels')
          }
        } else {
          levels = [
            { id: 'full', label: 'Full grid', minZoom: 0, overview: false, manifest: manifestUrl.slice(base.length) },
          ]
          install(levels[0], value as Manifest)
        }
        update()
      })
      .catch((cause: unknown) => {
        if (!active) return
        setResult({ source: manifestUrl, tiles: [] })
        status({ state: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      })
    map.on('move', moving)
    map.on('moveend', settled)
    return () => {
      active = false
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      workers.dispose()
      for (const { loader } of resources.values()) loader.dispose()
      manifestController.abort()
      map.off('move', moving)
      map.off('moveend', settled)
    }
  }, [map, isLoaded, manifestUrl])

  useEffect(() => {
    const rebuild = () => {
      if (residentSourceRef.current !== manifestUrl) {
        residentRef.current.clear()
        residentSourceRef.current = manifestUrl
      }
      const current =
        result.source === manifestUrl
          ? result.tiles.map((block) => ({
              ...block,
              id: `${result.level?.id}/${block.id}`,
            }))
          : []
      const warm = result.source === manifestUrl ? (result.warm ?? []) : []
      const retained = residentRef.current.update(current, warm)
      const layers = retained.map(
        ({ id, data, visible }) =>
          new GeoJsonLayer<{ value: number }>({
            id: `${anchor}-${id}`,
            ...{ beforeId },
            data: data.binary,
            visible,
            filled: true,
            stroked: false,
            pickable: visible,
            opacity: 1,
            getFillColor: (feature) => {
              const [r, g, b, a] = colorForValue(feature.properties.value)
              return [r, g, b, Math.round(a * opacity)]
            },
            updateTriggers: { getFillColor: [colorForValue, opacity] },
            onClick: (info: PickingInfo) => {
              // Binary GeoJSON picking reports a global feature index, not a GeoJSON object.
              if (info.index >= 0 && info.index < data.values.length && info.coordinate) {
                onPick({
                  value: data.values[info.index],
                  longitude: info.coordinate[0],
                  latitude: info.coordinate[1],
                  overview: result.level?.overview,
                })
              }
            },
          }),
      )
      if (onLayers) onLayers(layers)
      else overlayRef.current?.setProps({ layers })
    }
    rebuildRef.current = rebuild
    rebuild()
  }, [result, manifestUrl, colorForValue, onPick, opacity, overlayRef, anchor, beforeId, onLayers])

  useEffect(
    () => () => {
      onLayers?.([])
    },
    [onLayers],
  )

  return null
}

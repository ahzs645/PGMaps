import { useEffect, useId, useRef, useState } from 'react'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'
import { useMap } from './map'
import { useDeckOverlay } from './map-deck'
import { fetchJson } from '@/lib/fetchJson'
import { withBase } from '@/lib/dataUrl'
import { CategoricalPolygonWorkerPool } from '@/lib/categoricalPolygonWorkerPool'
import type { PreparedPolygons } from '@/lib/categoricalPolygonGeometry'
import { ViewportBlockLoader } from '@/lib/viewportBlockLoader'
import { canPublishRasterLevel, selectRasterLevel, type RasterLevel } from '@/lib/categoricalRasterLevels'
import { ResidentRasterBlocks } from '@/lib/residentRasterBlocks'

type Tile = { id: string; path: string; bounds: [number, number, number, number] }
type Manifest = { format: string; tiles: Tile[] }
type Pyramid = { format: 'categorical-raster-pyramid-v1'; levels: RasterLevel[] }
export type CategoricalRasterPick = { value: number; longitude: number; latitude: number; overview?: boolean }
export type CategoricalRasterStatus = { state: 'loading' | 'ready' | 'error'; message: string }

/** Draw native class polygons from categorical_raster.py; colour and picking use the same value. */
export function MapCategoricalRaster({
  manifestUrl,
  colorForValue,
  onPick,
  onStatus,
  opacity = 0.8,
  attribution,
}: {
  manifestUrl: string
  colorForValue: (value: number) => [number, number, number, number]
  onPick: (pick: CategoricalRasterPick) => void
  onStatus: (status: CategoricalRasterStatus) => void
  opacity?: number
  attribution?: string
}) {
  const { map, isLoaded } = useMap()
  const [result, setResult] = useState<{
    source: string
    level?: RasterLevel
    tiles: Array<{ id: string; data: PreparedPolygons }>
  }>({
    source: '',
    tiles: [],
  })
  const statusRef = useRef(onStatus)
  const residentRef = useRef(new ResidentRasterBlocks<PreparedPolygons>())
  const residentSourceRef = useRef('')
  useEffect(() => {
    statusRef.current = onStatus
  }, [onStatus])
  const rebuildRef = useRef<() => void>(() => {})
  const uid = useId().replace(/:/g, '')
  const anchor = `categorical-raster-${uid}`
  const overlayRef = useDeckOverlay({
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
    const publish = () => {
      if (!active || frame) return
      // Batch completions to one render per frame; never wait for the slowest block.
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!active || !selected) return
        const loader = resources.get(selected.id)?.loader
        if (!loader) return
        const snapshot = loader.snapshot()
        const { loaded, total, errors } = snapshot
        // During a gesture, toggle only buffers that are already on the GPU.
        // New uploads and prefetched geometry still wait for moveend.
        const blocks = map.isMoving() ? snapshot.visibleBlocks : snapshot.blocks
        if (
          map.isMoving() &&
          (loaded !== total ||
            residentSourceRef.current !== manifestUrl ||
            !residentRef.current.hasAll(blocks.map((block) => ({ ...block, id: `${selected!.id}/${block.id}` }))))
        )
          return
        if (canPublishRasterLevel(displayed, selected.id, loaded, total)) {
          displayed = selected.id
          setResult({ source: manifestUrl, level: selected, tiles: blocks })
        }
        const detail = selected.overview
          ? 'Generalized display; zoom in for full cells.'
          : 'Click a polygon to read its class.'
        statusRef.current(
          errors.length
            ? {
                state: 'error',
                message: `${selected.label}: ${loaded}/${total} blocks loaded. ${errors[0]}${displayed !== selected.id ? ' Keeping the previous detail level.' : ''}`,
              }
            : loaded < total
              ? {
                  state: 'loading',
                  message: `${selected.label}: ${loaded}/${total} visible blocks ready…${displayed && displayed !== selected.id ? ' Keeping the previous detail level while loading.' : ''}`,
                }
              : {
                  state: 'ready',
                  message: `${selected.label}: ${total} visible ${total === 1 ? 'block' : 'blocks'} ready. ${detail}`,
                },
        )
      })
    }
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)
    const install = (level: RasterLevel, value: Manifest) => {
      if (value.format !== 'categorical-raster-polygons-v1' || !Array.isArray(value.tiles)) {
        throw new Error('Unsupported categorical raster polygon manifest')
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
          return resident
            ? Promise.resolve(resident)
            : workers.load(new URL(withBase(`${tileBase}${paths.get(id)!}`), window.location.href).href, signal)
        }, publish),
      })
    }
    const update = (retry = false) => {
      if (!levels.length) return
      const next = selectRasterLevel(levels, map.getZoom(), selected)
      if (selected !== next) {
        // Cancel obsolete requests but retain each level's bounded LRU cache.
        if (selected) resources.get(selected.id)?.loader.update([])
        selected = next
      }
      const resource = resources.get(next.id)
      if (!resource) {
        if (loading.has(next.id)) return
        loading.add(next.id)
        statusRef.current({ state: 'loading', message: `Loading ${next.label.toLowerCase()} index…` })
        fetchJson<Manifest>(`${base}${next.manifest}`, manifestController.signal)
          .then((value) => {
            if (!active) return
            install(next, value)
            if (selected === next) update()
          })
          .catch((cause: unknown) => {
            if (active && selected === next) statusRef.current({ state: 'error', message: String(cause) })
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
        !map.isMoving(),
      )
    }
    const moving = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        update()
      }, 120)
    }
    const settled = () => {
      clearTimeout(timer)
      timer = undefined
      update(true)
    }
    statusRef.current({ state: 'loading', message: 'Loading polygon index…' })
    fetchJson<Manifest | Pyramid>(manifestUrl, manifestController.signal)
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
        statusRef.current({ state: 'error', message: cause instanceof Error ? cause.message : String(cause) })
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
      const retained = residentRef.current.update(current)
      overlayRef.current?.setProps({
        layers: retained.map(
          ({ id, data, visible }) =>
            new GeoJsonLayer<{ value: number }>({
              id: `${anchor}-${id}`,
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
        ),
      })
    }
    rebuildRef.current = rebuild
    rebuild()
  }, [result, manifestUrl, colorForValue, onPick, opacity, overlayRef, anchor])

  return null
}

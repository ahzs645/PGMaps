import { GeoJsonLayer } from '@deck.gl/layers'
import { WebMercatorViewport } from '@deck.gl/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { useDeckOverlay } from '@/components/ui/map-deck'
import { dispatchMobileMapFeatureClick } from '@/components/ui/map-context'
import type { MapMouseEvent } from 'maplibre-gl'
import type { ResolvedLayer } from './storyScene'
import { climateColor } from './adapters/climateStyle'
import type {
  Cells,
  CellProperties,
} from '../../../vendor/bcdatamapper/datascrapers/climate/climatedata-ca/bc-climate/deckgl.mjs'
import {
  ClimateStore,
  ClimateZoomError,
  canPrefetch,
  reuseClimateGeometry,
  type ClimateTile,
} from './adapters/climateStore'
import type { Map as MapInstance } from 'maplibre-gl'

export type ClimateStatus = {
  status: 'loading' | 'ready' | 'error' | 'zoom' | 'empty'
  message: string
  cells: number
  selection: string
}
type LoadedTile = Omit<ClimateTile, 'data'> & { geometry: Cells; properties: Map<string, CellProperties> }
export type ClimateReadAhead = {
  layers: ResolvedLayer[]
  camera: (map: MapInstance) => { center: [number, number]; zoom: number; bearing: number; pitch: number } | null
}
type Selection = { layerId: string; id: string; title: string; layerLabel: string; detail: string }
const ANCHOR = 'story-climate-anchor'

function cellSelection(p: CellProperties, resolved: ResolvedLayer, scenario: string): Selection {
  return {
    layerId: resolved.layer.id,
    id: p.cellId,
    title: `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 }).format(p.value)} ${p.units}`,
    layerLabel: resolved.label,
    detail: `${p.horizon} · ${p.percentile?.toUpperCase() ?? 'Archive (no percentile)'} · ${p.season}\n${p.measure === 'absolute' ? 'Absolute climatology' : `Source delta from ${p.baseline}`} · ${scenario}\nCell: ${p.cellId}\nStored value: ${p.value} ${p.units}\nNative grid value, not a population-weighted regional average or a building-level forecast. Border cells retain their full footprints.`,
  }
}

export default function StoryClimateLayers({
  layers,
  retry,
  onStatus,
  onSelect,
  onDisplay,
  readAhead,
}: {
  layers: ResolvedLayer[]
  retry: number
  onStatus: (state: ClimateStatus) => void
  onSelect: (selection: Selection) => void
  onDisplay: (layers: ResolvedLayer[]) => void
  readAhead: ClimateReadAhead | null
}) {
  const { map, isLoaded } = useMap()
  const [tiles, setTiles] = useState<LoadedTile[]>([])
  const [store] = useState(
    () =>
      new ClimateStore(
        typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 48 * 1024 * 1024 : undefined,
      ),
  )
  useEffect(() => () => store.clear(), [store])
  const rebuildRef = useRef<() => void>(() => {})
  const overlayRef = useDeckOverlay({
    onAttach: () => rebuildRef.current(),
    onDetach: (instance) => {
      if (instance.getLayer(ANCHOR)) instance.removeLayer(ANCHOR)
      if (instance.getSource(ANCHOR)) instance.removeSource(ANCHOR)
    },
  })

  useEffect(() => {
    if (!map || !isLoaded) return
    let active = true
    let request: AbortController | undefined
    let ahead: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let ready = false
    const connection = (
      navigator as Navigator & { connection?: EventTarget & { saveData?: boolean; effectiveType?: string } }
    ).connection
    const stopAhead = () => {
      clearTimeout(timer)
      ahead?.abort()
    }
    const scheduleAhead = () => {
      stopAhead()
      if (!ready || !readAhead?.layers.length || !canPrefetch(document.hidden, connection)) return
      timer = setTimeout(() => {
        if (!active || map.isMoving() || !canPrefetch(document.hidden, connection)) return
        const camera = readAhead.camera(map)
        if (!camera) return
        const { width, height } = map.getContainer().getBoundingClientRect()
        const extent = new WebMercatorViewport({
          width,
          height,
          longitude: camera.center[0],
          latitude: camera.center[1],
          zoom: camera.zoom,
          bearing: camera.bearing,
          pitch: camera.pitch,
        }).getBounds()
        ahead = new AbortController()
        // Speculation is optional: errors/budgets are silent and foreground retries normally.
        void store.load(readAhead.layers, extent, camera.zoom, ahead.signal, true).catch(() => {})
      }, 800)
    }
    const report = (state: Omit<ClimateStatus, 'selection'>) =>
      onStatus({ ...state, selection: layers.map((l) => l.layer.id).join(',') })
    const load = async () => {
      request?.abort()
      stopAhead()
      ready = false
      const controller = new AbortController()
      request = controller
      const signal = controller.signal
      const current = () => active && !signal.aborted
      if (!layers.length) {
        setTiles([])
        ready = true
        scheduleAhead()
        return
      }
      report({ status: 'loading', message: `Loading ${layers.map((l) => l.label).join(', ')}…`, cells: 0 })
      try {
        const bounds = map.getBounds()
        const extent: [number, number, number, number] = [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ]
        const loaded = await store.load(layers, extent, map.getZoom(), signal)
        if (current()) {
          const cells = loaded.reduce((sum, tile) => sum + tile.data.features.length, 0)
          setTiles((previous) =>
            loaded.map(({ data, ...tile }) => ({
              ...tile,
              geometry: reuseClimateGeometry(previous.find((p) => p.id === tile.id)?.geometry, data),
              properties: new Map(data.features.map((f) => [f.properties.cellId, f.properties])),
            })),
          )
          report({
            status: cells ? 'ready' : 'empty',
            cells,
            message: cells
              ? `${cells.toLocaleString()} native climate cells loaded. Click a cell for its value.`
              : 'No source values in this view. Pan back into BC; missing cells are not zero.',
          })
          ready = true
          scheduleAhead()
        }
      } catch (error) {
        if (current()) {
          // A successful HTTP response may still contain malformed JSON/binary.
          // Retrying must refetch it, not repeatedly decode a poisoned cache.
          if (!(error instanceof ClimateZoomError)) store.clearCache()
          setTiles([])
          report({
            status: error instanceof ClimateZoomError ? 'zoom' : 'error',
            message:
              error instanceof ClimateZoomError
                ? error.message
                : `Could not load ${layers.map((l) => l.label).join(', ')}. ${error instanceof Error ? error.message : 'Source unavailable.'}`,
            cells: 0,
          })
        }
      }
    }
    const stop = () => {
      ready = false
      request?.abort()
      stopAhead()
    }
    if (!layers.length || !map.isMoving()) void load()
    map.on('movestart', stop)
    map.on('moveend', load)
    document.addEventListener('visibilitychange', scheduleAhead)
    connection?.addEventListener('change', scheduleAhead)
    return () => {
      active = false
      stop()
      map.off('movestart', stop)
      map.off('moveend', load)
      document.removeEventListener('visibilitychange', scheduleAhead)
      connection?.removeEventListener('change', scheduleAhead)
    }
  }, [map, isLoaded, layers, retry, onStatus, readAhead, store])

  useEffect(() => {
    if (!map || !isLoaded) return
    const click = (event: MapMouseEvent) => {
      // Use MapLibre's click stream; its drag handlers can consume the DOM
      // gesture before Deck's own click recognizer. Deck still does the picking.
      // Story point markers above the climate surface retain click priority.
      if (map.queryRenderedFeatures(event.point).some((feature) => feature.layer.id.startsWith('circle-layer-'))) return
      const pick = overlayRef.current?.pickObject({ x: event.point.x, y: event.point.y, radius: 2 })
      const tile = tiles.find((tile) => tile.id === pick?.layer?.id)
      const p = tile?.properties.get(pick?.object?.properties.cellId)
      if (!tile || !p) return
      dispatchMobileMapFeatureClick()
      // Contextual polygon handlers run in the same event; the picked climate
      // cell takes precedence over those outlines, but never over a point.
      queueMicrotask(() => onSelect(cellSelection(p, tile.resolved, tile.scenario)))
    }
    map.on('click', click)
    return () => {
      map.off('click', click)
    }
  }, [map, isLoaded, tiles, overlayRef, onSelect])

  useLayoutEffect(() => {
    const rebuild = () => {
      if (!map || !isLoaded || !overlayRef.current) return
      // Below labels and app-owned boundaries/points, including sources arriving later.
      if (!map.getSource(ANCHOR))
        map.addSource(ANCHOR, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer(ANCHOR))
        map.addLayer(
          { id: ANCHOR, type: 'circle', source: ANCHOR, paint: { 'circle-radius': 0 } },
          map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id,
        )
      overlayRef.current.setProps({
        layers: tiles.map(
          ({ id, resolved, geometry, properties }) =>
            new GeoJsonLayer<CellProperties>({
              id,
              data: geometry,
              ...{ beforeId: ANCHOR },
              filled: true,
              stroked: false,
              pickable: true,
              opacity: typeof resolved.fillOpacity === 'number' ? resolved.fillOpacity : resolved.layer.fillOpacity,
              getFillColor: (feature) =>
                climateColor(properties.get(feature.properties.cellId)!.value, resolved.layer.climate!),
              updateTriggers: { getFillColor: [properties, resolved.layer.climate] },
            }),
        ),
        getTooltip: ({ object, layer }) => {
          const p = tiles.find((t) => t.id === layer?.id)?.properties.get(object?.properties.cellId)
          return p
            ? {
                text: `${p.value.toFixed(2)} ${p.units}\n${p.horizon} · ${p.percentile?.toUpperCase() ?? 'Archive (no percentile)'}`,
              }
            : null
        },
      })
      onDisplay([...new Map(tiles.map((t) => [t.resolved.layer.id, t.resolved])).values()])
    }
    rebuildRef.current = rebuild
    rebuild()
  }, [map, isLoaded, tiles, onDisplay, overlayRef])
  return null
}

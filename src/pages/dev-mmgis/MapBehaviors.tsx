import { useEffect, useRef } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '../dev-forestry/terrain'
import type { Camera, Coordinate, Tool } from './model'

export function WorkbenchMapEvents({
  onReady,
  onCamera,
  onPointer,
  onClick,
  tool,
  onFinish,
  terrain,
}: {
  onReady?: (m: MapLibreGL.Map | null) => void
  onCamera?: (c: Camera) => void
  onPointer?: (p: Coordinate) => void
  onClick?: (p: Coordinate) => void
  tool: Tool
  onFinish?: () => void
  terrain: boolean
}) {
  const { map, isLoaded } = useMap()
  const latest = useRef({ onCamera, onPointer, onClick, onFinish, tool })
  useEffect(() => {
    latest.current = { onCamera, onPointer, onClick, onFinish, tool }
  })
  useEffect(() => {
    if (!map || !isLoaded) return
    onReady?.(map)
    const camera = () => {
      const c = map.getCenter().wrap()
      latest.current.onCamera?.({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      })
    }
    const pointer = (e: MapLibreGL.MapMouseEvent) => latest.current.onPointer?.([e.lngLat.wrap().lng, e.lngLat.lat])
    const click = (e: MapLibreGL.MapMouseEvent) => {
      // Touch devices have no hover. A tap must also establish the inspection coordinate.
      pointer(e)
      if (latest.current.tool === 'inspect') return
      const p: Coordinate = [e.lngLat.wrap().lng, e.lngLat.lat]
      latest.current.onClick?.(p)
    }
    const finish = (e: MapLibreGL.MapMouseEvent) => {
      if (['inspect', 'point', 'viewshed'].includes(latest.current.tool)) return
      e.preventDefault()
      latest.current.onFinish?.()
    }
    map.on('moveend', camera)
    map.on('mousemove', pointer)
    map.on('click', click)
    map.on('dblclick', finish)
    return () => {
      onReady?.(null)
      map.off('moveend', camera)
      map.off('mousemove', pointer)
      map.off('click', click)
      map.off('dblclick', finish)
    }
  }, [isLoaded, map, onReady])
  useEffect(() => {
    if (!map) return
    const was = map.doubleClickZoom.isEnabled()
    if (tool !== 'inspect') map.doubleClickZoom.disable()
    map.getCanvas().style.cursor = tool === 'inspect' ? '' : 'crosshair'
    return () => {
      if (was) map.doubleClickZoom.enable()
      map.getCanvas().style.cursor = ''
    }
  }, [map, tool])
  useEffect(() => {
    if (!map || !isLoaded) return
    const id = 'mmgis-terrain'
    if (terrain) {
      if (!map.getSource(id))
        map.addSource(id, {
          type: 'raster-dem',
          tiles: [TERRARIUM_TILE_URL],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 14,
          attribution: TERRAIN_ATTRIBUTION,
        })
      map.setTerrain({ source: id, exaggeration: 1 })
    } else if (map.getTerrain()?.source === id) map.setTerrain(null)
    return () => {
      if (map.getTerrain()?.source === id) map.setTerrain(null)
      if (map.getSource(id)) map.removeSource(id)
    }
  }, [terrain, map, isLoaded])
  return null
}
/** Keep the alternate scene centered on the plan without copying its projection/pitch. */
export function SyncScene({ source }: { source: MapLibreGL.Map | null }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!source || !map || !isLoaded) return
    const sync = () =>
      map.jumpTo({
        center: source.getCenter(),
        zoom: source.getZoom() - 0.5,
        bearing: source.getBearing(),
        pitch: 55,
        roll: 0,
      })
    sync()
    source.on('move', sync)
    return () => {
      source.off('move', sync)
    }
  }, [source, map, isLoaded])
  return null
}

import { memo, useEffect, useMemo, useState } from 'react'
import type { CanvasSource, Map as MapLibreMap } from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { MapCanvasLayer, type MapQuadCoordinates } from '@/components/ui/map-layers'
import type { Geometry } from './engine.js'

/** Where the source starts; `draw` moves it onto the viewport before anything is painted. */
const UNPLACED: MapQuadCoordinates = [
  [-0.01, 0.01],
  [0.01, 0.01],
  [0.01, -0.01],
  [-0.01, -0.01],
]

const firstRouteLayer = (map: MapLibreMap) =>
  map.getStyle().layers.find((layer) => layer.id.startsWith('line-layer-') || layer.id.startsWith('route-layer-'))?.id

/** Cache the faint streets between camera moves, as the original source does. */
export const StreetCanvas = memo(function StreetCanvas({ geometry }: { geometry: Geometry }) {
  const { map, isLoaded } = useMap()
  const [source, setSource] = useState<CanvasSource | null>(null)
  // Each road network gets its own canvas, so the layer is placed afresh for it.
  const surface = useMemo(() => ({ canvas: document.createElement('canvas'), geometry }), [geometry])
  useEffect(() => {
    if (!map || !isLoaded || !source || source.getCanvas() !== surface.canvas) return
    const { geometry } = surface
    const canvas = source.getCanvas()
    const context = canvas.getContext('2d')
    if (!context) return
    let disposed = false
    const draw = () => {
      if (disposed) return
      const { clientWidth: width, clientHeight: height } = map.getContainer()
      if (!width || !height) return
      const ratio = Math.min(devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const zoom = map.getZoom(),
        bounds = map.getBounds()
      const minimumLength = zoom >= 15 ? 0 : zoom >= 14 ? 10 : zoom >= 13 ? 20 : 40
      context.strokeStyle = '#94a3b8'
      context.lineWidth = zoom >= 16 ? 1.6 : zoom >= 14 ? 1.1 : 0.8
      context.lineCap = 'round'
      context.beginPath()
      if (zoom >= 11)
        for (let edge = 0; edge < geometry.nEdges; edge++) {
          const box = edge * 4
          if (
            geometry.bbox[box + 2] < bounds.getWest() ||
            geometry.bbox[box] > bounds.getEast() ||
            geometry.bbox[box + 3] < bounds.getSouth() ||
            geometry.bbox[box + 1] > bounds.getNorth()
          )
            continue
          if (minimumLength && geometry.len[edge] / geometry.DM < minimumLength) continue
          const start = geometry.starts[edge],
            end = geometry.starts[edge + 1]
          for (let index = start; index < end; index += 2) {
            const point = map.project([geometry.coords[index], geometry.coords[index + 1]])
            if (index === start) context.moveTo(point.x, point.y)
            else context.lineTo(point.x, point.y)
          }
        }
      context.stroke()
      const coordinates = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ].map((point) => map.unproject(point as [number, number]).toArray()) as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ]
      source.setCoordinates(coordinates)
      source.play()
      // Upload once. Live route updates then reuse this texture.
      map.once('render', () => {
        if (!disposed) source.pause()
      })
    }
    map.on('moveend', draw)
    map.on('resize', draw)
    draw()
    return () => {
      disposed = true
      map.off('moveend', draw)
      map.off('resize', draw)
    }
  }, [map, isLoaded, source, surface])
  return (
    <MapCanvasLayer
      id="flatten-street-canvas"
      canvas={surface.canvas}
      coordinates={UNPLACED}
      onSource={setSource}
      opacity={0.52}
      beforeId={firstRouteLayer}
    />
  )
})

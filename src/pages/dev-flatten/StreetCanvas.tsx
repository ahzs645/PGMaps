import { memo, useEffect } from 'react'
import type { CanvasSource } from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import type { Geometry } from './engine.js'

/** Cache the faint streets between camera moves, as the original source does. */
export const StreetCanvas = memo(function StreetCanvas({ geometry }: { geometry: Geometry }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return
    const sourceId = 'flatten-street-canvas'
    const layerId = 'flatten-street-canvas-layer'
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
      const zoom = map.getZoom(), bounds = map.getBounds()
      const minimumLength = zoom >= 15 ? 0 : zoom >= 14 ? 10 : zoom >= 13 ? 20 : 40
      context.strokeStyle = '#94a3b8'
      context.lineWidth = zoom >= 16 ? 1.6 : zoom >= 14 ? 1.1 : 0.8
      context.lineCap = 'round'
      context.beginPath()
      if (zoom >= 11) for (let edge = 0; edge < geometry.nEdges; edge++) {
        const box = edge * 4
        if (geometry.bbox[box + 2] < bounds.getWest() || geometry.bbox[box] > bounds.getEast() || geometry.bbox[box + 3] < bounds.getSouth() || geometry.bbox[box + 1] > bounds.getNorth()) continue
        if (minimumLength && geometry.len[edge] / geometry.DM < minimumLength) continue
        const start = geometry.starts[edge], end = geometry.starts[edge + 1]
        for (let index = start; index < end; index += 2) {
          const point = map.project([geometry.coords[index], geometry.coords[index + 1]])
          if (index === start) context.moveTo(point.x, point.y)
          else context.lineTo(point.x, point.y)
        }
      }
      context.stroke()
      const coordinates = [[0, 0], [width, 0], [width, height], [0, height]].map((point) => map.unproject(point as [number, number]).toArray()) as [[number, number], [number, number], [number, number], [number, number]]
      const source = map.getSource(sourceId) as CanvasSource | undefined
      if (source) {
        source.setCoordinates(coordinates)
        source.play()
        // Upload once. Live route updates then reuse this texture.
        map.once('render', () => { if (!disposed) source.pause() })
      } else {
        map.addSource(sourceId, { type: 'canvas', canvas, coordinates, animate: false })
        const before = map.getStyle().layers.find((layer) => layer.id.startsWith('line-layer-') || layer.id.startsWith('route-layer-'))?.id
        map.addLayer({ id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': 0.52, 'raster-fade-duration': 0 } }, before)
      }
    }
    map.on('moveend', draw)
    map.on('resize', draw)
    draw()
    return () => {
      disposed = true
      map.off('moveend', draw)
      map.off('resize', draw)
      // The shared map may already have removed its style before child cleanup.
      if (!map.getStyle()) return
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    }
  }, [map, isLoaded, geometry])
  return null
})

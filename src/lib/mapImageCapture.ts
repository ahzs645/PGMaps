import type { Map as MapLibreMap } from 'maplibre-gl'
import { greatCircleMeters } from '@/components/ui/map-scale'

export type CapturedMapImage = {
  canvas: HTMLCanvasElement
  cssWidth: number
  cssHeight: number
  metersPerCssPixel: number
  bearing: number
  northAngle: number
  pitch: number
  attribution: string
}

/** Copy inside the render event: a WebGL canvas may be cleared before the next animation frame. */
export function captureMapImage(map: MapLibreMap, signal?: AbortSignal, timeoutMs = 15000): Promise<CapturedMapImage> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      map.off('render', render)
      map.off('remove', removed)
      signal?.removeEventListener('abort', aborted)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const aborted = () => fail(new DOMException('Map image preparation cancelled.', 'AbortError'))
    const removed = () => fail(new Error('The map closed before its image could be prepared.'))
    const render = () => {
      if (settled || !map.loaded() || map.isMoving()) return
      try {
        const source = map.getCanvas()
        const cssWidth = source.clientWidth
        const cssHeight = source.clientHeight
        if (!source.width || !source.height || !cssWidth || !cssHeight)
          throw new Error('The map has no visible image. Open the map and try again.')
        const canvas = document.createElement('canvas')
        canvas.width = source.width
        canvas.height = source.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('This browser cannot create a map image.')
        context.drawImage(source, 0, 0)
        // Check origin cleanliness now; never present an unusable blank preview.
        context.getImageData(0, 0, 1, 1)
        const distancePixels = Math.min(100, cssWidth / 2)
        const left = map.unproject([cssWidth / 2 - distancePixels / 2, cssHeight / 2])
        const right = map.unproject([cssWidth / 2 + distancePixels / 2, cssHeight / 2])
        const center = map.getCenter()
        const north = map.project([center.lng, Math.min(89.99, center.lat + 0.001)])
        const origin = map.project(center)
        const result = {
          canvas,
          cssWidth,
          cssHeight,
          metersPerCssPixel: greatCircleMeters(left, right) / distancePixels,
          bearing: map.getBearing(),
          northAngle: Math.atan2(north.x - origin.x, origin.y - north.y),
          pitch: map.getPitch(),
          attribution: Array.from(map.getContainer().querySelectorAll('.maplibregl-ctrl-attrib-inner'))
            .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
            .filter(Boolean)
            .join(' · '),
        }
        settled = true
        cleanup()
        resolve(result)
      } catch (reason) {
        fail(
          reason instanceof DOMException && reason.name === 'SecurityError'
            ? new Error('A map image provider blocks image export. Hide that layer or use another basemap and retry.')
            : reason instanceof Error
              ? reason
              : new Error(String(reason)),
        )
      }
    }
    const timer = setTimeout(
      () => fail(new Error('The map is still loading or moving. Wait for its layers to finish and try again.')),
      timeoutMs,
    )
    map.on('render', render)
    map.on('remove', removed)
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    else map.triggerRepaint()
  })
}

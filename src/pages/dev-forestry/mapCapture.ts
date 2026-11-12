/**
 * The map as a JPEG, for the block note. Browser only.
 *
 * MapLibre clears its drawing buffer after each frame, so the canvas is read in
 * the frame's own `render` event, as the road view's *Image* button does.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

export type CapturedImage = { dataUrl: string; width: number; height: number }

/** Longest side kept, pixels: sharp on a printed page, about 200–400 KB a view. */
const MAX_SIDE = 1600

export function captureMapImage(map: MapLibreMap, maxSide = MAX_SIDE): Promise<CapturedImage> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The map did not draw a frame to capture.')), 10_000)
    map.once('render', () => {
      window.clearTimeout(timer)
      try {
        const source = map.getCanvas()
        const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(source.width * scale)
        canvas.height = Math.round(source.height * scale)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('No 2D canvas for the capture.')
        context.drawImage(source, 0, 0, canvas.width, canvas.height)
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height })
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    map.triggerRepaint()
  })
}

/**
 * A photograph from a URL as a JPEG, for the report's field-photo panel.
 * Null when it cannot be read (no CORS, offline): the page then says the
 * view was saved without its photograph rather than failing the save.
 */
export async function captureImageUrl(url: string, maxSide = MAX_SIDE): Promise<CapturedImage | null> {
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) return null
    const bitmap = await createImageBitmap(await response.blob())
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

/**
 * The plan map framed on `bounds`, then put back where it was. Waits for the
 * tiles to load (or 15 s) so the capture is not half drawn.
 */
export async function capturePlanMap(
  map: MapLibreMap,
  bounds: [number, number, number, number],
): Promise<CapturedImage> {
  const before = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
  map.fitBounds(bounds, { padding: 60, duration: 0, bearing: 0, pitch: 0 })
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 15_000)
    map.once('idle', () => {
      window.clearTimeout(timer)
      resolve()
    })
  })
  try {
    return await captureMapImage(map)
  } finally {
    map.jumpTo(before)
  }
}

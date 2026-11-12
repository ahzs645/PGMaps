/**
 * Renders a raster basemap (e.g. satellite imagery) for a sheet's map frame at print resolution,
 * on a hidden MapLibre map of its own, and reads it back with `captureMapImage`, which copies the
 * WebGL canvas inside the render event. The hidden map shares the sheet's Web Mercator centre and
 * scale, so its image lines up with the vectors the sheet draws over it.
 *
 * Browser only: needs the DOM, WebGL and the network.
 */
import { captureMapImage } from '@/lib/mapImageCapture'
import type { RasterImage } from './drawOps'
import type { FrameProjection } from './scale'
import { zoomForScale } from './scale'

/** Print resolution of a captured basemap, dots per inch. */
export const PRINT_CAPTURE_DPI = 200
/** MapLibre's default largest drawing buffer side; a capture is coarsened to fit it. */
export const MAX_CAPTURE_SIDE_PX = 4096
/** How long the hidden map may take to load its tiles. */
export const PRINT_CAPTURE_TIMEOUT_MS = 30_000

export interface RasterBasemap {
  tiles: string
  tileSize: number
  maxzoom: number
  attribution: string
}

/** CSS size and pixel ratio of a frame capture at `dpi`, kept within `MAX_CAPTURE_SIDE_PX`. */
export function captureSize(frameWidthPt: number, frameHeightPt: number, dpi = PRINT_CAPTURE_DPI) {
  const cssWidth = Math.round((frameWidthPt * 96) / 72),
    cssHeight = Math.round((frameHeightPt * 96) / 72)
  const pixelRatio = Math.min(dpi / 96, MAX_CAPTURE_SIDE_PX / Math.max(cssWidth, cssHeight))
  return { cssWidth, cssHeight, pixelRatio, dpi: pixelRatio * 96 }
}

export async function captureBasemap(
  basemap: RasterBasemap,
  projection: FrameProjection,
  signal?: AbortSignal,
  dpi = PRINT_CAPTURE_DPI,
): Promise<{ image: RasterImage; attribution: string; dpi: number }> {
  const maplibregl = await import('maplibre-gl')
  const size = captureSize(projection.frame.w, projection.frame.h, dpi)
  const container = document.createElement('div')
  // Laid out but off screen: MapLibre needs a real size, and the page must not show it.
  container.style.cssText = `position:fixed;left:-20000px;top:0;width:${size.cssWidth}px;height:${size.cssHeight}px;pointer-events:none;`
  container.setAttribute('aria-hidden', 'true')
  document.body.appendChild(container)
  const [lng, lat] = projection.center
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        basemap: {
          type: 'raster',
          tiles: [basemap.tiles],
          tileSize: basemap.tileSize,
          maxzoom: basemap.maxzoom,
          attribution: basemap.attribution,
        },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
        { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 0 } },
      ],
    },
    center: [lng, lat],
    // MapLibre centres on the frame centre; the frame's own centre latitude sets the zoom.
    zoom: zoomForScale(projection.scale, lat),
    bearing: 0,
    pitch: 0,
    interactive: false,
    attributionControl: false,
    pixelRatio: size.pixelRatio,
    fadeDuration: 0,
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error('The imagery did not finish loading in time. Check the connection and try again.')),
        PRINT_CAPTURE_TIMEOUT_MS,
      )
      const aborted = () => reject(new DOMException('Sheet preparation cancelled.', 'AbortError'))
      signal?.addEventListener('abort', aborted, { once: true })
      map.once('idle', () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        resolve()
      })
      map.once('error', (event) => {
        // A missing tile still lets the map go idle; only a style failure stops the capture.
        if (!map.isStyleLoaded()) {
          clearTimeout(timer)
          reject(event.error instanceof Error ? event.error : Error('The imagery could not be loaded.'))
        }
      })
    })
    const capture = await captureMapImage(map, signal, PRINT_CAPTURE_TIMEOUT_MS)
    const url = capture.canvas.toDataURL('image/jpeg', 0.88)
    const image: RasterImage = {
      kind: 'url',
      url,
      format: 'JPEG',
      width: capture.canvas.width,
      height: capture.canvas.height,
    }
    capture.canvas.width = 0
    capture.canvas.height = 0
    return { image, attribution: basemap.attribution, dpi: size.dpi }
  } finally {
    map.remove()
    container.remove()
  }
}

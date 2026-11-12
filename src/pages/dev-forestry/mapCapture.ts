/**
 * The map as a JPEG, for the block note, and the road view's class pass for VIA figures.
 * Browser only.
 *
 * MapLibre clears its drawing buffer after each frame, so the canvas is read in
 * the frame's own `render` event, as the road view's *Image* button does.
 */
import type { Map as MapLibreMap, SkySpecification } from 'maplibre-gl'
import { CLASS_PASS_BACKGROUND, type ClassPassLayer } from './figureClassPass'

export type CapturedImage = { dataUrl: string; width: number; height: number }

/** Longest side kept, pixels: sharp on a printed page, about 200–400 KB a view. */
const MAX_SIDE = 1600

/** Size a canvas is read back at: the same for the display frame and the class pass. */
const captureSize = (source: { width: number; height: number }, maxSide: number) => {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  return { width: Math.round(source.width * scale), height: Math.round(source.height * scale) }
}

export function captureMapImage(map: MapLibreMap, maxSide = MAX_SIDE): Promise<CapturedImage> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The map did not draw a frame to capture.')), 10_000)
    map.once('render', () => {
      window.clearTimeout(timer)
      try {
        const source = map.getCanvas()
        const canvas = document.createElement('canvas')
        Object.assign(canvas, captureSize(source, maxSide))
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

/** Prefix of the class pass's temporary source and layers. */
const CLASS_PASS_ID = 'vq-class-pass'

/** Waits for the map to settle (tiles loaded) and reads the next frame as straight RGBA, unsmoothed. */
function readFrameRgba(
  map: MapLibreMap,
  maxSide: number,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The class pass did not draw.')), 15_000)
    const read = () => {
      map.once('render', () => {
        window.clearTimeout(timer)
        try {
          const source = map.getCanvas()
          const canvas = document.createElement('canvas')
          Object.assign(canvas, captureSize(source, maxSide))
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) throw new Error('No 2D canvas for the class pass.')
          // Nearest-neighbour: smoothing would invent colours between classes.
          context.imageSmoothingEnabled = false
          context.drawImage(source, 0, 0, canvas.width, canvas.height)
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
          resolve({ data, width: canvas.width, height: canvas.height })
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      map.triggerRepaint()
    }
    map.once('idle', read)
    map.triggerRepaint()
  })
}

/**
 * The class pass of the road view: the same camera with every layer hidden, the sky and fog off,
 * and each figure class painted as one flat, unlit, unblended colour over a flat terrain colour,
 * so the terrain occludes the classes exactly as it occludes the picture. Read back losslessly at
 * the display capture's size. The map is put back as it was, even on failure; it shows the flat
 * colours for the frames the pass takes.
 *
 * This is the one place the page adds MapLibre layers itself: the pass is a capture recipe, not a
 * map look, and nothing it adds outlives the call (docs/forestry-visual-quality.md).
 */
export async function captureClassPass(
  map: MapLibreMap,
  layers: readonly ClassPassLayer[],
  maxSide = MAX_SIDE,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const style = map.getStyle()
  const hidden = (style.layers ?? []).flatMap((layer) =>
    map.getLayoutProperty(layer.id, 'visibility') === 'none' ? [] : [layer.id],
  )
  const sky = map.getSky() as SkySpecification | undefined
  const added: string[] = []
  try {
    for (const id of hidden) map.setLayoutProperty(id, 'visibility', 'none')
    // No sky: the terrain fog would tint distant classes towards its colour.
    map.setSky(undefined as unknown as SkySpecification)
    const background = `${CLASS_PASS_ID}-terrain`
    map.addLayer({ id: background, type: 'background', paint: { 'background-color': CLASS_PASS_BACKGROUND } })
    added.push(background)
    for (const layer of layers) {
      const id = `${CLASS_PASS_ID}-${layer.id}`
      map.addSource(id, { type: 'geojson', data: layer.data })
      map.addLayer({
        id,
        type: 'fill',
        source: id,
        paint: { 'fill-color': layer.color, 'fill-opacity': 1, 'fill-antialias': false },
      })
      added.push(id)
    }
    return await readFrameRgba(map, maxSide)
  } finally {
    for (const id of [...added].reverse()) {
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
    }
    for (const id of hidden) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
    if (sky) map.setSky(sky)
    map.triggerRepaint()
  }
}

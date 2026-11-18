/**
 * The plan turned north-up and flat for a capture, and put back as it was: the field pack's
 * geospatial PDF (`fieldPackPdf.ts`, guide `docs/forestry-road-design/field-review.md`) and a framed
 * Map PDF (`mapPdf.ts`, guide `exports-and-project-files.md`, **Map PDF options**) both capture
 * through it. 3D terrain is taken off, the camera is placed, the plan is drawn and captured with its
 * markers (`mapImage`), and the camera, the terrain and any raised pixel ratio are restored in
 * `finally`, whatever happens. A capture in this state is a Web Mercator picture, so its corners,
 * read from the map while it is framed, register it exactly. Browser only.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { mapImage } from './pdf'

/** How long the map may take to draw the framed view. */
const FRAME_IDLE_TIMEOUT_MS = 10_000

export type Corners = [[number, number], [number, number], [number, number], [number, number]]

/** Resolves when the framed view has drawn (or after the timeout); rejects at once when cancelled. */
function idle(map: MapLibreMap, signal: AbortSignal | undefined, cancelledMessage: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      map.off('idle', done)
      signal?.removeEventListener('abort', cancelled)
      resolve()
    }
    const cancelled = () => {
      clearTimeout(timer)
      map.off('idle', done)
      reject(new DOMException(cancelledMessage, 'AbortError'))
    }
    // Both handlers read `timer` only once called, after it is set here.
    const timer = setTimeout(done, FRAME_IDLE_TIMEOUT_MS)
    if (signal?.aborted) return cancelled()
    map.once('idle', done)
    signal?.addEventListener('abort', cancelled, { once: true })
    map.triggerRepaint()
  })
}

/** Where the plan stands for the capture: round a box with padding, or at a centre and zoom. */
export type NorthUpPlacement =
  | { bounds: [[number, number], [number, number]]; paddingPx: number }
  | { center: [number, number]; zoom: number }

export interface NorthUpCapture {
  /** The whole plan with its markers, a PNG data URL. */
  image: string
  width: number
  height: number
  /** Image pixels per CSS pixel of the plan. */
  pixelsPerCss: number
  /** Longitude, latitude of the plan's corners: top-left, top-right, bottom-right, bottom-left. */
  corners: Corners
  /** The plan's own pixel ratio while it was drawn (raised for the capture, or as it was). */
  pixelRatio: number
}

export interface NorthUpOptions {
  signal?: AbortSignal
  /**
   * Draw the plan at this pixel ratio for the capture when it is above the plan's own, and compose
   * at it. MapLibre lowers it to keep the canvas within `maxCanvasSize`. HTML markers are placed in
   * CSS pixels, so they do not move.
   */
  pixelRatio?: number
  /** Said when the plan is on the globe, which is not a Web Mercator picture. */
  globeMessage: string
  cancelledMessage: string
}

/**
 * Turns the plan north-up and flat at `placement`, captures it, hands the capture to `read` while the
 * plan still stands there (so `read` may call `map.project`), and puts the plan back.
 */
export async function withNorthUpPlan<T>(
  map: MapLibreMap,
  placement: NorthUpPlacement,
  options: NorthUpOptions,
  read: (capture: NorthUpCapture) => Promise<T>,
): Promise<T> {
  const projection = (map as unknown as { getProjection?: () => { type?: string } | undefined }).getProjection?.()
  if (projection?.type && projection.type !== 'mercator') throw Error(options.globeMessage)
  const camera = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
  const terrain = map.getTerrain()
  // `undefined` or null follows the screen's own ratio; restored exactly as found.
  const override = map._overridePixelRatio
  const raise = options.pixelRatio !== undefined && options.pixelRatio > map.getPixelRatio()
  try {
    if (terrain) map.setTerrain(null)
    if (raise) map.setPixelRatio(options.pixelRatio!)
    map.jumpTo({ bearing: 0, pitch: 0, roll: 0 })
    if ('bounds' in placement)
      map.fitBounds(placement.bounds, { padding: placement.paddingPx, animate: false, bearing: 0, pitch: 0 })
    else map.jumpTo({ center: placement.center, zoom: placement.zoom, bearing: 0, pitch: 0, roll: 0 })
    await idle(map, options.signal, options.cancelledMessage)
    const canvas = map.getCanvas()
    const pixelRatio = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : map.getPixelRatio()
    // The field pack composes at twice CSS size, as it always did; a raised capture at its own ratio.
    const capture = await mapImage(
      map,
      options.signal,
      options.pixelRatio === undefined ? undefined : { scale: Math.max(2, pixelRatio) },
    )
    const container = map.getContainer()
    const { clientWidth: w, clientHeight: h } = container
    const corner = (x: number, y: number) => {
      const p = map.unproject([x, y])
      return [p.lng, p.lat] as [number, number]
    }
    const corners: Corners = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)]
    const shownWidth = Math.ceil(container.getBoundingClientRect().width) || w || 1
    return await read({ ...capture, pixelsPerCss: capture.width / shownWidth, corners, pixelRatio })
  } finally {
    if (raise) map.setPixelRatio(override as number)
    if (terrain) map.setTerrain(terrain)
    map.jumpTo({ ...camera, roll: 0 })
  }
}

/**
 * The part of a capture inside `crop` (CSS pixels of the plan), as a PNG data URL, with the
 * longitude and latitude of its corners read from the plan as it stands. Call it inside `read`.
 */
export async function cropCapture(
  map: MapLibreMap,
  capture: NorthUpCapture,
  crop: { x: number; y: number; w: number; h: number },
): Promise<{ image: string; width: number; height: number; corners: Corners }> {
  const s = capture.pixelsPerCss
  // Whole image pixels, and corners read at exactly those pixels, so the registration is exact.
  const x0 = Math.max(0, Math.round(crop.x * s)),
    y0 = Math.max(0, Math.round(crop.y * s))
  const x1 = Math.min(capture.width, Math.round((crop.x + crop.w) * s)),
    y1 = Math.min(capture.height, Math.round((crop.y + crop.h) * s))
  const width = x1 - x0,
    height = y1 - y0
  if (width < 1 || height < 1) throw Error('The plan is too small to frame the map. Make the plan panel larger.')
  const picture = new Image()
  picture.src = capture.image
  await picture.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw Error('This browser cannot create a map image.')
  context.drawImage(picture, x0, y0, width, height, 0, 0, width, height)
  const corner = (x: number, y: number) => {
    const p = map.unproject([x / s, y / s])
    return [p.lng, p.lat] as [number, number]
  }
  try {
    return {
      image: canvas.toDataURL('image/png'),
      width,
      height,
      corners: [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)],
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

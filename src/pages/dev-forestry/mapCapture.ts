/**
 * The map as a JPEG, for the block note, and the road view's class pass for VIA figures.
 * Browser only.
 *
 * MapLibre clears its drawing buffer after each frame, so the canvas is read in
 * the frame's own `render` event, as the road view's *Image* button does.
 */
import type { Map as MapLibreMap, SkySpecification } from 'maplibre-gl'
import { horizonSafePitch } from './driveMath'
import { CLASS_PASS_BACKGROUND, type ClassPassLayer } from './figureClassPass'
import { canvasWindow, type FramingPlan } from './figureFraming'

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

/**
 * A centred window of the canvas, as shares of its width and height, drawn at `width` × `height`
 * pixels: one frame of a framed capture.
 */
export type CaptureRegion = { crop: { width: number; height: number }; width: number; height: number }

/** Draws the canvas (or the region of it) into a new 2D canvas. Call inside a `render` event. */
function drawCanvas(map: MapLibreMap, target: number | CaptureRegion, smooth: boolean) {
  const source = map.getCanvas()
  const canvas = document.createElement('canvas')
  const region =
    typeof target === 'number'
      ? { sx: 0, sy: 0, sw: source.width, sh: source.height, ...captureSize(source, target) }
      : {
          sw: source.width * target.crop.width,
          sh: source.height * target.crop.height,
          sx: (source.width * (1 - target.crop.width)) / 2,
          sy: (source.height * (1 - target.crop.height)) / 2,
          width: target.width,
          height: target.height,
        }
  canvas.width = region.width
  canvas.height = region.height
  const context = canvas.getContext('2d', { willReadFrequently: !smooth })
  if (!context) throw new Error('No 2D canvas for the capture.')
  // Nearest-neighbour for the class pass: smoothing would invent colours between classes.
  context.imageSmoothingEnabled = smooth
  context.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, canvas.width, canvas.height)
  return { canvas, context }
}

/** Waits for the map to settle (tiles loaded), then reads the next frame. */
function readSettledFrame<T>(map: MapLibreMap, read: () => T, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${what} did not draw.`)), 15_000)
    map.once('idle', () => {
      map.once('render', () => {
        window.clearTimeout(timer)
        try {
          resolve(read())
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      map.triggerRepaint()
    })
    map.triggerRepaint()
  })
}

/** Reads the settled frame as straight RGBA, unsmoothed. */
function readFrameRgba(
  map: MapLibreMap,
  target: number | CaptureRegion,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  return readSettledFrame(
    map,
    () => {
      const { canvas, context } = drawCanvas(map, target, false)
      return {
        data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        width: canvas.width,
        height: canvas.height,
      }
    },
    'The class pass',
  )
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
  target: number | CaptureRegion = MAX_SIDE,
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
    return await readFrameRgba(map, target)
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

/** Widest a framed capture is drawn, pixels, all frames together. */
const FRAMED_WIDTH = 2400

export type FramedCapture = {
  image: CapturedImage
  /** The class pass of the same frames, joined the same way; null when it failed. */
  classes: { data: Uint8ClampedArray; width: number; height: number } | null
  /** Width of each frame in the joined images, pixels. */
  frameWidth: number
}

/**
 * The road view framed for an analysis sheet: for each of the plan's frames the eye map looks along
 * the frame's bearing and pitch from `eye` (pitch through `horizonSafePitch`, roll 0, so the
 * camera's matrices stay valid), at the frame's field, and the display and the class pass are read
 * from the centred window of the canvas that frame takes in. Frames are joined side by side. The
 * camera and field of view are put back as they were, even on failure.
 */
export async function captureFramed(
  map: MapLibreMap,
  plan: FramingPlan,
  eye: { lng: number; lat: number; elevation: number },
  layers: readonly ClassPassLayer[] | null,
): Promise<FramedCapture> {
  const centre = map.getCenter()
  const before = {
    center: [centre.lng, centre.lat] as [number, number],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    roll: map.getRoll?.() ?? 0,
    ...(Number.isFinite(map.getCenterElevation?.()) ? { elevation: map.getCenterElevation() } : {}),
  }
  const fov = map.getVerticalFieldOfView()
  const source = map.getCanvas()
  const aspect = source.clientWidth / Math.max(1, source.clientHeight)
  const first = plan.frames[0]
  const frameWidth = Math.floor(FRAMED_WIDTH / plan.frames.length)
  const height = Math.round(
    frameWidth * (Math.tan((first.vfovDeg * Math.PI) / 360) / Math.tan((first.hfovDeg * Math.PI) / 360)),
  )
  const joined = document.createElement('canvas')
  joined.width = frameWidth * plan.frames.length
  joined.height = height
  const joinedContext = joined.getContext('2d')
  if (!joinedContext) throw new Error('No 2D canvas for the capture.')
  let classes: FramedCapture['classes'] = layers
    ? { data: new Uint8ClampedArray(joined.width * height * 4), width: joined.width, height }
    : null
  try {
    for (let i = 0; i < plan.frames.length; i++) {
      const frame = plan.frames[i]
      const window_ = canvasWindow(frame, aspect)
      map.setVerticalFieldOfView(window_.verticalFovDeg)
      // As the drive controller does: a target 40 m ahead keeps the near clip plane close.
      const pitch = horizonSafePitch(90 + frame.pitchDeg) - 90
      const metres = 40,
        radians = (frame.bearingDeg * Math.PI) / 180
      const target = {
        lng: eye.lng + (Math.sin(radians) * metres) / (111320 * Math.cos((eye.lat * Math.PI) / 180)),
        lat: eye.lat + (Math.cos(radians) * metres) / 111320,
      }
      const camera = map.calculateCameraOptionsFromTo(
        eye as never,
        eye.elevation,
        target as never,
        eye.elevation + Math.tan((pitch * Math.PI) / 180) * metres,
      )
      map.jumpTo({ ...camera, roll: 0 })
      const region: CaptureRegion = { crop: window_.crop, width: frameWidth, height }
      const display = await readSettledFrame(map, () => drawCanvas(map, region, true).canvas, 'The framed view')
      joinedContext.drawImage(display, i * frameWidth, 0)
      if (classes && layers) {
        try {
          const pass = await captureClassPass(map, layers, region)
          for (let row = 0; row < height; row++)
            classes.data.set(
              pass.data.subarray(row * frameWidth * 4, (row + 1) * frameWidth * 4),
              (row * joined.width + i * frameWidth) * 4,
            )
        } catch {
          classes = null
        }
      }
    }
    return {
      image: { dataUrl: joined.toDataURL('image/jpeg', 0.88), width: joined.width, height },
      classes,
      frameWidth,
    }
  } finally {
    map.setVerticalFieldOfView(fov)
    map.jumpTo(before)
    map.triggerRepaint()
  }
}

/** Rows `y` to `y + height` of a captured image, as a new JPEG of the same width. Never stretched. */
export async function cropImageRows(image: CapturedImage, crop: { y: number; height: number }): Promise<CapturedImage> {
  const element = new Image()
  element.src = image.dataUrl
  await element.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = crop.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas to crop the capture.')
  context.drawImage(element, 0, crop.y, image.width, crop.height, 0, 0, image.width, crop.height)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), width: image.width, height: crop.height }
}

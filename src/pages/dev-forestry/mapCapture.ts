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

/**
 * The `sourceKey` of the road view's guides: what is drawn there to help the reviewer look (the inventory arrows of
 * the viewpoint stood at), and is no part of the view. A layer on it is hidden for every picture read here.
 */
export const ROAD_VIEW_GUIDE_SOURCE = 'road-view-guides'

/**
 * Hides the road view's guide layers for a picture; the function returned puts them back. Exported for the road view
 * video (`useRoadVideo.ts`), which is a picture too and hides them for its whole take.
 */
export function hideRoadViewGuides(map: MapLibreMap): () => void {
  const source = `fill-shared-${ROAD_VIEW_GUIDE_SOURCE}`
  const ids = map.getLayersOrder?.() ?? (map.getStyle().layers ?? []).map((layer) => layer.id)
  const hidden = ids.filter(
    (id) => map.getLayer(id)?.source === source && map.getLayoutProperty(id, 'visibility') !== 'none',
  )
  for (const id of hidden) map.setLayoutProperty(id, 'visibility', 'none')
  return () => {
    for (const id of hidden) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
    if (hidden.length) map.triggerRepaint()
  }
}

export function captureMapImage(map: MapLibreMap, maxSide = MAX_SIDE): Promise<CapturedImage> {
  return new Promise((resolve, reject) => {
    const showGuides = hideRoadViewGuides(map)
    const timer = window.setTimeout(() => {
      showGuides()
      reject(new Error('The map did not draw a frame to capture.'))
    }, 10_000)
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
      } finally {
        showGuides()
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

/** A camera to capture from: north-up and flat for the plan map, oblique for the road view's. */
export type CaptureCamera = {
  center: [number, number]
  zoom: number
  bearing?: number
  pitch?: number
  /** Height of the centre above sea level, for a map with 3D terrain whose centre is not clamped to the ground. */
  elevation?: number
}

/** Largest canvas side a capture asks MapLibre for (its default `maxCanvasSize`). */
const MAX_CANVAS_SIDE = 4096

/**
 * The map at `camera`, read back from the centred `window` of its canvas (CSS pixels) at up to `maxSide` pixels a
 * side, then put back exactly as it was: camera (roll and centre elevation included), padding and pixel ratio, even
 * on failure. For the VIA report's maps and renders; the map shows the capture's camera for the frames it takes.
 */
export async function captureAtCamera(
  map: MapLibreMap,
  camera: CaptureCamera,
  window_: { width: number; height: number },
  maxSide = MAX_SIDE,
  /** Read the map while it still stands at the camera with its frame drawn (the end map reads its basemap here). */
  onCamera?: (map: MapLibreMap) => void,
): Promise<CapturedImage & { pixelRatio: number }> {
  const centre = map.getCenter()
  const elevation = map.getCenterElevation?.()
  const before = {
    center: [centre.lng, centre.lat] as [number, number],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    roll: map.getRoll?.() ?? 0,
    padding: map.getPadding(),
    ...(Number.isFinite(elevation) ? { elevation } : {}),
  }
  const source = map.getCanvas()
  const override = (map as unknown as { _overridePixelRatio?: number | null })._overridePixelRatio ?? null
  const ratioBefore = map.getPixelRatio()
  const largest = Math.max(1, source.clientWidth, source.clientHeight)
  const ratio = Math.max(
    ratioBefore,
    Math.min(
      MAX_CAPTURE_PIXEL_RATIO + 1,
      maxSide / Math.max(1, window_.width, window_.height),
      MAX_CANVAS_SIDE / largest,
    ),
  )
  const showGuides = hideRoadViewGuides(map)
  try {
    if (ratio > ratioBefore) map.setPixelRatio(ratio)
    const wanted = {
      center: camera.center,
      zoom: camera.zoom,
      bearing: camera.bearing ?? 0,
      // Through `horizonSafePitch`: exactly 90° crashes the GPU process with 3D terrain on.
      pitch: camera.pitch ? horizonSafePitch(camera.pitch) : 0,
      // Always given: an omitted roll leaves the camera's matrices null (docs/forestry-visual-quality.md).
      roll: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      ...(camera.elevation !== undefined ? { elevation: camera.elevation } : {}),
    }
    // The frame read must be drawn from this camera: the road view's drive camera places itself again when its pose
    // changes (terrain loading under a new view can do that), so a frame from any other camera is read again.
    const atCamera = () => {
      const at = map.getCenter()
      return (
        Math.abs(map.getZoom() - wanted.zoom) < 0.01 &&
        Math.abs(map.getPitch() - wanted.pitch) < 0.5 &&
        Math.abs(((map.getBearing() - wanted.bearing + 540) % 360) - 180) < 0.5 &&
        Math.abs(at.lng - wanted.center[0]) < 1e-6 &&
        Math.abs(at.lat - wanted.center[1]) < 1e-6
      )
    }
    const crop = {
      width: Math.min(1, window_.width / Math.max(1, source.clientWidth)),
      height: Math.min(1, window_.height / Math.max(1, source.clientHeight)),
    }
    const drawn = { width: source.width * crop.width, height: source.height * crop.height }
    const scale = Math.min(1, maxSide / Math.max(drawn.width, drawn.height))
    const region: CaptureRegion = {
      crop,
      width: Math.round(drawn.width * scale),
      height: Math.round(drawn.height * scale),
    }
    let canvas: HTMLCanvasElement | null = null
    for (let attempt = 0; attempt < 3 && !canvas; attempt++) {
      map.jumpTo(wanted)
      canvas = await readSettledFrame(
        map,
        () => (atCamera() ? drawCanvas(map, region, true).canvas : null),
        'The map',
        40_000,
      )
    }
    if (!canvas) throw new Error('The map kept moving off the capture’s camera.')
    onCamera?.(map)
    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.88),
      width: canvas.width,
      height: canvas.height,
      pixelRatio: Math.round((source.width / Math.max(1, source.clientWidth)) * 100) / 100,
    }
  } finally {
    showGuides()
    if (ratio > ratioBefore) map.setPixelRatio(override as number)
    map.jumpTo(before)
    map.triggerRepaint()
  }
}

/**
 * Sheet operations drawn as a JPEG: their SVG (`sheetSvg`, with every image already a data URL) on a canvas at
 * `scale` pixels a unit. A JPEG, not the sheets' PNG: an imagery map is several megabytes as a PNG.
 */
export async function rasterizeSheet(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<CapturedImage> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The map figure could not be drawn as an image.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas for the map figure.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
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

/**
 * How long a capture waits for the map to settle before reading a frame. A framed view at a new bearing loads
 * terrain and imagery tiles first; under load (a capture of several views, other tabs) that took over 15 s, which
 * failed about half the framed views of a batch with "did not draw".
 */
export const SETTLE_TIMEOUT_MS = 45_000

/**
 * Waits for the map to settle (tiles loaded), then reads the next frame. On a timeout its listeners are taken off, so
 * a frame that settles late is not read for nothing.
 */
function readSettledFrame<T>(map: MapLibreMap, read: () => T, what: string, timeoutMs = SETTLE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false
    const onRender = () => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      try {
        resolve(read())
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onIdle = () => {
      if (finished) return
      map.once('render', onRender)
      map.triggerRepaint()
    }
    const timer = window.setTimeout(() => {
      if (finished) return
      finished = true
      map.off('idle', onIdle)
      map.off('render', onRender)
      reject(
        new Error(
          `${what} did not finish drawing within ${Math.round(timeoutMs / 1000)} s (its tiles were still loading).`,
        ),
      )
    }, timeoutMs)
    map.once('idle', onIdle)
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
  // Every layer, custom layers too: `getStyle().layers` leaves out the 3D trees (a custom layer), which then stayed
  // in the pass and the outlines traced the trees' silhouettes instead of the ground. The pass is the ground under
  // the trees, as the reference VIAs draw their outlines and as an engine's ground pass is.
  const ids = map.getLayersOrder?.() ?? (style.layers ?? []).map((layer) => layer.id)
  const hidden = ids.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none')
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

/** A terrain tile the map draws: its tile and the zoom it is drawn at (`OverscaledTileID`'s fields). */
export type DrawnTerrainTile = { z: number; x: number; y: number; overscaledZ: number }

/**
 * The DEM zoom the map draws the ground from at `lng, lat`: the drawn terrain tile there, less the terrain's
 * `deltaZoom`, within the DEM source's zoom range, as MapLibre's terrain tile manager picks the DEM tile behind each
 * terrain tile (`_getSourceZoom`). Null where no drawn tile covers the point. Pure, for the unit tests.
 */
export function demZoomAt(
  tiles: readonly DrawnTerrainTile[],
  lng: number,
  lat: number,
  terrain: { deltaZoom: number; minzoom: number; maxzoom: number },
): number | null {
  const x = (lng + 180) / 360
  const sin = Math.sin((lat * Math.PI) / 180)
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  let best: DrawnTerrainTile | null = null
  for (const tile of tiles) {
    const n = 2 ** tile.z
    if (Math.floor(x * n) === tile.x && Math.floor(y * n) === tile.y && (!best || tile.z > best.z)) best = tile
  }
  if (!best) return null
  const z = Math.max(terrain.minzoom, Math.min(best.overscaledZ - terrain.deltaZoom, terrain.maxzoom))
  return z <= best.overscaledZ ? z : null
}

/**
 * The DEM zoom the map draws the ground from at each point, as it stands: MapLibre picks the terrain's detail by
 * distance and pitch, so from eye level ground a few kilometres out is drawn from far coarser cells than the run's
 * sightlines walk. Null for a point no drawn tile covers, and for every point when the map has no terrain.
 */
export function drawnDemZooms(
  map: MapLibreMap,
  points: ReadonlyArray<readonly [number, number]>,
): Array<number | null> {
  const manager = map.terrain?.tileManager
  if (!manager || !points.length) return points.map(() => null)
  const source = manager.getSource()
  const tiles = manager.getRenderableTiles().flatMap((tile) =>
    tile?.tileID
      ? [
          {
            z: tile.tileID.canonical.z,
            x: tile.tileID.canonical.x,
            y: tile.tileID.canonical.y,
            overscaledZ: tile.tileID.overscaledZ,
          },
        ]
      : [],
  )
  const terrain = { deltaZoom: manager.deltaZoom, minzoom: source.minzoom ?? 0, maxzoom: source.maxzoom ?? 22 }
  return points.map(([lng, lat]) => demZoomAt(tiles, lng, lat, terrain))
}

/** The middle value of the known zooms, rounded down; null when there is none. */
const medianZoom = (zooms: ReadonlyArray<number | null>): number | null => {
  const known = zooms.filter((z): z is number => z !== null).sort((a, b) => a - b)
  return known.length ? known[Math.floor((known.length - 1) / 2)] : null
}

/** Widest a framed capture is drawn, pixels, all frames together. */
export const FRAMED_WIDTH = 2400

export type FramedCapture = {
  image: CapturedImage
  /** The class pass of the same frames, joined the same way; null when it failed. */
  classes: { data: Uint8ClampedArray; width: number; height: number } | null
  /** The zone pass (VQO polygons) of the same frames, when zone layers were given and it was taken. */
  zones: { data: Uint8ClampedArray; width: number; height: number } | null
  /**
   * One class pass of the same frames per entry of `landformPasses` (the class layers split at another landform the
   * scene holds), in that order; an entry is null when its pass failed. Empty when none were asked for.
   */
  landforms: Array<{ data: Uint8ClampedArray; width: number; height: number } | null>
  /** Width of each frame in the joined images, pixels. */
  frameWidth: number
  /** The pixel ratio the frames were drawn at (`capturePixelRatio`), and the capture's wall time, ms. */
  pixelRatio: number
  millis: number
  /**
   * The DEM zoom the frames drew the ground from at the `probe` points (the middle of their readings across the
   * frames that show them, `drawnDemZooms`); null without probe points, terrain or a drawn tile under any of them.
   */
  drawnDemZoom: number | null
}

/** Highest pixel ratio a framed capture draws the road view at. */
export const MAX_CAPTURE_PIXEL_RATIO = 4

/**
 * Least vertical field a framed capture draws the map at, the frame's own window cropped from the middle. MapLibre
 * picks each terrain tile's zoom by how steeply the camera looks down on it, measured against the height between the
 * camera and its centre point. An eye-level frame has that height near zero, so every distant tile reads as seen
 * edge-on, and the narrower the field the harder it is cut: at The Shores (VP4, 30° frames looking 0.15° down) the
 * blocks 5.5 km away stood on one z6 terrain tile, whose mesh sagged behind a ridge 3.5 km out, so neither the
 * picture nor the class pass showed them (0 px against a 1.82% sightline figure). Drawn through 75° the same tile is
 * z8 and the blocks show (about 1,450 px). The terrain's tile manager takes no level-of-detail setting
 * (`setSourceTileLodParams` does not reach it), so the field is the one lever. The frame's pixels are the same
 * pinhole view either way.
 */
export const CAPTURE_MIN_VERTICAL_FOV_DEG = 75

/**
 * The pixel ratio that gives each frame's window of the canvas `frameWidth` drawn pixels, so the sheet takes the
 * frame's own pixels rather than an upscaled crop (a 515 px canvas blown up 2.33× put a pixel at 12.6 m at 9 km).
 * Never below the map's own ratio, never above `MAX_CAPTURE_PIXEL_RATIO`; MapLibre then clamps it to its
 * `maxCanvasSize` (4096 px a side by default).
 */
export function capturePixelRatio(input: {
  frameWidth: number
  clientWidth: number
  /** The narrowest frame window's share of the canvas width (`canvasWindow(…).crop.width`). */
  cropWidth: number
  current: number
}): number {
  const window_ = Math.max(1, input.clientWidth * Math.max(0.05, input.cropWidth))
  const wanted = input.frameWidth / window_
  return Math.max(input.current, Math.min(MAX_CAPTURE_PIXEL_RATIO, Math.ceil(wanted * 4) / 4))
}

/**
 * The road view framed for an analysis sheet: for each of the plan's frames the eye map looks along
 * the frame's bearing and pitch from `eye` (pitch through `horizonSafePitch`, roll 0, so the
 * camera's matrices stay valid), through at least `CAPTURE_MIN_VERTICAL_FOV_DEG` of field, and the
 * display and the class pass are read from the centred window of the canvas that frame takes in.
 * Frames are joined side by side. The camera and field of view are put back as they were, even on
 * failure. `probe` points (the blocks' ground the run sees) are read for the DEM detail each frame draws there.
 * `landformPasses` are further class passes at each frame's camera, one per other landform the sheet calculates.
 */
export async function captureFramed(
  map: MapLibreMap,
  plan: FramingPlan,
  eye: { lng: number; lat: number; elevation: number },
  layers: readonly ClassPassLayer[] | null,
  zoneLayers: readonly ClassPassLayer[] | null = null,
  probe: ReadonlyArray<readonly [number, number]> = [],
  landformPasses: ReadonlyArray<readonly ClassPassLayer[]> = [],
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
  const started = performance.now()
  // Draw at the pixel ratio the frame width needs, put back in `finally`. A null override (`devicePixelRatio`
  // followed) is restored as null, so the map keeps following the display it is on.
  const override = (map as unknown as { _overridePixelRatio?: number | null })._overridePixelRatio ?? null
  const ratioBefore = map.getPixelRatio()
  const ratio = capturePixelRatio({
    frameWidth,
    clientWidth: source.clientWidth,
    cropWidth: Math.min(
      ...plan.frames.map((frame) => canvasWindow(frame, aspect, CAPTURE_MIN_VERTICAL_FOV_DEG).crop.width),
    ),
    current: ratioBefore,
  })
  const joined = document.createElement('canvas')
  joined.width = frameWidth * plan.frames.length
  joined.height = height
  const joinedContext = joined.getContext('2d')
  if (!joinedContext) throw new Error('No 2D canvas for the capture.')
  let zones: FramedCapture['zones'] = zoneLayers?.length
    ? { data: new Uint8ClampedArray(joined.width * height * 4), width: joined.width, height }
    : null
  let classes: FramedCapture['classes'] = layers
    ? { data: new Uint8ClampedArray(joined.width * height * 4), width: joined.width, height }
    : null
  const landforms: FramedCapture['landforms'] = landformPasses.map(() => ({
    data: new Uint8ClampedArray(joined.width * height * 4),
    width: joined.width,
    height,
  }))
  const drawnZooms: Array<number | null> = []
  const showGuides = hideRoadViewGuides(map)
  try {
    if (ratio > ratioBefore) map.setPixelRatio(ratio)
    for (let i = 0; i < plan.frames.length; i++) {
      const frame = plan.frames[i]
      const window_ = canvasWindow(frame, aspect, CAPTURE_MIN_VERTICAL_FOV_DEG)
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
      // Read at the frame's camera, before the class pass: the detail the ground at the probe points is drawn from.
      try {
        drawnZooms.push(...drawnDemZooms(map, probe))
      } catch {
        // A MapLibre without these terrain internals: the detail stays unknown.
      }
      const join = (target: { data: Uint8ClampedArray }, pass: { data: Uint8ClampedArray }) => {
        for (let row = 0; row < height; row++)
          target.data.set(
            pass.data.subarray(row * frameWidth * 4, (row + 1) * frameWidth * 4),
            (row * joined.width + i * frameWidth) * 4,
          )
      }
      if (classes && layers) {
        try {
          join(classes, await captureClassPass(map, layers, region))
        } catch {
          classes = null
        }
      }
      if (zones && zoneLayers?.length) {
        try {
          join(zones, await captureClassPass(map, zoneLayers, region))
        } catch {
          zones = null
        }
      }
      for (let k = 0; k < landformPasses.length; k++) {
        const target = landforms[k]
        if (!target) continue
        try {
          join(target, await captureClassPass(map, landformPasses[k], region))
        } catch {
          landforms[k] = null
        }
      }
    }
    return {
      image: { dataUrl: joined.toDataURL('image/jpeg', 0.88), width: joined.width, height },
      classes,
      zones,
      landforms,
      frameWidth,
      // As drawn: MapLibre may have clamped the ratio asked for to its largest canvas.
      pixelRatio: Math.round((source.width / Math.max(1, source.clientWidth)) * 100) / 100,
      millis: Math.round(performance.now() - started),
      drawnDemZoom: medianZoom(drawnZooms),
    }
  } finally {
    showGuides()
    if (ratio > ratioBefore) map.setPixelRatio(override as number)
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

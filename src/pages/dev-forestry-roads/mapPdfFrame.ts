/**
 * What the Map PDF frames, on what paper and at what scale (guide
 * docs/forestry-road-design/exports-and-project-files.md, **Map PDF options**). The default is the
 * plan as it is shown on A4, as it always was. Any other frame (the road on screen, every road, a
 * block, or the view at a typed scale) is a north-up, flat capture at a stated scale: this module
 * works out the frame's ground, the fitted scale, the plan's camera for the capture, the part of the
 * capture that goes on the page and the resolution it prints at. `planCapture.ts` moves the plan and
 * `pdf.ts` draws the page. The scale maths are the block sheets' (`src/lib/mapSheet/scale.ts`): true
 * at the frame's centre latitude. No DOM or network access.
 */
import { PAPER_SIZES, type Orientation, type PaperId } from '@/lib/mapSheet/layout'
import {
  FIT_SCALES,
  formatScale,
  frameProjection,
  inverseMercator,
  MAX_SHEET_SCALE,
  mercatorX,
  mercatorY,
  SHEET_SCALES,
  zoomForScale,
  type FrameProjection,
} from '@/lib/mapSheet/scale'

export type MapPdfFrame = 'view' | 'road' | 'roads' | 'block'
export type MapPdfOrientation = 'auto' | Orientation
type Position = readonly [number, number]
/** West, south, east, north. */
export type MapPdfBox = [number, number, number, number]

export interface MapPdfSettings {
  paper: PaperId
  /** `auto` follows the shape of what is printed, as the Map PDF always did. */
  orientation: MapPdfOrientation
  frame: MapPdfFrame
  /** The block framed, as the block sheet names it (`context:<id>`, `reference:<id>`); empty is the first. */
  block: string
  /** `fit`: as shown, the plan's own zoom; framed, the finest listed scale that holds the frame and its margin. */
  scale: 'fit' | number
  /** Clear space kept round what is framed when the scale is fitted, percent of the map's side, each side. */
  marginPercent: number
}

export const DEFAULT_MAP_PDF: MapPdfSettings = {
  paper: 'a4',
  orientation: 'auto',
  frame: 'view',
  block: '',
  scale: 'fit',
  marginPercent: 10,
}

export const MAP_PDF_FRAMES: readonly { value: MapPdfFrame; label: string }[] = [
  { value: 'view', label: 'The plan as shown' },
  { value: 'road', label: 'The road on screen' },
  { value: 'roads', label: 'Every road' },
  { value: 'block', label: 'A block' },
]
export const MAP_PDF_ORIENTATIONS: readonly { value: MapPdfOrientation; label: string }[] = [
  { value: 'auto', label: 'Follow the map’s shape' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
]
/** The scales offered by name: the block sheets' (`SHEET_SCALES`). Any other is typed. */
export const MAP_PDF_SCALE_PRESETS: readonly number[] = SHEET_SCALES
/** Finest scale that can be typed. Finer, a road plan's markers and labels cover the ground they mark. */
export const MIN_MAP_PDF_SCALE = 500
/** Margins offered round a fitted frame, percent of the map's side. */
export const MAP_PDF_MARGINS: readonly number[] = [0, 5, 10, 20]
/** Largest margin read back from storage, percent: two of them leave a fifth of the map. */
const MAX_MAP_PDF_MARGIN = 40

/** Space left and right of the map, and above the title, mm (as the Map PDF always printed). */
export const MAP_PDF_SIDE_MM = 12
/** Space under the map as shown, mm: the attribution and the footer line. */
export const MAP_PDF_AS_SHOWN_FOOT_MM = 22
/** Space under a framed map, mm: the scale line and bar, the attribution and the footer line. */
export const MAP_PDF_FRAMED_FOOT_MM = 30
/**
 * Top of the map under a one-line title and one line of terrain and datum, mm: the sketch's
 * stand-in when the header was not measured (`mapPdfHeaderTop`).
 */
export const MAP_PDF_SKETCH_TOP_MM = 34
export const MM_PER_PT = 25.4 / 72
const CSS_PX_PER_MM = 96 / 25.4

/** Resolution a framed capture aims for on paper, dots per inch, by raising the plan's pixel ratio. */
export const MAP_PDF_TARGET_DPI = 200
/**
 * Highest pixel ratio the plan is raised to for a framed capture. MapLibre lowers it further to keep
 * the canvas within `maxCanvasSize` (4,096 px a side).
 */
export const MAP_PDF_MAX_PIXEL_RATIO = 3

export const isAsShown = (settings: Pick<MapPdfSettings, 'frame' | 'scale'>) =>
  settings.frame === 'view' && settings.scale === 'fit'

/** Validates settings read back from browser storage; anything unknown takes the default. */
export function parseMapPdfSettings(raw: unknown): MapPdfSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_MAP_PDF
  const r = raw as Record<string, unknown>
  const scale =
    typeof r.scale === 'number' &&
    Number.isFinite(r.scale) &&
    r.scale >= MIN_MAP_PDF_SCALE &&
    r.scale <= MAX_SHEET_SCALE
      ? Math.round(r.scale)
      : 'fit'
  return {
    paper: typeof r.paper === 'string' && r.paper in PAPER_SIZES ? (r.paper as PaperId) : DEFAULT_MAP_PDF.paper,
    orientation: r.orientation === 'landscape' || r.orientation === 'portrait' ? r.orientation : 'auto',
    frame: MAP_PDF_FRAMES.some((entry) => entry.value === r.frame) ? (r.frame as MapPdfFrame) : 'view',
    block: typeof r.block === 'string' ? r.block.slice(0, 200) : '',
    scale,
    marginPercent:
      typeof r.marginPercent === 'number' && r.marginPercent >= 0 && r.marginPercent <= MAX_MAP_PDF_MARGIN
        ? r.marginPercent
        : DEFAULT_MAP_PDF.marginPercent,
  }
}

/**
 * jsPDF's page format for a paper, millimetres short side first. A4 stays jsPDF's own `'a4'`, so the
 * default Map PDF is made exactly as before.
 */
export function mapPdfPageFormat(paper: PaperId): 'a4' | [number, number] {
  if (paper === 'a4') return 'a4'
  const size = PAPER_SIZES[paper]
  return [size.short * MM_PER_PT, size.long * MM_PER_PT]
}

/** The page's size in mm for a paper and orientation. */
export function mapPdfPageMm(paper: PaperId, orientation: Orientation) {
  const size = PAPER_SIZES[paper]
  const short = paper === 'a4' ? 210 : size.short * MM_PER_PT,
    long = paper === 'a4' ? 297 : size.long * MM_PER_PT
  return orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long }
}

/** What the person's project offers to frame, read by the page. */
export interface MapPdfTargets {
  /** The plan's centre now, for a typed scale on the view. */
  viewCenter?: Position
  /** The plan's size in CSS pixels, for the view's orientation. */
  viewSize?: { width: number; height: number }
  /** The road on screen: its name and centreline. */
  road?: { name: string; line: readonly Position[] }
  /** Every road's centreline. */
  roads?: readonly (readonly Position[])[]
  /** The block sheet's own block list. */
  blocks: readonly { value: string; label: string; ring: readonly Position[] }[]
}

export type MapPdfPlan =
  | { mode: 'as-shown'; paper: PaperId; orientation: MapPdfOrientation }
  | {
      mode: 'framed'
      paper: PaperId
      orientation: Orientation
      /** What is framed, for the page and the notice: "Block 12", "every road", … */
      label: string
      /** The ground to hold. Absent for the view at a typed scale, which keeps its centre. */
      bounds?: MapPdfBox
      center: Position
      scale: number | 'fit'
      marginPercent: number
    }

/** The box round a set of positions. */
export function boundsOf(positions: readonly Position[]): MapPdfBox | null {
  const finite = positions.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (!finite.length) return null
  const xs = finite.map((p) => p[0]),
    ys = finite.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** The middle of a box, in Web Mercator: the frame centres there, as the block sheets do. */
export function boxCenter(box: MapPdfBox): [number, number] {
  return inverseMercator((mercatorX(box[0]) + mercatorX(box[2])) / 2, (mercatorY(box[1]) + mercatorY(box[3])) / 2)
}

/** `auto` is landscape for a shape at least as wide as it is tall, as the Map PDF always chose. */
export const pickOrientation = (orientation: MapPdfOrientation, width: number, height: number): Orientation =>
  orientation === 'auto' ? (width >= height ? 'landscape' : 'portrait') : orientation

/**
 * What the Map PDF prints for these settings. The plan as shown, unless something else is framed or
 * a scale is typed; then the frame's ground and centre. Throws, naming what is missing, when the
 * chosen thing is not in the project.
 */
export function mapPdfPlan(settings: MapPdfSettings, targets: MapPdfTargets): MapPdfPlan {
  const { paper } = settings
  if (isAsShown(settings)) return { mode: 'as-shown', paper, orientation: settings.orientation }
  const framed = (label: string, bounds: MapPdfBox | null, center?: Position): MapPdfPlan => {
    const middle = center ?? (bounds ? boxCenter(bounds) : null)
    if (!middle) throw Error(`There is nothing to frame: ${label} has no position.`)
    const w = bounds ? mercatorX(bounds[2]) - mercatorX(bounds[0]) : (targets.viewSize?.width ?? 1)
    const h = bounds ? mercatorY(bounds[3]) - mercatorY(bounds[1]) : (targets.viewSize?.height ?? 1)
    return {
      mode: 'framed',
      paper,
      orientation: pickOrientation(settings.orientation, w, h),
      label,
      ...(bounds ? { bounds } : {}),
      center: [middle[0], middle[1]],
      scale: settings.scale,
      marginPercent: settings.marginPercent,
    }
  }
  switch (settings.frame) {
    case 'view': {
      if (!targets.viewCenter) throw Error('The plan map is still loading. Try again once it is ready.')
      return framed('Plan centre', null, targets.viewCenter)
    }
    case 'road': {
      const bounds = boundsOf(targets.road?.line ?? [])
      if (!targets.road || !bounds) throw Error('There is no road on screen to frame. Draw or choose a road.')
      return framed(targets.road.name || 'the road on screen', bounds)
    }
    case 'roads': {
      const bounds = boundsOf((targets.roads ?? []).flat())
      if (!bounds) throw Error('There is no road to frame. Draw a road first.')
      return framed('every road', bounds)
    }
    case 'block': {
      const block = targets.blocks.find((entry) => entry.value === settings.block) ?? targets.blocks[0]
      if (!block) throw Error('The project has no block areas to frame. Add a harvest area or a reference area.')
      return framed(block.label, boundsOf(block.ring))
    }
  }
}

/** The map's box on a framed page, mm from the page's top-left, under a header ending at `topMm`. */
export function framedMapBox(page: { width: number; height: number }, topMm: number) {
  return {
    x: MAP_PDF_SIDE_MM,
    y: topMm,
    w: page.width - 2 * MAP_PDF_SIDE_MM,
    h: page.height - topMm - MAP_PDF_FRAMED_FOOT_MM,
  }
}

/** Ground width and height of a box at its centre latitude, metres (as `fitScale` measures it). */
function groundSize(bounds: MapPdfBox) {
  const cos = Math.cos((((bounds[1] + bounds[3]) / 2) * Math.PI) / 180)
  return {
    widthM: (mercatorX(bounds[2]) - mercatorX(bounds[0])) * cos,
    heightM: (mercatorY(bounds[3]) - mercatorY(bounds[1])) * cos,
  }
}

/**
 * The finest listed scale (`FIT_SCALES`) at which `bounds` fits the map box with `marginPercent`
 * clear on every side, measured at the box's centre latitude; null when even `MAX_SHEET_SCALE`
 * does not hold it.
 */
export function fittedMapScale(
  bounds: MapPdfBox,
  boxMm: { w: number; h: number },
  marginPercent: number,
): number | null {
  const { widthM, heightM } = groundSize(bounds)
  const fill = Math.max(0.05, 1 - (2 * marginPercent) / 100)
  for (const scale of FIT_SCALES) {
    const metresPerMm = scale / 1000
    if (widthM <= boxMm.w * fill * metresPerMm && heightM <= boxMm.h * fill * metresPerMm) return scale
  }
  return null
}

/** The scale a framed page prints: the typed one, or the fitted one. Throws when nothing fits. */
export function framedScale(plan: Extract<MapPdfPlan, { mode: 'framed' }>, boxMm: { w: number; h: number }): number {
  if (plan.scale !== 'fit') return plan.scale
  if (!plan.bounds) throw Error('Type a scale to frame the view.')
  const scale = fittedMapScale(plan.bounds, boxMm, plan.marginPercent)
  if (scale === null)
    throw Error(
      `${plan.label} does not fit on this paper at ${formatScale(MAX_SHEET_SCALE)} or finer. Choose a larger paper or a smaller margin.`,
    )
  return scale
}

/**
 * The ground a map box shows at `scale`, centred on `center`: the block sheets' frame projection
 * with the box in points, so a paper millimetre is `scale` millimetres on the ground at the centre
 * latitude.
 */
export function mapPdfFrameProjection(
  center: Position,
  scale: number,
  boxMm: { w: number; h: number },
): FrameProjection {
  return frameProjection({ x: 0, y: 0, w: boxMm.w / MM_PER_PT, h: boxMm.h / MM_PER_PT }, [center[0], center[1]], scale)
}

/** Where the plan stands for a framed capture, and which part of it goes on the page. */
export interface CaptureCamera {
  center: [number, number]
  zoom: number
  /** CSS pixels of the plan per mm of paper. */
  cssPerMm: number
  /** The page's map box on the plan, CSS pixels from its top-left, centred. */
  crop: { x: number; y: number; w: number; h: number }
}

/**
 * The plan's camera for a framed capture: centred on the frame, zoomed so the frame's ground fills
 * the plan on its tighter side, north-up. The page's map box is then the centred `crop` of the
 * plan, and its ground is exactly the frame's (`mapPdfFrameProjection`).
 */
export function captureCamera(
  center: Position,
  scale: number,
  boxMm: { w: number; h: number },
  plan: { width: number; height: number },
): CaptureCamera {
  if (!(plan.width > 0 && plan.height > 0)) throw Error('Show the plan panel before exporting its map.')
  const boxCss = { w: boxMm.w * CSS_PX_PER_MM, h: boxMm.h * CSS_PX_PER_MM }
  // At `zoomForScale`, a CSS pixel covers what a 1/96 in of paper covers at `scale`.
  const k = Math.min(plan.width / boxCss.w, plan.height / boxCss.h)
  const w = boxCss.w * k,
    h = boxCss.h * k
  return {
    center: [center[0], center[1]],
    zoom: zoomForScale(scale, center[1]) + Math.log2(k),
    cssPerMm: k * CSS_PX_PER_MM,
    crop: { x: (plan.width - w) / 2, y: (plan.height - h) / 2, w, h },
  }
}

/** Dots per inch of paper a capture prints at: CSS pixels per inch of paper times the pixel ratio. */
export const captureDpi = (cssPerMm: number, pixelRatio: number) => cssPerMm * 25.4 * pixelRatio

/**
 * The pixel ratio to capture at: enough for `MAP_PDF_TARGET_DPI`, never below the plan's own and
 * never above `MAP_PDF_MAX_PIXEL_RATIO`.
 */
export function capturePixelRatio(cssPerMm: number, current: number): number {
  const wanted = MAP_PDF_TARGET_DPI / (cssPerMm * 25.4)
  return Math.max(current, Math.min(MAP_PDF_MAX_PIXEL_RATIO, wanted))
}

/** The plan reached the zoom asked for; MapLibre clamps to the map's zoom range without saying so. */
export const zoomReached = (actual: number, wanted: number) => Math.abs(actual - wanted) < 1e-6

/**
 * Whether the plan as shown can be registered as it is: north-up, flat, without 3D terrain and on the
 * flat (Mercator) projection. A turned or tilted view is not a Web Mercator picture, so it is printed
 * without registration.
 */
export function asShownRegistrable(view: {
  bearing: number
  pitch: number
  terrain: boolean
  projection?: string
}): boolean {
  return (
    Math.abs(view.bearing) < 1e-9 &&
    Math.abs(view.pitch) < 1e-9 &&
    !view.terrain &&
    (!view.projection || view.projection === 'mercator')
  )
}

/** The scale line under a framed map. */
export const framedScaleLine = (scale: number, centerLat: number, paper: PaperId) =>
  `Scale ${formatScale(scale)} on ${PAPER_SIZES[paper].label}, true at latitude ${Math.abs(centerLat).toFixed(2)} ${
    centerLat < 0 ? 'S' : 'N'
  } | North up | Web Mercator | Georeferenced (EPSG:3857)`

const escapeXml = (value: string) =>
  value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c)

/**
 * A sketch of the framed page for the preview: the paper, the title, the map box and what falls in
 * it, drawn from the frame's own projection. The map itself is captured from the plan only when the
 * PDF is made, so the sketch says so rather than moving the plan for every setting.
 */
export function framedPageSketch(input: {
  plan: Extract<MapPdfPlan, { mode: 'framed' }>
  title: string
  lines: readonly (readonly Position[])[]
  rings: readonly (readonly Position[])[]
  /** Where the PDF's header ends (`mapPdfHeaderTop`), so the sketch fits the same box at the same scale. */
  topMm?: number
}): { svg: string; width: number; height: number; scale: number; caption: string } {
  const { plan } = input
  const page = mapPdfPageMm(plan.paper, plan.orientation)
  const box = framedMapBox(page, input.topMm ?? MAP_PDF_SKETCH_TOP_MM)
  const scale = framedScale(plan, box)
  const projection = mapPdfFrameProjection(plan.center, scale, box)
  const at = (p: Position) => {
    const [x, y] = projection.project(p[0], p[1])
    return `${(box.x + x * MM_PER_PT).toFixed(2)},${(box.y + y * MM_PER_PT).toFixed(2)}`
  }
  const path = (line: readonly Position[], closed: boolean) =>
    line.length ? `M${line.map(at).join('L')}${closed ? 'Z' : ''}` : ''
  const rings = input.rings.map((ring) => path(ring, true)).join('')
  const lines = input.lines.map((line) => path(line, false)).join('')
  const label = framedScaleLine(scale, plan.center[1], plan.paper)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}" width="${page.width.toFixed(2)}mm" height="${page.height.toFixed(2)}mm" font-family="Helvetica, Arial, sans-serif">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="${MAP_PDF_SIDE_MM}" y="18" font-size="5.6" font-weight="bold" fill="#111827">${escapeXml(input.title)}</text>`,
    `<rect x="${MAP_PDF_SIDE_MM}" y="23" width="${(box.w * 0.6).toFixed(2)}" height="2.4" fill="#d1d5db"/>`,
    `<defs><clipPath id="frame"><rect x="${box.x}" y="${box.y}" width="${box.w.toFixed(2)}" height="${box.h.toFixed(2)}"/></clipPath></defs>`,
    `<rect x="${box.x}" y="${box.y}" width="${box.w.toFixed(2)}" height="${box.h.toFixed(2)}" fill="#eef2f0" stroke="#3c3c3c" stroke-width="0.3"/>`,
    `<g clip-path="url(#frame)" fill="none" stroke-linejoin="round" stroke-linecap="round">`,
    rings ? `<path d="${rings}" fill="#16a34a" fill-opacity="0.15" stroke="#15803d" stroke-width="0.5"/>` : '',
    lines ? `<path d="${lines}" stroke="#d97706" stroke-width="0.8"/>` : '',
    `</g>`,
    `<text x="${MAP_PDF_SIDE_MM}" y="${(page.height - 20).toFixed(2)}" font-size="2.5" fill="#374151">${escapeXml(label)}</text>`,
    `<rect x="${MAP_PDF_SIDE_MM}" y="${(page.height - 14).toFixed(2)}" width="${(box.w * 0.5).toFixed(2)}" height="1.6" fill="#e5e7eb"/>`,
    `</svg>`,
  ].join('')
  return {
    svg,
    width: page.width,
    height: page.height,
    scale,
    caption: `${plan.label} at ${formatScale(scale)} on ${PAPER_SIZES[plan.paper].label} ${plan.orientation}. A sketch of the page: when the PDF is made the plan turns north-up and flat, moves to this frame, draws and is put back, and the page is georeferenced.`,
  }
}

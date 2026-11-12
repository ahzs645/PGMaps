/**
 * Turns a captured road view into a VIA figure in one of the presets' styles, drawn only with the
 * shared sheet machinery: `symbols.ts` (areas, lines, legend swatches), `callouts.ts` (callouts,
 * leaders, halo text), `contours.ts` (marching squares, here over class masks) and `drawOps.ts`.
 * The output is a list of drawing operations; `renderPdf.ts`, `renderSvg.ts` and `sheetPng.ts` print it.
 *
 * Two images of one camera come in: the display frame, and a class pass in which every pixel is a
 * flat class colour (`CLASS_PALETTE`), occluded by the terrain as the picture is. The class pass
 * gives the outlines, which therefore follow the *visible* edge of each class, including the edge a
 * nearer ridge cuts, as the reference figures draw it, and the pixel counts the reference sheets print
 * ("units of area measured in pixels"). The page's sightline figure is printed beside the pixel one
 * and stays the assessment's number. No DOM or network access: images arrive as data.
 */
import {
  calloutOps,
  calloutText,
  labelOps,
  lineHeight,
  placeClear,
  textOps,
  type Box,
  type LabelStyleId,
  type SheetTextStyle,
} from '@/lib/mapSheet/callouts'
import { gridContours } from '@/lib/mapSheet/contours'
import type { LuminanceSampler } from '@/lib/mapSheet/contrastRuns'
import { rectRing, type DrawOp, type Point, type RasterImage, type StrokeStyle } from '@/lib/mapSheet/drawOps'
import { areaSymbolOps, lineSymbolOps, swatchOps, type SheetSymbol } from '@/lib/mapSheet/symbols'
import { fitText, textWidth, wrapText } from '@/lib/mapSheet/textMetrics'
import { cameraInfoLines, type CameraInfo } from './cameraInfo'
import {
  legendEntries,
  VQO_ZONE_ROLES,
  type CalloutStyle,
  type LegendStyle,
  type TextStyle,
  type ViaRole,
  type ViaStylePreset,
} from './presets'

// ------------------------------------------------------------------ class pass

/** Class codes of the class pass. Inside/outside is relative to the assessed landform. */
export const FIGURE_CLASS = {
  sky: 0,
  terrain: 1,
  landform: 2,
  rock: 3,
  proposedIn: 4,
  existingIn: 5,
  proposedOut: 6,
  existingOut: 7,
  privateIn: 8,
  privateOut: 9,
} as const
export type FigureClass = keyof typeof FIGURE_CLASS

/**
 * The flat colour each class is painted in the class pass. Sky is the transparent clear colour.
 * Picked far apart, so that a pixel blended between two classes at an edge is never mistaken for a
 * third (`decodeClassRaster` then gives it to a neighbour).
 */
export const CLASS_PALETTE: Record<Exclude<FigureClass, 'sky'>, readonly [number, number, number]> = {
  terrain: [96, 96, 96],
  landform: [0, 160, 0],
  rock: [150, 70, 210],
  proposedIn: [255, 0, 0],
  existingIn: [255, 230, 0],
  proposedOut: [130, 0, 40],
  existingOut: [0, 0, 255],
  privateIn: [0, 210, 210],
  privateOut: [255, 140, 255],
}

export const classColor = (name: Exclude<FigureClass, 'sky'>) =>
  `#${CLASS_PALETTE[name].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** A decoded class pass: one code per pixel, row-major from the top-left. */
export interface ClassRaster {
  width: number
  height: number
  codes: Uint8Array
}

/** A pixel this close (RGB distance) to a palette colour is that class outright. */
export const CLASS_MATCH_DISTANCE = 30

/**
 * Class codes from a class pass read back as straight RGBA. Transparent pixels are sky. A pixel
 * near one palette colour takes its class; one between colours (a blended edge) takes the most
 * common class of its resolved neighbours, and only failing that its nearest colour.
 */
export function decodeClassRaster(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  palette: ReadonlyArray<{ code: number; rgb: readonly number[] }> = (
    Object.entries(CLASS_PALETTE) as Array<[Exclude<FigureClass, 'sky'>, readonly number[]]>
  ).map(([name, rgb]) => ({ code: FIGURE_CLASS[name], rgb })),
): ClassRaster {
  const n = width * height
  if (rgba.length < n * 4) throw new Error('The class pass is smaller than its stated size.')
  const entries = palette
  const UNRESOLVED = 255
  const codes = new Uint8Array(n)
  const nearest = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    const o = k * 4
    if (rgba[o + 3] < 128) {
      codes[k] = FIGURE_CLASS.sky
      nearest[k] = FIGURE_CLASS.sky
      continue
    }
    let best = 0,
      bestDistance = Infinity
    for (const { code, rgb } of entries) {
      const d = Math.hypot(rgba[o] - rgb[0], rgba[o + 1] - rgb[1], rgba[o + 2] - rgb[2])
      if (d < bestDistance) {
        bestDistance = d
        best = code
      }
    }
    nearest[k] = best
    codes[k] = bestDistance <= CLASS_MATCH_DISTANCE ? best : UNRESOLVED
  }
  // Blended edge pixels take their neighbours' class; two sweeps settle a two-pixel blend.
  const tally = new Uint16Array(16)
  for (let sweep = 0; sweep < 2; sweep++)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const k = y * width + x
        if (codes[k] !== UNRESOLVED) continue
        tally.fill(0)
        let top = -1
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              ny = y + dy
            if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const c = codes[ny * width + nx]
            if (c === UNRESOLVED) continue
            tally[c]++
            if (top < 0 || tally[c] > tally[top]) top = c
          }
        if (top >= 0) codes[k] = top
      }
  for (let k = 0; k < n; k++) if (codes[k] === UNRESOLVED) codes[k] = nearest[k]
  return { width, height, codes }
}

/**
 * The VQO zone pass: each established objective's polygons in a flat colour, terrain else, sky
 * clear. Codes 1–5 are P, R, PR, M, MM (`VQO_ZONE_ROLES` order), 6 other terrain, 0 sky.
 */
export const ZONE_PALETTE: ReadonlyArray<{ code: number; rgb: readonly [number, number, number] }> = [
  { code: 1, rgb: [255, 0, 0] },
  { code: 2, rgb: [0, 0, 255] },
  { code: 3, rgb: [255, 230, 0] },
  { code: 4, rgb: [0, 200, 0] },
  { code: 5, rgb: [200, 0, 200] },
  { code: 6, rgb: [96, 96, 96] },
]
export const zoneColor = (code: number) =>
  `#${ZONE_PALETTE.find((entry) => entry.code === code)!
    .rgb.map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`

const IN_LANDFORM = new Set<number>([
  FIGURE_CLASS.landform,
  FIGURE_CLASS.rock,
  FIGURE_CLASS.proposedIn,
  FIGURE_CLASS.existingIn,
  FIGURE_CLASS.privateIn,
])
export const inLandform = (code: number) => IN_LANDFORM.has(code)

/** Pixel counts of the class pass, and the alteration figures they give. */
export interface FigureCounts {
  /** LF: every visible landform pixel. */
  landform: number
  /** PL: private land in the landform, not under a block or opening. */
  privateLand: number
  /** NonVEG: existing openings still counting, in the landform. */
  nonVeg: number
  /** Proposed blocks in the landform. */
  proposed: number
  /** VRI non-vegetated land in the landform, not under a block, opening or private land. */
  rock: number
  /** (NonVEG + Proposed) / LF, percent. */
  grossPercent: number | null
  /** (NonVEG + Proposed) / (LF − PL), percent. */
  netOfPrivatePercent: number | null
  /** (NonVEG + Proposed) / (LF − rock), percent. */
  netOfRockPercent: number | null
}

export function countClasses(raster: ClassRaster): FigureCounts {
  let landform = 0,
    privateLand = 0,
    nonVeg = 0,
    proposed = 0,
    rock = 0
  for (const code of raster.codes) {
    if (!IN_LANDFORM.has(code)) continue
    landform++
    if (code === FIGURE_CLASS.privateIn) privateLand++
    else if (code === FIGURE_CLASS.existingIn) nonVeg++
    else if (code === FIGURE_CLASS.proposedIn) proposed++
    else if (code === FIGURE_CLASS.rock) rock++
  }
  const altered = nonVeg + proposed
  const share = (denominator: number) => (denominator > 0 ? (100 * altered) / denominator : null)
  return {
    landform,
    privateLand,
    nonVeg,
    proposed,
    rock,
    grossPercent: share(landform),
    netOfPrivatePercent: share(landform - privateLand),
    netOfRockPercent: share(landform - rock),
  }
}

// ------------------------------------------------------------------ masks to rings

function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = points[a],
      [bx, by] = points[b]
    const dx = bx - ax,
      dy = by - ay,
      length = Math.hypot(dx, dy) || 1
    let worst = -1,
      at = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / length
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > tolerance) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Douglas–Peucker simplification; a closed ring is split at its farthest vertex so both halves have ends. */
export function simplifyRing(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points
  const [fx, fy] = points[0],
    [lx, ly] = points[points.length - 1]
  if (Math.hypot(fx - lx, fy - ly) > 1e-6) return simplifyOpen(points, tolerance)
  let far = 1,
    best = -1
  points.forEach(([x, y], i) => {
    const d = Math.hypot(x - fx, y - fy)
    if (d > best) {
      best = d
      far = i
    }
  })
  const a = simplifyOpen(points.slice(0, far + 1), tolerance),
    b = simplifyOpen(points.slice(far), tolerance)
  return [...a, ...b.slice(1, -1)]
}

export const ringArea = (ring: readonly Point[]) => {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i],
      [x1, y1] = ring[(i + 1) % ring.length]
    a += x0 * y1 - x1 * y0
  }
  return Math.abs(a / 2)
}

/** Specks smaller than this, in pixels², are dropped from traced outlines. */
export const MIN_RING_AREA_PX = 3

/**
 * Boundary rings of the pixels where `inside(code)` holds, in image pixels (pixel edges at integers).
 * Marching squares over a 0/2 grid at level 1, padded by one cell so every ring closes. Rings
 * under `minArea` px² are dropped.
 */
export function maskRings(
  raster: ClassRaster,
  inside: (code: number) => boolean,
  minArea = MIN_RING_AREA_PX,
  tolerance = 0.3,
): Point[][] {
  const w = raster.width + 2,
    h = raster.height + 2
  const values = new Float32Array(w * h)
  let any = false
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++)
      if (inside(raster.codes[y * raster.width + x])) {
        values[(y + 1) * w + x + 1] = 2
        any = true
      }
  if (!any) return []
  const lines = gridContours({ width: w, height: h, values }, 1, 1000).levels.find((l) => l.level === 1)?.lines ?? []
  return lines
    .map((line) =>
      simplifyRing(
        line.map(([c, r]) => [c - 1 + 0.5, r - 1 + 0.5] as Point),
        tolerance,
      ),
    )
    .filter((ring) => ring.length >= 3 && ringArea(ring) >= minArea)
}

/** Which class codes each role's outline is traced from. */
export const ROLE_CLASSES: Partial<Record<ViaRole, readonly number[]>> = {
  landform: [...IN_LANDFORM],
  proposedBlock: [FIGURE_CLASS.proposedIn, FIGURE_CLASS.proposedOut],
  treatedGround: [FIGURE_CLASS.proposedIn, FIGURE_CLASS.proposedOut],
  existingNonVeg: [FIGURE_CLASS.existingIn, FIGURE_CLASS.existingOut],
  privateLand: [FIGURE_CLASS.privateIn, FIGURE_CLASS.privateOut],
  rockNonVeg: [FIGURE_CLASS.rock],
}

export interface Overlay {
  role: ViaRole
  /** Rings or lines in image pixels. */
  parts: Point[][]
}

/** The traced outline of every role the preset draws and the class pass holds, landform first. */
/** Each VQO zone the preset tints and the zone pass holds, traced to rings. */
export function zoneOverlays(preset: ViaStylePreset, zones: ClassRaster): Overlay[] {
  return VQO_ZONE_ROLES.flatMap(([role], i) => {
    if (!preset.symbols[role]) return []
    const parts = maskRings(zones, (code) => code === i + 1, 20)
    return parts.length ? [{ role, parts }] : []
  })
}

export function roleOverlays(preset: ViaStylePreset, raster: ClassRaster): Overlay[] {
  const order: ViaRole[] = ['landform', 'rockNonVeg', 'privateLand', 'existingNonVeg', 'treatedGround', 'proposedBlock']
  return order.flatMap((role) => {
    const classes = ROLE_CLASSES[role]
    if (!classes || !preset.symbols[role]) return []
    const set = new Set(classes)
    // The landform is one big area: specks along its edge are noise, not ground.
    const parts = maskRings(raster, (code) => set.has(code), role === 'landform' ? 40 : MIN_RING_AREA_PX)
    return parts.length ? [{ role, parts }] : []
  })
}

/**
 * A ground line's projected points cut to the runs that fall on pixels `keep` accepts (the
 * landform, for a divider or a line of force): where the class pass shows something else in front,
 * the line is hidden. A nearer part of the same class can still hide it unseen, so this is the
 * figure's approximation, not the drape's exact occlusion. Null points (behind the camera) cut too.
 */
export function visibleLineParts(
  points: ReadonlyArray<Point | null>,
  raster: ClassRaster,
  keep: (code: number) => boolean,
): Point[][] {
  const parts: Point[][] = []
  let run: Point[] = []
  const flush = () => {
    if (run.length > 1) parts.push(run)
    run = []
  }
  for (const point of points) {
    const x = point ? Math.floor(point[0]) : -1,
      y = point ? Math.floor(point[1]) : -1
    if (
      !point ||
      x < 0 ||
      y < 0 ||
      x >= raster.width ||
      y >= raster.height ||
      !keep(raster.codes[y * raster.width + x])
    )
      flush()
    else run.push(point)
  }
  flush()
  return parts
}

/**
 * The rows to keep so the landform sits as the reference sheets crop it: about `skyShare` of the
 * height above its top, at most `groundShare` below its base, the full width kept. A crop only:
 * the window never reaches past the image, so where there is not enough sky or ground the shares
 * come out smaller. Null when no landform is in the picture or the crop would keep everything.
 * A trimmed share of the landform's rows is ignored at each end, so a stray pixel does not widen it.
 */
export function landformCropRows(
  raster: ClassRaster,
  options: { skyShare?: number; groundShare?: number; trim?: number } = {},
): { y: number; height: number } | null {
  const sky = options.skyShare ?? 0.2,
    ground = options.groundShare ?? 0.12,
    trim = options.trim ?? 0.005
  const perRow = new Uint32Array(raster.height)
  let total = 0
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++)
      if (IN_LANDFORM.has(raster.codes[y * raster.width + x])) {
        perRow[y]++
        total++
      }
  if (!total) return null
  const skip = Math.floor(total * trim)
  let top = 0,
    seen = 0
  while (top < raster.height - 1 && seen + perRow[top] <= skip) seen += perRow[top++]
  let bottom = raster.height - 1
  seen = 0
  while (bottom > top && seen + perRow[bottom] <= skip) seen += perRow[bottom--]
  const band = bottom - top + 1
  const height = Math.min(raster.height, Math.ceil(band / (1 - sky - ground)))
  let y = Math.round(top - sky * height)
  y = Math.max(0, Math.min(raster.height - height, y))
  // Keep at most `ground` below the base, in whole rows: the window moves down only as far as the image allows.
  const groundRows = Math.round(ground * height)
  if (y + height - 1 - bottom > groundRows)
    y = Math.max(0, Math.min(raster.height - height, bottom + 1 + groundRows - height))
  return height >= raster.height ? null : { y, height }
}

/** The rows `y` to `y + height` of a class raster. */
export function cropRasterRows(raster: ClassRaster, crop: { y: number; height: number }): ClassRaster {
  return {
    width: raster.width,
    height: crop.height,
    codes: raster.codes.slice(crop.y * raster.width, (crop.y + crop.height) * raster.width),
  }
}

/** Centroid of the visible landform, in image pixels; null when none is visible. */
export function landformCentroid(raster: ClassRaster): Point | null {
  let sx = 0,
    sy = 0,
    n = 0
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++)
      if (IN_LANDFORM.has(raster.codes[y * raster.width + x])) {
        sx += x + 0.5
        sy += y + 0.5
        n++
      }
  return n ? [sx / n, sy / n] : null
}

/** Row of the skyline in column `x`: the first pixel down from the top that is not sky. */
export function skylineRow(raster: ClassRaster, x: number): number {
  const col = Math.max(0, Math.min(raster.width - 1, Math.round(x)))
  let row = 0
  while (row < raster.height && raster.codes[row * raster.width + col] === FIGURE_CLASS.sky) row++
  return row
}

// ------------------------------------------------------------------ page helpers

/** Where the image sits on the page: origin and points per image pixel. */
export interface Frame extends Box {
  scale: number
}

/** The image fitted into `box` (points), centred, never stretched. */
export function fitFrame(image: { width: number; height: number }, box: Box): Frame {
  const scale = Math.min(box.w / image.width, box.h / image.height)
  const w = image.width * scale,
    h = image.height * scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, scale }
}

export const toPage =
  (frame: Frame) =>
  (p: Point): Point => [frame.x + p[0] * frame.scale, frame.y + p[1] * frame.scale]

const rectStroke = (box: Box, stroke: StrokeStyle): DrawOp => ({ op: 'rect', ...box, stroke })

/** `{name}` fields filled from `values`; unknown fields stay as written. */
export function fillTemplate(template: string, values: Record<string, string | number | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key]
    return value === undefined || value === null ? whole : String(value)
  })
}

/** The image re-toned to grey, as the district figures are, when the preset asks for it. */
export function tonedImage(image: RasterImage, tone: ViaStylePreset['tone']): RasterImage {
  if (tone !== 'greyscale' || image.kind !== 'rgba') return image
  const data = new Uint8ClampedArray(image.data.length)
  for (let k = 0; k < data.length; k += 4) {
    const l = Math.round(0.299 * image.data[k] + 0.587 * image.data[k + 1] + 0.114 * image.data[k + 2])
    data[k] = data[k + 1] = data[k + 2] = l
    data[k + 3] = image.data[k + 3]
  }
  return { ...image, data }
}

/** The figure's symbols over its overlays, clipped to the frame. Returns the roles drawn. */
export function overlayOps(
  preset: ViaStylePreset,
  overlays: readonly Overlay[],
  frame: Frame,
): { ops: DrawOp[]; drawn: Set<ViaRole> } {
  const P = toPage(frame)
  const ops: DrawOp[] = [{ op: 'clip', parts: [rectRing(frame.x, frame.y, frame.w, frame.h)] }]
  const drawn = new Set<ViaRole>()
  for (const overlay of overlays) {
    const entry = preset.symbols[overlay.role]
    if (!entry || !overlay.parts.length) continue
    const parts = overlay.parts.map((part) => part.map(P))
    if (entry.symbol.kind === 'area') ops.push(...areaSymbolOps(parts, entry.symbol, 1))
    else if (entry.symbol.kind === 'line') ops.push(...lineSymbolOps(parts, entry.symbol, 1))
    else continue
    drawn.add(overlay.role)
  }
  ops.push({ op: 'restore' })
  return { ops, drawn }
}

/** A legend of the roles drawn, each swatch drawn by `swatchOps` from the preset's own symbol. */
export function legendOps(
  preset: ViaStylePreset,
  drawn: ReadonlySet<ViaRole>,
  box: Box,
  legend: LegendStyle = preset.legend,
): DrawOp[] {
  const entries = legendEntries(preset, drawn)
  if (legend.where === 'none' || !entries.length) return []
  const ops: DrawOp[] = []
  let area = box
  if (legend.box) {
    const widest = Math.max(
      ...entries.map((e) => textWidth(e.label, legend.entry.size, legend.entry.style ?? 'normal')),
      legend.title ? textWidth(legend.title.text, legend.title.size, 'bold') - legend.swatch.w - legend.swatch.gap : 0,
    )
    const w = legend.swatch.w + legend.swatch.gap + widest + 10
    const h = (legend.title ? legend.title.size * 1.6 : 4) + entries.length * legend.rowPitch + 3
    area = { x: legend.where === 'inset-top-left' ? box.x : box.x + box.w - w, y: box.y, w, h }
    ops.push(...areaSymbolOps([rectRing(area.x, area.y, w, h)], legend.box, 1))
  }
  let y = area.y + 4
  const centred = legend.where === 'footer-cell'
  if (legend.title) {
    ops.push(
      ...textOps(
        centred ? area.x + area.w / 2 : area.x + 4,
        y + legend.title.size,
        legend.title.text,
        legend.title,
        centred ? 'center' : 'left',
      ),
    )
    y += legend.title.size * (centred ? 2 : 1.6)
  }
  const x0 = centred ? area.x + Math.min(35, area.w * 0.18) : area.x + 4
  for (const entry of entries) {
    if (legend.swatch.w > 0)
      ops.push(...swatchOps(entry.symbol as SheetSymbol, { x: x0, y, w: legend.swatch.w, h: legend.swatch.h }, 1))
    ops.push(
      ...textOps(
        x0 + legend.swatch.w + legend.swatch.gap,
        y + legend.swatch.h / 2,
        entry.label,
        legend.entry,
        'left',
        'middle',
      ),
    )
    y += legend.rowPitch
  }
  if (legend.footnote && (!legend.footnote.role || drawn.has(legend.footnote.role))) {
    const lines = wrapText(legend.footnote.text, legend.footnote.size, area.w - 12)
    let ly = area.y + area.h - 4 - (lines.length - 1) * legend.footnote.size * 1.15
    for (const line of lines) {
      ops.push(...textOps(area.x + 6, ly, line, legend.footnote))
      ly += legend.footnote.size * 1.15
    }
  }
  return ops
}

// ------------------------------------------------------------------ callouts

/** One block's callout, in image pixels. Built by the page from the run (`figureCallouts.ts`). */
export interface FigureCallout {
  title: string
  body?: string
  /** What the pointer touches: the block's visible ground, or its footprint when hidden. */
  anchor: Point
  /** Highlight it (the board triptych's yellow focus box). */
  focus?: boolean
  /** A secondary feature (an existing opening): smaller and plainer in the boxless styles. */
  secondary?: boolean
}

/** Gap kept between a callout box and the skyline above its anchor, points. */
export const CALLOUT_SKY_GAP = 28

/**
 * Boxes for the callouts, laid out on the page: above the skyline over each anchor (or the anchor,
 * as the style asks), clear of each other, shifted right and then down when they collide. Callouts
 * that cannot be placed are left out and counted.
 */
export function layoutCallouts(
  callouts: readonly FigureCallout[],
  style: CalloutStyle,
  frame: Frame,
  raster: ClassRaster | null,
  /**
   * Where boxes may go, points: the frame by default. A sheet with room round a strip cropped to
   * the landform passes its whole image band, so the boxes sit in the white above the skyline.
   */
  area: Box = { x: frame.x + 4, y: frame.y + 4, w: frame.w - 8, h: frame.h - 8 },
): { boxes: Array<{ callout: FigureCallout; box: Box; anchor: Point }>; dropped: number } {
  const P = toPage(frame)
  const bounds = area
  const placed: Box[] = []
  const boxes: Array<{ callout: FigureCallout; box: Box; anchor: Point }> = []
  let dropped = 0
  for (const callout of [...callouts].sort((a, b) => a.anchor[0] - b.anchor[0])) {
    const anchor = P(callout.anchor)
    const { w, h } = calloutText(style, callout.title, callout.body, Math.max(60, frame.w * MAX_LABEL_WIDTH_SHARE))
    const ceiling = raster ? P([callout.anchor[0], skylineRow(raster, callout.anchor[0])])[1] : anchor[1]
    const lean = style.pointer.kind === 'wedge' ? w * 0.35 : 0
    const x = anchor[0] - w / 2 - lean
    const y =
      style.placement === 'above-skyline'
        ? Math.min(ceiling, anchor[1]) - CALLOUT_SKY_GAP - h
        : style.placement === 'outside-frame-top'
          ? frame.y + 10
          : style.placement === 'above-feature'
            ? anchor[1] - 42 - h
            : anchor[1] + 30
    const box = placeClear({ x, y, w, h }, placed, bounds)
    if (!box) {
      dropped++
      continue
    }
    placed.push(box)
    boxes.push({ callout, box, anchor })
  }
  return { boxes, dropped }
}

export function figureCalloutOps(
  callouts: readonly FigureCallout[],
  style: CalloutStyle,
  frame: Frame,
  raster: ClassRaster | null,
  area?: Box,
): DrawOp[] {
  const { boxes } = layoutCallouts(callouts, style, frame, raster, area)
  return boxes.flatMap(({ callout, box, anchor }) =>
    calloutOps(
      style,
      box,
      anchor,
      callout.title,
      callout.body,
      callout.focus && style.focus ? { box: style.focus.box, leader: style.focus.leader } : {},
      calloutText(style, callout.title, callout.body, Math.max(60, frame.w * MAX_LABEL_WIDTH_SHARE)),
    ),
  )
}

// ------------------------------------------------------------------ figure input

/** Everything a figure needs: the two passes of one camera and the run's own figures. */
export interface FigureInput {
  preset: ViaStylePreset
  /** The display frame as captured. */
  image: RasterImage
  /** The class pass of the same camera, the same size as `image`; null draws no outlines or counts. */
  classes: ClassRaster | null
  callouts: readonly FigureCallout[]
  /**
   * Line roles projected into the image (sub-landform dividers, lines of force), already cut to
   * where they fall on the landform: `visibleLineParts`.
   */
  lines?: readonly Overlay[]
  /** How features are named; the preset's own style when absent. */
  labelStyle?: LabelStyleId
  /**
   * Brightness of the display frame at an image pixel, 0–1, for a frame that arrives encoded (a
   * JPEG data URL the composer cannot read). The page decodes it (`rgbaLuminance`); an RGBA frame is
   * read directly. Only the `underlined-arrow` labels use it.
   */
  luminance?: ((x: number, y: number) => number | null) | null
  /** The VQO zone pass of the same camera (`ZONE_PALETTE` codes), when EVQO polygons were loaded. */
  zones?: ClassRaster | null
  /** What the camera information block prints; null when unknown. */
  camera?: CameraInfo | null
  /** Print the camera information block on the image; the preset's own choice when absent. */
  cameraInfo?: boolean
  /** The page's sightline alteration at this station, percent: the assessment's figure. */
  sightlinePercent: number | null
  /** Its Table 2 class name, if any. */
  sightlineClass?: string | null
  /** Distance to the nearest block seen, km, and the view's horizontal field of view, degrees. */
  distanceKm?: number | null
  hfovDeg?: number | null
  /** Caption of the camera: lens, field of view, bearing. */
  lens: string
  /** Title fields: `{area}`, `{viewpoint}`, `{n}`, `{licence}`, `{blocks}`. */
  titles: { area: string; viewpoint: string; n?: string; licence?: string; blocks?: string }
  /** Footer facts, label and value. */
  facts: ReadonlyArray<{ label: string; value: string }>
  /** Rating code of the landform's sensitivity unit, when the inventory gives one. */
  rating?: { vsu?: string; vsc?: string; vac?: string; evc?: string; vqo?: string } | null
  /** Which rule chose the rating's unit, printed small under the inventory circle. */
  ratingNote?: string | null
  generatedAt: Date
}

export interface ComposedFigure {
  width: number
  height: number
  ops: DrawOp[]
  /** The image's place on the page, for cropping the figure alone. */
  frame: Frame
  drawn: ViaRole[]
  counts: FigureCounts | null
  /** Notes for the reviewer about what the figure could not show. */
  notes: string[]
}

const BLACK = '#000000'
/** What the analysis sheet's inventory cell says when no unit is under the landform or the blocks. */
export const NO_INVENTORY_UNIT = 'No visual sensitivity unit under the landform or blocks'
const FOOTER: TextStyle = { size: 6, color: '#6b6b6b' }
const NOTE: TextStyle = { size: 7, color: '#595959' }
const OWN: TextStyle = { size: 9, color: '#1d4ed8' }

const fixed = (value: number | null, digits = 2) =>
  value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits)

export const footerLine = (preset: ViaStylePreset, at: Date) =>
  `PGMaps figure in the "${preset.name}" style - generated ${at.toISOString().slice(0, 10)} - terrain model and draped data, not a field-verified simulation`

/** The values a preset's calculation lines are filled from. */
export function calcValues(counts: FigureCounts | null, n = '1'): Record<string, string | number> {
  if (!counts) return { n }
  const pct = (part: number) => fixed(counts.landform ? (100 * part) / counts.landform : null)
  const net = counts.landform - counts.rock
  return {
    n,
    landformPx: counts.landform,
    privatePx: counts.privateLand,
    nonVegPx: counts.nonVeg,
    proposedPx: counts.proposed,
    rockPx: counts.rock,
    netPx: net,
    nonVegPct: pct(counts.nonVeg),
    proposedPct: pct(counts.proposed),
    totalPct: fixed(counts.grossPercent),
    landformArea: `${counts.landform} px`,
    proposedArea: `${counts.proposed} px`,
    nonVegArea: `${counts.nonVeg} px`,
    rockArea: `${counts.rock} px`,
    netArea: `${net} px`,
    alterationArea: `${counts.proposed + counts.nonVeg} px`,
  }
}

/** The alteration a preset's calculation reads: net of private land or rock when it names them. */
export function presetPercent(preset: ViaStylePreset, counts: FigureCounts | null): number | null {
  if (!counts) return null
  const lines = preset.calc?.lines.join(' ') ?? ''
  if (/LF - PL/.test(lines)) return counts.netOfPrivatePercent
  if (/Net VLU|\{rockPx\}/.test(lines)) return counts.netOfRockPercent
  return counts.grossPercent
}

/** The image, its outlines, labels and callouts in `frame`. Shared by every sheet form. */
function figurePanel(input: FigureInput, frame: Frame, calloutArea?: Box) {
  const { preset } = input
  const ops: DrawOp[] = [{ op: 'image', ...frame, image: tonedImage(input.image, preset.tone) }]
  const overlays = [
    ...(input.zones ? zoneOverlays(preset, input.zones) : []),
    ...(input.classes ? roleOverlays(preset, input.classes) : []),
    ...(input.lines ?? []),
  ]
  const { ops: drawnOps, drawn } = overlayOps(preset, overlays, frame)
  ops.push(...drawnOps)
  const centroid = input.classes ? landformCentroid(input.classes) : null
  const label = preset.labels?.landform
  if (centroid && label) {
    const [x, y] = toPage(frame)(centroid)
    ops.push(...textOps(x, y, fillTemplate(label.template, { n: input.titles.n ?? '1' }), label, 'center'))
    const rating = preset.labels?.rating
    if (rating && input.rating)
      rating.lines.forEach((line, i) => {
        const text = fillTemplate(line, input.rating ?? {})
        if (!/\{\w+\}/.test(text)) ops.push(...textOps(x, y + (i + 1) * lineHeight(rating), text, rating, 'center'))
      })
  }
  const placedLabels = input.callouts.length
    ? figureLabelOps(input, frame, calloutArea ?? { x: frame.x + 4, y: frame.y + 4, w: frame.w - 8, h: frame.h - 8 })
    : { ops: [], key: [] }
  ops.push(...placedLabels.ops)
  if ((input.cameraInfo ?? preset.cameraInfo ?? false) && input.camera) ops.push(...cameraInfoOps(input.camera, frame))
  ops.push(rectStroke(frame, { color: '#bfbfbf', width: 0.4 }))
  return { ops, drawn, key: placedLabels.key }
}

/** The camera information block, white text with a dark halo, at the image's bottom left. */
export function cameraInfoOps(camera: CameraInfo, frame: Frame): DrawOp[] {
  const lines = cameraInfoLines(camera)
  const size = Math.max(5, Math.min(7.5, frame.h / 16))
  const style: SheetTextStyle = { size, color: '#ffffff', halo: { color: '#1f2937', width: size * 0.22 } }
  const bottom = frame.y + frame.h - 6
  return lines.flatMap((line, i) =>
    textOps(frame.x + 6, bottom - (lines.length - 1 - i) * size * 1.25, fitText(line, size, frame.w - 12), style),
  )
}

/** The label style a figure uses: the one asked for, else the preset's own. */
export function figureLabelStyle(input: Pick<FigureInput, 'preset' | 'labelStyle'>): LabelStyleId {
  return input.labelStyle ?? input.preset.labelStyle ?? (input.preset.callout ? 'box' : 'halo')
}

/** Rec. 601 luma of a `#rrggbb` colour, 0–1. */
const hexLuma = (hex: string) => {
  const v = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return Number.isFinite(v) ? (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255 : null
}

/** Brightness of an RGBA image at a pixel, 0–1, averaged over the 3 × 3 pixels round it; null off the image. */
export function rgbaLuminance(image: { data: ArrayLike<number>; width: number; height: number }) {
  return (x: number, y: number): number | null => {
    const cx = Math.floor(x),
      cy = Math.floor(y)
    if (!(cx >= 0 && cy >= 0 && cx < image.width && cy < image.height)) return null
    let sum = 0,
      n = 0
    for (let j = Math.max(0, cy - 1); j <= Math.min(image.height - 1, cy + 1); j++)
      for (let i = Math.max(0, cx - 1); i <= Math.min(image.width - 1, cx + 1); i++) {
        const o = (j * image.width + i) * 4
        sum += 0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2]
        n++
      }
    return sum / n / 255
  }
}

/**
 * Brightness of the figure as printed under a page point: the frame's own (`input.luminance`, or an
 * RGBA frame read directly), with the preset's area fills for the zone and class under that pixel
 * laid over it in drawing order, so a leader that reaches a pale block fill turns dark over it.
 * Null when the frame cannot be read.
 */
export function figureLuminance(input: FigureInput, frame: Frame): LuminanceSampler | null {
  const base = input.luminance ?? (input.image.kind === 'rgba' ? rgbaLuminance(input.image) : null)
  if (!base) return null
  const fillOf = (role: ViaRole) => {
    const symbol = input.preset.symbols[role]?.symbol
    if (symbol?.kind !== 'area' || !symbol.fill) return null
    const l = hexLuma(symbol.fill)
    return l === null ? null : { l, a: symbol.fillOpacity ?? 1 }
  }
  const zoneFills = VQO_ZONE_ROLES.map(([role]) => fillOf(role))
  const order: ViaRole[] = ['landform', 'rockNonVeg', 'privateLand', 'existingNonVeg', 'treatedGround', 'proposedBlock']
  const classFills = new Map<number, Array<{ l: number; a: number }>>()
  for (const role of order) {
    const fill = fillOf(role)
    if (fill) for (const code of ROLE_CLASSES[role] ?? []) classFills.set(code, [...(classFills.get(code) ?? []), fill])
  }
  const codeAt = (raster: ClassRaster | null | undefined, x: number, y: number) =>
    raster && x >= 0 && y >= 0 && x < raster.width && y < raster.height
      ? raster.codes[Math.floor(y) * raster.width + Math.floor(x)]
      : null
  return (px, py) => {
    const x = (px - frame.x) / frame.scale,
      y = (py - frame.y) / frame.scale
    let l = base(x, y)
    if (l === null) return null
    const zone = codeAt(input.zones, x, y)
    const zoneFill = zone ? zoneFills[zone - 1] : null
    if (zoneFill) l = l * (1 - zoneFill.a) + zoneFill.l * zoneFill.a
    const code = codeAt(input.classes, x, y)
    for (const fill of code === null ? [] : (classFills.get(code) ?? [])) l = l * (1 - fill.a) + fill.l * fill.a
    return l
  }
}

/** Widest a label may be, as a share of the image's width on the page. */
export const MAX_LABEL_WIDTH_SHARE = 0.28

/** The figure's labels in its label style (`labelOps`), above the skyline the class pass gives. */
export function figureLabelOps(input: FigureInput, frame: Frame, area: Box) {
  const P = toPage(frame)
  const raster = input.classes
  const style = figureLabelStyle(input)
  const block = input.preset.labels?.block
  const text: SheetTextStyle | undefined = block
    ? {
        size: block.size,
        color: block.color,
        ...(block.style ? { style: block.style } : {}),
        halo: block.halo ?? { color: block.color.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff', width: 1.8 },
      }
    : undefined
  return labelOps(
    input.callouts.map((callout) => ({ ...callout, anchor: P(callout.anchor) })),
    {
      style,
      area,
      maxWidth: Math.max(60, frame.w * MAX_LABEL_WIDTH_SHARE),
      ...(raster
        ? {
            ceilingAt: (x: number) =>
              frame.y +
              skylineRow(raster, Math.max(0, Math.min(raster.width - 1, (x - frame.x) / frame.scale))) * frame.scale,
          }
        : {}),
      gap: input.preset.callout?.placement === 'above-skyline' || !input.preset.callout ? CALLOUT_SKY_GAP : 20,
      ...(input.preset.callout ? { box: input.preset.callout } : {}),
      ...(text ? { text } : {}),
      ...(block?.leader ? { leader: block.leader } : {}),
      ...(style === 'underlined-arrow' ? { luminanceAt: figureLuminance(input, frame) } : {}),
    },
  )
}

/** A numbered style's key, as lines of text from `y` down in `box`. */
function labelKeyOps(key: ReadonlyArray<{ n: number; text: string }>, box: Box, y: number): DrawOp[] {
  const ops: DrawOp[] = []
  const size = 7
  for (const entry of key) {
    if (y > box.y + box.h - 2) break
    ops.push(...textOps(box.x + 6, y, fitText(`${entry.n}  ${entry.text}`, size, box.w - 12), { size, color: BLACK }))
    y += size * 1.3
  }
  return ops
}

/** The calculation lines, bold where a line starts with `**`, then PGMaps' own figures beside them. */
function calcOps(input: FigureInput, counts: FigureCounts | null, x: number, y: number, align: 'left' | 'center') {
  const calc = input.preset.calc
  const ops: DrawOp[] = []
  if (!calc) return { ops, bottom: y }
  const values = {
    ...calcValues(counts, input.titles.n),
    ...(input.distanceKm != null ? { distanceKm: input.distanceKm.toFixed(1) } : {}),
    ...(input.hfovDeg != null ? { hfov: Math.round(input.hfovDeg) } : {}),
  }
  if (calc.title.text) {
    ops.push(...textOps(x, y, calc.title.text, calc.title, align))
    y += lineHeight(calc.title) * 1.6
  }
  let previousBold = false
  for (const template of calc.lines) {
    const bold = template.startsWith('**')
    if (bold && !previousBold) y += 4
    previousBold = bold
    const style = bold ? (calc.emphasis ?? calc.line) : calc.line
    const text = fillTemplate(bold ? template.slice(2) : template, values)
    // A field the view cannot fill leaves its line out rather than printing braces.
    if (/\{\w+\}/.test(text)) continue
    ops.push(...textOps(x, y, text, style, align))
    y += lineHeight(style)
  }
  return { ops, bottom: y }
}

/** PGMaps' two figures side by side, and what each one is. */
function measureLines(input: FigureInput, counts: FigureCounts | null): string[] {
  const pixel = presetPercent(input.preset, counts)
  return [
    `Sightline measure (PGMaps run, the assessment figure): ${fixed(input.sightlinePercent)}%${input.sightlineClass ? ` (${input.sightlineClass})` : ''}`,
    `Pixel measure, this image: ${fixed(pixel)}%`,
    `View: ${input.lens}`,
  ]
}

// ------------------------------------------------------------------ sheets

/**
 * The perspective viewpoint analysis sheet (family A): tabloid landscape, title block, the figure,
 * and four footer cells (facts, visual inventory key, calculation, legend). The logo slot is left
 * for the user.
 */
export function analysisSheet(input: FigureInput): ComposedFigure {
  const { preset } = input
  const sheet = preset.sheet
  if (!sheet || !sheet.cells || preset.family !== 'A')
    throw new Error(`"${preset.name}" is not an analysis sheet style.`)
  const W = sheet.paper.width,
    H = sheet.paper.height
  const R = (f: readonly number[]): Box => ({ x: f[0] * W, y: f[1] * H, w: (f[2] - f[0]) * W, h: (f[3] - f[1]) * H })
  const cell = (id: string) => R(sheet.cells!.find((c) => c.id === id)!.rect)
  const ops: DrawOp[] = []
  const band = R(sheet.image)
  const frame = fitFrame(input.image, { x: band.x + 54, y: band.y + 16, w: band.w - 108, h: band.h - 32 })
  // Callouts may use the whole band: a strip cropped to the landform leaves its sky above the frame.
  const panel = figurePanel(input, frame, { x: band.x + 8, y: band.y + 8, w: band.w - 16, h: band.h - 16 })
  ops.push(...panel.ops)
  if (sheet.neatline) ops.push(rectStroke(R(sheet.neatline.rect), sheet.neatline.stroke))
  ops.push(rectStroke(band, sheet.rule))
  for (const c of sheet.cells) ops.push(rectStroke(R(c.rect), sheet.rule))
  // Title block, centred; the logo slot on the right is the user's own.
  const title = sheet.title ? R(sheet.title) : { x: 0, y: 0, w: W, h: 130 }
  const lines = preset.titles?.lines ?? []
  // Baselines as the reference title blocks set them (22 p27: 63.6, 106.2 and 131.7 pt on the page).
  const BASELINES = [49.2, 91.8, 117.3]
  lines.forEach((line, i) => {
    const text = fitText(
      fillTemplate(line.text, { ...input.titles, n: input.titles.n ?? '1' }),
      line.size,
      title.w - 420,
      line.style ?? 'normal',
    )
    ops.push(
      ...textOps(W / 2, title.y + (BASELINES[i] ?? 117.3 + (i - 2) * 22) * (title.h / 129.6), text, line, 'center'),
    )
  })
  const logo = { x: title.x + title.w - 190, y: title.y + 10, w: 170, h: 46 }
  ops.push(rectStroke(logo, { color: '#bfbfbf', width: 0.5, dash: [3, 2] }))
  ops.push(
    ...textOps(
      logo.x + logo.w / 2,
      logo.y + logo.h / 2 + 3,
      'Logo (your own)',
      { size: 7, color: '#9c9c9c' },
      'center',
    ),
  )
  // Facts.
  const facts = cell('facts')
  const factStyle = preset.facts ?? { size: 12.96, style: 'bolditalic' as const, color: BLACK }
  let fy = facts.y + 20
  for (const fact of input.facts) {
    const wrapped = wrapText(`${fact.label}: ${fact.value}`, factStyle.size, facts.w - 24, factStyle.style ?? 'normal')
    for (const line of wrapped) {
      if (fy > facts.y + facts.h - 4) break
      ops.push(...textOps(facts.x + 12, fy, line, factStyle))
      fy += factStyle.size * 1.15
    }
    fy += 6
  }
  // Visual inventory key.
  const inventory = cell('inventory')
  const badge = preset.vsuBadge
  if (badge && !input.rating) {
    // No unit to show: one line, not a circle of placeholder labels.
    wrapText(NO_INVENTORY_UNIT, 7.92, inventory.w - 16).forEach((line, i, all) =>
      ops.push(
        ...textOps(
          inventory.x + inventory.w / 2,
          inventory.y + inventory.h / 2 - ((all.length - 1) * 9.4) / 2 + i * 9.4,
          line,
          { size: 7.92, color: '#595959' },
          'center',
          'middle',
        ),
      ),
    )
  } else if (badge && input.rating) {
    const cx = inventory.x + inventory.w / 2
    ops.push(
      ...textOps(
        cx,
        inventory.y + 13.5,
        'Visual Inventory Legend',
        { size: 7.92, style: 'bold', color: BLACK },
        'center',
      ),
    )
    const cy = inventory.y + 52.8
    ops.push({ op: 'circle', x: cx, y: cy, r: badge.diameter / 2, fill: badge.fill, stroke: badge.stroke })
    const values = input.rating
    // The unit's own values; a value the inventory does not hold prints "?", never the key's label.
    const filled = [
      values.vsu ? `VSU ${values.vsu}` : 'VSU ?',
      values.vsc ?? '?',
      `${values.vac ?? '?'}  /  ${values.evc ?? '?'}`,
      values.vqo ?? '?',
    ]
    filled.forEach((line, i) => ops.push(...textOps(cx, cy - 12 + i * 9.4, line, badge.text, 'center')))
    if (input.ratingNote)
      wrapText(input.ratingNote, 5.5, inventory.w - 10)
        .slice(0, 2)
        .forEach((line, i) =>
          ops.push(...textOps(cx, inventory.y + 88 + i * 6.4, line, { size: 5.5, color: '#595959' }, 'center')),
        )
    badge.keyLines.forEach((line, i) =>
      ops.push(
        ...textOps(inventory.x + 8, inventory.y + 102 + i * 8.6, line, {
          ...badge.key,
          size: Math.min(badge.key.size, 7),
        }),
      ),
    )
  }
  // Calculation, with PGMaps' own two figures beside it.
  const calcCell = cell('calc')
  const counts = input.classes ? countClasses(input.classes) : null
  const calc = calcOps(input, counts, calcCell.x + 10.8, calcCell.y + 15.5, 'left')
  ops.push(...calc.ops)
  // PGMaps' own two figures in the cell's right half, wrapped to it.
  const measureX = calcCell.x + calcCell.w * 0.5
  const measureWidth = calcCell.x + calcCell.w - measureX - 8
  let my = calcCell.y + 37
  measureLines(input, counts).forEach((line, i) => {
    const style = i === 2 ? { ...OWN, size: 7.92 } : OWN
    for (const wrapped of wrapText(line, style.size, measureWidth)) {
      ops.push(...textOps(measureX, my, wrapped, style))
      my += lineHeight(style)
    }
    my += 2
  })
  if (preset.calc?.footnote)
    ops.push(
      ...textOps(calcCell.x + 10.8, calcCell.y + calcCell.h - 4.6, preset.calc.footnote.text, preset.calc.footnote),
    )
  // Legend, and a numbered style's key under it.
  const legendCell = cell('legend')
  ops.push(...legendOps(preset, panel.drawn, legendCell))
  if (panel.key.length) {
    const rows = legendEntries(preset, panel.drawn).length
    const top =
      legendCell.y + 4 + (preset.legend.title ? preset.legend.title.size * 2 : 0) + rows * preset.legend.rowPitch + 10
    ops.push(...labelKeyOps(panel.key, legendCell, top))
  }
  ops.push(...textOps(W / 2, H - 4, footerLine(preset, input.generatedAt), FOOTER, 'center'))
  return { width: W, height: H, ops, frame, drawn: [...panel.drawn], counts, notes: notesFor(input, panel.drawn) }
}

/**
 * The analysed figure alone on a page of its own width (612 pt, a letter page across), with the
 * legend inset as the style places it and the calculation under it: every family's single-panel
 * form, and what the block note embeds.
 */
export function analysedFigure(input: FigureInput, width = 612): ComposedFigure {
  const { preset } = input
  const margin = 18
  const frame = fitFrame(input.image, {
    x: margin,
    y: margin + 18,
    w: width - margin * 2,
    h: ((width - margin * 2) * input.image.height) / input.image.width,
  })
  const ops: DrawOp[] = []
  const panel = figurePanel(input, frame)
  ops.push(...panel.ops)
  const titleLine = preset.titles?.lines[0]
  const title = fillTemplate(titleLine?.text ?? '{viewpoint}', { ...input.titles, n: input.titles.n ?? '1' })
  ops.push(
    ...textOps(
      width / 2,
      margin + 10,
      title.replace(/\{\w+\}/g, '').trim() || input.titles.viewpoint,
      { size: 11, style: 'bold', color: BLACK },
      'center',
    ),
  )
  const inset = { x: frame.x + 8, y: frame.y + 8, w: frame.w - 16, h: frame.h - 16 }
  const legend: LegendStyle =
    preset.legend.where === 'footer-cell' || preset.legend.where === 'side-panel'
      ? {
          ...preset.legend,
          where: 'inset-top-right',
          box: { kind: 'area', label: 'Legend box', fill: '#ffffff', outline: [{ color: '#7f7f7f', width: 0.5 }] },
        }
      : preset.legend
  ops.push(...legendOps(preset, panel.drawn, inset, legend))
  if (preset.panelLabels) {
    const label = preset.panelLabels.labels.at(-1)
    if (label) {
      const size = preset.panelLabels.sizeShare
        ? Math.max(6, frame.w * preset.panelLabels.sizeShare)
        : preset.panelLabels.text.size
      ops.push(
        ...textOps(frame.x + frame.w * 0.013 + 2, frame.y + frame.h - size * 0.6, label, {
          ...preset.panelLabels.text,
          size,
          halo: { color: '#ffffff', width: 1.5 },
        }),
      )
    }
  }
  ops.push(rectStroke(frame, { color: BLACK, width: 1.2 }))
  const counts = input.classes ? countClasses(input.classes) : null
  let y = frame.y + frame.h + 18
  if (panel.key.length) {
    ops.push(...labelKeyOps(panel.key, { x: margin, y, w: width - margin * 2, h: panel.key.length * 9.1 + 4 }, y))
    y += panel.key.length * 9.1 + 8
  }
  const calc = calcOps(input, counts, width / 2, y, 'center')
  ops.push(...calc.ops)
  y = calc.bottom + 6
  for (const line of measureLines(input, counts)) {
    ops.push(...textOps(width / 2, y, line, { ...NOTE, size: 8, color: '#1d4ed8' }, 'center'))
    y += 10.5
  }
  const height = Math.ceil(y + 16)
  ops.push(...textOps(width / 2, height - 5, footerLine(preset, input.generatedAt), FOOTER, 'center'))
  return { width, height, ops, frame, drawn: [...panel.drawn], counts, notes: notesFor(input, panel.drawn) }
}

/** The sheet a preset prints on: the analysis sheet for family A, the analysed figure otherwise. */
/**
 * The perspective view with everything on the image (family I): the picture fills a tabloid page,
 * the title sits in its sky at top centre, the legend panel at its top left, the camera block at
 * its bottom left, and PGMaps' two figures in a line under it.
 */
export function overlaySheet(input: FigureInput): ComposedFigure {
  const { preset } = input
  const W = 1224,
    margin = 18
  // Fitted to the width and set at the top: a wide view leaves no band of white above it.
  const fitted = fitFrame(input.image, { x: margin, y: margin, w: W - margin * 2, h: 792 - margin * 2 - 40 })
  const frame = { ...fitted, y: margin }
  const panel = figurePanel({ ...input, cameraInfo: input.cameraInfo ?? preset.cameraInfo ?? true }, frame)
  const ops: DrawOp[] = [...panel.ops]
  let ty = frame.y + 10
  for (const line of preset.titles?.lines ?? []) {
    const text = fillTemplate(line.text, { ...input.titles, n: input.titles.n ?? '1' })
    if (/\{\w+\}/.test(text) || !text.trim()) continue
    ty += line.size * 1.2
    ops.push(...textOps(frame.x + frame.w / 2, ty, text, line, 'center'))
  }
  ops.push(...legendOps(preset, panel.drawn, { x: frame.x + 8, y: frame.y + 8, w: frame.w / 3, h: frame.h / 2 }))
  if (panel.key.length)
    ops.push(
      ...labelKeyOps(panel.key, { x: frame.x, y: frame.y + frame.h + 6, w: frame.w, h: 30 }, frame.y + frame.h + 14),
    )
  const counts = input.classes ? countClasses(input.classes) : null
  const height = Math.ceil(frame.y + frame.h + 18 + (panel.key.length ? panel.key.length * 9.1 + 4 : 0) + 30)
  let y = height - 26
  ops.push(
    ...textOps(
      W / 2,
      y,
      measureLines(input, counts).slice(0, 2).join('   ·   '),
      { size: 8, color: '#1d4ed8' },
      'center',
    ),
  )
  y += 12
  ops.push(...textOps(W / 2, y, footerLine(preset, input.generatedAt), FOOTER, 'center'))
  return { width: W, height, ops, frame, drawn: [...panel.drawn], counts, notes: notesFor(input, panel.drawn) }
}

export const composeFigure = (input: FigureInput): ComposedFigure =>
  input.preset.family === 'A' && input.preset.sheet?.cells
    ? analysisSheet(input)
    : input.preset.family === 'I'
      ? overlaySheet(input)
      : analysedFigure(input)

function notesFor(input: FigureInput, drawn: ReadonlySet<ViaRole>): string[] {
  const notes: string[] = []
  if (!input.classes)
    notes.push('No class pass was captured with this view, so the figure has no traced outlines or pixel counts.')
  const missing = (Object.keys(input.preset.symbols) as ViaRole[]).filter((role) => !drawn.has(role))
  if (missing.length) notes.push(`Not in this view or not yet available: ${missing.join(', ')}.`)
  return notes
}

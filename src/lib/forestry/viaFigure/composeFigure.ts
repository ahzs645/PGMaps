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
import {
  ALTERATION_RULES,
  alteration,
  type Alteration,
  type AlterationDeduction,
  type AlterationRule,
} from './alteration'
import { cameraInfoLines, type CameraInfo } from './cameraInfo'
import {
  legendEntries,
  VQO_ZONE_ROLES,
  type BlockPaint,
  type CalloutStyle,
  type LegendStyle,
  type TextStyle,
  type ViaRole,
  type CalcDenominatorKey,
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
  // 10 and 11 are an engine's own (`ENGINE_CLASS`, engineCapture.ts).
  /**
   * A partial-cut block: drawn as a block, but not cleared ground (handbook 3.4.4). Its pixels are counted apart from
   * `proposedIn`, as the run leaves the block out of the cleared-ground ledger and adds its Table 6 figure to X.
   */
  partialIn: 12,
  partialOut: 13,
} as const
export type FigureClass = keyof typeof FIGURE_CLASS
/** The partial-cut classes, which only a scene with a partial cut paints (`classPaletteEntries`). */
export const PARTIAL_CUT_CLASSES = ['partialIn', 'partialOut'] as const satisfies readonly FigureClass[]

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
  // At least 70 from every colour above, the engine's two and black, and from every blend between any two of them.
  partialIn: [255, 0, 150],
  partialOut: [105, 255, 30],
}

/**
 * The decode palette of a class pass: every class colour, the partial-cut ones only when the pass painted a partial
 * cut. Leaving them out otherwise keeps a scene with no partial cut decoding exactly as before they existed (a blended
 * edge pixel's nearest colour cannot become one).
 */
export function classPaletteEntries(partialCuts = false): Array<{ code: number; rgb: readonly number[] }> {
  return (Object.entries(CLASS_PALETTE) as Array<[Exclude<FigureClass, 'sky'>, readonly number[]]>)
    .filter(([name]) => partialCuts || !(PARTIAL_CUT_CLASSES as readonly string[]).includes(name))
    .map(([name, rgb]) => ({ code: FIGURE_CLASS[name], rgb }))
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
  palette: ReadonlyArray<{ code: number; rgb: readonly number[] }> = classPaletteEntries(),
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
  FIGURE_CLASS.partialIn,
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
  /** Proposed blocks in the landform, cleared ground only: a partial cut is `partialCut`, never here. */
  proposed: number
  /**
   * Partial-cut blocks in the landform (handbook 3.4.4): not cleared ground, so in no figure's numerator; the run adds
   * each visible cut's Table 6 clearcut equivalent to X instead. Present only when the pass shows one.
   */
  partialCut?: number
  /** VRI non-vegetated land in the landform, not under a block, opening or private land. */
  rock: number
  /** (NonVEG + Proposed) / LF, percent. */
  grossPercent: number | null
  /** (NonVEG + Proposed) / (LF − PL), percent. */
  netOfPrivatePercent: number | null
  /** (NonVEG + Proposed) / (LF − rock), percent. */
  netOfRockPercent: number | null
}

/**
 * Counts by raster: a class raster is never changed once built, and the export dialog asks for the same pictures'
 * counts on every render (about 2 s a report build before this).
 */
const countsByRaster = new WeakMap<ClassRaster, FigureCounts>()

export function countClasses(raster: ClassRaster): FigureCounts {
  const kept = countsByRaster.get(raster)
  if (kept) return kept
  const counts = tallyClasses(raster)
  countsByRaster.set(raster, counts)
  return counts
}

function tallyClasses(raster: ClassRaster): FigureCounts {
  let landform = 0,
    privateLand = 0,
    nonVeg = 0,
    proposed = 0,
    rock = 0,
    partialCut = 0
  for (const code of raster.codes) {
    if (!IN_LANDFORM.has(code)) continue
    landform++
    if (code === FIGURE_CLASS.privateIn) privateLand++
    else if (code === FIGURE_CLASS.existingIn) nonVeg++
    else if (code === FIGURE_CLASS.proposedIn) proposed++
    else if (code === FIGURE_CLASS.rock) rock++
    else if (code === FIGURE_CLASS.partialIn) partialCut++
  }
  const altered = nonVeg + proposed
  const share = (denominator: number) => (denominator > 0 ? (100 * altered) / denominator : null)
  return {
    landform,
    privateLand,
    nonVeg,
    proposed,
    rock,
    ...(partialCut ? { partialCut } : {}),
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
  // A partial cut is outlined as the block it is; only its count is kept apart.
  proposedBlock: [FIGURE_CLASS.proposedIn, FIGURE_CLASS.proposedOut, FIGURE_CLASS.partialIn, FIGURE_CLASS.partialOut],
  treatedGround: [FIGURE_CLASS.proposedIn, FIGURE_CLASS.proposedOut, FIGURE_CLASS.partialIn, FIGURE_CLASS.partialOut],
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
    const parts = maskRings(
      raster,
      (code) => set.has(code),
      role === 'landform' ? LANDFORM_MIN_RING_AREA_PX : MIN_RING_AREA_PX,
    )
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

/** Specks smaller than this, px², are dropped from a landform's traced outline: noise along its edge, not ground. */
export const LANDFORM_MIN_RING_AREA_PX = 40

/**
 * Where a landform's name goes on its class pass: the landform pixel deepest inside its visible ground (a chamfer
 * distance to the nearest pixel outside it, horizontal steps counted at half weight because a name is wider than tall),
 * the nearest to the centroid among equals. Only `rows` are searched when given (the rows a sheet keeps, so the
 * name is not placed where the crop cuts it away), falling back to every row when the landform has none there. Null
 * when no landform pixel is visible.
 */
export function landformLabelPoint(raster: ClassRaster, rows?: { y: number; height: number } | null): Point | null {
  const { width, height, codes } = raster
  const inside = (k: number) => IN_LANDFORM.has(codes[k])
  const y0 = rows ? Math.max(0, rows.y) : 0,
    y1 = rows ? Math.min(height, rows.y + rows.height) : height
  let any = false
  for (let k = y0 * width; k < y1 * width && !any; k++) any = inside(k)
  if (!any) return rows ? landformLabelPoint(raster) : null
  // Two-pass chamfer distance, in half-pixel units: 1 a column, 2 a row, 2 a diagonal (rounded), inside the band.
  const h = y1 - y0
  const BIG = 0xffff
  const d = new Uint16Array(width * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < width; x++) d[y * width + x] = inside((y + y0) * width + x) ? BIG : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= h ? 0 : d[y * width + x])
  for (let y = 0; y < h; y++)
    for (let x = 0; x < width; x++) {
      const k = y * width + x
      if (!d[k]) continue
      d[k] = Math.min(d[k], at(x - 1, y) + 1, at(x, y - 1) + 2, at(x - 1, y - 1) + 2, at(x + 1, y - 1) + 2)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const k = y * width + x
      if (!d[k]) continue
      d[k] = Math.min(d[k], at(x + 1, y) + 1, at(x, y + 1) + 2, at(x + 1, y + 1) + 2, at(x - 1, y + 1) + 2)
    }
  let sx = 0,
    sy = 0,
    n = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < width; x++)
      if (d[y * width + x]) {
        sx += x
        sy += y
        n++
      }
  const cx = sx / n,
    cy = sy / n
  let best = -1,
    bestDistance = Infinity,
    bx = 0,
    by = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < width; x++) {
      const v = d[y * width + x]
      if (v < best || !v) continue
      const toCentroid = (x - cx) ** 2 + (y - cy) ** 2
      if (v > best || toCentroid < bestDistance) {
        best = v
        bestDistance = toCentroid
        bx = x
        by = y
      }
    }
  return [bx + 0.5, by + y0 + 0.5]
}

/**
 * Another landform's outline as a sheet draws it (`LandformColumn.outline`), traced from its own class pass as the
 * landform's is (`maskRings` over the landform classes, specks under `LANDFORM_MIN_RING_AREA_PX` dropped), with the
 * place for its name (`landformLabelPoint`). Kept with a saved view instead of the pass itself: a few hundred points
 * against a code per pixel.
 */
export function traceLandform(
  raster: ClassRaster,
  rows?: { y: number; height: number } | null,
): { outline: Point[][]; labelAt: Point | null } {
  return {
    outline: maskRings(raster, inLandform, LANDFORM_MIN_RING_AREA_PX),
    labelAt: landformLabelPoint(raster, rows),
  }
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

// ------------------------------------------------------------------ block paint

/** Base colours when painting is asked of a style whose reference does not paint (or a style's paint gives no regrowth). */
export const DEFAULT_BLOCK_PAINT: Required<Omit<BlockPaint, 'privateLand'>> = {
  proposed: '#a78872',
  existing: '#8f9a86',
  spec: "Fresh cut: the lit quarter of 03 p1's cut ground (Lakeview, median #a78872); regrowth: 23 p15's NonV.E.G. grey-green (#777e70) lightened for a view without its haze",
}

/** Shading kept from the picture: luminance relative to the painted area's mean, to this power, within these bounds. */
const PAINT_SHADE = { power: 0.6, min: 0.6, max: 1.45 }
/** Texture amplitude about the base colour: fresh cut, regrowth. */
const PAINT_TEXTURE = { proposed: 0.3, existing: 0.14 }

/** A hash of a lattice point to [0, 1): deterministic, no state. */
function hash01(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Value noise on a lattice `cellX` × `cellY` pixels, smoothly interpolated between lattice hashes, in [0, 1). */
function valueNoise(x: number, y: number, cellX: number, cellY: number, seed: number): number {
  const fx = x / cellX,
    fy = y / cellY
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy)
  const tx = fx - x0,
    ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx),
    sy = ty * ty * (3 - 2 * ty)
  const a = hash01(x0, y0, seed),
    b = hash01(x0 + 1, y0, seed),
    c = hash01(x0, y0 + 1, seed),
    d = hash01(x0 + 1, y0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

const PROPOSED_CODES = new Set<number>([FIGURE_CLASS.proposedIn, FIGURE_CLASS.proposedOut])
const EXISTING_CODES = new Set<number>([FIGURE_CLASS.existingIn, FIGURE_CLASS.existingOut])
const PRIVATE_CODES = new Set<number>([FIGURE_CLASS.privateIn, FIGURE_CLASS.privateOut])

/**
 * The picture with each block's visible ground painted as harvested ground, as the reference simulations render it:
 * proposed blocks (inside or outside the landform) in `paint.proposed`, existing openings still counting in
 * `paint.existing` when given (a lighter, quieter regrowth). Each painted pixel is the base colour times the picture's
 * own shading (its luminance, a 3 × 3 mean, over the painted class's mean, so a sunlit face stays lighter than a
 * shaded one) times a multi-scale cut texture (patches, clumps, single-pixel speckle and light slash flecks) seeded by
 * the pixel's position, so the same view always paints the same. The boundary pixels of each painted area are blended
 * half and half with the picture, a 1-pixel soft edge; nothing outside the classes changes.
 *
 * Private land, when `paint.privateLand` is given, is painted that one colour with the picture's shading and no
 * texture, as the references burn their de-vegetated private land into the render.
 *
 * `classes` is the class pass of the same camera and size. When it is a ground pass (an engine's, no trees),
 * `screened` is the pass with the trees in front: a pixel is painted only where that pass shows the same kind,
 * so a tree standing in front of a block is never painted over. A size mismatch paints nothing.
 */
export function paintBlockGround(
  image: { data: ArrayLike<number>; width: number; height: number },
  classes: ClassRaster,
  paint: Pick<BlockPaint, 'proposed' | 'existing' | 'privateLand'>,
  options: { screened?: ClassRaster | null; seed?: number } = {},
): Uint8ClampedArray {
  const { width: w, height: h } = image
  const out = new Uint8ClampedArray(image.data)
  const screened = options.screened ?? null
  if (classes.width !== w || classes.height !== h) return out
  if (screened && (screened.width !== w || screened.height !== h)) return out
  const seed = options.seed ?? 0x5eed
  const n = w * h
  // 1 proposed, 2 existing, 3 private land, 0 left as captured.
  const kind = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    const code = classes.codes[k]
    const set = PROPOSED_CODES.has(code)
      ? PROPOSED_CODES
      : paint.existing && EXISTING_CODES.has(code)
        ? EXISTING_CODES
        : paint.privateLand && PRIVATE_CODES.has(code)
          ? PRIVATE_CODES
          : null
    if (!set) continue
    if (screened && !set.has(screened.codes[k])) continue
    kind[k] = set === PROPOSED_CODES ? 1 : set === EXISTING_CODES ? 2 : 3
  }
  const luma = (o: number) => 0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2]
  // The picture's shading, a 3 × 3 mean so single bright or dark pixels (a stem, a crown) do not print as dots.
  const shade = new Float32Array(n)
  const sum = [0, 0, 0, 0],
    count = [0, 0, 0, 0]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (!kind[k]) continue
      let s = 0,
        m = 0
      for (let j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1); j++)
        for (let i = Math.max(0, x - 1); i <= Math.min(w - 1, x + 1); i++) {
          s += luma((j * w + i) * 4)
          m++
        }
      shade[k] = s / m
      sum[kind[k]] += shade[k]
      count[kind[k]]++
    }
  const mean = sum.map((total, i) => total / (count[i] || 1))
  const bases = [
    null,
    hexRgb(paint.proposed),
    paint.existing ? hexRgb(paint.existing) : null,
    paint.privateLand ? hexRgb(paint.privateLand) : null,
  ]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      const kd = kind[k]
      if (!kd) continue
      const base = bases[kd]!
      const relative = mean[kd] > 0 ? shade[k] / mean[kd] : 1
      const lit = Math.min(PAINT_SHADE.max, Math.max(PAINT_SHADE.min, relative ** PAINT_SHADE.power))
      const o = k * 4
      // A 1-pixel soft edge: a boundary pixel is half picture, half paint.
      const edge =
        (x > 0 && kind[k - 1] !== kd) ||
        (x < w - 1 && kind[k + 1] !== kd) ||
        (y > 0 && kind[k - w] !== kd) ||
        (y < h - 1 && kind[k + w] !== kd)
      const a = edge ? 0.5 : 1
      if (kd === 3) {
        // Private land: one flat colour, shaded, no texture.
        for (let c = 0; c < 3; c++) out[o + c] = image.data[o + c] * (1 - a) + base[c] * lit * a
        continue
      }
      // Cut texture, as the reference renders read: broad patches, lumps of slash wider than tall (lying across
      // the slope) with dark gaps between them, and a little per-pixel grain.
      // Two sheared lattices, so no grid lines show.
      const patches = valueNoise(x + 0.21 * y, y, 16, 10, seed)
      const lumps =
        0.6 * valueNoise(x + 0.37 * y, y, 5, 2.6, seed + 1) +
        0.4 * valueNoise(x - 0.29 * y + 101, y + 57, 3.2, 1.8, seed + 4)
      const grain = hash01(x, y, seed + 2)
      const v = 0.3 * patches + 0.55 * lumps + 0.15 * grain - 0.5
      const amplitude = kd === 1 ? PAINT_TEXTURE.proposed : PAINT_TEXTURE.existing
      let t = 1 + 2 * amplitude * v
      if (kd === 1) {
        // Shadowed gaps between lumps and lit lump tops, both eased in, then sparse flecks of bleached wood.
        t *= 0.86 + 0.14 * smoothstep(0.2, 0.4, lumps)
        t *= 1 + 0.1 * smoothstep(0.6, 0.75, lumps)
        const fleck = hash01(x >> 1, y, seed + 3)
        if (fleck > 0.955) t *= 1.16
      }
      // Lit lump tops read warmer and pinker, the gaps and damp patches greyer.
      const warm = (0.6 * (lumps - 0.5) + 0.4 * (patches - 0.5)) * 0.14
      const painted = [base[0] * lit * t * (1 + warm), base[1] * lit * t, base[2] * lit * t * (1 - warm)]
      for (let c = 0; c < 3; c++) out[o + c] = image.data[o + c] * (1 - a) + painted[c] * a
    }
  return out
}

/** Whether a figure paints block ground: the reviewer's choice, else the preset's own. */
export const paintsBlocks = (input: Pick<FigureInput, 'preset' | 'paintBlocks'>) =>
  input.paintBlocks ?? !!input.preset.paint

/** Whether the figure paints private land into its picture (`BlockPaint.privateLand`) rather than drawing its symbol. */
export const paintsPrivateLand = (input: FigureInput) =>
  paintsBlocks(input) && input.image.kind === 'rgba' && !!input.classes && !!input.preset.paint?.privateLand

/**
 * The frame as the figure prints it: block ground painted when the figure paints (an RGBA frame with a class pass
 * only), then toned. An encoded frame cannot be painted; the page decodes it when painting is on.
 */
export function figureImage(input: FigureInput): RasterImage {
  let image = input.image
  if (paintsBlocks(input) && image.kind === 'rgba' && input.classes) {
    const paint = input.preset.paint ?? DEFAULT_BLOCK_PAINT
    image = {
      ...image,
      // A tree in front is never painted over: the engine's screened pass, else PGMaps' with-timber pass.
      data: paintBlockGround(image, input.classes, paint, {
        screened: input.screenedClasses ?? (input.timber && 'classes' in input.timber ? input.timber.classes : null),
      }),
    }
  }
  return tonedImage(image, input.preset.tone)
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
  /** Which callouts give way first when the row has no room for them all: lowest first (the share seen). */
  priority?: number
}

/**
 * Secondary callouts for the existing openings a picture shows, from its class pass: one per opening (4-connected
 * existing-opening pixels, inside the landform or out) covering at least `minShare` of the picture, the largest
 * `max`, each pointing at the opening's pixel nearest its centroid, so the arrow lands on the opening even when it is
 * crescent-shaped. For styles that point existing openings out rather than outline them (`labels.existing`).
 */
export function existingOpeningCallouts(
  raster: ClassRaster,
  title: string,
  minShare: number,
  max: number,
): FigureCallout[] {
  const { width, height, codes } = raster
  const isOpening = (code: number) => code === FIGURE_CLASS.existingIn || code === FIGURE_CLASS.existingOut
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const minPixels = Math.max(1, minShare * width * height)
  const found: Array<{ pixels: number[]; cx: number; cy: number }> = []
  for (let start = 0; start < codes.length; start++) {
    if (seen[start] || !isOpening(codes[start])) continue
    const pixels: number[] = []
    let sx = 0,
      sy = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      pixels.push(i)
      const x = i % width,
        y = (i - x) / width
      sx += x + 0.5
      sy += y + 0.5
      const next = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ]
      for (const j of next)
        if (j >= 0 && !seen[j] && isOpening(codes[j])) {
          seen[j] = 1
          stack.push(j)
        }
    }
    if (pixels.length >= minPixels) found.push({ pixels, cx: sx / pixels.length, cy: sy / pixels.length })
  }
  return found
    .sort((a, b) => b.pixels.length - a.pixels.length)
    .slice(0, Math.max(0, max))
    .map(({ pixels, cx, cy }) => {
      let best = pixels[0],
        bestD = Infinity
      for (const i of pixels) {
        const x = (i % width) + 0.5,
          y = Math.floor(i / width) + 0.5
        const d = (x - cx) ** 2 + (y - cy) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return {
        title,
        anchor: [(best % width) + 0.5, Math.floor(best / width) + 0.5] as Point,
        secondary: true,
        priority: pixels.length,
      }
    })
}

/**
 * The callouts a figure labels: the page's, and when the style points existing openings out (`labels.existing`) and
 * the page sent none, the openings the class pass shows.
 */
export function figureLabelCallouts(input: Pick<FigureInput, 'preset' | 'classes' | 'callouts'>) {
  const spec = input.preset.labels?.existing
  if (!spec || !input.classes || input.callouts.some((callout) => callout.secondary)) return input.callouts
  return [...input.callouts, ...existingOpeningCallouts(input.classes, spec.title, spec.minShare, spec.max)]
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
  /**
   * When `classes` is a ground pass (an engine's: no trees drawn), the same camera's pass with the drawn trees in
   * front, for a second, screened pixel measure. Never drawn or outlined.
   */
  screenedClasses?: ClassRaster | null
  /**
   * PGMaps' own renderer's with-timber pass (`timberScreenedClasses`, `timberScreen.ts`): the class pass with every
   * proposed pixel that does not change between the before-harvest render and this picture given to the ground in
   * front, `classes`' size. `absent` says why there is none ("not measured", never 0). Absent for an engine's
   * capture, whose `screenedClasses` measures the same thing. Never drawn or outlined.
   */
  timber?: { classes: ClassRaster } | { absent: string } | null
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
  /**
   * Paint the blocks' visible ground as harvested ground (`paintBlockGround`); the preset's own choice (`paint`) when
   * absent. Needs an RGBA frame and a class pass.
   */
  paintBlocks?: boolean
  /**
   * Reads a printed percent as a class for `{class}` in a calculation line (Table 2 from the page); without it such a
   * line is left out rather than printed with braces.
   */
  classify?: ((percent: number) => ClassReading | null) | null
  /**
   * The arithmetic the calculation and PGMaps' pixel figures print, when it is not the style's own (`calc.rule`): a
   * report's format rule, so the sheet prints what the report's tables print, or the scene's net denominator
   * (`sceneSheetRule`). Its unit, decimals and rounding are the sheet's; the lines name what it takes out.
   */
  rule?: AlterationRule | null
  /**
   * The scene's partial-cut blocks, with the Table 6 figure the run adds to X for each (`partialCutEntries`, via.ts).
   * Their pixels are `FigureCounts.partialCut`, never proposed alteration; the sheet states both. Absent or empty: no
   * partial cut, and the sheet prints exactly as before.
   */
  partialCuts?: readonly PartialCutNote[] | null
  /**
   * The other landforms the view sees (sub-landforms, or the whole landform beside an active sub-landform), each
   * counted on a class pass of the same frames split at it. The analysis sheet prints a calculation column for each
   * that shows alteration, beside the one `classes` is split at, and names the rest once. Absent or empty: one
   * column, exactly as before.
   */
  landforms?: readonly LandformColumn[] | null
  /** The page's sightline alteration at this station, percent: the assessment's figure. */
  sightlinePercent: number | null
  /**
   * Printed in place of the sightline figure when the run's figures were not the assessment's at the save ("Withheld —
   * …", or that readiness was not recorded): `capturedSightline`. Absent: the figure stands, or there is none.
   */
  sightlineWithheld?: string | null
  /** Its Table 2 class name, if any. */
  sightlineClass?: string | null
  /**
   * Who drew the picture and its pixel measure, when another engine did: printed with the measures. Absent for
   * PGMaps' own map.
   */
  illustration?: readonly string[] | null
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
  /** The user's logo (or their brand's) for the title block's logo slot; absent leaves the slot empty. */
  logo?: RasterImage | null
  generatedAt: Date
}

/** Another landform the view sees, counted on its own class pass of the same frames (`SavedFigure.landforms`). */
export interface LandformColumn {
  /** Its name as the scene gives it ("Landform 1b (consultant, traced)"). */
  name: string
  counts: FigureCounts
  /**
   * Its visible outline in image pixels, traced from its own class pass (`traceLandform`), drawn in the style's
   * `otherLandform` symbol; absent draws nothing.
   */
  outline?: readonly Point[][] | null
  /** Where its name goes on the picture, image pixels (`landformLabelPoint`); absent or null prints no name. */
  labelAt?: Point | null
}

/** A partial-cut block as the sheet states it: handbook 3.4.4's Table 6 reading, not cleared ground. */
export interface PartialCutNote {
  name: string
  /** Whether the run sees ground where the cut occurs; one it cannot see adds nothing to X. */
  visible: boolean
  /** Table 6's clearcut-equivalent percent, or null until volume removed and residual height are entered. */
  equivalentPercent: number | null
  volumeRemovedPercent: number | null
  residualHeightMeters: number | null
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
const NOTE: TextStyle = { size: 7, color: '#595959' }
const OWN: TextStyle = { size: 9, color: '#1d4ed8' }

const fixed = (value: number | null, digits = 2) =>
  value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits)

/**
 * What a figure file says of itself in its document properties (`FigureSheetPanel`'s PDF), never on its face: the
 * style it is drawn in and the day it was made.
 */
export const figureSubject = (preset: ViaStylePreset, at: Date) =>
  `Figure in the "${preset.name}" style, generated ${at.toISOString().slice(0, 10)}`

/** The alteration a class pass gives under `rule`: the counts as the rule's areas. */
export function countsAlteration(rule: AlterationRule, counts: FigureCounts | null): Alteration | null {
  if (!counts) return null
  return alteration(rule, {
    landform: counts.landform,
    proposed: counts.proposed,
    nonVeg: counts.nonVeg,
    privateLand: counts.privateLand,
    rock: counts.rock,
    // Stated, never summed: a partial cut is not cleared ground (`AlterationAreas.partialCut`).
    ...(counts.partialCut ? { partialCut: counts.partialCut } : {}),
  })
}

/** The rule a preset's calculation prints: its own, else (no calculation box) the gross landform. */
export const presetRule = (preset: ViaStylePreset): AlterationRule => preset.calc?.rule ?? ALTERATION_RULES.grossPixels

/** The rule a figure prints: the one it was handed (`FigureInput.rule`), else its style's. */
export const figureRule = (input: Pick<FigureInput, 'preset' | 'rule'>): AlterationRule =>
  input.rule ?? presetRule(input.preset)

const DEDUCTED_WORDS: Record<AlterationDeduction, string> = { rock: 'Rock', privateLand: 'Private Land' }
const sameDeductions = (a: AlterationRule, b: AlterationRule) =>
  a.deduct.length === b.deduct.length && a.deduct.every((d) => b.deduct.includes(d))

/** The key a style's short name for a denominator is kept under (`CalcBlockStyle.denominatorNames`): what the rule removes. */
export const denominatorKey = (rule: Pick<AlterationRule, 'deduct'>): CalcDenominatorKey => {
  const ordered = (['privateLand', 'rock'] as const).filter((d) => rule.deduct.includes(d))
  return ordered.length ? (ordered.join('+') as CalcDenominatorKey) : 'gross'
}

/**
 * The words for the denominator a rule divides by: the style's short name for that rule's deductions
 * (`calc.denominatorNames`), else the style's own words while the rule is the style's, else "Net" and the style's
 * word for the landform when the rule deducts (the lines above it say what), the plain word when it deducts nothing.
 */
function denominatorLabel(preset: ViaStylePreset, rule: AlterationRule): string {
  const calc = preset.calc
  const own = presetRule(preset)
  const short = calc?.denominatorNames?.[denominatorKey(rule)]
  if (short) return short
  if (sameDeductions(rule, own) && calc?.denominator) return calc.denominator
  const gross = own.deduct.length ? 'Landform' : (calc?.denominator ?? 'Landform')
  return rule.deduct.length ? `Net ${gross}` : gross
}

/**
 * The calculation's values under the figure's rule, with the words for what it takes out: `{deductedName}` and
 * `{netLandformPx}` only when it takes something out (so a gross sheet leaves those lines out),
 * `{privateDeductedPx}` and `{rockDeductedPx}` only when the rule takes that ground out, and `{denominatorName}`
 * (`denominatorLabel`).
 */
function calcLineValues(input: FigureInput, counts: FigureCounts | null, n: string | undefined, rule: AlterationRule) {
  const own = presetRule(input.preset)
  const calc = input.preset.calc
  const same = sameDeductions(rule, own)
  const ordered = (['rock', 'privateLand'] as const).filter((d) => rule.deduct.includes(d))
  const words = ordered.map((d) => DEDUCTED_WORDS[d]).join(' and ')
  const values = calcValues(counts, n, rule, input.classify)
  return {
    ...values,
    ...(ordered.length && counts
      ? { deductedName: same && calc?.deducted ? calc.deducted : words, netLandformPx: values.netPx }
      : {}),
    ...(counts && rule.deduct.includes('privateLand') ? { privateDeductedPx: counts.privateLand } : {}),
    ...(counts && rule.deduct.includes('rock') ? { rockDeductedPx: counts.rock } : {}),
    denominatorName: denominatorLabel(input.preset, rule),
    ...(input.distanceKm != null ? { distanceKm: input.distanceKm.toFixed(1) } : {}),
    ...(input.hfovDeg != null ? { hfov: Math.round(input.hfovDeg) } : {}),
  }
}

/** One printed line of a calculation box: `bold` where its template starts with `**`, `boldStart` opening a bold run. */
export interface CalcRow {
  text: string
  bold: boolean
  boldStart: boolean
}

/**
 * A figure's calculation, resolved once: the rule it prints (`figureRule`), the words for that rule's denominator,
 * the box's lines filled under it, and its total. The box's rows, every column of a multi-landform box and the pixel
 * figure all read this, so the formula's words, the rows and the number cannot disagree. A line whose fields the
 * view or the rule cannot fill is left out rather than printed with braces.
 */
export interface ResolvedCalc {
  rule: AlterationRule
  denominatorLabel: string
  rows: CalcRow[]
  /** The total as printed (the rule's decimals and rounding); null without counts or with an empty denominator. */
  totalPct: string | null
  /** The total unrounded, as the pixel figure prints it. */
  percent: number | null
}

export function resolveCalc(
  input: FigureInput,
  counts: FigureCounts | null,
  n: string | undefined = input.titles.n,
): ResolvedCalc {
  const rule = figureRule(input)
  const result = countsAlteration(rule, counts)
  const calc = input.preset.calc
  const rows: CalcRow[] = []
  if (calc) {
    const values = calcLineValues(input, counts, n, rule)
    let previousBold = false
    for (const template of calc.lines) {
      const bold = template.startsWith('**')
      const text = fillTemplate(bold ? template.slice(2) : template, values)
      if (/\{\w+\}/.test(text)) continue
      rows.push({ text, bold, boldStart: bold && !previousBold })
      previousBold = bold
    }
  }
  return {
    rule,
    denominatorLabel: denominatorLabel(input.preset, rule),
    rows,
    totalPct: result?.printed ?? null,
    percent: result?.percent ?? null,
  }
}

/** A class reading for a printed percent: Table 2 by default, supplied by the page (`FigureInput.classify`). */
export type ClassReading = { code: string; name: string }

/** The values a preset's calculation lines are filled from, all from the preset's rule. */
export function calcValues(
  counts: FigureCounts | null,
  n = '1',
  rule: AlterationRule = ALTERATION_RULES.grossPixels,
  classify?: ((percent: number) => ClassReading | null) | null,
): Record<string, string | number> {
  if (!counts) return { n }
  const result = countsAlteration(rule, counts)
  const part = (name: 'nonVeg' | 'proposed') => {
    const found = result?.parts.find((p) => p.part === name)
    if (found) return found.printed
    // A part the rule leaves out of the sum still prints its share of the landform.
    return fixed(counts.landform ? (100 * counts[name]) / counts.landform : null, rule.decimals)
  }
  const net = result?.denominator ?? counts.landform
  const reading = result && classify ? classify(result.printedValue) : null
  return {
    n,
    landformPx: counts.landform,
    privatePx: counts.privateLand,
    nonVegPx: counts.nonVeg,
    proposedPx: counts.proposed,
    rockPx: counts.rock,
    deductedPx: counts.landform - net,
    netPx: net,
    nonVegPct: part('nonVeg'),
    proposedPct: part('proposed'),
    ...(result ? { totalPct: result.printed } : {}),
    ...(reading ? { class: reading.name, classCode: reading.code } : {}),
    basis: rule.basis,
    landformArea: `${counts.landform} px`,
    proposedArea: `${counts.proposed} px`,
    nonVegArea: `${counts.nonVeg} px`,
    rockArea: `${counts.rock} px`,
    netArea: `${net} px`,
    alterationArea: `${counts.proposed + counts.nonVeg} px`,
  }
}

/** The alteration a preset's calculation prints, unrounded: its rule over the class pass. */
export function presetPercent(preset: ViaStylePreset, counts: FigureCounts | null): number | null {
  return countsAlteration(presetRule(preset), counts)?.percent ?? null
}

/** The alteration a figure prints, unrounded: its rule (`figureRule`) over the class pass. */
export function figurePercent(input: Pick<FigureInput, 'preset' | 'rule'>, counts: FigureCounts | null): number | null {
  return countsAlteration(figureRule(input), counts)?.percent ?? null
}

/** The image, its outlines, labels and callouts in `frame`. Shared by every sheet form. */
function figurePanel(input: FigureInput, frame: Frame, calloutArea?: Box) {
  const { preset } = input
  const shown = figureImage(input)
  const ops: DrawOp[] = [{ op: 'image', ...frame, image: shown }]
  // Private land painted into the picture takes no symbol over it; its legend row still stands.
  const paintedPrivate = paintsPrivateLand(input)
  const roles = input.classes ? roleOverlays(preset, input.classes) : []
  const others = otherLandformOverlays(input)
  const overlays = [
    ...(input.zones ? zoneOverlays(preset, input.zones) : []),
    // Under the landform's own line, so a shared edge reads as the landform's, and under the blocks.
    ...others,
    ...roles.filter((overlay) => !(paintedPrivate && overlay.role === 'privateLand')),
    ...(input.lines ?? []),
  ]
  const { ops: drawnOps, drawn } = overlayOps(preset, overlays, frame)
  if (paintedPrivate && roles.some((overlay) => overlay.role === 'privateLand')) drawn.add('privateLand')
  ops.push(...drawnOps)
  const centroid = input.classes ? landformCentroid(input.classes) : null
  const label = preset.labels?.landform
  // The page boxes the landform's own name and rating take, which the other landforms' names keep clear of.
  const primaryBoxes: Box[] = []
  const primaryName = label ? fillTemplate(label.template, { n: input.titles.n ?? '1' }) : null
  if (centroid && label && primaryName) {
    const [x, y] = toPage(frame)(centroid)
    ops.push(...textOps(x, y, primaryName, label, 'center'))
    primaryBoxes.push(textBox(x, y, primaryName, label))
    const rating = preset.labels?.rating
    if (rating && input.rating)
      rating.lines.forEach((line, i) => {
        const text = fillTemplate(line, input.rating ?? {})
        if (/\{\w+\}/.test(text)) return
        ops.push(...textOps(x, y + (i + 1) * lineHeight(rating), text, rating, 'center'))
        primaryBoxes.push(textBox(x, y + (i + 1) * lineHeight(rating), text, rating))
      })
  }
  // Labels read the brightness of the picture as printed: the painted frame, when it was painted.
  const printed = shown.kind === 'rgba' && paintsBlocks(input) ? { ...input, image: shown, luminance: null } : input
  const callouts = figureLabelCallouts(input)
  const placedLabels = callouts.length
    ? figureLabelOps(
        { ...printed, callouts },
        frame,
        calloutArea ?? { x: frame.x + 4, y: frame.y + 4, w: frame.w - 8, h: frame.h - 8 },
      )
    : { ops: [], key: [], boxes: [] }
  // The other landforms' names, on their own ground, clear of the landform's name and the callouts; under them.
  if (label && others.length)
    ops.push(...otherLandformNameOps(input, frame, label, primaryName, [...primaryBoxes, ...placedLabels.boxes]))
  ops.push(...placedLabels.ops)
  if ((input.cameraInfo ?? preset.cameraInfo ?? false) && input.camera) ops.push(...cameraInfoOps(input.camera, frame))
  ops.push(rectStroke(frame, { color: '#bfbfbf', width: 0.4 }))
  return { ops, drawn, key: placedLabels.key }
}

/** The page box one centred line of text takes, its baseline at `y`. */
const textBox = (x: number, y: number, text: string, style: SheetTextStyle): Box => {
  const w = textWidth(text, style.size, style.style ?? 'normal')
  return { x: x - w / 2, y: y - style.size * 0.92, w, h: lineHeight(style) }
}

/**
 * The other landforms' outlines (`FigureInput.landforms`, each traced from its own class pass) in the style's
 * `otherLandform` symbol, as 23 A6 draws its sub-landforms beside Landform 1. None when the style has no such symbol
 * or no landform carries an outline: a sheet of one landform draws exactly as before.
 */
export function otherLandformOverlays(input: Pick<FigureInput, 'preset' | 'landforms'>): Overlay[] {
  if (!input.preset.symbols.otherLandform) return []
  const parts = (input.landforms ?? []).flatMap((entry) => (entry.outline ?? []).map((ring) => [...ring]))
  return parts.length ? [{ role: 'otherLandform', parts }] : []
}

/**
 * Each other landform's name ("Landform 1b", the style's landform label) on its own ground at `labelAt`, through
 * `labelOps` as an `inside` label: nudged clear of `avoid` (the landform's own name, the callouts) and of each
 * other, and left out when it finds no clear place nearby, reads the same as the landform's own name, or names the
 * whole landform beside its own sub-landforms.
 */
function otherLandformNameOps(
  input: FigureInput,
  frame: Frame,
  style: TextStyle & { template: string },
  primaryName: string | null,
  avoid: readonly Box[],
): DrawOp[] {
  const P = toPage(frame)
  const text: SheetTextStyle = {
    size: style.size,
    color: style.color,
    ...(style.style ? { style: style.style } : {}),
    ...(style.halo ? { halo: style.halo } : {}),
  }
  // The whole landform beside its own sub-landforms is outlined but not named: its middle is a sub-landform's
  // ground, and 23 A6 names only 1a, 1b and 1c inside Landform 1.
  const numbers = [input.titles.n ?? '1', ...(input.landforms ?? []).map((entry) => landformNumber(entry.name))]
  const labels = (input.landforms ?? []).flatMap((entry) => {
    if (!entry.outline?.length || !entry.labelAt) return []
    const n = landformNumber(entry.name)
    if (/^\d+$/.test(n) && numbers.some((other) => new RegExp(`^${n}[a-z]$`).test(other))) return []
    const title = fillTemplate(style.template, { n })
    return title === primaryName ? [] : [{ title, anchor: P(entry.labelAt), inside: text }]
  })
  if (!labels.length) return []
  return labelOps(labels, {
    style: 'halo',
    area: { x: frame.x + 2, y: frame.y + 2, w: frame.w - 4, h: frame.h - 4 },
    maxWidth: Math.max(60, frame.w * MAX_LABEL_WIDTH_SHARE),
    avoid,
  }).ops
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

/** The number a landform's name gives it on the sheet ("Landform 8b (traced)" is 8b), else its name. */
export const landformNumber = (name: string) =>
  name.match(/\bLandform\s+(\d+[a-z]?)\b/i)?.[1] ?? (name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name)

/** One calculation column of the sheet: a landform, its number on the sheet and its counts. */
export interface CalcColumn {
  n: string
  name: string
  counts: FigureCounts | null
  /** The landform the class pass (`classes`) is split at: its outlines are drawn and its sightline figure printed. */
  primary: boolean
}

/**
 * The sheet's calculation columns, as 23's sheets set them (A6: Landform 1 (Full), Sub-landform 1a, 1b): the landform
 * the class pass is split at, then each other landform the view sees with alteration in it (`FigureInput.landforms`),
 * ordered by number, the whole landform before its sub-landforms. A landform seen with no alteration takes no column
 * and is named in `unaltered`. One column when the view reads one landform.
 */
export function calcColumns(
  input: Pick<FigureInput, 'landforms' | 'titles'>,
  counts: FigureCounts | null,
): { columns: CalcColumn[]; unaltered: string[] } {
  const primary: CalcColumn = { n: input.titles.n ?? '1', name: input.titles.area, counts, primary: true }
  const others = input.landforms ?? []
  const altered = others.filter((entry) => entry.counts.nonVeg + entry.counts.proposed > 0)
  const unaltered = others
    .filter((entry) => !altered.includes(entry))
    .map((entry) => entry.name.replace(/\s*\([^)]*\)\s*$/, '').trim() || entry.name)
  if (!altered.length) return { columns: [primary], unaltered }
  const columns = [
    primary,
    ...altered.map((entry) => ({
      n: landformNumber(entry.name),
      name: entry.name,
      counts: entry.counts,
      primary: false,
    })),
  ].sort((a, b) => a.n.localeCompare(b.n, undefined, { numeric: true }))
  // The whole landform beside its own sub-landforms is "1 (Full)", as 23 prints it.
  return {
    columns: columns.map((column) =>
      /^\d+$/.test(column.n) && columns.some((other) => new RegExp(`^${column.n}[a-z]$`).test(other.n))
        ? { ...column, n: `${column.n} (Full)` }
        : column,
    ),
    unaltered,
  }
}

/** The calculation lines, bold where a line starts with `**`, then PGMaps' own figures beside them. */
function calcOps(input: FigureInput, counts: FigureCounts | null, x: number, y: number, align: 'left' | 'center') {
  const calc = input.preset.calc
  const ops: DrawOp[] = []
  if (!calc) return { ops, bottom: y }
  if (calc.title.text) {
    ops.push(...textOps(x, y, calc.title.text, calc.title, align))
    y += lineHeight(calc.title) * 1.6
  }
  for (const row of resolveCalc(input, counts).rows) {
    if (row.boldStart) y += 4
    const style = row.bold ? (calc.emphasis ?? calc.line) : calc.line
    ops.push(...textOps(x, y, row.text, style, align))
    y += lineHeight(style)
  }
  return { ops, bottom: y }
}

/**
 * The calculation as columns side by side, one per landform (`calcColumns`), each with the style's own title and
 * lines filled from that landform's counts under the style's rule. Wrapped to the column and scaled down together,
 * never below 60%, so every column prints at one size.
 */
function calcColumnsOps(
  input: FigureInput,
  columns: readonly CalcColumn[],
  box: { x: number; top: number; bottom: number; width: number },
): DrawOp[] {
  const calc = input.preset.calc
  if (!calc) return []
  const GAP = 8
  const width = (box.width - GAP * (columns.length - 1)) / columns.length
  type Row = { text: string; style: TextStyle; title?: boolean; boldStart?: boolean }
  const filled = columns.map((column) => {
    const rows: Row[] = calc.title.text ? [{ text: calc.title.text, style: calc.title, title: true }] : []
    for (const row of resolveCalc(input, column.counts, column.n).rows)
      rows.push({
        text: row.text,
        style: row.bold ? (calc.emphasis ?? calc.line) : calc.line,
        boldStart: row.boldStart,
      })
    return rows
  })
  const layout = (scale: number) =>
    filled.map((rows) =>
      rows.map((row) => {
        const style = { ...row.style, size: row.style.size * scale }
        return { ...row, style, wrapped: wrapText(row.text, style.size, width, style.style ?? 'normal') }
      }),
    )
  const advance = (row: ReturnType<typeof layout>[number][number], scale: number) =>
    (row.boldStart ? 4 * scale : 0) + row.wrapped.length * lineHeight(row.style) * (row.title ? 1.6 : 1)
  const height = (laid: ReturnType<typeof layout>, scale: number) =>
    Math.max(...laid.map((rows) => rows.reduce((sum, row) => sum + advance(row, scale), 0)))
  let scale = 1
  let laid = layout(scale)
  while (height(laid, scale) > box.bottom - box.top && scale > 0.6 + 1e-9) {
    scale = Math.max(0.6, scale - 0.05)
    laid = layout(scale)
  }
  const ops: DrawOp[] = []
  laid.forEach((rows, i) => {
    const x = box.x + i * (width + GAP)
    let y = box.top
    for (const row of rows) {
      if (row.boldStart) y += 4 * scale
      const step = lineHeight(row.style) * (row.title ? 1.6 : 1)
      for (const line of row.wrapped) {
        ops.push(...textOps(x, y, line, row.style, 'left'))
        y += row.title ? lineHeight(row.style) : step
      }
      if (row.title) y += lineHeight(row.style) * 0.6
    }
  })
  return ops
}

/**
 * PGMaps' own renderer's second pixel figure: the proposed blocks seen past the drawn timber, or why it was not
 * measured. Existing openings keep the ground pass's count, and the line says so when there are any.
 */
export function timberLine(input: Pick<FigureInput, 'timber' | 'preset' | 'classes' | 'rule'>): string | null {
  const timber = input.timber
  if (!timber) return null
  if ('absent' in timber) return `Pixel measure, with drawn timber: not measured (${timber.absent})`
  const counts = countClasses(timber.classes)
  const openings = counts.nonVeg > 0 ? ' (existing openings as on the ground)' : ''
  return `Pixel measure, with drawn timber: ${fixed(figurePercent(input, counts))}%${openings}`
}

const trimmed = (value: number) => String(Math.round(value * 10) / 10)

/**
 * What the sheet says about partial cuts: their pixels, left out of the proposed (cleared-ground) count as the run
 * leaves them out of its ledger, and each cut's Table 6 clearcut equivalent, which the run adds to X in step 4 rather
 * than to this figure (handbook 3.4.4, the 2001 forms' partial-cut table). Empty with no partial cut in the scene or
 * the pass.
 */
export function partialCutLines(input: Pick<FigureInput, 'partialCuts'>, counts: FigureCounts | null): string[] {
  const cuts = input.partialCuts ?? []
  const px = counts?.partialCut ?? 0
  if (!cuts.length && !px) return []
  const lines = [
    px
      ? `Partial cut, not cleared ground (handbook 3.4.4): ${px} px of the landform, left out of Proposed Blocks`
      : 'Partial cut, not cleared ground (handbook 3.4.4): none in the landform in this image',
  ]
  // Cuts that read the same are named together: "FP1, FP2: 0.8% each (10% removed, 27.5 m left)".
  const groups = new Map<string, string[]>()
  for (const cut of cuts) {
    const reading =
      cut.equivalentPercent === null
        ? cut.volumeRemovedPercent !== null && cut.volumeRemovedPercent < 10
          ? 'under 10% removed, adds 0'
          : 'volume removed and residual height not entered'
        : `${trimmed(cut.equivalentPercent)}%${cut.visible ? '' : ', not seen by the run: adds 0'} (${trimmed(cut.volumeRemovedPercent ?? 0)}% removed, ${trimmed(cut.residualHeightMeters ?? 0)} m left)`
    groups.set(reading, [...(groups.get(reading) ?? []), cut.name])
  }
  if (groups.size)
    lines.push(
      `Table 6 clearcut equivalent, added to X in step 4, not to this figure: ${[...groups]
        .map(
          ([reading, names]) =>
            `${names.join(', ')} ${names.length > 1 && /^\d/.test(reading) ? reading.replace('%', '% each') : reading}`,
        )
        .join('; ')}`,
    )
  return lines
}

/** How many of `measureLines` are figures (sightline, pixel and, when there is one, the second pixel figure). */
const figureLineCount = (input: FigureInput) => 2 + (input.screenedClasses ? 1 : 0) + (timberLine(input) ? 1 : 0)

/**
 * PGMaps' figures side by side, and what each one is. The class pass is the ground under the trees (no drawn
 * timber, as the reference VIAs outline the ground), so the pixel measure says so when trees were drawn in the
 * picture; an engine's capture adds a second figure with its trees in front.
 */
function measureLines(
  input: FigureInput,
  counts: FigureCounts | null,
  /** With several calculation columns: the landform the sightline and pixel figures are for, and those seen unaltered. */
  landforms?: { primary: string | null; unaltered: readonly string[] },
): string[] {
  const of = landforms?.primary ? `, ${landforms.primary.replace(/\s*\([^)]*\)\s*$/, '').trim()}` : ''
  const pixel = resolveCalc(input, counts).percent
  const ground = input.screenedClasses
    ? ', the ground under the trees'
    : !input.camera
      ? ''
      : input.camera.maxTreeHeightM !== null
        ? ', the ground under the trees'
        : ', bare earth'
  const screened = input.screenedClasses ? figurePercent(input, countClasses(input.screenedClasses)) : null
  return [
    input.sightlinePercent === null && input.sightlineWithheld
      ? `Sightline measure (PGMaps run${of}): ${input.sightlineWithheld}`
      : `Sightline measure (PGMaps run, the assessment figure${of}): ${fixed(input.sightlinePercent)}%${input.sightlineClass ? ` (${input.sightlineClass})` : ''}`,
    `Pixel measure, this image${of}${ground}: ${fixed(pixel)}%`,
    ...(input.screenedClasses ? [`Pixel measure with the drawn trees in front: ${fixed(screened)}%`] : []),
    ...(timberLine(input) ? [timberLine(input)!] : []),
    ...partialCutLines(input, counts),
    ...(input.illustration ?? []),
    ...(landforms?.unaltered.length ? [`Also seen, no alteration in it: ${landforms.unaltered.join(', ')}`] : []),
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
  if (input.logo) {
    // The user's own logo or their brand's, fitted to the slot at its own proportions, right-aligned.
    const scale = Math.min(logo.w / input.logo.width, logo.h / input.logo.height)
    const w = input.logo.width * scale,
      h = input.logo.height * scale
    ops.push({ op: 'image', x: logo.x + logo.w - w, y: logo.y + (logo.h - h) / 2, w, h, image: input.logo })
  }
  // No logo: the slot keeps its place and draws nothing; a printed sheet never stands in for what was not given.
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
    // No unit to show: one line, not a circle of placeholder labels. The page's note says whether the inventory was
    // read and held none, or was not read at all.
    wrapText(input.ratingNote || NO_INVENTORY_UNIT, 7.92, inventory.w - 16).forEach((line, i, all) =>
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
  // The cell's foot, above the footnote when there is one.
  const measureBottom = calcCell.y + calcCell.h - (preset.calc?.footnote ? 12 : 4)
  // A column per landform the view reads with alteration in it (23 A6); one landform keeps the one calculation.
  const { columns, unaltered } = calcColumns(input, counts)
  const multi = columns.length > 1
  if (multi)
    ops.push(
      ...calcColumnsOps(input, columns, {
        x: calcCell.x + 10.8,
        top: calcCell.y + 15.5,
        bottom: measureBottom,
        width: calcCell.w * 0.7 - 18.8,
      }),
    )
  else ops.push(...calcOps(input, counts, calcCell.x + 10.8, calcCell.y + 15.5, 'left').ops)
  // PGMaps' own two figures in the cell's right half (beside the columns, its last 30%), wrapped to it.
  const measureX = calcCell.x + calcCell.w * (multi ? 0.7 : 0.5)
  const measureWidth = calcCell.x + calcCell.w - measureX - 8
  const measureTop = calcCell.y + (multi ? 15.5 : 37)
  ops.push(
    ...fittedLines(
      measureLines(
        input,
        counts,
        multi || unaltered.length ? { primary: multi ? input.titles.area : null, unaltered } : undefined,
      ).map((text, i) => ({
        text,
        style: i < figureLineCount(input) ? OWN : { ...OWN, size: 7.92 },
      })),
      { x: measureX, top: measureTop, bottom: measureBottom, width: measureWidth },
    ),
  )
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
  return { width, height, ops, frame, drawn: [...panel.drawn], counts, notes: notesFor(input, panel.drawn) }
}

/**
 * Lines wrapped to `box.width` and stacked from `box.top`, never past `box.bottom`: wrapped, then shrunk (down to
 * 70%), then the last line that fits ellipsized and the rest left out. An engine's capture adds lines (the screened
 * figure, the renderer, what was drawn without data), which ran past the calculation cell's foot.
 */
export function fittedLines(
  lines: ReadonlyArray<{ text: string; style: TextStyle }>,
  box: { x: number; top: number; bottom: number; width: number },
): DrawOp[] {
  const GAP = 2
  const layout = (scale: number) =>
    lines.map(({ text, style }) => {
      const sized = { ...style, size: style.size * scale }
      return { style: sized, rows: wrapText(text, sized.size, box.width) }
    })
  const height = (laid: ReturnType<typeof layout>) =>
    laid.reduce((sum, { style, rows }) => sum + rows.length * lineHeight(style) + GAP, 0) - GAP
  let laid = layout(1)
  for (let scale = 0.95; height(laid) > box.bottom - box.top && scale >= 0.7 - 1e-9; scale -= 0.05) laid = layout(scale)
  const ops: DrawOp[] = []
  let y = box.top
  outer: for (const { style, rows } of laid) {
    for (let r = 0; r < rows.length; r++) {
      const step = lineHeight(style)
      if (y + step > box.bottom + 0.01) {
        // Out of room: the previous row ends with an ellipsis, unless nothing was drawn yet.
        const last = ops.length ? ops.pop() : null
        if (last && last.op === 'text') ops.push({ ...last, text: fitText(`${last.text}...`, last.size, box.width) })
        else if (last) ops.push(last)
        break outer
      }
      ops.push(...textOps(box.x, y, rows[r], style))
      y += step
    }
    y += GAP
  }
  return ops
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
  ops.push(
    ...textOps(
      W / 2,
      height - 26,
      measureLines(input, counts).slice(0, figureLineCount(input)).join('   ·   '),
      { size: 8, color: '#1d4ed8' },
      'center',
    ),
  )
  return { width: W, height, ops, frame, drawn: [...panel.drawn], counts, notes: notesFor(input, panel.drawn) }
}

/** An 11 × 17 landscape page, points: what a report prints on a page of its own (`isSheet`, `viaReport/html.ts`). */
export const TABLOID_PAGE = { width: 1224, height: 792 } as const

/** `ops` moved by (dx, dy). */
export function translateOps(ops: readonly DrawOp[], dx: number, dy: number): DrawOp[] {
  const move = (parts: Point[][]) => parts.map((part) => part.map(([x, y]) => [x + dx, y + dy] as Point))
  return ops.map((op) => {
    switch (op.op) {
      case 'path':
      case 'clip':
        return { ...op, parts: move(op.parts) }
      case 'restore':
        return op
      default:
        return { ...op, x: op.x + dx, y: op.y + dy }
    }
  })
}

/**
 * A view's figure on an 11 × 17 landscape page, for a report's calculation pages: an analysis sheet (family A) as
 * composed, any other style's analysed figure composed as wide as the page holds it (the picture scales with the
 * width, the calculation lines do not) and centred on the page. Never stretched: the picture keeps its aspect.
 */
export function tabloidFigure(input: FigureInput): ComposedFigure {
  const { width: W, height: H } = TABLOID_PAGE
  const composed = composeFigure(input)
  if (Math.abs(composed.width - W) < 1 && Math.abs(composed.height - H) < 1) return composed
  // The widest figure whose height fits the page, by bisection on the width (its height grows with its width).
  const margin = 12
  let lo = 240,
    hi = W - margin * 2
  let best = analysedFigure(input, lo)
  for (let i = 0; i < 12 && hi - lo > 2; i++) {
    const mid = (lo + hi) / 2
    const trial = analysedFigure(input, mid)
    if (trial.height <= H - margin * 2) {
      best = trial
      lo = mid
    } else hi = mid
  }
  const top = analysedFigure(input, hi)
  if (top.height <= H - margin * 2) best = top
  const dx = (W - best.width) / 2,
    dy = (H - best.height) / 2
  return {
    ...best,
    width: W,
    height: H,
    ops: translateOps(best.ops, dx, dy),
    frame: { ...best.frame, x: best.frame.x + dx, y: best.frame.y + dy },
  }
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
  if (
    paintsBlocks(input) &&
    input.classes &&
    (input.image.kind !== 'rgba' ||
      input.classes.width !== input.image.width ||
      input.classes.height !== input.image.height)
  )
    notes.push('The blocks could not be painted: the picture and its class pass were not read at one size.')
  const missing = (Object.keys(input.preset.symbols) as ViaRole[]).filter((role) => !drawn.has(role))
  if (missing.length) notes.push(`Not in this view or not yet available: ${missing.join(', ')}.`)
  return notes
}

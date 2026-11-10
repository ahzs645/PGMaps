/**
 * Draws symbols into RGBA pixels for MapLibre's `addImage`: repeating tiles for hatched and
 * marker-filled areas, and icons for points and line markers. Pure arithmetic with 4 × 4
 * supersampling, so it runs in tests and in the browser alike and the tiles are exact.
 *
 * Sizes follow the sheet: one point is 96/72 CSS pixels (as `lineSymbolPaint`'s widths), and images
 * are drawn at the device pixel ratio and handed to MapLibre with it. So a hatch 5 pt apart on paper
 * is 6.7 CSS pixels apart on screen, which is how it prints at the sheet's scale.
 *
 * A repeating tile has a whole number of pixels, so a hatch at any angle is drawn as the nearest
 * family of lines that repeats in it; `PatternTile.hatches` reports the angle and spacing drawn.
 * No DOM or network access.
 */
import { ICONS, type IconId, type IconPaint, type IconPart } from './icons'
import type { AreaSymbol } from './symbols'

/** CSS pixels per point. */
export const PX_PER_PT = 96 / 72
/** Largest side of a pattern tile, device pixels. */
export const MAX_PATTERN_TILE_PX = 256
/** A tile size is accepted once every hatch's spacing is within this share of the asked one. */
export const PATTERN_TILE_TOLERANCE = 0.02
const SUPERSAMPLE = 4

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}
export interface PatternTile extends RgbaImage {
  pixelRatio: number
  /** The hatches as drawn in the tile: angle in degrees (0–180) and spacing in points. */
  hatches: { angleDeg: number; spacing: number }[]
}

function rgb(color: string): [number, number, number] {
  const hex = color.replace('#', '')
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6)
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number]
}

/** Straight-alpha "over" of `color` at `alpha` (0–1) onto pixel `i`. */
function blend(data: Uint8ClampedArray, i: number, color: [number, number, number], alpha: number) {
  if (alpha <= 0) return
  const da = data[i + 3] / 255
  const oa = alpha + da * (1 - alpha)
  for (let c = 0; c < 3; c++) data[i + c] = (color[c] * alpha + data[i + c] * da * (1 - alpha)) / oa
  data[i + 3] = oa * 255
}

/** Paints `color` wherever `inside(x, y)` holds, x and y in pixels, anti-aliased by supersampling. */
function paint(image: RgbaImage, color: string, opacity: number, inside: (x: number, y: number) => boolean) {
  const c = rgb(color)
  const step = 1 / SUPERSAMPLE
  for (let py = 0; py < image.height; py++)
    for (let px = 0; px < image.width; px++) {
      let hits = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++)
        for (let sx = 0; sx < SUPERSAMPLE; sx++) if (inside(px + (sx + 0.5) * step, py + (sy + 0.5) * step)) hits++
      if (hits) blend(image.data, (py * image.width + px) * 4, c, (opacity * hits) / (SUPERSAMPLE * SUPERSAMPLE))
    }
}

function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

function insidePolygon(x: number, y: number, points: readonly (readonly [number, number])[]) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i],
      [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

type Colors = { primary: string; secondary?: string }
const resolve = (value: IconPaint | undefined, colors: Colors) =>
  value === undefined
    ? undefined
    : value === 'primary'
      ? colors.primary
      : value === 'secondary'
        ? (colors.secondary ?? '#ffffff')
        : value

/**
 * Paints icon parts at pixel position (cx, cy), `size` pixels across, turned `angle` degrees
 * counter-clockwise, at each of the `copies` offsets (for wrapping round a tile's edges).
 */
function paintIcon(
  image: RgbaImage,
  parts: readonly IconPart[],
  cx: number,
  cy: number,
  size: number,
  angle: number,
  colors: Colors,
  haloPx = 0,
  haloColor = '#ffffff',
  copies: readonly (readonly [number, number])[] = [[0, 0]],
) {
  const a = (angle * Math.PI) / 180
  const cos = Math.cos(a),
    sin = Math.sin(a)
  // Back from pixels to the icon's unit box (the inverse of the rotation `iconOps` uses).
  const local = (x: number, y: number): [number, number] => {
    const dx = (x - cx) / size,
      dy = (y - cy) / size
    return [dx * cos - dy * sin, dx * sin + dy * cos]
  }
  const near = (x: number, y: number, test: (u: number, v: number) => boolean) =>
    copies.some(([ox, oy]) => {
      const [u, v] = local(x - ox, y - oy)
      return test(u, v)
    })
  const passes = haloPx > 0 ? (['halo', 'body'] as const) : (['body'] as const)
  for (const pass of passes)
    for (const part of parts) {
      const fill = resolve(part.fill, colors)
      const stroke = resolve(part.stroke, colors)
      const half = ((part.width ?? 0) * size) / 2 + (pass === 'halo' ? haloPx : 0)
      const halfUnit = half / size
      const fillColor = pass === 'halo' ? (fill ? haloColor : undefined) : fill
      const strokeColor = pass === 'halo' ? haloColor : stroke
      if (part.type === 'circle') {
        if (fillColor)
          paint(image, fillColor, 1, (x, y) => near(x, y, (u, v) => Math.hypot(u - part.cx, v - part.cy) <= part.r))
        if (strokeColor && half > 0)
          paint(image, strokeColor, 1, (x, y) =>
            near(x, y, (u, v) => Math.abs(Math.hypot(u - part.cx, v - part.cy) - part.r) <= halfUnit),
          )
      } else {
        const points = part.points
        if (fillColor && part.closed)
          paint(image, fillColor, 1, (x, y) => near(x, y, (u, v) => insidePolygon(u, v, points)))
        if (strokeColor && half > 0) {
          const segments = part.closed ? [...points, points[0]] : points
          paint(image, strokeColor, 1, (x, y) =>
            near(x, y, (u, v) => {
              for (let i = 1; i < segments.length; i++)
                if (
                  segmentDistance(u, v, segments[i - 1][0], segments[i - 1][1], segments[i][0], segments[i][1]) <=
                  halfUnit
                )
                  return true
              return false
            }),
          )
        }
      }
    }
}

/**
 * An icon as pixels: `sizePt` points across at `pixelRatio`, with room for its halo and stroke.
 * Returned with the pixel ratio to hand to MapLibre's `addImage`.
 */
export function iconImage(
  id: IconId,
  sizePt: number,
  colors: Colors,
  pixelRatio: number,
  halo?: { color: string; width: number },
): RgbaImage & { pixelRatio: number } {
  const scale = PX_PER_PT * pixelRatio
  const size = sizePt * scale
  const haloPx = (halo?.width ?? 0) * scale
  const side = Math.max(1, Math.ceil(size * 1.25 + haloPx * 2 + 2))
  const image = { width: side, height: side, data: new Uint8ClampedArray(side * side * 4) }
  paintIcon(image, ICONS[id].parts, side / 2, side / 2, size, 0, colors, haloPx, halo?.color)
  return { ...image, pixelRatio }
}

/**
 * The smallest tile side, in device pixels, holding a whole number of each period within
 * `PATTERN_TILE_TOLERANCE`; the closest fit up to `MAX_PATTERN_TILE_PX` otherwise.
 */
export function tileSide(periods: readonly number[], fallback: number): number {
  const usable = periods.filter((p) => Number.isFinite(p) && p > 0)
  if (!usable.length) return Math.min(MAX_PATTERN_TILE_PX, Math.max(1, Math.round(fallback)))
  const error = (side: number) =>
    Math.max(
      ...usable.map((p) => {
        const count = Math.max(1, Math.round(side / p))
        return Math.abs(side / count - p) / p
      }),
    )
  let best = Math.min(MAX_PATTERN_TILE_PX, Math.max(1, Math.round(Math.max(...usable))))
  let bestError = Infinity
  for (
    let side = Math.max(1, Math.floor(Math.min(...usable) * (1 - PATTERN_TILE_TOLERANCE)));
    side <= MAX_PATTERN_TILE_PX;
    side++
  ) {
    const e = error(side)
    if (e <= PATTERN_TILE_TOLERANCE) return side
    if (e < bestError) {
      bestError = e
      best = side
    }
  }
  return best
}

/**
 * A repeating tile for an area's fill, hatches and marker fill, or null when the symbol has none of
 * the patterned parts (a plain fill needs no image). The fill colour is baked in at its opacity.
 */
export function areaPatternTile(symbol: AreaSymbol, pixelRatio: number): PatternTile | null {
  const hatches = symbol.hatches ?? []
  const markers = symbol.markerFill
  if (!hatches.length && !markers) return null
  const scale = PX_PER_PT * pixelRatio
  // Lines n·p = c with n = (sin θ, cos θ) repeat every s / |sin θ| across and s / |cos θ| down.
  const along = (trig: (a: number) => number) =>
    hatches.flatMap((h) => {
      const t = Math.abs(trig((h.angleDeg * Math.PI) / 180))
      return t > 1e-6 ? [(h.spacing * scale) / t] : []
    })
  const markerX = markers ? [markers.spacingX * scale] : []
  const markerY = markers ? [markers.spacingY * scale * (markers.stagger ? 2 : 1)] : []
  const fallback = Math.max(4, ...hatches.map((h) => h.spacing * scale))
  const width = tileSide([...along(Math.sin), ...markerX], fallback)
  const height = tileSide([...along(Math.cos), ...markerY], fallback)
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  if (symbol.fill) paint(image, symbol.fill, symbol.fillOpacity ?? 1, () => true)
  const drawn: PatternTile['hatches'] = []
  for (const hatch of hatches) {
    const theta = (hatch.angleDeg * Math.PI) / 180
    const s = hatch.spacing * scale
    // Whole line counts across and down the tile; the family of lines through them repeats exactly.
    const a = Math.round((width * Math.sin(theta)) / s)
    const b = Math.round((height * Math.cos(theta)) / s)
    if (!a && !b) continue
    const gx = a / width,
      gy = b / height
    const gradient = Math.hypot(gx, gy)
    const shift = (hatch.phase ?? 0) * scale * gradient
    const half = (hatch.stroke.width * scale) / 2
    paint(image, hatch.stroke.color, hatch.stroke.opacity ?? 1, (x, y) => {
      const f = x * gx + y * gy - shift
      return Math.abs(f - Math.round(f)) / gradient <= half
    })
    // The normal is (sin θ, cos θ), so θ = atan2(gx, gy), folded into 0–180.
    const angle = (((Math.atan2(gx, gy) * 180) / Math.PI) % 180) + 180
    drawn.push({ angleDeg: angle % 180, spacing: 1 / gradient / scale })
  }
  if (markers) {
    const columns = Math.max(1, Math.round(width / (markers.spacingX * scale)))
    let rows = Math.max(1, Math.round(height / (markers.spacingY * scale)))
    if (markers.stagger && rows % 2) rows += 1
    const px = width / columns,
      py = height / rows
    const copies: [number, number][] = []
    for (const ox of [-width, 0, width]) for (const oy of [-height, 0, height]) copies.push([ox, oy])
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++)
        paintIcon(
          image,
          ICONS[markers.icon].parts,
          i * px + (markers.stagger && j % 2 ? px / 2 : 0),
          j * py,
          markers.size * scale,
          0,
          { primary: markers.color, secondary: markers.secondary },
          0,
          undefined,
          copies,
        )
  }
  return { ...image, pixelRatio, hatches: drawn }
}

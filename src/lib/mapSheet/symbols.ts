/**
 * Map symbols as data, and the one function per kind that turns a symbol into drawing operations.
 * The sheet's map, its legend swatches and the symbol gallery all call these, and the MapLibre paints
 * in `mapSymbols.ts` read the same objects, so a symbol cannot look different in two places.
 * Sizes are points at the sheet's reference paper; `k` scales them to the paper in use.
 * No DOM or network access.
 */
import {
  boundsOf,
  hatchLines,
  markersAlongLine,
  offsetPolyline,
  rectRing,
  type DrawOp,
  type Point,
  type StrokeStyle,
} from './drawOps'
import { ICONS, type IconId, type IconPaint } from './icons'

/** One stroke of a line symbol, moved sideways by `offset` points (positive to the right of travel). */
export interface LineLayer extends StrokeStyle {
  offset?: number
}
/** An icon repeated along a line: ticks, crosses, dots. The icon's x axis follows the line. */
export interface LineMarker {
  icon: IconId
  /** Points between markers. */
  spacing: number
  /** Icon box side, points. */
  size: number
  color: string
  secondary?: string
  /** Distance of the first marker from the start, points; half a spacing by default. */
  start?: number
  /** Sideways shift, points, positive to the right of travel. */
  offset?: number
}
/** Parallel lines clipped to an area. */
export interface Hatch {
  /** Counter-clockwise from east on paper: 45 rises to the right, 90 is vertical. */
  angleDeg: number
  /** Distance between lines, measured across them, points. */
  spacing: number
  stroke: StrokeStyle
  /** Shift of the lines across their direction, points: places a second colour between the first's lines. */
  phase?: number
}
/** An icon repeated on a grid inside an area: marsh marks, dots. */
export interface MarkerFill {
  icon: IconId
  size: number
  color: string
  secondary?: string
  /** Grid pitch, points. */
  spacingX: number
  spacingY: number
  /** Every other row shifted half a pitch. */
  stagger?: boolean
}
/** An outline stroke; `inside` keeps it within the area, as a casing just inside the edge. */
export interface OutlineLayer extends StrokeStyle {
  inside?: boolean
}

export interface LineSymbol {
  kind: 'line'
  label: string
  /** Strokes bottom first: a casing, the line, a centre dash. */
  layers: LineLayer[]
  markers?: LineMarker[]
}
export interface AreaSymbol {
  kind: 'area'
  label: string
  fill?: string
  fillOpacity?: number
  /** Drawn in order over the fill: one for a single hatch, two for a cross, grid, double or striped hatch. */
  hatches?: Hatch[]
  markerFill?: MarkerFill
  /** Outline strokes, bottom first. */
  outline: OutlineLayer[]
}
export interface ClassSymbol {
  kind: 'class'
  label: string
  color: string
  opacity: number
}
export interface PointSymbol {
  kind: 'point'
  label: string
  icon: IconId
  /** Icon box side, points. */
  size: number
  color: string
  secondary?: string
  /** An outline drawn round every part first, as the reference sheets' white glyph halo. */
  halo?: { color: string; width: number }
}
export type SheetSymbol = LineSymbol | AreaSymbol | ClassSymbol | PointSymbol

/** Most markers one area fill places; past it the grid is widened so the count fits. */
export const MAX_MARKER_FILL = 5000
/** Outline of class swatches. */
export const SWATCH_OUTLINE = '#6e6e6e'

export const scaleStroke = (stroke: StrokeStyle, k: number): StrokeStyle => ({
  ...stroke,
  width: stroke.width * k,
  ...(stroke.dash ? { dash: stroke.dash.map((d) => d * k) } : {}),
})

const resolvePaint = (paint: IconPaint | undefined, colors: { primary: string; secondary?: string }) =>
  paint === undefined
    ? undefined
    : paint === 'primary'
      ? colors.primary
      : paint === 'secondary'
        ? (colors.secondary ?? '#ffffff')
        : paint

/**
 * An icon at (x, y), `size` points across, turned `angle` degrees counter-clockwise. With a halo, every
 * part is first drawn wider in the halo colour.
 */
export function iconOps(
  id: IconId,
  x: number,
  y: number,
  size: number,
  angle: number,
  colors: { primary: string; secondary?: string },
  halo?: { color: string; width: number },
): DrawOp[] {
  const a = (angle * Math.PI) / 180
  const cos = Math.cos(a),
    sin = Math.sin(a)
  // Counter-clockwise on paper, where y runs down.
  const at = ([px, py]: Point): Point => [x + (px * cos + py * sin) * size, y + (-px * sin + py * cos) * size]
  const ops: DrawOp[] = []
  const parts = ICONS[id].parts
  const passes = halo ? (['halo', 'body'] as const) : (['body'] as const)
  for (const pass of passes)
    for (const part of parts) {
      const fill = resolvePaint(part.fill, colors)
      const strokeColor = resolvePaint(part.stroke, colors)
      const width = (part.width ?? 0) * size
      let stroke: StrokeStyle | undefined
      let fillColor: string | undefined
      if (pass === 'halo' && halo) {
        stroke = { color: halo.color, width: width + halo.width * 2, join: 'round', cap: 'round' }
        fillColor = fill ? halo.color : undefined
      } else {
        stroke = strokeColor ? { color: strokeColor, width, join: 'round', cap: 'round' } : undefined
        fillColor = fill
      }
      if (part.type === 'circle') {
        const [cx, cy] = at([part.cx, part.cy])
        ops.push({ op: 'circle', x: cx, y: cy, r: part.r * size, fill: fillColor, stroke })
      } else ops.push({ op: 'path', parts: [part.points.map(at)], closed: part.closed, fill: fillColor, stroke })
    }
  return ops
}

export function pointSymbolOps(symbol: PointSymbol, x: number, y: number, k: number, angle = 0): DrawOp[] {
  return iconOps(
    symbol.icon,
    x,
    y,
    symbol.size * k,
    angle,
    { primary: symbol.color, secondary: symbol.secondary },
    symbol.halo ? { color: symbol.halo.color, width: symbol.halo.width * k } : undefined,
  )
}

/** Markers of one line marker along each part. `start` overrides the marker's own, points already scaled. */
function lineMarkerOps(parts: Point[][], marker: LineMarker, k: number, start?: number): DrawOp[] {
  const ops: DrawOp[] = []
  for (const part of parts) {
    const line = marker.offset ? offsetPolyline(part, marker.offset * k) : part
    for (const at of markersAlongLine(line, marker.spacing * k, start ?? (marker.start ?? marker.spacing / 2) * k))
      ops.push(
        ...iconOps(marker.icon, at.x, at.y, marker.size * k, at.angle, {
          primary: marker.color,
          secondary: marker.secondary,
        }),
      )
  }
  return ops
}

/** A line symbol along each part: the strokes bottom first, each at its offset, then the markers. */
export function lineSymbolOps(parts: Point[][], symbol: LineSymbol, k: number): DrawOp[] {
  const ops: DrawOp[] = []
  for (const layer of symbol.layers)
    ops.push({
      op: 'path',
      parts: layer.offset ? parts.map((part) => offsetPolyline(part, layer.offset! * k)) : parts,
      closed: false,
      stroke: scaleStroke(layer, k),
    })
  for (const marker of symbol.markers ?? []) ops.push(...lineMarkerOps(parts, marker, k))
  return ops
}

/** Grid positions of a marker fill over `box`, anchored to the page origin so neighbouring areas line up. */
export function markerFillPositions(
  box: { x: number; y: number; w: number; h: number },
  fill: MarkerFill,
  k: number,
): Point[] {
  let sx = fill.spacingX * k,
    sy = fill.spacingY * k
  if (!(sx > 0) || !(sy > 0)) return []
  const count = (box.w / sx + 2) * (box.h / sy + 2)
  if (count > MAX_MARKER_FILL) {
    const widen = Math.sqrt(count / MAX_MARKER_FILL)
    sx *= widen
    sy *= widen
  }
  const out: Point[] = []
  const pad = fill.size * k
  for (let j = Math.floor((box.y - pad) / sy); j * sy <= box.y + box.h + pad; j++) {
    const shift = fill.stagger && j % 2 !== 0 ? sx / 2 : 0
    for (let i = Math.floor((box.x - pad - shift) / sx); i * sx + shift <= box.x + box.w + pad; i++)
      out.push([i * sx + shift, j * sy])
  }
  return out
}

/** Fill, hatches and marker fill of an area, without its outline. Hatches and markers are clipped to it. */
function areaInteriorOps(parts: Point[][], symbol: AreaSymbol, k: number): DrawOp[] {
  const ops: DrawOp[] = []
  if (symbol.fill) ops.push({ op: 'path', parts, closed: true, fill: symbol.fill, fillOpacity: symbol.fillOpacity })
  const box = boundsOf(parts)
  if (!box || (!symbol.hatches?.length && !symbol.markerFill)) return ops
  ops.push({ op: 'clip', parts })
  for (const hatch of symbol.hatches ?? [])
    ops.push({
      op: 'path',
      parts: hatchLines(box, hatch.angleDeg, hatch.spacing * k, (hatch.phase ?? 0) * k),
      closed: false,
      stroke: scaleStroke(hatch.stroke, k),
    })
  if (symbol.markerFill) {
    const fill = symbol.markerFill
    for (const [x, y] of markerFillPositions(box, fill, k))
      ops.push(...iconOps(fill.icon, x, y, fill.size * k, 0, { primary: fill.color, secondary: fill.secondary }))
  }
  ops.push({ op: 'restore' })
  return ops
}

function outlineOps(parts: Point[][], layer: OutlineLayer, k: number): DrawOp[] {
  if (!layer.inside) return [{ op: 'path', parts, closed: true, stroke: scaleStroke(layer, k) }]
  // Twice as wide, clipped to the area: the inner half is the casing.
  const stroke = scaleStroke({ ...layer, width: layer.width * 2 }, k)
  return [{ op: 'clip', parts }, { op: 'path', parts, closed: true, stroke }, { op: 'restore' }]
}

/** An area symbol over rings `parts` (even-odd): fill, hatches, marker fill, then the outline. */
export function areaSymbolOps(parts: Point[][], symbol: AreaSymbol, k: number): DrawOp[] {
  return [...areaInteriorOps(parts, symbol, k), ...symbol.outline.flatMap((layer) => outlineOps(parts, layer, k))]
}

/**
 * A legend swatch of `symbol` in `box`, drawn by the same functions as the map. A line's markers keep
 * their spacing; a swatch shorter than one spacing shows one marker in its middle.
 */
export function swatchOps(symbol: SheetSymbol, box: { x: number; y: number; w: number; h: number }, k: number) {
  const ops: DrawOp[] = []
  if (symbol.kind === 'class') {
    ops.push({
      op: 'rect',
      ...box,
      fill: symbol.color,
      fillOpacity: symbol.opacity < 1 ? symbol.opacity : undefined,
      stroke: { color: SWATCH_OUTLINE, width: 0.75 * k },
    })
    return ops
  }
  if (symbol.kind === 'point') {
    const size = Math.min(symbol.size * k, box.h * 1.3, box.w)
    return pointSymbolOps({ ...symbol, size: size / k }, box.x + box.w / 2, box.y + box.h / 2, k)
  }
  if (symbol.kind === 'line') {
    const y = box.y + box.h / 2
    const parts: Point[][] = [
      [
        [box.x + 1 * k, y],
        [box.x + box.w - 1 * k, y],
      ],
    ]
    const length = box.w - 2 * k
    for (const layer of symbol.layers)
      ops.push({
        op: 'path',
        parts: layer.offset
          ? parts.map((part) =>
              offsetPolyline(part, Math.sign(layer.offset!) * Math.min(Math.abs(layer.offset!) * k, box.h / 2)),
            )
          : parts,
        closed: false,
        stroke: scaleStroke(layer, k),
      })
    for (const marker of symbol.markers ?? [])
      ops.push(...lineMarkerOps(parts, marker, k, marker.spacing * k > length ? length / 2 : undefined))
    return ops
  }
  const ring = [rectRing(box.x, box.y, box.w, box.h)]
  ops.push(...areaInteriorOps(ring, symbol, k))
  for (const layer of symbol.outline) {
    if (layer.inside) {
      ops.push(...outlineOps(ring, { ...layer, width: Math.min(layer.width, box.h / 4 / k) }, k))
      continue
    }
    // Thick outlines are drawn inset so the swatch keeps its size.
    const inset = Math.min(layer.width * k, box.h / 3) / 2
    ops.push({
      op: 'path',
      parts: [rectRing(box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2)],
      closed: true,
      stroke: scaleStroke({ ...layer, width: Math.min(layer.width, box.h / 3 / k) }, k),
    })
  }
  return ops
}

/** The colour that stands for a symbol where only one colour fits, e.g. a plain legend dot. */
export function symbolKeyColor(symbol: SheetSymbol): string {
  if (symbol.kind === 'class' || symbol.kind === 'point') return symbol.color
  if (symbol.kind === 'line') {
    // The widest stroke reads as the line's colour; a white casing or centre dash does not.
    const coloured = symbol.layers.filter((layer) => layer.color.toLowerCase() !== '#ffffff')
    const pick = (coloured.length ? coloured : symbol.layers).reduce((a, b) => (b.width > a.width ? b : a), {
      color: symbol.markers?.[0]?.color ?? '#000000',
      width: 0,
    })
    return pick.color
  }
  return (
    symbol.fill ??
    symbol.hatches?.[0]?.stroke.color ??
    symbol.markerFill?.color ??
    symbol.outline.at(-1)?.color ??
    '#000000'
  )
}

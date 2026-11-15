/**
 * PGMaps' own point icons (`icons.ts`) in the shapes other formats take: a standalone SVG for QGIS
 * SVG markers, SLD inline graphics and GeoLibre, and plain polygons and polylines for ArcGIS vector
 * markers. Every SVG carries `data-pgmaps-icon`, so a reader recognises our icon on the way back
 * instead of treating it as foreign artwork. No DOM or network access.
 */
import type { Point } from '@/lib/mapSheet/drawOps'
import { ICONS, ICON_IDS, type IconId, type IconPaint } from '@/lib/mapSheet/icons'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { iconOps } from '@/lib/mapSheet/symbols'

export interface IconColors {
  primary: string
  secondary?: string
}

/** Extra space round the unit box, as a fraction of the icon size, so strokes and halos are not cut. */
function iconPadding(id: IconId, size: number, halo?: { width: number }) {
  const widest = Math.max(0, ...ICONS[id].parts.map((part) => part.width ?? 0)) * size
  return widest / 2 + (halo?.width ?? 0)
}

/**
 * The icon as an SVG document `side` points square, centred, with `size` the icon's box. QGIS and
 * SLD scale the SVG to the marker size they are given, so callers pass `side` as that size.
 */
export function iconSvg(
  id: IconId,
  size: number,
  colors: IconColors,
  halo?: { color: string; width: number },
  angle = 0,
): { svg: string; side: number } {
  const pad = iconPadding(id, size, halo)
  const side = size + pad * 2
  const svg = sheetSvg(iconOps(id, side / 2, side / 2, size, angle, colors, halo), side, side, undefined, null)
  return { svg: svg.replace('<svg ', `<svg data-pgmaps-icon="${id}" `), side }
}

/** The icon id an SVG written by `iconSvg` carries, or null for any other SVG. */
export function iconFromSvg(svg: string): IconId | null {
  const match = /data-pgmaps-icon="([a-z-]+)"/.exec(svg)
  return match && (ICON_IDS as string[]).includes(match[1]) ? (match[1] as IconId) : null
}

/** Base64 of UTF-8 text, without `btoa`'s Latin-1 limit. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
export function utf8FromBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/** One drawn part of an icon in the unit box (−0.5…0.5, y down), circles as polygons. */
export interface IconShape {
  kind: 'polygon' | 'polyline'
  points: Point[]
  fill?: string
  stroke?: { color: string; width: number }
}

const CIRCLE_STEPS = 32
const resolve = (paint: IconPaint | undefined, colors: IconColors) =>
  paint === 'primary' ? colors.primary : paint === 'secondary' ? (colors.secondary ?? colors.primary) : paint

/** The icon's parts in drawing order, with colours filled in. Widths are fractions of the box. */
export function iconShapes(id: IconId, colors: IconColors): IconShape[] {
  return ICONS[id].parts.map((part) => {
    const fill = resolve(part.fill, colors)
    const strokeColor = resolve(part.stroke, colors)
    const stroke = strokeColor ? { color: strokeColor, width: part.width ?? 0.05 } : undefined
    if (part.type === 'circle')
      return {
        kind: 'polygon',
        points: Array.from({ length: CIRCLE_STEPS + 1 }, (_, i) => {
          const a = (i / CIRCLE_STEPS) * Math.PI * 2
          return [part.cx + part.r * Math.cos(a), part.cy + part.r * Math.sin(a)] as Point
        }),
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
      }
    const points = part.closed ? [...part.points, part.points[0]] : part.points
    return {
      kind: part.closed ? 'polygon' : 'polyline',
      points,
      ...(fill && part.closed ? { fill } : {}),
      ...(stroke ? { stroke } : {}),
    }
  })
}

/**
 * Our nearest icon to another application's simple marker shape, for readers. Shapes without a
 * counterpart return null, and the reader says so.
 */
export function iconForMarkerName(name: string): IconId | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^shape:\/\//, '')
  if (['circle', 'dot', 'filled_circle', 'circle_fill'].includes(key)) return 'dot'
  if (['cross', 'cross2', 'x', 'times'].includes(key)) return 'cross'
  if (['diamond', 'rhombus'].includes(key)) return 'diamond'
  if (['square', 'rectangle'].includes(key)) return 'tower'
  if (['line', 'vertline', 'tick'].includes(key)) return 'tick'
  if ((ICON_IDS as string[]).includes(key)) return key as IconId
  return null
}

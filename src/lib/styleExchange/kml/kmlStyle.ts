/**
 * A PGMaps symbol as the one style a KML placemark can carry (`KmlLayerStyle`, `src/lib/gis/kml.ts`):
 * a line is one solid stroke, an area one fill and one outline, a point one tinted icon. Everything
 * else a symbol draws (casings, dashes, markers along a line, hatches, marker fills, icon shapes,
 * halos) has no place in KML, so each loss is reported as an `ExchangeDiagnostic` rather than
 * dropped silently, and the colours come from the symbol itself, never re-entered.
 *
 * What stands in for a lost part:
 * - a line draws its widest stroke (the one that carries the colour on the plan);
 * - an area with no fill of its own takes its hatch or marker colour at the share of the area the
 *   hatch or markers ink, so a 0.5 pt hatch every 5 pt reads as a 10% tint;
 * - a point draws the icon the caller gives (a plain disc in a KMZ), tinted to the symbol's colour,
 *   at the symbol's size and never smaller than {@link KML_MIN_ICON_SCALE}.
 *
 * No DOM or network access.
 */
import type { KmlLayerStyle } from '@/lib/gis/kml'
import type { AreaSymbol, LineSymbol, PointSymbol, SheetSymbol } from '@/lib/mapSheet/symbols'
import { PX_PER_PT } from '@/lib/mapSheet/symbolRaster'
import { toHex, withOpacity } from '../color'
import type { ExchangeDiagnostic } from '../model'

/** The side, in pixels, at which Google Earth draws an icon of scale 1. */
export const KML_ICON_PX = 32
/**
 * The smallest icon scale written. The plan's station dot is 2.5 pt (about 3 px), which a KML client
 * draws as a speck it is hard to click; half the client's own icon stays visible and pickable.
 */
export const KML_MIN_ICON_SCALE = 0.5

const round = (value: number, digits = 3) => Number(value.toFixed(digits))

/** A CSS colour as `#rrggbb` and its opacity (the colour's own alpha times `opacity`). */
function colourOf(color: string, opacity = 1): { hex: string; opacity: number } {
  const parsed = withOpacity(color, opacity)
  return { hex: toHex(parsed), opacity: round(parsed.a) }
}

export interface KmlStyleResult {
  style: KmlLayerStyle
  diagnostics: ExchangeDiagnostic[]
}

/** The widest stroke, the first of equals: on the plan's symbols it is the one that carries the colour. */
function widest<T extends { width: number }>(strokes: readonly T[]): T | undefined {
  return strokes.reduce<T | undefined>(
    (best, stroke) => (!best || stroke.width > best.width ? stroke : best),
    undefined,
  )
}

function lineStyle(symbol: LineSymbol, report: (message: string, severity?: 'info' | 'warning') => void) {
  const main = widest(symbol.layers)
  if (!main) {
    report('No stroke to draw; the client draws its own default line.')
    return {}
  }
  const { hex, opacity } = colourOf(main.color, main.opacity)
  if (symbol.layers.length > 1)
    report(
      `${symbol.layers.length - 1} more stroke${symbol.layers.length === 2 ? '' : 's'} left out; KML draws one line, the widest stroke (${hex}).`,
    )
  if (main.dash?.length) report('Dashes left out; the line is drawn solid.')
  if (main.offset) report('Offset from the line left out; the line is drawn on the feature.')
  if (symbol.markers?.length)
    report(`${symbol.markers.length === 1 ? 'Markers' : 'Two or more kinds of markers'} along the line left out.`)
  return {
    lineColor: hex,
    ...(opacity < 1 ? { lineOpacity: opacity } : {}),
    lineWidth: round(main.width * PX_PER_PT, 2),
  }
}

function areaStyle(symbol: AreaSymbol, report: (message: string, severity?: 'info' | 'warning') => void) {
  const style: KmlLayerStyle = {}
  if (symbol.fill) {
    const { hex, opacity } = colourOf(symbol.fill, symbol.fillOpacity ?? 1)
    style.fillColor = hex
    style.fillOpacity = opacity
    if (symbol.hatches?.length) report('Hatch left out; the area keeps its fill.')
    if (symbol.markerFill) report('Marker fill left out; the area keeps its fill.')
  } else if (symbol.hatches?.length) {
    // The share of the area the hatch lines ink, at their own opacity.
    const coverage = Math.min(
      1,
      symbol.hatches.reduce(
        (sum, hatch) => sum + (hatch.stroke.width / hatch.spacing) * (hatch.stroke.opacity ?? 1),
        0,
      ),
    )
    const { hex, opacity } = colourOf(symbol.hatches[0].stroke.color, coverage)
    style.fillColor = hex
    style.fillOpacity = opacity
    report(
      `Hatch drawn as a ${Math.round(opacity * 100)}% fill of its colour (${hex}), the share of the area its lines ink.`,
    )
    if (symbol.markerFill) report('Marker fill left out as well.')
  } else if (symbol.markerFill) {
    const marker = symbol.markerFill
    // A marker inks about its own box, less the corners a round icon leaves.
    const coverage = Math.min(1, ((marker.size * marker.size) / (marker.spacingX * marker.spacingY)) * (Math.PI / 4))
    const { hex, opacity } = colourOf(marker.color, coverage)
    style.fillColor = hex
    style.fillOpacity = opacity
    report(`Marker fill drawn as a ${Math.round(opacity * 100)}% fill of its colour (${hex}).`)
  } else style.fillOpacity = 0
  const outline = widest(symbol.outline)
  if (outline) {
    const { hex, opacity } = colourOf(outline.color, outline.opacity)
    style.lineColor = hex
    if (opacity < 1) style.lineOpacity = opacity
    style.lineWidth = round(outline.width * PX_PER_PT, 2)
    if (symbol.outline.length > 1)
      report(`${symbol.outline.length - 1} more outline stroke${symbol.outline.length === 2 ? '' : 's'} left out.`)
    if (outline.dash?.length) report('Outline dashes left out; the outline is drawn solid.')
    if (outline.inside) report('The outline is centred on the edge, not kept inside the area.', 'info')
  } else style.outline = false
  return style
}

function pointStyle(
  symbol: PointSymbol,
  iconHref: string | undefined,
  report: (message: string, severity?: 'info' | 'warning') => void,
) {
  const { hex, opacity } = colourOf(symbol.color)
  const scale = (symbol.size * PX_PER_PT) / KML_ICON_PX
  if (iconHref) {
    if (symbol.icon !== 'dot') report(`The "${symbol.icon}" icon is drawn as a dot in its colour.`)
  } else report(`The "${symbol.icon}" icon is left to the client: it draws its own pin in the symbol's colour.`)
  if (symbol.secondary) report('The icon’s second colour left out.')
  if (symbol.halo) report('The halo round the icon left out.')
  if (scale < KML_MIN_ICON_SCALE)
    report(
      `Drawn at ${KML_MIN_ICON_SCALE * KML_ICON_PX} px rather than its ${round(symbol.size * PX_PER_PT, 1)} px, so a client can show and pick it.`,
      'info',
    )
  return {
    iconColor: hex,
    ...(opacity < 1 ? { iconOpacity: opacity } : {}),
    iconScale: round(Math.max(KML_MIN_ICON_SCALE, scale)),
    ...(iconHref ? { iconHref } : {}),
  }
}

/**
 * The KML style of one symbol. `subject` names it in the diagnostics (the layer and rule);
 * `iconHref` is the icon a point is drawn with, a path inside the KMZ.
 */
export function kmlStyleForSymbol(
  symbol: SheetSymbol,
  subject: string,
  options: { iconHref?: string } = {},
): KmlStyleResult {
  const diagnostics: ExchangeDiagnostic[] = []
  const report = (message: string, severity: 'info' | 'warning' = 'warning') =>
    diagnostics.push({ severity, format: 'kml', subject, message })
  let style: KmlLayerStyle
  switch (symbol.kind) {
    case 'line':
      style = lineStyle(symbol, report)
      break
    case 'area':
      style = areaStyle(symbol, report)
      break
    case 'point':
      style = pointStyle(symbol, options.iconHref, report)
      break
    case 'class': {
      const { hex, opacity } = colourOf(symbol.color, symbol.opacity)
      style = { fillColor: hex, fillOpacity: opacity, outline: false }
      break
    }
  }
  return { style, diagnostics }
}

/** The disc a KMZ's points are drawn with: white, so a KML client tints it to each style's colour. */
export function kmlDotIconRgba(side = KML_ICON_PX): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(side * side * 4)
  const centre = side / 2,
    radius = side / 2 - 1
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre)
      // One pixel of soft edge, so the disc is not jagged.
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - distance))
      const at = (y * side + x) * 4
      rgba[at] = rgba[at + 1] = rgba[at + 2] = 255
      rgba[at + 3] = Math.round(alpha * 255)
    }
  return rgba
}

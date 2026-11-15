/**
 * `SheetSymbol`s as QGIS `<symbol>` elements: stacked strokes as `SimpleLine` layers (QGIS draws
 * symbol layers bottom first, as the sheets do), markers along lines as `MarkerLine` with an
 * embedded SVG of our icon, fills as `SimpleFill`, hatches as `LinePatternFill`, marker fills as
 * `PointPatternFill`, casings as `SimpleLine` layers inside the fill symbol, points as `SvgMarker`.
 * Every size is in points (`Point` unit). Patterns are anchored to the viewport, as the sheet
 * anchors them to the page, so neighbouring areas' hatches line up. No DOM or network access.
 *
 * The embedded SVGs carry the icon and the symbol's own values as `data-pgmaps-*` attributes, so
 * the reader recovers the exact icon, size, colours and halo rather than re-measuring the drawing.
 */
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import type { IconId } from '@/lib/mapSheet/icons'
import type { AreaSymbol, LineMarker, LineSymbol, OutlineLayer, PointSymbol, SheetSymbol } from '@/lib/mapSheet/symbols'
import { base64Utf8, iconSvg } from '../iconGeometry'
import { el, escapeXml, num, type XmlNodeSpec } from '../xml'
import { optionMap, qgisColor, type OptionValue } from './qgisXml'

export type QgisSymbolType = 'line' | 'fill' | 'marker'

export interface IconSpec {
  icon: IconId
  size: number
  color: string
  secondary?: string
  halo?: { color: string; width: number }
}

/** Our icon as a standalone SVG carrying its own values, and the SVG's side in points. */
export function pgmapsIconSvg(spec: IconSpec): { svg: string; side: number } {
  const { svg, side } = iconSvg(spec.icon, spec.size, { primary: spec.color, secondary: spec.secondary }, spec.halo)
  const data = [
    `data-pgmaps-size="${num(spec.size, 6)}"`,
    `data-pgmaps-color="${escapeXml(spec.color)}"`,
    spec.secondary ? `data-pgmaps-secondary="${escapeXml(spec.secondary)}"` : '',
    spec.halo ? `data-pgmaps-halo="${escapeXml(spec.halo.color)} ${num(spec.halo.width, 6)}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { svg: svg.replace('<svg ', `<svg ${data} `), side }
}

const CAP: Record<NonNullable<StrokeStyle['cap']>, string> = { butt: 'flat', round: 'round', square: 'square' }

const layer = (cls: string, options: Record<string, OptionValue | undefined>, sub?: XmlNodeSpec): XmlNodeSpec =>
  el('layer', { class: cls, enabled: 1, locked: 0, pass: 0 }, optionMap(options), sub)

const symbolElement = (type: QgisSymbolType, name: string, layers: XmlNodeSpec[]): XmlNodeSpec =>
  el('symbol', { type, name, alpha: 1, clip_to_extent: 1, force_rhr: 0 }, ...layers)

/** A dash list QGIS repeats as given; an odd list is doubled so on and off alternate as in SVG. */
const dashList = (dash: number[]) => (dash.length % 2 ? [...dash, ...dash] : dash)

function simpleLine(stroke: StrokeStyle, extra: { offset?: number; inside?: boolean } = {}): XmlNodeSpec {
  const width = extra.inside ? stroke.width * 2 : stroke.width
  return layer('SimpleLine', {
    line_color: qgisColor(stroke.color, stroke.opacity ?? 1),
    line_width: width,
    line_width_unit: 'Point',
    line_style: 'solid',
    capstyle: CAP[stroke.cap ?? 'butt'],
    joinstyle: stroke.join ?? 'miter',
    use_custom_dash: stroke.dash?.length ? 1 : 0,
    customdash: stroke.dash?.length
      ? dashList(stroke.dash)
          .map((d) => num(d, 6))
          .join(';')
      : '5;2',
    customdash_unit: 'Point',
    offset: extra.offset ?? 0,
    offset_unit: 'Point',
    draw_inside_polygon: extra.inside ? 1 : 0,
    ring_filter: 0,
    align_dash_pattern: 0,
    tweak_dash_pattern_on_corners: 0,
  })
}

/** An `SvgMarker` layer drawing our icon; its size is the SVG's side, padding for strokes and halo included. */
function svgMarker(spec: IconSpec): XmlNodeSpec {
  const { svg, side } = pgmapsIconSvg(spec)
  return layer('SvgMarker', {
    name: `base64:${base64Utf8(svg)}`,
    size: side,
    size_unit: 'Point',
    angle: 0,
    color: qgisColor(spec.color),
    outline_color: qgisColor(spec.secondary ?? spec.color),
    outline_width: 0,
    outline_width_unit: 'Point',
    fixedAspectRatio: 0,
    horizontal_anchor_point: 1,
    vertical_anchor_point: 1,
    scale_method: 'diameter',
    offset: '0,0',
    offset_unit: 'Point',
  })
}

function markerLine(marker: LineMarker, name: string): XmlNodeSpec {
  return layer(
    'MarkerLine',
    {
      // 3.28 reads `placement`; 3.30 and later read `placements`.
      placement: 'interval',
      placements: 'Interval',
      interval: marker.spacing,
      interval_unit: 'Point',
      offset_along_line: marker.start ?? marker.spacing / 2,
      offset_along_line_unit: 'Point',
      offset: marker.offset ?? 0,
      offset_unit: 'Point',
      rotate: 1,
      place_on_every_part: 1,
      ring_filter: 0,
    },
    symbolElement('marker', name, [svgMarker(marker)]),
  )
}

function lineLayers(symbol: LineSymbol, name: string): XmlNodeSpec[] {
  return [
    ...symbol.layers.map((stroke) => simpleLine(stroke, { offset: stroke.offset })),
    ...(symbol.markers ?? []).map((marker, i) => markerLine(marker, `@${name}@${symbol.layers.length + i}`)),
  ]
}

function simpleFill(color: string, opacity: number): XmlNodeSpec {
  return layer('SimpleFill', {
    color: qgisColor(color, opacity),
    style: 'solid',
    outline_style: 'no',
    outline_color: '0,0,0,0',
    outline_width: 0,
    outline_width_unit: 'Point',
    joinstyle: 'miter',
    offset: '0,0',
    offset_unit: 'Point',
  })
}

function areaLayers(symbol: AreaSymbol, name: string): XmlNodeSpec[] {
  const layers: XmlNodeSpec[] = []
  if (symbol.fill) layers.push(simpleFill(symbol.fill, symbol.fillOpacity ?? 1))
  for (const hatch of symbol.hatches ?? [])
    layers.push(
      layer(
        'LinePatternFill',
        {
          // 3.x reads `lineangle`; 4.x writes `angle`.
          angle: hatch.angleDeg,
          lineangle: hatch.angleDeg,
          distance: hatch.spacing,
          distance_unit: 'Point',
          offset: hatch.phase ?? 0,
          offset_unit: 'Point',
          coordinate_reference: 'viewport',
          clip_mode: 'during_render',
        },
        symbolElement('line', `@${name}@${layers.length}`, [simpleLine(hatch.stroke)]),
      ),
    )
  if (symbol.markerFill) {
    const fill = symbol.markerFill
    layers.push(
      layer(
        'PointPatternFill',
        {
          distance_x: fill.spacingX,
          distance_x_unit: 'Point',
          distance_y: fill.spacingY,
          distance_y_unit: 'Point',
          displacement_x: fill.stagger ? fill.spacingX / 2 : 0,
          displacement_x_unit: 'Point',
          displacement_y: 0,
          displacement_y_unit: 'Point',
          offset_x: 0,
          offset_x_unit: 'Point',
          offset_y: 0,
          offset_y_unit: 'Point',
          coordinate_reference: 'viewport',
          clip_mode: 'shape',
        },
        symbolElement('marker', `@${name}@${layers.length}`, [svgMarker(fill)]),
      ),
    )
  }
  for (const outline of symbol.outline as OutlineLayer[]) layers.push(simpleLine(outline, { inside: outline.inside }))
  return layers
}

const pointLayers = (symbol: PointSymbol): XmlNodeSpec[] => [svgMarker(symbol)]

/** The QGIS symbol type a sheet symbol becomes. */
export const qgisSymbolType = (symbol: SheetSymbol): QgisSymbolType =>
  symbol.kind === 'line' ? 'line' : symbol.kind === 'point' ? 'marker' : 'fill'

/** A sheet symbol as a QGIS `<symbol>` element named `name` (renderers refer to symbols by name). */
export function qgisSymbolXml(symbol: SheetSymbol, name: string): XmlNodeSpec {
  switch (symbol.kind) {
    case 'line':
      return symbolElement('line', name, lineLayers(symbol, name))
    case 'area':
      return symbolElement('fill', name, areaLayers(symbol, name))
    case 'class':
      return symbolElement('fill', name, [simpleFill(symbol.color, symbol.opacity)])
    case 'point':
      return symbolElement('marker', name, pointLayers(symbol))
  }
}

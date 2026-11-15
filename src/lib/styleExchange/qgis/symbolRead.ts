/**
 * QGIS `<symbol>` elements back to `SheetSymbol`s: the inverse of `symbolXml.ts` for what we write,
 * and the common QGIS symbol layers otherwise (`SimpleLine`, `SimpleFill` with its brush styles,
 * `LinePatternFill`, `PointPatternFill`, `SimpleMarker`, `SvgMarker`, `MarkerLine`, `HashLine`).
 * Every approximation is a warning and every layer that cannot be read an error. Foreign SVGs and
 * font markers are never traced: the reader asks for a PGMaps icon instead. No DOM or network access.
 */
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import { ICONS } from '@/lib/mapSheet/icons'
import type {
  AreaSymbol,
  Hatch,
  LineLayer,
  LineMarker,
  MarkerFill,
  OutlineLayer,
  PointSymbol,
  SheetSymbol,
} from '@/lib/mapSheet/symbols'
import { iconForMarkerName, iconFromSvg, utf8FromBase64 } from '../iconGeometry'
import { attr, childElements, type XmlElement } from '../xml'
import { Diagnostics, parseQgisColor, readOptions, roundPt, splitColor, toPoints } from './qgisXml'
import type { Rgba } from '../color'

type Options = Map<string, string>

const numberOption = (options: Options, key: string, fallback = 0) => {
  const value = Number(options.get(key))
  return Number.isFinite(value) ? value : fallback
}

class SymbolReader {
  constructor(
    readonly diagnostics: Diagnostics,
    readonly subject: string,
    /** The symbol's own opacity, which QGIS applies over every layer. */
    readonly alpha: number,
  ) {}

  pt(options: Options, key: string, fallback = 0): number {
    return roundPt(
      toPoints(numberOption(options, key, fallback), options.get(`${key}_unit`), this.diagnostics, this.subject),
    )
  }
  /** Units are named inconsistently: `line_width_unit`, `distance_x_unit`, `size_unit`… */
  ptWithUnit(options: Options, key: string, unitKey: string, fallback = 0): number {
    return roundPt(toPoints(numberOption(options, key, fallback), options.get(unitKey), this.diagnostics, this.subject))
  }
  color(text: string | undefined, fallback: Rgba = { r: 0, g: 0, b: 0, a: 1 }): Rgba {
    const color = parseQgisColor(text) ?? fallback
    return { ...color, a: color.a * this.alpha }
  }

  /** A `SimpleLine`'s stroke, or null for `line_style` "no". */
  stroke(
    options: Options,
    widthKey = 'line_width',
    colorKey = 'line_color',
    styleKey = 'line_style',
  ): StrokeStyle | null {
    const style = options.get(styleKey) ?? 'solid'
    if (style === 'no') return null
    const { color, opacity } = splitColor(this.color(options.get(colorKey) ?? options.get('color')))
    let width = this.ptWithUnit(options, widthKey, widthKey === 'line_width' ? 'line_width_unit' : `${widthKey}_unit`)
    if (width === 0) {
      this.diagnostics.warning(this.subject, 'A hairline (width 0) was read as 0.25 pt.')
      width = 0.25
    }
    const stroke: StrokeStyle = { color, width }
    if (opacity !== null) stroke.opacity = opacity
    const cap = options.get('capstyle')
    if (cap) stroke.cap = cap === 'flat' ? 'butt' : cap === 'round' ? 'round' : 'square'
    const join = options.get('joinstyle')
    if (join === 'miter' || join === 'round' || join === 'bevel') stroke.join = join
    if (options.get('use_custom_dash') === '1') {
      const dash = (options.get('customdash') ?? '')
        .split(';')
        .map(Number)
        .filter((d) => Number.isFinite(d) && d >= 0)
      const unit = options.get('customdash_unit')
      const dashPt = dash.map((d) => roundPt(toPoints(d, unit, this.diagnostics, this.subject)))
      if (dashPt.length && dashPt.some((d) => d > 0)) stroke.dash = dashPt
    } else if (style !== 'solid') {
      const pattern: Record<string, number[]> = {
        dash: [4, 2],
        dot: [1, 2],
        'dash dot': [4, 2, 1, 2],
        'dash dot dot': [4, 2, 1, 2, 1, 2],
      }
      if (pattern[style]) {
        stroke.dash = pattern[style].map((d) => roundPt(d * width))
        this.diagnostics.warning(this.subject, `The "${style}" pen style was read as a dash pattern in line widths.`)
      } else this.diagnostics.warning(this.subject, `The "${style}" pen style was read as solid.`)
    }
    for (const key of ['trim_distance_start', 'trim_distance_end', 'dash_pattern_offset'])
      if (numberOption(options, key)) this.diagnostics.warning(this.subject, `${key.replace(/_/g, ' ')} is not kept.`)
    return stroke
  }

  /** The icon of a marker sub-symbol (one `SvgMarker` or `SimpleMarker`), or null with an error. */
  icon(symbol: XmlElement | undefined): Omit<PointSymbol, 'kind' | 'label'> | null {
    const layers = symbol ? enabledLayers(symbol, this.diagnostics, this.subject) : []
    if (!layers.length) {
      this.diagnostics.error(this.subject, 'A marker has no symbol layer to read.')
      return null
    }
    if (layers.length > 1) this.diagnostics.warning(this.subject, 'Only the first layer of a stacked marker was read.')
    const alpha = this.alpha * Number(attr(symbol!, 'alpha') ?? 1)
    return new SymbolReader(this.diagnostics, this.subject, alpha).markerLayer(layers[0])
  }

  markerLayer(element: XmlElement): Omit<PointSymbol, 'kind' | 'label'> | null {
    const cls = attr(element, 'class')
    const options = readOptions(element)
    if (cls === 'SvgMarker') {
      const name = options.get('name') ?? ''
      const svg = name.startsWith('base64:') ? safeBase64(name.slice(7)) : null
      const icon = svg ? iconFromSvg(svg) : null
      if (!svg || !icon) {
        this.diagnostics.error(
          this.subject,
          `${svg ? 'A foreign SVG' : `The SVG file "${name.slice(0, 80)}"`} marks this symbol; choose a PGMaps icon.`,
        )
        return null
      }
      const read = svgValues(svg)
      if (read) return { icon, ...read }
      this.diagnostics.warning(this.subject, 'An older PGMaps icon SVG: its size and colour were read from the marker.')
      const side = this.ptWithUnit(options, 'size', 'size_unit', 2)
      const widest = Math.max(0, ...ICONS[icon].parts.map((part) => part.width ?? 0))
      return { icon, size: roundPt(side / (1 + widest)), color: splitColor(this.color(options.get('color'))).color }
    }
    if (cls === 'SimpleMarker') {
      const shape = options.get('name') ?? 'circle'
      const icon = iconForMarkerName(shape)
      if (!icon) {
        this.diagnostics.error(this.subject, `The "${shape}" marker shape has no PGMaps icon; choose one.`)
        return null
      }
      if (icon !== shape)
        this.diagnostics.warning(this.subject, `The "${shape}" marker was drawn with the PGMaps "${icon}" icon.`)
      const fill = splitColor(this.color(options.get('color')))
      const outline =
        options.get('outline_style') === 'no' ? null : splitColor(this.color(options.get('outline_color')))
      return {
        icon,
        size: this.ptWithUnit(options, 'size', 'size_unit', 2),
        color: fill.color,
        ...(outline && outline.color !== fill.color ? { secondary: outline.color } : {}),
      }
    }
    if (cls === 'FontMarker') {
      this.diagnostics.error(this.subject, 'A marker is drawn from a symbol font; choose a PGMaps icon.')
      return null
    }
    this.diagnostics.error(this.subject, `${cls} markers are not read; choose a PGMaps icon.`)
    return null
  }
}

function safeBase64(value: string): string | null {
  try {
    return utf8FromBase64(value)
  } catch {
    return null
  }
}

/** The values `pgmapsIconSvg` writes into the SVG. */
function svgValues(svg: string): Omit<PointSymbol, 'kind' | 'label' | 'icon'> | null {
  const read = (name: string) => new RegExp(`data-pgmaps-${name}="([^"]*)"`).exec(svg)?.[1]
  const unescape = (value: string) =>
    value
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  const size = Number(read('size'))
  const color = read('color')
  if (!Number.isFinite(size) || !color) return null
  const secondary = read('secondary')
  const halo = read('halo')
  const [haloColor, haloWidth] = halo ? unescape(halo).split(' ') : []
  return {
    size,
    color: unescape(color),
    ...(secondary ? { secondary: unescape(secondary) } : {}),
    ...(halo && haloColor && Number.isFinite(Number(haloWidth))
      ? { halo: { color: haloColor, width: Number(haloWidth) } }
      : {}),
  }
}

/** A symbol's layers QGIS draws, reporting the switched-off ones. */
function enabledLayers(symbol: XmlElement, diagnostics: Diagnostics, subject: string): XmlElement[] {
  return childElements(symbol, 'layer').filter((layer) => {
    if (attr(layer, 'enabled') === '0') {
      diagnostics.info(subject, `A switched-off ${attr(layer, 'class')} layer was left out.`)
      return false
    }
    return true
  })
}

const subSymbol = (layer: XmlElement) => childElements(layer, 'symbol')[0]

function readLine(symbol: XmlElement, reader: SymbolReader, label: string): SheetSymbol | null {
  const layers: LineLayer[] = []
  const markers: LineMarker[] = []
  const { diagnostics, subject } = reader
  for (const element of enabledLayers(symbol, diagnostics, subject)) {
    const cls = attr(element, 'class')
    const options = readOptions(element)
    if (cls === 'SimpleLine') {
      const stroke = reader.stroke(options)
      if (!stroke) continue
      const offset = reader.pt(options, 'offset')
      if (markers.length) diagnostics.warning(subject, 'A stroke above a marker line is drawn below the markers.')
      layers.push(offset ? { ...stroke, offset } : stroke)
    } else if (cls === 'MarkerLine' || cls === 'HashLine') {
      const placement = (options.get('placements') ?? options.get('placement') ?? 'interval').toLowerCase()
      if (placement !== 'interval') {
        diagnostics.error(subject, `Markers placed "${placement}" are not read; PGMaps repeats markers at an interval.`)
        continue
      }
      if (options.get('rotate') === '0')
        diagnostics.warning(subject, 'Markers that do not turn with the line were read as turning.')
      const spacing = reader.pt(options, 'interval', 3)
      const start = reader.pt(options, 'offset_along_line')
      const offset = reader.pt(options, 'offset')
      let icon: Omit<PointSymbol, 'kind' | 'label'> | null
      if (cls === 'HashLine') {
        const stroke = new SymbolReader(diagnostics, subject, reader.alpha).stroke(
          readOptions(childElements(subSymbol(element) ?? element, 'layer')[0] ?? element),
        )
        icon = { icon: 'tick', size: reader.pt(options, 'hash_length', 3), color: stroke?.color ?? '#000000' }
        diagnostics.warning(
          subject,
          'A hash line was read as PGMaps tick markers, whose stroke width follows their length.',
        )
      } else icon = reader.icon(subSymbol(element))
      if (!icon || !(spacing > 0)) continue
      markers.push({
        icon: icon.icon,
        spacing,
        size: icon.size,
        color: icon.color,
        ...(icon.secondary ? { secondary: icon.secondary } : {}),
        ...(start !== roundPt(spacing / 2) ? { start } : {}),
        ...(offset ? { offset } : {}),
      })
    } else diagnostics.error(subject, `${cls} line layers are not read.`)
  }
  if (!layers.length && !markers.length) return null
  return { kind: 'line', label, layers, ...(markers.length ? { markers } : {}) }
}

/** Qt brush hatches as our hatches: Qt draws them about 8 px apart whatever the scale. */
const BRUSH_HATCHES: Record<string, number[]> = {
  horizontal: [0],
  vertical: [90],
  cross: [0, 90],
  b_diagonal: [45],
  f_diagonal: [135],
  diagonal_x: [45, 135],
}
const BRUSH_SPACING_PT = 6

function readFill(symbol: XmlElement, reader: SymbolReader, label: string): SheetSymbol | null {
  const { diagnostics, subject } = reader
  const area: AreaSymbol = { kind: 'area', label, outline: [] }
  const hatches: Hatch[] = []
  let markerFill: MarkerFill | undefined
  const outline: OutlineLayer[] = []
  const fillOnce = (color: Rgba) => {
    if (area.fill) {
      diagnostics.warning(subject, 'Only the first solid fill was read.')
      return
    }
    const { color: hex, opacity } = splitColor(color)
    area.fill = hex
    if (opacity !== null) area.fillOpacity = opacity
  }
  for (const element of enabledLayers(symbol, diagnostics, subject)) {
    const cls = attr(element, 'class')
    const options = readOptions(element)
    if (cls === 'SimpleFill') {
      const style = options.get('style') ?? 'solid'
      const color = reader.color(options.get('color'))
      if (style === 'solid') fillOnce(color)
      else if (BRUSH_HATCHES[style]) {
        const { color: hex, opacity } = splitColor(color)
        for (const angleDeg of BRUSH_HATCHES[style])
          hatches.push({
            angleDeg,
            spacing: BRUSH_SPACING_PT,
            stroke: { color: hex, width: 0.75, ...(opacity !== null ? { opacity } : {}) },
          })
        diagnostics.warning(subject, `The "${style}" brush was read as hatching ${BRUSH_SPACING_PT} pt apart.`)
      } else if (/^dense\d$/.test(style)) {
        const share = [0, 0.94, 0.88, 0.63, 0.5, 0.37, 0.12, 0.06][Number(style.slice(5))] ?? 0.5
        fillOnce({ ...color, a: color.a * share })
        diagnostics.warning(subject, `The "${style}" brush was read as a ${Math.round(share * 100)} % fill.`)
      } else if (style !== 'no') diagnostics.warning(subject, `The "${style}" brush was left out.`)
      const stroke = reader.stroke(options, 'outline_width', 'outline_color', 'outline_style')
      if (stroke) {
        if (hatches.length || markerFill)
          diagnostics.warning(subject, 'A fill outline is drawn over the hatching above it.')
        outline.push(stroke)
      }
      if (options.get('offset') && options.get('offset') !== '0,0')
        diagnostics.warning(subject, 'A fill offset is not kept.')
    } else if (cls === 'LinePatternFill') {
      const sub = subSymbol(element)
      const lines = sub ? enabledLayers(sub, diagnostics, subject).filter((l) => attr(l, 'class') === 'SimpleLine') : []
      if (!lines.length) {
        diagnostics.error(subject, 'A line pattern without a simple line was left out.')
        continue
      }
      if (lines.length > 1) diagnostics.warning(subject, 'Only the first line of a hatch was read.')
      const subReader = new SymbolReader(diagnostics, subject, reader.alpha * Number(attr(sub!, 'alpha') ?? 1))
      const stroke = subReader.stroke(readOptions(lines[0]))
      if (!stroke) continue
      const phase = reader.pt(options, 'offset')
      hatches.push({
        angleDeg: numberOption(options, options.has('angle') ? 'angle' : 'lineangle', 45),
        spacing: reader.pt(options, 'distance', 5),
        stroke,
        ...(phase ? { phase } : {}),
      })
    } else if (cls === 'PointPatternFill') {
      if (markerFill) {
        diagnostics.warning(subject, 'Only the first marker fill was read.')
        continue
      }
      const icon = reader.icon(subSymbol(element))
      if (!icon) continue
      const spacingX = reader.ptWithUnit(options, 'distance_x', 'distance_x_unit', 5)
      const spacingY = reader.ptWithUnit(options, 'distance_y', 'distance_y_unit', 5)
      const shiftX = reader.ptWithUnit(options, 'displacement_x', 'displacement_x_unit')
      const shiftY = reader.ptWithUnit(options, 'displacement_y', 'displacement_y_unit')
      const stagger = shiftX !== 0
      if (stagger && Math.abs(shiftX - spacingX / 2) > 0.01)
        diagnostics.warning(subject, 'A row displacement other than half the spacing was read as a half-pitch stagger.')
      if (shiftY) diagnostics.warning(subject, 'A column displacement is not kept.')
      if (numberOption(options, 'random_deviation_x') || numberOption(options, 'random_deviation_y'))
        diagnostics.warning(subject, 'Random marker deviation is not kept.')
      markerFill = {
        icon: icon.icon,
        size: icon.size,
        color: icon.color,
        ...(icon.secondary ? { secondary: icon.secondary } : {}),
        spacingX,
        spacingY,
        ...(stagger ? { stagger: true } : {}),
      }
    } else if (cls === 'SimpleLine') {
      const stroke = reader.stroke(options)
      if (!stroke) continue
      const inside = options.get('draw_inside_polygon') === '1'
      if (reader.pt(options, 'offset')) diagnostics.warning(subject, 'An outline offset is not kept.')
      outline.push(inside ? { ...stroke, width: roundPt(stroke.width / 2), inside: true } : stroke)
    } else diagnostics.error(subject, `${cls} fill layers are not read.`)
  }
  if (hatches.length) area.hatches = hatches
  if (markerFill) area.markerFill = markerFill
  area.outline = outline
  if (!area.fill && !hatches.length && !markerFill && !outline.length) return null
  return area
}

function readMarker(symbol: XmlElement, reader: SymbolReader, label: string): PointSymbol | null {
  const layers = enabledLayers(symbol, reader.diagnostics, reader.subject)
  if (!layers.length) return null
  if (layers.length > 1)
    reader.diagnostics.warning(reader.subject, 'Only the first layer of a stacked marker was read.')
  const icon = reader.markerLayer(layers[0])
  return icon ? { kind: 'point', label, ...icon } : null
}

/**
 * A `<symbol>` as a sheet symbol labelled `label`, or null when nothing in it could be read (the
 * reasons are in `diagnostics`).
 */
export function readQgisSymbol(
  symbol: XmlElement,
  label: string,
  diagnostics: Diagnostics,
  subject = label,
): SheetSymbol | null {
  const alpha = Number(attr(symbol, 'alpha') ?? 1)
  const reader = new SymbolReader(diagnostics, subject, Number.isFinite(alpha) ? alpha : 1)
  const type = attr(symbol, 'type')
  const read =
    type === 'line'
      ? readLine(symbol, reader, label)
      : type === 'fill'
        ? readFill(symbol, reader, label)
        : type === 'marker'
          ? readMarker(symbol, reader, label)
          : null
  if (!read) diagnostics.error(subject, `Nothing in the ${type ?? 'unknown'} symbol could be read.`)
  return read
}

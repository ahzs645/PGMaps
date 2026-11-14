/**
 * Reads the look out of a QGIS layer style file (`.qml`), so a layer exported from QGIS can
 * arrive looking as it did there. It reads one symbol: the first symbol of the renderer and that
 * symbol's first layer, which covers a single-symbol style in full and gives the first class of a
 * categorised or graduated one. Everything it could not carry over is returned as a note for the
 * person to read, never dropped silently. Written from the QML format itself; no QGIS code.
 * No DOM or network access.
 */
import {
  DASH_PATTERN_LIMITS,
  SYMBOL_GROUND_WIDTH_LIMITS,
  SYMBOL_SIZE_LIMITS,
  SYMBOL_WIDTH_LIMITS,
  type AreaPattern,
  type LineDash,
  type PointIcon,
  type SymbolStyle,
} from './symbolStyle'

export interface QmlLook {
  shape: 'point' | 'line' | 'area'
  style: SymbolStyle
  /** What the file asks for that the look does not carry. */
  notes: string[]
}

const SHAPES = { marker: 'point', line: 'line', fill: 'area' } as const
/** Points to one of each QGIS render unit. */
const POINTS_PER_UNIT: Record<string, number> = { MM: 72 / 25.4, Point: 1, Pixel: 0.75, Inch: 72 }
const PEN_STYLES: Record<string, { dash: LineDash; dashPattern?: number[] }> = {
  solid: { dash: 'solid' },
  dash: { dash: 'dashed' },
  dot: { dash: 'dotted' },
  'dash dot': { dash: 'dash-dot' },
  'dash dot dot': { dash: 'custom', dashPattern: [5, 2, 1, 2, 1, 2] },
}
/** Qt brush styles: `b_diagonal` rises to the right, `f_diagonal` falls. */
const BRUSH_STYLES: Record<string, AreaPattern> = {
  solid: 'solid',
  horizontal: 'horizontal',
  vertical: 'vertical',
  cross: 'grid',
  b_diagonal: 'diagonal',
  f_diagonal: 'backslash',
  diagonal_x: 'crosshatch',
}
const MARKER_SHAPES: Record<string, PointIcon> = { circle: 'dot', diamond: 'diamond', cross: 'cross', cross2: 'cross' }

const attributes = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(([, name, value]) => [name, value]))

/** A symbol layer's options, from either the `<Option name value>` or the older `<prop k v>` form. */
function options(block: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, tag] of block.matchAll(/<(?:Option|prop)\b([^>]*)>/g)) {
    const { name, k, value, v } = attributes(tag)
    const key = name ?? k
    if (key !== undefined && (value ?? v) !== undefined && !found.has(key)) found.set(key, value ?? v)
  }
  return found
}

/** `r,g,b,a` (QGIS may append more) as a colour and an opacity. */
function colour(value: string | undefined): { color: string; opacity: number } | null {
  const parts = (value ?? '').split(',').slice(0, 4).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !(part >= 0 && part <= 255))) return null
  return {
    color: `#${parts
      .slice(0, 3)
      .map((part) => Math.round(part).toString(16).padStart(2, '0'))
      .join('')}`,
    opacity: Number.isFinite(parts[3]) ? Math.round((parts[3] / 255) * 100) / 100 : 1,
  }
}

const within = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value))
/** To the nearest step, without the float dust a division leaves (1.4000000000000001). */
const round = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(4))

/** A width or size option in the look's own units, with a note when the file's unit has no equivalent. */
function measure(
  found: Map<string, string>,
  key: string,
  notes: string[],
  what: string,
): { points?: number; metres?: number } {
  const value = Number(found.get(key))
  if (!(value > 0)) return {}
  const unit = found.get(`${key}_unit`) ?? 'MM'
  if (unit === 'RenderMetersInMapUnits') return { metres: value }
  if (POINTS_PER_UNIT[unit] === undefined) {
    notes.push(`The ${what} is in ${unit}, which has no fixed size here; it keeps the layer's own.`)
    return {}
  }
  return { points: value * POINTS_PER_UNIT[unit] }
}

function readLine(found: Map<string, string>, prefix: 'line' | 'outline', notes: string[]): SymbolStyle {
  const style: SymbolStyle = {}
  const what = prefix === 'line' ? 'line width' : 'outline width'
  const { points, metres } = measure(found, `${prefix}_width`, notes, what)
  if (points !== undefined) style.width = round(within(points, SYMBOL_WIDTH_LIMITS), 0.05)
  if (metres !== undefined) style.widthM = round(within(metres, SYMBOL_GROUND_WIDTH_LIMITS), 0.1)
  const pen = found.get(`${prefix}_style`)
  if (pen === 'no')
    notes.push(`The ${prefix === 'line' ? 'line' : 'outline'} is switched off in QGIS; it is drawn here.`)
  else if (pen && PEN_STYLES[pen]) Object.assign(style, PEN_STYLES[pen])
  if (prefix === 'line' && found.get('use_custom_dash') === '1') {
    // QGIS gives custom dash lengths in a unit of their own; a look counts them in line widths.
    const perUnit = POINTS_PER_UNIT[found.get('customdash_unit') ?? 'MM']
    const width = points ?? 1
    const lengths = (found.get('customdash') ?? '')
      .split(';')
      .map(Number)
      .map((length) => round(within((length * (perUnit ?? 1)) / width, DASH_PATTERN_LIMITS), 0.05))
    if (perUnit && lengths.length >= DASH_PATTERN_LIMITS.minParts && lengths.length <= DASH_PATTERN_LIMITS.maxParts)
      Object.assign(style, { dash: 'custom', dashPattern: lengths })
    else notes.push('The custom dash could not be read; the line keeps its named style.')
  }
  return style
}

/**
 * The look in a QML file. Throws when the text has no QGIS symbol at all.
 */
export function symbolStyleFromQml(xml: string): QmlLook {
  const symbol = /<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/.exec(xml)
  const type = symbol && attributes(symbol[1]).type
  if (!symbol || !type || !(type in SHAPES)) throw Error('This file has no QGIS symbol to read.')
  const shape = SHAPES[type as keyof typeof SHAPES]
  const notes: string[] = []
  const renderer = attributes(/<renderer-v2\b([^>]*)>/.exec(xml)?.[1] ?? '').type
  if (renderer && renderer !== 'singleSymbol')
    notes.push('This style colours features by their attributes; only its first symbol was read.')
  const layers = [...symbol[2].matchAll(/<layer\b([^>]*)>([\s\S]*?)<\/layer>/g)]
  if (layers.length === 0) throw Error('This file has no QGIS symbol to read.')
  if (layers.length > 1) notes.push(`The symbol has ${layers.length} layers; the first was read.`)
  const layerClass = attributes(layers[0][1]).class ?? ''
  const found = options(layers[0][2])
  const style: SymbolStyle = {}

  if (shape === 'line') {
    const read = colour(found.get('line_color'))
    if (read) style.color = read.color
    Object.assign(style, readLine(found, 'line', notes))
    if (layerClass !== 'SimpleLine') notes.push(`A ${layerClass || 'line'} layer is read as a plain line.`)
  } else if (shape === 'area') {
    const fill = colour(found.get('color'))
    const outline = colour(found.get('outline_color'))
    const brush = found.get('style') ?? 'solid'
    if (layerClass === 'SimpleFill') {
      if (brush === 'no') {
        style.noFill = true
        if (outline) style.color = outline.color
      } else {
        if (fill) Object.assign(style, { color: fill.color, ...(fill.opacity < 1 ? { opacity: fill.opacity } : {}) })
        if (BRUSH_STYLES[brush]) {
          if (brush !== 'solid') Object.assign(style, { pattern: BRUSH_STYLES[brush], noFill: true })
        } else if (/^dense\d$/.test(brush)) Object.assign(style, { pattern: 'dots', noFill: true })
        else notes.push(`The fill style "${brush}" has no match; the area is tinted.`)
        if (outline && fill && outline.color !== fill.color)
          notes.push('The outline has its own colour in QGIS; here a layer has one colour.')
      }
      Object.assign(style, readLine(found, 'outline', notes))
    } else {
      if (fill) style.color = fill.color
      notes.push(`A ${layerClass || 'fill'} layer is read for its colour only.`)
    }
  } else {
    const read = colour(found.get('color'))
    if (read) style.color = read.color
    const { points } = measure(found, 'size', notes, 'point size')
    if (points !== undefined) style.size = Math.round(within(points, SYMBOL_SIZE_LIMITS))
    const name = found.get('name')
    if (layerClass !== 'SimpleMarker') notes.push(`A ${layerClass || 'marker'} layer is drawn as a dot.`)
    else if (name && MARKER_SHAPES[name]) {
      if (MARKER_SHAPES[name] !== 'dot') style.icon = MARKER_SHAPES[name]
    } else if (name) notes.push(`The marker shape "${name}" has no match; the point is drawn as a dot.`)
  }
  return { shape, style, notes }
}

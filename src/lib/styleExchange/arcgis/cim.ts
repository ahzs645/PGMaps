/**
 * PGMaps' `SheetSymbol`s as ArcGIS Pro CIM symbols and back. Names and fields follow the published
 * CIM specification (github.com/Esri/cim-spec, v3, CIMSymbols.md); shapes were checked against
 * files Pro wrote (Esri's Parks.stylx and Calls.stylx, Fire_Stations.lyrx and FlowLines.lyrx).
 *
 * - CIM symbol layers draw index 0 on top; ours are bottom first, so every list is reversed.
 * - Strokes are `CIMSolidStroke`, dashes `CIMGeometricEffectDashes`, sideways offsets
 *   `CIMGeometricEffectOffset`. CIM's offset is positive to the left of travel (outward on a polygon's
 *   clockwise ring), ours to the right, so the sign flips.
 * - Icons are `CIMVectorMarker`s drawn from `iconShapes` (y flipped up), one marker layer per icon
 *   part so the drawing order rests on the symbol-layer order alone. Each layer is named
 *   `pgmaps-icon:<icon>:<part>` (`pgmaps-icon-halo:…` for a point's halo pass); a reader accepts a
 *   vector marker as a PGMaps icon only by that name and part sequence.
 * - An inner casing (`inside`) cannot be clipped to the polygon in CIM; it is written as a stroke of
 *   the same width moved inward by half its width with an Offset effect, which is the same band.
 * - Glyphs from symbol fonts (`CIMCharacterMarker`) and pictures are never read into shapes: the
 *   reader reports them as errors and asks for a PGMaps icon instead.
 * No DOM or network access.
 */
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import { ICONS, ICON_IDS, type IconDef, type IconId } from '@/lib/mapSheet/icons'
import type {
  AreaSymbol,
  Hatch,
  LineLayer,
  LineMarker,
  LineSymbol,
  MarkerFill,
  OutlineLayer,
  PointSymbol,
  SheetSymbol,
} from '@/lib/mapSheet/symbols'
import { checkedSheetSymbol } from '../checkedSymbol'
import { toHex, toHexAlpha, type Rgba } from '../color'
import { iconShapes } from '../iconGeometry'
import type { ExchangeDiagnostic, ExchangeFormat } from '../model'
import {
  cimColor,
  colorFromCim,
  diagnostic,
  finite,
  isRecord,
  records,
  text,
  trim,
  type ColorForm,
  type Json,
} from './cimCommon'

export const ICON_PRIMITIVE = 'pgmaps-icon'
export const HALO_PRIMITIVE = 'pgmaps-icon-halo'
export const CLASS_PRIMITIVE = 'pgmaps-class'

export interface CimWriteOptions {
  /** `cim` for layer, map and layout files; `compact` for a style (`.stylx`). */
  colors?: ColorForm
  format?: ExchangeFormat
}

const CAP = { butt: 'Butt', round: 'Round', square: 'Square' } as const
const JOIN = { miter: 'Miter', round: 'Round', bevel: 'Bevel' } as const
const OFFSET_METHOD = { miter: 'Mitered', round: 'Rounded', bevel: 'Bevelled' } as const

interface Writer {
  form: ColorForm
  notes: string[]
}

/** Odd dash lists repeat twice in PDF and canvas; CIM gets the doubled list so it cannot differ. */
const dashTemplate = (dash: number[]) => (dash.length % 2 ? [...dash, ...dash] : dash).map((d) => trim(d))

function solidStroke(stroke: StrokeStyle, w: Writer, cimOffset = 0, primitiveName?: string): Json {
  const effects: Json[] = []
  if (cimOffset)
    effects.push({
      type: 'CIMGeometricEffectOffset',
      method: OFFSET_METHOD[stroke.join ?? 'miter'],
      offset: trim(cimOffset),
      option: 'Accurate',
    })
  if (stroke.dash?.length)
    effects.push({
      type: 'CIMGeometricEffectDashes',
      dashTemplate: dashTemplate(stroke.dash),
      lineDashEnding: 'NoConstraint',
      offsetAlongLine: 0,
      controlPointEnding: 'NoConstraint',
    })
  return {
    type: 'CIMSolidStroke',
    ...(effects.length ? { effects } : {}),
    enable: true,
    ...(primitiveName ? { primitiveName } : {}),
    capStyle: CAP[stroke.cap ?? 'butt'],
    joinStyle: JOIN[stroke.join ?? 'miter'],
    lineStyle3D: 'Strip',
    miterLimit: 10,
    width: trim(stroke.width),
    height3D: 1,
    anchor3D: 'Center',
    color: cimColor(stroke.color, stroke.opacity ?? 1, w.form),
  }
}

const solidFill = (color: string, opacity: number, w: Writer, primitiveName?: string): Json => ({
  type: 'CIMSolidFill',
  enable: true,
  ...(primitiveName ? { primitiveName } : {}),
  color: cimColor(color, opacity, w.form),
})

const iconParts = (icon: IconId) => (ICONS[icon] as IconDef).parts

/** Closes nothing and copies nothing: reverses a ring that runs counter-clockwise with y up. */
function clockwise(ring: number[][]): number[][] {
  let twiceArea = 0
  for (let i = 0; i + 1 < ring.length; i++) twiceArea += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return twiceArea > 0 ? [...ring].reverse() : ring
}

interface IconSpec {
  icon: IconId
  size: number
  primary: string
  secondary?: string
  halo?: { color: string; width: number }
  placement?: Json
}

/** The icon as vector marker layers, bottom first: the halo pass, then the body, one layer per part. */
function iconLayers(spec: IconSpec, w: Writer): Json[] {
  const { icon, size } = spec
  const parts = iconParts(icon)
  // The sheet draws an unset secondary colour white (`iconOps`); so does this.
  const shapes = iconShapes(icon, { primary: spec.primary, secondary: spec.secondary ?? '#ffffff' })
  const half = size / 2
  const frame = { xmin: trim(-half), ymin: trim(-half), xmax: trim(half), ymax: trim(half) }
  const layers: Json[] = []
  const passes = spec.halo ? (['halo', 'body'] as const) : (['body'] as const)
  for (const pass of passes)
    shapes.forEach((shape, index) => {
      const width = (parts[index].width ?? 0) * size
      const round = { cap: 'round', join: 'round' } as const
      let stroke: StrokeStyle | undefined
      let fill: string | undefined
      if (pass === 'halo' && spec.halo) {
        stroke = { color: spec.halo.color, width: width + spec.halo.width * 2, ...round }
        fill = shape.fill ? spec.halo.color : undefined
      } else {
        stroke = shape.stroke ? { color: shape.stroke.color, width, ...round } : undefined
        fill = shape.fill
      }
      const points = shape.points.map(([x, y]) => [trim(x * size, 5), trim(-y * size, 5)])
      const polygon = shape.kind === 'polygon'
      const symbol = polygon
        ? {
            type: 'CIMPolygonSymbol',
            symbolLayers: [stroke && solidStroke(stroke, w), fill && solidFill(fill, 1, w)].filter(Boolean),
            angleAlignment: 'Map',
          }
        : { type: 'CIMLineSymbol', symbolLayers: stroke ? [solidStroke(stroke, w)] : [] }
      layers.push({
        type: 'CIMVectorMarker',
        enable: true,
        primitiveName: `${pass === 'halo' ? HALO_PRIMITIVE : ICON_PRIMITIVE}:${icon}:${index}`,
        anchorPointUnits: 'Relative',
        dominantSizeAxis3D: 'Y',
        size: trim(size),
        billboardMode3D: 'FaceNearPlane',
        ...(spec.placement ? { markerPlacement: spec.placement } : {}),
        frame,
        markerGraphics: [
          {
            type: 'CIMMarkerGraphic',
            geometry: polygon ? { rings: [clockwise(points)] } : { paths: [points] },
            symbol,
          },
        ],
        scaleSymbolsProportionally: true,
        respectFrame: true,
      })
    })
  return layers
}

function alongLine(marker: LineMarker, w: Writer): Json {
  const halfGap = marker.start === undefined || Math.abs(marker.start - marker.spacing / 2) < 1e-9
  if (!halfGap)
    w.notes.push(
      `A first marker ${trim(marker.start ?? 0)} pt from the start is written as "No constraint" endings with an offset along the line.`,
    )
  return {
    type: 'CIMMarkerPlacementAlongLineSameSize',
    placePerPart: true,
    angleToLine: true,
    ...(marker.offset ? { offset: trim(-marker.offset) } : {}),
    endings: halfGap ? 'WithHalfGap' : 'NoConstraint',
    ...(halfGap ? {} : { offsetAlongLine: trim(marker.start ?? 0) }),
    placementTemplate: [trim(marker.spacing)],
  }
}

const insidePolygon = (fill: MarkerFill): Json => ({
  type: 'CIMMarkerPlacementInsidePolygon',
  placePerPart: false,
  gridAngle: 0,
  gridType: 'Fixed',
  offsetX: 0,
  offsetY: 0,
  randomness: 100,
  seed: 0,
  shiftOddRows: Boolean(fill.stagger),
  stepX: trim(fill.spacingX),
  stepY: trim(fill.spacingY),
  clipping: 'ClipAtBoundary',
})

function hatchFill(hatch: Hatch, w: Writer): Json {
  return {
    type: 'CIMHatchFill',
    enable: true,
    lineSymbol: { type: 'CIMLineSymbol', symbolLayers: [solidStroke(hatch.stroke, w)] },
    rotation: trim(hatch.angleDeg),
    separation: trim(hatch.spacing),
    // CIM's y runs across the hatch lines, to their left; our phase runs to their right.
    ...(hatch.phase ? { offsetY: trim(-hatch.phase) } : {}),
  }
}

function lineLayersBottomFirst(symbol: LineSymbol, w: Writer): Json[] {
  return [
    ...symbol.layers.map((layer) => solidStroke(layer, w, layer.offset ? -layer.offset : 0)),
    ...(symbol.markers ?? []).flatMap((marker) =>
      iconLayers(
        {
          icon: marker.icon,
          size: marker.size,
          primary: marker.color,
          secondary: marker.secondary,
          placement: alongLine(marker, w),
        },
        w,
      ),
    ),
  ]
}

function areaLayersBottomFirst(symbol: AreaSymbol, w: Writer): Json[] {
  const layers: Json[] = []
  if (symbol.fill) layers.push(solidFill(symbol.fill, symbol.fillOpacity ?? 1, w))
  for (const hatch of symbol.hatches ?? []) layers.push(hatchFill(hatch, w))
  if (symbol.markerFill) {
    const fill = symbol.markerFill
    layers.push(
      ...iconLayers(
        {
          icon: fill.icon,
          size: fill.size,
          primary: fill.color,
          secondary: fill.secondary,
          placement: insidePolygon(fill),
        },
        w,
      ),
    )
  }
  for (const outline of symbol.outline) {
    if (outline.inside)
      w.notes.push(
        'The inner casing is a stroke moved inward by half its width (Offset effect); CIM cannot clip a stroke to the polygon.',
      )
    layers.push(solidStroke(outline, w, outline.inside ? -outline.width / 2 : 0))
  }
  return layers
}

/** The CIM symbol for a sheet symbol, and notes on what was approximated. */
export function cimSymbol(
  symbol: SheetSymbol,
  options: CimWriteOptions = {},
): { symbol: Json; diagnostics: ExchangeDiagnostic[] } {
  const w: Writer = { form: options.colors ?? 'cim', notes: [] }
  let out: Json
  if (symbol.kind === 'line') out = { type: 'CIMLineSymbol', symbolLayers: lineLayersBottomFirst(symbol, w).reverse() }
  else if (symbol.kind === 'area')
    out = { type: 'CIMPolygonSymbol', symbolLayers: areaLayersBottomFirst(symbol, w).reverse(), angleAlignment: 'Map' }
  else if (symbol.kind === 'class')
    out = {
      type: 'CIMPolygonSymbol',
      symbolLayers: [solidFill(symbol.color, symbol.opacity, w, CLASS_PRIMITIVE)],
      angleAlignment: 'Map',
    }
  else
    out = {
      type: 'CIMPointSymbol',
      symbolLayers: iconLayers(
        { icon: symbol.icon, size: symbol.size, primary: symbol.color, secondary: symbol.secondary, halo: symbol.halo },
        w,
      ).reverse(),
      haloSize: 1,
      scaleX: 1,
      angleAlignment: 'Display',
    }
  const format = options.format ?? 'lyrx'
  return {
    symbol: out,
    diagnostics: [...new Set(w.notes)].map((note) => diagnostic(format, 'info', note, symbol.label)),
  }
}

/** `CIMSymbolReference` round a CIM symbol, as renderers hold them. */
export const symbolReference = (symbol: Json): Json => ({ type: 'CIMSymbolReference', symbol })

// ---------------------------------------------------------------------------------------------
// Reading

export interface CimReadOptions {
  /** Legend text for the symbol. */
  label?: string
  /** Put a plain stand-in where nothing could be read, and say so, instead of returning no symbol. */
  substitute?: boolean
  format?: ExchangeFormat
  subject?: string
}

interface Reader {
  format: ExchangeFormat
  subject?: string
  diagnostics: ExchangeDiagnostic[]
  /** First colour seen, for stand-ins. */
  firstColor?: Rgba
}

const say = (r: Reader, severity: ExchangeDiagnostic['severity'], message: string) => {
  if (!r.diagnostics.some((d) => d.message === message && d.severity === severity))
    r.diagnostics.push(diagnostic(r.format, severity, message, r.subject))
}

const FONT_ERROR = 'choose a PGMaps icon'

function readColor(r: Reader, value: unknown, what: string): Rgba {
  const read = colorFromCim(value)
  if (!read) {
    say(r, 'warning', `${what} has a colour this reader does not know; black is used.`)
    return { r: 0, g: 0, b: 0, a: 1 }
  }
  if (read.approximate) say(r, 'warning', `${what} is ${read.approximate}.`)
  r.firstColor ??= read.color
  return read.color
}

const CAP_BACK: Record<string, StrokeStyle['cap']> = { Butt: 'butt', Round: 'round', Square: 'square' }
const JOIN_BACK: Record<string, StrokeStyle['join']> = { Miter: 'miter', Round: 'round', Bevel: 'bevel' }

/** A stroke and the CIM offset its effects add up to (positive left). */
function readStroke(r: Reader, layer: Json, what: string): { stroke: StrokeStyle; cimOffset: number } {
  const color = readColor(r, layer.color, what)
  const stroke: StrokeStyle = { color: toHex(color), width: Math.max(0, finite(layer.width) ?? 1) }
  if (color.a < 1) stroke.opacity = trim(color.a, 4)
  const cap = CAP_BACK[text(layer.capStyle) ?? 'Butt']
  const join = JOIN_BACK[text(layer.joinStyle) ?? 'Miter']
  if (cap && cap !== 'butt') stroke.cap = cap
  if (join && join !== 'miter') stroke.join = join
  let cimOffset = 0
  for (const effect of records(layer.effects)) {
    if (effect.type === 'CIMGeometricEffectOffset') cimOffset += finite(effect.offset) ?? 0
    else if (effect.type === 'CIMGeometricEffectDashes') {
      const dash = Array.isArray(effect.dashTemplate)
        ? effect.dashTemplate.filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d >= 0)
        : []
      if (dash.length && dash.some((d) => d > 0)) stroke.dash = dash.map((d) => trim(d))
      const ending = text(effect.lineDashEnding) ?? 'NoConstraint'
      if (ending !== 'NoConstraint')
        say(
          r,
          'warning',
          `${what}: Pro fits the dashes to each line's ends ("${ending}"); PGMaps starts them at the line's start.`,
        )
      if (finite(effect.offsetAlongLine))
        say(r, 'warning', `${what}: the dash pattern's shift along the line is not carried.`)
    } else say(r, 'warning', `${what}: the ${text(effect.type) ?? 'unknown'} effect is not carried.`)
  }
  return { stroke, cimOffset }
}

interface IconGroup {
  icon: IconId
  size: number
  primary: string
  secondary?: string
  halo?: { color: string; width: number }
  placement?: Json
  /** Layers used, bottom first. */
  count: number
}

const NAME_PATTERN = new RegExp(`^(${ICON_PRIMITIVE}|${HALO_PRIMITIVE}):([a-z-]+):(\\d+)$`)
function iconName(layer: Json | undefined) {
  const match = layer?.type === 'CIMVectorMarker' ? NAME_PATTERN.exec(text(layer.primitiveName) ?? '') : null
  if (!match || !(ICON_IDS as string[]).includes(match[2])) return null
  return { halo: match[1] === HALO_PRIMITIVE, icon: match[2] as IconId, part: Number(match[3]) }
}

function graphicLayers(layer: Json): Json[] {
  const graphic = records(layer.markerGraphics)[0]
  return isRecord(graphic?.symbol) ? records(graphic.symbol.symbolLayers) : []
}
const layerOf = (layers: Json[], type: string) => layers.find((layer) => layer.type === type)

function bbox(layer: Json): number[] | null {
  const geometry = records(layer.markerGraphics)[0]?.geometry
  if (!isRecord(geometry)) return null
  const lists = (
    Array.isArray(geometry.rings) ? geometry.rings : Array.isArray(geometry.paths) ? geometry.paths : []
  ) as unknown[]
  const points = lists.flatMap((list) => (Array.isArray(list) ? list : [])).filter(Array.isArray) as number[][]
  if (!points.length) return null
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Reads the PGMaps icon whose layers start at `start` (bottom first); `count` 0 when there is none. */
function readIconGroup(r: Reader, layers: Json[], start: number): IconGroup | null {
  const first = iconName(layers[start])
  if (!first) return null
  const { icon } = first
  const parts = iconParts(icon)
  let i = start
  const halo: Json[] = []
  const body: Json[] = []
  while (i < layers.length) {
    const name = iconName(layers[i])
    if (!name || name.icon !== icon) break
    const list = name.halo ? halo : body
    if (name.part !== list.length || (name.halo && body.length) || list.length >= parts.length) break
    list.push(layers[i])
    i++
    if (body.length === parts.length) break
  }
  const placementKey = (layer: Json) => JSON.stringify(layer.markerPlacement ?? null)
  const all = [...halo, ...body]
  if (
    body.length !== parts.length ||
    (halo.length && halo.length !== parts.length) ||
    all.some((layer) => placementKey(layer) !== placementKey(all[0]) || layer.size !== all[0].size)
  ) {
    say(r, 'error', `The ${icon} icon was edited in ArcGIS (parts missing, reordered or placed apart); ${FONT_ERROR}.`)
    return { icon, size: 0, primary: '#000000', count: Math.max(1, i - start) }
  }
  const size = finite(body[0].size) ?? 6
  let primary: string | undefined
  let secondary: string | undefined
  body.forEach((layer, index) => {
    const symbolLayers = graphicLayers(layer)
    const part = parts[index]
    const fill = layerOf(symbolLayers, 'CIMSolidFill')
    const stroke = layerOf(symbolLayers, 'CIMSolidStroke')
    const take = (paint: string | undefined, source: Json | undefined) => {
      if (!source || (paint !== 'primary' && paint !== 'secondary')) return
      const color = toHexAlpha(readColor(r, source.color, `The ${icon} icon`))
      if (paint === 'primary') primary ??= color
      else secondary ??= color
    }
    take(part.fill, fill)
    take(part.stroke, stroke)
  })
  // The edited-shape check: each part's extent against the one PGMaps draws.
  const expected = iconShapes(icon, { primary: '#000000' })
  const tolerance = Math.max(0.02 * size, 1e-6)
  const moved = body.some((layer, index) => {
    const box = bbox(layer)
    const points = expected[index].points.map(([x, y]) => [x * size, -y * size])
    const want = [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ]
    return !box || box.some((value, k) => Math.abs(value - want[k]) > tolerance)
  })
  if (moved) say(r, 'warning', `The ${icon} icon's shape was edited in ArcGIS; PGMaps draws its own ${icon} icon.`)
  const group: IconGroup = { icon, size, primary: primary ?? '#000000', count: all.length }
  if (secondary && secondary !== '#ffffff') group.secondary = secondary
  if (halo.length) {
    const stroke = layerOf(graphicLayers(halo[0]), 'CIMSolidStroke')
    const partWidth = (parts[0].width ?? 0) * size
    if (stroke)
      group.halo = {
        color: toHexAlpha(readColor(r, stroke.color, `The ${icon} icon's halo`)),
        width: trim(Math.max(0, ((finite(stroke.width) ?? partWidth) - partWidth) / 2)),
      }
  }
  if (body[0].markerPlacement) group.placement = body[0].markerPlacement as Json
  for (const key of ['rotation', 'offsetX', 'offsetY'] as const)
    if (finite(body[0][key])) say(r, 'warning', `The ${icon} icon's ${key} is not carried.`)
  return group
}

/** Why a layer that is not ours cannot be read. */
function foreignLayer(r: Reader, layer: Json) {
  const type = text(layer.type) ?? 'unknown'
  if (type === 'CIMCharacterMarker') {
    const font = text(layer.fontFamilyName) ?? 'a symbol font'
    const index = finite(layer.characterIndex)
    say(
      r,
      'error',
      `A marker is drawn from a symbol font (${font}${index === undefined ? '' : ` #${index}`}); ${FONT_ERROR}.`,
    )
  } else if (type === 'CIMPictureMarker') say(r, 'error', `A marker is a picture; ${FONT_ERROR}.`)
  else if (type === 'CIMVectorMarker') {
    const hasText = records(layer.markerGraphics).some((g) => isRecord(g.symbol) && g.symbol.type === 'CIMTextSymbol')
    say(
      r,
      'error',
      hasText
        ? `A marker draws text from a font; ${FONT_ERROR}.`
        : `A vector marker was drawn in ArcGIS, not a PGMaps icon; ${FONT_ERROR}.`,
    )
  } else if (type === 'CIMPictureFill') say(r, 'error', 'A picture fill is not carried.')
  else if (type === 'CIMGradientFill' || type === 'CIMGradientStroke' || type === 'CIMPictureStroke')
    say(r, 'error', `A ${type.replace(/^CIM/, '')} is not carried.`)
  else say(r, 'error', `A ${type} layer is not carried.`)
}

/** Enabled symbol layers, bottom first. */
function bottomFirst(r: Reader, symbol: Json): Json[] {
  const all = records(symbol.symbolLayers).slice().reverse()
  const on = all.filter((layer) => layer.enable !== false)
  if (on.length < all.length) say(r, 'info', 'Switched-off symbol layers were left out.')
  if (records(symbol.effects).length) say(r, 'warning', 'Effects on the whole symbol are not carried.')
  return on
}

function lineMarkerFrom(r: Reader, group: IconGroup): LineMarker | null {
  const placement = group.placement
  const type = text(placement?.type)
  if (!placement || !type?.startsWith('CIMMarkerPlacementAlongLine')) {
    say(
      r,
      'error',
      `The ${group.icon} icon is placed ${type ? `by ${type}` : 'without a placement'}, which PGMaps does not carry.`,
    )
    return null
  }
  if (type !== 'CIMMarkerPlacementAlongLineSameSize')
    say(r, 'warning', `The ${group.icon} icon's ${type} is read as markers of one size.`)
  const template = Array.isArray(placement.placementTemplate)
    ? placement.placementTemplate.filter((n): n is number => typeof n === 'number' && n > 0)
    : []
  if (template.length > 1) say(r, 'warning', `The ${group.icon} icon's uneven spacing is read as its first gap.`)
  const spacing = template[0] ?? 10
  if (placement.angleToLine === false) say(r, 'warning', `The ${group.icon} icon is turned with the line in PGMaps.`)
  const marker: LineMarker = { icon: group.icon, spacing: trim(spacing), size: group.size, color: group.primary }
  if (group.secondary) marker.secondary = group.secondary
  const ending = text(placement.endings) ?? 'WithHalfGap'
  const along = finite(placement.offsetAlongLine) ?? 0
  let start: number | undefined
  if (ending === 'NoConstraint') start = along
  else if (ending === 'WithMarkers') start = 0
  else if (ending === 'WithFullGap') start = spacing
  else if (ending === 'Custom') start = along
  if (ending !== 'WithHalfGap' && ending !== 'NoConstraint')
    say(r, 'warning', `The ${group.icon} icon's "${ending}" endings are read as a fixed first position.`)
  if (start !== undefined && Math.abs(start - spacing / 2) > 1e-9) marker.start = trim(start)
  const offset = finite(placement.offset)
  if (offset) marker.offset = trim(-offset)
  return marker
}

function markerFillFrom(r: Reader, group: IconGroup): MarkerFill | null {
  const placement = group.placement
  if (placement?.type !== 'CIMMarkerPlacementInsidePolygon') {
    say(
      r,
      'error',
      `The ${group.icon} icon is placed ${text(placement?.type) ?? 'without a placement'} in the area, which PGMaps does not carry.`,
    )
    return null
  }
  if (placement.gridType !== undefined && placement.gridType !== 'Fixed')
    say(r, 'warning', `The ${group.icon} icon's random placement is read as a regular grid.`)
  if (finite(placement.gridAngle)) say(r, 'warning', `The ${group.icon} icon grid's angle is not carried.`)
  const fill: MarkerFill = {
    icon: group.icon,
    size: group.size,
    color: group.primary,
    spacingX: trim(finite(placement.stepX) ?? 16),
    spacingY: trim(finite(placement.stepY) ?? 16),
  }
  if (group.secondary) fill.secondary = group.secondary
  if (placement.shiftOddRows === true) fill.stagger = true
  return fill
}

/** Walks layers bottom first, reading PGMaps icon groups and handing every other layer to `other`. */
function walk(r: Reader, layers: Json[], onIcon: (group: IconGroup) => void, other: (layer: Json) => void) {
  for (let i = 0; i < layers.length; ) {
    const group = readIconGroup(r, layers, i)
    if (group) {
      if (group.size > 0) onIcon(group)
      i += group.count
    } else {
      other(layers[i])
      i++
    }
  }
}

function readLine(r: Reader, symbol: Json, label: string): LineSymbol | null {
  const out: LineSymbol = { kind: 'line', label, layers: [] }
  const markers: LineMarker[] = []
  walk(
    r,
    bottomFirst(r, symbol),
    (group) => {
      const marker = lineMarkerFrom(r, group)
      if (marker) markers.push(marker)
    },
    (layer) => {
      if (layer.type !== 'CIMSolidStroke') return foreignLayer(r, layer)
      if (markers.length) say(r, 'warning', 'A stroke drawn over markers in ArcGIS is drawn under them in PGMaps.')
      const { stroke, cimOffset } = readStroke(r, layer, 'A stroke')
      const read: LineLayer = { ...stroke }
      if (cimOffset) read.offset = trim(-cimOffset)
      out.layers.push(read)
    },
  )
  if (markers.length) out.markers = markers
  return out.layers.length || markers.length ? out : null
}

function readArea(r: Reader, symbol: Json, label: string): AreaSymbol | null {
  const out: AreaSymbol = { kind: 'area', label, outline: [] }
  const hatches: Hatch[] = []
  let stage = 0
  const order = (next: number) => {
    if (next < stage)
      say(r, 'warning', 'Symbol layers are drawn fill, hatches, markers, outline in PGMaps, not in ArcGIS order.')
    stage = Math.max(stage, next)
  }
  walk(
    r,
    bottomFirst(r, symbol),
    (group) => {
      order(2)
      if (out.markerFill) return say(r, 'warning', 'Only the first marker fill is carried.')
      const fill = markerFillFrom(r, group)
      if (fill) out.markerFill = fill
    },
    (layer) => {
      if (layer.type === 'CIMSolidFill') {
        order(0)
        if (out.fill) return say(r, 'warning', 'Only the first solid fill is carried.')
        const color = readColor(r, layer.color, 'The fill')
        out.fill = toHex(color)
        if (color.a < 1) out.fillOpacity = trim(color.a, 4)
      } else if (layer.type === 'CIMHatchFill') {
        order(1)
        const hatch = readHatch(r, layer)
        if (hatch) hatches.push(hatch)
      } else if (layer.type === 'CIMSolidStroke') {
        order(3)
        const { stroke, cimOffset } = readStroke(r, layer, 'The outline')
        const outline: OutlineLayer = { ...stroke }
        if (cimOffset && Math.abs(cimOffset + stroke.width / 2) < 1e-6) outline.inside = true
        else if (cimOffset) say(r, 'warning', 'An outline moved off the edge is drawn on the edge in PGMaps.')
        out.outline.push(outline)
      } else foreignLayer(r, layer)
    },
  )
  if (hatches.length) out.hatches = hatches
  return out.fill || hatches.length || out.markerFill || out.outline.length ? out : null
}

function readHatch(r: Reader, layer: Json): Hatch | null {
  const line = isRecord(layer.lineSymbol) ? layer.lineSymbol : {}
  const strokes = records(line.symbolLayers)
    .slice()
    .reverse()
    .filter((l) => l.enable !== false)
  const solid = strokes.filter((l) => l.type === 'CIMSolidStroke')
  if (!solid.length) {
    say(r, 'error', 'A hatch is drawn with something other than a solid stroke, which is not carried.')
    return null
  }
  if (strokes.length > 1) say(r, 'warning', 'Only one stroke of a hatch line is carried.')
  const { stroke, cimOffset } = readStroke(r, solid[0], 'A hatch')
  if (cimOffset) say(r, 'warning', "A hatch line's offset is not carried.")
  let spacing = finite(layer.separation) ?? 0
  if (!(spacing > 0)) {
    say(r, 'warning', 'A hatch has no separation; 5 pt is used.')
    spacing = 5
  }
  const hatch: Hatch = { angleDeg: trim(finite(layer.rotation) ?? 0), spacing: trim(spacing), stroke }
  if (finite(layer.offsetX)) say(r, 'warning', "A hatch's shift along its lines is not carried.")
  const offsetY = finite(layer.offsetY)
  if (offsetY) hatch.phase = trim(-offsetY)
  return hatch
}

function readPoint(r: Reader, symbol: Json, label: string): PointSymbol | null {
  let point: PointSymbol | null = null
  walk(
    r,
    bottomFirst(r, symbol),
    (group) => {
      if (point) return say(r, 'warning', 'Only the first PGMaps icon of a point symbol is carried.')
      if (group.placement) say(r, 'warning', `The ${group.icon} icon's marker placement is not carried on a point.`)
      point = { kind: 'point', label, icon: group.icon, size: group.size, color: group.primary }
      if (group.secondary) point.secondary = group.secondary
      if (group.halo) point.halo = group.halo
    },
    (layer) => foreignLayer(r, layer),
  )
  return point
}

const largestSize = (symbol: Json) =>
  Math.max(0, ...records(symbol.symbolLayers).map((layer) => finite(layer.size) ?? 0)) || 6

function standIn(r: Reader, symbol: Json, label: string): SheetSymbol | null {
  const color = r.firstColor ? toHex(r.firstColor) : '#000000'
  if (symbol.type === 'CIMPointSymbol')
    return { kind: 'point', label, icon: 'dot', size: trim(Math.min(largestSize(symbol), 48)), color }
  if (symbol.type === 'CIMLineSymbol') return { kind: 'line', label, layers: [{ color, width: 1 }] }
  if (symbol.type === 'CIMPolygonSymbol') return { kind: 'area', label, outline: [{ color, width: 1 }] }
  return null
}

const STAND_IN = {
  CIMPointSymbol: 'a plain dot',
  CIMLineSymbol: 'a plain 1 pt line',
  CIMPolygonSymbol: 'a plain 1 pt outline',
} as Record<string, string>

/**
 * A sheet symbol from a CIM symbol or symbol reference, in either colour encoding. Everything not
 * carried is a diagnostic; `symbol` is absent when nothing could be read (unless `substitute`).
 */
export function sheetSymbolFromCim(
  cim: unknown,
  options: CimReadOptions = {},
): { symbol?: SheetSymbol; diagnostics: ExchangeDiagnostic[] } {
  const r: Reader = { format: options.format ?? 'lyrx', subject: options.subject ?? options.label, diagnostics: [] }
  const symbol = isRecord(cim) && cim.type === 'CIMSymbolReference' ? cim.symbol : cim
  const label = options.label ?? 'Symbol'
  if (!isRecord(symbol)) {
    say(r, 'error', 'The symbol is missing.')
    return { diagnostics: r.diagnostics }
  }
  let read: SheetSymbol | null = null
  if (symbol.type === 'CIMLineSymbol') read = readLine(r, symbol, label)
  else if (symbol.type === 'CIMPointSymbol') read = readPoint(r, symbol, label)
  else if (symbol.type === 'CIMPolygonSymbol') {
    const layers = records(symbol.symbolLayers)
    const only = layers.length === 1 ? layers[0] : undefined
    if (only?.type === 'CIMSolidFill' && only.primitiveName === CLASS_PRIMITIVE) {
      const color = readColor(r, only.color, 'The class colour')
      read = { kind: 'class', label, color: toHex(color), opacity: trim(color.a, 4) }
    } else read = readArea(r, symbol, label)
  } else if (symbol.type === 'CIMTextSymbol') say(r, 'error', 'A text symbol is not a map symbol PGMaps carries.')
  else say(r, 'error', `A ${text(symbol.type) ?? 'symbol of unknown type'} is not carried.`)
  if (read) {
    try {
      return { symbol: checkedSheetSymbol(read), diagnostics: r.diagnostics }
    } catch (error) {
      say(r, 'error', `The symbol could not be read: ${error instanceof Error ? error.message : String(error)}`)
      read = null
    }
  }
  if (options.substitute) {
    const stand = standIn(r, symbol, label)
    if (stand) {
      say(r, 'error', `Nothing in the symbol could be read; ${STAND_IN[String(symbol.type)]} stands in for it.`)
      return { symbol: stand, diagnostics: r.diagnostics }
    }
  }
  if (!r.diagnostics.some((d) => d.severity === 'error')) say(r, 'error', 'The symbol has no layer PGMaps can draw.')
  return { diagnostics: r.diagnostics }
}

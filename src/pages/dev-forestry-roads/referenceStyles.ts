/**
 * The look a person gives an imported reference layer: its colour, line style, width, area
 * pattern and fill opacity. Display only: a reference layer is read by no calculation, and its
 * look changes nothing but the plan and its legend. Planned blocks keep the block sheet's symbol.
 * A layer with no saved look is drawn exactly as before. No DOM or network access.
 */
import { areaPatternId, lineMarkerId, pointSymbolId } from '@/lib/mapSheet/mapSymbols'
import { PX_PER_PT } from '@/lib/mapSheet/symbolRaster'
import {
  parseSymbolStyle,
  styledAreaSymbol,
  styledLineSymbol,
  styledPointSymbol,
  styleLineMarkers,
  symbolStyleIsEmpty,
  type SymbolStyle,
  type SymbolStyleDefaults,
} from '@/lib/mapSheet/symbolStyle'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { referenceLayerKey, referenceShape, type ReferenceFeature, type ReferenceShape } from './referenceFeatures'

export interface ReferenceLayerStyle extends SymbolStyle {
  /** The layer's key: the file its features were imported from. */
  layer: string
}

export const MAX_REFERENCE_STYLES = 500
export const REFERENCE_LINE_COLOR = '#334155'
export const REFERENCE_POINT_COLOR = '#f59e0b'
const LAYER_COLORS = ['#2563eb', '#7c3aed', '#047857', '#b45309', '#be185d', '#0891b2', '#4338ca', '#a21caf', '#0f766e']
/** Colours offered first in a layer's colour picker: the ones layers are given by default. */
export const REFERENCE_COLOR_PRESETS: readonly string[] = [...LAYER_COLORS, REFERENCE_LINE_COLOR]

/** The colour a layer has until the person picks one: fixed by its file name, so it survives a reload. */
export function referenceDefaultColor(key: string): string {
  let hash = 0
  for (const char of key.split('/').at(-1) ?? '') hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0
  return key ? LAYER_COLORS[(hash >>> 0) % LAYER_COLORS.length] : REFERENCE_LINE_COLOR
}

export const referenceStyleFor = (styles: readonly ReferenceLayerStyle[] | undefined, key: string) =>
  styles?.find(({ layer }) => layer === key)

/** A layer's colour on the plan, in the legend and beside its name. */
export function referenceLayerColor(key: string, styles?: readonly ReferenceLayerStyle[]): string {
  return referenceStyleFor(styles, key)?.color ?? referenceDefaultColor(key)
}

/** A reference layer as it arrives: a dashed line with a light casing, areas tinted in the layer's colour. */
export function referenceStyleDefaults(key: string, label: string, shape: ReferenceShape): SymbolStyleDefaults {
  return {
    label,
    color: key ? referenceDefaultColor(key) : shape === 'point' ? REFERENCE_POINT_COLOR : REFERENCE_LINE_COLOR,
    pattern: 'solid',
    dash: 'dashed',
    width: 1.25,
    opacity: 0.13,
    casing: { color: '#ffffff', width: 2.25 / PX_PER_PT, opacity: 0.75, cap: 'round' },
  }
}

/** The symbol a styled layer draws for one of its shapes; the legend and the layer's swatch use it. */
export function referenceLayerSymbol(
  key: string,
  label: string,
  shape: ReferenceShape,
  style: SymbolStyle | undefined,
): SheetSymbol {
  const defaults = referenceStyleDefaults(key, label, shape)
  if (shape === 'area') return styledAreaSymbol(defaults, style)
  if (shape === 'line') return styledLineSymbol(defaults, style)
  return styledPointSymbol(defaults, style)
}

/** How a dash travels in a feature's properties: a preset by name, a custom dash by its lengths. */
export const referenceDashKey = (style: SymbolStyle) =>
  style.dash === 'custom' ? `custom:${(style.dashPattern ?? []).join(',')}` : style.dash

/** The custom dashes in use, by the key their features carry, for the line layer's `match`. */
export function referenceCustomDashes(styles: readonly ReferenceLayerStyle[] | undefined): Map<string, number[]> {
  const dashes = new Map<string, number[]>()
  for (const style of styles ?? [])
    if (style.dash === 'custom' && style.dashPattern) dashes.set(referenceDashKey(style)!, style.dashPattern)
  return dashes
}

/**
 * What a styled layer adds to its features on the plan: only the values the person set, so an
 * unstyled layer carries nothing and the layers' own defaults draw it. `pattern` is the id of the
 * area's pattern tile, which bakes in the fill, and is set for areas only.
 */
export function referenceStyleProperties(
  key: string,
  shape: ReferenceShape,
  style: SymbolStyle | undefined,
  /** The feature's latitude: Web Mercator stretches the ground by 1 / cos(latitude). */
  latitude = 0,
): {
  lineWidth?: number
  lineWidthM?: number
  lineDash?: string
  fillOpacity?: number
  pattern?: string
  lineMarker?: string
  pointIcon?: string
} {
  if (!style || symbolStyleIsEmpty(style)) return {}
  const defaults = referenceStyleDefaults(key, '', shape)
  const pattern = shape === 'area' ? areaPatternId(styledAreaSymbol(defaults, style)) : null
  const [marker] = shape === 'line' ? styleLineMarkers(defaults, style) : []
  const fillOpacity = style.noFill ? 0 : style.opacity
  return {
    ...(style.width !== undefined ? { lineWidth: style.width * PX_PER_PT } : {}),
    // Metres on the ground, already divided by the Mercator scale at this latitude.
    ...(style.widthM !== undefined && shape !== 'point'
      ? { lineWidthM: style.widthM / Math.cos((latitude * Math.PI) / 180) }
      : {}),
    ...(style.dash !== undefined ? { lineDash: referenceDashKey(style) } : {}),
    ...(fillOpacity !== undefined ? { fillOpacity } : {}),
    ...(pattern ? { pattern } : {}),
    ...(marker ? { lineMarker: lineMarkerId(marker) } : {}),
    ...(shape === 'point' && (style.icon !== undefined || style.size !== undefined)
      ? { pointIcon: pointSymbolId(styledPointSymbol(defaults, style)) }
      : {}),
  }
}

/**
 * The symbols whose images the plan needs: a patterned area's tile, a line's repeated mark and a
 * point's shape, for each styled layer that has that shape.
 */
export function referenceStyleSymbols(
  features: readonly ReferenceFeature[],
  styles: readonly ReferenceLayerStyle[] | undefined,
): SheetSymbol[] {
  if (!styles?.length) return []
  const shapes = new Map<string, Set<ReferenceShape>>()
  for (const feature of features) {
    const key = referenceLayerKey(feature)
    shapes.set(key, (shapes.get(key) ?? new Set()).add(referenceShape(feature)))
  }
  return styles.flatMap((style) =>
    [...(shapes.get(style.layer) ?? [])].flatMap((shape) => {
      const symbol = referenceLayerSymbol(style.layer, '', shape, style)
      const needed =
        symbol.kind === 'area'
          ? areaPatternId(symbol) !== null
          : symbol.kind === 'line'
            ? !!symbol.markers?.length
            : style.icon !== undefined || style.size !== undefined
      return needed ? [symbol] : []
    }),
  )
}

/** Looks whose layer is gone, or that set nothing, are dropped: a removed layer leaves no look behind. */
export function keepReferenceStyles(
  styles: readonly ReferenceLayerStyle[],
  reference: readonly ReferenceFeature[],
): ReferenceLayerStyle[] {
  const keys = new Set(reference.map(referenceLayerKey))
  return styles.filter(({ layer, ...style }) => keys.has(layer) && !symbolStyleIsEmpty(style))
}

/** The project's looks with one layer's replaced; an empty style removes that layer's look. */
export function withReferenceStyle(
  styles: readonly ReferenceLayerStyle[] | undefined,
  layer: string,
  style: SymbolStyle,
): ReferenceLayerStyle[] {
  const rest = (styles ?? []).filter((entry) => entry.layer !== layer)
  return symbolStyleIsEmpty(style) ? rest : [...rest, { layer, ...style }]
}

export function parseReferenceStyles(value: unknown): ReferenceLayerStyle[] {
  if (!Array.isArray(value)) throw Error('Reference layer looks must be a list.')
  if (value.length > MAX_REFERENCE_STYLES) throw Error(`A project keeps at most ${MAX_REFERENCE_STYLES} layer looks.`)
  const styles = value.map((entry) => {
    const layer = (entry as { layer?: unknown } | null)?.layer
    if (typeof layer !== 'string' || layer.length > 200) throw Error('A layer look needs its layer.')
    return { layer, ...parseSymbolStyle(entry, 'Reference layer look') }
  })
  if (new Set(styles.map(({ layer }) => layer)).size !== styles.length) throw Error('A layer can have one look.')
  return styles
}

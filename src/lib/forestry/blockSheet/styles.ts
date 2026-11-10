/**
 * Block map sheet symbology, each colour defined once and read by the sheet's map, its legend and
 * any MapLibre layer that shows the same thing. Values come from the ArcGIS block-map sheets the
 * presets reproduce (docs/forestry-block-map-sheets.md); widths are points at the sheet's own
 * scale. Labels are generic: no licensee names. No DOM or network access.
 */
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'

/** Class bounds: a value belongs to a class when `min < value <= max` (ArcGIS's "≤ upper"). */
export interface RasterClass {
  /** Exclusive lower bound; absent for the first class. */
  min?: number
  /** Inclusive upper bound; absent for the last class. */
  max?: number
  /** Null leaves the class transparent. */
  color: string | null
  label: string
}

/** Slope classes in percent, as on the LiDAR design slope sheet. Under 20 % is left clear. */
export const SLOPE_CLASSES: readonly RasterClass[] = [
  { max: 20, color: null, label: '< 20' },
  { min: 20, max: 30, color: '#ffff73', label: '20 - 30' },
  { min: 30, max: 35, color: '#a3ff73', label: '30 - 35' },
  { min: 35, max: 40, color: '#73dfff', label: '35 - 40' },
  { min: 40, max: 50, color: '#df73ff', label: '40 - 50' },
  { min: 50, max: 60, color: '#ffaa00', label: '50 - 60' },
  { min: 60, max: 85, color: '#ff7f7f', label: '60 - 85' },
  { min: 85, color: '#e81515', label: '85 +' },
]
/** The slope classes print at this opacity: alpha 216 of 255 (0.847), as the reference sheet's soft mask. */
export const SLOPE_CLASS_OPACITY = 216 / 255
/** Drawn over the 85 + class, fully opaque: the steepest ground reads black. */
export const SLOPE_STEEP_OVERLAY = { min: 95, color: '#000000', opacity: 1, label: '95 +' } as const

/** Canopy height classes in metres, 5 m wide, opaque. Under 5 m is left clear. */
export const CANOPY_HEIGHT_CLASSES: readonly RasterClass[] = [
  { max: 5, color: null, label: '< 5' },
  { min: 5, max: 10, color: '#ff7f7f', label: '5 - 10' },
  { min: 10, max: 15, color: '#4ce600', label: '10 - 15' },
  { min: 15, max: 20, color: '#267300', label: '15 - 20' },
  { min: 20, max: 25, color: '#beffe8', label: '20 - 25' },
  { min: 25, max: 30, color: '#00a9e6', label: '25 - 30' },
  { min: 30, max: 35, color: '#e8beff', label: '30 - 35' },
  { min: 35, max: 40, color: '#a900e6', label: '35 - 40' },
  { min: 40, color: '#000000', label: '40 +' },
]
export const CANOPY_HEIGHT_OPACITY = 1

/** Greyscale hillshade: sun from the north-west, 45° up, no exaggeration. Flat ground prints grey 180. */
export const HILLSHADE_PRESET = { azimuthDeg: 315, altitudeDeg: 45, zFactor: 1 } as const

/** Contours every 10 m; every second one (20 m) is an index contour. */
export const CONTOUR_INTERVAL_M = 10
export const CONTOUR_INDEX_EVERY = 2

export interface ContourStyle {
  index: StrokeStyle
  intermediate: StrokeStyle
  indexLabel: string
  intermediateLabel: string
  labelSize: number
  halo: { color: string; width: number } | null
}
export const CONTOUR_STYLES: Record<'default' | 'onImagery', ContourStyle> = {
  default: {
    index: { color: '#4e4e4e', width: 0.35, cap: 'round', join: 'round' },
    intermediate: { color: '#b2b2b2', width: 0.25, cap: 'round', join: 'round' },
    indexLabel: '#000000',
    intermediateLabel: '#828282',
    labelSize: 6,
    halo: { color: '#ffffff', width: 1.2 },
  },
  onImagery: {
    index: { color: '#ffffff', width: 0.35, cap: 'round', join: 'round' },
    intermediate: { color: '#ffffff', width: 0.25, cap: 'round', join: 'round' },
    indexLabel: '#ffffff',
    intermediateLabel: '#ffffff',
    labelSize: 6,
    halo: null,
  },
}

/** A line drawn as stacked strokes, bottom first: a casing, the line, a centre dash. */
export interface LineSymbol {
  kind: 'line'
  label: string
  layers: StrokeStyle[]
}
export interface AreaSymbol {
  kind: 'area'
  label: string
  fill?: string
  fillOpacity?: number
  /** Parallel lines clipped to the area; `cross` adds a second set at right angles. */
  hatch?: { angleDeg: number; spacing: number; stroke: StrokeStyle; cross?: boolean }
  /** Outline strokes, bottom first. */
  outline: StrokeStyle[]
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
  color: string
  radius: number
  outline: StrokeStyle
}
export type SheetSymbol = LineSymbol | AreaSymbol | ClassSymbol | PointSymbol

/** Sheet scales finer than this use the detailed (1:10,000) widths; coarser ones the 1:50,000 widths. */
export const DETAIL_SCALE_LIMIT = 25000
export type ScaleBand = 'detail' | 'overview'
export const scaleBand = (scale: number): ScaleBand => (scale <= DETAIL_SCALE_LIMIT ? 'detail' : 'overview')

const WHITE = '#ffffff'

/** The block the sheet is about: orange on white, or black on white over the LiDAR rasters. */
export const BLOCK_OF_INTEREST: Record<'default' | 'lidar', AreaSymbol> = {
  default: {
    kind: 'area',
    label: 'Block of interest',
    outline: [
      { color: WHITE, width: 3, join: 'round' },
      { color: '#ffaa00', width: 2.5, join: 'round' },
    ],
  },
  lidar: {
    kind: 'area',
    label: 'Block of interest',
    outline: [
      { color: WHITE, width: 3, join: 'round' },
      { color: '#000000', width: 2.5, join: 'round' },
    ],
  },
}
export const OTHER_BLOCK: AreaSymbol = {
  kind: 'area',
  label: 'Other blocks',
  outline: [{ color: '#000000', width: 1, join: 'round' }],
}
/** Areas the route search avoids or charges for. Not a reserve: drawn as a red hatch. */
export const CONSTRAINT_AREA: AreaSymbol = {
  kind: 'area',
  label: 'Constraint area',
  hatch: { angleDeg: 45, spacing: 5, stroke: { color: '#e60000', width: 0.5 } },
  outline: [{ color: '#a80000', width: 0.4 }],
}
export const STREAM: Record<ScaleBand, LineSymbol> = {
  detail: { kind: 'line', label: 'Stream', layers: [{ color: '#00a9e6', width: 1, cap: 'round', join: 'round' }] },
  overview: { kind: 'line', label: 'Stream', layers: [{ color: '#00a9e6', width: 0.4, cap: 'round', join: 'round' }] },
}
/** A reach assessed as a non-classified drainage. */
export const NCD_STREAM: Record<ScaleBand, LineSymbol> = {
  detail: { kind: 'line', label: 'NCD stream', layers: [{ color: '#00a9e6', width: 1, dash: [5, 2] }] },
  overview: { kind: 'line', label: 'NCD stream', layers: [{ color: '#00a9e6', width: 0.4, dash: [2, 2] }] },
}
/** Forest service roads, drawn with the sheets' "gravel main" symbol. */
export const FOREST_SERVICE_ROAD: Record<ScaleBand, LineSymbol> = {
  detail: {
    kind: 'line',
    label: 'Forest service road',
    layers: [
      { color: '#000000', width: 4, join: 'round' },
      { color: WHITE, width: 1, dash: [5, 5] },
    ],
  },
  overview: {
    kind: 'line',
    label: 'Forest service road',
    layers: [
      { color: '#000000', width: 2, join: 'round' },
      { color: WHITE, width: 0.75, dash: [5, 5] },
    ],
  },
}
/** Other mapped roads (permits, user roads), drawn with the sheets' "spur" symbol. */
export const EXISTING_ROAD: Record<ScaleBand, LineSymbol> = {
  detail: {
    kind: 'line',
    label: 'Existing road',
    layers: [
      { color: '#734c00', width: 2.5, join: 'round' },
      { color: WHITE, width: 1, dash: [5, 5] },
    ],
  },
  overview: {
    kind: 'line',
    label: 'Existing road',
    layers: [
      { color: '#734c00', width: 1.5, join: 'round' },
      { color: WHITE, width: 0.75, dash: [5, 5] },
    ],
  },
}
/** The sheets' red "proposed" road. */
export const PROPOSED_ROAD_COLOR = '#ff0000'
/** A designed road: the proposed-road symbol in the road's own colour, so the Road Information key matches. */
export function proposedRoad(color: string, band: ScaleBand, label = 'Proposed road'): LineSymbol {
  return {
    kind: 'line',
    label,
    layers:
      band === 'detail'
        ? [
            { color, width: 2.5, join: 'round', cap: 'round' },
            { color: WHITE, width: 1, dash: [5, 5] },
          ]
        : [
            { color, width: 1.5, join: 'round', cap: 'round' },
            { color: WHITE, width: 0.75, dash: [5, 5] },
          ],
  }
}
/** Review markup drawn from the plan's map notes, in each note's own colour. */
export function reviewLine(color: string): LineSymbol {
  return { kind: 'line', label: 'Review markup', layers: [{ color, width: 2, cap: 'round', join: 'round' }] }
}
export function reviewArea(color: string): AreaSymbol {
  return {
    kind: 'area',
    label: 'Review area',
    fill: color,
    fillOpacity: 0.35,
    outline: [{ color, width: 1, join: 'round' }],
  }
}
export function reviewPin(color: string): PointSymbol {
  return { kind: 'point', label: 'Review pin', color, radius: 3, outline: { color: WHITE, width: 1 } }
}

/** Every in-map label (block, road, contour) carries this white outline. */
export const LABEL_HALO = { color: WHITE, width: 1.2 } as const
export const BLOCK_LABEL = { size: 8, color: '#000000' } as const
export const ROAD_LABEL = { size: 6, color: '#ff0000' } as const

/** Sheet chrome: the title and section bars, panel boxes and the road table header. */
export const SHEET_CHROME = {
  barFill: '#ffd37f',
  /** Black, not the reference sheets' white: white on #ffd37f is about 1.4:1. */
  barText: '#000000',
  line: '#000000',
  tableHeaderFill: '#cccccc',
  swatchOutline: '#6e6e6e',
  missingValue: '#6e6e6e',
  noteRule: '#828282',
  northArrow: '#ff0000',
  graticuleMinor: '#6e6e6e',
  attribution: '#323232',
} as const

/** Raw RGBA of a class colour at an opacity. */
export function classRgba(color: string, opacity: number): [number, number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    Math.round(opacity * 255),
  ]
}

/** Legend rows for a class raster: one per coloured class, plus the slope overlay when given. */
export function classLegend(
  classes: readonly RasterClass[],
  opacity: number,
  overlay?: { color: string; opacity: number; label: string },
): ClassSymbol[] {
  return [
    ...classes.flatMap((entry) =>
      entry.color ? [{ kind: 'class' as const, label: entry.label, color: entry.color, opacity }] : [],
    ),
    ...(overlay
      ? [{ kind: 'class' as const, label: overlay.label, color: overlay.color, opacity: overlay.opacity }]
      : []),
  ]
}

/** Points to CSS pixels: MapLibre widths are pixels at 96 per inch. */
const PX_PER_PT = 96 / 72

/**
 * MapLibre line paints for a line symbol, bottom first. MapLibre dashes are in line widths, so the
 * point dashes are divided by the stroke width.
 */
export function lineSymbolPaint(symbol: LineSymbol) {
  return symbol.layers.map((stroke) => ({
    'line-color': stroke.color,
    'line-width': stroke.width * PX_PER_PT,
    ...(stroke.opacity !== undefined ? { 'line-opacity': stroke.opacity } : {}),
    ...(stroke.dash ? { 'line-dasharray': stroke.dash.map((value) => value / stroke.width) } : {}),
  }))
}

/** MapLibre fill and outline paints for an area symbol. Hatches have no MapLibre equivalent and are left out. */
export function areaSymbolPaint(symbol: AreaSymbol) {
  return {
    fill: symbol.fill ? { 'fill-color': symbol.fill, 'fill-opacity': symbol.fillOpacity ?? 1 } : null,
    outline: symbol.outline.map((stroke) => ({ 'line-color': stroke.color, 'line-width': stroke.width * PX_PER_PT })),
  }
}

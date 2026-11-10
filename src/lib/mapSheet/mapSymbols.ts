/**
 * MapLibre paints, layouts and images for sheet symbols, read from the same symbol objects the sheet
 * prints, so a map layer and its sheet cannot drift apart. Widths are points converted at 96/72 CSS
 * pixels; hatched and marker-filled areas become `fill-pattern` tiles, and markers along lines become
 * `symbol-placement: line` icons. Images are added through `keepSymbolImages`, which also answers
 * MapLibre's `styleimagemissing`, so they come back after a style reload. Takes the map structurally;
 * no DOM or network access.
 */
import { areaPatternTile, iconImage, PX_PER_PT, type RgbaImage } from './symbolRaster'
import type { AreaSymbol, LineMarker, LineSymbol, PointSymbol, SheetSymbol } from './symbols'

export { PX_PER_PT }

/** A short stable hash, for image ids that change only when the drawing does. */
function hash(value: unknown): string {
  const text = JSON.stringify(value)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Id of an area's pattern tile, or null when the area has no pattern. */
export function areaPatternId(symbol: AreaSymbol): string | null {
  if (!symbol.hatches?.length && !symbol.markerFill) return null
  return `sheet-pattern-${hash([symbol.fill, symbol.fillOpacity, symbol.hatches, symbol.markerFill])}`
}
export const lineMarkerId = (marker: LineMarker) =>
  `sheet-marker-${hash([marker.icon, marker.size, marker.color, marker.secondary])}`
export const pointSymbolId = (symbol: PointSymbol) =>
  `sheet-point-${hash([symbol.icon, symbol.size, symbol.color, symbol.secondary, symbol.halo])}`

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
    ...(stroke.offset ? { 'line-offset': stroke.offset * PX_PER_PT } : {}),
  }))
}

/** Line caps and joins of a line symbol's strokes, matching `lineSymbolPaint`. */
export function lineSymbolLayout(symbol: LineSymbol) {
  return symbol.layers.map((stroke) => ({
    'line-cap': stroke.cap ?? 'butt',
    'line-join': stroke.join ?? 'miter',
  }))
}

/**
 * Symbol layers for a line's repeated markers: each icon is drawn along the line every `spacing`
 * points. MapLibre chooses where the first one falls and drops icons at tile edges, so the count
 * and phase can differ from the sheet's; the spacing and orientation match.
 */
export function lineMarkerLayers(symbol: LineSymbol) {
  return (symbol.markers ?? []).map((marker) => ({
    imageId: lineMarkerId(marker),
    layout: {
      'symbol-placement': 'line' as const,
      'symbol-spacing': Math.max(1, marker.spacing * PX_PER_PT),
      'icon-image': lineMarkerId(marker),
      'icon-rotation-alignment': 'map' as const,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-keep-upright': false,
      ...(marker.offset ? { 'icon-offset': [0, marker.offset * PX_PER_PT] as [number, number] } : {}),
    },
  }))
}

/**
 * MapLibre paints for an area symbol: a plain colour fill, or a `fill-pattern` tile with the fill
 * baked in when the symbol is hatched or marker-filled; then the outline strokes. An `inside` casing
 * draws centred on the edge, since MapLibre cannot clip a line to its polygon.
 */
export function areaSymbolPaint(symbol: AreaSymbol) {
  const pattern = areaPatternId(symbol)
  return {
    fill: !pattern && symbol.fill ? { 'fill-color': symbol.fill, 'fill-opacity': symbol.fillOpacity ?? 1 } : null,
    pattern: pattern ? { 'fill-pattern': pattern } : null,
    outline: symbol.outline.map((stroke) => ({
      'line-color': stroke.color,
      'line-width': stroke.width * PX_PER_PT,
      ...(stroke.opacity !== undefined ? { 'line-opacity': stroke.opacity } : {}),
      ...(stroke.dash ? { 'line-dasharray': stroke.dash.map((value) => value / stroke.width) } : {}),
    })),
  }
}

/** Layout of a point symbol's icon. */
export function pointSymbolLayout(symbol: PointSymbol) {
  return { 'icon-image': pointSymbolId(symbol), 'icon-allow-overlap': true, 'icon-ignore-placement': true }
}

export interface SymbolImage {
  id: string
  image: RgbaImage
  pixelRatio: number
}

/** Every image a symbol needs on the map, drawn at `pixelRatio`. */
export function symbolImages(symbol: SheetSymbol, pixelRatio: number): SymbolImage[] {
  if (symbol.kind === 'area') {
    const tile = areaPatternTile(symbol, pixelRatio)
    return tile ? [{ id: areaPatternId(symbol)!, image: tile, pixelRatio }] : []
  }
  if (symbol.kind === 'line')
    return (symbol.markers ?? []).map((marker) => ({
      id: lineMarkerId(marker),
      image: iconImage(marker.icon, marker.size, { primary: marker.color, secondary: marker.secondary }, pixelRatio),
      pixelRatio,
    }))
  if (symbol.kind === 'point')
    return [
      {
        id: pointSymbolId(symbol),
        image: iconImage(
          symbol.icon,
          symbol.size,
          { primary: symbol.color, secondary: symbol.secondary },
          pixelRatio,
          symbol.halo,
        ),
        pixelRatio,
      },
    ]
  return []
}

/** The parts of a MapLibre map this module uses. */
export interface SymbolImageMap {
  hasImage(id: string): boolean
  addImage(id: string, image: RgbaImage, options?: { pixelRatio?: number }): void
  on(type: 'styleimagemissing', listener: (event: { id: string }) => void): unknown
  off(type: 'styleimagemissing', listener: (event: { id: string }) => void): unknown
}

/**
 * Adds the symbols' images now and again whenever MapLibre asks for one it lost, as after
 * `setStyle`. Images are drawn once and kept. Returns the function that stops listening.
 */
export function keepSymbolImages(map: SymbolImageMap, symbols: readonly SheetSymbol[], pixelRatio: number): () => void {
  const images = new Map<string, SymbolImage>()
  for (const symbol of symbols) for (const image of symbolImages(symbol, pixelRatio)) images.set(image.id, image)
  const add = (id: string) => {
    const entry = images.get(id)
    if (!entry || map.hasImage(id)) return
    map.addImage(id, entry.image, { pixelRatio: entry.pixelRatio })
  }
  for (const id of images.keys()) add(id)
  const missing = (event: { id: string }) => add(event.id)
  map.on('styleimagemissing', missing)
  return () => {
    map.off('styleimagemissing', missing)
  }
}

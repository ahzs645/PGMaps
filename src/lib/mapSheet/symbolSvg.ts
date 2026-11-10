/**
 * Symbols as small SVG documents, for legends and the symbol gallery: drawn by `swatchOps` and the
 * map's own symbol functions through `sheetSvg`, so a swatch on screen matches the printed one.
 * Sizes are points; show the SVG at `PX_PER_PT` CSS pixels a point to match the MapLibre layers.
 * No DOM or network access.
 */
import type { Point } from './drawOps'
import { sheetSvg } from './renderSvg'
import { areaSymbolOps, lineSymbolOps, pointSymbolOps, swatchOps, type SheetSymbol } from './symbols'

/** A legend swatch `width` × `height` points, on `background` (transparent when null). */
export function symbolSwatchSvg(
  symbol: SheetSymbol,
  width: number,
  height: number,
  background: string | null = null,
): string {
  return sheetSvg(swatchOps(symbol, { x: 0, y: 0, w: width, h: height }, 1), width, height, undefined, background)
}

/** An irregular polygon, a curving line or a point centred in a `width` × `height` box: how a symbol looks on a map. */
export function sampleGeometry(kind: SheetSymbol['kind'], width: number, height: number): Point[] {
  if (kind === 'line')
    return Array.from({ length: 25 }, (_, i) => {
      const t = i / 24
      return [width * (0.06 + 0.88 * t), height * (0.55 - 0.3 * Math.sin(t * Math.PI * 1.6))] as Point
    })
  if (kind === 'point') return [[width / 2, height / 2]]
  return (
    [
      [0.08, 0.3],
      [0.35, 0.08],
      [0.7, 0.16],
      [0.93, 0.45],
      [0.8, 0.9],
      [0.42, 0.86],
      [0.18, 0.7],
    ] as const
  ).map(([x, y]) => [x * width, y * height] as Point)
}

/** `symbol` drawn on its sample geometry, `zoom` times its print size, in a `width` × `height` point box. */
export function symbolSampleSvg(
  symbol: SheetSymbol,
  width: number,
  height: number,
  zoom = 1,
  background: string | null = '#ffffff',
): string {
  const w = width / zoom,
    h = height / zoom
  const geometry = sampleGeometry(symbol.kind, w, h)
  const ops =
    symbol.kind === 'area'
      ? areaSymbolOps([geometry], symbol, 1)
      : symbol.kind === 'line'
        ? lineSymbolOps([geometry], symbol, 1)
        : symbol.kind === 'point'
          ? pointSymbolOps(symbol, geometry[0][0], geometry[0][1], 1)
          : swatchOps(symbol, { x: w * 0.1, y: h * 0.25, w: w * 0.8, h: h * 0.5 }, 1)
  const svg = sheetSvg(ops, w, h, undefined, background)
  // Scale the drawing, not the geometry, so line widths and spacings grow with it.
  return svg.replace(/ width="[^"]*" height="[^"]*">/, ` width="${width}" height="${height}">`)
}

/** An SVG document as a data URL for an `<img>`. */
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

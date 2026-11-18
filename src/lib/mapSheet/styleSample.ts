/**
 * A map style shown on one small made-up map: a hillside with a proposed block, an existing opening, private land
 * and rock, each drawn with the symbol the style gives that role, over the same contours and road every time. The
 * symbols are drawn by the sheet's own functions through `sheetSvg`, so a style's sample is its real hatch, dash and
 * outline, and two styles differ in the sample exactly where they differ on a printed map. It is a string of SVG a
 * few hundred bytes long, made in well under a millisecond: no map, no tiles and no capture. No DOM or network
 * access.
 */
import type { DrawOp, Point, StrokeStyle } from './drawOps'
import { sheetSvg } from './renderSvg'
import { areaSymbolOps, type AreaSymbol } from './symbols'

/** The areas a sample draws, back to front. */
export const STYLE_SAMPLE_ROLES = ['landform', 'privateLand', 'rock', 'opening', 'block'] as const
export type StyleSampleRole = (typeof STYLE_SAMPLE_ROLES)[number]

/** A style's symbol for each role it draws; a role left out is not drawn. */
export type StyleSampleSymbols = Partial<Record<StyleSampleRole, AreaSymbol>>

/** A map style a reader can choose: its name, and what its sample map is drawn with (none: no sample is shown). */
export type MapStyleChoice = { value: string; label: string; sample?: StyleSampleSymbols }

/** The sample's shape, and its size in points when none is asked for. */
export const STYLE_SAMPLE_SIZE = { width: 132, height: 72 } as const

type Ring = ReadonlyArray<readonly [number, number]>

/** Each role's ground, in fractions of the sample: the same ground under every style. */
const GROUND: Record<StyleSampleRole, Ring> = {
  landform: [
    [0.05, 0.62],
    [0.16, 0.3],
    [0.36, 0.12],
    [0.62, 0.09],
    [0.84, 0.2],
    [0.95, 0.46],
    [0.88, 0.74],
    [0.6, 0.86],
    [0.3, 0.84],
    [0.12, 0.78],
  ],
  privateLand: [
    [0.68, 0.6],
    [0.88, 0.56],
    [0.9, 0.78],
    [0.7, 0.82],
  ],
  rock: [
    [0.5, 0.14],
    [0.62, 0.12],
    [0.68, 0.22],
    [0.58, 0.3],
    [0.48, 0.24],
  ],
  opening: [
    [0.16, 0.44],
    [0.28, 0.34],
    [0.38, 0.42],
    [0.34, 0.6],
    [0.2, 0.62],
  ],
  block: [
    [0.44, 0.4],
    [0.6, 0.34],
    [0.72, 0.42],
    [0.66, 0.6],
    [0.5, 0.66],
    [0.4, 0.54],
  ],
}

const CONTOUR: StrokeStyle = { color: '#b4a59a', width: 0.3, cap: 'round', join: 'round' }
const ROAD: StrokeStyle = { color: '#57534e', width: 0.7, dash: [3, 1.6], cap: 'butt', join: 'round' }

const scaled = (ring: Ring, width: number, height: number): Point[] =>
  ring.map(([x, y]) => [x * width, y * height] as Point)

/** Contours that bend round the hill's top, and a road along its foot: context that never changes with the style. */
function contextOps(width: number, height: number): DrawOp[] {
  const contours = [0.18, 0.34, 0.5, 0.66].map((level) =>
    Array.from({ length: 17 }, (_, i) => {
      const t = i / 16
      return [width * t, height * (level + 0.22 * (t - 0.52) ** 2 + 0.02 * Math.sin(t * 9 + level * 20))] as Point
    }),
  )
  const road = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16
    return [width * t, height * (0.93 - 0.05 * Math.sin(t * Math.PI * 1.4))] as Point
  })
  return [
    { op: 'path', parts: contours, closed: false, stroke: CONTOUR },
    { op: 'path', parts: [road], closed: false, stroke: ROAD },
  ]
}

/** The sample's drawing operations in a `width` × `height` point box. */
export function styleSampleOps(
  symbols: StyleSampleSymbols,
  width: number = STYLE_SAMPLE_SIZE.width,
  height: number = STYLE_SAMPLE_SIZE.height,
): DrawOp[] {
  const ops = contextOps(width, height)
  for (const role of STYLE_SAMPLE_ROLES) {
    const symbol = symbols[role]
    if (symbol) ops.push(...areaSymbolOps([scaled(GROUND[role], width, height)], symbol, 1))
  }
  return ops
}

/**
 * The sample as an SVG document on `background`, in a box `width` points across: the ground fills the box whatever
 * its size, and the symbols keep their printed weights, so a smaller box is a smaller map, not a thinner drawing.
 */
export function styleSampleSvg(
  symbols: StyleSampleSymbols,
  width: number = STYLE_SAMPLE_SIZE.width,
  background: string | null = '#ffffff',
): string {
  const height = (width * STYLE_SAMPLE_SIZE.height) / STYLE_SAMPLE_SIZE.width
  return sheetSvg(styleSampleOps(symbols, width, height), width, height, undefined, background)
}

/** The roles a sample draws with their symbols, front to back: the order a key lists them in. */
export function styleSampleKey(symbols: StyleSampleSymbols): Array<{ role: StyleSampleRole; symbol: AreaSymbol }> {
  return [...STYLE_SAMPLE_ROLES].reverse().flatMap((role) => (symbols[role] ? [{ role, symbol: symbols[role] }] : []))
}

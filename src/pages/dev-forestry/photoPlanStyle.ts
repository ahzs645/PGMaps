import { catalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'

/**
 * How an own photo shows on the plan map (`PhotoDrapeLayer`, `PhotoCamerasLayer`): the catalogue's `photo-*` entries,
 * read here by role so the layers, the legend swatches and the card read the same objects. Each colour is defined once,
 * in `symbolCatalogue.ts`. Kept free of DOM access.
 */
function entry<K extends SheetSymbol['kind']>(id: string, kind: K): Extract<SheetSymbol, { kind: K }> {
  const symbol = catalogueEntry(id).symbol
  if (symbol.kind !== kind) throw Error(`The catalogue's "${id}" is a ${symbol.kind} symbol, not a ${kind}.`)
  return symbol as Extract<SheetSymbol, { kind: K }>
}

export const PHOTO_PLAN_SYMBOLS = {
  /** The photo's own pixels laid on the ground; its swatch only, the drape itself is the photo. */
  drape: entry('photo-drape', 'area'),
  /**
   * Ground the camera's frame covers but nearer terrain hides: a faint hatch, so it no longer reads as out of
   * frame. Terrain only, never the run's visibility (no canopy, no curvature allowance of the run's).
   */
  hiddenGround: entry('photo-hidden-ground', 'area'),
  /** The photo's edges draped in one colour: the imagery under them stays readable. */
  edges: entry('photo-edges', 'class'),
  /** The frame on the ground, traced from the edge rays. */
  footprint: entry('photo-footprint', 'line'),
  /** The other candidate's frame (the runner-up while the camera is drawn, or the camera while it is). */
  otherFootprint: entry('photo-other-footprint', 'line'),
  camera: entry('photo-camera', 'point'),
  /** The cameras' view cones, out to each frame's far hit. */
  cone: entry('photo-cone', 'area'),
  /** Cameras joined in time order, one line a flight. */
  track: entry('photo-flight-track', 'line'),
  pair: entry('photo-pair', 'point'),
  /** Where the solver puts a paired point's photo pixel: joined to the reviewer's point by a thin line. */
  solvedPair: entry('photo-pair-residual', 'line'),
  reference: entry('photo-reference', 'point'),
  /** The plan end of the photo ↔ plan linked cursor. */
  cursor: entry('photo-cursor', 'line'),
} as const

export type PhotoPlanSymbolId = keyof typeof PHOTO_PLAN_SYMBOLS

/** `#rrggbb` as bytes; a shared symbol's colour is always written that way. */
export function hexBytes(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return [0, 0, 0]
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

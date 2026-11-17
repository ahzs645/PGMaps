/**
 * Which end of a culvert is its inlet. A culvert without `inletSide` takes its inlet at the left end
 * looking up-station, as every culvert did before the field existed, so saved roads calculate
 * exactly as before. The engine, the design surface's channel, the ditch dip, the drainage routing
 * and the schedule all read the side through these helpers.
 *
 * Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'

export type CulvertInletSide = 'left' | 'right'
export const CULVERT_INLET_SIDES: readonly CulvertInletSide[] = ['left', 'right']

/** The culvert's inlet side; absent is left. */
export function culvertInletSide(c: Pick<Culvert, 'inletSide'>): CulvertInletSide {
  return c.inletSide ?? 'left'
}

/** −1 when the inlet is the left end, +1 when it is the right: the sign of the inlet's offset. */
export function culvertInletSign(c: Pick<Culvert, 'inletSide'>): -1 | 1 {
  return culvertInletSide(c) === 'right' ? 1 : -1
}

/** The other side. */
export function otherSide(side: CulvertInletSide): CulvertInletSide {
  return side === 'left' ? 'right' : 'left'
}

/** A project file's `inletSide`. Left is the default and is not stored, so it reads as absent. */
export function parseCulvertInletSide(value: unknown): Pick<Culvert, 'inletSide'> {
  if (value === undefined || value === null) return {}
  if (value !== 'left' && value !== 'right') throw Error('Culvert inlet side must be left or right.')
  return value === 'right' ? { inletSide: 'right' } : {}
}

/** The culvert with its inlet on `side`; left removes the field, so the culvert reads as one that never had it. */
export function withInletSide<C extends Pick<Culvert, 'inletSide'>>(c: C, side: CulvertInletSide): C {
  const next = { ...c }
  if (side === 'right') next.inletSide = 'right'
  else delete next.inletSide
  return next
}

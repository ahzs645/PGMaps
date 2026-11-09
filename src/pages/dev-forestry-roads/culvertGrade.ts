/**
 * A culvert's fall and screening capacity from its entered size and inverts. No DOM or network
 * access, and no terrain: these are the figures available before a drainage run.
 */
import type { Culvert } from './engineeringTypes'
import { culvertCapacitySlope, fullPipeCapacity } from './hydrology'

type Inverts = Pick<Culvert, 'inletInvertM' | 'outletInvertM' | 'lengthM'>

/** The slope the capacity figure assumes for a pipe with no fall entered yet: 2 %, the drainage run's default. */
export const ASSUMED_CULVERT_SLOPE = 0.02

/** Fall from the inlet (left) to the outlet (right) as a percentage of the horizontal span; null without both inverts. */
export function culvertFallPercent(c: Inverts): number | null {
  return c.inletInvertM !== null && c.outletInvertM !== null && c.lengthM > 0
    ? ((c.inletInvertM - c.outletInvertM) / c.lengthM) * 100
    : null
}

/**
 * The inverts that give the barrel a fall of `fallPercent` over its span, keeping the `hold` end
 * where it is and moving the other. Null when the held
 * invert is not entered.
 */
export function invertsForFall(
  c: Inverts,
  fallPercent: number,
  hold: 'inlet' | 'outlet',
): Pick<Culvert, 'inletInvertM' | 'outletInvertM'> | null {
  const drop = (fallPercent / 100) * c.lengthM
  // Six decimals: the gradient reads back as entered even from an invert carried to the micrometre.
  const mm = (value: number) => Number(value.toFixed(6))
  if (hold === 'inlet')
    return c.inletInvertM === null ? null : { inletInvertM: c.inletInvertM, outletInvertM: mm(c.inletInvertM - drop) }
  return c.outletInvertM === null ? null : { inletInvertM: mm(c.outletInvertM + drop), outletInvertM: c.outletInvertM }
}

/**
 * Full-pipe Manning capacity of the entered barrel, m³/s. It is a property of the pipe alone; the
 * peak flow it has to carry comes from a drainage run.
 */
export function culvertScreeningCapacity(c: Inverts & Pick<Culvert, 'diameterM'>, manningN: number) {
  const { slope, slopeAssumed } = culvertCapacitySlope(c, ASSUMED_CULVERT_SLOPE)
  return { capacityM3s: fullPipeCapacity(c.diameterM, slope, manningN), slope, slopeAssumed }
}

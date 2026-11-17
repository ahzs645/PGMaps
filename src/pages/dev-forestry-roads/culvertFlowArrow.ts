import { offsetCoordinate } from './engine'
import type { Coordinate } from './types'

/** Shaft of the plan's flow arrow past a culvert's outlet, m: a share of the barrel, within these bounds. */
export const FLOW_ARROW_SHARE = 0.2
export const FLOW_ARROW_MIN_M = 1.5
export const FLOW_ARROW_MAX_M = 4
/** Half-angle of the arrowhead, degrees. */
const HEAD_DEGREES = 28

const RAD = Math.PI / 180

/** Bearing from `a` to `b`, degrees clockwise from north, on a local flat plane. */
function bearing(a: Coordinate, b: Coordinate): number {
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD)
  return (((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) / RAD) % 360) + 360) % 360
}

/**
 * The plan's flow arrow for a culvert: a short shaft out of the outlet along the barrel, with its
 * head at the far end, as the inlet-to-outlet direction the design states (inlet is the barrel's
 * left end looking up-station). It shows the direction entered, not a computed flow: an adverse
 * barrel still points inlet to outlet, and its warning says why. Lengths are on the ground, so the
 * arrow scales with the map as the barrel does.
 */
export function culvertFlowArrow(inlet: Coordinate, outlet: Coordinate, spanM: number): Coordinate[][] {
  if (!(spanM > 0)) return []
  const heading = bearing(inlet, outlet)
  const shaft = Math.min(FLOW_ARROW_MAX_M, Math.max(FLOW_ARROW_MIN_M, spanM * FLOW_ARROW_SHARE))
  const tip = offsetCoordinate(outlet, heading, shaft)
  const head = shaft * 0.45
  return [
    [outlet, tip],
    [
      offsetCoordinate(tip, heading + 180 - HEAD_DEGREES, head),
      tip,
      offsetCoordinate(tip, heading + 180 + HEAD_DEGREES, head),
    ],
  ]
}

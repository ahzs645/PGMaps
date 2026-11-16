/**
 * Screening hydraulics of one culvert from its entered opening: barrel-full Manning capacity for
 * every shape, and the inlet-control headwater of a round pipe by FHWA HDS-5's design equations
 * (`INLET_CONTROL` in `engineeringManual.ts` states where its coefficients came from).
 *
 * A screen, not a hydrotechnical design. It models no outlet control, tailwater, debris or fish
 * passage, and it does not deduct the streambed of an embedded culvert from the opening: an
 * embedded culvert's capacity is reported as not assessed by `culvertChecks.ts`.
 *
 * Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'
import { barrelOpeningArea, culvertBarrels, culvertRiseM, culvertShapeOf, culvertSpanM } from './culvertShape'
import { CULVERT_MATERIALS, INLET_CONTROL, type CulvertInletEdge } from './engineeringManual'

type Hydraulic = Pick<Culvert, 'diameterM' | 'shape' | 'spanM' | 'openingAreaM2' | 'barrels' | 'material'>

/** Whether any field changes the capacity from the plain round pipe at the drainage run's roughness. */
export const hasHydraulicOptions = (c: Hydraulic): boolean =>
  culvertShapeOf(c) !== 'round' || culvertBarrels(c) > 1 || c.material !== undefined

/** The culvert's Manning n: its material's where one is set, else the drainage run's. */
export function culvertManningN(c: Pick<Culvert, 'material'>, runManningN: number) {
  const material = CULVERT_MATERIALS.find((item) => item.value === c.material)
  return material ? { n: material.manningN, fromMaterial: true } : { n: runManningN, fromMaterial: false }
}

export interface FullFlowCapacity {
  /** All barrels together, m³/s. */
  capacityM3s: number
  manningN: number
  /** True for an arch: its hydraulic radius is taken from the round pipe of the same end area. */
  approximate: boolean
}

/**
 * Barrel-full Manning capacity, Q = (1/n)·A·R^(2/3)·√S, for every barrel together. A plain round
 * pipe gives the figure `hydrology.ts`'s `fullPipeCapacity` gives.
 */
export function culvertFullFlowCapacity(c: Hydraulic, slope: number, runManningN: number): FullFlowCapacity {
  const { n } = culvertManningN(c, runManningN)
  const shape = culvertShapeOf(c),
    barrels = culvertBarrels(c),
    root = Math.sqrt(Math.max(0, slope))
  if (shape === 'round') {
    const d = c.diameterM
    return {
      capacityM3s: barrels * ((1 / n) * ((Math.PI * d ** 2) / 4) * (d / 4) ** (2 / 3) * root),
      manningN: n,
      approximate: false,
    }
  }
  const area = barrelOpeningArea(c).areaM2
  if (shape === 'box') {
    const radius = area / (2 * (culvertSpanM(c) + culvertRiseM(c)))
    return { capacityM3s: barrels * (1 / n) * area * radius ** (2 / 3) * root, manningN: n, approximate: false }
  }
  // An arch's wetted perimeter is its supplier's figure, which the project does not hold.
  const radius = Math.sqrt((4 * area) / Math.PI) / 4
  return { capacityM3s: barrels * (1 / n) * area * radius ** (2 / 3) * root, manningN: n, approximate: true }
}

const G = 9.81

/** Critical depth of `flow` in a round pipe of diameter `d`, m, by bisection on Q²·T = g·A³. */
export function circularCriticalDepth(flow: number, d: number): number {
  if (!(flow > 0)) return 0
  const residual = (y: number) => {
    const theta = 2 * Math.acos(1 - (2 * y) / d),
      area = (d * d * (theta - Math.sin(theta))) / 8,
      top = d * Math.sin(theta / 2)
    return flow * flow * top - G * area ** 3
  }
  let low = d * 1e-6,
    high = d * (1 - 1e-9)
  // Past the pipe's capacity to hold a critical section, the depth is the crown.
  if (residual(high) > 0) return d
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2
    if (residual(mid) > 0) low = mid
    else high = mid
  }
  return (low + high) / 2
}

export interface InletControlHeadwater {
  /** Headwater depth above the inlet invert over the pipe's diameter. */
  hwOverD: number
  headwaterM: number
  /** Which HDS-5 range the flow is in. */
  regime: 'unsubmerged' | 'transition' | 'submerged'
  edge: CulvertInletEdge
  /** The flow one barrel carries, m³/s. */
  flowPerBarrelM3s: number
}

/**
 * Inlet-control headwater of a round pipe at `flowM3s` (all barrels), by HDS-5's design equations
 * (`INLET_CONTROL`): the unsubmerged equation up to its limit, the submerged equation from its
 * limit, and a straight line between the two. Null for another shape, and for an inlet with no
 * agreed coefficients.
 */
export function inletControlHeadwater(
  c: Pick<Culvert, 'diameterM' | 'shape' | 'barrels' | 'material' | 'inletEdge'>,
  flowM3s: number,
): InletControlHeadwater | null {
  if (culvertShapeOf(c) !== 'round' || !(flowM3s >= 0)) return null
  const edge = c.inletEdge ?? 'projecting'
  const k = INLET_CONTROL.coefficients[c.material === 'concrete' ? 'concrete' : 'thin-wall'][edge]
  if (!k) return null
  const d = c.diameterM,
    area = (Math.PI * d * d) / 4,
    flow = flowM3s / culvertBarrels(c)
  const slopeTerm =
    (edge === 'mitered' ? INLET_CONTROL.slopeTermMitered : INLET_CONTROL.slopeTerm) * INLET_CONTROL.nomographSlope
  // HDS-5's group X = Ku·Q/(A·D^0.5), with Ku for SI units.
  const group = (q: number) => (INLET_CONTROL.kuSI * q) / (area * Math.sqrt(d))
  const unsubmerged = (q: number) => {
    const yc = circularCriticalDepth(q, d),
      theta = 2 * Math.acos(Math.max(-1, 1 - (2 * yc) / d)),
      ac = (d * d * (theta - Math.sin(theta))) / 8
    const head = ac > 0 ? yc + (q / ac) ** 2 / (2 * G) : 0
    return head / d + k.K * group(q) ** k.M + slopeTerm
  }
  const submerged = (q: number) => k.c * group(q) ** 2 + k.Y + slopeTerm
  const flowAt = (target: number) => (target * area * Math.sqrt(d)) / INLET_CONTROL.kuSI
  const x = group(flow)
  let hwOverD: number, regime: InletControlHeadwater['regime']
  if (x <= INLET_CONTROL.unsubmergedLimit) {
    hwOverD = unsubmerged(flow)
    regime = 'unsubmerged'
  } else if (x >= INLET_CONTROL.submergedLimit) {
    hwOverD = submerged(flow)
    regime = 'submerged'
  } else {
    const a = unsubmerged(flowAt(INLET_CONTROL.unsubmergedLimit)),
      b = submerged(flowAt(INLET_CONTROL.submergedLimit))
    const t = (x - INLET_CONTROL.unsubmergedLimit) / (INLET_CONTROL.submergedLimit - INLET_CONTROL.unsubmergedLimit)
    hwOverD = a + (b - a) * t
    regime = 'transition'
  }
  hwOverD = Math.max(0, hwOverD)
  return { hwOverD, headwaterM: hwOverD * d, regime, edge, flowPerBarrelM3s: flow }
}

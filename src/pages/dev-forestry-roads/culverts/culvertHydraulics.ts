/**
 * Screening hydraulics of one culvert from its entered opening: barrel-full Manning capacity for
 * every shape, and the inlet- and outlet-control headwater of a round pipe by FHWA HDS-5's design
 * equations (`INLET_CONTROL` and `OUTLET_CONTROL` in `engineeringManual.ts` state where their
 * coefficients came from).
 *
 * A screen, not a hydrotechnical design. Outlet control is HDS-5's full-flow energy method with its
 * approximate outlet head, never a backwater profile; it models no debris or fish passage, and it
 * does not deduct the streambed of an embedded culvert from the opening: an embedded culvert's
 * capacity and headwater are reported as not assessed by `culvertChecks.ts`.
 *
 * Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'
import { barrelOpeningArea, culvertBarrels, culvertRiseM, culvertShapeOf, culvertSpanM } from './culvertShape'
import { CULVERT_MATERIALS, INLET_CONTROL, OUTLET_CONTROL, type CulvertInletEdge } from './engineeringManual'

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

/** HDS-5's entrance loss coefficient ke for this pipe's inlet (Table C.2, `OUTLET_CONTROL.entranceLoss`). */
export function entranceLossCoefficient(c: Pick<Culvert, 'material' | 'inletEdge'>): number {
  return OUTLET_CONTROL.entranceLoss[c.material === 'concrete' ? 'concrete' : 'thin-wall'][c.inletEdge ?? 'projecting']
}

export interface FullFlowOutletInput {
  diameterM: number
  /** Length of the barrel along its axis, m. */
  barrelLengthM: number
  /** Inlet invert less outlet invert, m: HDS-5's L·So. */
  dropM: number
  /** The flow one barrel carries, m³/s. */
  flowPerBarrelM3s: number
  manningN: number
  entranceLoss: number
  /** Tailwater depth above the outlet invert, m. Omitted: not known, and (dc + D)/2 sets the outlet head. */
  tailwaterM?: number
}

export interface OutletControlHeadwater {
  /** Headwater depth above the inlet invert, m: ho + H − L·So. */
  headwaterM: number
  hwOverD: number
  /** Entrance, friction and exit losses together, H of HDS-5 Eq. 3.5, m. */
  barrelLossM: number
  /** Depth of the hydraulic grade line above the outlet invert, ho, m. */
  outletHeadM: number
  /** Critical depth, never more than the diameter, m. */
  criticalDepthM: number
  /** What set ho: the entered tailwater, or (dc + D)/2 (always so when the tailwater is not known). */
  outletHeadFrom: 'tailwater' | 'critical-and-crown'
  tailwaterKnown: boolean
  /** Full-barrel velocity, m/s. */
  velocityMs: number
  entranceLoss: number
  manningN: number
  /**
   * Where the result sits in HDS-5's range for the approximate method: `full` at 1.2D and over,
   * `caution` from 0.75D, `below-method` under 0.75D, where HDS-5 asks for a backwater calculation.
   */
  range: 'full' | 'caution' | 'below-method'
  flowPerBarrelM3s: number
  /**
   * Below 0.75D, where HDS-5 asks for one: the backwater profile up the barrel
   * (`backwaterOutletControl`). Absent in the other ranges, where the full-flow figure is read.
   */
  backwater?: BackwaterOutletControl
}

/** Outlet-control headwater from a water-surface profile computed up a part-full round barrel. */
export interface BackwaterOutletControl {
  /**
   * `subcritical`: the profile was carried from the outlet to the inlet, and its headwater is outlet
   * control's. `steep`: normal depth is under critical depth, so the barrel flows supercritical from
   * the inlet down and the outlet does not control: inlet control governs.
   */
  state: 'subcritical' | 'steep'
  /** Headwater above the inlet invert, m: the inlet's specific energy plus the entrance loss. Null when steep. */
  headwaterM: number | null
  hwOverD: number | null
  /** Depth at the outlet the profile starts from: the tailwater, or critical depth where higher. */
  outletDepthM: number
  /** Depth just inside the inlet, m; the diameter when the profile reaches the crown and the barrel runs full. */
  inletDepthM: number | null
  criticalDepthM: number
  /** Manning normal depth, m; null on a level or adverse barrel, which has none. */
  normalDepthM: number | null
  /** The profile reached the crown within the barrel, and the rest upstream was carried at full-flow friction. */
  fillsBarrel: boolean
}

/** Area, wetted perimeter and top width of a round pipe of diameter `d` flowing `y` deep. */
function circularSection(y: number, d: number) {
  const depth = Math.min(Math.max(y, d * 1e-9), d)
  const theta = 2 * Math.acos(1 - (2 * depth) / d)
  return {
    area: (d * d * (theta - Math.sin(theta))) / 8,
    perimeter: (d * theta) / 2,
    top: d * Math.sin(theta / 2),
  }
}

/** Manning friction slope of `flow` in a round pipe `y` deep (SI). */
function frictionSlope(flow: number, y: number, d: number, n: number) {
  const { area, perimeter } = circularSection(y, d)
  const radius = area / perimeter
  return (n * flow) ** 2 / (area ** 2 * radius ** (4 / 3))
}

/** Manning normal depth in a round pipe, m, by bisection; null where the slope is not positive or the pipe cannot carry it part full. */
export function circularNormalDepth(flow: number, d: number, n: number, slope: number): number | null {
  if (!(flow > 0) || !(slope > 0)) return null
  const conveyance = (y: number) => {
    const { area, perimeter } = circularSection(y, d)
    return (area * (area / perimeter) ** (2 / 3) * Math.sqrt(slope)) / n
  }
  // Part-full conveyance peaks near 0.94D; past it the pipe surcharges.
  const peak = 0.938 * d
  if (conveyance(peak) < flow) return null
  let low = d * 1e-6,
    high = peak
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2
    if (conveyance(mid) < flow) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** Steps the profile takes along the barrel. */
export const BACKWATER_STEPS = 60

/**
 * Outlet control where the barrel flows part full, the case HDS-5 does not read with its full-flow
 * approximation (under 0.75D, 3.1.4 p. 3.12): a gradually varied flow profile computed upstream from
 * the outlet by the standard step method (Chow, Open-Channel Hydraulics, 1959, ch. 10), Manning
 * friction averaged over each step, in a round barrel. The profile starts at the tailwater or at
 * critical depth, whichever is higher (a free outfall passes critical depth). The headwater is the
 * inlet's specific energy plus the entrance loss ke·V²/2g, approach velocity neglected as in HDS-5's
 * hand method. Where the profile reaches the crown the rest of the barrel is carried at full-flow
 * friction. Where normal depth is under critical depth the barrel is steep: the outlet does not
 * control, and inlet control governs.
 */
export function backwaterOutletControl(input: FullFlowOutletInput): BackwaterOutletControl {
  const d = input.diameterM,
    q = input.flowPerBarrelM3s,
    n = input.manningN,
    length = input.barrelLengthM
  const slope = length > 0 ? input.dropM / length : 0
  const criticalDepthM = Math.min(d, circularCriticalDepth(q, d))
  const normalDepthM = circularNormalDepth(q, d, n, slope)
  const tailwater = input.tailwaterM !== undefined && Number.isFinite(input.tailwaterM) ? input.tailwaterM : 0
  const outletDepthM = Math.min(d, Math.max(criticalDepthM, tailwater))
  const base = { outletDepthM, criticalDepthM, normalDepthM }
  if (normalDepthM !== null && normalDepthM < criticalDepthM && tailwater < criticalDepthM)
    return { ...base, state: 'steep', headwaterM: null, hwOverD: null, inletDepthM: null, fillsBarrel: false }
  if (!(q > 0)) return { ...base, state: 'subcritical', headwaterM: 0, hwOverD: 0, inletDepthM: 0, fillsBarrel: false }

  const energy = (y: number) => y + q ** 2 / (2 * G * circularSection(y, d).area ** 2)
  const fullArea = (Math.PI * d * d) / 4
  const fullFriction = frictionSlope(q, d, d, n)
  const dx = length / BACKWATER_STEPS
  // Total head above the outlet invert, and the depth, at the downstream end of each step.
  let depth: number | null = outletDepthM,
    head = energy(outletDepthM),
    fills = false
  for (let step = 1; step <= BACKWATER_STEPS; step++) {
    const rise = slope * dx
    if (depth === null) {
      // Full barrel: the energy line climbs at full-flow friction.
      head += fullFriction * dx
      continue
    }
    const below = depth
    const lowerFriction = frictionSlope(q, below, d, n)
    // Energy balance: z_up + E(y_up) = z_down + E(y_down) + mean Sf · dx, on the subcritical branch.
    const balance = (y: number) =>
      step * rise + energy(y) - (head + ((lowerFriction + frictionSlope(q, y, d, n)) / 2) * dx)
    if (balance(d) < 0) {
      // Even a full section has too little energy: the barrel surcharges from here up.
      depth = null
      fills = true
      head += ((lowerFriction + fullFriction) / 2) * dx
      continue
    }
    let low = criticalDepthM,
      high = d
    if (balance(low) > 0) {
      // No subcritical depth carries it: the flow passes critical depth here.
      depth = criticalDepthM
    } else {
      for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2
        if (balance(mid) < 0) low = mid
        else high = mid
      }
      depth = (low + high) / 2
    }
    head = step * rise + energy(depth)
  }
  // `head` is total head above the outlet invert; the inlet invert stands `dropM` above it.
  const inletVelocity = q / (depth === null ? fullArea : circularSection(depth, d).area)
  const headwaterM = Math.max(0, head - input.dropM + input.entranceLoss * (inletVelocity ** 2 / (2 * G)))
  return {
    ...base,
    state: 'subcritical',
    headwaterM,
    hwOverD: headwaterM / d,
    inletDepthM: depth === null ? d : depth,
    fillsBarrel: fills,
  }
}

/**
 * Outlet-control headwater of a round barrel by HDS-5's full-flow energy method (Eq. 3.5 and 3.6b,
 * `OUTLET_CONTROL`), in SI units throughout: Ku 19.63, g 9.81 m/s², metres and m³/s. Approach and
 * outlet velocities are neglected, as HDS-5's hand method does.
 */
export function fullFlowOutletControl(input: FullFlowOutletInput): OutletControlHeadwater {
  const d = input.diameterM,
    area = (Math.PI * d * d) / 4,
    radius = d / 4,
    velocity = input.flowPerBarrelM3s / area
  const friction = (OUTLET_CONTROL.kuSI * input.manningN ** 2 * input.barrelLengthM) / radius ** 1.33
  const barrelLossM = (1 + input.entranceLoss + friction) * (velocity ** 2 / (2 * G))
  const criticalDepthM = Math.min(d, circularCriticalDepth(input.flowPerBarrelM3s, d))
  const approximate = (criticalDepthM + d) / 2
  const tailwaterKnown = input.tailwaterM !== undefined && Number.isFinite(input.tailwaterM)
  const fromTailwater = tailwaterKnown && input.tailwaterM! > approximate
  const outletHeadM = fromTailwater ? input.tailwaterM! : approximate
  const headwaterM = Math.max(0, outletHeadM + barrelLossM - input.dropM),
    hwOverD = headwaterM / d
  return {
    headwaterM,
    hwOverD,
    barrelLossM,
    outletHeadM,
    criticalDepthM,
    outletHeadFrom: fromTailwater ? 'tailwater' : 'critical-and-crown',
    tailwaterKnown,
    velocityMs: velocity,
    entranceLoss: input.entranceLoss,
    manningN: input.manningN,
    range:
      hwOverD >= OUTLET_CONTROL.cautionBelowHwOverD
        ? 'full'
        : hwOverD >= OUTLET_CONTROL.approximateFloorHwOverD
          ? 'caution'
          : 'below-method',
    flowPerBarrelM3s: input.flowPerBarrelM3s,
    ...(hwOverD < OUTLET_CONTROL.approximateFloorHwOverD ? { backwater: backwaterOutletControl(input) } : {}),
  }
}

/**
 * Outlet-control headwater of a culvert at `flowM3s` (all barrels), from its own inverts, barrel
 * length, material (or the drainage run's Manning n) and inlet. Null for another shape than round,
 * and wherever an input is missing: `culvertHeadwater.ts` says which.
 */
export function outletControlHeadwater(
  c: Pick<Culvert, 'diameterM' | 'shape' | 'barrels' | 'material' | 'inletEdge' | 'inletInvertM' | 'outletInvertM'>,
  flowM3s: number,
  options: { barrelLengthM: number | null; runManningN?: number; tailwaterM?: number },
): OutletControlHeadwater | null {
  if (culvertShapeOf(c) !== 'round' || !(flowM3s >= 0)) return null
  if (c.inletInvertM === null || c.outletInvertM === null || !(options.barrelLengthM! > 0)) return null
  const material = CULVERT_MATERIALS.find((item) => item.value === c.material)
  const manningN = material?.manningN ?? options.runManningN
  if (!(manningN! > 0)) return null
  return fullFlowOutletControl({
    diameterM: c.diameterM,
    barrelLengthM: options.barrelLengthM!,
    dropM: c.inletInvertM - c.outletInvertM,
    flowPerBarrelM3s: flowM3s / culvertBarrels(c),
    manningN: manningN!,
    entranceLoss: entranceLossCoefficient(c),
    tailwaterM: options.tailwaterM,
  })
}

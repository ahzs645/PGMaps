/**
 * The headwater of one round culvert at the modelled peak: inlet control (HDS-5's inlet-control
 * equations, `inletControlHeadwater`), outlet control (HDS-5's full-flow energy method,
 * `outletControlHeadwater`), which of the two governs, how far the governing headwater stands below
 * the road over the barrel, and the smallest stock size that keeps it at or below the crown.
 *
 * A screen with stated limits: the tailwater is not known unless one is passed in, outlet control is
 * HDS-5's full-flow approximation from 0.75D up and a backwater profile up the part-full barrel below
 * it, and the road is read only along the barrel. The suggested size is a suggestion: nothing here changes a diameter.
 *
 * Free of DOM and network access.
 */
import type { Culvert, CulvertProfilePoint } from '../engineeringTypes'
import type { RoadTemplate } from '../types'
import {
  inletControlHeadwater,
  outletControlHeadwater,
  type InletControlHeadwater,
  type OutletControlHeadwater,
} from './culvertHydraulics'
import { culvertBarrels, culvertShapeOf } from './culvertShape'
import { HEADWATER_LIMIT, STOCK_DIAMETERS_M } from './engineeringManual'

export type HeadwaterControl = 'inlet' | 'outlet'

export interface GoverningHeadwater {
  control: HeadwaterControl
  headwaterM: number
  hwOverD: number
  /**
   * How outlet control was read: HDS-5's full-flow method, or (under 0.75D) the backwater profile up
   * the part-full barrel (`backwaterOutletControl`). `steep` when that profile found the barrel steep,
   * so the outlet does not control.
   */
  outletMethod: 'full-flow' | 'backwater' | 'steep'
}

export interface CulvertRoadLevel {
  /** Lowest subgrade (formation) elevation over the barrel: the subgrade shoulder on a crowned or sloped road, m. */
  lowestSubgradeM: number
  /** The same point raised by the thinner side's surfacing, m. Equal to the subgrade where no surfacing is known. */
  lowestSurfaceM: number
  surfacingM: number | null
}

export interface SuggestedCulvertSize {
  diameterM: number
  hwOverD: number
  control: HeadwaterControl
  /** How outlet control was read for this size (`GoverningHeadwater.outletMethod`). */
  outletMethod: GoverningHeadwater['outletMethod']
}

export interface CulvertHeadwater {
  inlet: InletControlHeadwater | null
  outlet: OutletControlHeadwater | null
  /** Why outlet control was not worked out; null when it was. */
  outletMissing: string | null
  /** Null while either control is missing, or outlet control could not be read. */
  governing: GoverningHeadwater | null
  /** Why no control governs; null when one does. */
  governingMissing: string | null
  /** Inlet invert plus the governing headwater, m. */
  elevationM: number | null
  road: CulvertRoadLevel | null
  /** Road surface less the governing headwater elevation, m; negative when it overtops. */
  freeboardM: number | null
  /** Subgrade shoulder less the governing headwater elevation, m. */
  shoulderFreeboardM: number | null
  /** Smallest stock size that keeps the governing HW/D at or below the limit; null where none is, or it was not worked out. */
  suggested: SuggestedCulvertSize | null
  /** Why no size is suggested; null when one is. */
  suggestedMissing: string | null
}

export interface CulvertHeadwaterInput {
  culvert: Culvert
  /** The modelled peak for every barrel together, m³/s; null without a current drainage check. */
  flowM3s: number | null
  /** What to say when there is no peak. */
  noFlowReason?: string
  /** The drainage run's Manning n, used where the culvert has no material. */
  runManningN?: number
  barrelLengthM: number | null
  profile?: readonly CulvertProfilePoint[]
  /** Surfacing over the subgrade at the culvert, the thinner side's, m; undefined where it is not known. */
  surfacingM?: number | null
  embedded: boolean
  /** A known tailwater depth above the outlet invert, m. Omitted: not known. */
  tailwaterM?: number
}

/** Surfacing over the subgrade on one side of a template, m: its course stack, else its surface depth. */
export function templateSurfacingM(t: RoadTemplate, side: 'left' | 'right'): number {
  if (t.layers !== undefined)
    return t.layers
      .filter((layer) => layer.side === 'both' || layer.side === side)
      .reduce((sum, l) => sum + l.depthM, 0)
  return (side === 'left' ? t.leftSurfaceDepth : t.rightSurfaceDepth) ?? t.surfaceDepth ?? 0
}

/** The lowest road over the barrel, from the engine's culvert profile. Null where no point lies on the formation. */
export function culvertRoadLevel(
  profile: readonly CulvertProfilePoint[] | undefined,
  surfacingM: number | null | undefined,
): CulvertRoadLevel | null {
  const levels = (profile ?? []).flatMap((p) => (p.formationElevation === null ? [] : [p.formationElevation]))
  if (!levels.length) return null
  const lowestSubgradeM = Math.min(...levels),
    surfacing = surfacingM === undefined || surfacingM === null || !(surfacingM >= 0) ? null : surfacingM
  return { lowestSubgradeM, lowestSurfaceM: lowestSubgradeM + (surfacing ?? 0), surfacingM: surfacing }
}

/**
 * Outlet control's headwater as read: the full-flow figure from 0.75D up, else the backwater
 * profile's. Null where neither could be worked out; `steep` where the outlet does not control.
 */
export function outletHeadwaterRead(
  outlet: OutletControlHeadwater,
): { headwaterM: number; hwOverD: number; method: 'full-flow' | 'backwater' } | 'steep' | null {
  if (outlet.range !== 'below-method')
    return { headwaterM: outlet.headwaterM, hwOverD: outlet.hwOverD, method: 'full-flow' }
  const backwater = outlet.backwater
  if (!backwater) return null
  if (backwater.state === 'steep') return 'steep'
  return backwater.headwaterM === null
    ? null
    : { headwaterM: backwater.headwaterM, hwOverD: backwater.hwOverD!, method: 'backwater' }
}

/** The higher of the two headwaters governs (HDS-5 DG 1.2 Step 5). Null where outlet control could not be read. */
function governingOf(inlet: InletControlHeadwater, outlet: OutletControlHeadwater): GoverningHeadwater | null {
  const read = outletHeadwaterRead(outlet)
  if (read === null) return null
  if (read === 'steep')
    return { control: 'inlet', headwaterM: inlet.headwaterM, hwOverD: inlet.hwOverD, outletMethod: 'steep' }
  if (read.headwaterM > inlet.headwaterM)
    return { control: 'outlet', headwaterM: read.headwaterM, hwOverD: read.hwOverD, outletMethod: read.method }
  return { control: 'inlet', headwaterM: inlet.headwaterM, hwOverD: inlet.hwOverD, outletMethod: read.method }
}

const trim = (value: number, digits = 2) => String(Number(value.toFixed(digits)))

export function culvertHeadwater(input: CulvertHeadwaterInput): CulvertHeadwater {
  const { culvert: c, flowM3s } = input
  const road = culvertRoadLevel(input.profile, input.surfacingM)
  const empty = (reason: string): CulvertHeadwater => ({
    inlet: null,
    outlet: null,
    outletMissing: reason,
    governing: null,
    governingMissing: reason,
    elevationM: null,
    road,
    freeboardM: null,
    shoulderFreeboardM: null,
    suggested: null,
    suggestedMissing: reason,
  })
  if (culvertShapeOf(c) !== 'round')
    return empty('Inlet- and outlet-control headwater are worked out for round pipes only')
  if (input.embedded) return empty('Embedded: the streambed changes the inlet and the barrel')
  if (flowM3s === null) return empty(input.noFlowReason ?? 'No modelled peak')

  const options = { barrelLengthM: input.barrelLengthM, runManningN: input.runManningN, tailwaterM: input.tailwaterM }
  const inlet = inletControlHeadwater(c, flowM3s)
  const outlet = outletControlHeadwater(c, flowM3s, options)
  const material = c.material !== undefined || input.runManningN !== undefined
  const outletMissing = outlet
    ? null
    : c.inletInvertM === null || c.outletInvertM === null || !(input.barrelLengthM! > 0)
      ? 'Both inverts are needed for the fall through the barrel'
      : !material
        ? 'No Manning n: set the material, or run the drainage check again'
        : 'Outlet control could not be worked out'
  let governing: GoverningHeadwater | null = null,
    governingMissing: string | null = null
  if (!inlet) governingMissing = 'No inlet-control coefficients are held for this inlet and material'
  else if (!outlet) governingMissing = outletMissing
  else {
    governing = governingOf(inlet, outlet)
    if (!governing)
      governingMissing = `Outlet control would govern at HW/D ${trim(outlet.hwOverD)} by HDS-5’s full-flow method, under 0.75, where HDS-5 does not use it, and the backwater profile could not be worked out (inlet control alone gives HW/D ${trim(inlet.hwOverD)})`
  }
  const elevationM = governing && c.inletInvertM !== null ? c.inletInvertM + governing.headwaterM : null

  // The smallest stock size by the same peak, inverts, length, material, inlet and barrels.
  let suggested: SuggestedCulvertSize | null = null,
    suggestedMissing: string | null = null
  if (!inlet && !outlet) suggestedMissing = governingMissing
  else if (!outlet) suggestedMissing = outletMissing
  else {
    for (const diameterM of STOCK_DIAMETERS_M) {
      const trial = { ...c, diameterM }
      const i = inletControlHeadwater(trial, flowM3s),
        o = outletControlHeadwater(trial, flowM3s, options)
      if (!i || !o) continue
      const g = governingOf(i, o)
      if (!g) continue
      if (g.hwOverD <= HEADWATER_LIMIT.hwOverD + 1e-6) {
        suggested = { diameterM, hwOverD: g.hwOverD, control: g.control, outletMethod: g.outletMethod }
        break
      }
    }
    if (!suggested)
      suggestedMissing = inlet
        ? `No stock size up to ${trim(STOCK_DIAMETERS_M[STOCK_DIAMETERS_M.length - 1] * 1000, 0)} mm keeps HW/D at or below ${trim(HEADWATER_LIMIT.hwOverD)}${culvertBarrels(c) > 1 ? ` with ${culvertBarrels(c)} barrels` : ''}`
        : 'No inlet-control coefficients are held for this inlet and material'
  }

  return {
    inlet,
    outlet,
    outletMissing,
    governing,
    governingMissing,
    elevationM,
    road,
    freeboardM: elevationM !== null && road ? road.lowestSurfaceM - elevationM : null,
    shoulderFreeboardM: elevationM !== null && road ? road.lowestSubgradeM - elevationM : null,
    suggested,
    suggestedMissing,
  }
}

export interface CulvertEndDepths {
  /** Ground less the invert at the inlet end, m. */
  inletM: number | null
  outletM: number | null
  /** Road surface over the centreline less the invert there, m: the fill over the invert. */
  roadM: number | null
}

/** Depth from ground and road surface down to the invert, from the engine's culvert profile. */
export function culvertEndDepths(
  profile: readonly CulvertProfilePoint[] | undefined,
  lengthM: number,
  surfacingM: number | null | undefined,
): CulvertEndDepths {
  if (!profile?.length) return { inletM: null, outletM: null, roadM: null }
  const first = profile[0],
    last = profile[profile.length - 1]
  const depth = (p: CulvertProfilePoint) =>
    p.groundElevation === null || p.invertElevation === null ? null : p.groundElevation - p.invertElevation
  const centre = profile.find((p) => Math.abs(p.distanceM - lengthM / 2) < 1e-6)
  const roadM =
    centre && centre.formationElevation !== null && centre.invertElevation !== null
      ? centre.formationElevation + (surfacingM ?? 0) - centre.invertElevation
      : null
  return { inletM: depth(first), outletM: depth(last), roadM }
}

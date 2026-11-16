/**
 * RoadEng's pit of last resort, as haul sites the material plan adds when the haul's `lastResort`
 * setting is on (a road read from RoadEng has it on).
 *
 * Softree's Optimal manual (chapter 3, "Overflow and Underflow") describes it: every material must be
 * accounted for, so when the road's cut, its borrow and waste pits and its sidecast cannot balance a
 * material, RoadEng puts the excess in an overflow pit and takes the shortage from an underflow pit,
 * both at the start of the alignment, and prices underflow material from the ground type table (the
 * material's excavation cost). It is used only once every other way of balancing is exhausted.
 *
 * Here that is an unlimited waste site at chainage 0 with no disposal cost (overflow) and one
 * unlimited borrow site per earthwork material at chainage 0 at that material's excavation rate per
 * compacted m³ (underflow), each marked `lastResort`. The network plan
 * (`networkMaterialAllocation.ts`) charges them a priority penalty, taken out before any cost is
 * reported, so it uses them only where nothing else serves; nearest-site allocation tries them
 * after every other site. A road with no materials gets one underflow site at the haul's default
 * borrow rate. The sites are made for each calculation and never stored in the project.
 *
 * Pure: no DOM or network access.
 */
import type { AlignmentEngineering, HaulSite } from './engineeringTypes'

export const LAST_RESORT_OVERFLOW_ID = 'last-resort-overflow'
export const lastResortUnderflowId = (materialId: string | null) => `last-resort-underflow-${materialId ?? 'any'}`

/** The pits of last resort the plan adds to `e.sites`; none unless `e.haul.lastResort` is on. */
export function lastResortSites(e: Pick<AlignmentEngineering, 'haul' | 'materials'>): HaulSite[] {
  if (!e.haul.lastResort) return []
  const base = { chainage: 0, accessDistanceM: 0, capacityM3: null, fixedCost: 0, lastResort: true as const }
  const earthwork = e.materials.filter((m) => m.purpose !== 'stripping' && m.compactionFactor > 0)
  return [
    { ...base, id: LAST_RESORT_OVERFLOW_ID, name: 'Overflow (pit of last resort)', kind: 'waste', unitRate: 0 },
    ...(earthwork.length
      ? earthwork.map(
          (m): HaulSite => ({
            ...base,
            id: lastResortUnderflowId(m.id),
            name: `Underflow · ${m.name}`,
            kind: 'borrow',
            unitRate: m.cutRate / m.compactionFactor,
            materialId: m.id,
          }),
        )
      : [
          {
            ...base,
            id: lastResortUnderflowId(null),
            name: 'Underflow (pit of last resort)',
            kind: 'borrow' as const,
            unitRate: e.haul.borrowRate,
          },
        ]),
  ]
}

/** The name of a pit of last resort from its id alone; null for any other site. */
export function lastResortName(siteId: string): string | null {
  if (siteId === LAST_RESORT_OVERFLOW_ID) return 'Overflow (pit of last resort)'
  return siteId.startsWith('last-resort-underflow-') ? 'Underflow (pit of last resort)' : null
}

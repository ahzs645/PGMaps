/**
 * The project's cost location: where its prices should come from. Set only by the user, either by
 * accepting the suggestion read from the road's position or by choosing a place; opening the cost
 * dialog never writes it. Free of DOM and network access.
 */
import { object, oneOf, text } from '@/lib/jsonGuards'
import type { EvidenceCurrency } from '../costEvidence/costEvidence'
import { packFor, placeCurrency, type CostPack } from './packs'
import { parseCostPlace, type CostPlace } from './places'

export interface ProjectCostLocation {
  place: CostPlace
  /** Accepted from the road's position, or chosen by hand (including from a saved home place). */
  basis: 'road-location' | 'chosen'
  /** YYYY-MM-DD the user set it. */
  setOn: string
}

export function parseProjectCostLocation(raw: unknown): ProjectCostLocation | undefined {
  if (raw === undefined) return undefined
  const r = object(raw, 'Cost location')
  const setOn = text(r.setOn, 'Cost location date', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(setOn)) throw Error('Cost location date must be a YYYY-MM-DD date.')
  return {
    place: parseCostPlace(r.place, 'Cost location'),
    basis: oneOf(r.basis, 'Cost location basis', ['road-location', 'chosen'] as const),
    setOn,
  }
}

/** The currency the project's amounts are entered in. Projects without a location stay in CAD. */
export const projectCurrency = (location: ProjectCostLocation | undefined): EvidenceCurrency =>
  placeCurrency(location?.place)

export const projectPack = (location: ProjectCostLocation | undefined): CostPack | undefined => packFor(location?.place)

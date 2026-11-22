import { formatFieldDate } from './greenUp'
import type { AnalysisResult, Availability } from './types'

/**
 * What a run's existing disturbance (line c) rests on: the harvest inventory's read over the landform, the
 * reviewer's assumption that the included features are all of it, or neither. The two are kept apart
 * (`quality.existingInventory`, `quality.existingAssumed`), so ticking the assumption over a complete read still says
 * the read was complete. Printed beside X wherever X is, as `runGreenUpBasis` is beside line c. DOM-free.
 */
export type ExistingBasis = {
  /** The source's coverage of the landform's box. `scenario-only` only on runs saved before the two were apart. */
  inventory: Availability
  /** The reviewer ticked that the included features are the existing disturbance. */
  assumed: boolean
  /** A complete source read over the landform stands behind line c. */
  sourceConfirmed: boolean
  /** "DataBC openings (…), complete over the landform, read 12 Nov 2026", or the assumption it rests on. */
  label: string
}

const SOURCE_STATUS: Record<Availability, string> = {
  complete: 'complete over the landform',
  partial: 'partial: the read does not cover the whole landform',
  unavailable: 'could not be read',
  'not-requested': 'not looked up',
  'scenario-only': 'coverage not recorded',
}

export function runExistingBasis(
  result: Pick<AnalysisResult, 'quality' | 'inputSnapshot'> | null | undefined,
): ExistingBasis | null {
  const quality = result?.quality
  if (!quality) return null
  const evidence = result?.inputSnapshot?.harvestInventory
  const inventory = quality.existingInventory
  if (!(inventory in SOURCE_STATUS)) return null
  // Runs saved before the two were apart wrote a ticked assumption over the source's status.
  const assumed = quality.existingAssumed ?? inventory === 'scenario-only'
  const date = evidence?.retrievedAt ? formatFieldDate(evidence.retrievedAt.slice(0, 10)) : null
  const source = `DataBC openings${evidence?.source ? ` (${evidence.source})` : ''}`
  // A date says when a read came back: a source never looked up, or one that could not be read, has none to give.
  const dated = date && inventory !== 'not-requested' && inventory !== 'unavailable'
  const read = `${source}, ${SOURCE_STATUS[inventory]}${dated ? `, read ${date}` : ''}`
  const sourceConfirmed = inventory === 'complete'
  const label = sourceConfirmed
    ? `${read}${assumed ? '; the reviewer also confirmed the included features' : ''}`
    : assumed
      ? // The assumption makes X ready (`runFigures`): it is the reviewer's, never the diagnostic figure's label.
        `Reviewer assumption: the included features are all the existing disturbance (not confirmed by a complete inventory read: ${read})`
      : `Not confirmed: ${read}`
  return { inventory, assumed, sourceConfirmed, label }
}

/** Preserve imported source trees before harvest independently of the marking display. No DOM access. */
import type { PrescribedCells } from '../forest'
import { prescribedCells, treatmentTints } from './prescribedCells'
import type { PrescriptionResult } from './prescription'
import type { Stand } from './standTrees'

/** Generated stands need an override only for marking; imported individuals always replace the generated grid. */
export function beforeHarvestCells(
  stand: Stand,
  result: PrescriptionResult,
  coloured: boolean,
): PrescribedCells | null {
  if (stand.source !== 'imported' && !coloured) return null
  return prescribedCells(stand, result, {
    markOnly: true,
    ...(coloured ? { tints: treatmentTints(stand, result, 'before') } : {}),
  })
}

/**
 * Every report part, from each module that defines them. A recipe names parts by id (`recipes.ts`); a part's id is
 * unique across modules (the registry test checks it). No DOM or network access.
 */
import { CONSULTANT_PARTS } from './partsConsultant'
import { DISTRICT_PARTS } from './partsDistrict'
import { FIGURE_PARTS } from './partsFigures'
import { CORE_PARTS, type ReportPart } from './parts'

export const REPORT_PARTS: readonly ReportPart[] = [
  ...CORE_PARTS,
  ...DISTRICT_PARTS,
  ...CONSULTANT_PARTS,
  ...FIGURE_PARTS,
]

export const findReportPart = (id: string): ReportPart | null => REPORT_PARTS.find((part) => part.id === id) ?? null

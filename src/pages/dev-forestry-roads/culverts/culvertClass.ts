/**
 * Whether a culvert is a major culvert under BC's Engineering Manual, which is a different question
 * from the appraisal's 1.8 m costing line (`culvertAppraisal.ts`): a major culvert needs a
 * professional engineer's design, record drawings and inspections.
 *
 * A flag for the reader, never a design decision. Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'
import { barrelOpeningArea, culvertShapeOf, culvertSpanM } from './culvertShape'
import { MAJOR_CULVERT } from './engineeringManual'

export interface MajorCulvertCriterion {
  id: 'diameter' | 'span' | 'area' | 'discharge'
  /** Null where the value it needs is not known. */
  met: boolean | null
  text: string
}

export interface CulvertClass {
  /** True when any criterion is met; false when every one is known and none is; null otherwise. */
  major: boolean | null
  criteria: MajorCulvertCriterion[]
  /** "Major culvert: opening area 3.46 m² is over 3 m²". */
  summary: string
  locator: string
}

const trim = (value: number, digits = 2) => String(Number(value.toFixed(digits)))

/**
 * `designFlowM3s` is the peak a current drainage check modelled for this culvert; without one the
 * discharge criterion stays unknown, and a culvert that meets no other criterion is then not
 * confirmed minor.
 */
export function classifyCulvert(
  culvert: Pick<Culvert, 'diameterM' | 'shape' | 'spanM' | 'openingAreaM2' | 'barrels'>,
  designFlowM3s: number | null,
): CulvertClass {
  const shape = culvertShapeOf(culvert),
    area = barrelOpeningArea(culvert)
  const criteria: MajorCulvertCriterion[] = []
  if (shape === 'round')
    criteria.push({
      id: 'diameter',
      met: culvert.diameterM >= MAJOR_CULVERT.roundDiameterM - 1e-9,
      text: `diameter ${trim(culvert.diameterM, 3)} m against ${trim(MAJOR_CULVERT.roundDiameterM)} m or more`,
    })
  else if (shape !== 'box')
    criteria.push({
      id: 'span',
      met: culvertSpanM(culvert) > MAJOR_CULVERT.archSpanM + 1e-9,
      text: `span ${trim(culvertSpanM(culvert), 3)} m against more than ${trim(MAJOR_CULVERT.archSpanM)} m`,
    })
  criteria.push({
    id: 'area',
    met: area.areaM2 > MAJOR_CULVERT.openingAreaM2 + 1e-9,
    text: `opening area ${trim(area.areaM2)} m²${area.approximate ? ' (approximate: no end area entered)' : ''} against more than ${trim(MAJOR_CULVERT.openingAreaM2)} m²`,
  })
  criteria.push({
    id: 'discharge',
    met: designFlowM3s === null ? null : designFlowM3s >= MAJOR_CULVERT.designDischargeM3s - 1e-9,
    text:
      designFlowM3s === null
        ? `design discharge not known (${trim(MAJOR_CULVERT.designDischargeM3s)} m³/s or more is major)`
        : `modelled peak ${trim(designFlowM3s)} m³/s against ${trim(MAJOR_CULVERT.designDischargeM3s)} m³/s or more`,
  })
  const hit = criteria.find((criterion) => criterion.met)
  const major = hit ? true : criteria.every((criterion) => criterion.met === false) ? false : null
  return {
    major,
    criteria,
    summary: hit
      ? `Major culvert: ${hit.text}`
      : major === false
        ? 'Not a major culvert'
        : 'Not a major culvert by size; the design discharge is not known',
    locator: MAJOR_CULVERT.locator,
  }
}

// A comparison keeps the counted areas and the chosen reference as they were at sign-off.
// Reopening it never consults the live map or a subsequently edited source row.
import { alteration, ALTERATION_RULES } from '@/lib/forestry/viaFigure/alteration'
import type { ReferenceValues } from './referenceMeasurements'
import { amount, readValues, referenceArithmetic } from './referenceMeasurements'
import { capturedSightline } from './runFigures'

export const numeratorChoices = { proposed: 'Proposed only', cumulative: 'Proposed and existing non-green' }
export const denominatorChoices = {
  gross: 'Gross visible landform',
  private: 'Less private land',
  rock: 'Less rock',
  both: 'Less private land and rock',
}
export type PixelAreas = { landform: number; proposed: number; nonVeg: number; privateLand: number; rock: number }
export type CaptureMeasurement = {
  id: string
  name: string
  viewId: string
  landformId: string
  landform: string
  renderer: string
  savedAt: string
  setup?: string
  counts: PixelAreas
  /**
   * The run's perspective sightline figure at the view's station when it was captured (`SavedFigure.sightlinePercent`):
   * the assessment's figure, printed beside the pixel figure, never replaced by it. Absent on older comparisons.
   */
  sightlinePercent?: number | null
  /** Whether the run stood behind that figure at the save, as the saved view recorded it (`capturedSightline`). */
  sightlineReadiness?: 'ready' | 'withheld'
  sightlineWithheld?: string
  /**
   * The reviewed scope PGMaps' figures for this landform were measured on (`assessmentScope.ts`'s statement), as it
   * stood when the comparison was signed: the landform and its inventory units, the blocks gross and net, the
   * denominators. Printed beside PGMaps' figures so they are never read against a historical figure measured on
   * another scope without saying so. Absent on comparisons saved before it.
   */
  scope?: string
}
export type ComparisonBasis = {
  numerator: keyof typeof numeratorChoices
  denominator: keyof typeof denominatorChoices
}
export type ReferenceComparison = {
  savedAt: string
  reviewer: string
  viewId: string
  landformId: string
  origins?: ReferenceValues
  source: ReferenceValues
  selected: ReferenceValues
  capture: CaptureMeasurement
  basis: ComparisonBasis
  referenceNumerator: ComparisonBasis['numerator'] | ''
  referenceDenominator: ComparisonBasis['denominator'] | ''
  referenceScale: 'perspective' | 'plan' | 'ocular' | ''
  benchmark: 'reported' | 'arithmetic'
  confirmed: boolean
  evidence: Array<{ name: string; sha256: string }>
}
export type ReferenceCapture = Omit<CaptureMeasurement, 'counts'> & { readCounts: () => PixelAreas }

/**
 * The run's sightline figure a comparison prints beside its pixel figure: the assessment's only where the capture
 * recorded that the run stood behind it, read through `capturedSightline`; a figure kept without that record is the
 * run's reading at the capture, never called the assessment's (`assessment: false`). `note` says why there is none.
 */
export function comparisonSightline(
  capture: Pick<CaptureMeasurement, 'sightlinePercent' | 'sightlineReadiness' | 'sightlineWithheld'>,
): { percent: number | null; assessment: boolean; note: string | null } {
  const percent = capture.sightlinePercent ?? null
  if (capture.sightlineReadiness) {
    const read = capturedSightline({ ...capture, sightlinePercent: percent })
    return {
      percent: read.percent,
      assessment: read.percent !== null,
      note: read.note ?? (read.percent === null ? 'not recorded with this figure' : null),
    }
  }
  return percent === null
    ? { percent: null, assessment: false, note: 'not recorded with this figure' }
    : { percent, assessment: false, note: null }
}
export function comparisonFigures(c: ReferenceComparison) {
  const result = alteration(
    {
      ...ALTERATION_RULES.grossPixels,
      numerator: c.basis.numerator === 'proposed' ? ['proposed'] : ['proposed', 'nonVeg'],
      deduct:
        c.basis.denominator === 'gross'
          ? []
          : c.basis.denominator === 'both'
            ? ['rock', 'privateLand']
            : c.basis.denominator === 'private'
              ? ['privateLand']
              : ['rock'],
    },
    c.capture.counts,
  )
  const reference = c.benchmark === 'reported' ? amount(c.selected.percent) : referenceArithmetic(c.selected).percentage
  const match =
    c.confirmed &&
    !!c.viewId &&
    c.viewId === c.capture.viewId &&
    !!c.landformId &&
    c.landformId === c.capture.landformId &&
    c.referenceScale === 'perspective' &&
    !/^(ha|hectares?|acres?|km[²2])$/i.test(c.selected.unit?.trim() ?? '') &&
    (c.benchmark !== 'arithmetic' ||
      (!(c.selected.numeratorMode === 'Proposed only' && c.referenceNumerator !== 'proposed') &&
        !(c.selected.numeratorMode === 'Proposed and existing' && c.referenceNumerator !== 'cumulative') &&
        !(c.selected.denominatorMode === 'Gross area' && c.referenceDenominator !== 'gross') &&
        !(
          c.selected.denominatorMode === 'Gross less deduction' &&
          Number(c.selected.deduction) > 0 &&
          c.referenceDenominator === 'gross'
        ))) &&
    c.basis.numerator === c.referenceNumerator &&
    c.basis.denominator === c.referenceDenominator
  return { result, reference, difference: match && result && reference !== null ? result.percent - reference : null }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= 12000
const member = <T extends string>(s: unknown, choices: Record<T, string>): s is T =>
  typeof s === 'string' && Object.prototype.hasOwnProperty.call(choices, s)
export function parseComparisons(raw: unknown): ReferenceComparison[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('A row can hold up to 100 historical comparisons.')
  return raw.map((c: unknown) => {
    if (
      !object(c) ||
      !object(c.basis) ||
      !object(c.capture) ||
      !object(c.capture.counts) ||
      (c.capture.setup !== undefined && !str(c.capture.setup)) ||
      (c.capture.sightlinePercent != null &&
        (typeof c.capture.sightlinePercent !== 'number' || !Number.isFinite(c.capture.sightlinePercent))) ||
      (c.capture.sightlineReadiness !== undefined &&
        c.capture.sightlineReadiness !== 'ready' &&
        c.capture.sightlineReadiness !== 'withheld') ||
      (c.capture.sightlineWithheld !== undefined && !str(c.capture.sightlineWithheld)) ||
      (c.capture.scope !== undefined && !str(c.capture.scope)) ||
      !Array.isArray(c.evidence) ||
      ![
        c.reviewer,
        c.savedAt,
        c.viewId,
        c.landformId,
        c.capture.id,
        c.capture.name,
        c.capture.viewId,
        c.capture.landformId,
        c.capture.landform,
        c.capture.renderer,
        c.capture.savedAt,
      ].every(str) ||
      !member(c.basis.numerator, numeratorChoices) ||
      !member(c.basis.denominator, denominatorChoices) ||
      !(c.referenceNumerator === '' || member(c.referenceNumerator, numeratorChoices)) ||
      !(c.referenceDenominator === '' || member(c.referenceDenominator, denominatorChoices)) ||
      !['', 'perspective', 'plan', 'ocular'].includes(String(c.referenceScale)) ||
      !['reported', 'arithmetic'].includes(String(c.benchmark)) ||
      typeof c.confirmed !== 'boolean'
    )
      throw new Error('Invalid historical comparison.')
    const counts = c.capture.counts
    if (
      !['landform', 'proposed', 'nonVeg', 'privateLand', 'rock'].every(
        (key) => typeof counts[key] === 'number' && Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0,
      )
    )
      throw new Error('Invalid capture areas.')
    if (
      c.evidence.some(
        (f) => !object(f) || !str(f.name) || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256),
      )
    )
      throw new Error('Invalid attached dataset reference.')
    return {
      ...c,
      ...(c.origins !== undefined ? { origins: readValues(c.origins) } : {}),
      source: readValues(c.source),
      selected: readValues(c.selected),
    } as ReferenceComparison
  })
}

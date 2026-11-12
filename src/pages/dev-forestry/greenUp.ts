/**
 * Green-up of existing openings: what the run assumes, and what a field check
 * found. Handbook 3.4.2 counts the share of an older opening not yet greened
 * up; the page models that share from a supplied recovery estimate or the
 * stated green-up age, and a dated, signed field check overrides the model.
 * The modelled value is kept beside it so both can be shown.
 *
 * No DOM or network access: `integrity.ts` reads the field share through
 * `appliedFieldGreenUp`, so the run and every printed label agree.
 */
import type { AnalysisResult, TargetPolygon } from './types'

export type FieldGreenUpFinding = 'yes' | 'no' | 'percent'

/** A reviewer's field check of one existing opening. */
export type FieldGreenUp = {
  /** Greened up, not greened up, or a share. */
  finding: FieldGreenUpFinding
  /** Share of the opening greened up, percent: 100 for yes, 0 for no, null while a share is blank. */
  greenedUpPercent: number | null
  /** Date of the field check, `YYYY-MM-DD`; empty until entered. */
  observedOn: string
  /** Who checked it; empty until entered. */
  observedBy: string
  /** Free text. Not a run input: editing it never stales a run. */
  note?: string
}

/** The part of a field check the run reads: complete, without the note. */
export type FieldGreenUpInput = Omit<FieldGreenUp, 'note' | 'greenedUpPercent'> & { greenedUpPercent: number }

export const FIELD_GREEN_UP_NOTE_MAX = 2000
export const FIELD_GREEN_UP_OBSERVER_MAX = 200

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function validIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function sharePercent(finding: FieldGreenUpFinding, value: unknown): number | null {
  if (finding === 'yes') return 100
  if (finding === 'no') return 0
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

/** Tolerant: anything unreadable is dropped, so scenes saved before the field record load unchanged. */
export function parseFieldGreenUp(raw: unknown): FieldGreenUp | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const finding = record.finding
  if (finding !== 'yes' && finding !== 'no' && finding !== 'percent') return undefined
  const observedOn = typeof record.observedOn === 'string' ? record.observedOn.trim() : ''
  const note = typeof record.note === 'string' ? record.note.slice(0, FIELD_GREEN_UP_NOTE_MAX) : ''
  return {
    finding,
    greenedUpPercent: sharePercent(finding, record.greenedUpPercent),
    observedOn: validIsoDate(observedOn) ? observedOn : '',
    observedBy:
      typeof record.observedBy === 'string' ? record.observedBy.trim().slice(0, FIELD_GREEN_UP_OBSERVER_MAX) : '',
    ...(note ? { note } : {}),
  }
}

/** A field check with a finding, a share, a date and an observer; anything less is a draft. */
export function fieldGreenUpInput(record: FieldGreenUp | null | undefined): FieldGreenUpInput | undefined {
  if (!record) return undefined
  const greenedUpPercent = sharePercent(record.finding, record.greenedUpPercent)
  if (greenedUpPercent === null || !validIsoDate(record.observedOn) || !record.observedBy.trim()) return undefined
  return {
    finding: record.finding,
    greenedUpPercent,
    observedOn: record.observedOn,
    observedBy: record.observedBy.trim(),
  }
}

/** Why a field check does not override the model in this assessment year, or null when it does. */
export function fieldGreenUpIssue(record: FieldGreenUp | null | undefined, assessmentYear: number): string | null {
  if (!record) return null
  if (sharePercent(record.finding, record.greenedUpPercent) === null) return 'Enter the share greened up.'
  if (!validIsoDate(record.observedOn)) return 'Enter the date of the field check.'
  if (!record.observedBy.trim()) return 'Enter who checked it.'
  const year = Number(record.observedOn.slice(0, 4))
  if (year > assessmentYear)
    return `Checked in ${year}, after the ${assessmentYear} assessment year: it says nothing about ${assessmentYear}.`
  return null
}

/** The field share the run uses, or null when the model applies. */
export function appliedFieldGreenUp(record: FieldGreenUp | null | undefined, assessmentYear: number): number | null {
  if (!record || fieldGreenUpIssue(record, assessmentYear)) return null
  return sharePercent(record.finding, record.greenedUpPercent)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-11-12` as "12 Nov 2026", independent of locale and time zone. */
export function formatFieldDate(iso: string): string {
  const match = ISO_DATE.exec(iso)
  if (!match || !validIsoDate(iso)) return iso
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

/** "field-confirmed 12 Nov 2026 by J. Smith". */
export function fieldConfirmedLabel(record: Pick<FieldGreenUp, 'observedOn' | 'observedBy'>): string {
  return `field-confirmed ${formatFieldDate(record.observedOn)} by ${record.observedBy.trim()}`
}

const pct = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`

export type ModelledGreenUp = {
  /** Share greened up, percent; null when the opening is not yet harvested in the assessment year. */
  greenedUpPercent: number | null
  basis: 'estimate' | 'age' | 'no-year' | 'future'
  /** What the modelled share rests on, e.g. "harvested 2004, 22 yr ≥ 20-yr green-up age". */
  detail: string
}

type GreenUpTarget = Pick<TargetPolygon, 'harvestYear' | 'recoveryPercent'> & { fieldGreenUp?: FieldGreenUp | null }

/** The model's share, as `alterationWeight` reads it when there is no field check. */
export function modelledGreenUp(
  target: GreenUpTarget,
  assessmentYear: number,
  greenUpAgeYears: number,
): ModelledGreenUp {
  const year = target.harvestYear
  if (year != null && year > assessmentYear)
    return { greenedUpPercent: null, basis: 'future', detail: `not yet harvested in ${assessmentYear}` }
  if (target.recoveryPercent != null) {
    const share = Math.max(0, Math.min(100, target.recoveryPercent))
    return { greenedUpPercent: share, basis: 'estimate', detail: `supplied recovery estimate ${pct(share)}` }
  }
  if (year == null)
    return { greenedUpPercent: 0, basis: 'no-year', detail: 'no harvest year: counted as not greened up' }
  const age = assessmentYear - year
  const recovered = age >= greenUpAgeYears
  return {
    greenedUpPercent: recovered ? 100 : 0,
    basis: 'age',
    detail: `harvested ${year}, ${age} yr ${recovered ? '≥' : '<'} ${greenUpAgeYears}-yr green-up age`,
  }
}

export type GreenUpReading = {
  modelled: ModelledGreenUp
  /** The field check on record, used or not. */
  field: FieldGreenUp | null
  /** Why the field check is not used; null when it is, or when there is none. */
  fieldIssue: string | null
  used: 'field' | 'modelled'
  /** The share the run uses, percent; null when the opening is not yet harvested. */
  greenedUpPercent: number | null
  /** "field-confirmed 12 Nov 2026 by J. Smith", or "modelled (…)". */
  label: string
}

/** Both values for one opening, and which the run uses. Agrees with `alterationWeight` by construction. */
export function greenUpReading(target: GreenUpTarget, assessmentYear: number, greenUpAgeYears: number): GreenUpReading {
  const modelled = modelledGreenUp(target, assessmentYear, greenUpAgeYears)
  const field = target.fieldGreenUp ?? null
  const applied = modelled.basis === 'future' ? null : appliedFieldGreenUp(field, assessmentYear)
  const fieldIssue =
    field && modelled.basis === 'future' ? modelled.detail : field ? fieldGreenUpIssue(field, assessmentYear) : null
  if (applied !== null && field)
    return {
      modelled,
      field,
      fieldIssue: null,
      used: 'field',
      greenedUpPercent: applied,
      label: fieldConfirmedLabel(field),
    }
  return {
    modelled,
    field,
    fieldIssue,
    used: 'modelled',
    greenedUpPercent: modelled.greenedUpPercent,
    label: `modelled (${modelled.detail})`,
  }
}

export type GreenUpBasis = {
  /** Openings the line counts: harvested, not site disturbance, already harvested, reaching the landform. */
  total: number
  fieldCount: number
  /** "modelled", "field-confirmed 12 Nov 2026 by J. Smith", "field-confirmed for 2 of 5 openings, modelled for 3". */
  label: string
}

/** One label for line c from the openings' readings. */
export function greenUpBasis(readings: ReadonlyArray<GreenUpReading>): GreenUpBasis {
  const total = readings.length
  const field = readings.filter((reading) => reading.used === 'field')
  const fieldCount = field.length
  if (!total) return { total, fieldCount, label: 'no existing openings counted' }
  if (!fieldCount) return { total, fieldCount, label: 'modelled' }
  const labels = new Set(field.map((reading) => reading.label))
  // "12 Nov 2026 by J. Smith" when every check is the same visit.
  const visit = labels.size === 1 ? field[0].label.replace(/^field-confirmed /, '') : null
  if (fieldCount === total) {
    if (total === 1) return { total, fieldCount, label: field[0].label }
    return {
      total,
      fieldCount,
      label: visit
        ? `field-confirmed ${visit} (${total} openings)`
        : `field-confirmed (${total} openings, several checks)`,
    }
  }
  return {
    total,
    fieldCount,
    label: `field-confirmed for ${fieldCount} of ${total} openings${visit ? ` (${visit})` : ''}, modelled for ${total - fieldCount}`,
  }
}

/**
 * The readings of the openings a run counted on line c, read from the run's own
 * input snapshot so a label always matches the figure it sits beside. An
 * opening that reaches no landform sample adds nothing and is left out.
 */
export function runGreenUpReadings(
  result: Pick<AnalysisResult, 'inputSnapshot' | 'targets'> | null | undefined,
): Array<{ id: string; name: string; reading: GreenUpReading }> {
  const input = result?.inputSnapshot
  // A run saved before the snapshot, or a partial one, has no openings to name.
  if (!input || !Array.isArray(input.targets) || !(input.settings?.greenUpAgeYears > 0)) return []
  const visibility = new Map((result.targets ?? []).map((target) => [target.targetId, target]))
  return input.targets.flatMap((target) => {
    if (target.role !== 'harvested' || target.siteDisturbance) return []
    const seen = visibility.get(target.id)
    if (seen && !seen.outOfRange && seen.areaInsideLandformMeters === 0) return []
    const reading = greenUpReading(target, input.assessmentYear, input.settings.greenUpAgeYears)
    if (reading.modelled.basis === 'future') return []
    return [{ id: target.id, name: target.name, reading }]
  })
}

/** Line c's label for a run. */
export function runGreenUpBasis(result: Pick<AnalysisResult, 'inputSnapshot' | 'targets'> | null | undefined) {
  return greenUpBasis(runGreenUpReadings(result).map((entry) => entry.reading))
}

/**
 * Keeps field checks across an inventory refresh, which replaces every
 * inventory opening with a new id. A record follows the one opening with the
 * same name; names the inventory made up from the feature's position
 * (`cutblock-N`) are not stable, and those records are not carried.
 */
export function carryFieldGreenUp<T extends Pick<TargetPolygon, 'name'> & { fieldGreenUp?: FieldGreenUp | null }>(
  previous: ReadonlyArray<T>,
  next: ReadonlyArray<T>,
): T[] {
  const byName = new Map<string, FieldGreenUp | null>()
  for (const target of previous) {
    if (!target.fieldGreenUp || /cutblock-\d+/.test(target.name)) continue
    byName.set(target.name, byName.has(target.name) ? null : target.fieldGreenUp)
  }
  const nextCount = new Map<string, number>()
  for (const target of next) nextCount.set(target.name, (nextCount.get(target.name) ?? 0) + 1)
  return next.map((target) => {
    const record = byName.get(target.name)
    return record && nextCount.get(target.name) === 1 && !target.fieldGreenUp
      ? { ...target, fieldGreenUp: record }
      : target
  })
}

/** "Green-up modelled", "Green-up field-confirmed 12 Nov 2026 by J. Smith", or "No existing openings counted". */
export function greenUpBasisLine(basis: GreenUpBasis): string {
  return basis.total ? `Green-up ${basis.label}` : 'No existing openings counted'
}

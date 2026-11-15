/**
 * Adopting an evidence record, or a saved build-up, into a project rate: the one step where the
 * catalogue reaches the estimate. The user chooses the rate (`adoptionTargets.ts`: project rates, the
 * road's haul, material, site, surfacing-source and culvert rates, and project-budget items),
 * confirms the specification matches, says what the price includes and what it is measured on, and
 * types the adopted figure. The project then keeps the observation as it was read beside that rate,
 * with every term of the record frozen (scope, tax, loading, delivery, placement, minimum,
 * surcharges, cautions, place), the reason for any difference, and any overlap with lines that
 * already price part of the work.
 *
 * Nothing here converts a currency or a unit, or escalates a price. A figure is offered as a
 * starting value only where the record is already in the project's currency, the rate's unit and,
 * when stated, the rate's measurement basis. Free of DOM and network access.
 */
import { list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'
import {
  EVIDENCE_KINDS,
  evidenceBasis,
  evidenceTerms,
  formatEvidenceAmount,
  recordPlace,
  type EvidenceAmounts,
  type EvidenceCurrency,
  type EvidenceKind,
  type EvidenceRecord,
  type EvidenceTerm,
} from './costEvidence'
import {
  adoptionTargets,
  isTargetKey,
  MEASURE_BASES,
  SETTINGS_TARGET_KEYS,
  targetFor,
  WORK_PARTS,
  writeTarget,
  type AdoptionTarget,
  type MeasureBasis,
  type SettingsTargetKey,
  type WorkPart,
} from './adoptionTargets'
import { calculateBuildUp, BUILD_UP_KINDS, type BuildUpKind, type BuildUpSnapshot } from './rateBuildUps'
import { parseCostPlace, type CostPlace } from '../costPlaces/places'
import type { RoadProject } from '../types'
import type { ScheduleTemplateItem } from '../costSchedule'

/** The four project rates, kept for callers that name them. */
export const ADOPTABLE_RATE_KEYS = SETTINGS_TARGET_KEYS
export type AdoptableRateKey = SettingsTargetKey

/** The project's limit on the four project rates (`parseSettings`). */
export const ADOPTED_RATE_MAX = 10000
export const ADOPTION_REASON_MAX = 500
/** Shorter than this, a reason says nothing a later reader can check. */
export const ADOPTION_REASON_MIN = 8

/** The record as it was read on the day it was adopted. Never updated from a later catalogue. */
export interface RateObservation {
  recordId: string
  kind: EvidenceKind
  title: string
  group: string
  place: string
  currency: EvidenceCurrency
  amounts: EvidenceAmounts
  unit: string
  costYear?: number
  effectiveDate?: string
  /** Empty for the person's own record without a link. */
  url: string
  locator?: string
  checked: string
  /** Every term the record stated, as it read: scope, tax, loading, delivery, placement… */
  terms?: EvidenceTerm[]
  cautions?: string[]
  /** Where the record applies (country, province/state, region). */
  where?: CostPlace
  origin?: 'user'
}

export interface RateAdoption {
  /** The rate the user typed (or the build-up gave), on the target's own basis and currency. */
  rate: number
  /** The record it came from; absent when it came from a build-up. */
  observation?: RateObservation
  /** The build-up it came from; absent when it came from a record. */
  buildUp?: BuildUpSnapshot
  /** Only ever stored as true: an adoption is refused without it. */
  specificationConfirmed: true
  /** Why the rate differs from the observation. Absent only when the figure was taken unchanged. */
  reason?: string
  adoptedOn: string
  /** The currency the rate was adopted in (the project's). Absent in older files: CAD. */
  currency?: EvidenceCurrency
  /** What the observed price is measured on, as the estimator read it. */
  observedBasis?: MeasureBasis
  /** The parts of the work the observed price includes, as the estimator read it. */
  includes?: WorkPart[]
  /** Overlaps with other lines found when it was adopted, and accounted for in the reason. */
  overlaps?: string[]
  /** The rate's own name and unit when adopted, so a line still reads after its target is removed. */
  target?: { label: string; unit: string }
}

/** Keyed by target (`adoptionTargets.ts`). Files written before targets keep the four project-rate keys. */
export type RateEvidence = Record<string, RateAdoption>

const REFUSED_KINDS: Partial<Record<EvidenceKind, string>> = {
  funding: 'A funding reference shows what a programme pays, not what the work costs.',
  'municipal-fee': 'A municipal fee is not a bulk construction price.',
  'maintenance-award': 'A maintenance award prices a different product and use.',
}

type Observed = Pick<EvidenceRecord, 'kind' | 'amounts' | 'unit' | 'fundingOnly' | 'contextOnly'>

/** Why a record cannot inform a project rate, or null when it can. */
export function adoptionRefusal(record: Observed): string | null {
  if (record.fundingOnly || record.kind === 'funding') return REFUSED_KINDS.funding!
  if (record.contextOnly) return 'This record is kept for source review only, not as a comparable price.'
  const kind = REFUSED_KINDS[record.kind]
  if (kind) return kind
  if (!Object.keys(record.amounts).length) return 'The source publishes no amount.'
  if (!record.unit?.trim()) return 'A whole-project amount has no unit to set a rate from.'
  return null
}

/** A record's unit read as the target's unit: "% of works subtotal" is "%". */
const unitMatches = (unit: string | undefined, target: Pick<AdoptionTarget, 'unit'>) => {
  const own = unit?.trim() ?? ''
  if (target.unit === '%') return own.startsWith('%')
  if (target.unit === '') return /allowance$|lump sum/.test(own)
  return own === target.unit
}

/**
 * The record's own figure, offered as a starting value only when it is a single amount in the
 * project's currency and the rate's unit, on the rate's basis where one was stated. Anything else
 * (a tonne, a yard, a range, another currency, loose against bank) returns null.
 */
export function adoptionPrefill(
  record: Pick<EvidenceRecord, 'currency' | 'amounts' | 'unit'>,
  target: Pick<AdoptionTarget, 'unit' | 'basis' | 'max'>,
  currency: EvidenceCurrency = 'CAD',
  observedBasis?: MeasureBasis,
): number | null {
  if (record.currency !== currency || !unitMatches(record.unit, target)) return null
  if (observedBasis && observedBasis !== target.basis) return null
  const value = record.amounts.value
  return value !== undefined && Object.keys(record.amounts).length === 1 && value > 0 && value <= target.max
    ? value
    : null
}

/** What the user is told about the gap between the record and the rate, before typing a figure. */
export function adoptionBasisNote(
  record: Pick<EvidenceRecord, 'currency' | 'amounts' | 'unit'>,
  target: Pick<AdoptionTarget, 'unit' | 'basis' | 'max'>,
  currency: EvidenceCurrency = 'CAD',
  observedBasis?: MeasureBasis,
): string {
  const unit = target.unit || ' lump sum'
  if (adoptionPrefill(record, target, currency, observedBasis) !== null)
    return `The record is already in ${currency}${unit}. Its figure is offered as a start; change it if the work differs.`
  if (record.currency !== currency)
    return `The record is in ${record.currency}. Nothing is converted: type the ${currency}${unit} rate you adopt and say how you reached it.`
  if (!unitMatches(record.unit, target))
    return `The record is priced${record.unit ?? ''}, the rate in ${currency}${unit}. Nothing is converted: type the rate you adopt and say how you reached it.`
  if (observedBasis && observedBasis !== target.basis)
    return `The record is measured on ${MEASURE_BASES[observedBasis].toLowerCase()}, the rate on ${MEASURE_BASES[target.basis].toLowerCase()}. Apply your swell or compaction factor and say which.`
  return `The record gives a range, not one figure. Type the ${currency}${unit} rate you adopt and say how you chose it.`
}

export interface AdoptionInput {
  record: EvidenceRecord
  target: AdoptionTarget
  /** The project's currency. */
  currency?: EvidenceCurrency
  /** The typed rate; null while the field is empty or not a number. */
  rate: number | null
  reason: string
  specificationConfirmed: boolean
  observedBasis?: MeasureBasis
  includes?: WorkPart[]
  /** From `adoptionOverlaps` for these includes. */
  overlaps?: string[]
}

/** Everything that stops this adoption from being saved, in the order the form asks for it. */
export function adoptionProblems(input: AdoptionInput): string[] {
  const refusal = adoptionRefusal(input.record)
  if (refusal) return [refusal]
  const problems: string[] = []
  const { target } = input
  const currency = input.currency ?? 'CAD'
  if (!input.specificationConfirmed) problems.push('Confirm the specification matches.')
  if (input.rate === null || !Number.isFinite(input.rate) || input.rate <= 0 || input.rate > target.max)
    problems.push(
      `Enter the adopted rate, above 0 and at most ${target.max.toLocaleString('en-CA')} ${currency}${target.unit}.`,
    )
  const reason = input.reason.trim()
  const prefill = adoptionPrefill(input.record, target, currency, input.observedBasis)
  if (reason.length > ADOPTION_REASON_MAX) problems.push(`Keep the reason to ${ADOPTION_REASON_MAX} characters.`)
  else if (input.overlaps?.length && reason.length < ADOPTION_REASON_MIN)
    problems.push('The price includes work another line already prices: say how you accounted for it.')
  else if (input.rate !== prefill && reason.length < ADOPTION_REASON_MIN)
    problems.push('Say why the adopted rate differs from the record (unit conversion, date, quantity, haul).')
  return problems
}

export function observationOf(record: EvidenceRecord): RateObservation {
  const terms = evidenceTerms(record)
  return {
    recordId: record.id,
    kind: record.kind,
    title: record.title,
    group: record.group,
    place: record.place,
    currency: record.currency,
    amounts: { ...record.amounts },
    unit: record.unit ?? '',
    ...(record.costYear === undefined ? {} : { costYear: record.costYear }),
    ...(record.effectiveDate === undefined ? {} : { effectiveDate: record.effectiveDate }),
    url: record.url,
    ...(record.locator === undefined ? {} : { locator: record.locator }),
    checked: record.checked,
    ...(terms.length ? { terms } : {}),
    ...(record.cautions.length ? { cautions: [...record.cautions] } : {}),
    where: recordPlace(record),
    ...(record.origin ? { origin: record.origin } : {}),
  }
}

/** The stored adoption. `today` is an ISO date, passed in so the rules stay free of the clock. */
export function createAdoption(input: AdoptionInput, today: string): RateAdoption {
  const problems = adoptionProblems(input)
  if (problems.length) throw Error(problems.join(' '))
  const reason = input.reason.trim()
  return {
    rate: input.rate!,
    observation: observationOf(input.record),
    specificationConfirmed: true,
    ...(reason ? { reason } : {}),
    adoptedOn: isoDate(today, 'Adoption date'),
    currency: input.currency ?? 'CAD',
    ...(input.observedBasis ? { observedBasis: input.observedBasis } : {}),
    ...(input.includes?.length ? { includes: [...input.includes] } : {}),
    ...(input.overlaps?.length ? { overlaps: [...input.overlaps] } : {}),
    target: { label: input.target.label, unit: input.target.unit },
  }
}

/** An adoption from a saved build-up: its formula and result are stored beside the rate. */
export function createBuildUpAdoption(
  snapshot: BuildUpSnapshot,
  target: AdoptionTarget,
  currency: EvidenceCurrency,
  today: string,
): RateAdoption {
  if (BUILD_UP_KINDS[snapshot.kind].basis !== target.basis)
    throw Error(
      `A ${BUILD_UP_KINDS[snapshot.kind].label.toLowerCase()} build-up gives a rate ${MEASURE_BASES[BUILD_UP_KINDS[snapshot.kind].basis].toLowerCase()}, not ${MEASURE_BASES[target.basis].toLowerCase()}.`,
    )
  if (!(snapshot.result > 0) || snapshot.result > target.max)
    throw Error('The build-up’s result is outside this rate’s range.')
  return {
    rate: snapshot.result,
    buildUp: { ...snapshot },
    specificationConfirmed: true,
    adoptedOn: isoDate(today, 'Adoption date'),
    currency,
    target: { label: target.label, unit: target.unit },
  }
}

/** The project with the rate written and the adoption beside it, together: one undo step. */
export function applyAdoption(
  project: RoadProject,
  key: string,
  adoption: RateAdoption,
  scheduleItems: readonly ScheduleTemplateItem[] = [],
): RoadProject {
  const next = writeTarget(project, key, adoption.rate, scheduleItems)
  return { ...next, rateEvidence: { ...project.rateEvidence, [key]: adoption } }
}

/** The evidence without one rate's observation; undefined when none is left, so the key leaves the file. */
export function withoutAdoption(evidence: RateEvidence | undefined, key: string): RateEvidence | undefined {
  if (!evidence?.[key]) return evidence
  const rest = { ...evidence }
  delete rest[key]
  return Object.keys(rest).length ? rest : undefined
}

const amount = (value: number, currency: EvidenceCurrency) =>
  (currency === 'CAD' ? '$' : `${currency} `) +
  value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

const rateText = (value: number, unit: string, currency: EvidenceCurrency) =>
  unit === '%'
    ? `${value.toLocaleString('en-CA', { maximumFractionDigits: 4 })}%`
    : `${amount(value, currency)}${unit || ' lump sum'}`

export interface RateSourceLine {
  /** The target key (`cutRate`, `road-1/haul.borrowRate`, `schedule:mobilization`). */
  rateKey: string
  label: string
  /** "Surfacing rate $40.00/m³" as adopted. */
  adopted: string
  /** "$33.70/tonne · CAD · 2026", the observation in its own unit, currency and price year; or the build-up's formula. */
  observed: string
  /** "Tender average · Granular Base Course — Des.2 Cl.25 · Alberta tender averages"; "Build-up · Pit run, truck". */
  source: string
  url: string
  /** "'2026 UPA '!B14:H14 · checked 2026-11-12". */
  locator: string
  reason: string
  adoptedOn: string
  /** The frozen terms and cautions, one line each. */
  terms: string[]
  /** "Measured on loose m³; includes haul, placing". */
  scope: string | null
  overlaps: string[]
  /** Set when the rate was edited after the adoption, so the observation no longer explains it. */
  edited: string | null
  /** Set when what the rate was for is gone from the project. */
  orphaned: string | null
  /** Set when the build-up now calculates a different figure. */
  stale: string | null
}

/** One line per adopted rate, project rates first, for the cost dialog and the report. */
export function rateSourceLines(
  evidence: RateEvidence | undefined,
  project: Pick<RoadProject, 'settings' | 'alignments' | 'activeAlignmentId' | 'costSchedule' | 'rateBuildUps'>,
  scheduleItems: readonly ScheduleTemplateItem[] = [],
): RateSourceLine[] {
  if (!evidence) return []
  const order = (key: string) => {
    const at = (SETTINGS_TARGET_KEYS as readonly string[]).indexOf(key)
    return at >= 0 ? at : key.startsWith('schedule:') ? 2000 : 1000
  }
  return Object.keys(evidence)
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((key) => {
      const adoption = evidence[key]
      const currency = adoption.currency ?? 'CAD'
      const target = targetFor(project as RoadProject, key, scheduleItems)
      const label = target?.label ?? adoption.target?.label ?? key
      const unit = target?.unit ?? adoption.target?.unit ?? ''
      const { observation, buildUp } = adoption
      const current = target?.value ?? null
      let stale: string | null = null
      if (buildUp) {
        const saved = project.rateBuildUps?.find((item) => item.id === buildUp.id)
        const now = saved ? calculateBuildUp(saved).result : null
        stale = !saved
          ? 'The build-up this rate came from has been deleted; its formula is kept here.'
          : !now?.valid || now.unitCostCad === null
            ? 'The build-up no longer calculates; its last formula is kept here.'
            : Math.abs(now.unitCostCad - buildUp.result) > 1e-9
              ? `The build-up now gives ${rateText(now.unitCostCad, unit, currency)}; apply it again to update the rate.`
              : null
      }
      const scopeParts = [
        adoption.observedBasis ? `Measured on ${MEASURE_BASES[adoption.observedBasis].toLowerCase()}` : null,
        adoption.includes?.length
          ? `includes ${adoption.includes.map((part) => WORK_PARTS[part].toLowerCase()).join(', ')}`
          : null,
      ].filter(Boolean)
      return {
        rateKey: key,
        label,
        adopted: `${label} ${rateText(adoption.rate, unit, currency)}`,
        observed: observation
          ? `${formatEvidenceAmount(observation)} · ${evidenceBasis(observation)}`
          : (buildUp?.formula ?? ''),
        source: observation
          ? [
              observation.origin === 'user' ? 'Own record' : EVIDENCE_KINDS[observation.kind].label,
              observation.title,
              observation.group,
            ].join(' · ')
          : `Build-up · ${buildUp ? `${BUILD_UP_KINDS[buildUp.kind as BuildUpKind].label} · ${buildUp.name}` : ''}`,
        url: observation?.url ?? '',
        locator: observation ? [observation.locator, `checked ${observation.checked}`].filter(Boolean).join(' · ') : '',
        reason:
          adoption.reason ??
          (observation
            ? 'No adjustment: the record’s own figure, in the rate’s unit and currency.'
            : 'The build-up’s own result.'),
        adoptedOn: adoption.adoptedOn,
        terms: [
          ...(observation?.terms ?? []).map((term) => `${term.label}: ${term.text}`),
          ...(observation?.cautions ?? []),
        ],
        scope: scopeParts.length ? scopeParts.join('; ') : null,
        overlaps: adoption.overlaps ?? [],
        edited:
          target && current !== null && Math.abs(current - adoption.rate) > 1e-9
            ? `The rate is now ${rateText(current, unit, currency)}, edited after this adoption; the source explains ${rateText(adoption.rate, unit, currency)} only.`
            : target && current === null
              ? 'The rate has since been cleared; the source explains the adopted figure only.'
              : null,
        orphaned: target
          ? null
          : 'What this rate was for is no longer in the project; the source is kept for the record.',
        stale,
      }
    })
}

/** Every rate a record could inform here; kept beside the registry so the form needs one import. */
export { adoptionTargets }

const CURRENCIES: readonly EvidenceCurrency[] = ['CAD', 'USD', 'NZD', 'GBP', 'AUD', 'EUR']
const AMOUNT_KEYS = ['value', 'low', 'mean', 'typical', 'high', 'ceiling'] as const

function isoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error(`${label} must be a YYYY-MM-DD date.`)
  return value
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}

function parseObservation(raw: unknown, label: string): RateObservation {
  const r = object(raw, label)
  const amountsRaw = object(r.amounts, `${label} amounts`)
  const amounts: EvidenceAmounts = {}
  for (const key of Object.keys(amountsRaw))
    amounts[oneOf(key, `${label} amount`, AMOUNT_KEYS)] = finite(amountsRaw[key], `${label} ${key}`, 0, 1e12)
  const origin = optional(r, 'origin', (value) => oneOf(value, `${label} origin`, ['user'] as const))
  const url =
    typeof r.url === 'string' && r.url === '' && origin === 'user' ? '' : text(r.url, `${label} source URL`, 2000)
  if (url && !/^https?:\/\//.test(url)) throw Error(`${label} source URL must be a web address.`)
  const observation: RateObservation = {
    recordId: text(r.recordId, `${label} record`, 100),
    kind: oneOf(r.kind, `${label} evidence type`, Object.keys(EVIDENCE_KINDS) as EvidenceKind[]),
    title: text(r.title, `${label} title`, 500),
    group: text(r.group, `${label} source`, 500),
    place: text(r.place, `${label} place`, 500),
    currency: oneOf(r.currency, `${label} currency`, CURRENCIES),
    amounts,
    // Kept exactly as the record prints it (" per mile", "/t"), so the amount reads the same later.
    unit: unitText(r.unit, `${label} unit`),
    ...optionalField(r, 'costYear', (value) => finite(value, `${label} price year`, 1900, 2200)),
    ...optionalField(r, 'effectiveDate', (value) => text(value, `${label} effective date`, 100)),
    url,
    ...optionalField(r, 'locator', (value) => text(value, `${label} locator`, 500)),
    checked: text(r.checked, `${label} checked date`, 40),
    ...optionalField(r, 'terms', (value) =>
      list(value, `${label} terms`, 30).map((term, i) => {
        const t = object(term, `${label} term ${i + 1}`)
        return { label: text(t.label, `${label} term label`, 60), text: text(t.text, `${label} term`, 2000) }
      }),
    ),
    ...optionalField(r, 'cautions', (value) =>
      list(value, `${label} cautions`, 30).map((caution) => text(caution, `${label} caution`, 2000)),
    ),
    ...optionalField(r, 'where', (value) => parseCostPlace(value, `${label} place`)),
    ...(origin ? { origin } : {}),
  }
  const refusal = adoptionRefusal(observation)
  if (refusal) throw Error(`${label} cannot inform a rate. ${refusal}`)
  return observation
}

function parseBuildUpSnapshot(raw: unknown, label: string): BuildUpSnapshot {
  const r = object(raw, label)
  return {
    id: text(r.id, `${label} ID`, 80),
    name: text(r.name, `${label} name`, 120),
    kind: oneOf(r.kind, `${label} kind`, Object.keys(BUILD_UP_KINDS) as BuildUpKind[]),
    formula: text(r.formula, `${label} formula`, 1000),
    result: finite(r.result, `${label} result`, 0, 1e10),
  }
}

function unitText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100)
    throw Error(`${label} must contain 1–100 characters.`)
  return value
}

function optionalField<K extends string, T>(source: JsonObject, key: K, parse: (value: unknown) => T) {
  const value = optional(source, key, parse)
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: T }
}

const WORK_PART_KEYS = Object.keys(WORK_PARTS) as WorkPart[]
const BASIS_KEYS = Object.keys(MEASURE_BASES) as MeasureBasis[]

/** Reads `project.rateEvidence` from a file. Absent stays absent; an unknown rate is refused. */
export function parseRateEvidence(raw: unknown): RateEvidence | undefined {
  if (raw === undefined) return undefined
  const r = object(raw, 'Rate sources')
  const evidence: RateEvidence = {}
  for (const key of list(Object.keys(r), 'Rate sources', 500)) {
    if (typeof key !== 'string' || !isTargetKey(key))
      throw Error(`Rate source ${String(key)} is not a rate PGMaps sets.`)
    const label = `Rate source ${key}`
    const a = object(r[key], label)
    if (a.specificationConfirmed !== true) throw Error(`${label} must record that the specification was confirmed.`)
    const reason = optional(a, 'reason', (value) => text(value, `${label} reason`, ADOPTION_REASON_MAX))
    const observation = optional(a, 'observation', (value) => parseObservation(value, label))
    const buildUp = optional(a, 'buildUp', (value) => parseBuildUpSnapshot(value, `${label} build-up`))
    if (!observation === !buildUp) throw Error(`${label} must name one record or one build-up.`)
    const max = (SETTINGS_TARGET_KEYS as readonly string[]).includes(key) ? ADOPTED_RATE_MAX : 1e10
    evidence[key] = {
      rate: finite(a.rate, `${label} adopted rate`, 0, max),
      ...(observation ? { observation } : {}),
      ...(buildUp ? { buildUp } : {}),
      specificationConfirmed: true,
      ...(reason === undefined ? {} : { reason }),
      adoptedOn: isoDate(a.adoptedOn, `${label} adoption date`),
      ...optionalField(a, 'currency', (value) => oneOf(value, `${label} currency`, CURRENCIES)),
      ...optionalField(a, 'observedBasis', (value) => oneOf(value, `${label} measured basis`, BASIS_KEYS)),
      ...optionalField(a, 'includes', (value) =>
        list(value, `${label} included work`, WORK_PART_KEYS.length).map((part) =>
          oneOf(part, `${label} included work`, WORK_PART_KEYS),
        ),
      ),
      ...optionalField(a, 'overlaps', (value) =>
        list(value, `${label} overlaps`, 20).map((item) => text(item, `${label} overlap`, 500)),
      ),
      ...optionalField(a, 'target', (value) => {
        const t = object(value, `${label} target`)
        return {
          label: text(t.label, `${label} target name`, 200),
          unit: typeof t.unit === 'string' ? t.unit.slice(0, 20) : '',
        }
      }),
    }
  }
  return Object.keys(evidence).length ? evidence : undefined
}

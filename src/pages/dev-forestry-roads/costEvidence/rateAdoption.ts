/**
 * Adopting an evidence record into a project rate, the one step where the catalogue reaches the
 * estimate. The user chooses the rate, confirms the specification matches and types the adopted
 * figure; the project then keeps the observation as it was read beside that rate, with the reason
 * for any difference.
 *
 * Nothing here converts a currency or a unit, or escalates a price. A figure is offered as a
 * starting value only where the record is already in the rate's own currency and unit. Free of DOM
 * and network access.
 */
import { list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'
import {
  EVIDENCE_KINDS,
  evidenceBasis,
  formatEvidenceAmount,
  type EvidenceAmounts,
  type EvidenceCurrency,
  type EvidenceKind,
  type EvidenceRecord,
} from './costEvidence'

export const ADOPTABLE_RATE_KEYS = ['cutRate', 'fillRate', 'surfacingRate', 'clearingRate'] as const
export type AdoptableRateKey = (typeof ADOPTABLE_RATE_KEYS)[number]

/** The project rates a record can inform, each with the basis its figure is entered on. */
export const ADOPTABLE_RATES: Record<
  AdoptableRateKey,
  { label: string; unit: '/m³' | '/m²'; basis: string; specification: string }
> = {
  cutRate: {
    label: 'Cut rate',
    unit: '/m³',
    basis: 'CAD per bank m³ excavated',
    specification: 'excavation of this ground, measured in the bank, with the same loading and disposal',
  },
  fillRate: {
    label: 'Fill rate',
    unit: '/m³',
    basis: 'CAD per m³ of fill placed',
    specification: 'placing and compacting fill, without the supply or haul priced on other lines',
  },
  surfacingRate: {
    label: 'Surfacing rate',
    unit: '/m³',
    basis: 'CAD per m³ of surfacing in place',
    specification: 'this aggregate specification, supplied, hauled and placed as the rate is meant to cover',
  },
  clearingRate: {
    label: 'Clearing rate',
    unit: '/m²',
    basis: 'CAD per m² cleared',
    specification: 'the same clearing, grubbing and disposal work on comparable timber',
  },
}

/** The project's limit on these four rates (`parseSettings`). */
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
  url: string
  locator?: string
  checked: string
}

export interface RateAdoption {
  /** The rate the user typed, on the project rate's own basis. */
  rate: number
  observation: RateObservation
  /** Only ever stored as true: an adoption is refused without it. */
  specificationConfirmed: true
  /** Why the rate differs from the observation. Absent only when the figure was taken unchanged. */
  reason?: string
  adoptedOn: string
}

export type RateEvidence = Partial<Record<AdoptableRateKey, RateAdoption>>

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

/**
 * The record's own figure, offered as a starting value only when it is a single CAD amount in the
 * rate's unit. Anything else (a tonne, a yard, a range, another currency) returns null and the
 * user types the rate.
 */
export function adoptionPrefill(
  record: Pick<EvidenceRecord, 'currency' | 'amounts' | 'unit'>,
  rateKey: AdoptableRateKey,
): number | null {
  if (record.currency !== 'CAD' || record.unit?.trim() !== ADOPTABLE_RATES[rateKey].unit) return null
  const value = record.amounts.value
  return value !== undefined && Object.keys(record.amounts).length === 1 && value > 0 && value <= ADOPTED_RATE_MAX
    ? value
    : null
}

/** What the user is told about the gap between the record and the rate, before typing a figure. */
export function adoptionBasisNote(
  record: Pick<EvidenceRecord, 'currency' | 'amounts' | 'unit'>,
  rateKey: AdoptableRateKey,
): string {
  const target = ADOPTABLE_RATES[rateKey]
  if (adoptionPrefill(record, rateKey) !== null)
    return `The record is already in CAD${target.unit}. Its figure is offered as a start; change it if the work differs.`
  if (record.currency !== 'CAD')
    return `The record is in ${record.currency}. Nothing is converted: type the CAD${target.unit} rate you adopt and say how you reached it.`
  if (record.unit?.trim() !== target.unit)
    return `The record is priced${record.unit ?? ''}, the rate in CAD${target.unit}. Nothing is converted: type the rate you adopt and say how you reached it.`
  return `The record gives a range, not one figure. Type the CAD${target.unit} rate you adopt and say how you chose it.`
}

export interface AdoptionInput {
  record: EvidenceRecord
  rateKey: AdoptableRateKey
  /** The typed rate; null while the field is empty or not a number. */
  rate: number | null
  reason: string
  specificationConfirmed: boolean
}

/** Everything that stops this adoption from being saved, in the order the form asks for it. */
export function adoptionProblems(input: AdoptionInput): string[] {
  const refusal = adoptionRefusal(input.record)
  if (refusal) return [refusal]
  const problems: string[] = []
  const target = ADOPTABLE_RATES[input.rateKey]
  if (!input.specificationConfirmed) problems.push('Confirm the specification matches.')
  if (input.rate === null || !Number.isFinite(input.rate) || input.rate <= 0 || input.rate > ADOPTED_RATE_MAX)
    problems.push(
      `Enter the adopted rate, above 0 and at most ${ADOPTED_RATE_MAX.toLocaleString('en-CA')} CAD${target.unit}.`,
    )
  const reason = input.reason.trim()
  if (reason.length > ADOPTION_REASON_MAX) problems.push(`Keep the reason to ${ADOPTION_REASON_MAX} characters.`)
  else if (input.rate !== adoptionPrefill(input.record, input.rateKey) && reason.length < ADOPTION_REASON_MIN)
    problems.push('Say why the adopted rate differs from the record (unit conversion, date, quantity, haul).')
  return problems
}

export function observationOf(record: EvidenceRecord): RateObservation {
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
  }
}

/** The project patch one adoption makes: the rate and the observation beside it, together. */
export function applyAdoption<S extends Record<AdoptableRateKey, number>>(
  project: { settings: S; rateEvidence?: RateEvidence },
  rateKey: AdoptableRateKey,
  adoption: RateAdoption,
): { settings: S; rateEvidence: RateEvidence } {
  return {
    settings: { ...project.settings, [rateKey]: adoption.rate },
    rateEvidence: { ...project.rateEvidence, [rateKey]: adoption },
  }
}

/** The evidence without one rate's observation; undefined when none is left, so the key leaves the file. */
export function withoutAdoption(
  evidence: RateEvidence | undefined,
  rateKey: AdoptableRateKey,
): RateEvidence | undefined {
  if (!evidence?.[rateKey]) return evidence
  const rest = { ...evidence }
  delete rest[rateKey]
  return Object.keys(rest).length ? rest : undefined
}

const cad = (value: number) =>
  '$' + value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

export interface RateSourceLine {
  rateKey: AdoptableRateKey
  /** "Surfacing rate $40.00/m³" as adopted. */
  adopted: string
  /** "$33.70/tonne · CAD · 2026", the observation in its own unit, currency and price year. */
  observed: string
  /** "Tender average · Granular Base Course — Des.2 Cl.25 · Alberta tender averages". */
  source: string
  url: string
  /** "'2026 UPA '!B14:H14 · checked 2026-11-12". */
  locator: string
  reason: string
  adoptedOn: string
  /** Set when the rate was edited after the adoption, so the observation no longer explains it. */
  edited: string | null
}

/** One line per adopted rate, in rate order, for the cost dialog and the report. */
export function rateSourceLines(
  evidence: RateEvidence | undefined,
  settings: Record<AdoptableRateKey, number>,
): RateSourceLine[] {
  if (!evidence) return []
  return ADOPTABLE_RATE_KEYS.flatMap((rateKey) => {
    const adoption = evidence[rateKey]
    if (!adoption) return []
    const { observation } = adoption
    const target = ADOPTABLE_RATES[rateKey]
    return [
      {
        rateKey,
        adopted: `${target.label} ${cad(adoption.rate)}${target.unit}`,
        observed: `${formatEvidenceAmount(observation)} · ${evidenceBasis(observation)}`,
        source: [EVIDENCE_KINDS[observation.kind].label, observation.title, observation.group].join(' · '),
        url: observation.url,
        locator: [observation.locator, `checked ${observation.checked}`].filter(Boolean).join(' · '),
        reason: adoption.reason ?? 'No adjustment: the record’s own figure, in the rate’s unit and currency.',
        adoptedOn: adoption.adoptedOn,
        edited:
          settings[rateKey] === adoption.rate
            ? null
            : `The rate is now ${cad(settings[rateKey])}${target.unit}, edited after this adoption; the record explains ${cad(adoption.rate)}${target.unit} only.`,
      },
    ]
  })
}

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
  const url = text(r.url, `${label} source URL`, 2000)
  if (!/^https?:\/\//.test(url)) throw Error(`${label} source URL must be a web address.`)
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
  }
  const refusal = adoptionRefusal(observation)
  if (refusal) throw Error(`${label} cannot inform a rate. ${refusal}`)
  return observation
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

/** Reads `project.rateEvidence` from a file. Absent stays absent; an unknown rate is refused. */
export function parseRateEvidence(raw: unknown): RateEvidence | undefined {
  if (raw === undefined) return undefined
  const r = object(raw, 'Rate sources')
  const evidence: RateEvidence = {}
  for (const key of list(Object.keys(r), 'Rate sources', ADOPTABLE_RATE_KEYS.length)) {
    const rateKey = oneOf(key, 'Rate source', ADOPTABLE_RATE_KEYS)
    const label = `${ADOPTABLE_RATES[rateKey].label} source`
    const a = object(r[rateKey], label)
    if (a.specificationConfirmed !== true) throw Error(`${label} must record that the specification was confirmed.`)
    const reason = optional(a, 'reason', (value) => text(value, `${label} reason`, ADOPTION_REASON_MAX))
    evidence[rateKey] = {
      rate: finite(a.rate, `${label} adopted rate`, 0, ADOPTED_RATE_MAX),
      observation: parseObservation(a.observation, label),
      specificationConfirmed: true,
      ...(reason === undefined ? {} : { reason }),
      adoptedOn: isoDate(a.adoptedOn, `${label} adoption date`),
    }
  }
  return Object.keys(evidence).length ? evidence : undefined
}

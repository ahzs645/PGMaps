/**
 * The person's own cost preferences, kept in their browser and exportable as a file: a home place
 * (where a new project's location is suggested from when its road says nothing), the evidence types
 * they read first, and their own records (contractor quotes, finished jobs) in the catalogue's
 * record shape. Preferences order what is shown and suggest; they never write a rate or a project
 * location by themselves. Free of DOM and network access; storage is the hook's job.
 */
import { list, object, oneOf, optional, text } from '@/lib/jsonGuards'
import {
  EVIDENCE_KINDS,
  type ActualCostBreakdown,
  type EvidenceCurrency,
  type EvidenceKind,
  type EvidenceRecord,
} from '../costEvidence/costEvidence'
import { regionLocalId, parseCostPlace, type CostPlace } from './places'

export interface CostPreferences {
  version: 1
  homePlace?: CostPlace
  /** Read first within each distance from the project; others follow in catalogue order. */
  preferredKinds: EvidenceKind[]
  /** The person's own records, `origin: 'user'`. */
  library: EvidenceRecord[]
}

export const EMPTY_PREFERENCES: CostPreferences = { version: 1, preferredKinds: [], library: [] }

export const PREFERENCE_LIMITS = { maxRecords: 500, maxText: 1000 } as const

/** The kinds a person's own record can be. Funding and appraisal references come from their publishers. */
export const USER_RECORD_KINDS: readonly EvidenceKind[] = [
  'supplier-price',
  'supplier-haul',
  'contract-award',
  'completed-project',
  'estimate',
]

/** Units offered for an own record, as they read after the amount. */
export const USER_RECORD_UNITS = [
  '/m³',
  '/m²',
  '/m',
  '/t',
  '/hour',
  '/km',
  '/m³·km',
  ' allowance',
  '% of works subtotal',
] as const

const CURRENCIES: readonly EvidenceCurrency[] = ['CAD', 'USD', 'NZD', 'GBP', 'AUD', 'EUR']

export interface UserRecordDraft {
  title: string
  kind: EvidenceKind
  party: string
  place: CostPlace
  placeName: string
  currency: EvidenceCurrency
  amount: number | null
  /** Empty for a whole-job amount. */
  unit: string
  /** YYYY or YYYY-MM-DD. */
  date: string
  scope: string
  tax: string
  loading: string
  delivery: string
  installation: string
  notes: string
  url: string
  actual?: ActualCostBreakdown
}

/** Everything that stops a draft being saved, in form order. */
export function userRecordProblems(draft: UserRecordDraft): string[] {
  const problems: string[] = []
  if (!draft.title.trim()) problems.push('Name the work or product.')
  if (!draft.placeName.trim()) problems.push('Say where it was.')
  if (draft.amount === null || !Number.isFinite(draft.amount) || draft.amount <= 0) problems.push('Enter the amount.')
  if (!/^\d{4}(-\d{2}-\d{2})?$/.test(draft.date.trim())) problems.push('Give the price date as YYYY or YYYY-MM-DD.')
  if (draft.url.trim() && !/^https?:\/\//.test(draft.url.trim())) problems.push('A link starts with https://.')
  if (!draft.scope.trim()) problems.push('Say what the price covers.')
  return problems
}

const clean = (value: string) => value.trim() || undefined

/** The stored record for a draft; `id` and `today` are passed in so this stays free of the clock. */
export function userRecordFrom(draft: UserRecordDraft, id: string, today: string): EvidenceRecord {
  const problems = userRecordProblems(draft)
  if (problems.length) throw Error(problems.join(' '))
  const date = draft.date.trim()
  const actual =
    draft.actual && Object.values(draft.actual).some((value) => value !== undefined) ? draft.actual : undefined
  return {
    id,
    kind: draft.kind,
    group: draft.party.trim() || 'Own records',
    title: draft.title.trim(),
    ...(draft.party.trim() ? { party: draft.party.trim() } : {}),
    place: draft.placeName.trim(),
    country: draft.place.country,
    ...(draft.place.subdivision ? { subdivision: draft.place.subdivision } : {}),
    ...(draft.place.region ? { regionId: regionLocalId(draft.place.region) } : {}),
    currency: draft.currency,
    amounts: { value: draft.amount! },
    ...(draft.unit ? { unit: draft.unit } : {}),
    costYear: Number(date.slice(0, 4)),
    ...(date.length > 4 ? { effectiveDate: date } : {}),
    ...(clean(draft.scope) ? { scope: clean(draft.scope) } : {}),
    ...(clean(draft.tax) ? { tax: clean(draft.tax) } : {}),
    ...(clean(draft.loading) ? { loading: clean(draft.loading) } : {}),
    ...(clean(draft.delivery) ? { delivery: clean(draft.delivery) } : {}),
    ...(clean(draft.installation) ? { installation: clean(draft.installation) } : {}),
    cautions: draft.notes.trim() ? [draft.notes.trim()] : [],
    url: draft.url.trim(),
    checked: today,
    origin: 'user',
    ...(actual ? { actual } : {}),
  }
}

/** A finished job's cost per km of road, from its own breakdown; null without a length. */
export function actualPerKm(record: Pick<EvidenceRecord, 'actual' | 'amounts'>): number | null {
  const length = record.actual?.lengthKm
  if (!length || !(length > 0)) return null
  const total = record.amounts.value
  return total === undefined ? null : total / length
}

function finiteOrUndefined(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12)
    throw Error(`${label} must be a positive number.`)
  return value
}

function parseRecord(raw: unknown, index: number): EvidenceRecord {
  const label = `Own record ${index + 1}`
  const r = object(raw, label)
  const place = parseCostPlace(
    { country: r.country, ...(r.subdivision === undefined ? {} : { subdivision: r.subdivision }) },
    `${label} place`,
  )
  const amounts = object(r.amounts, `${label} amounts`)
  const value = finiteOrUndefined(amounts.value, `${label} amount`)
  if (value === undefined) throw Error(`${label} needs an amount.`)
  const opt = (key: string, max: number = PREFERENCE_LIMITS.maxText) =>
    optional(r, key, (v) => text(v, `${label} ${key}`, max))
  const url = r.url === '' ? '' : text(r.url, `${label} link`, 2000)
  if (url && !/^https?:\/\//.test(url)) throw Error(`${label} link must be a web address.`)
  const actual = optional(r, 'actual', (v) => {
    const a = object(v, `${label} breakdown`)
    const out: ActualCostBreakdown = {}
    for (const key of ['lengthKm', 'subgrade', 'stabilization', 'structures', 'other'] as const) {
      const n = finiteOrUndefined(a[key], `${label} ${key}`)
      if (n !== undefined) out[key] = n
    }
    return out
  })
  const record: EvidenceRecord = {
    id: text(r.id, `${label} ID`, 100),
    kind: oneOf(r.kind, `${label} kind`, USER_RECORD_KINDS),
    group: text(r.group, `${label} group`, 200),
    title: text(r.title, `${label} title`, 300),
    place: text(r.place, `${label} place name`, 300),
    country: place.country,
    ...(place.subdivision ? { subdivision: place.subdivision } : {}),
    currency: oneOf(r.currency, `${label} currency`, CURRENCIES),
    amounts: { value },
    cautions:
      optional(r, 'cautions', (v) => list(v, `${label} notes`, 20).map((c) => text(c, `${label} note`, 2000))) ?? [],
    url,
    checked: text(r.checked, `${label} checked date`, 10),
    origin: 'user',
  }
  const party = opt('party', 200)
  const regionId = opt('regionId', 80)
  const unit = opt('unit', 40)
  const effectiveDate = opt('effectiveDate', 10)
  const costYear = optional(r, 'costYear', (v) => finiteOrUndefined(v, `${label} year`))
  for (const [key, val] of Object.entries({
    party,
    regionId,
    unit,
    effectiveDate,
    scope: opt('scope'),
    tax: opt('tax'),
    loading: opt('loading'),
    delivery: opt('delivery'),
    installation: opt('installation'),
  }))
    if (val !== undefined) (record as unknown as Record<string, unknown>)[key] = val
  if (costYear !== undefined) record.costYear = costYear
  if (actual && Object.keys(actual).length) record.actual = actual
  return record
}

/** Reads stored or imported preferences; anything unreadable is refused whole, never half-read. */
export function parseCostPreferences(raw: unknown): CostPreferences {
  const r = object(raw, 'Cost preferences')
  if (r.version !== 1) throw Error('These cost preferences are from another version.')
  const homePlace = optional(r, 'homePlace', (v) => parseCostPlace(v, 'Home place'))
  const preferredKinds =
    optional(r, 'preferredKinds', (v) =>
      list(v, 'Preferred evidence types', 20).map((kind) =>
        oneOf(kind, 'Preferred evidence type', Object.keys(EVIDENCE_KINDS) as EvidenceKind[]),
      ),
    ) ?? []
  const library = (optional(r, 'library', (v) => list(v, 'Own records', PREFERENCE_LIMITS.maxRecords)) ?? []).map(
    parseRecord,
  )
  const ids = library.map((record) => record.id)
  if (new Set(ids).size !== ids.length) throw Error('Own records must have distinct IDs.')
  return { version: 1, ...(homePlace ? { homePlace } : {}), preferredKinds, library }
}

/** Imported records join the library; one with an id already there replaces it. */
export function mergeLibrary(current: CostPreferences, imported: CostPreferences): CostPreferences {
  const byId = new Map(current.library.map((record) => [record.id, record]))
  for (const record of imported.library) byId.set(record.id, record)
  return {
    ...current,
    ...(imported.homePlace && !current.homePlace ? { homePlace: imported.homePlace } : {}),
    preferredKinds: current.preferredKinds.length ? current.preferredKinds : imported.preferredKinds,
    library: [...byId.values()],
  }
}

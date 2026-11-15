/**
 * The road-cost evidence catalogue: supplier prices, awards, completed projects, tender averages,
 * estimates and funding references, each kept in its own currency, unit and price year.
 *
 * Evidence only. Nothing here converts a currency, escalates a price, averages across sources or
 * writes a project rate; a record is read beside an estimate, never into it. The one way a record
 * reaches a rate is the user's own adoption (`rateAdoption.ts`). The records are built
 * by `scripts/forestry/cost-evidence/build-catalogue.mjs`; the user's own records (quotes, finished
 * jobs) join them from the preferences file with `origin: 'user'`. Every record carries a place
 * (country, province/state, region) that orders it against the project's location and never
 * adjusts it. Free of DOM and network access.
 */
import { regionLocalId, type CostPlace } from '../costPlaces/places'
import { countryInfo, packOfRegion, subdivisionName, COST_PACKS } from '../costPlaces/packs'

export type EvidenceKind =
  | 'supplier-price'
  | 'supplier-haul'
  | 'municipal-fee'
  | 'maintenance-award'
  | 'contract-award'
  | 'completed-project'
  | 'approximate-project'
  | 'tender-average'
  | 'estimate'
  | 'appraisal-allowance'
  | 'survey'
  | 'field-trial'
  | 'maintenance-model'
  | 'funding'

export type EvidenceFreshness = 'dated' | 'year-only' | 'undated' | 'stale' | 'promotion' | 'award'
export type EvidenceCurrency = 'CAD' | 'USD' | 'NZD' | 'GBP' | 'AUD' | 'EUR'
export type EvidenceAmounts = Partial<Record<'value' | 'low' | 'mean' | 'typical' | 'high' | 'ceiling', number>>

export interface EvidenceRecord {
  id: string
  kind: EvidenceKind
  /** The supplier, source or programme the record is listed under. */
  group: string
  title: string
  party?: string
  place: string
  /**
   * A region of the subdivision's pack, by its id inside the scheme (`omineca` for `bc-nr:omineca`):
   * the supplier's own for local prices, a location-based candidate otherwise.
   */
  regionId?: string
  country: string
  /** ISO 3166-2 province or state (`CA-BC`); absent for a national or multi-state record. */
  subdivision?: string
  currency: EvidenceCurrency
  amounts: EvidenceAmounts
  /** Reads straight after the amount ("/t", " per mile"). Absent for a whole-project amount. */
  unit?: string
  unitNote?: string
  freshness?: EvidenceFreshness
  tier?: string
  costYear?: number
  effectiveDate?: string
  dateNote?: string
  /** The quantity or number of contracts behind the figure. */
  sample?: string
  scope?: string
  tax?: string
  loading?: string
  delivery?: string
  installation?: string
  minimum?: string
  surcharges?: string[]
  surchargeNote?: string
  availability?: string
  cautions: string[]
  /** A grant ceiling or funding model: context, never a construction price. */
  fundingOnly?: boolean
  /** Kept for source review; not a comparable construction component. */
  contextOnly?: boolean
  sourceId?: string
  url: string
  locator?: string
  checked: string
  /** `user`: the person's own record, kept in their preferences, never in the catalogue. */
  origin?: 'user'
  /**
   * A finished job's own breakdown (the user's records), shaped after the BC Interior Logging Cost
   * Report's Schedule 10: road length and the subgrade, stabilization and structure costs apart.
   */
  actual?: ActualCostBreakdown
}

export interface ActualCostBreakdown {
  lengthKm?: number
  subgrade?: number
  stabilization?: number
  structures?: number
  other?: number
}

export interface EvidenceLead {
  regionId: string
  /** ISO 3166-2; the region is read inside it. */
  subdivision?: string
  party: string
  place: string
  products: string[]
  status: string
  url: string
  checked: string
}

export interface EvidenceSource {
  id: string
  role: 'numbers' | 'method'
  title: string
  publisher?: string
  url: string
  landingUrl?: string
  type?: string
  priceBasis?: string
  method?: string
  scope?: string
  use?: string
  notes: string[]
}

export interface WorkedEstimateLine {
  label: string
  quantity: number
  unit: string
  rate: number
  amount: number
}

export interface WorkedEstimate {
  id: string
  title: string
  sourceId: string
  currency: EvidenceCurrency
  costYear: number | null
  status: string
  url: string
  locator: string
  lines: WorkedEstimateLine[]
  totals: { label: string; amount: number }[]
  notes: string[]
}

export interface FuelAdjustment {
  month: string
  updated: string
  onRoadPerHour: number
  offRoadPerHour: number
  url: string
}

/** A source the review found but could not read in full: listed, never priced. */
export interface PendingSource {
  id: string
  title: string
  place: string
  country: string
  subdivision?: string
  url: string
  reason: string
}

export interface CostEvidenceCatalogue {
  /** Latest date any part was checked against its source. */
  checked: string
  records: EvidenceRecord[]
  leads: EvidenceLead[]
  sources: EvidenceSource[]
  estimates: WorkedEstimate[]
  fuel: FuelAdjustment
  projectLimits: string[]
  pending: PendingSource[]
}

export const EVIDENCE_KINDS: Record<EvidenceKind, { label: string; use: string }> = {
  'supplier-price': {
    label: 'Supplier price',
    use: 'One supplier’s published material price. Read its date, loading, delivery and tax terms with the number.',
  },
  'supplier-haul': {
    label: 'Supplier trucking rate',
    use: 'A published hourly truck rate. Payload, cycle time and fuel terms decide what a tonne costs to move.',
  },
  'municipal-fee': {
    label: 'Municipal fee',
    use: 'A fee a municipality charges for access works. Not a bulk construction price.',
  },
  'maintenance-award': {
    label: 'Maintenance award',
    use: 'An awarded supply price for maintenance material, a different product and use from road base.',
  },
  'contract-award': {
    label: 'Contract award',
    use: 'A disclosed maximum at award. Not the final cost, and published without quantities or road length.',
  },
  'completed-project': {
    label: 'Completed project',
    use: 'A reported cost for finished work. Compare only against a project of matching scope.',
  },
  'approximate-project': {
    label: 'Approximate project cost',
    use: 'A rounded construction cost given in a case study. An order of magnitude, not an account.',
  },
  'tender-average': {
    label: 'Tender average',
    use: 'An average of tender bids for a pay item. Checks whether a component rate is plausible once the specification matches.',
  },
  estimate: {
    label: 'Estimate',
    use: 'A rate inside an engineer’s, consultant’s or expert’s estimate. Read it with that estimate’s quantities, scope and allowances.',
  },
  'appraisal-allowance': {
    label: 'Appraisal allowance',
    use: 'An allowance in a timber-sale appraisal, which follows that appraisal’s own rules.',
  },
  survey: {
    label: 'Survey',
    use: 'Managers’ reported averages and ranges. The range describes the answers; it is not a confidence interval.',
  },
  'field-trial': {
    label: 'Field trial',
    use: 'Measured machine hours and invoiced materials for a treatment. Compare cost and achieved performance together.',
  },
  'maintenance-model': {
    label: 'Maintenance model',
    use: 'Recurring work priced as quantities × rates × frequency. Not a construction rate.',
  },
  funding: {
    label: 'Funding reference',
    use: 'A grant ceiling or funding model. It shows what a programme pays, not what the work costs.',
  },
}

export const EVIDENCE_FRESHNESS: Record<EvidenceFreshness, { label: string; tone: 'success' | 'neutral' | 'warning' }> =
  {
    dated: { label: 'Dated', tone: 'success' },
    'year-only': { label: 'Year only', tone: 'neutral' },
    undated: { label: 'Undated', tone: 'warning' },
    stale: { label: 'Out of date', tone: 'warning' },
    promotion: { label: 'Promotion', tone: 'warning' },
    award: { label: 'Awarded', tone: 'neutral' },
  }

/**
 * A record's place. A BC record built before places existed carried a region but no province; it is
 * read as BC, the only province whose regions the catalogue used.
 */
export function recordPlace(record: Pick<EvidenceRecord, 'country' | 'subdivision' | 'regionId'>): CostPlace {
  const subdivision = record.subdivision ?? (record.country === 'CA' && record.regionId ? 'CA-BC' : undefined)
  const scheme = subdivision ? COST_PACKS.find((pack) => pack.subdivision === subdivision)?.regionScheme : undefined
  return {
    country: record.country,
    ...(subdivision ? { subdivision } : {}),
    ...(record.regionId && scheme ? { region: `${scheme.id}:${record.regionId}` } : {}),
  }
}

/** A lead's place, read the same way. */
export const leadPlace = (lead: EvidenceLead): CostPlace =>
  recordPlace({ country: 'CA', subdivision: lead.subdivision, regionId: lead.regionId })

export interface PlaceOption {
  /** A country code (`CA`) or a subdivision code (`CA-BC`). */
  value: string
  label: string
  count: number
}

/**
 * The places present in a set of records, for the "Where" filter: each country, then each of its
 * provinces/states with records, nearest the project first when one is given.
 */
export function evidencePlaceOptions(records: readonly EvidenceRecord[], project?: CostPlace): PlaceOption[] {
  const countries = new Map<string, number>()
  const subdivisions = new Map<string, number>()
  for (const record of records) {
    const place = recordPlace(record)
    countries.set(place.country, (countries.get(place.country) ?? 0) + 1)
    if (place.subdivision) subdivisions.set(place.subdivision, (subdivisions.get(place.subdivision) ?? 0) + 1)
  }
  const rank = (code: string) =>
    project && (code === project.subdivision || code === project.country) ? 0 : code === 'CA' ? 1 : 2
  const options: PlaceOption[] = []
  for (const country of [...countries.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    const name = countryInfo(country)?.name ?? country
    options.push({ value: country, label: name, count: countries.get(country)! })
    for (const sub of [...subdivisions.keys()]
      .filter((code) => code.startsWith(country + '-'))
      .sort((a, b) => rank(a) - rank(b) || subdivisionName(a).localeCompare(subdivisionName(b))))
      options.push({ value: sub, label: `${name} · ${subdivisionName(sub)}`, count: subdivisions.get(sub)! })
  }
  return options
}

/** Whether a record lies in a filter place: a country code takes every subdivision inside it. */
export function inPlace(record: EvidenceRecord, place: string): boolean {
  const own = recordPlace(record)
  return place.includes('-') ? own.subdivision === place : own.country === place
}

const CURRENCY_SYMBOL: Record<EvidenceCurrency, string> = {
  CAD: '$',
  USD: 'US$',
  NZD: 'NZ$',
  AUD: 'A$',
  GBP: '£',
  EUR: '€',
}

/** The amount in its own currency. Cents show only where the source gives them. */
export function formatEvidenceMoney(value: number, currency: EvidenceCurrency): string {
  const cents = Number.isInteger(value) ? 0 : 2
  return (
    CURRENCY_SYMBOL[currency] +
    value.toLocaleString('en-CA', { minimumFractionDigits: cents, maximumFractionDigits: cents })
  )
}

/** "$33.70/t", "NZ$10,000–150,000 per km, mean NZ$72,000", "up to €66 per linear m". */
export function formatEvidenceAmount(record: Pick<EvidenceRecord, 'amounts' | 'currency' | 'unit'>): string {
  const { amounts, currency } = record
  const money = (value: number) => formatEvidenceMoney(value, currency)
  const unit = record.unit ?? ''
  // "3% of works subtotal": a share of other lines, not money.
  if (unit.startsWith('%') && amounts.value !== undefined)
    return `${amounts.value.toLocaleString('en-CA', { maximumFractionDigits: 2 })}${unit.replace(/^% ?/, '% ')}`
  if (amounts.value !== undefined) return money(amounts.value) + unit
  if (amounts.ceiling !== undefined) return 'up to ' + money(amounts.ceiling) + unit
  if (amounts.low !== undefined && amounts.high !== undefined) {
    const middle =
      amounts.mean !== undefined
        ? ', mean ' + money(amounts.mean)
        : amounts.typical !== undefined
          ? ', typically about ' + money(amounts.typical)
          : ''
    return money(amounts.low) + '–' + amounts.high.toLocaleString('en-CA', { maximumFractionDigits: 2 }) + unit + middle
  }
  return 'No amount published'
}

/** The currency and price year, which stay beside every amount: "CAD · 2026 prices". */
export function evidenceBasis(record: Pick<EvidenceRecord, 'currency' | 'effectiveDate' | 'costYear'>): string {
  if (record.effectiveDate) return `${record.currency} · effective ${record.effectiveDate}`
  if (record.costYear) return `${record.currency} · ${record.costYear}`
  return `${record.currency} · no price date`
}

export interface EvidenceTerm {
  label: string
  text: string
}

/**
 * What the price covers, term by term. A term the source does not state reads "Not stated", so an
 * unknown inclusion stays visible instead of reading as included or free.
 */
export function evidenceTerms(record: EvidenceRecord): EvidenceTerm[] {
  const terms: EvidenceTerm[] = []
  const supplier = record.kind === 'supplier-price' || record.kind === 'supplier-haul'
  const add = (label: string, text: string | undefined, always = false) => {
    if (text) terms.push({ label, text })
    else if (always) terms.push({ label, text: 'Not stated' })
  }
  add('Covers', record.scope)
  add('Sample', record.sample)
  add('Unit', record.unitNote)
  add('Price tier', record.tier ? record.tier.charAt(0).toUpperCase() + record.tier.slice(1) : undefined)
  add('Tax', record.tax, true)
  add('Loading', record.loading, supplier)
  add('Delivery', record.delivery, supplier)
  add('Placement', record.installation)
  add('Minimum', record.minimum)
  add('Surcharges', record.surcharges?.length ? record.surcharges.join('; ') : record.surchargeNote, supplier)
  add('Availability', record.availability)
  add('Price date', record.dateNote)
  return terms
}

/**
 * A record of what a project cost or was estimated to cost (awards, completed work, estimates), as
 * against a dated price that ages (`freshness`): supplier prices, fees and maintenance awards.
 */
export const isProjectRecord = (record: EvidenceRecord) => record.freshness === undefined

/** The evidence-type filter's choice for every project record at once, whatever its kind. */
export const PROJECT_RECORDS = 'projects'

export interface EvidenceFilter {
  /** A country (`CA`) or province/state (`CA-BC`) code. */
  place: string | 'all'
  kind: EvidenceKind | typeof PROJECT_RECORDS | 'all'
  /** A scheme-qualified region (`bc-nr:omineca`). */
  regionId: string | 'all'
  /** Words that must all appear in the title, group, place or scope. */
  query: string
}

export const NO_EVIDENCE_FILTER: EvidenceFilter = { place: 'all', kind: 'all', regionId: 'all', query: '' }

export function filterEvidence(records: readonly EvidenceRecord[], filter: EvidenceFilter): EvidenceRecord[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  return records.filter((record) => {
    if (filter.place !== 'all' && !inPlace(record, filter.place)) return false
    if (
      filter.kind === PROJECT_RECORDS ? !isProjectRecord(record) : filter.kind !== 'all' && record.kind !== filter.kind
    )
      return false
    if (filter.regionId !== 'all' && recordPlace(record).region !== filter.regionId) return false
    if (!words.length) return true
    const haystack = [record.title, record.group, record.party, record.place, record.scope].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export interface EvidenceGroup {
  name: string
  records: EvidenceRecord[]
}

/** Records under the supplier, source or programme they came from, in first-seen order. */
export function groupEvidence(records: readonly EvidenceRecord[]): EvidenceGroup[] {
  const groups = new Map<string, EvidenceRecord[]>()
  for (const record of records) {
    const list = groups.get(record.group)
    if (list) list.push(record)
    else groups.set(record.group, [record])
  }
  return [...groups].map(([name, list]) => ({ name, records: list }))
}

/** The kinds present in a set of records, in catalogue order, for the filter's options. */
export function evidenceKindsIn(records: readonly EvidenceRecord[]): EvidenceKind[] {
  const present = new Set(records.map((record) => record.kind))
  return (Object.keys(EVIDENCE_KINDS) as EvidenceKind[]).filter((kind) => present.has(kind))
}

/**
 * A region's own supplier prices and trucking rates, apart from the fees and maintenance awards
 * that describe different work and must not be read as road-base offers. `region` is qualified
 * (`bc-nr:omineca`), so two provinces' schemes never mix.
 */
export function regionLocalEvidence(catalogue: CostEvidenceCatalogue, region: string) {
  const inRegion = (record: EvidenceRecord) => recordPlace(record).region === region
  const local = catalogue.records.filter((record) => inRegion(record) && !isProjectRecord(record))
  const supplier = (record: EvidenceRecord) => record.kind === 'supplier-price' || record.kind === 'supplier-haul'
  return {
    suppliers: groupEvidence(local.filter(supplier)),
    other: local.filter((record) => !supplier(record)),
    leads: catalogue.leads.filter((lead) => leadPlace(lead).region === region),
    projects: catalogue.records.filter((record) => inRegion(record) && isProjectRecord(record)),
  }
}

/** The region's local id for a qualified id whose pack is known; null for another scheme. */
export const knownRegionLocalId = (region: string) => (packOfRegion(region) ? regionLocalId(region) : null)

/**
 * Records ordered by how near they are to the project (same region, province/state, country,
 * elsewhere), then by the person's preferred evidence types, keeping catalogue order within a tie.
 * Ordering only: nothing is weighted, dropped or averaged.
 */
export function sortByRelevance(
  records: readonly EvidenceRecord[],
  project: CostPlace | undefined,
  preferredKinds: readonly EvidenceKind[] = [],
): EvidenceRecord[] {
  const rank = (record: EvidenceRecord) => {
    const place = recordPlace(record)
    const near = !project
      ? 0
      : place.country !== project.country
        ? 3
        : place.subdivision && place.subdivision === project.subdivision
          ? place.region && place.region === project.region
            ? 0
            : 1
          : 2
    const kind = preferredKinds.indexOf(record.kind)
    return near * 100 + (kind < 0 ? 50 : kind)
  }
  return records
    .map((record, index) => ({ record, index, rank: rank(record) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ record }) => record)
}

/** Sum of an estimate's lines, for checking it against its printed subtotal. */
export function workedEstimateLineTotal(estimate: WorkedEstimate): number {
  return Math.round(estimate.lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100
}

export interface GroupTerms {
  /** Terms and cautions every record in the group states the same way, shown once. */
  shared: EvidenceTerm[]
  sharedCautions: string[]
  /** What is left for each record, by id. */
  own: Map<string, { terms: EvidenceTerm[]; cautions: string[] }>
}

/**
 * Splits a group's terms into those common to every record and those of one record, so a supplier's
 * tax and delivery terms print once instead of under each product. A single record keeps its own.
 */
export function groupTerms(records: readonly EvidenceRecord[]): GroupTerms {
  const all = records.map((record) => ({ record, terms: evidenceTerms(record) }))
  const everyRecordHas = <T>(pick: (index: number) => readonly T[], same: (a: T, b: T) => boolean, item: T) =>
    all.every((_, index) => pick(index).some((other) => same(item, other)))
  const sameTerm = (a: EvidenceTerm, b: EvidenceTerm) => a.label === b.label && a.text === b.text
  const several = records.length > 1
  const shared = several
    ? all[0].terms.filter((term) => everyRecordHas((index) => all[index].terms, sameTerm, term))
    : []
  const sharedCautions = several
    ? records[0].cautions.filter((caution) =>
        everyRecordHas(
          (index) => records[index].cautions,
          (a, b) => a === b,
          caution,
        ),
      )
    : []
  const own = new Map(
    all.map(({ record, terms }) => [
      record.id,
      {
        terms: terms.filter((term) => !shared.some((other) => sameTerm(term, other))),
        cautions: record.cautions.filter((caution) => !sharedCautions.includes(caution)),
      },
    ]),
  )
  return { shared, sharedCautions, own }
}

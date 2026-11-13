/**
 * The road-cost evidence catalogue: supplier prices, awards, completed projects, tender averages,
 * estimates and funding references, each kept in its own currency, unit and price year.
 *
 * Evidence only. Nothing here converts a currency, escalates a price, averages across sources or
 * writes a project rate; a record is read beside an estimate, never into it. The one way a record
 * reaches a rate is the user's own adoption (`rateAdoption.ts`). The records are built
 * by `scripts/forestry/cost-evidence/build-catalogue.mjs`. Free of DOM and network access.
 */

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
  /** A BC natural resource region: the supplier's own for local prices, a location-based candidate otherwise. */
  regionId?: string
  country: string
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
}

export interface EvidenceLead {
  regionId: string
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

export interface CostEvidenceCatalogue {
  /** Latest date any part was checked against its source. */
  checked: string
  records: EvidenceRecord[]
  leads: EvidenceLead[]
  sources: EvidenceSource[]
  estimates: WorkedEstimate[]
  fuel: FuelAdjustment
  projectLimits: string[]
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

export type EvidencePlace = 'bc' | 'canada' | 'us' | 'elsewhere'
export const EVIDENCE_PLACES: Record<EvidencePlace, string> = {
  bc: 'British Columbia',
  canada: 'Canada outside BC',
  us: 'United States',
  elsewhere: 'New Zealand, England, Australia, Ireland',
}

/** BC records carry a region or come from a BC package; everything else is placed by country. */
export function evidencePlace(record: EvidenceRecord): EvidencePlace {
  if (record.country === 'US') return 'us'
  if (record.country !== 'CA') return 'elsewhere'
  return record.sourceId ? 'canada' : 'bc'
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

export interface EvidenceFilter {
  place: EvidencePlace | 'all'
  kind: EvidenceKind | 'all'
  regionId: string | 'all'
  /** Words that must all appear in the title, group, place or scope. */
  query: string
}

export const NO_EVIDENCE_FILTER: EvidenceFilter = { place: 'all', kind: 'all', regionId: 'all', query: '' }

export function filterEvidence(records: readonly EvidenceRecord[], filter: EvidenceFilter): EvidenceRecord[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  return records.filter((record) => {
    if (filter.place !== 'all' && evidencePlace(record) !== filter.place) return false
    if (filter.kind !== 'all' && record.kind !== filter.kind) return false
    if (filter.regionId !== 'all' && record.regionId !== filter.regionId) return false
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
 * that describe different work and must not be read as road-base offers.
 */
export function regionLocalEvidence(catalogue: CostEvidenceCatalogue, regionId: string) {
  const local = catalogue.records.filter((record) => record.regionId === regionId && record.freshness !== undefined)
  const supplier = (record: EvidenceRecord) => record.kind === 'supplier-price' || record.kind === 'supplier-haul'
  return {
    suppliers: groupEvidence(local.filter(supplier)),
    other: local.filter((record) => !supplier(record)),
    leads: catalogue.leads.filter((lead) => lead.regionId === regionId),
    projects: catalogue.records.filter((record) => record.regionId === regionId && record.freshness === undefined),
  }
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

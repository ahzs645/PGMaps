/**
 * The project cost schedule: everything a road budget needs beyond the covered construction
 * estimate (survey and design, construction support, environmental work, contractor indirects,
 * owner costs, and future maintenance and deactivation). Every item is in one of five states, so
 * completeness is a statement about scope, not a figure that has to be typed everywhere:
 *
 * - **priced** and **allowance** carry an amount (lump sum, % of the construction estimate, or per km);
 * - **included** names the line that already carries the cost;
 * - **excluded** gives the reason;
 * - **not assessed** is the default, and stays visible until someone decides.
 *
 * The schedule sits beside the construction estimate and never changes it: route searches and the
 * profile optimizer compare roads on `estimatedCost`, and project-wide items would only shift every
 * road equally or skew them by length. Future items are costed over a stated horizon, undiscounted
 * and, with a discount rate, as a present value. The item list follows the FHWA Western Federal Lands
 * Estimating Handbook (December 2025) cost structure and the 2026 road-cost audit; a cost pack adds
 * its own jurisdiction's items. Free of DOM and network access.
 */
import { list, object, oneOf, optional, text } from '@/lib/jsonGuards'

export type ScheduleGroup = 'investigation' | 'support' | 'environmental' | 'contractor' | 'owner' | 'future'
export type ScheduleStatus = 'priced' | 'allowance' | 'included' | 'excluded' | 'not-assessed'
export type ScheduleBasis = 'lump-sum' | 'percent' | 'per-km'

export const SCHEDULE_GROUPS: Record<ScheduleGroup, { label: string; note: string }> = {
  investigation: {
    label: 'Investigation and design',
    note: 'Survey, terrain, geotechnical, drainage and structure design.',
  },
  support: {
    label: 'Construction support',
    note: 'Mobilization, temporary access, water management, traffic control and camp.',
  },
  environmental: { label: 'Environmental work', note: 'Erosion control, monitoring, restoration and revegetation.' },
  contractor: {
    label: 'Contractor indirects',
    note: 'Supervision, insurance, bonding, overhead and profit, where the unit rates do not already carry them.',
  },
  owner: { label: 'Owner and project costs', note: 'Administration, tenure and access arrangements, taxes and fees.' },
  future: {
    label: 'Future work',
    note: 'Maintenance, regravelling, inspections and deactivation, costed over the horizon below and kept out of the construction budget.',
  },
}

export const SCHEDULE_STATUSES: Record<
  ScheduleStatus,
  { label: string; tone: 'success' | 'neutral' | 'warning'; describe: string }
> = {
  priced: { label: 'Priced', tone: 'success', describe: 'A quoted or estimated amount.' },
  allowance: { label: 'Allowance', tone: 'neutral', describe: 'A provisional sum until the work is defined.' },
  included: { label: 'Included elsewhere', tone: 'success', describe: 'Already carried by another line.' },
  excluded: { label: 'Excluded', tone: 'neutral', describe: 'Left out of this budget, for the reason given.' },
  'not-assessed': { label: 'Not assessed', tone: 'warning', describe: 'Nobody has decided yet.' },
}

export const SCHEDULE_BASES: Record<ScheduleBasis, { label: string; unit: string }> = {
  'lump-sum': { label: 'Lump sum', unit: '' },
  percent: { label: '% of construction', unit: '%' },
  'per-km': { label: 'Per km of road', unit: '/km' },
}

export interface ScheduleTemplateItem {
  id: string
  group: ScheduleGroup
  label: string
  hint: string
  /** The basis offered first when the item is priced. */
  basis?: ScheduleBasis
}

export interface ScheduleRecurrence {
  /** Years after construction of the first occurrence, 0–100. */
  firstYear: number
  /** Years between occurrences; 0 is once. */
  everyYears: number
}

/** The user's decision on one item. Template items are stored only once decided; custom items always. */
export interface ScheduleEntry {
  id: string
  status: ScheduleStatus
  basis?: ScheduleBasis
  /** Lump sum or per-km amount, in the project currency. */
  amount?: number
  /** % of the construction estimate. */
  percent?: number
  /** For `included`: the line that carries it. */
  includedIn?: string
  /** For `excluded`, and any note on the others. */
  reason?: string
  /** Where the figure came from: quote, estimate, record. */
  source?: string
  /** Future items only. */
  recurrence?: ScheduleRecurrence
  /** Custom items only: their group and name. */
  group?: ScheduleGroup
  label?: string
}

export interface ScheduleLifecycle {
  /** Years the future items are costed over, 1–100. */
  horizonYears: number
  /** Real discount rate, % a year; 0 is undiscounted. */
  discountRatePercent: number
}

export interface CostScheduleState {
  entries: ScheduleEntry[]
  lifecycle?: ScheduleLifecycle
}

export const SCHEDULE_LIMITS = {
  maxEntries: 100,
  maxAmount: 1e10,
  maxPercent: 200,
  maxText: 500,
  maxHorizonYears: 100,
  maxDiscountPercent: 30,
} as const

export const DEFAULT_LIFECYCLE: ScheduleLifecycle = { horizonYears: 20, discountRatePercent: 0 }

export const GENERIC_SCHEDULE_ITEMS: readonly ScheduleTemplateItem[] = [
  {
    id: 'survey-layout',
    group: 'investigation',
    label: 'Survey and layout',
    hint: 'Traverse, P-line and construction staking.',
    basis: 'per-km',
  },
  {
    id: 'geotechnical',
    group: 'investigation',
    label: 'Geotechnical and terrain investigation',
    hint: 'Test pits, soil and rock classification, terrain stability field work.',
  },
  {
    id: 'design',
    group: 'investigation',
    label: 'Drainage and structure design',
    hint: 'Hydrology, culvert and bridge design, professional sign-off.',
  },
  {
    id: 'mobilization',
    group: 'support',
    label: 'Mobilization and demobilization',
    hint: 'Moving equipment and crews to and from the site.',
    basis: 'percent',
  },
  {
    id: 'temporary-access',
    group: 'support',
    label: 'Temporary access and detours',
    hint: 'Access to the work, detour roads and their removal.',
  },
  {
    id: 'water-management',
    group: 'support',
    label: 'Stream isolation and water management',
    hint: 'Bypass pumping or flumes, fish salvage, dewatering.',
  },
  { id: 'traffic-control', group: 'support', label: 'Traffic control', hint: 'Signage, flaggers, road-use notices.' },
  {
    id: 'camp-travel',
    group: 'support',
    label: 'Camp, accommodation and travel',
    hint: 'Where the crew cannot commute daily.',
  },
  {
    id: 'erosion-control',
    group: 'environmental',
    label: 'Erosion and sediment control',
    hint: 'Silt fence, matting, grass seed, sediment ponds.',
  },
  {
    id: 'environmental-monitoring',
    group: 'environmental',
    label: 'Environmental monitoring',
    hint: 'Qualified environmental professional on site during in-stream work.',
    basis: 'percent',
  },
  {
    id: 'restoration',
    group: 'environmental',
    label: 'Restoration and revegetation',
    hint: 'Rehabilitating borrow pits, waste areas and disturbed ground.',
  },
  {
    id: 'supervision',
    group: 'contractor',
    label: 'Site supervision and inspection',
    hint: 'Construction supervision and the owner’s field reviews.',
    basis: 'percent',
  },
  {
    id: 'insurance-bonding',
    group: 'contractor',
    label: 'Insurance and bonding',
    hint: 'Performance and labour-material bonds, liability insurance.',
    basis: 'percent',
  },
  {
    id: 'overhead-profit',
    group: 'contractor',
    label: 'Contractor overhead and profit',
    hint: 'Where the unit rates are bare costs. Appraisal allowances usually leave them out.',
    basis: 'percent',
  },
  {
    id: 'project-management',
    group: 'owner',
    label: 'Owner administration and project management',
    hint: 'Tendering, contract administration, owner staff time.',
  },
  {
    id: 'land-access',
    group: 'owner',
    label: 'Land, tenure and access arrangements',
    hint: 'Road permits, crossings of other tenures, private land.',
  },
  {
    id: 'taxes-fees',
    group: 'owner',
    label: 'Other taxes and fees',
    hint: 'Taxes and fees not listed separately for this jurisdiction.',
  },
  {
    id: 'maintenance',
    group: 'future',
    label: 'Routine maintenance',
    hint: 'Grading, ditch and culvert cleaning, brushing.',
    basis: 'per-km',
  },
  {
    id: 'regravelling',
    group: 'future',
    label: 'Regravelling',
    hint: 'Surfacing replaced as it wears or is lost.',
    basis: 'per-km',
  },
  {
    id: 'inspections',
    group: 'future',
    label: 'Inspections',
    hint: 'Road and structure inspections the road’s status requires.',
  },
  {
    id: 'deactivation',
    group: 'future',
    label: 'Deactivation and rehabilitation',
    hint: 'Removing crossings, restoring drainage, rehabilitating the running surface.',
    basis: 'per-km',
  },
]

export interface ScheduleContext {
  /** The covered construction estimate, including its contingency. */
  constructionTotal: number
  lengthKm: number
  /** The construction estimate's own mobilization line; above zero, mobilization reads as included there. */
  mobilizationInEstimate: number
}

export interface ScheduleRow {
  id: string
  group: ScheduleGroup
  label: string
  hint?: string
  status: ScheduleStatus
  basis: ScheduleBasis
  /** One-time cost, or the cost of one occurrence for a future item; null where none is entered. */
  amount: number | null
  entry?: ScheduleEntry
  custom: boolean
  /** Set when the status comes from the estimate, not from a decision: "the Mobilization line". */
  derived?: string
  recurrence?: ScheduleRecurrence
}

/** Template items and custom items with the user's decisions applied, in group order. */
export function resolveSchedule(
  state: CostScheduleState | undefined,
  packItems: readonly ScheduleTemplateItem[],
  context: ScheduleContext,
): ScheduleRow[] {
  const entries = new Map((state?.entries ?? []).map((entry) => [entry.id, entry]))
  const templates = [...GENERIC_SCHEDULE_ITEMS, ...packItems]
  const rows: ScheduleRow[] = templates.map((template) => {
    const entry = entries.get(template.id)
    if (entry) return rowFor(entry, template, context, false)
    if (template.id === 'mobilization' && context.mobilizationInEstimate > 0)
      return {
        id: template.id,
        group: template.group,
        label: template.label,
        hint: template.hint,
        status: 'included',
        basis: template.basis ?? 'lump-sum',
        amount: null,
        custom: false,
        derived: 'The construction estimate’s Mobilization line',
      }
    return {
      id: template.id,
      group: template.group,
      label: template.label,
      hint: template.hint,
      status: 'not-assessed',
      basis: template.basis ?? 'lump-sum',
      amount: null,
      custom: false,
    }
  })
  const known = new Set(templates.map((template) => template.id))
  for (const entry of state?.entries ?? [])
    if (!known.has(entry.id) && entry.group && entry.label) rows.push(rowFor(entry, undefined, context, true))
  const order = Object.keys(SCHEDULE_GROUPS) as ScheduleGroup[]
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => order.indexOf(a.row.group) - order.indexOf(b.row.group) || a.index - b.index)
    .map(({ row }) => row)
}

function rowFor(
  entry: ScheduleEntry,
  template: ScheduleTemplateItem | undefined,
  context: ScheduleContext,
  custom: boolean,
): ScheduleRow {
  const group = template?.group ?? entry.group!
  const basis = entry.basis ?? template?.basis ?? 'lump-sum'
  return {
    id: entry.id,
    group,
    label: template?.label ?? entry.label!,
    ...(template?.hint ? { hint: template.hint } : {}),
    status: entry.status,
    basis,
    amount: entry.status === 'priced' || entry.status === 'allowance' ? entryAmount(entry, basis, context) : null,
    entry,
    custom,
    ...(group === 'future' && entry.recurrence ? { recurrence: entry.recurrence } : {}),
  }
}

function entryAmount(entry: ScheduleEntry, basis: ScheduleBasis, context: ScheduleContext): number | null {
  if (basis === 'percent') return entry.percent === undefined ? null : (context.constructionTotal * entry.percent) / 100
  if (entry.amount === undefined) return null
  return basis === 'per-km' ? entry.amount * context.lengthKm : entry.amount
}

/** What still stops a row being read: a priced item with no amount, an exclusion with no reason. */
export function scheduleRowProblem(row: ScheduleRow): string | null {
  if ((row.status === 'priced' || row.status === 'allowance') && row.amount === null)
    return 'Enter its amount, or mark it not assessed.'
  if (row.status === 'excluded' && !row.entry?.reason?.trim()) return 'Say why it is excluded.'
  if (row.status === 'included' && !row.derived && !row.entry?.includedIn?.trim())
    return 'Name the line that carries it.'
  if (row.group === 'future' && (row.status === 'priced' || row.status === 'allowance') && !row.recurrence)
    return 'Give the year it first falls due and how often.'
  return null
}

export interface LifecycleLine {
  id: string
  label: string
  /** Years after construction it falls due, within the horizon. */
  years: number[]
  undiscounted: number
  presentValue: number
}

export interface BudgetSummary {
  construction: number
  /** Priced and allowance items paid during construction. */
  projectItems: number
  allowances: number
  /** Construction plus project items: the construction-period budget. */
  projectBudget: number
  counts: Record<ScheduleStatus, number>
  notAssessed: ScheduleRow[]
  problems: { row: ScheduleRow; problem: string }[]
  lifecycle: {
    horizonYears: number
    discountRatePercent: number
    lines: LifecycleLine[]
    undiscounted: number
    presentValue: number
  }
}

/** The years an occurrence falls in within the horizon. */
export function occurrenceYears(recurrence: ScheduleRecurrence, horizonYears: number): number[] {
  const years: number[] = []
  if (recurrence.firstYear > horizonYears) return years
  if (recurrence.everyYears <= 0) return [recurrence.firstYear]
  for (let year = recurrence.firstYear; year <= horizonYears; year += recurrence.everyYears) years.push(year)
  return years
}

export function summarizeBudget(
  rows: readonly ScheduleRow[],
  context: ScheduleContext,
  lifecycle: ScheduleLifecycle = DEFAULT_LIFECYCLE,
): BudgetSummary {
  const counts = { priced: 0, allowance: 0, included: 0, excluded: 0, 'not-assessed': 0 } as Record<
    ScheduleStatus,
    number
  >
  let projectItems = 0,
    allowances = 0
  const lines: LifecycleLine[] = []
  const rate = lifecycle.discountRatePercent / 100
  for (const row of rows) {
    counts[row.status]++
    if (row.amount === null || (row.status !== 'priced' && row.status !== 'allowance')) continue
    if (row.group === 'future') {
      if (!row.recurrence) continue
      const years = occurrenceYears(row.recurrence, lifecycle.horizonYears)
      const amount = row.amount
      lines.push({
        id: row.id,
        label: row.label,
        years,
        undiscounted: amount * years.length,
        presentValue: years.reduce((sum, year) => sum + amount / (1 + rate) ** year, 0),
      })
      continue
    }
    projectItems += row.amount
    if (row.status === 'allowance') allowances += row.amount
  }
  return {
    construction: context.constructionTotal,
    projectItems,
    allowances,
    projectBudget: context.constructionTotal + projectItems,
    counts,
    notAssessed: rows.filter((row) => row.status === 'not-assessed'),
    problems: rows.flatMap((row) => {
      const problem = scheduleRowProblem(row)
      return problem ? [{ row, problem }] : []
    }),
    lifecycle: {
      ...lifecycle,
      lines,
      undiscounted: lines.reduce((sum, line) => sum + line.undiscounted, 0),
      presentValue: lines.reduce((sum, line) => sum + line.presentValue, 0),
    },
  }
}

/** The state with one entry set (added or replaced). */
export function withEntry(state: CostScheduleState | undefined, entry: ScheduleEntry): CostScheduleState {
  const entries = state?.entries ?? []
  const at = entries.findIndex((item) => item.id === entry.id)
  return {
    ...state,
    entries: at < 0 ? [...entries, entry] : entries.map((item, i) => (i === at ? entry : item)),
  }
}

/** Without one entry: a template item goes back to its default, a custom item is removed. Undefined when empty. */
export function withoutEntry(state: CostScheduleState | undefined, id: string): CostScheduleState | undefined {
  if (!state) return undefined
  const entries = state.entries.filter((entry) => entry.id !== id)
  return entries.length || state.lifecycle ? { ...state, entries } : undefined
}

const GROUPS = Object.keys(SCHEDULE_GROUPS) as ScheduleGroup[]
const STATUSES = Object.keys(SCHEDULE_STATUSES) as ScheduleStatus[]
const BASES = Object.keys(SCHEDULE_BASES) as ScheduleBasis[]

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}

function opt<K extends string, T>(r: Record<string, unknown>, key: K, parse: (value: unknown) => T) {
  const value = optional(r, key, parse)
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: T }
}

export function parseCostSchedule(raw: unknown): CostScheduleState | undefined {
  if (raw === undefined) return undefined
  const r = object(raw, 'Cost schedule')
  const L = SCHEDULE_LIMITS
  const entries = list(r.entries, 'Cost schedule items', L.maxEntries).map((value, index): ScheduleEntry => {
    const label = `Cost schedule item ${index + 1}`
    const e = object(value, label)
    const entry: ScheduleEntry = {
      id: text(e.id, `${label} ID`, 80),
      status: oneOf(e.status, `${label} status`, STATUSES),
      ...opt(e, 'basis', (v) => oneOf(v, `${label} basis`, BASES)),
      ...opt(e, 'amount', (v) => finite(v, `${label} amount`, 0, L.maxAmount)),
      ...opt(e, 'percent', (v) => finite(v, `${label} percent`, 0, L.maxPercent)),
      ...opt(e, 'includedIn', (v) => text(v, `${label} included in`, L.maxText)),
      ...opt(e, 'reason', (v) => text(v, `${label} reason`, L.maxText)),
      ...opt(e, 'source', (v) => text(v, `${label} source`, L.maxText)),
      ...opt(e, 'recurrence', (v) => {
        const o = object(v, `${label} recurrence`)
        return {
          firstYear: finite(o.firstYear, `${label} first year`, 0, L.maxHorizonYears),
          everyYears: finite(o.everyYears, `${label} interval`, 0, L.maxHorizonYears),
        }
      }),
      ...opt(e, 'group', (v) => oneOf(v, `${label} group`, GROUPS)),
      ...opt(e, 'label', (v) => text(v, `${label} name`, 120)),
    }
    if ((entry.group === undefined) !== (entry.label === undefined))
      throw Error(`${label} needs both a group and a name, or neither.`)
    return entry
  })
  const ids = entries.map((entry) => entry.id)
  if (new Set(ids).size !== ids.length) throw Error('Cost schedule items must have distinct IDs.')
  const lifecycle = optional(r, 'lifecycle', (v) => {
    const o = object(v, 'Lifecycle')
    return {
      horizonYears: finite(o.horizonYears, 'Lifecycle horizon', 1, SCHEDULE_LIMITS.maxHorizonYears),
      discountRatePercent: finite(o.discountRatePercent, 'Discount rate', 0, SCHEDULE_LIMITS.maxDiscountPercent),
    }
  })
  return { entries, ...(lifecycle ? { lifecycle } : {}) }
}

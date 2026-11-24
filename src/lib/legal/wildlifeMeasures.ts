/**
 * The general wildlife measures read from the ungulate winter range and wildlife habitat area orders
 * (`packages/legal-rules/ground/wildlife-measures.json`): for each order read, its units or zones as
 * the order names them, each measure that bears on harvest, replanting, roads or grazing (a
 * paraphrase and a quote of under 125 characters), and the order's exemption and approval clauses.
 * Orders found but not read, and data-sensitive habitat areas whose orders are not published, are
 * listed so a screen can name them rather than guess.
 *
 * Read by hand (no schema library ships to the browser). An order's answer comes only from its own
 * text; nothing here decides that a measure applies to a block or that an exemption is granted.
 *
 * DOM- and network-free.
 */
import raw from '../../../packages/legal-rules/ground/wildlife-measures.json'
import { list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'
import { ACTIVITIES, type Activity } from './groundInstruments'

export const WILDLIFE_MEASURES_FORMAT = 'pgmaps-wildlife-measures/v1'

/** The longest quote a measure or clause keeps. */
export const MAX_QUOTE_CHARS = 124

export const ORDER_LAYERS = ['uwr', 'wha'] as const
export type OrderLayer = (typeof ORDER_LAYERS)[number]

/** How an order was made: under GAR (general wildlife measures) or under the Forest Practices Code, continued by FRPA ss. 180–181. */
export const ORDER_MADE = ['gar', 'code'] as const
export type OrderMade = (typeof ORDER_MADE)[number]

/** A general wildlife measure binds directly (FPPR s. 69); an objective through the forest stewardship plan. */
export const MEASURE_KINDS = ['gwm', 'objective'] as const
export type MeasureKind = (typeof MEASURE_KINDS)[number]

/** What a measure does to an activity: decides whether it happens, or sets conditions on it. */
export const MEASURE_STATES = ['governs', 'conditions'] as const
export type MeasureState = (typeof MEASURE_STATES)[number]

export interface OrderZone {
  id: string
  label: string
  /** Units by the order or tag they belong to, as `UWR_UNIT_NUMBER` gives them. */
  units?: Record<string, string[]>
  /** The layer's `TIMBER_HARVEST_CODE` values the zone is taken as. */
  harvestCodes?: string[]
  /** Every unit the order covers. */
  all?: true
  note?: string
}

export interface OrderMeasure {
  /** The GWM or objective number as the order prints it. */
  ref: string
  kind: MeasureKind
  zones: string[]
  bears: Partial<Record<Activity, MeasureState>>
  says: string
  quote: string
}

export interface OrderExemption {
  ref: string
  /** Where the clause reaches; absent is the whole order. */
  zones?: string[]
  says: string
  quote: string
  /** Who decides, as the order or its appendix names them. */
  by: string
  /** False for an appendix or supplement that is not part of the legal order. */
  inOrder: boolean
}

export interface WildlifeOrder {
  id: string
  layer: OrderLayer
  /** The `UWR_NUMBER`s or WHA `TAG`s the order establishes. */
  covers: string[]
  title: string
  species: string
  /** Its id in `packages/legal-rules/catalogue/sources.json`. */
  source: string
  url: string
  decided: string
  effective?: string
  made: OrderMade
  authority: string
  zones: OrderZone[]
  measures: OrderMeasure[]
  exemptions: OrderExemption[]
}

export interface UnreadOrder {
  id: string
  layer: OrderLayer
  covers: string[]
  url?: string
  why: string
}

export interface WithheldOrder extends UnreadOrder {
  ask: string
}

export interface WildlifeMeasures {
  format: typeof WILDLIFE_MEASURES_FORMAT
  version: string
  readOn: string
  notes: string
  orders: WildlifeOrder[]
  unread: UnreadOrder[]
  withheld: WithheldOrder[]
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v: unknown, at: string) => {
  const d = text(v, at, 10)
  if (!DAY.test(d)) throw Error(`${at} must be YYYY-MM-DD.`)
  return d
}
const url = (v: unknown, at: string) => {
  const u = text(v, at, 500)
  if (!u.startsWith('https://')) throw Error(`${at} must be an https address.`)
  return u
}
const strings = (v: unknown, at: string, max = 200, min = 1) =>
  list(v, at, max, min).map((s, i) => text(s, `${at} ${i + 1}`, 100))
const quote = (v: unknown, at: string) => {
  const q = text(v, at, 500)
  if (q.length > MAX_QUOTE_CHARS) throw Error(`${at} is ${q.length} characters; a quote keeps under 125.`)
  return q
}

function zone(value: unknown, at: string): OrderZone {
  const o = object(value, at)
  const out: OrderZone = { id: text(o.id, `${at} id`, 50), label: text(o.label, `${at} label`) }
  if (o.units !== undefined) {
    const units = object(o.units, `${at} units`)
    out.units = Object.fromEntries(
      Object.entries(units).map(([k, v]) => [text(k, `${at} units key`, 50), strings(v, `${at} units ${k}`)]),
    )
  }
  if (o.harvestCodes !== undefined) out.harvestCodes = strings(o.harvestCodes, `${at} harvestCodes`, 10)
  if (o.all !== undefined) {
    if (o.all !== true) throw Error(`${at} all must be true when given.`)
    out.all = true
  }
  const ways = [out.units, out.harvestCodes, out.all].filter((w) => w !== undefined).length
  if (ways !== 1) throw Error(`${at} needs exactly one of units, harvestCodes or all.`)
  const note = optional(o, 'note', (v) => text(v, `${at} note`, 1000))
  if (note !== undefined) out.note = note
  return out
}

function measure(value: unknown, at: string, zoneIds: Set<string>): OrderMeasure {
  const o = object(value, at)
  const zones = strings(o.zones, `${at} zones`, 20)
  for (const z of zones) if (!zoneIds.has(z)) throw Error(`${at} names zone ${z}, which the order does not list.`)
  const b = object(o.bears, `${at} bears`)
  const bears: Partial<Record<Activity, MeasureState>> = {}
  for (const [k, v] of Object.entries(b)) {
    const activity = oneOf(k, `${at} bears activity`, ACTIVITIES)
    bears[activity] = oneOf(v, `${at} bears ${k}`, MEASURE_STATES)
  }
  if (!Object.keys(bears).length) throw Error(`${at} bears on no activity.`)
  return {
    ref: text(o.ref, `${at} ref`, 100),
    kind: oneOf(o.kind, `${at} kind`, MEASURE_KINDS),
    zones,
    bears,
    says: text(o.says, `${at} says`, 600),
    quote: quote(o.quote, `${at} quote`),
  }
}

function exemption(value: unknown, at: string, zoneIds: Set<string>): OrderExemption {
  const o = object(value, at)
  if (typeof o.inOrder !== 'boolean') throw Error(`${at} inOrder must be true or false.`)
  const out: OrderExemption = {
    ref: text(o.ref, `${at} ref`, 200),
    says: text(o.says, `${at} says`, 600),
    quote: quote(o.quote, `${at} quote`),
    by: text(o.by, `${at} by`, 300),
    inOrder: o.inOrder,
  }
  if (o.zones !== undefined) {
    out.zones = strings(o.zones, `${at} zones`, 20)
    for (const z of out.zones) if (!zoneIds.has(z)) throw Error(`${at} names zone ${z}, which the order does not list.`)
  }
  return out
}

function order(value: unknown, i: number): WildlifeOrder {
  const at = `wildlife order ${i + 1}`
  const o = object(value, at)
  const zones = list(o.zones, `${at} zones`, 20, 1).map((z, j) => zone(z, `${at} zone ${j + 1}`))
  const zoneIds = new Set(zones.map((z) => z.id))
  if (zoneIds.size !== zones.length) throw Error(`${at} lists a zone id twice.`)
  const covers = strings(o.covers, `${at} covers`, 100)
  for (const z of zones)
    for (const key of Object.keys(z.units ?? {}))
      if (!covers.includes(key)) throw Error(`${at} zone ${z.id} names ${key}, which the order does not cover.`)
  const out: WildlifeOrder = {
    id: text(o.id, `${at} id`, 50),
    layer: oneOf(o.layer, `${at} layer`, ORDER_LAYERS),
    covers,
    title: text(o.title, `${at} title`, 300),
    species: text(o.species, `${at} species`, 100),
    source: text(o.source, `${at} source`, 100),
    url: url(o.url, `${at} url`),
    decided: day(o.decided, `${at} decided`),
    made: oneOf(o.made, `${at} made`, ORDER_MADE),
    authority: text(o.authority, `${at} authority`, 300),
    zones,
    measures: list(o.measures, `${at} measures`, 50, 1).map((m, j) => measure(m, `${at} measure ${j + 1}`, zoneIds)),
    exemptions: list(o.exemptions, `${at} exemptions`, 30).map((e, j) =>
      exemption(e, `${at} exemption ${j + 1}`, zoneIds),
    ),
  }
  const effective = optional(o, 'effective', (v) => day(v, `${at} effective`))
  if (effective !== undefined) out.effective = effective
  if (out.made === 'code' && out.measures.some((m) => m.kind === 'gwm'))
    throw Error(`${at} was made under the Code; its measures are continued objectives, not general wildlife measures.`)
  return out
}

function unread(value: unknown, at: string): UnreadOrder {
  const o = object(value, at)
  const out: UnreadOrder = {
    id: text(o.id, `${at} id`, 50),
    layer: oneOf(o.layer, `${at} layer`, ORDER_LAYERS),
    covers: strings(o.covers, `${at} covers`, 100),
    why: text(o.why, `${at} why`, 1000),
  }
  const u = optional(o, 'url', (v) => url(v, `${at} url`))
  if (u !== undefined) out.url = u
  return out
}

export function parseWildlifeMeasures(value: unknown): WildlifeMeasures {
  const c = object(value, 'wildlife measures')
  if (c.format !== WILDLIFE_MEASURES_FORMAT) throw Error(`The wildlife measures are not ${WILDLIFE_MEASURES_FORMAT}.`)
  const orders = list(c.orders, 'wildlife orders', 200).map(order)
  const unreadList = list(c.unread, 'unread wildlife orders', 200).map((u, i) => unread(u, `unread order ${i + 1}`))
  const withheld = list(c.withheld, 'withheld wildlife orders', 50).map((w, i) => {
    const at = `withheld order ${i + 1}`
    return { ...unread(w, at), ask: text((w as JsonObject).ask, `${at} ask`, 1000) }
  })
  // One order per range or area: a tag listed twice would make the answer depend on the file's order.
  const seen = new Map<string, string>()
  for (const entry of [...orders, ...unreadList, ...withheld])
    for (const key of entry.covers) {
      const k = `${entry.layer}:${key}`
      if (seen.has(k)) throw Error(`${key} is listed by both ${seen.get(k)} and ${entry.id}.`)
      seen.set(k, entry.id)
    }
  const ids = [...orders, ...unreadList, ...withheld].map((o) => o.id)
  if (new Set(ids).size !== ids.length) throw Error('The wildlife measures list an order id twice.')
  return {
    format: WILDLIFE_MEASURES_FORMAT,
    version: text(c.version, 'wildlife measures version', 20),
    readOn: day(c.readOn, 'wildlife measures readOn'),
    notes: text(c.notes, 'wildlife measures notes', 4000),
    orders,
    unread: unreadList,
    withheld,
  }
}

export const WILDLIFE_MEASURES = parseWildlifeMeasures(raw)

/**
 * "On this ground", ungulate winter ranges and wildlife habitat areas: where the order behind a
 * found range or area has been read (`src/lib/legal/wildlifeMeasures.ts`), its own measures for the
 * unit or zone answer the four activities in place of the catalogue's Unknown cells, each answer
 * citing the measure it rests on; the order's exemption and approval clauses are listed as what a
 * reviewer may need to request. An order not yet read stays Unknown and names the order, and its
 * harvest cell keeps the layer's `TIMBER_HARVEST_CODE` answer. A data-sensitive habitat area, whose
 * order is not published, is Unknown and drafted as a request.
 *
 * A screen, never a legal determination: it says what the order's text sets for the mapped unit,
 * never that a measure applies to the block or that an exemption is or would be granted. The
 * record keeps only DataBC's features; the answers are drawn again from the data each time, like
 * the catalogue's own reach.
 *
 * DOM- and network-free.
 */
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  citeText,
  groundLayer,
  type Activity,
  type BindsKind,
  type Cite,
  type GroundInstrument,
  type ReachCell,
} from '@/lib/legal/groundInstruments'
import {
  WILDLIFE_MEASURES,
  type OrderExemption,
  type OrderLayer,
  type OrderZone,
  type UnreadOrder,
  type WildlifeMeasures,
  type WildlifeOrder,
  type WithheldOrder,
} from '@/lib/legal/wildlifeMeasures'
import type { GroundFeature, GroundInstrumentRead, GroundRead } from './record'
import type { DocumentRequest } from './requests'

/** The catalogue layers whose orders carry general wildlife measures, with the fields that name an order and its unit. */
const ORDER_FIELDS: Record<string, { layer: OrderLayer; key: string; unit?: string }> = {
  uwr: { layer: 'uwr', key: 'UWR_NUMBER', unit: 'UWR_UNIT_NUMBER' },
  wha: { layer: 'wha', key: 'TAG' },
}

export const isWildlifeInstrument = (instrument: GroundInstrument) => instrument.layer in ORDER_FIELDS

/** A source's short name: an order read here, else the ground catalogue's label. */
export function wildlifeCiteText(c: Cite, data: WildlifeMeasures = WILDLIFE_MEASURES) {
  const order = data.orders.find((o) => o.source === c.source)
  return order ? `${orderName(order)} ${c.provision}` : citeText(c)
}
export const wildlifeCitesText = (cites: readonly Cite[], data: WildlifeMeasures = WILDLIFE_MEASURES) =>
  cites.map((c) => wildlifeCiteText(c, data)).join('; ')

/** An order as it prints: "UWR u-7-003 order", "WHA 7-016 … 7-061 (27 areas) order". */
export function orderName(order: WildlifeOrder) {
  const what = order.layer === 'uwr' ? 'UWR' : 'WHA'
  const n = order.covers.length
  const keys =
    n > 5
      ? `${order.covers[0]} … ${order.covers[n - 1]} (${n} ${order.layer === 'uwr' ? 'ranges' : 'areas'})`
      : order.covers.join(', ')
  return `${what} ${keys} order`
}

/** Which order a found feature belongs to, its unit, and its harvest code, from what the read kept. */
export function featureKey(instrument: GroundInstrument, feature: GroundFeature) {
  const fields = ORDER_FIELDS[instrument.layer]
  const layer = groundLayer(instrument.layer)
  if (!fields || !layer) return null
  const labelOf = (field: string) => layer.feature.identifiers.find((i) => i.field === field)?.label
  const valueOf = (field: string | undefined) => {
    const label = field ? labelOf(field) : undefined
    return label ? feature.identifiers.find((i) => i.label === label)?.value : undefined
  }
  const key = valueOf(fields.key)
  if (!key) return null
  const harvestCode = instrument.where.find((c) => c.field === 'TIMBER_HARVEST_CODE')?.in?.[0]
  return { layer: fields.layer, key, unit: valueOf(fields.unit), harvestCode }
}

export type WildlifeStatus = 'read' | 'unit-not-named' | 'unread' | 'withheld' | 'not-listed'

export interface WildlifeAnswer {
  status: WildlifeStatus
  /** The order's id: a read, unread or withheld entry, or the range or area's own number when none lists it. */
  orderId: string
  order?: WildlifeOrder
  listed?: UnreadOrder | WithheldOrder
  zones: OrderZone[]
  reach: Record<Activity, ReachCell>
  binds: { kind: BindsKind; note: string; cites: Cite[] }
  exemptions: OrderExemption[]
}

const OBJECTIVE_NOTE =
  'A continued objective, carried out through the forest stewardship plan’s results or strategies, not a general wildlife measure.'

function zonesFor(order: WildlifeOrder, key: string, unit: string | undefined, harvestCode: string | undefined) {
  return order.zones.filter(
    (z) =>
      z.all === true ||
      (unit !== undefined && z.units?.[key]?.includes(unit)) ||
      (harvestCode !== undefined && z.harvestCodes?.includes(harvestCode)),
  )
}

/** The order's answer for one activity on the zones a feature falls in. */
function orderCell(order: WildlifeOrder, zones: OrderZone[], activity: Activity): ReachCell {
  const ids = new Set(zones.map((z) => z.id))
  const inZones = order.measures.filter((m) => m.zones.some((z) => ids.has(z)))
  const bearing = inZones.filter((m) => m.bears[activity])
  const where = zones.map((z) => z.label).join(', ')
  const dated = `${orderName(order)} (decided ${order.decided})`
  if (!bearing.length)
    return {
      state: 'no-reach',
      note: `${dated}, read: its measures for ${where} set nothing on ${ACTIVITY_LABELS[activity].toLowerCase()}. Other law still applies.`,
      cites: [{ source: order.source, provision: inZones.map((m) => m.ref).join('; ') || 'measures as read' }],
    }
  const state = bearing.some((m) => m.bears[activity] === 'governs') ? 'governs' : 'conditions'
  const gwm = bearing.some((m) => m.kind === 'gwm')
  const objective = bearing.some((m) => m.kind === 'objective')
  const lines = bearing.map((m) => `${m.ref}: ${m.says} (“${m.quote}”)`)
  const cites: Cite[] = [{ source: order.source, provision: bearing.map((m) => m.ref).join('; ') }]
  if (gwm)
    cites.push(
      activity === 'grazing' ? { source: 'bc.rppr', provision: 's. 36(1)' } : { source: 'bc.fppr', provision: 's. 69' },
    )
  if (objective)
    cites.push({
      source: 'bc.frpa',
      provision: order.made === 'code' ? 's. 5(1)(b)(ii), (1.1); s. 181' : 's. 5(1)(b)(ii), (1.1)',
    })
  return {
    state,
    note: [`${dated}, for ${where}.`, ...lines, ...(objective && !gwm ? [OBJECTIVE_NOTE] : [])]
      .join(' ')
      .slice(0, 2000),
    cites,
  }
}

/** The catalogue's Unknown cell, kept, naming the order that decides. */
function namedUnknown(cell: ReachCell, naming: string, extra: Cite[] = []): ReachCell {
  return { state: cell.state, note: `${cell.note} ${naming}`.slice(0, 2000), cites: [...cell.cites, ...extra] }
}

/** The answer for one found feature of an ungulate winter range or wildlife habitat area instrument. */
export function wildlifeAnswer(
  instrument: GroundInstrument,
  feature: GroundFeature,
  data: WildlifeMeasures = WILDLIFE_MEASURES,
): WildlifeAnswer | null {
  const found = featureKey(instrument, feature)
  if (!found) return null
  const { layer, key, unit, harvestCode } = found
  const order = data.orders.find((o) => o.layer === layer && o.covers.includes(key))
  if (order) {
    const zones = zonesFor(order, key, unit, harvestCode)
    if (!zones.length) {
      const naming = `${orderName(order)} was read, but names no zone for ${unit ? `unit ${unit}` : key}; the order's map (Schedule A) decides.`
      return {
        status: 'unit-not-named',
        orderId: order.id,
        order,
        zones,
        reach: Object.fromEntries(
          ACTIVITIES.map((a) => [
            a,
            a === 'harvest' && instrument.reach.harvest.state !== 'unknown'
              ? namedUnknown(instrument.reach.harvest, naming)
              : { state: 'unknown', note: naming, cites: [{ source: order.source, provision: 'Schedule A' }] },
          ]),
        ) as Record<Activity, ReachCell>,
        binds: instrument.binds,
        exemptions: order.exemptions.filter((e) => !e.zones),
      }
    }
    const ids = new Set(zones.map((z) => z.id))
    const applying = order.measures.filter((m) => m.zones.some((z) => ids.has(z)))
    const objectivesOnly = applying.length > 0 && applying.every((m) => m.kind === 'objective')
    return {
      status: 'read',
      orderId: order.id,
      order,
      zones,
      reach: Object.fromEntries(ACTIVITIES.map((a) => [a, orderCell(order, zones, a)])) as Record<Activity, ReachCell>,
      binds: objectivesOnly
        ? {
            kind: 'via-fsp',
            note: `${orderName(order)} was made under the Forest Practices Code; its measures are objectives continued under FRPA s. 181, which a forest stewardship plan carries out through its results or strategies, and which its holder must amend the plan for.`,
            cites: [
              { source: 'bc.frpa', provision: 's. 5(1)(b)(ii), (1.1); ss. 180, 181' },
              { source: 'bc.fppr', provision: 's. 28.1(1)(c), (d)' },
            ],
          }
        : instrument.binds,
      exemptions: order.exemptions.filter((e) => !e.zones || e.zones.some((z) => ids.has(z))),
    }
  }
  const withheld = data.withheld.find((w) => w.layer === layer && w.covers.includes(key))
  if (withheld) {
    const naming = `The order for ${key} is not published: ${withheld.why}`
    const gar: Cite = { source: 'bc.gar', provision: 's. 10(3)' }
    return {
      status: 'withheld',
      orderId: withheld.id,
      listed: withheld,
      zones: [],
      reach: Object.fromEntries(
        ACTIVITIES.map((a) => [a, namedUnknown(instrument.reach[a], naming, a === 'harvest' ? [] : [gar])]),
      ) as Record<Activity, ReachCell>,
      binds: instrument.binds,
      exemptions: [],
    }
  }
  const unread = data.unread.find((u) => u.layer === layer && u.covers.includes(key))
  const naming = unread
    ? `Not yet read here: the order for ${key}${unread.url ? ` (${unread.url})` : ''}.`
    : `The order for ${key} is not among the orders read here; it decides.`
  return {
    status: unread ? 'unread' : 'not-listed',
    orderId: unread?.id ?? key,
    ...(unread ? { listed: unread } : {}),
    zones: [],
    reach: Object.fromEntries(ACTIVITIES.map((a) => [a, namedUnknown(instrument.reach[a], naming)])) as Record<
      Activity,
      ReachCell
    >,
    binds: instrument.binds,
    exemptions: [],
  }
}

export interface WildlifeRow {
  key: string
  status: WildlifeStatus
  orderId: string
  order?: WildlifeOrder
  /** "UWR u-7-003 order: P-002, P-006" */
  label: string
  features: GroundFeature[]
  /** The features' overlaps added; the instrument's dissolved cover caps it. */
  overlapHa: number
  reach: Record<Activity, ReachCell>
  binds: WildlifeAnswer['binds']
  exemptions: OrderExemption[]
}

const cellKey = (reach: Record<Activity, ReachCell>) =>
  ACTIVITIES.map((a) => `${reach[a].state}|${reach[a].note}`).join('||')

/**
 * The rows an ungulate winter range or wildlife habitat area instrument shows: one per order and
 * answer, features whose units the order answers alike sharing a row. `null` for any other instrument.
 */
export function wildlifeRows(
  instrument: GroundInstrument,
  read: GroundInstrumentRead,
  data: WildlifeMeasures = WILDLIFE_MEASURES,
): WildlifeRow[] | null {
  if (!isWildlifeInstrument(instrument)) return null
  const rows = new Map<string, WildlifeRow>()
  for (const feature of read.features) {
    const answer = wildlifeAnswer(instrument, feature, data)
    if (!answer) {
      const key = `${instrument.id}:catalogue`
      const row = rows.get(key) ?? {
        key,
        status: 'not-listed' as const,
        orderId: feature.id,
        label: instrument.label,
        features: [],
        overlapHa: 0,
        reach: instrument.reach,
        binds: instrument.binds,
        exemptions: [],
      }
      row.features.push(feature)
      row.overlapHa += feature.overlapHa
      rows.set(key, row)
      continue
    }
    const key = `${instrument.id}:${answer.orderId}:${cellKey(answer.reach)}`
    const row = rows.get(key) ?? {
      key,
      status: answer.status,
      orderId: answer.orderId,
      ...(answer.order ? { order: answer.order } : {}),
      label: answer.order ? orderName(answer.order) : `${instrument.label}: ${answer.orderId}`,
      features: [],
      overlapHa: 0,
      reach: answer.reach,
      binds: answer.binds,
      exemptions: [],
    }
    row.features.push(feature)
    row.overlapHa = Math.min(read.coveredHa || Infinity, row.overlapHa + feature.overlapHa)
    for (const e of answer.exemptions) if (!row.exemptions.includes(e)) row.exemptions.push(e)
    rows.set(key, row)
  }
  return [...rows.values()]
}

/** The statutory route an order's measures leave, beside the order's own clauses. */
export function statutoryRoute(order: WildlifeOrder): { text: string; cites: Cite[] } {
  if (order.made === 'code')
    return {
      text: 'Continued objectives: the forest stewardship plan’s results or strategies carry them out, and a variance the order names is the order’s own. No general wildlife measure exemption applies.',
      cites: [{ source: 'bc.frpa', provision: 's. 5(1)(b)(ii), (1.1); s. 181' }],
    }
  return {
    text: 'The minister responsible for the Wildlife Act may exempt a person from complying with a general wildlife measure if satisfied that its intent will be achieved, or that compliance is not practicable in the area’s circumstances. A range agreement holder may propose an alternative the minister finds consistent with the measure.',
    cites: [
      { source: 'bc.fppr', provision: 's. 92(1)' },
      { source: 'bc.rppr', provision: 's. 36(3)' },
    ],
  }
}

export interface ExceptionToRequest {
  order: WildlifeOrder
  /** The units found on the block, as "u-7-003 P-002". */
  units: string[]
  clauses: OrderExemption[]
  route: { text: string; cites: Cite[] }
}

/** For every order read that a found feature falls in: the exemption and approval clauses a reviewer may need to request. */
export function exceptionsToRequest(read: GroundRead, instruments: (id: string) => GroundInstrument | undefined) {
  const byOrder = new Map<string, ExceptionToRequest>()
  for (const r of read.instruments) {
    const instrument = instruments(r.instrument)
    if (!instrument) continue
    for (const row of wildlifeRows(instrument, r) ?? []) {
      if (!row.order) continue
      const entry = byOrder.get(row.order.id) ?? {
        order: row.order,
        units: [],
        clauses: [],
        route: statutoryRoute(row.order),
      }
      for (const f of row.features) {
        const name = f.identifiers.map((i) => i.value).join(' ')
        if (!entry.units.includes(name)) entry.units.push(name)
      }
      for (const e of row.exemptions) if (!entry.clauses.includes(e)) entry.clauses.push(e)
      byOrder.set(row.order.id, entry)
    }
  }
  return [...byOrder.values()]
}

/** A drafted request for each found data-sensitive habitat area, whose order is not published. */
export function withheldRequests(
  read: GroundRead,
  instruments: (id: string) => GroundInstrument | undefined,
  blockName: string,
): DocumentRequest[] {
  const seen = new Map<string, { entry: WithheldOrder; keys: string[] }>()
  for (const r of read.instruments) {
    const instrument = instruments(r.instrument)
    if (!instrument) continue
    for (const f of r.features) {
      const answer = wildlifeAnswer(instrument, f)
      if (answer?.status !== 'withheld' || !answer.listed) continue
      const key = featureKey(instrument, f)!.key
      const item = seen.get(answer.orderId) ?? { entry: answer.listed as WithheldOrder, keys: [] }
      if (!item.keys.includes(key)) item.keys.push(key)
      seen.set(answer.orderId, item)
    }
  }
  const holder = 'Ministry of Water, Land and Resource Stewardship, the region’s ecosystems section'
  const channel = 'the regional office that administers the habitat area'
  return [...seen.values()].map(({ entry, keys }) => {
    const identifiers = keys.map((k) => `WHA ${k}`)
    const text = [
      `Subject: Wildlife habitat area ${keys.join(', ')}: request for its order and general wildlife measures`,
      '',
      `To: ${holder}, through ${channel}`,
      '',
      `A proposed cutblock (${blockName}) overlaps the data-sensitive wildlife habitat area${keys.length > 1 ? 's' : ''} below, as DataBC's layer showed on ${read.readOn}:`,
      ...identifiers.map((i) => `- ${i}`),
      '',
      `Please provide: ${entry.ask}.`,
      '',
      'The order is not published (Government Actions Regulation s. 10(3)). Its measures are needed to say whether it restricts harvesting, site preparation and planting, roads or grazing on the block.',
    ].join('\n')
    return {
      instrument: entry.id,
      label: `Data-sensitive wildlife habitat area${keys.length > 1 ? 's' : ''} ${keys.join(', ')}`,
      holder,
      channel,
      where: 'The habitat area order and the written notice of its location (GAR s. 10(3))',
      identifiers,
      text,
    }
  })
}

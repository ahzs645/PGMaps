/**
 * The ground instrument catalogue (`packages/legal-rules/ground/instruments.json`): for each kind of
 * legal instrument a block can sit in, the DataBC layer it is read from, the fields kept, and what
 * it can and cannot govern for four activities, each cell citing the provision it rests on.
 *
 * Read by hand (no schema library ships to the browser). A cell whose answer turns on terms that are
 * not public is `unknown` and names the document that decides; the catalogue never says `no-reach`
 * by assumption. Nothing here decides that an instrument applies to a block, or that a block may or
 * may not be cut: the screen lists what each instrument can reach and where its terms are.
 *
 * DOM- and network-free.
 */
import raw from '../../../packages/legal-rules/ground/instruments.json'
import { list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'

export const GROUND_FORMAT = 'pgmaps-ground-instruments/v1'

export const ACTIVITIES = ['harvest', 'replant', 'roads', 'grazing'] as const
export type Activity = (typeof ACTIVITIES)[number]
export const ACTIVITY_LABELS: Record<Activity, string> = {
  harvest: 'Harvest',
  replant: 'Replant',
  roads: 'Roads',
  grazing: 'Grazing',
}

export const REACH_STATES = ['governs', 'conditions', 'no-reach', 'unknown'] as const
export type ReachState = (typeof REACH_STATES)[number]
export const REACH_LABELS: Record<ReachState, string> = {
  governs: 'Governs',
  conditions: 'Conditions',
  'no-reach': 'No reach',
  unknown: 'Unknown',
}

export const BINDS_KINDS = ['direct', 'via-fsp', 'referral', 'none'] as const
export type BindsKind = (typeof BINDS_KINDS)[number]
export const BINDS_LABELS: Record<BindsKind, string> = {
  direct: 'Directly',
  'via-fsp': 'Through the FSP',
  referral: 'By referral',
  none: 'Not at all',
}

export interface Cite {
  /** A source id in `packages/legal-rules/catalogue/sources.json`. */
  source: string
  provision: string
}

export interface ReachCell {
  state: ReachState
  note: string
  cites: Cite[]
}

export interface Condition {
  field: string
  in?: string[]
  notIn?: string[]
}

export interface FeatureDetail {
  label: string
  field: string
  date?: boolean
  unit?: string
}

export interface GroundLayer {
  id: string
  title: string
  typeName: string
  geometryField: string
  /** The field that keeps a record once across the footprint's parts. */
  key: string
  catalogue: string
  /** Narrow on purpose: never a holder's or client's name, never an IDIR user. */
  fields: string[]
  feature: {
    id: { label: string; fields: string[]; fallback: string }
    name: string[]
    details: FeatureDetail[]
    /** What a document request quotes. */
    identifiers: { label: string; field: string }[]
  }
  /** Where the layer gives an effective or legalisation date; `null` when it has none. */
  date: { field: string; label: string } | null
  dateNote?: string
}

export interface GroundInstrument {
  id: string
  label: string
  layer: string
  /** Every condition must hold; an empty list takes the whole layer. */
  where: Condition[]
  statute: Cite
  note?: string
  binds: { kind: BindsKind; note: string; cites: Cite[] }
  reach: Record<Activity, ReachCell>
  terms: { public: boolean; where: string; holder: string; channel: string; ask: string }
  /** Review facts it informs, by pack and fact id. */
  facts: { pack: string; fact: string }[]
}

export interface GroundCatalogue {
  format: typeof GROUND_FORMAT
  version: string
  readOn: string
  /** How each cited source prints, by its id in the legal-rules source catalogue. */
  sourceLabels: Record<string, string>
  notes: string
  layers: GroundLayer[]
  instruments: GroundInstrument[]
}

const strings = (value: unknown, label: string, max = 50, min = 0) =>
  list(value, label, max, min).map((v, i) => text(v, `${label} ${i + 1}`, 500))

const FIELD = /^[A-Z][A-Z0-9_]*$/
const field = (value: unknown, label: string) => {
  const f = text(value, label, 64)
  if (!FIELD.test(f)) throw Error(`${label} must be an upper-case DataBC field name.`)
  return f
}
const fields = (value: unknown, label: string, max = 50, min = 0) =>
  list(value, label, max, min).map((v, i) => field(v, `${label} ${i + 1}`))

function cite(value: unknown, label: string): Cite {
  const c = object(value, label)
  return { source: text(c.source, `${label} source`, 100), provision: text(c.provision, `${label} provision`, 300) }
}

const cites = (value: unknown, label: string) => list(value, label, 10, 1).map((c, i) => cite(c, `${label} ${i + 1}`))

function condition(value: unknown, label: string): Condition {
  const c = object(value, label)
  const out: Condition = { field: field(c.field, `${label} field`) }
  if (c.in !== undefined) out.in = strings(c.in, `${label} in`, 50, 1)
  if (c.notIn !== undefined) out.notIn = strings(c.notIn, `${label} notIn`, 50, 1)
  if (!out.in === !out.notIn) throw Error(`${label} needs one of in or notIn.`)
  return out
}

function layer(value: unknown, i: number): GroundLayer {
  const label = `ground layer ${i + 1}`
  const l = object(value, label)
  const f = object(l.feature, `${label} feature`)
  const id = object(f.id, `${label} feature id`)
  const date = l.date === null ? null : object(l.date, `${label} date`)
  const typeName = text(l.typeName, `${label} typeName`)
  if (!typeName.startsWith('pub:')) throw Error(`${label} typeName must start with pub:.`)
  return {
    id: text(l.id, `${label} id`, 50),
    title: text(l.title, `${label} title`),
    typeName,
    geometryField: field(l.geometryField, `${label} geometryField`),
    key: field(l.key, `${label} key`),
    catalogue: text(l.catalogue, `${label} catalogue`, 500),
    fields: fields(l.fields, `${label} fields`, 50, 1),
    feature: {
      id: {
        label: text(id.label, `${label} feature id label`),
        fields: fields(id.fields, `${label} feature id fields`, 5, 1),
        fallback: field(id.fallback, `${label} feature id fallback`),
      },
      name: fields(f.name, `${label} feature name`, 5, 1),
      details: list(f.details, `${label} feature details`, 20).map((d, j) => {
        const o = object(d, `${label} detail ${j + 1}`)
        return {
          label: text(o.label, `${label} detail ${j + 1} label`),
          field: field(o.field, `${label} detail ${j + 1} field`),
          ...(o.date === true ? { date: true } : {}),
          ...(o.unit !== undefined ? { unit: text(o.unit, `${label} detail ${j + 1} unit`, 20) } : {}),
        }
      }),
      identifiers: list(f.identifiers, `${label} feature identifiers`, 10, 1).map((d, j) => {
        const o = object(d, `${label} identifier ${j + 1}`)
        return {
          label: text(o.label, `${label} identifier ${j + 1} label`),
          field: field(o.field, `${label} identifier ${j + 1} field`),
        }
      }),
    },
    date: date
      ? { field: field(date.field, `${label} date field`), label: text(date.label, `${label} date label`) }
      : null,
    dateNote: optional(l, 'dateNote', (v) => text(v, `${label} dateNote`, 1000)),
  }
}

function cell(value: unknown, label: string): ReachCell {
  const c = object(value, label)
  return {
    state: oneOf(c.state, `${label} state`, REACH_STATES),
    note: text(c.note, `${label} note`, 2000),
    cites: cites(c.cites, `${label} cites`),
  }
}

function instrument(value: unknown, i: number, layers: GroundLayer[]): GroundInstrument {
  const label = `ground instrument ${i + 1}`
  const o = object(value, label)
  const layerId = text(o.layer, `${label} layer`, 50)
  const read = layers.find((l) => l.id === layerId)
  if (!read) throw Error(`${label} names layer ${layerId}, which the catalogue does not list.`)
  const where = list(o.where, `${label} where`, 10).map((c, j) => condition(c, `${label} condition ${j + 1}`))
  // A condition's field must be read, or the partition could not test it.
  for (const c of where)
    if (!read.fields.includes(c.field)) throw Error(`${label} tests ${c.field}, which layer ${layerId} does not read.`)
  const binds = object(o.binds, `${label} binds`)
  const reach = object(o.reach, `${label} reach`)
  const terms = object(o.terms, `${label} terms`)
  if (typeof terms.public !== 'boolean') throw Error(`${label} terms.public must be true or false.`)
  return {
    id: text(o.id, `${label} id`, 50),
    label: text(o.label, `${label} label`),
    layer: layerId,
    where,
    statute: cite(o.statute, `${label} statute`),
    note: optional(o, 'note', (v) => text(v, `${label} note`, 2000)),
    binds: {
      kind: oneOf(binds.kind, `${label} binds kind`, BINDS_KINDS),
      note: text(binds.note, `${label} binds note`, 2000),
      cites: cites(binds.cites, `${label} binds cites`),
    },
    reach: Object.fromEntries(ACTIVITIES.map((a) => [a, cell(reach[a], `${label} ${a}`)])) as Record<
      Activity,
      ReachCell
    >,
    terms: {
      public: terms.public,
      where: text(terms.where, `${label} terms where`, 500),
      holder: text(terms.holder, `${label} terms holder`, 300),
      channel: text(terms.channel, `${label} terms channel`, 300),
      ask: text(terms.ask, `${label} terms ask`, 1000),
    },
    facts: list(o.facts, `${label} facts`, 20).map((f, j) => {
      const x = object(f, `${label} fact ${j + 1}`) as JsonObject
      return {
        pack: text(x.pack, `${label} fact ${j + 1} pack`, 100),
        fact: text(x.fact, `${label} fact ${j + 1}`, 100),
      }
    }),
  }
}

export function parseGroundCatalogue(value: unknown): GroundCatalogue {
  const c = object(value, 'ground catalogue')
  if (c.format !== GROUND_FORMAT) throw Error(`The ground catalogue is not ${GROUND_FORMAT}.`)
  const layers = list(c.layers, 'ground layers', 50, 1).map(layer)
  const instruments = list(c.instruments, 'ground instruments', 100, 1).map((x, i) => instrument(x, i, layers))
  for (const [what, ids] of [
    ['layer', layers.map((l) => l.id)],
    ['instrument', instruments.map((x) => x.id)],
  ] as const)
    if (new Set(ids).size !== ids.length) throw Error(`The ground catalogue lists a ${what} id twice.`)
  const labels = object(c.sourceLabels, 'ground catalogue sourceLabels')
  const sourceLabels = Object.fromEntries(
    Object.entries(labels).map(([k, v]) => [text(k, 'source id', 100), text(v, `source label for ${k}`, 100)]),
  )
  const cited = instruments.flatMap((x) => [
    x.statute,
    ...x.binds.cites,
    ...ACTIVITIES.flatMap((a) => x.reach[a].cites),
  ])
  for (const c of cited)
    if (!sourceLabels[c.source]) throw Error(`The ground catalogue cites ${c.source} without a source label.`)
  const readOn = text(c.readOn, 'ground catalogue readOn', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readOn)) throw Error('ground catalogue readOn must be YYYY-MM-DD.')
  return {
    format: GROUND_FORMAT,
    version: text(c.version, 'ground catalogue version', 20),
    readOn,
    sourceLabels,
    notes: text(c.notes, 'ground catalogue notes', 4000),
    layers,
    instruments,
  }
}

export const GROUND_CATALOGUE = parseGroundCatalogue(raw)

export const groundInstrument = (id: string) => GROUND_CATALOGUE.instruments.find((x) => x.id === id)
export const groundLayer = (id: string) => GROUND_CATALOGUE.layers.find((l) => l.id === id)

/** Whether a record's attributes satisfy every condition, as the CQL below asks DataBC. */
export function matches(where: readonly Condition[], properties: Record<string, unknown>): boolean {
  return where.every((c) => {
    const v = properties[c.field]
    const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
    if (c.in) return s !== null && c.in.includes(s)
    return s === null || !c.notIn!.includes(s)
  })
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

/** One condition as CQL; a `notIn` also keeps blank values, as `matches` does. */
export function conditionCql(c: Condition): string {
  if (c.in) return `${c.field} IN (${c.in.map(quote).join(', ')})`
  return `(${c.field} IS NULL OR ${c.field} NOT IN (${c.notIn!.map(quote).join(', ')}))`
}

/** The filter for one read of a layer: any of its instruments' conditions; `null` when one takes the whole layer. */
export function layerCql(instruments: readonly GroundInstrument[]): string | null {
  if (instruments.some((x) => !x.where.length)) return null
  const each = instruments.map((x) => x.where.map(conditionCql).join(' AND '))
  return each.length === 1 ? each[0] : `(${each.map((w) => `(${w})`).join(' OR ')})`
}

/** A cite as it prints: the source's short name and the provision. */
export const citeText = (c: Cite) => `${GROUND_CATALOGUE.sourceLabels[c.source] ?? c.source} ${c.provision}`

/** A cell's or a binds entry's cites, joined as they print. */
export const citesText = (list: readonly Cite[]) => list.map(citeText).join('; ')

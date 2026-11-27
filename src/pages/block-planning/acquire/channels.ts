/**
 * The channel catalogue (`packages/legal-rules/acquire/channels.json`): where each record a review
 * cannot answer from public data is asked for, and which open facts each kind of record answers.
 *
 * - A **channel** is an office or a role, never a person: its holder, the page its route starts
 *   at, what to ask, the identifiers a request quotes, its fee, its time (`days`, null when nothing
 *   sets one) and the FOIPPA sections likely to cut what comes back. Where the law says something
 *   about the channel (FRPA s. 20.25's publication duty), it cites the stored text with a quote.
 * - A **gap kind** tags the facts it answers (`pack:fact`) and lists its channels, most direct first.
 * - `bctsPlans` are BC Timber Sales' plans by FSP id with their own pages, checked live.
 *
 * Parsed by hand; a catalogue that does not read is refused with the field named.
 * DOM- and network-free.
 */
import raw from '../../../../packages/legal-rules/acquire/channels.json'
import sources from '../../../../packages/legal-rules/catalogue/sources.json'
import { bool, int, list, object, oneOf, optional, text } from '@/lib/jsonGuards'

export const CHANNELS_FORMAT = 'pgmaps-acquire-channels/v1'

export const GAP_KINDS = [
  'fsp-amendment',
  'site-plan',
  'riparian-class',
  'fish-stream-determination',
  'crossing-design',
  'crossing-build-date',
  'crossing-maintainer',
  'water-notice-terms',
  'contravention',
  'small-streams',
] as const
export type GapKind = (typeof GAP_KINDS)[number]

/** What a request can quote, each filled from what the plan holds. */
export const IDENTIFIER_KINDS = [
  'fsp',
  'licence',
  'cutting-permit',
  'timber-mark',
  'opening',
  'road-permit',
  'road-section',
  'water-file',
  'frontcounter-tracking',
  'pscis',
  'location',
  'dates',
] as const
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number]
export const IDENTIFIER_LABELS: Record<IdentifierKind, string> = {
  fsp: 'Forest stewardship plan id',
  licence: 'Licence',
  'cutting-permit': 'Cutting permit',
  'timber-mark': 'Timber mark',
  opening: 'RESULTS opening id',
  'road-permit': 'Road permit',
  'road-section': 'Road section',
  'water-file': 'Water approval or notification file',
  'frontcounter-tracking': 'FrontCounter BC tracking number',
  pscis: 'PSCIS crossing id',
  location: 'Location',
  dates: 'Dates',
}

export interface ChannelCite {
  source: string
  provision: string
  /** Words of the stored text, word for word (`acquire.test.ts` checks each). */
  quote: string
}

export interface ChannelDays {
  count: number
  /** Business days (weekends and BC statutory holidays skipped), else calendar days. */
  business: boolean
  /** Days an extension adds, where the law allows one. */
  extension?: number
  /** `law`: set by statute; `stated`: the office's own figure. */
  basis: 'law' | 'stated'
}

export interface Channel {
  id: string
  label: string
  holder: string
  route: { url: string; label: string }
  ask: string
  identifiers: IdentifierKind[]
  fee: string
  feeCad?: number
  days: ChannelDays | null
  daysNote: string
  foippa: string[]
  /** `true`: only for a BC Timber Sales block; `false`: only for another holder's; absent: any. */
  bcts?: boolean
  /** A freedom of information request: its letter takes the date range and the severing line. */
  foi?: boolean
  /** A public search, not a request. */
  search?: boolean
  /** The reviewer's own field work. */
  field?: boolean
  cites: ChannelCite[]
  note: string
}

export interface GapKindEntry {
  kind: GapKind
  label: string
  subject: 'block' | 'crossing'
  ask: string
  why: string
  channels: string[]
  facts: { pack: string; fact: string }[]
}

export interface BctsPlan {
  fspId: number
  label: string
  url: string
}

export interface ChannelCatalogue {
  format: typeof CHANNELS_FORMAT
  version: string
  checkedOn: string
  notes: string
  channels: Channel[]
  gaps: GapKindEntry[]
  bctsPlans: BctsPlan[]
  fsp: {
    bctsIndex: { url: string; label: string }
    fom: { url: string; label: string; note: string }
    standardsNote: string
  }
}

const MAX_QUOTE = 124
const https = (value: unknown, label: string) => {
  const url = text(value, label, 400)
  if (!/^https:\/\/[^\s]+$/.test(url)) throw Error(`${label} must be an https address.`)
  return url
}
const day = (value: unknown, label: string) => {
  const v = text(value, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw Error(`${label} must be YYYY-MM-DD.`)
  return v
}
const sourceIds = new Set((sources as { sources: { id: string }[] }).sources.map((s) => s.id))

function parseChannel(value: unknown, index: number): Channel {
  const at = `channel ${index + 1}`
  const c = object(value, at)
  const id = text(c.id, `${at} id`, 60)
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw Error(`${at} id must be lower case words and dashes.`)
  const route = object(c.route, `${id} route`)
  const days =
    c.days === null
      ? null
      : (() => {
          const d = object(c.days, `${id} days`)
          return {
            count: int(d.count, `${id} days count`, 1, 365),
            business: bool(d.business, `${id} days business`),
            ...(d.extension === undefined ? {} : { extension: int(d.extension, `${id} days extension`, 1, 365) }),
            basis: oneOf(d.basis, `${id} days basis`, ['law', 'stated'] as const),
          }
        })()
  const cites = list(c.cites, `${id} cites`, 10).map((x, i) => {
    const o = object(x, `${id} cite ${i + 1}`)
    const source = text(o.source, `${id} cite source`, 100)
    if (!sourceIds.has(source)) throw Error(`${id} cites ${source}, which is not in the source catalogue.`)
    const quote = text(o.quote, `${id} cite quote`, MAX_QUOTE)
    return { source, provision: text(o.provision, `${id} cite provision`, 100), quote }
  })
  const flag = (key: string) => optional(c, key, (v) => bool(v, `${id} ${key}`))
  return {
    id,
    label: text(c.label, `${id} label`, 120),
    holder: text(c.holder, `${id} holder`, 300),
    route: { url: https(route.url, `${id} route url`), label: text(route.label, `${id} route label`, 120) },
    ask: text(c.ask, `${id} ask`, 600),
    identifiers: list(c.identifiers, `${id} identifiers`, IDENTIFIER_KINDS.length).map((v) =>
      oneOf(v, `${id} identifier`, IDENTIFIER_KINDS),
    ),
    fee: text(c.fee, `${id} fee`, 300),
    ...(c.feeCad === undefined ? {} : { feeCad: int(c.feeCad, `${id} feeCad`, 0, 10_000) }),
    days,
    daysNote: text(c.daysNote, `${id} daysNote`, 600),
    foippa: list(c.foippa, `${id} foippa`, 10).map((v) => text(v, `${id} foippa`, 120)),
    ...Object.fromEntries(
      (['bcts', 'foi', 'search', 'field'] as const).flatMap((k) => {
        const v = flag(k)
        return v === undefined ? [] : [[k, v]]
      }),
    ),
    cites,
    note: text(c.note, `${id} note`, 1000),
  }
}

function parseGap(value: unknown, index: number, channels: readonly Channel[]): GapKindEntry {
  const at = `gap kind ${index + 1}`
  const g = object(value, at)
  const kind = oneOf(g.kind, `${at} kind`, GAP_KINDS)
  const listed = list(g.channels, `${kind} channels`, 10, 1).map((v) => text(v, `${kind} channel`, 60))
  for (const id of listed)
    if (!channels.some((c) => c.id === id)) throw Error(`Gap kind ${kind} names a channel not listed: ${id}.`)
  return {
    kind,
    label: text(g.label, `${kind} label`, 120),
    subject: oneOf(g.subject, `${kind} subject`, ['block', 'crossing'] as const),
    ask: text(g.ask, `${kind} ask`, 600),
    why: text(g.why, `${kind} why`, 600),
    channels: listed,
    facts: list(g.facts, `${kind} facts`, 40, 1).map((x, i) => {
      const f = object(x, `${kind} fact ${i + 1}`)
      return { pack: text(f.pack, `${kind} fact pack`, 100), fact: text(f.fact, `${kind} fact`, 100) }
    }),
  }
}

export function parseChannelCatalogue(value: unknown): ChannelCatalogue {
  const c = object(value, 'channel catalogue')
  if (c.format !== CHANNELS_FORMAT) throw Error(`The channel catalogue is not ${CHANNELS_FORMAT}.`)
  const channels = list(c.channels, 'channels', 50, 1).map(parseChannel)
  if (new Set(channels.map((x) => x.id)).size !== channels.length)
    throw Error('The channel catalogue lists a channel id twice.')
  const gaps = list(c.gaps, 'gap kinds', GAP_KINDS.length, 1).map((g, i) => parseGap(g, i, channels))
  for (const kind of GAP_KINDS)
    if (gaps.filter((g) => g.kind === kind).length !== 1)
      throw Error(`The channel catalogue must list gap kind ${kind} once.`)
  const tagged = gaps.flatMap((g) => g.facts.map((f) => `${f.pack}:${f.fact}`))
  if (new Set(tagged).size !== tagged.length) throw Error('A fact is tagged with two gap kinds.')
  const bctsPlans = list(c.bctsPlans, 'bctsPlans', 100).map((x, i) => {
    const p = object(x, `BCTS plan ${i + 1}`)
    return {
      fspId: int(p.fspId, `BCTS plan ${i + 1} fspId`, 1, 1e7),
      label: text(p.label, `BCTS plan ${i + 1} label`, 120),
      url: https(p.url, `BCTS plan ${i + 1} url`),
    }
  })
  if (new Set(bctsPlans.map((p) => p.fspId)).size !== bctsPlans.length)
    throw Error('The channel catalogue lists a BCTS plan twice.')
  const f = object(c.fsp, 'fsp')
  const link = (v: unknown, label: string) => {
    const o = object(v, label)
    return { url: https(o.url, `${label} url`), label: text(o.label, `${label} label`, 120) }
  }
  const fom = object(f.fom, 'fsp.fom')
  return {
    format: CHANNELS_FORMAT,
    version: text(c.version, 'version', 20),
    checkedOn: day(c.checkedOn, 'checkedOn'),
    notes: text(c.notes, 'notes', 2000),
    channels,
    gaps,
    bctsPlans,
    fsp: {
      bctsIndex: link(f.bctsIndex, 'fsp.bctsIndex'),
      fom: { ...link(fom, 'fsp.fom'), note: text(fom.note, 'fsp.fom note', 1000) },
      standardsNote: text(f.standardsNote, 'fsp.standardsNote', 1000),
    },
  }
}

export const CHANNEL_CATALOGUE = parseChannelCatalogue(raw)

export const channelOf = (id: string) => CHANNEL_CATALOGUE.channels.find((c) => c.id === id)
export const gapKindOf = (kind: GapKind) => CHANNEL_CATALOGUE.gaps.find((g) => g.kind === kind)!
export const bctsPlanOf = (fspId: number | string | undefined) =>
  fspId === undefined ? undefined : CHANNEL_CATALOGUE.bctsPlans.find((p) => String(p.fspId) === String(fspId).trim())

/** The gap kind a fact answers, if the catalogue tags it. */
export function gapKindOfFact(pack: string, fact: string): GapKindEntry | undefined {
  return CHANNEL_CATALOGUE.gaps.find((g) => g.facts.some((f) => f.pack === pack && f.fact === fact))
}

/** A cited source's title and address, for the provision dialog. */
export function citedSource(id: string): { title: string; url: string } | undefined {
  const s = (sources as { sources: { id: string; title: string; url: string }[] }).sources.find((x) => x.id === id)
  return s ? { title: s.title, url: s.url } : undefined
}

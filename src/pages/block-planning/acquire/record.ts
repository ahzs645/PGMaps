/**
 * What the reviewer keeps about getting the records a review lacks (`Plan.acquisition`):
 *
 * - **Identifiers** per block, as the reviewer entered them: what a request quotes (opening,
 *   licence, cutting permit, road permit and section, water file, the dates asked for) and the
 *   forest stewardship plan the reviewer states the permit relied on, with how it was identified.
 *   An identifier holds a number; a value without one (a name) is never kept.
 * - **Requests**: one status per derived gap and channel, a list of dated events (requested,
 *   extended, received, partly received, refused, not held, withdrawn). A gap public data later
 *   answers keeps its status and shows as no longer needed; nothing is deleted for it.
 * - **Received records**: what came back, as the reviewer's transcription: its title, the channel
 *   it came through (a role, never a person), its dates and reference, whether it was severed, and
 *   the values read from it, each optionally tied to a fact, a crossing, a page and a short quote.
 *   A value feeds nothing until the reviewer uses it (`uses`). The document itself is never stored.
 *
 * Parsed by hand and tolerantly: absent stays absent, an item that does not read or names a block
 * or schedule the plan does not have is left out. Out of `usePlanAnalysis` and every check's key.
 *
 * DOM- and network-free.
 */
import type { JsonObject } from '@/lib/jsonGuards'
import { CHANNEL_CATALOGUE } from './channels'

export const REQUEST_EVENTS = [
  'requested',
  'extended',
  'received',
  'partial',
  'refused',
  'not-held',
  'withdrawn',
] as const
export type RequestEventStatus = (typeof REQUEST_EVENTS)[number]
export const REQUEST_EVENT_LABELS: Record<RequestEventStatus, string> = {
  requested: 'Requested',
  extended: 'Time extended',
  received: 'Received',
  partial: 'Partly received',
  refused: 'Refused',
  'not-held': 'Not held',
  withdrawn: 'Withdrawn',
}

export interface RequestEvent {
  status: RequestEventStatus
  date: string
  reference?: string
  note?: string
}

export interface RequestStatus {
  /** The derived gap's id, `<kind>:<block>:<schedule>[:<crossing key>]`. */
  gap: string
  channel: string
  block: string
  schedule: string
  events: RequestEvent[]
}

/** How the reviewer identified the plan a permit relied on. */
export const FSP_BASES = [
  'fdu-layer',
  'stocking-standard',
  'licence-table',
  'bcts-page',
  'fom',
  'received-record',
  'other',
] as const
export type FspBasis = (typeof FSP_BASES)[number]
export const FSP_BASIS_LABELS: Record<FspBasis, string> = {
  'fdu-layer': 'Forest development unit layer over the block',
  'stocking-standard': 'Opening’s stocking standard id found in the plan',
  'licence-table': 'The plan’s own licence table',
  'bcts-page': 'BC Timber Sales plan page',
  fom: 'Forest Operations Map project',
  'received-record': 'A record received',
  other: 'Other',
}

/** The plan the reviewer states the permit relied on: their record, never read from a layer. */
export interface FspStatement {
  id: string
  amendment?: string
  basis: FspBasis
  note?: string
  statedOn: string
}

export const RECORD_ID_FIELDS = [
  'opening',
  'licence',
  'cuttingPermit',
  'timberMark',
  'roadPermit',
  'roadSection',
  'waterFile',
  'trackingNumber',
] as const
export type RecordIdField = (typeof RECORD_ID_FIELDS)[number]
export const RECORD_ID_LABELS: Record<RecordIdField, string> = {
  opening: 'RESULTS opening id',
  licence: 'Licence',
  cuttingPermit: 'Cutting permit',
  timberMark: 'Timber mark',
  roadPermit: 'Road permit',
  roadSection: 'Road section',
  waterFile: 'Water approval or notification file',
  trackingNumber: 'FrontCounter BC tracking number',
}

/** A block's identifiers and dates as the reviewer entered them. */
export type BlockRecordIds = { block: string } & Partial<Record<RecordIdField, string>> & {
    /** When the cutting permit was issued: the date the plan's amendment is read at. */
    permitIssued?: string
    /** The date range a freedom of information request asks for. */
    recordsFrom?: string
    recordsTo?: string
    fsp?: FspStatement
  }

export const VALUE_USES = ['fact', 'claim', 'crossing'] as const
export type ValueUseKind = (typeof VALUE_USES)[number]

/** Where the reviewer used a value: the case or crossing, in words, and when. */
export interface ValueUse {
  as: ValueUseKind
  target: string
  on: string
}

export interface ReceivedValue {
  id: string
  /** What the value states ("Riparian class", "Installed"). */
  label: string
  /** The reviewer's transcription. */
  value: string
  /** The question it bears on, `pack` and `fact`. */
  fact?: { pack: string; fact: string }
  /** The crossing it is about. */
  crossing?: string
  page?: string
  /** At most `MAX_RECEIVED_QUOTE` characters, word for word. */
  quote?: string
  uses?: ValueUse[]
}

export interface ReceivedRecord {
  id: string
  block: string
  title: string
  /** The channel it came through: an office or role, never a person. */
  from: string
  documentDate?: string
  receivedOn: string
  reference?: string
  /** Whether parts were severed, and under what. */
  severed?: boolean
  severedNote?: string
  /** The gaps it was asked for. */
  gaps?: string[]
  values: ReceivedValue[]
}

export interface Acquisition {
  ids?: BlockRecordIds[]
  requests?: RequestStatus[]
  received?: ReceivedRecord[]
}

export const MAX_RECEIVED_QUOTE = 124
export const MAX_REQUESTS = 5000
export const MAX_RECEIVED = 2000
export const MAX_VALUES = 200
const MAX_TEXT = 2000

// ---------------------------------------------------------------------------------------------
// Values as typed

/** A date as YYYY-MM-DD, else undefined. */
export const dayOf = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) ? v : undefined

/**
 * An identifier as entered, or undefined: at most 60 characters of letters, digits and file
 * punctuation, holding at least one digit. A licence, permit, file or opening holds a number; a
 * person's or a company's name does not, so a name typed into an identifier is never kept.
 */
export function identifierToken(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().replace(/\s+/g, ' ')
  return t && t.length <= 60 && /\d/.test(t) && /^[A-Za-z0-9 ._/#:-]+$/.test(t) ? t : undefined
}

/** A plan id: digits only. */
export const fspIdToken = (v: unknown) => {
  const t = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim().replace(/^#/, '') : ''
  return /^\d{1,7}$/.test(t) ? t : undefined
}

const shortText = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

// ---------------------------------------------------------------------------------------------
// Parsing

function parseIds(value: unknown, blocks: ReadonlySet<string>): BlockRecordIds | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as JsonObject
  if (typeof o.block !== 'string' || !blocks.has(o.block)) return undefined
  const fsp = parseFsp(o.fsp)
  const ids = defined({
    block: o.block,
    ...Object.fromEntries(RECORD_ID_FIELDS.map((f) => [f, identifierToken(o[f])])),
    permitIssued: dayOf(o.permitIssued),
    recordsFrom: dayOf(o.recordsFrom),
    recordsTo: dayOf(o.recordsTo),
    fsp,
  }) as BlockRecordIds
  return Object.keys(ids).length > 1 ? ids : undefined
}

function parseFsp(value: unknown): FspStatement | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as JsonObject
  const id = fspIdToken(o.id)
  const statedOn = dayOf(o.statedOn)
  if (!id || !statedOn) return undefined
  return defined({
    id,
    amendment: identifierToken(o.amendment) ?? (typeof o.amendment === 'number' ? String(o.amendment) : undefined),
    basis: FSP_BASES.includes(o.basis as FspBasis) ? (o.basis as FspBasis) : 'other',
    note: shortText(o.note, MAX_TEXT),
    statedOn,
  })
}

function parseEvent(value: unknown): RequestEvent | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as JsonObject
  const date = dayOf(o.date)
  if (!REQUEST_EVENTS.includes(o.status as RequestEventStatus) || !date) return undefined
  return defined({
    status: o.status as RequestEventStatus,
    date,
    reference: shortText(o.reference, 200),
    note: shortText(o.note, MAX_TEXT),
  })
}

function parseRequest(
  value: unknown,
  blocks: ReadonlySet<string>,
  schedules: ReadonlySet<string>,
): RequestStatus | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as JsonObject
  const gap = shortText(o.gap, 300)
  const channel = shortText(o.channel, 60)
  if (!gap || !channel || !CHANNEL_CATALOGUE.channels.some((c) => c.id === channel)) return undefined
  if (typeof o.block !== 'string' || !blocks.has(o.block)) return undefined
  if (typeof o.schedule !== 'string' || !schedules.has(o.schedule)) return undefined
  const events = (Array.isArray(o.events) ? o.events : []).flatMap((e) => parseEvent(e) ?? [])
  if (!events.length) return undefined
  return { gap, channel, block: o.block, schedule: o.schedule, events }
}

function parseUse(value: unknown): ValueUse | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as JsonObject
  const on = dayOf(o.on)
  const target = shortText(o.target, 500)
  if (!VALUE_USES.includes(o.as as ValueUseKind) || !on || !target) return undefined
  return { as: o.as as ValueUseKind, target, on }
}

function parseValue(value: unknown): ReceivedValue | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as JsonObject
  const id = shortText(o.id, 60)
  const label = shortText(o.label, 200)
  const text = shortText(o.value, MAX_TEXT)
  if (!id || !label || !text) return undefined
  const f = o.fact && typeof o.fact === 'object' ? (o.fact as JsonObject) : undefined
  const fact =
    f && shortText(f.pack, 100) && shortText(f.fact, 100)
      ? { pack: (f.pack as string).trim(), fact: (f.fact as string).trim() }
      : undefined
  const uses = (Array.isArray(o.uses) ? o.uses : []).flatMap((u) => parseUse(u) ?? [])
  return defined({
    id,
    label,
    value: text,
    fact,
    crossing: shortText(o.crossing, 100),
    page: shortText(o.page, 40),
    quote: shortText(o.quote, MAX_RECEIVED_QUOTE),
    uses: uses.length ? uses : undefined,
  })
}

function parseReceived(value: unknown, blocks: ReadonlySet<string>): ReceivedRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as JsonObject
  const id = shortText(o.id, 60)
  const title = shortText(o.title, 300)
  const from = shortText(o.from, 60)
  const receivedOn = dayOf(o.receivedOn)
  if (!id || !title || !from || !receivedOn) return undefined
  if (!CHANNEL_CATALOGUE.channels.some((c) => c.id === from)) return undefined
  if (typeof o.block !== 'string' || !blocks.has(o.block)) return undefined
  const gaps = (Array.isArray(o.gaps) ? o.gaps : []).flatMap((g) => shortText(g, 300) ?? [])
  return defined({
    id,
    block: o.block,
    title,
    from,
    documentDate: dayOf(o.documentDate),
    receivedOn,
    reference: shortText(o.reference, 200),
    severed: typeof o.severed === 'boolean' ? o.severed : undefined,
    severedNote: shortText(o.severedNote, 500),
    gaps: gaps.length ? gaps : undefined,
    values: (Array.isArray(o.values) ? o.values : []).slice(0, MAX_VALUES).flatMap((v) => parseValue(v) ?? []),
  })
}

export interface ParsedAcquisition {
  acquisition: Acquisition | undefined
  /** Items left out because they did not read or named a block or schedule the plan lacks. */
  dropped: number
}

/** The plan's acquisition as far as it reads; absent stays absent. */
export function parseAcquisition(
  value: unknown,
  blocks: readonly { id: string }[],
  schedules: readonly { id: string }[],
): ParsedAcquisition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { acquisition: undefined, dropped: 0 }
  const o = value as JsonObject
  const blockIds = new Set(blocks.map((b) => b.id))
  const scheduleIds = new Set(schedules.map((s) => s.id))
  let dropped = 0
  const keep = <T>(raw: unknown, max: number, read: (v: unknown) => T | undefined, unique?: (t: T) => string) => {
    if (!Array.isArray(raw)) return undefined
    const seen = new Set<string>()
    const out: T[] = []
    for (const item of raw.slice(0, max)) {
      const t = read(item)
      const key = t && unique ? unique(t) : undefined
      if (!t || (key !== undefined && seen.has(key))) {
        dropped++
        continue
      }
      if (key !== undefined) seen.add(key)
      out.push(t)
    }
    dropped += Math.max(0, raw.length - max)
    return out
  }
  const ids = keep(
    o.ids,
    5000,
    (v) => parseIds(v, blockIds),
    (t) => t.block,
  )
  const requests = keep(
    o.requests,
    MAX_REQUESTS,
    (v) => parseRequest(v, blockIds, scheduleIds),
    (t) => `${t.gap}|${t.channel}`,
  )
  const received = keep(
    o.received,
    MAX_RECEIVED,
    (v) => parseReceived(v, blockIds),
    (t) => t.id,
  )
  const acquisition = defined({ ids, requests, received })
  return { acquisition, dropped }
}

/** A block's identifiers as entered, or an empty set. */
export const recordIdsOf = (plan: { acquisition?: Acquisition }, block: string): BlockRecordIds =>
  plan.acquisition?.ids?.find((i) => i.block === block) ?? { block }

/** A received record id no record in the plan has used. */
export function nextReceivedId(plan: { acquisition?: Acquisition }) {
  const n = Math.max(
    0,
    ...(plan.acquisition?.received ?? []).map((r) => Number(/^received-(\d+)$/.exec(r.id)?.[1] ?? 0)),
  )
  return `received-${n + 1}`
}

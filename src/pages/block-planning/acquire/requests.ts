/**
 * Requests for the records a review lacks, drafted the way *On this ground*'s are
 * (`ground/requests.ts`): one letter per channel per block, covering every gap that channel can
 * answer for the block and its crossings, so many crossings go in one letter. Each letter names
 * who holds the record by office or role, the identifiers the plan holds (opening, licence and
 * permit, road permit and section, the plan's id, water file numbers, PSCIS ids where a crossing
 * carries them, each crossing's place), what to ask and why. A letter to an office has a freedom of
 * information variant with the date range and a line inviting severing over refusal.
 *
 * Text only: nothing is sent, and no person's or holder's name is read or written. Identifiers come
 * only from the identifier fields (`identifierToken` keeps nothing without a number) and the
 * crossings' file numbers, places and stream keys; a road's or stream's free-text name is never
 * written, since a road can carry its holder's name.
 *
 * DOM- and network-free.
 */
import { entryOf, type Plan } from '../plan'
import type { CrossingRecord } from '../crossings/record'
import {
  bctsPlanOf,
  CHANNEL_CATALOGUE,
  channelOf,
  gapKindOf,
  IDENTIFIER_LABELS,
  type Channel,
  type IdentifierKind,
} from './channels'
import type { Gap } from './gaps'
import { identifierToken, recordIdsOf, type BlockRecordIds } from './record'

export interface DraftLetter {
  /** `<channel>:<block>:<schedule>`. */
  key: string
  channel: Channel
  block: string
  schedule: string
  gaps: Gap[]
  subject: string
  text: string
  /** The same ask as a freedom of information request; absent when the letter already is one, or is a search or field list. */
  foiText?: string
}

const listed = (items: string[]) => items.map((s) => `- ${s}`).join('\n')
const round = (v: number) => Math.round(v * 1e5) / 1e5

/** A crossing's identifiers: its road file and section, chainage, stream key, place and PSCIS ids. Never a name. */
export function crossingIdentifiers(record: CrossingRecord): string[] {
  const out: string[] = []
  const road = record.at?.road
  const file = identifierToken(road?.file)
  const section = identifierToken(road?.section)
  if (file) out.push(`road permit or file ${file}${section ? `, section ${section}` : ''}`)
  else if (section) out.push(`road section ${section}`)
  if (road?.chainageM !== undefined) out.push(`chainage ${Math.round(road.chainageM)} m`)
  const stream = record.at?.stream
  if (stream?.blueLineKey !== undefined) out.push(`Freshwater Atlas stream ${stream.blueLineKey}`)
  if (stream?.measureM !== undefined) out.push(`at ${Math.round(stream.measureM)} m along it`)
  const point = record.at?.point
  if (point) out.push(`at ${round(point[1])}° N, ${round(Math.abs(point[0]))}° W (WGS84)`)
  for (const id of pscisIds(record)) out.push(`PSCIS crossing ${id}`)
  return out
}

/** PSCIS ids a crossing carries: its aliases where it has them, else the references of its PSCIS evidence. */
export function pscisIds(record: CrossingRecord): string[] {
  const aliases = (record as CrossingRecord & { aliases?: { source?: unknown; id?: unknown }[] }).aliases
  const fromAliases = Array.isArray(aliases)
    ? aliases.filter((a) => /pscis/i.test(String(a.source ?? ''))).map((a) => identifierToken(String(a.id ?? '')))
    : []
  const fromEvidence = record.evidence
    .filter((e) => /pscis/i.test(e.kind) || /pscis/i.test(e.source))
    .map((e) => identifierToken(e.reference))
  return [...new Set([...fromAliases, ...fromEvidence].filter((v): v is string => !!v))]
}

/** The block's identifiers a channel asks for, each as "Label: value". */
export function letterIdentifiers(ids: BlockRecordIds, kinds: readonly IdentifierKind[]): string[] {
  const value: Partial<Record<IdentifierKind, string | undefined>> = {
    fsp: ids.fsp
      ? `${ids.fsp.id}${ids.fsp.amendment ? ` (amendment ${ids.fsp.amendment}, as the reviewer identified it)` : ''}${bctsPlanOf(ids.fsp.id) ? `, ${bctsPlanOf(ids.fsp.id)!.label}` : ''}`
      : undefined,
    licence: ids.licence,
    'cutting-permit': ids.cuttingPermit
      ? `${ids.cuttingPermit}${ids.permitIssued ? `, issued ${ids.permitIssued}` : ''}`
      : undefined,
    'timber-mark': ids.timberMark,
    opening: ids.opening,
    'road-permit': ids.roadPermit,
    'road-section': ids.roadSection,
    'water-file': ids.waterFile,
    'frontcounter-tracking': ids.trackingNumber,
  }
  return kinds.flatMap((k) => (value[k] ? [`${IDENTIFIER_LABELS[k]}: ${value[k]}`] : []))
}

/** The date range a freedom of information request asks for: the reviewer's, else ten years before the harvest to today. */
export function recordsRange(plan: Plan, block: string, schedule: string, today: string) {
  const ids = recordIdsOf(plan, block)
  const year = entryOf(plan, schedule, block).year ?? Number(today.slice(0, 4))
  return { from: ids.recordsFrom ?? `${year - 10}-01-01`, to: ids.recordsTo ?? today, stated: !!ids.recordsFrom }
}

function gapLines(plan: Plan, gaps: Gap[]): string[] {
  const crossing = (key?: string) => plan.crossings?.find((c) => c.key === key)
  return gaps.map((gap, i) => {
    const kind = gapKindOf(gap.kind)
    const c = crossing(gap.crossing)
    const where = c
      ? `For the crossing the reviewer calls “${c.label}”${crossingIdentifiers(c).length ? `: ${crossingIdentifiers(c).join('; ')}` : ''}.`
      : 'For the block.'
    return `${i + 1}. ${kind.label}: ${kind.ask}.\n   ${where}\n   Why: ${kind.why}`
  })
}

function header(plan: Plan, block: string, schedule: string) {
  const name = plan.blocks.find((b) => b.id === block)?.name ?? block
  const scheduleName = plan.schedules.find((s) => s.id === schedule)?.name ?? schedule
  const year = entryOf(plan, schedule, block).year
  return { name, scheduleName, year }
}

const SEVER =
  'If any part of a record is excepted from disclosure, please sever that part and release the rest, rather than refusing the record (Freedom of Information and Protection of Privacy Act, s. 4(2)).'

/** One letter for a channel and a block's gaps, with its freedom of information variant. */
export function draftLetter(plan: Plan, channel: Channel, gaps: Gap[], today: string): DraftLetter {
  const { block, schedule } = gaps[0]
  const { name, scheduleName, year } = header(plan, block, schedule)
  const ids = recordIdsOf(plan, block)
  const identifiers = letterIdentifiers(ids, channel.identifiers)
  const kinds = [...new Set(gaps.map((g) => gapKindOf(g.kind).label))]
  const range = recordsRange(plan, block, schedule, today)
  const first = identifiers[0]?.replace(/^[^:]+: /, '') ?? name
  const subject = `${channel.foi ? 'Freedom of information request' : 'Request for records'}: ${kinds.join('; ')} (${first})`
  const context = `A review of the cutblock the reviewer calls “${name}” (${year === null ? 'not cut' : `harvest ${year}`} under the schedule “${scheduleName}”) cannot answer the questions below from public data.`
  const cites = channel.cites.map((c) => `${c.provision}: “${c.quote}”`)
  const body = [
    ...gapLines(plan, gaps),
    '',
    identifiers.length ? `Identifiers:\n${listed(identifiers)}` : 'Identifiers: none entered yet.',
  ]
  const closing =
    'The records are needed to answer the review’s questions; a reference to where each is held is welcome where a copy cannot be given.'
  let text: string
  if (channel.search)
    text = [
      `Search: ${kinds.join('; ')}`,
      '',
      `Where: ${channel.route.label}, ${channel.route.url}`,
      '',
      context,
      'Search for:',
      ...body,
      '',
      channel.daysNote,
    ].join('\n')
  else if (channel.field)
    text = [
      `Field check: ${kinds.join('; ')}`,
      '',
      `For: ${channel.holder}`,
      '',
      context,
      'Check on the ground:',
      ...body,
      '',
      channel.note,
    ].join('\n')
  else if (channel.foi)
    text = [
      `Subject: ${subject}`,
      '',
      `To: ${channel.holder}, through ${channel.route.label} (${channel.route.url})`,
      '',
      `${context} Under the Freedom of Information and Protection of Privacy Act, I request copies of the following records, dated from ${range.from} to ${range.to}:`,
      ...body,
      '',
      SEVER,
      ...(cites.length ? ['', ...cites] : []),
    ].join('\n')
  else
    text = [
      `Subject: ${subject}`,
      '',
      `To: ${channel.holder}, through ${channel.route.label} (${channel.route.url})`,
      '',
      `${context} Please provide the following, or say where each is held:`,
      ...body,
      '',
      closing,
      ...(cites.length ? ['', ...cites] : []),
    ].join('\n')
  const foiChannel = channel.foi || channel.search || channel.field ? undefined : channelOf('foi-forests')
  const foiText = foiChannel
    ? [
        `Subject: Freedom of information request: ${kinds.join('; ')} (${first})`,
        '',
        `To: ${foiChannel.holder}, through ${foiChannel.route.label} (${foiChannel.route.url})`,
        '',
        `${context} Under the Freedom of Information and Protection of Privacy Act, I request copies of the following records held by ${channel.holder.replace(/^The /, 'the ')}, dated from ${range.from} to ${range.to}:`,
        ...body,
        '',
        SEVER,
      ].join('\n')
    : undefined
  return {
    key: `${channel.id}:${block}:${schedule}`,
    channel,
    block,
    schedule,
    gaps,
    subject,
    text,
    ...(foiText ? { foiText } : {}),
  }
}

/** One letter per channel per block, covering every gap that channel answers there, in the catalogue's channel order. */
export function draftLetters(plan: Plan, gaps: Gap[], today: string): DraftLetter[] {
  const groups = new Map<string, Gap[]>()
  for (const gap of gaps)
    for (const id of gap.channels) {
      const key = `${id}:${gap.block}:${gap.schedule}`
      groups.set(key, [...(groups.get(key) ?? []), gap])
    }
  const blockRank = (id: string) => plan.blocks.findIndex((b) => b.id === id)
  const channelRank = (id: string) => CHANNEL_CATALOGUE.channels.findIndex((c) => c.id === id)
  return [...groups.entries()]
    .flatMap(([key, list]) => {
      const channel = channelOf(key.split(':')[0])
      return channel ? [draftLetter(plan, channel, list, today)] : []
    })
    .sort((a, b) => blockRank(a.block) - blockRank(b.block) || channelRank(a.channel.id) - channelRank(b.channel.id))
}

/** Every letter as one text file, for Save & export. */
export function lettersText(plan: Plan, letters: DraftLetter[], today: string): string {
  if (!letters.length) return 'No records to request: the reviews have no open question public data cannot answer.\n'
  const rule = '='.repeat(72)
  return [
    `Records to request · drafted ${today}`,
    'Drafts only: nothing has been sent. Each names an office or role, never a person.',
    '',
    ...letters.flatMap((l) => {
      const name = plan.blocks.find((b) => b.id === l.block)?.name ?? l.block
      return [
        rule,
        `${name} · ${l.channel.label}`,
        rule,
        l.text,
        ...(l.foiText
          ? ['', '--- If the office cannot give them: the same as a freedom of information request ---', '', l.foiText]
          : []),
        '',
      ]
    }),
  ].join('\n')
}

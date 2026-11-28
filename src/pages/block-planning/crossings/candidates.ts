/**
 * Crossings read, before the reviewer adds them: what the road designer's register (`designerImport.ts`)
 * and the mapped read (`mappedRead.ts`) found round a block, kept with the plan per block, schedule
 * and source (`Plan.crossingReads`) and keyed to the footprint they were read for. A candidate
 * becomes a crossing record only on the reviewer's click (`placeCandidate`), and then on the record
 * it belongs to when one holds it already: by an alias both hold, else by place under the PSCIS site
 * rule (`key.ts`). What it offers for a fact (`factOffers`) is derived from the record each time,
 * never stored, and answers a question only when the reviewer uses it.
 *
 * Parsed by hand and tolerantly: a plan without reads opens as before, and a read that does not
 * parse, or names a block or schedule the plan no longer has, is left out (one click reads it
 * again). Reads stay out of `usePlanAnalysis`, the rule evaluation and every check's key.
 *
 * DOM- and network-free.
 */
import type { JsonObject } from '@/lib/jsonGuards'
import { releaseKey, type Pack, type Scalar } from '../../../../packages/legal-rules/src/contract'
import type { Block, Plan, ReviewCase } from '../plan'
import { builtAfter1995, mergeSightings, parseSightings, type CrossingSighting } from './dating'
import { roundPoint, type LonLat } from './geometry'
import { aliasKey, matchCrossing, mergeAliases, parseAliases, type CrossingAlias } from './key'
import {
  blankCrossing,
  CROSSING_ROLES,
  CROSSING_STRUCTURES,
  crossingFootprint,
  crossingsOf,
  type CrossingEvidence,
  type CrossingOrigin,
  type CrossingPlace,
  type CrossingRecord,
  type CrossingRole,
  type CrossingStructure,
  type CrossingStructureKind,
} from './record'

/** The evidence kinds the readers write, and how each prints. A kind not listed prints as written. */
export const EVIDENCE_KIND_LABELS: Record<string, string> = {
  designer: 'Road designer',
  road: 'Road permit section',
  stream: 'Mapped stream',
  'pscis-assessment': 'PSCIS assessment',
  'pscis-habitat': 'PSCIS habitat confirmation',
  'pscis-design': 'PSCIS design proposal',
  'pscis-remediation': 'PSCIS remediation',
  'mof-structure': 'Ministry bridge or major culvert',
  'water-approval': 'Water Act approval or notification',
  'fish-observation': 'Fish observations',
  received: 'Received record',
}
export const evidenceKindLabel = (kind: string) => EVIDENCE_KIND_LABELS[kind] ?? kind

/** Where a read came from: the road designer's register file, or DataBC's layers round the block. */
export const CROSSING_READ_SOURCES = ['designer', 'mapped'] as const
export type CrossingReadSource = (typeof CROSSING_READ_SOURCES)[number]
export const CROSSING_READ_SOURCE_LABELS: Record<CrossingReadSource, string> = {
  designer: 'Road designer',
  mapped: 'Mapped layers',
}

/** One place a source puts a crossing, before the reviewer adds it. */
export interface CrossingCandidate {
  /** Stable within its read: the register row, the road and stream, or the PSCIS site. */
  id: string
  origin: Exclude<CrossingOrigin, 'entered'>
  label: string
  point: LonLat
  role: CrossingRole
  road?: CrossingPlace['road']
  stream?: CrossingPlace['stream']
  structure?: CrossingStructure
  aliases: CrossingAlias[]
  evidence: CrossingEvidence[]
  sightings: CrossingSighting[]
  /** Metres from the block's footprint; 0 inside it. */
  distanceM: number
  /**
   * PSCIS sites folded into one candidate because they lie within 15 m on the same road with no
   * mapped stream between them: each can be added on its own instead (`placeCandidate`'s `site`).
   */
  sites?: { label: string; point: LonLat; aliases: CrossingAlias[] }[]
  /** What the reader could not settle, for the reviewer (two records kept apart, a stream not found). */
  note?: string
}

export type ReadLayerStatus = 'read' | 'failed' | 'truncated' | 'skipped'

export interface CrossingRead {
  block: string
  schedule: string
  shape: string
  footprint: string
  source: CrossingReadSource
  readOn: string
  /** What was read: "Road sections and segments within 500 m of the block", the designer file's name. */
  basis: string
  /** Each layer read, with how many records it gave or why it gave none. */
  layers: { id: string; label: string; status: ReadLayerStatus; count: number; message?: string }[]
  /**
   * What the read itself could not settle, for the reviewer: a corridor holding no road, PSCIS sites
   * left off a corridor's roads, a structure that could be on either of two crossings. Absent in
   * reads made before they were kept.
   */
  notes?: string[]
  candidates: CrossingCandidate[]
}

/** At most this many candidates a read keeps, and reads a plan keeps. */
export const MAX_CANDIDATES = 1000
const MAX_READS = 2000

export const crossingReadsOf = (plan: Pick<Plan, 'crossingReads'>, block: string, schedule: string) =>
  (plan.crossingReads ?? []).filter((r) => r.block === block && r.schedule === schedule)

/** Whether a read describes the block's footprint under its schedule as it stands now. */
export function crossingReadCurrent(plan: Plan, read: CrossingRead): boolean {
  const block = plan.blocks.find((b) => b.id === read.block)
  if (!block || !plan.schedules.some((s) => s.id === read.schedule)) return false
  const { shape, signature } = crossingFootprint(plan, block, read.schedule)
  return read.shape === shape.id && read.footprint === signature
}

export type CandidateState =
  | { state: 'added'; record: CrossingRecord }
  | { state: 'matches'; record: CrossingRecord; distanceM?: number }
  | { state: 'new' }

/**
 * Where a candidate stands against the block's crossings: `added` when a record holds one of its
 * aliases, `matches` when a record lies where the PSCIS site rule would join it, else `new`.
 */
export function candidateState(
  records: readonly CrossingRecord[],
  candidate: Pick<CrossingCandidate, 'point' | 'stream' | 'aliases'>,
): CandidateState {
  const match = matchCrossing(records, {
    point: candidate.point,
    blueLineKey: candidate.stream?.blueLineKey,
    measureM: candidate.stream?.measureM,
    aliases: candidate.aliases,
  })
  if (!match) return { state: 'new' }
  return match.by === 'alias'
    ? { state: 'added', record: match.record }
    : { state: 'matches', record: match.record, distanceM: match.distanceM }
}

/** The candidates in the block's current reads that no record holds yet: what the block question counts. */
export function unreviewedCandidates(plan: Plan, block: string, schedule: string): CrossingCandidate[] {
  const records = crossingsOf(plan, block, schedule)
  const seen = new Set<string>()
  const out: CrossingCandidate[] = []
  for (const read of crossingReadsOf(plan, block, schedule)) {
    if (!crossingReadCurrent(plan, read)) continue
    for (const c of read.candidates) {
      // The same place read by both sources counts once.
      const key = c.aliases.map(aliasKey).sort().join('|') || `${read.source}:${c.id}`
      if (seen.has(key)) continue
      seen.add(key)
      if (candidateState(records, c).state !== 'added') out.push(c)
    }
  }
  return out
}

const evidenceKey = (e: CrossingEvidence) =>
  JSON.stringify([e.kind, e.reference ?? '', e.date ?? '', e.received ?? '', e.reference ? '' : e.summary])

/** Evidence joined, each record once; a newer read of the same record replaces the older. */
export function mergeEvidence(a: readonly CrossingEvidence[], b: readonly CrossingEvidence[]): CrossingEvidence[] {
  const out = new Map(a.map((e) => [evidenceKey(e), e]))
  for (const e of b) {
    const had = out.get(evidenceKey(e))
    if (!had || had.readOn <= e.readOn) out.set(evidenceKey(e), e)
  }
  return [...out.values()]
}

/** A candidate's place, as a record keeps it. */
function placeOf(c: Pick<CrossingCandidate, 'point' | 'road' | 'stream'>): CrossingPlace {
  const at: CrossingPlace = { point: roundPoint(c.point) }
  if (c.road && Object.keys(c.road).length) at.road = { ...c.road }
  if (c.stream && Object.keys(c.stream).length) at.stream = { ...c.stream }
  return at
}

export interface Placed {
  plan: Plan
  key: string
  /** Whether it went onto a record already listed rather than a new one. */
  merged: boolean
}

/**
 * Adds a candidate as a crossing, or onto the record it belongs to: one holding any of its aliases,
 * else the nearest the PSCIS site rule would join it with (`matchCrossing`). Merged, the record
 * gains the aliases, evidence and sightings, and a place, stream or structure it lacked; nothing it
 * holds is replaced, and its answers are never touched. `site` adds one of a folded PSCIS
 * candidate's sites on its own; `apart` adds it as a new record even where one matches by place.
 */
export function placeCandidate(
  plan: Plan,
  block: Block,
  schedule: string,
  candidate: CrossingCandidate,
  options: { site?: number; apart?: boolean } = {},
): Placed {
  const site = options.site === undefined ? undefined : candidate.sites?.[options.site]
  const one: CrossingCandidate = site
    ? {
        ...candidate,
        label: site.label,
        point: site.point,
        aliases: site.aliases,
        sites: undefined,
        evidence: candidate.evidence.filter((e) =>
          site.aliases.some((a) => a.source === 'pscis' && a.id === e.reference),
        ),
        sightings: candidate.sightings.filter(
          (s) => s.source !== 'pscis' || site.aliases.some((a) => a.id === s.reference),
        ),
      }
    : candidate
  const records = crossingsOf(plan, block.id, schedule)
  const found = candidateState(records, one)
  const target = found.state === 'added' || (found.state === 'matches' && !options.apart) ? found.record : undefined
  if (target) {
    const merged: CrossingRecord = {
      ...target,
      aliases: mergeAliases(target.aliases ?? [], one.aliases),
      evidence: mergeEvidence(target.evidence, one.evidence),
    }
    const sightings = mergeSightings(target.sightings ?? [], one.sightings)
    if (sightings.length) merged.sightings = sightings
    const at = { ...target.at }
    if (!at.point) at.point = roundPoint(one.point)
    if (!at.stream && one.stream) at.stream = { ...one.stream }
    if (!at.road && one.road) at.road = { ...one.road }
    merged.at = at
    if (!target.structure && one.structure) merged.structure = { ...one.structure }
    if (!merged.aliases?.length) delete merged.aliases
    return {
      plan: { ...plan, crossings: (plan.crossings ?? []).map((c) => (c.key === target.key ? merged : c)) },
      key: target.key,
      merged: true,
    }
  }
  const record: CrossingRecord = {
    ...blankCrossing(plan, block, schedule, one.label),
    origin: one.origin,
    role: one.role,
    at: placeOf(one),
    evidence: one.evidence.map((e) => ({ ...e })),
  }
  if (one.structure) record.structure = { ...one.structure }
  if (one.aliases.length) record.aliases = one.aliases.map((a) => ({ ...a }))
  if (one.sightings.length) record.sightings = mergeSightings([], one.sightings)
  if (one.note) record.note = one.note
  return { plan: { ...plan, crossings: [...(plan.crossings ?? []), record] }, key: record.key, merged: false }
}

// ---------------------------------------------------------------------------------------------
// What a record offers for its facts

/** A value a crossing's evidence offers for one fact, with what it rests on. Used only on the reviewer's click. */
export interface FactOffer {
  pack: string
  fact: string
  value: Scalar
  /** Printed beside the offer and kept as the answer's evidence when it is used. */
  basis: string
}

const STRUCTURE_CHOICE: Record<CrossingStructureKind, string> = {
  culvert: 'Culvert',
  bridge: 'Bridge',
  ford: 'Ford',
  'ice-bridge': 'Ice bridge or snowfill',
  snowfill: 'Ice bridge or snowfill',
  other: 'Other',
}

const WATER = 'bc.water-crossings'
const FPPR = 'bc.fppr-crossings'

/** What the structure was read from, for an offer's basis. */
function structureBasis(record: CrossingRecord): string {
  const from =
    record.evidence.find((e) => e.kind === 'designer') ??
    record.evidence
      .filter((e) => e.kind.startsWith('pscis') || e.kind === 'mof-structure')
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]
  if (!from) return 'As recorded on the crossing.'
  return `${evidenceKindLabel(from.kind)}${from.date ? ` of ${from.date}` : ''}${from.reference ? ` (${from.reference})` : ''}: ${from.summary}`
}

/**
 * What a crossing's evidence offers for its facts, derived each time: a change in and about a
 * stream where a road crosses a mapped or assessed stream; the structure and a culvert's diameter as
 * recorded; the mapped gradient; listed fish species recorded on the stream (never a "no": one visit
 * or none recorded is not absence); and the dating bracket for `built-after-1995`, always with the
 * question whether the structure was replaced since. A PSCIS barrier result offers nothing: it is
 * evidence about a structure, never a §56 answer.
 */
export function factOffers(record: CrossingRecord): FactOffer[] {
  const out: FactOffer[] = []
  const designer = record.evidence.find((e) => e.kind === 'designer')
  const stream = record.evidence.find((e) => e.kind === 'stream')
  const pscis = record.evidence.filter((e) => e.kind === 'pscis-assessment')
  if (designer)
    out.push({
      pack: WATER,
      fact: 'stream-changes',
      value: true,
      basis: `The road designer’s road crosses a stream here: ${designer.summary}`,
    })
  else if (stream && record.origin === 'mapped')
    out.push({
      pack: WATER,
      fact: 'stream-changes',
      value: true,
      basis: `A mapped road crosses a mapped stream here: ${stream.summary}`,
    })
  else if (pscis.length)
    out.push({
      pack: WATER,
      fact: 'stream-changes',
      value: true,
      basis: `PSCIS assessed a structure here${pscis[0].date ? ` on ${pscis[0].date}` : ''}.`,
    })
  const s = record.structure
  if (s) {
    out.push({ pack: FPPR, fact: 'structure', value: STRUCTURE_CHOICE[s.kind], basis: structureBasis(record) })
    if (s.kind === 'culvert' && s.spanOrDiameterM !== undefined)
      out.push({
        pack: WATER,
        fact: 'culvert-diameter',
        value: Math.round(s.spanOrDiameterM * 1000),
        basis: structureBasis(record),
      })
  }
  const gradient = stream?.values?.gradientPercent
  if (typeof gradient === 'number')
    out.push({
      pack: FPPR,
      fact: 'stream-gradient',
      value: Math.round(gradient * 10) / 10,
      basis: `${stream!.summary} A mapped gradient from the Freshwater Atlas line, not a field measurement.`,
    })
  const fish = record.evidence.find(
    (e) => e.kind === 'fish-observation' && typeof e.values?.listed === 'string' && e.values.listed,
  )
  if (fish)
    out.push({
      pack: FPPR,
      fact: 'listed-species',
      value: true,
      basis: `${fish.summary} Recorded on the stream, not necessarily at the crossing.`,
    })
  const dating = builtAfter1995(record.sightings ?? [])
  if (dating.value !== null)
    out.push({
      pack: FPPR,
      fact: 'built-after-1995',
      value: dating.value,
      basis: `${dating.reason} ${dating.replaced}`,
    })
  return out
}

/** The answer a case already holds for an offer's fact, if any. */
export function heldAnswer(review: ReviewCase, library: Pack[], offer: FactOffer): Scalar | undefined {
  const pack = library.find((p) => p.id === offer.pack && review.selected.includes(releaseKey(p)))
  if (!pack) return undefined
  return review.sets[releaseKey(pack)]?.facts.find((f) => f.id === offer.fact)?.value ?? undefined
}

// ---------------------------------------------------------------------------------------------
// Parsing

const finite = (v: unknown, min = 0, max = 1e7) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined
const shortText = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function point(v: unknown): LonLat | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined
  const [x, y] = v
  return finite(x, -180, 180) !== undefined && finite(y, -90, 90) !== undefined ? [x, y] : undefined
}

function evidenceList(v: unknown): CrossingEvidence[] {
  if (!Array.isArray(v)) return []
  // The record parser's rules, through a throwaway record.
  return v.flatMap((e) => {
    if (!e || typeof e !== 'object') return []
    const x = e as JsonObject
    const kind = shortText(x.kind, 60)
    const source = shortText(x.source, 500)
    const summary = shortText(x.summary, 2000)
    if (!kind || !source || !summary || !isDay(x.readOn)) return []
    let values: Record<string, string | number | boolean> | undefined
    if (x.values && typeof x.values === 'object' && !Array.isArray(x.values)) {
      values = {}
      for (const [k, val] of Object.entries(x.values as JsonObject).slice(0, 60))
        if (
          /^[A-Za-z0-9_.-]{1,60}$/.test(k) &&
          (typeof val === 'boolean' ||
            (typeof val === 'number' && Number.isFinite(val)) ||
            (typeof val === 'string' && val.length <= 500))
        )
          values[k] = val as string | number | boolean
      if (!Object.keys(values).length) values = undefined
    }
    return [
      defined({
        kind,
        source,
        readOn: x.readOn as string,
        summary,
        reference: shortText(x.reference, 500),
        date: isDay(x.date) ? x.date : undefined,
        distanceM: finite(x.distanceM, 0, 1e6),
        values,
      }),
    ]
  })
}

function structure(v: unknown): CrossingStructure | undefined {
  if (!v || typeof v !== 'object') return undefined
  const s = v as JsonObject
  if (!CROSSING_STRUCTURES.includes(s.kind as CrossingStructureKind)) return undefined
  return defined({
    kind: s.kind as CrossingStructureKind,
    spanOrDiameterM: finite(s.spanOrDiameterM, 0, 1000),
    lengthM: finite(s.lengthM, 0, 10_000),
    openBottom: typeof s.openBottom === 'boolean' ? s.openBottom : undefined,
  })
}

function roadOf(v: unknown): CrossingPlace['road'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as JsonObject
  const road = defined({
    name: shortText(r.name),
    file: shortText(r.file, 100),
    section: shortText(r.section, 100),
    chainageM: finite(r.chainageM),
  })
  return Object.keys(road).length ? road : undefined
}

function streamOf(v: unknown): CrossingPlace['stream'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as JsonObject
  const stream = defined({
    name: shortText(r.name),
    blueLineKey: finite(r.blueLineKey, 0, Number.MAX_SAFE_INTEGER),
    measureM: finite(r.measureM),
  })
  return Object.keys(stream).length ? stream : undefined
}

function parseCandidate(v: unknown): CrossingCandidate | undefined {
  if (!v || typeof v !== 'object') return undefined
  const c = v as JsonObject
  const id = shortText(c.id, 300)
  const label = shortText(c.label)
  const at = point(c.point)
  const origin = (['designer', 'mapped', 'pscis'] as const).find((o) => o === c.origin)
  if (!id || !label || !at || !origin) return undefined
  const sites = Array.isArray(c.sites)
    ? c.sites.slice(0, 50).flatMap((s) => {
        if (!s || typeof s !== 'object') return []
        const o = s as JsonObject
        const p = point(o.point)
        const l = shortText(o.label)
        return p && l ? [{ label: l, point: p, aliases: parseAliases(o.aliases) }] : []
      })
    : []
  return defined({
    id,
    origin,
    label,
    point: at,
    role: CROSSING_ROLES.includes(c.role as CrossingRole) ? (c.role as CrossingRole) : 'unknown',
    road: roadOf(c.road),
    stream: streamOf(c.stream),
    structure: structure(c.structure),
    aliases: parseAliases(c.aliases),
    evidence: evidenceList(c.evidence),
    sightings: parseSightings(c.sightings),
    distanceM: finite(c.distanceM, 0, 1e6) ?? 0,
    sites: sites.length > 1 ? sites : undefined,
    note: shortText(c.note, 2000),
  })
}

function parseRead(v: unknown): CrossingRead | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as JsonObject
  const source = CROSSING_READ_SOURCES.find((s) => s === r.source)
  const block = shortText(r.block, 200)
  const schedule = shortText(r.schedule, 200)
  const shape = shortText(r.shape, 200)
  const footprint = shortText(r.footprint, 200)
  const basis = shortText(r.basis, 500)
  if (
    !source ||
    !block ||
    !schedule ||
    !shape ||
    !footprint ||
    !basis ||
    !isDay(r.readOn) ||
    !Array.isArray(r.candidates)
  )
    return undefined
  const layers = Array.isArray(r.layers)
    ? r.layers.slice(0, 50).flatMap((l) => {
        if (!l || typeof l !== 'object') return []
        const o = l as JsonObject
        const id = shortText(o.id, 200)
        const label = shortText(o.label, 200)
        const status = (['read', 'failed', 'truncated', 'skipped'] as const).find((s) => s === o.status)
        const count = finite(o.count, 0, 1e6)
        if (!id || !label || !status || count === undefined) return []
        return [defined({ id, label, status, count, message: shortText(o.message, 1000) })]
      })
    : []
  const notes = Array.isArray(r.notes) ? r.notes.slice(0, 20).flatMap((n) => shortText(n, 2000) ?? []) : []
  return {
    block,
    schedule,
    shape,
    footprint,
    source,
    readOn: r.readOn as string,
    basis,
    layers,
    ...(notes.length ? { notes } : {}),
    candidates: r.candidates.slice(0, MAX_CANDIDATES).flatMap((c) => parseCandidate(c) ?? []),
  }
}

/**
 * The plan's crossing reads as far as they read: absent stays absent; a read that does not parse,
 * names a block or schedule the plan does not have, or repeats a block, schedule and source is left out.
 */
export function parseCrossingReads(
  value: unknown,
  blocks: readonly { id: string }[],
  schedules: readonly { id: string }[],
): CrossingRead[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept: CrossingRead[] = []
  for (const item of value.slice(0, MAX_READS)) {
    const read = parseRead(item)
    if (!read) continue
    if (!blocks.some((b) => b.id === read.block) || !schedules.some((s) => s.id === read.schedule)) continue
    if (kept.some((k) => k.block === read.block && k.schedule === read.schedule && k.source === read.source)) continue
    kept.push(read)
  }
  return kept
}

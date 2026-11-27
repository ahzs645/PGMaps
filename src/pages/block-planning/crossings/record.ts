/**
 * Stream crossings, one answer set each: the crossings a block's roads and harvesting make, kept
 * with the plan per block and schedule and keyed to the footprint they were listed for. Each holds
 * its own review case over the crossing releases (`crossingReleases` in the forestry profile), so a
 * crossing with no authority is never hidden behind another that has one.
 *
 * A record's key is its own, never a PSCIS or modelled crossing id: those are not stable (the same
 * site has carried two PSCIS ids), and they are evidence about a crossing, never its identity.
 *
 * Parsed by hand and tolerantly: a plan without crossings opens as before; a field that does not
 * read is left off its record, and a record without its key, block, schedule or review, or naming a
 * block or schedule the plan no longer has, is left out and counted (`openPlanFile` says how many).
 * Crossings stay out of `usePlanAnalysis` and every check's key.
 *
 * DOM- and network-free.
 */
import { list, object, text, type JsonObject } from '@/lib/jsonGuards'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import type { FactSet } from '../../../../packages/legal-rules/src/contract'
import { entryOf, shapeOf, type Block, type Plan, type ReviewCase } from '../plan'
import { shapeSignature } from '../records'
import { parseSightings, type CrossingSighting } from './dating'
import { parseAliases, type CrossingAlias } from './key'

/**
 * How a crossing came into the plan: entered by the reviewer, or added on the reviewer's click from
 * a candidate the road designer's register (`designerImport.ts`) or the mapped read (`mappedRead.ts`)
 * offered: a road × stream crossing (`mapped`) or a PSCIS site with no mapped crossing (`pscis`).
 */
export const CROSSING_ORIGINS = ['entered', 'designer', 'mapped', 'pscis'] as const
export type CrossingOrigin = (typeof CROSSING_ORIGINS)[number]
export const CROSSING_ORIGIN_LABELS: Record<CrossingOrigin, string> = {
  entered: 'Entered',
  designer: 'Road designer',
  mapped: 'Mapped',
  pscis: 'PSCIS',
}

/** Whether the crossing is on the block's own road, on the road it is reached by, or not yet known. */
export const CROSSING_ROLES = ['own', 'access', 'unknown'] as const
export type CrossingRole = (typeof CROSSING_ROLES)[number]
export const CROSSING_ROLE_LABELS: Record<CrossingRole, string> = {
  own: 'Block’s own road',
  access: 'Access road',
  unknown: 'Road not stated',
}

export const CROSSING_STRUCTURES = ['culvert', 'bridge', 'ford', 'ice-bridge', 'snowfill', 'other'] as const
export type CrossingStructureKind = (typeof CROSSING_STRUCTURES)[number]
export const CROSSING_STRUCTURE_LABELS: Record<CrossingStructureKind, string> = {
  culvert: 'Culvert',
  bridge: 'Bridge',
  ford: 'Ford',
  'ice-bridge': 'Ice bridge',
  snowfill: 'Snowfill',
  other: 'Other',
}

export interface CrossingStructure {
  kind: CrossingStructureKind
  /** A bridge's span or a culvert's equivalent diameter, in metres. */
  spanOrDiameterM?: number
  lengthM?: number
  openBottom?: boolean
}

/** Where a road meets a stream, as far as it is known. */
export interface CrossingPlace {
  /** WGS84 longitude and latitude. */
  point?: [number, number]
  road?: { name?: string; file?: string; section?: string; chainageM?: number }
  stream?: { name?: string; blueLineKey?: number; measureM?: number }
}

/**
 * A record read about the crossing (a PSCIS stage, a modelled crossing, a fish observation, a
 * ministry structure, a Water Act notice, the designer's sizing): a candidate the reviewer weighs,
 * with its read date and source, names cut. None are read yet.
 */
export interface CrossingEvidence {
  kind: string
  source: string
  readOn: string
  summary: string
  reference?: string
  /** A value the reviewer transcribed from a received record (`acquire/`), `<record id>/<value id>`; kind `received`. */
  received?: string
}

export interface CrossingRecord {
  key: string
  label: string
  block: string
  schedule: string
  /** The block shape and footprint signature it was listed for; a different footprint makes it out of date. */
  shape: string
  footprint: string
  at?: CrossingPlace
  origin: CrossingOrigin
  role: CrossingRole
  structure?: CrossingStructure
  note?: string
  evidence: CrossingEvidence[]
  /** Its own review over the crossing releases. */
  review: ReviewCase
}

/** The releases a new crossing is reviewed under. */
export const CROSSING_RELEASES: readonly string[] = profile.crossingReleases
const instrumentOf = (key: string) => key.slice(0, key.lastIndexOf('@'))
/** The instruments a crossing case may use: those of the crossing releases, never a block's. */
export const CROSSING_INSTRUMENTS: readonly string[] = [...new Set(CROSSING_RELEASES.map(instrumentOf))]

/** At most this many crossings a plan keeps, and this much text a field. */
export const MAX_CROSSINGS = 2000
const MAX_LABEL = 200
const MAX_NOTE = 20_000

/** The shape a block takes under a schedule, and its signature: what a crossing is keyed to. */
export function crossingFootprint(plan: Plan, block: Block, schedule: string) {
  const shape = shapeOf(block, entryOf(plan, schedule, block.id))
  return { shape, signature: shapeSignature(shape.geometry) }
}

/** The crossings listed for a block and schedule, in the order they were added. */
export const crossingsOf = (plan: Pick<Plan, 'crossings'>, block: string, schedule: string) =>
  (plan.crossings ?? []).filter((c) => c.block === block && c.schedule === schedule)

/** Whether a crossing was listed for the block's footprint under its schedule as it stands now. */
export function crossingCurrent(plan: Plan, record: CrossingRecord): boolean {
  const block = plan.blocks.find((b) => b.id === record.block)
  if (!block || !plan.schedules.some((s) => s.id === record.schedule)) return false
  const { shape, signature } = crossingFootprint(plan, block, record.schedule)
  return record.shape === shape.id && record.footprint === signature
}

/** A key no crossing in the plan has used, so a removed crossing's key is not given to another. */
export function nextCrossingKey(plan: Pick<Plan, 'crossings'>) {
  const n = Math.max(0, ...(plan.crossings ?? []).map((c) => Number(/^crossing-(\d+)$/.exec(c.key)?.[1] ?? 0)))
  return `crossing-${n + 1}`
}

/** A crossing the reviewer enters, with its own case on the crossing releases and nothing answered. */
export function blankCrossing(
  plan: Plan,
  block: Block,
  schedule: string,
  label: string,
  review: ReviewCase = { selected: [...CROSSING_RELEASES], date: profile.assessmentDate, sets: {} },
): CrossingRecord {
  const { shape, signature } = crossingFootprint(plan, block, schedule)
  return {
    key: nextCrossingKey(plan),
    label: label.trim() || `Crossing ${crossingsOf(plan, block.id, schedule).length + 1}`,
    block: block.id,
    schedule,
    shape: shape.id,
    footprint: signature,
    origin: 'entered',
    role: 'unknown',
    evidence: [],
    review,
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing

const finite = (v: unknown, min = 0, max = 1e6) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined
const shortText = (v: unknown, max = MAX_LABEL) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

/** Keeps only the defined values, so a field that did not read is absent rather than undefined. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function parseStructure(value: unknown): CrossingStructure | undefined {
  if (!value || typeof value !== 'object') return undefined
  const s = value as JsonObject
  if (!CROSSING_STRUCTURES.includes(s.kind as CrossingStructureKind)) return undefined
  return defined({
    kind: s.kind as CrossingStructureKind,
    spanOrDiameterM: finite(s.spanOrDiameterM, 0, 1000),
    lengthM: finite(s.lengthM, 0, 10_000),
    openBottom: typeof s.openBottom === 'boolean' ? s.openBottom : undefined,
  })
}

function parsePlace(value: unknown): CrossingPlace | undefined {
  if (!value || typeof value !== 'object') return undefined
  const a = value as JsonObject
  const p = Array.isArray(a.point) ? a.point : undefined
  const point =
    p && p.length === 2 && finite(p[0], -180, 180) !== undefined && finite(p[1], -90, 90) !== undefined
      ? ([p[0], p[1]] as [number, number])
      : undefined
  const road =
    a.road && typeof a.road === 'object'
      ? defined({
          name: shortText((a.road as JsonObject).name),
          file: shortText((a.road as JsonObject).file, 100),
          section: shortText((a.road as JsonObject).section, 100),
          chainageM: finite((a.road as JsonObject).chainageM, 0, 1e7),
        })
      : undefined
  const stream =
    a.stream && typeof a.stream === 'object'
      ? defined({
          name: shortText((a.stream as JsonObject).name),
          blueLineKey: finite((a.stream as JsonObject).blueLineKey, 0, Number.MAX_SAFE_INTEGER),
          measureM: finite((a.stream as JsonObject).measureM, 0, 1e7),
        })
      : undefined
  const place = defined({
    point,
    road: road && Object.keys(road).length ? road : undefined,
    stream: stream && Object.keys(stream).length ? stream : undefined,
  })
  return Object.keys(place).length ? place : undefined
}

function parseEvidence(value: unknown): CrossingEvidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const e = item as JsonObject
    const kind = shortText(e.kind, 60)
    const source = shortText(e.source, 500)
    const readOn = day(e.readOn)
    const summary = shortText(e.summary, 2000)
    if (!kind || !source || !readOn || !summary) return []
    return [
      defined({
        kind,
        source,
        readOn,
        summary,
        reference: shortText(e.reference, 500),
        received: shortText(e.received, 130),
      }),
    ]
  })
}

function parseCase(value: unknown, label: string): ReviewCase {
  const r = object(value, label)
  const selected = list(r.selected, `${label} releases`, 100).map((v) => text(v, `${label} release`))
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))
    throw Error(`${label} date must be YYYY-MM-DD.`)
  return { selected, date: r.date, sets: object(r.sets ?? {}, `${label} facts`) as Record<string, FactSet> }
}

/** One crossing record; throws when its identity or its review does not read. */
export function parseCrossing(value: unknown, at = 'crossing'): CrossingRecord {
  const c = object(value, at)
  const record: CrossingRecord = {
    key: text(c.key, `${at} key`, 100),
    label: text(c.label, `${at} label`, MAX_LABEL),
    block: text(c.block, `${at} block`),
    schedule: text(c.schedule, `${at} schedule`),
    shape: text(c.shape, `${at} shape`),
    footprint: text(c.footprint, `${at} footprint`),
    origin: CROSSING_ORIGINS.includes(c.origin as CrossingOrigin) ? (c.origin as CrossingOrigin) : 'entered',
    role: CROSSING_ROLES.includes(c.role as CrossingRole) ? (c.role as CrossingRole) : 'unknown',
    evidence: parseEvidence(c.evidence),
    review: parseCase(c.review, `${at} review`),
  }
  const place = parsePlace(c.at)
  if (place) record.at = place
  const structure = parseStructure(c.structure)
  if (structure) record.structure = structure
  const note = shortText(c.note, MAX_NOTE)
  if (note) record.note = note
  return record
}

/**
 * The plan's crossings as far as they read: absent stays absent; a record that does not read, names
 * a block or schedule the plan does not have, or repeats a key is left out.
 */
export function parseCrossings(
  value: unknown,
  blocks: readonly { id: string }[],
  schedules: readonly { id: string }[],
): CrossingRecord[] | undefined {
  if (value === undefined || !Array.isArray(value)) return undefined
  const kept: CrossingRecord[] = []
  for (const item of value.slice(0, MAX_CROSSINGS)) {
    let record: CrossingRecord
    try {
      record = parseCrossing(item)
    } catch {
      continue
    }
    if (!blocks.some((b) => b.id === record.block) || !schedules.some((s) => s.id === record.schedule)) continue
    if (kept.some((r) => r.key === record.key)) continue
    kept.push(record)
  }
  return kept
}

/**
 * "On this ground": the record of one read of the legal instruments mapped on a block's footprint
 * (`groundRead.ts`), kept with the plan per block and schedule and keyed to the footprint it was
 * read for. It is DataBC's answer and the catalogue's reach, never a finding: it never answers a
 * review fact, never enters the rule evaluation, `usePlanAnalysis` or a check's key.
 *
 * Parsed by hand and tolerantly: a plan without reads opens as before, and a read that does not
 * parse, or names a block or schedule the plan no longer has, is left out, never repaired (one
 * click reads it again).
 *
 * DOM- and network-free.
 */
import { bool, int, list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'
import { entryOf, shapeOf, type Block, type Plan } from '../plan'
import { shapeSignature } from '../records'

export const READ_STATUSES = ['read', 'failed', 'truncated'] as const
export type ReadStatus = (typeof READ_STATUSES)[number]

/** At most this many features an instrument keeps (`groundRead.ts` reads no more a layer). */
export const MAX_GROUND_FEATURES = 500
/** At most this many openings a precedent read keeps (`precedent.ts`). */
export const MAX_PRECEDENT_OPENINGS = 1000

export interface GroundFeature {
  /** DataBC's identifier as it prints: the Crown lands file, the RAN file, the UWR unit. */
  id: string
  /** What the feature is, as DataBC names it. */
  name: string
  /** The other attributes kept, each "label: value" as DataBC gives it. */
  details: string[]
  /** What a document request quotes. */
  identifiers: { label: string; value: string }[]
  overlapHa: number
  sharePercent: number
  /** The layer's effective or legalisation date for this feature, where the layer has one. */
  effective?: string
}

export interface GroundInstrumentRead {
  /** A catalogue instrument id (`groundInstruments.ts`). */
  instrument: string
  status: ReadStatus
  message?: string
  features: GroundFeature[]
  /** The footprint its features cover, ground two of them share counted once. */
  coveredHa: number
}

export interface PrecedentOpening {
  openingId: number
  mapLabel?: string
  forestFileId?: string
  fileType?: string
  cuttingPermit?: string
  cutBlock?: string
  category?: string
  status?: string
  grossHa?: number
  /** The harvest's start (`DISTURBANCE_START_DATE`), else its first denudation's completion. */
  harvested?: string
  /** Each denudation as RESULTS gives it: disturbance, silviculture system, completed. */
  denudation: string[]
  sitePrep: string[]
  planting: string[]
  /** Whether a completed planting is recorded; `null` when the planting reads failed. */
  planted: boolean | null
  standards: string[]
  /** Whether any standards unit declares free growing; `null` when the standards read failed. */
  freeGrowing: boolean | null
}

export interface PrecedentRow {
  instrument: string
  /** The date openings are counted from: the earliest of its features' dates. */
  since?: string
  /** Whether the layer gives a date at all. */
  dated: boolean
  /** Openings harvested on or after the date (or all, without one), inside the instrument and the radius. */
  openings: number[]
  /** Openings inside it and the radius harvested before its date, left out. */
  earlier: number
}

export interface GroundPrecedent {
  status: ReadStatus
  message?: string
  radiusM: number
  /** The RESULTS layers joined by opening; a failed join prints "Not read", never none. */
  joins: { standards: ReadStatus; planting: ReadStatus; activities: ReadStatus }
  openings: PrecedentOpening[]
  rows: PrecedentRow[]
}

export interface GroundRead {
  block: string
  schedule: string
  /** The shape and its signature read; a different footprint makes the read out of date. */
  shape: string
  footprint: string
  readOn: string
  footprintHa: number
  /** The catalogue version the reach came from. */
  catalogue: string
  instruments: GroundInstrumentRead[]
  precedent?: GroundPrecedent
}

const ID = 200
const num = (v: unknown, at: string, max = 1e9) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw Error(`${at} must be a number.`)
  return v
}
const day = (v: unknown, at: string) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw Error(`${at} must be YYYY-MM-DD.`)
  return v
}
const optText = (o: JsonObject, key: string, at: string, max = 500) =>
  optional(o, key, (v) => text(v, `${at} ${key}`, max))
const texts = (v: unknown, at: string, max = 40) => list(v, at, max).map((s) => text(s, at, 2000))
const triState = (v: unknown, at: string) => (v === null ? null : bool(v, at))

function feature(value: unknown, at: string): GroundFeature {
  const o = object(value, at)
  return {
    id: text(o.id, `${at} id`, ID),
    name: text(o.name, `${at} name`, 500),
    details: texts(o.details, `${at} details`, 20),
    identifiers: list(o.identifiers, `${at} identifiers`, 10).map((x, i) => {
      const r = object(x, `${at} identifier ${i + 1}`)
      return { label: text(r.label, `${at} identifier label`), value: text(r.value, `${at} identifier value`, 500) }
    }),
    overlapHa: num(o.overlapHa, `${at} overlapHa`),
    sharePercent: num(o.sharePercent, `${at} sharePercent`, 100),
    effective: optional(o, 'effective', (v) => day(v, `${at} effective`)),
  }
}

function instrumentRead(value: unknown, at: string): GroundInstrumentRead {
  const o = object(value, at)
  return {
    instrument: text(o.instrument, `${at} instrument`, 50),
    status: oneOf(o.status, `${at} status`, READ_STATUSES),
    message: optText(o, 'message', at, 2000),
    features: list(o.features, `${at} features`, MAX_GROUND_FEATURES).map((f, i) =>
      feature(f, `${at} feature ${i + 1}`),
    ),
    coveredHa: num(o.coveredHa, `${at} coveredHa`),
  }
}

function opening(value: unknown, at: string): PrecedentOpening {
  const o = object(value, at)
  const out: PrecedentOpening = {
    openingId: int(o.openingId, `${at} openingId`, 0, Number.MAX_SAFE_INTEGER),
    denudation: texts(o.denudation, `${at} denudation`),
    sitePrep: texts(o.sitePrep, `${at} sitePrep`),
    planting: texts(o.planting, `${at} planting`),
    planted: triState(o.planted, `${at} planted`),
    standards: texts(o.standards, `${at} standards`),
    freeGrowing: triState(o.freeGrowing, `${at} freeGrowing`),
  }
  for (const key of [
    'mapLabel',
    'forestFileId',
    'fileType',
    'cuttingPermit',
    'cutBlock',
    'category',
    'status',
  ] as const) {
    const v = optText(o, key, at, 100)
    if (v !== undefined) out[key] = v
  }
  const gross = optional(o, 'grossHa', (v) => num(v, `${at} grossHa`))
  if (gross !== undefined) out.grossHa = gross
  const harvested = optional(o, 'harvested', (v) => day(v, `${at} harvested`))
  if (harvested !== undefined) out.harvested = harvested
  return out
}

function precedent(value: unknown, at: string): GroundPrecedent {
  const o = object(value, at)
  const j = object(o.joins, `${at} joins`)
  return {
    status: oneOf(o.status, `${at} status`, READ_STATUSES),
    message: optText(o, 'message', at, 2000),
    radiusM: num(o.radiusM, `${at} radiusM`, 100_000),
    joins: {
      standards: oneOf(j.standards, `${at} standards`, READ_STATUSES),
      planting: oneOf(j.planting, `${at} planting`, READ_STATUSES),
      activities: oneOf(j.activities, `${at} activities`, READ_STATUSES),
    },
    openings: list(o.openings, `${at} openings`, MAX_PRECEDENT_OPENINGS).map((x, i) =>
      opening(x, `${at} opening ${i + 1}`),
    ),
    rows: list(o.rows, `${at} rows`, 100).map((x, i) => {
      const r = object(x, `${at} row ${i + 1}`)
      return {
        instrument: text(r.instrument, `${at} row instrument`, 50),
        since: optional(r, 'since', (v) => day(v, `${at} row since`)),
        dated: bool(r.dated, `${at} row dated`),
        openings: list(r.openings, `${at} row openings`, MAX_PRECEDENT_OPENINGS).map((n) =>
          int(n, `${at} row opening`, 0, Number.MAX_SAFE_INTEGER),
        ),
        earlier: int(r.earlier, `${at} row earlier`, 0, MAX_PRECEDENT_OPENINGS),
      }
    }),
  }
}

export function parseGroundRead(value: unknown, at = 'ground read'): GroundRead {
  const o = object(value, at)
  return {
    block: text(o.block, `${at} block`),
    schedule: text(o.schedule, `${at} schedule`),
    shape: text(o.shape, `${at} shape`),
    footprint: text(o.footprint, `${at} footprint`),
    readOn: day(o.readOn, `${at} readOn`),
    footprintHa: num(o.footprintHa, `${at} footprintHa`),
    catalogue: text(o.catalogue, `${at} catalogue`, 20),
    instruments: list(o.instruments, `${at} instruments`, 100).map((x, i) =>
      instrumentRead(x, `${at} instrument ${i + 1}`),
    ),
    precedent: optional(o, 'precedent', (v) => precedent(v, `${at} precedent`)),
  }
}

/**
 * The plan's reads, tolerantly: absent is none; an entry that does not parse, names a block or
 * schedule the plan does not have, or repeats a block and schedule, is left out.
 */
export function parseGroundReads(
  value: unknown,
  blocks: readonly { id: string }[],
  schedules: readonly { id: string }[],
): GroundRead[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const kept: GroundRead[] = []
  for (const item of value) {
    let read: GroundRead
    try {
      read = parseGroundRead(item)
    } catch {
      continue
    }
    if (!blocks.some((b) => b.id === read.block) || !schedules.some((s) => s.id === read.schedule)) continue
    if (kept.some((r) => r.block === read.block && r.schedule === read.schedule)) continue
    kept.push(read)
  }
  return kept
}

/** The shape a block takes under a schedule, and its signature: what a read is keyed to. */
export function groundFootprint(plan: Plan, block: Block, schedule: string) {
  const shape = shapeOf(block, entryOf(plan, schedule, block.id))
  return { shape, signature: shapeSignature(shape.geometry) }
}

/** The read kept for a block and schedule, if any. */
export const groundReadOf = (plan: Plan, block: string, schedule: string) =>
  plan.groundReads?.find((r) => r.block === block && r.schedule === schedule)

/** Whether a read describes the block's footprint under its schedule as it stands now. */
export function groundReadCurrent(plan: Plan, read: GroundRead): boolean {
  const block = plan.blocks.find((b) => b.id === read.block)
  if (!block || !plan.schedules.some((s) => s.id === read.schedule)) return false
  const { shape, signature } = groundFootprint(plan, block, read.schedule)
  return read.shape === shape.id && read.footprint === signature
}

/** Keeps a read, replacing the block and schedule's earlier one. A read for other ground is refused. */
export function saveGroundRead(plan: Plan, read: GroundRead): Plan {
  if (!groundReadCurrent(plan, read)) return plan
  return {
    ...plan,
    groundReads: [
      ...(plan.groundReads ?? []).filter((r) => r.block !== read.block || r.schedule !== read.schedule),
      read,
    ],
  }
}

/** Instruments not read, grouped by the reason: one layer's failure is every instrument it holds. */
export function failedByReason(failed: GroundRead['instruments']) {
  const groups = new Map<string, string[]>()
  for (const r of failed) {
    const reason = r.message ?? 'The read failed.'
    groups.set(reason, [...(groups.get(reason) ?? []), r.instrument])
  }
  return [...groups].map(([reason, ids]) => ({ reason, ids }))
}

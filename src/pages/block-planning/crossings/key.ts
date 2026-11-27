/**
 * A crossing's identity. A record keeps the key it was given (`crossing-<n>`, `nextCrossingKey`)
 * for good; every id a source gives the same place becomes an alias on it, with its source and the
 * day the source saw it: a PSCIS crossing id, a bcfishpass modelled crossing id, the ministry's
 * `CROSSING_SITE_ID`, the road designer's register row, a road × stream crossing computed from the
 * mapped layers, a field check's label. A new read is placed on an existing record before a record
 * is added for it: first by an alias both hold, then by place under the PSCIS site rule
 * (`pscisSites.ts`). An alias is evidence of where a record was seen, never its key.
 *
 * DOM- and network-free.
 */
import type { JsonObject } from '@/lib/jsonGuards'
import { distanceM, type LonLat } from './geometry'
import { pairVerdict, type SiteRecord } from './pscisSites'
import type { CrossingRecord } from './record'

/**
 * Where an alias comes from. `mapped` is a road × stream crossing PGMaps computed from DataBC's road
 * and Freshwater Atlas lines (the road file and section, and the stream's blue line key).
 */
export const CROSSING_ALIAS_SOURCES = ['pscis', 'modelled', 'mof-structure', 'designer', 'field', 'mapped'] as const
export type CrossingAliasSource = (typeof CROSSING_ALIAS_SOURCES)[number]
export const CROSSING_ALIAS_LABELS: Record<CrossingAliasSource, string> = {
  pscis: 'PSCIS crossing',
  modelled: 'Modelled crossing (bcfishpass)',
  'mof-structure': 'Ministry bridge or major culvert',
  designer: 'Road designer register',
  field: 'Field check',
  mapped: 'Mapped road × stream',
}

export interface CrossingAlias {
  source: CrossingAliasSource
  id: string
  /** The day the source saw the place: a survey's date, an inspection's, or the day it was read. */
  seenOn: string
}

export const aliasKey = (a: Pick<CrossingAlias, 'source' | 'id'>) => `${a.source}:${a.id}`

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Aliases as far as they read, each once. */
export function parseAliases(value: unknown): CrossingAlias[] {
  if (!Array.isArray(value)) return []
  const out: CrossingAlias[] = []
  for (const item of value.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue
    const a = item as JsonObject
    if (!CROSSING_ALIAS_SOURCES.includes(a.source as CrossingAliasSource)) continue
    if (typeof a.id !== 'string' || !a.id.trim() || a.id.length > 200 || !isDay(a.seenOn)) continue
    const alias = { source: a.source as CrossingAliasSource, id: a.id.trim(), seenOn: a.seenOn }
    if (!out.some((o) => aliasKey(o) === aliasKey(alias))) out.push(alias)
  }
  return out
}

/** Two alias lists joined, each alias once, keeping the earlier day it was seen. */
export function mergeAliases(a: readonly CrossingAlias[], b: readonly CrossingAlias[]): CrossingAlias[] {
  const out = new Map(a.map((x) => [aliasKey(x), x]))
  for (const x of b) {
    const had = out.get(aliasKey(x))
    if (!had || x.seenOn < had.seenOn) out.set(aliasKey(x), x)
  }
  return [...out.values()]
}

/** A read about one place: where it is, the stream it is on, its aliases. */
export interface PlacedRead {
  point?: LonLat
  blueLineKey?: number
  measureM?: number
  aliases: readonly CrossingAlias[]
}

export interface CrossingMatch {
  record: CrossingRecord
  by: 'alias' | 'place'
  distanceM?: number
}

/** The PSCIS survey days a record or read holds, from its aliases. */
const surveyDays = (aliases: readonly CrossingAlias[]) =>
  aliases.filter((a) => a.source === 'pscis').map((a) => a.seenOn)

/** A record or read as the site rule sees it, once for each survey day it holds (or once with none). */
function asSites(id: string, place: PlacedRead): SiteRecord[] {
  if (!place.point) return []
  const days = surveyDays(place.aliases)
  const base = { id, point: place.point, blueLineKey: place.blueLineKey, measureM: place.measureM }
  return days.length ? days.map((day) => ({ ...base, day })) : [base]
}

/**
 * The record a read belongs to, among `records` (one block and schedule's): one that holds any of
 * its aliases, else the nearest that the PSCIS site rule would join it with (never across two mapped
 * streams, never a same-day survey more than 5 m away). Null when it is a place no record holds.
 */
export function matchCrossing(records: readonly CrossingRecord[], read: PlacedRead): CrossingMatch | null {
  const keys = new Set(read.aliases.map(aliasKey))
  const byAlias = records.find((r) => (r.aliases ?? []).some((a) => keys.has(aliasKey(a))))
  if (byAlias) return { record: byAlias, by: 'alias' }
  const readSites = asSites('read', read)
  let best: CrossingMatch | null = null
  for (const record of records) {
    const point = record.at?.point
    if (!point || !read.point) continue
    const place: PlacedRead = {
      point,
      blueLineKey: record.at?.stream?.blueLineKey,
      measureM: record.at?.stream?.measureM,
      aliases: record.aliases ?? [],
    }
    const d = distanceM(point, read.point)
    const joins = asSites(record.key, place).every((a) => readSites.every((b) => pairVerdict(a, b, d).join))
    if (joins && (!best || d < (best.distanceM ?? Infinity))) best = { record, by: 'place', distanceM: d }
  }
  return best
}

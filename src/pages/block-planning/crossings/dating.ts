/**
 * Dating a crossing from sightings: dated records of whether the road and its crossing were there.
 * No public layer dates a crossing; dated surveys, base mapping and imagery can only bracket when it
 * first appeared ("first seen between X and Y"), never give one date. And they date the road, not
 * the structure: whether the pipe or bridge was replaced since is a separate question, asked beside
 * every bracket.
 *
 * Automatic sightings come from the reads (TRIM's source photography date, a PSCIS survey, the
 * harvest start of a block reached only across the crossing), each "present by" its date; the
 * reviewer adds the rest (an air photo, a Wayback release, a Sentinel-2 or Landsat scene, a field
 * visit), present or absent, with its date and source.
 *
 * DOM- and network-free.
 */
import type { JsonObject } from '@/lib/jsonGuards'

export const SIGHTING_SOURCES = [
  'air-photo',
  'trim',
  'harvest',
  'pscis',
  'wayback',
  'sentinel-2',
  'landsat',
  'field',
] as const
export type SightingSource = (typeof SIGHTING_SOURCES)[number]
export const SIGHTING_SOURCE_LABELS: Record<SightingSource, string> = {
  'air-photo': 'Air photo',
  trim: 'TRIM base mapping',
  harvest: 'Harvest record',
  pscis: 'PSCIS survey',
  wayback: 'Esri Wayback',
  'sentinel-2': 'Sentinel-2',
  landsat: 'Landsat',
  field: 'Field visit',
}

export const SIGHTING_STATES = ['present', 'absent', 'unclear'] as const
export type SightingState = (typeof SIGHTING_STATES)[number]

export interface CrossingSighting {
  source: SightingSource
  /** The day the source saw the place, YYYY-MM-DD. */
  date: string
  state: SightingState
  /** A frame, release, scene, layer or survey id: what to open to check it. */
  reference?: string
  /** The picture's ground pixel size, metres, where it is a picture. */
  resolutionM?: number
  note?: string
  /** `read` when a reader added it; absent when the reviewer did. */
  by?: 'read'
}

/** FPPR §56(2) applies to a crossing built after this day. */
export const FPPR_56_2_CUTOFF = '1995-06-15'

/** The question that always goes with a dating: a structure can be newer than the road it is on. */
export const REPLACED_QUESTION =
  'Sightings date the road and its crossing, not the structure in it: was the structure replaced since? Only successive structure records or the road permit file can say.'

const label = (s: CrossingSighting) =>
  `${s.date} (${s.state}, ${SIGHTING_SOURCE_LABELS[s.source]}${s.reference ? ` ${s.reference}` : ''})`

export interface DatingBracket {
  /** The first sighting with the crossing there. */
  earliestPresent?: CrossingSighting
  /** The last sighting without it, before the first with it (or the last of all when it was never seen). */
  latestAbsent?: CrossingSighting
  /** Sightings without it dated after it was first seen: a removal, a replacement or a misreading. */
  contradictions: CrossingSighting[]
  /** "First seen between …", "Present by …", "Not seen as of …" or "No dated sighting". */
  text: string
}

const byDate = (a: CrossingSighting, b: CrossingSighting) => a.date.localeCompare(b.date)

/** The bracket the sightings give. Unclear sightings bracket nothing. */
export function datingBracket(sightings: readonly CrossingSighting[]): DatingBracket {
  const dated = [...sightings].sort(byDate)
  const present = dated.filter((s) => s.state === 'present')
  const earliestPresent = present[0]
  const absent = dated.filter((s) => s.state === 'absent')
  const before = earliestPresent ? absent.filter((s) => s.date < earliestPresent.date) : absent
  const latestAbsent = before.at(-1)
  const contradictions = earliestPresent ? absent.filter((s) => s.date >= earliestPresent.date) : []
  const text =
    earliestPresent && latestAbsent
      ? `First seen between ${latestAbsent.date} and ${earliestPresent.date}: absent ${label(latestAbsent)}, present ${label(earliestPresent)}.`
      : earliestPresent
        ? `Present by ${earliestPresent.date} (${SIGHTING_SOURCE_LABELS[earliestPresent.source]}${earliestPresent.reference ? ` ${earliestPresent.reference}` : ''}); no earlier sighting without it.`
        : latestAbsent
          ? `Not seen as of ${latestAbsent.date} (${SIGHTING_SOURCE_LABELS[latestAbsent.source]}${latestAbsent.reference ? ` ${latestAbsent.reference}` : ''}).`
          : 'No dated sighting.'
  return { earliestPresent, latestAbsent, contradictions, text }
}

export interface BuiltAfterCandidate {
  /** The value the sightings offer for `built-after-1995`, or null when they cannot say. */
  value: boolean | null
  reason: string
  /** Always asked beside it. */
  replaced: string
}

/**
 * The candidate for `bc.fppr-crossings`'s `built-after-1995`: No only if the crossing was first seen
 * before 15 June 1995; Yes only if it was not there on or after that day (the latest sighting without
 * it, before the first with it); otherwise unknown. Never the answer: a crossing seen in 1990 may
 * carry a pipe put in in 2010.
 */
export function builtAfter1995(sightings: readonly CrossingSighting[]): BuiltAfterCandidate {
  const { earliestPresent, latestAbsent } = datingBracket(sightings)
  if (earliestPresent && earliestPresent.date < FPPR_56_2_CUTOFF)
    return {
      value: false,
      reason: `Present by ${earliestPresent.date}, before ${FPPR_56_2_CUTOFF}.`,
      replaced: REPLACED_QUESTION,
    }
  if (latestAbsent && latestAbsent.date >= FPPR_56_2_CUTOFF)
    return {
      value: true,
      reason: `Not there on ${latestAbsent.date}, on or after ${FPPR_56_2_CUTOFF}.`,
      replaced: REPLACED_QUESTION,
    }
  return {
    value: null,
    reason: earliestPresent
      ? `First seen ${earliestPresent.date}, with no sighting without it on or after ${FPPR_56_2_CUTOFF}: it may have been there before.`
      : `No sighting puts it on either side of ${FPPR_56_2_CUTOFF}.`,
    replaced: REPLACED_QUESTION,
  }
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Sightings as far as they read; one that does not is left out. */
export function parseSightings(value: unknown): CrossingSighting[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 500).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const s = item as JsonObject
    if (!SIGHTING_SOURCES.includes(s.source as SightingSource)) return []
    if (!SIGHTING_STATES.includes(s.state as SightingState)) return []
    if (!isDay(s.date)) return []
    const out: CrossingSighting = {
      source: s.source as SightingSource,
      date: s.date,
      state: s.state as SightingState,
    }
    if (typeof s.reference === 'string' && s.reference.trim() && s.reference.length <= 500)
      out.reference = s.reference.trim()
    if (typeof s.resolutionM === 'number' && Number.isFinite(s.resolutionM) && s.resolutionM > 0 && s.resolutionM < 1e4)
      out.resolutionM = s.resolutionM
    if (typeof s.note === 'string' && s.note.trim() && s.note.length <= 2000) out.note = s.note.trim()
    if (s.by === 'read') out.by = 'read'
    return [out]
  })
}

const sightingKey = (s: CrossingSighting) => JSON.stringify([s.source, s.date, s.state, s.reference ?? ''])

/** Sightings joined, each once. */
export function mergeSightings(a: readonly CrossingSighting[], b: readonly CrossingSighting[]): CrossingSighting[] {
  const seen = new Set(a.map(sightingKey))
  return [...a, ...b.filter((s) => !seen.has(sightingKey(s)))].sort(byDate)
}

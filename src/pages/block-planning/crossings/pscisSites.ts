/**
 * Folding PSCIS records into crossing sites. PSCIS ids are not a site's identity: the same site was
 * given different crossing ids in 2013 and 2023, 4–12 m apart, and across Prince George, Mackenzie
 * and Stuart Nechako no id holds two visits. The rule here is the one tested on those districts'
 * 4,232 assessments ([Getting the records a harvested block's review lacks], section 3), nearest
 * pair first:
 *
 * 1. **Different mapped streams.** Two records on different `BLUE_LINE_KEY`s are never one site.
 * 2. **Same survey day.** Two records of one day are one site only within 5 m (twin structures);
 *    otherwise they are listed apart for the reviewer.
 * 3. **Different days.** Within 15 m they are one site; within 30 m too when both lie on the same
 *    `BLUE_LINE_KEY` with route measures within 10 m; and within 30 m too when both record the same
 *    structure (same type, diameter or span within 15% and 5 cm, `structureChange`) no farther apart
 *    than the longer recorded barrel length and 2 m: the two ends of one pipe, surveyed from either
 *    end on different visits (the back-test of 27 November 2026 found 2013 and 2023 surveys of
 *    16–20 m culverts 19.4–19.7 m apart, one of them on no mapped stream).
 * 4. **Day guard.** A join that would put two records of one day more than 5 m apart into one site
 *    is refused, and so is one that would put two mapped streams in one site.
 *
 * A record's mapped stream is the stream the caller found within 30 m of it, never one guessed from
 * farther away; a record without one joins by distance alone. Distances are metres on a local
 * plane (`geometry.ts`).
 *
 * DOM- and network-free.
 */
import { distanceM, type LonLat } from './geometry'

/**
 * The rule's distances, metres. Change them only with a new run over the districts' records. The
 * same-structure step was run on 27 November 2026 over the 7,242 PSCIS assessments between 127.5°
 * and 120° W and 53° and 57.5° N: of 55 different-day pairs 15–30 m apart it joins 20, and of 58
 * same-day pairs 15–30 m apart, which are distinct structures by construction, 3 would pass its test
 * (5%) against 31 (53%) for a matching structure alone. Those 3 stay apart by step 2.
 */
export const PSCIS_SITE_RULE = {
  /** Two records of one survey day within this are twin structures at one site. */
  twinM: 5,
  /** Two records of different days within this are one site. */
  nearM: 15,
  /** …or within this when on the same mapped stream, or recording the same structure, */
  sameStreamM: 30,
  /** …with route measures this close, */
  measureM: 10,
  /** …or no farther apart than the longer recorded barrel length and this. */
  lengthToleranceM: 2,
} as const

export interface SiteRecord {
  id: string
  point: LonLat
  /** The survey day, YYYY-MM-DD. */
  day?: string
  /** The mapped stream within `sameStreamM`, and the record's route measure on it. */
  blueLineKey?: number
  measureM?: number
  /** The structure the record surveyed, with its barrel length (`LENGTH_OR_WIDTH`), where it gives one. */
  structure?: StructureSeen & { lengthM?: number }
}

export type PairVerdict =
  | { join: true; reason: 'twin' | 'near' | 'same-stream' | 'same-structure' }
  | { join: false; reason: 'two-streams' | 'same-day' | 'far' }

/** Whether two records may be one site, by the rule's first three steps. */
export function pairVerdict(a: SiteRecord, b: SiteRecord, d = distanceM(a.point, b.point)): PairVerdict {
  if (a.blueLineKey !== undefined && b.blueLineKey !== undefined && a.blueLineKey !== b.blueLineKey)
    return { join: false, reason: 'two-streams' }
  if (a.day && b.day && a.day === b.day)
    return d <= PSCIS_SITE_RULE.twinM ? { join: true, reason: 'twin' } : { join: false, reason: 'same-day' }
  if (d <= PSCIS_SITE_RULE.nearM) return { join: true, reason: 'near' }
  if (
    d <= PSCIS_SITE_RULE.sameStreamM &&
    a.blueLineKey !== undefined &&
    a.blueLineKey === b.blueLineKey &&
    a.measureM !== undefined &&
    b.measureM !== undefined &&
    Math.abs(a.measureM - b.measureM) <= PSCIS_SITE_RULE.measureM
  )
    return { join: true, reason: 'same-stream' }
  if (d <= PSCIS_SITE_RULE.sameStreamM && sameBarrel(a.structure, b.structure, d))
    return { join: true, reason: 'same-structure' }
  return { join: false, reason: 'far' }
}

/**
 * Whether two surveys `d` metres apart record one barrel from its two ends: the same structure
 * (`structureChange` 'same', which needs a type and a size on both) and `d` no more than the longer
 * recorded length and `lengthToleranceM`. A record with no length never joins this way.
 */
export function sameBarrel(a: SiteRecord['structure'], b: SiteRecord['structure'], d: number): boolean {
  if (!a || !b || a.sizeM === undefined || b.sizeM === undefined) return false
  const length = Math.max(a.lengthM ?? 0, b.lengthM ?? 0)
  if (!(length > 0) || d > length + PSCIS_SITE_RULE.lengthToleranceM) return false
  const x = { type: a.type, sizeM: a.sizeM }
  const y = { type: b.type, sizeM: b.sizeM }
  // Both ways round, so the size test is taken on the smaller pipe.
  return structureChange(x, y) === 'same' && structureChange(y, x) === 'same'
}

/** Two groups' records may share a site: no two mapped streams, no two records of one day apart. */
function groupsCompatible(a: SiteRecord[], b: SiteRecord[]): 'ok' | 'two-streams' | 'day-guard' {
  for (const x of a)
    for (const y of b) {
      if (x.blueLineKey !== undefined && y.blueLineKey !== undefined && x.blueLineKey !== y.blueLineKey)
        return 'two-streams'
      if (x.day && x.day === y.day && distanceM(x.point, y.point) > PSCIS_SITE_RULE.twinM) return 'day-guard'
    }
  return 'ok'
}

export interface SiteFold<T extends SiteRecord = SiteRecord> {
  /** Each site's records, in the order given. */
  sites: T[][]
  /** Pairs within reach that the rule kept apart, nearest first, for the reviewer. */
  apart: { a: string; b: string; distanceM: number; reason: 'two-streams' | 'same-day' | 'day-guard' }[]
}

/**
 * Folds records into sites. Records that share an id are one site before the rule runs (the four
 * PSCIS stages of one crossing carry one `STREAM_CROSSING_ID`).
 */
export function foldSites<T extends SiteRecord>(records: T[], sameId: (r: T) => string = (r) => r.id): SiteFold<T> {
  const parent = records.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const members = (root: number) => records.filter((_, i) => find(i) === root)
  const byId = new Map<string, number>()
  records.forEach((r, i) => {
    const id = sameId(r)
    const first = byId.get(id)
    if (first === undefined) byId.set(id, i)
    else parent[find(i)] = find(first)
  })
  const pairs: { i: number; j: number; d: number }[] = []
  for (let i = 0; i < records.length; i++)
    for (let j = i + 1; j < records.length; j++) {
      const d = distanceM(records[i].point, records[j].point)
      if (d <= PSCIS_SITE_RULE.sameStreamM) pairs.push({ i, j, d })
    }
  pairs.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j)
  const apart: SiteFold['apart'] = []
  for (const { i, j, d } of pairs) {
    const ri = find(i)
    const rj = find(j)
    if (ri === rj) continue
    const verdict = pairVerdict(records[i], records[j], d)
    if (!verdict.join) {
      if (verdict.reason !== 'far')
        apart.push({ a: records[i].id, b: records[j].id, distanceM: d, reason: verdict.reason })
      continue
    }
    const fit = groupsCompatible(members(ri), members(rj))
    if (fit !== 'ok') {
      apart.push({ a: records[i].id, b: records[j].id, distanceM: d, reason: fit })
      continue
    }
    parent[rj] = ri
  }
  const groups = new Map<number, T[]>()
  records.forEach((r, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), r])
  })
  return { sites: [...groups.values()], apart }
}

export interface StructureSeen {
  day?: string
  /** `CBS` closed-bottom or `OBS` open-bottom, as PSCIS codes it, or a kind word. */
  type?: string
  /** Diameter or span, metres. */
  sizeM?: number
}

/**
 * What two successive structure records at one site say: the same structure (same type, size
 * within 15% and 5 cm), a likely replacement (a larger pipe or an open-bottom structure three or more
 * years later), or a difference with no stated reason, which the reviewer is shown.
 */
export function structureChange(
  earlier: StructureSeen,
  later: StructureSeen,
): 'same' | 'replaced' | 'differs' | 'unknown' {
  if (!earlier.type || !later.type) return 'unknown'
  const years = earlier.day && later.day ? (Date.parse(later.day) - Date.parse(earlier.day)) / (365.25 * 86_400_000) : 0
  const sameSize =
    earlier.sizeM !== undefined &&
    later.sizeM !== undefined &&
    Math.abs(later.sizeM - earlier.sizeM) <= 0.15 * earlier.sizeM + 0.05
  if (earlier.type === later.type && (sameSize || earlier.sizeM === undefined || later.sizeM === undefined))
    return 'same'
  const bigger = earlier.sizeM !== undefined && later.sizeM !== undefined && later.sizeM > earlier.sizeM
  const opened = earlier.type === 'CBS' && later.type === 'OBS'
  if (years >= 3 && (opened || (earlier.type === later.type && bigger))) return 'replaced'
  return 'differs'
}

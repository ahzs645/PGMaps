/**
 * Finds several mapped roads on the terrain at once and reconnects them. Each road is searched
 * exactly as **Find on terrain** searches it alone (`findRoadOnTerrainSteps` with the same input),
 * one after another in one cooperative run, so Cancel and the progress line work and a road's
 * result does not depend on which others were searched with it. The found roads are then joined
 * where their records were joined (`roadReconnect.ts`).
 *
 * Every result is a candidate copy: the records are never edited, a road's state class is dated
 * evidence and never a condition, and a road that fails is reported in its own row by name rather
 * than dropped (the reference tool dropped it and named the wrong road).
 *
 * Follows Roussel, Bourdon, Morley, Coops & Achim (2022), doi:10.1016/j.jag.2022.103020, for each
 * road, and the network reconnection of the ALSroads user guide (Morley 2022) and Roussel et al.
 * (2023), doi:10.1016/j.jag.2023.103267. Written from a functional specification of ALSroads
 * 0.2.0; no code from ALSroads (GPL-3) was used. Pure: no DOM or network access.
 */
import { cumulativeLength, lineLength, pointAlong, type XY } from './roadGrid'
import { reconnectRoads, type ReconnectResult } from './roadReconnect'
import {
  findRoadOnTerrainSteps,
  type RoadFindInput,
  type RoadFindProgress,
  type RoadFindResult,
} from './roadRelocation'

/** At most this many roads are searched in one run. */
export const ROAD_BATCH_MAX_ROADS = 25
/** At most this much road, summed, is searched in one run, m. */
export const ROAD_BATCH_MAX_TOTAL_M = 25_000
/** A road is in the area, and on the terrain, when this share of points sampled along it are. */
export const ROAD_BATCH_MIN_INSIDE = 0.5
/** Roads are sampled every this many metres to test the area and the terrain. */
export const ROAD_BATCH_SAMPLE_M = 10

export interface BatchRoad {
  id: string
  name: string
  /** The record's line, projected metres. */
  line: XY[]
}

export interface BatchSelection {
  /** The roads to search, in the order given, within the caps. */
  chosen: BatchRoad[]
  /** In the area and on the terrain, but over a cap; in the order given. */
  overCap: BatchRoad[]
  /** Outside the area or off the terrain. */
  outside: number
}

/** Share of points every ROAD_BATCH_SAMPLE_M along the line for which `test` holds. */
export function shareAlong(line: readonly XY[], test: (p: XY) => boolean): number {
  const cum = cumulativeLength(line)
  const total = cum.at(-1) ?? 0
  const n = Math.max(1, Math.ceil(total / ROAD_BATCH_SAMPLE_M))
  let hits = 0
  for (let i = 0; i <= n; i++) if (test(pointAlong(line, cum, (total * i) / n).at)) hits++
  return hits / (n + 1)
}

/**
 * The roads to search: those with at least ROAD_BATCH_MIN_INSIDE of their length in the area and on
 * the terrain, in the order given, up to ROAD_BATCH_MAX_ROADS roads and ROAD_BATCH_MAX_TOTAL_M.
 */
export function selectBatchRoads(
  roads: readonly BatchRoad[],
  inArea: (p: XY) => boolean,
  onTerrain: (p: XY) => boolean,
): BatchSelection {
  const chosen: BatchRoad[] = [],
    overCap: BatchRoad[] = []
  let outside = 0,
    total = 0
  for (const road of roads) {
    if (road.line.length < 2 || shareAlong(road.line, (p) => inArea(p) && onTerrain(p)) < ROAD_BATCH_MIN_INSIDE) {
      outside++
      continue
    }
    const length = lineLength(road.line)
    if (chosen.length >= ROAD_BATCH_MAX_ROADS || total + length > ROAD_BATCH_MAX_TOTAL_M) overCap.push(road)
    else {
      chosen.push(road)
      total += length
    }
  }
  return { chosen, overCap, outside }
}

/** Even-odd test of a point against polygon rings (outer first, holes after). */
export function insidePolygon(rings: readonly XY[][], p: XY): boolean {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j]
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
    }
  return inside
}

export interface BatchFindInput extends Omit<RoadFindInput, 'line'> {
  roads: BatchRoad[]
}

export interface BatchFindProgress {
  /** 1-based index of the road being searched. */
  road: number
  roads: number
  name: string
  step: RoadFindProgress | null
}

export interface BatchRow {
  id: string
  name: string
  /** The record's line, unchanged. */
  record: XY[]
  /** The road's own search result; null when it failed, with `error` saying why. */
  result: RoadFindResult | null
  error: string | null
}

/** Whether a search result offers a candidate to adopt (found along at least the partial share). */
export const offersCandidate = (result: RoadFindResult | null) =>
  !!result && (result.status === 'found' || result.status === 'partial')

/** Searches each road in turn, exactly as alone. A road that throws is reported in its row. */
export function* findRoadsOnTerrainSteps(input: BatchFindInput): Generator<BatchFindProgress, BatchRow[]> {
  const { roads, ...shared } = input
  const rows: BatchRow[] = []
  for (let k = 0; k < roads.length; k++) {
    const road = roads[k]
    const progress = { road: k + 1, roads: roads.length, name: road.name }
    yield { ...progress, step: null }
    try {
      const steps = findRoadOnTerrainSteps({ ...shared, line: road.line })
      let next = steps.next()
      while (!next.done) {
        yield { ...progress, step: next.value }
        next = steps.next()
      }
      rows.push({ id: road.id, name: road.name, record: road.line, result: next.value, error: null })
    } catch (cause) {
      rows.push({
        id: road.id,
        name: road.name,
        record: road.line,
        result: null,
        error: `${road.name}: ${cause instanceof Error ? cause.message : 'the search failed'}`,
      })
    }
  }
  return rows
}

/**
 * Reconnects the chosen rows' candidates where their records met. Rows not chosen, or with no
 * candidate, keep their record lines and never move; `fixed` are other mapped roads the record
 * network joins, kept as they are.
 */
export function reconnectBatch(
  rows: readonly BatchRow[],
  chosen: ReadonlySet<string>,
  toleranceM: number,
  fixed: readonly BatchRoad[] = [],
): ReconnectResult {
  return reconnectRoads(
    [
      ...rows.map((row) => ({
        id: row.id,
        name: row.name,
        record: row.record,
        candidate: chosen.has(row.id) && offersCandidate(row.result) ? row.result!.candidate : null,
        stateClass: row.result?.state?.stateClass ?? null,
        score: row.result?.state?.score ?? null,
        foundShare: row.result?.foundShare ?? null,
      })),
      ...fixed
        .filter((road) => !rows.some((row) => row.id === road.id))
        .map((road) => ({ id: road.id, name: road.name, record: road.line, candidate: null })),
    ],
    { toleranceM },
  )
}

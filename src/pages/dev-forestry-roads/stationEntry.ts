/**
 * A chainage typed as the road's station name. A road with a start station or station equations
 * (`roadStationing.ts`) shows and takes its own station names in every range and station field
 * (template, ground, haul, grade and widening ranges, haul sites, vertical controls); a road without
 * them shows chainage in metres, exactly as before. The field always stores chainage.
 *
 * A typed name goes where `resolveTypedStation` puts it: its place on the road, the occurrence
 * nearest the field's own value when an equation repeats a name, else the nearest end or equation.
 * Leaving a field with the name it shows changes nothing, so a round trip through the display never
 * moves a stored chainage by a rounding error.
 *
 * Pure: no DOM or network access.
 */
import {
  hasStationing,
  MAX_ROAD_STATION_M,
  resolveTypedStation,
  stationAtChainage,
  type RoadStationing,
} from './roadStationing'

/** A typed name this close to the one shown is the one shown: the field rounds to 6 decimals. */
const SAME_STATION_M = 1e-6

export interface StationEntry {
  /** True when the road names its stations: the field shows station names. */
  named: boolean
  /**
   * `Assignment 1 start` → `Assignment 1 start (station)` on a named road, else `… (m)`; a name
   * that already says station (`Site 1 station`) stays as it is on a named road.
   */
  label(base: string): string
  /** The number the field shows for a stored chainage. */
  show(chainage: number): number
  /** The chainage a typed number stores; `current` is the field's stored chainage. */
  take(typed: number, current: number | null): number
  /** The field's limits, on a named road; null keeps the field's own. */
  limits: { min: number; max: number } | null
}

/** How a station or range field of a road of `length` reads and writes, by its stationing. */
export function stationEntry(stationing: RoadStationing | null | undefined, length: number): StationEntry {
  if (!hasStationing(stationing) || !(length >= 0))
    return {
      named: false,
      label: (base) => `${base} (m)`,
      show: (chainage) => chainage,
      take: (typed) => typed,
      limits: null,
    }
  const show = (chainage: number) => stationAtChainage(chainage, stationing)
  return {
    named: true,
    label: (base) => (/\bstation\b/i.test(base) ? base : `${base} (station)`),
    show,
    take(typed, current) {
      if (current !== null && Number.isFinite(current)) {
        const shown = show(current)
        if (Math.abs(typed - shown) <= SAME_STATION_M) return current
      }
      return resolveTypedStation(typed, stationing, length, current === null ? {} : { near: current }).chainage
    },
    limits: { min: -MAX_ROAD_STATION_M, max: MAX_ROAD_STATION_M },
  }
}

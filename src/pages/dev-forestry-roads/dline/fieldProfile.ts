/**
 * A field-measured ground profile for one D-line: shots a layout crew takes along the skyline
 * (station and elevation, or slope distance and slope percent from a known start), used in place
 * of the terrain along that D-line when the user turns it on, and compared with the terrain.
 *
 * Shots are stationed horizontally from the yarder, as support layouts are. Between two shots the
 * ground is interpolated linearly; outside the first and last shot, and more than
 * `FIELD_PROFILE_CORRIDOR_M` off the line, the terrain is read as before. Pure: no DOM or network.
 */
import type { CableLine, Coordinate, TerrainSource } from '../types'
import { dLineFrame } from './frame'

/** Most shots on one D-line. */
export const MAX_FIELD_SHOTS = 500
/** Stations allowed, m from the yarder: behind it to its anchor, out past the far end to its anchor. */
export const FIELD_STATION_RANGE_M: readonly [number, number] = [-200, 3200]
/** Elevations allowed, m. */
export const FIELD_ELEVATION_RANGE_M: readonly [number, number] = [-500, 9000]
/** Slope distance allowed per leg, m. */
export const FIELD_SLOPE_DISTANCE_RANGE_M: readonly [number, number] = [0.1, 1000]
/** Slope allowed per leg, %; 300 % is 71.6°. */
export const FIELD_SLOPE_PERCENT_RANGE: readonly [number, number] = [-300, 300]
/** A position within this distance of the D-line reads the field profile, m. */
export const FIELD_PROFILE_CORRIDOR_M = 2
/** A field shot this far from the terrain is flagged, m. */
export const FIELD_DIFFERENCE_FLAG_M = 2
/** Longest note kept with a field profile, characters. */
export const MAX_FIELD_NOTE = 500

export interface FieldShot {
  /** Horizontal distance from the yarder, m. */
  stationM: number
  elevationM: number
}
export interface FieldLeg {
  /** Measured along the slope, m. */
  slopeDistanceM: number
  /** Rise over run, %, positive uphill going out from the yarder. */
  slopePercent: number
}

export type CableFieldProfile = {
  /** Read in place of the terrain along this D-line. Off keeps the shots without using them. */
  use: boolean
  note?: string
} & (
  | { method: 'station-elevation'; shots: FieldShot[] }
  | { method: 'slope'; startStationM: number; startElevationM: number; legs: FieldLeg[] }
)

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const within = (v: unknown, [low, high]: readonly [number, number]) => isNumber(v) && v >= low && v <= high

/** Slope legs chained from a start: each leg's horizontal run and rise. */
export function reduceSlopeLegs(startStationM: number, startElevationM: number, legs: readonly FieldLeg[]) {
  const shots: FieldShot[] = [{ stationM: startStationM, elevationM: startElevationM }]
  for (const leg of legs) {
    const grade = leg.slopePercent / 100
    const run = leg.slopeDistanceM / Math.sqrt(1 + grade * grade)
    const last = shots.at(-1)!
    shots.push({ stationM: last.stationM + run, elevationM: last.elevationM + run * grade })
  }
  return shots
}

/** The profile's shots by station, whichever way they were entered. */
export function fieldShots(profile: CableFieldProfile): FieldShot[] {
  return profile.method === 'slope'
    ? reduceSlopeLegs(profile.startStationM, profile.startElevationM, profile.legs)
    : profile.shots
}

/** Every reason the profile cannot be used, in the form's words. Empty when it can. */
export function fieldProfileErrors(profile: CableFieldProfile): string[] {
  const errors: string[] = []
  if (profile.note !== undefined && (typeof profile.note !== 'string' || profile.note.length > MAX_FIELD_NOTE))
    errors.push(`The note must be text of at most ${MAX_FIELD_NOTE} characters.`)
  if (profile.method === 'slope') {
    if (!Array.isArray(profile.legs) || profile.legs.length < 1 || profile.legs.length >= MAX_FIELD_SHOTS)
      errors.push(`Enter 1 to ${MAX_FIELD_SHOTS - 1} slope legs.`)
    if (!within(profile.startStationM, FIELD_STATION_RANGE_M))
      errors.push(`The start station must be between ${FIELD_STATION_RANGE_M[0]} and ${FIELD_STATION_RANGE_M[1]} m.`)
    if (!within(profile.startElevationM, FIELD_ELEVATION_RANGE_M))
      errors.push(
        `The start elevation must be between ${FIELD_ELEVATION_RANGE_M[0]} and ${FIELD_ELEVATION_RANGE_M[1]} m.`,
      )
    for (const leg of Array.isArray(profile.legs) ? profile.legs : []) {
      if (!within(leg?.slopeDistanceM, FIELD_SLOPE_DISTANCE_RANGE_M))
        errors.push(
          `Each slope distance must be between ${FIELD_SLOPE_DISTANCE_RANGE_M[0]} and ${FIELD_SLOPE_DISTANCE_RANGE_M[1]} m.`,
        )
      if (!within(leg?.slopePercent, FIELD_SLOPE_PERCENT_RANGE))
        errors.push(`Each slope must be between ${FIELD_SLOPE_PERCENT_RANGE[0]} and ${FIELD_SLOPE_PERCENT_RANGE[1]} %.`)
    }
  } else if (profile.method === 'station-elevation') {
    if (!Array.isArray(profile.shots) || profile.shots.length < 2 || profile.shots.length > MAX_FIELD_SHOTS)
      errors.push(`Enter 2 to ${MAX_FIELD_SHOTS} shots.`)
  } else errors.push('Choose station and elevation, or slope distance and slope.')
  if (errors.length) return [...new Set(errors)]
  const shots = fieldShots(profile)
  for (const [i, shot] of shots.entries()) {
    if (!within(shot?.stationM, FIELD_STATION_RANGE_M))
      errors.push(`Each station must be between ${FIELD_STATION_RANGE_M[0]} and ${FIELD_STATION_RANGE_M[1]} m.`)
    if (!within(shot?.elevationM, FIELD_ELEVATION_RANGE_M))
      errors.push(`Each elevation must be between ${FIELD_ELEVATION_RANGE_M[0]} and ${FIELD_ELEVATION_RANGE_M[1]} m.`)
    if (i > 0 && isNumber(shot?.stationM) && !(shot.stationM > shots[i - 1].stationM))
      errors.push('Stations must run forwards from the yarder, each past the one before.')
  }
  return [...new Set(errors)]
}

/** Reads a saved field profile, refusing out-of-range values. */
export function parseFieldProfile(raw: unknown): CableFieldProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('D-line field profile must be an object.')
  const r = raw as Record<string, unknown>
  if (typeof r.use !== 'boolean') throw Error('D-line field profile: say whether it is used.')
  const list = (value: unknown, label: string) => {
    if (!Array.isArray(value) || value.length > MAX_FIELD_SHOTS)
      throw Error(`D-line field profile: ${label} must be a list of at most ${MAX_FIELD_SHOTS}.`)
    return value.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}))
  }
  const note = r.note === undefined ? {} : { note: r.note as string }
  const profile: CableFieldProfile =
    r.method === 'slope'
      ? {
          use: r.use,
          ...note,
          method: 'slope',
          startStationM: r.startStationM as number,
          startElevationM: r.startElevationM as number,
          legs: list(r.legs, 'slope legs').map((o) => ({
            slopeDistanceM: o.slopeDistanceM as number,
            slopePercent: o.slopePercent as number,
          })),
        }
      : r.method === 'station-elevation'
        ? {
            use: r.use,
            ...note,
            method: 'station-elevation',
            shots: list(r.shots, 'shots').map((o) => ({
              stationM: o.stationM as number,
              elevationM: o.elevationM as number,
            })),
          }
        : (() => {
            throw Error('D-line field profile: choose station-elevation or slope.')
          })()
  const errors = fieldProfileErrors(profile)
  if (errors.length) throw Error(`D-line field profile: ${errors[0]}`)
  return profile
}

/**
 * Pasted or imported field notes as rows of two numbers: station and elevation, or slope distance
 * and slope %. Commas, tabs, semicolons or spaces separate them; a header line, blank lines and
 * `#` comments are skipped. Throws the first row it cannot read, by its line number.
 */
export function parseFieldRows(text: string): [number, number][] {
  const rows: [number, number][] = []
  const lines = text.split(/\r?\n/)
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const cells = line.split(/[,;\t ]+/).filter(Boolean)
    const values = cells.map((cell) => Number(cell.replace(/%$/, '')))
    if (cells.length < 2 || values.slice(0, 2).some((v) => !Number.isFinite(v))) {
      // A first line of words is a header.
      if (!rows.length && values.every((v) => !Number.isFinite(v))) continue
      throw Error(`Line ${i + 1}: enter two numbers.`)
    }
    rows.push([values[0], values[1]])
    if (rows.length > MAX_FIELD_SHOTS) throw Error(`At most ${MAX_FIELD_SHOTS} rows.`)
  }
  return rows
}

/** A station this close outside the first or last shot reads that shot, m (rounding at the line's ends). */
export const FIELD_END_TOLERANCE_M = 0.05

/** Linear interpolation on shots sorted by station; null outside them. */
export function fieldElevationAt(shots: readonly FieldShot[], stationM: number): number | null {
  if (shots.length < 2) return null
  const first = shots[0].stationM,
    last = shots.at(-1)!.stationM
  if (stationM < first - FIELD_END_TOLERANCE_M || stationM > last + FIELD_END_TOLERANCE_M) return null
  stationM = Math.max(first, Math.min(last, stationM))
  let lo = 0,
    hi = shots.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (shots[mid].stationM <= stationM) lo = mid
    else hi = mid
  }
  const a = shots[lo],
    b = shots[hi]
  const t = b.stationM > a.stationM ? (stationM - a.stationM) / (b.stationM - a.stationM) : 0
  return a.elevationM + (b.elevationM - a.elevationM) * t
}

/** The D-line's field profile when it is on and usable, else null. */
export function activeFieldShots(line: CableLine): FieldShot[] | null {
  const profile = line.fieldProfile
  if (!profile?.use || fieldProfileErrors(profile).length) return null
  return fieldShots(profile)
}

const sources = new WeakMap<TerrainSource, WeakMap<object, TerrainSource>>()

/**
 * The ground this D-line reads: its field profile along the line where it has shots, the terrain
 * elsewhere. The same object comes back for the same terrain and profile, so a support layout's
 * result stays current across renders (`layoutKey` keys terrain by identity).
 */
export function cableGroundSource(line: CableLine, terrain: TerrainSource): TerrainSource {
  const profile = line.fieldProfile
  const shots = activeFieldShots(line)
  if (!profile || !shots) return terrain
  const frame = dLineFrame(line)
  if (!frame) return terrain
  // Keyed by the profile and the line's ends: moving the line re-stations the shots.
  const key = `${frame.yarder.join(',')}|${frame.far.join(',')}`
  let byProfile = sources.get(terrain)
  if (!byProfile) sources.set(terrain, (byProfile = new WeakMap()))
  const cached = byProfile.get(profile) as (TerrainSource & { key?: string }) | undefined
  if (cached?.key === key) return cached
  const source: TerrainSource & { key: string } = {
    key,
    elevationAt(lng, lat) {
      const { stationM, offsetM } = frame.stationOf([lng, lat] as Coordinate)
      if (Math.abs(offsetM) <= FIELD_PROFILE_CORRIDOR_M) {
        const z = fieldElevationAt(shots, stationM)
        if (z !== null) return z
      }
      return terrain.elevationAt(lng, lat)
    },
  }
  byProfile.set(profile, source)
  return source
}

export interface FieldComparisonRow extends FieldShot {
  /** Terrain under the shot, or null where it is unknown. */
  terrainM: number | null
  /** Field minus terrain, m. */
  differenceM: number | null
  flagged: boolean
}
export interface FieldComparison {
  rows: FieldComparisonRow[]
  /** Shots with a terrain value to compare. */
  compared: number
  meanDifferenceM: number | null
  rmsDifferenceM: number | null
  /** Largest difference by size, signed, and where. */
  largestDifferenceM: number | null
  largestAtM: number | null
  flagged: number
  /** Stations the shots cover, and the D-line's own 0 to length. */
  coveredFromM: number
  coveredToM: number
  lengthM: number
  /** True when the shots run from the yarder to the far end. */
  coversLine: boolean
}

/** Each shot against the terrain under it, with the differences summarised. */
export function compareFieldProfile(line: CableLine, terrain: TerrainSource): FieldComparison | null {
  const profile = line.fieldProfile
  const frame = dLineFrame(line)
  if (!profile || !frame || fieldProfileErrors(profile).length) return null
  const shots = fieldShots(profile)
  const rows = shots.map((shot): FieldComparisonRow => {
    const z = terrain.elevationAt(...frame.at(shot.stationM))
    const terrainM = Number.isFinite(z) ? z : null
    const differenceM = terrainM === null ? null : shot.elevationM - terrainM
    return {
      ...shot,
      terrainM,
      differenceM,
      flagged: differenceM !== null && Math.abs(differenceM) > FIELD_DIFFERENCE_FLAG_M,
    }
  })
  const known = rows.filter((row) => row.differenceM !== null)
  const largest = known.reduce<FieldComparisonRow | null>(
    (best, row) => (!best || Math.abs(row.differenceM!) > Math.abs(best.differenceM!) ? row : best),
    null,
  )
  const coveredFromM = shots[0].stationM,
    coveredToM = shots.at(-1)!.stationM
  return {
    rows,
    compared: known.length,
    meanDifferenceM: known.length ? known.reduce((s, r) => s + r.differenceM!, 0) / known.length : null,
    rmsDifferenceM: known.length ? Math.sqrt(known.reduce((s, r) => s + r.differenceM! ** 2, 0) / known.length) : null,
    largestDifferenceM: largest?.differenceM ?? null,
    largestAtM: largest?.stationM ?? null,
    flagged: rows.filter((row) => row.flagged).length,
    coveredFromM,
    coveredToM,
    lengthM: frame.lengthM,
    coversLine: coveredFromM <= 0.5 && coveredToM >= frame.lengthM - 0.5,
  }
}

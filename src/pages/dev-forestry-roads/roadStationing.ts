/**
 * A road's stationing: the station at its start and its station equations. PGMaps measures a road
 * by chainage from 0 at its first point; the stationing only renames those chainages for people.
 * Every calculation, stored range and project field stays in chainage.
 *
 * - The **calculated chain** is `startStation + chainage`, as in LandXML (`staStart`, and
 *   `StaEquation@staInternal`) and Softree's traverses (`stationEquations.ts`). A road read from a
 *   file measured on its grid keeps the file's stations exactly: `chainageScale` (road chainage ÷
 *   file stations, the import's `stationScale`) makes the chain `startStation + chainage ÷ scale`.
 * - A **station equation** at calculated station `back` names the stations from there on from
 *   `ahead`: ahead plus the distance since, or ahead minus it when `decreasing` (LandXML's
 *   `staIncrement="decreasing"`). At the equation itself the ahead name wins.
 * - An equation that names a station already used (a back equation, ahead below the back name)
 *   makes that name occur twice. A label is then followed by the region it lies in, `(2)` for the
 *   stretch after the first equation, and a typed station goes to the occurrence nearest the
 *   selected one ({@link chainageAtStation}).
 *
 * A road without stationing (`undefined`, or start 0 with no equations) labels its stations exactly
 * as before: `0+123.4` from its chainage, never below `0+000.0`.
 *
 * **Which stationing a bare label follows.** Many labels take only a chainage. They read
 * {@link activeStationing}: the stationing a caller set for the duration of a synchronous call
 * ({@link withStationing}: an export, a report or an analysis of one road), else the road on screen
 * ({@link setScreenStationing}, set by the page as it renders, cleared for a terrain profile). An
 * export of a road therefore wraps its writer in `withStationing(road.stationing, …)`, and never
 * relies on the screen's.
 *
 * Checked by `roadStationing.test.ts`. No DOM or network access.
 */
import { MAX_STATION_EQUATIONS, type StationEquation } from './stationEquations'

/** Station equations a road holds at most (a traverse's limit). */
export const MAX_ROAD_STATION_EQUATIONS = MAX_STATION_EQUATIONS
/** Largest start or equation station, m. */
export const MAX_ROAD_STATION_M = 10_000_000
/** Characters of an equation's description (LandXML `desc`). */
export const MAX_STATION_EQUATION_TEXT = 200
/** Back stations of two equations at least this far apart, m. */
export const MIN_STATION_EQUATION_GAP_M = 0.001

export interface RoadStationEquation extends StationEquation {
  /** Stations fall from `ahead` beyond this equation (LandXML `staIncrement="decreasing"`). */
  decreasing?: true
  description?: string
}

export interface RoadStationing {
  /** The station at chainage 0, m. */
  startStation: number
  /**
   * Road chainage per metre of the calculated chain, when the stations are a design file's measured
   * on its grid (`landXmlImport.ts`): absent is 1, stations measured along the road.
   */
  chainageScale?: number
  /** In increasing `back` order; each `back` is on the calculated chain (start station + chainage). */
  equations: RoadStationEquation[]
}

/** True when the stationing renames any station: a start other than 0 or an equation. */
export function hasStationing(s: RoadStationing | null | undefined): s is RoadStationing {
  return !!s && (Math.abs(s.startStation) > 1e-9 || s.equations.length > 0)
}

/** Index of the region a calculated station lies in: 0 before the first equation, k after the k-th. */
function regionOfCalculated(calculated: number, equations: readonly RoadStationEquation[]): number {
  let region = 0
  equations.forEach((e, k) => {
    if (e.back <= calculated + 1e-9) region = k + 1
  })
  return region
}

/** The station a reader sees at `chainage`. */
export function stationAtChainage(chainage: number, s: RoadStationing | null | undefined): number {
  if (!hasStationing(s)) return chainage
  const calculated = calculatedAt(chainage, s)
  const region = regionOfCalculated(calculated, s.equations)
  if (!region) return calculated
  const e = s.equations[region - 1]
  return e.decreasing ? e.ahead - (calculated - e.back) : e.ahead + (calculated - e.back)
}

/** The region (0 before the first equation) the station at `chainage` belongs to. */
export function stationRegionAt(chainage: number, s: RoadStationing | null | undefined): number {
  return hasStationing(s) ? regionOfCalculated(calculatedAt(chainage, s), s.equations) : 0
}

/**
 * Every chainage on a road of `length` that carries `station`, in order along the road. Without
 * stationing it is the station itself when it lies on the road.
 */
export function chainagesAtStation(station: number, s: RoadStationing | null | undefined, length: number): number[] {
  if (!Number.isFinite(station)) return []
  const tol = 1e-6
  if (!hasStationing(s)) return station >= -tol && station <= length + tol ? [station] : []
  const out: number[] = []
  const regions = [{ back: s.startStation, ahead: s.startStation, decreasing: undefined }, ...s.equations]
  const end = calculatedAt(length, s)
  regions.forEach((e, k) => {
    const from = e.back
    const to = Math.min(end, s.equations[k]?.back ?? end)
    const calculated = e.decreasing ? e.back + (e.ahead - station) : e.back + (station - e.ahead)
    const last = k === regions.length - 1 || to >= end - tol
    if (calculated >= from - tol && (last ? calculated <= to + tol : calculated < to - tol))
      out.push(Math.max(0, Math.min(length, (calculated - s.startStation) * scaleOf(s))))
  })
  return out
}

/**
 * The chainage a typed station names: the occurrence nearest `near` (the station selected now) when
 * an equation makes the name occur twice, else the only one. `region` (1 for the stretch before
 * the first equation) picks one explicitly. Null when the station is not on the road.
 */
export function chainageAtStation(
  station: number,
  s: RoadStationing | null | undefined,
  length: number,
  options: { near?: number; region?: number } = {},
): number | null {
  const all = chainagesAtStation(station, s, length)
  if (!all.length) return null
  if (options.region !== undefined) {
    const inRegion = all.find((c) => stationRegionAt(c, s) + 1 === options.region)
    if (inRegion !== undefined) return inRegion
  }
  const near = options.near
  if (near === undefined || !Number.isFinite(near)) return all[0]
  return all.reduce((best, c) => (Math.abs(c - near) < Math.abs(best - near) ? c : best), all[0])
}

/**
 * Where a typed station goes: its chainage when the road carries it (`exact`), else the place whose
 * station is nearest: the start, the end, or either side of the equation that skips it.
 */
export function resolveTypedStation(
  station: number,
  s: RoadStationing | null | undefined,
  length: number,
  options: { near?: number; region?: number } = {},
): { chainage: number; exact: boolean } {
  const found = chainageAtStation(station, s, length, options)
  if (found !== null) return { chainage: found, exact: true }
  const candidates = [0, length]
  if (hasStationing(s))
    for (const e of s.equations) {
      const c = equationChainage(e, s)
      if (c > 0 && c < length) candidates.push(Math.max(0, c - 1e-6), c)
    }
  let best = candidates[0]
  for (const c of candidates)
    if (Math.abs(stationAtChainage(c, s) - station) < Math.abs(stationAtChainage(best, s) - station)) best = c
  return { chainage: Math.max(0, Math.min(length, best)), exact: false }
}

/** The station names a road of `length` runs between: its lowest and highest. */
export function stationExtent(s: RoadStationing | null | undefined, length: number): { min: number; max: number } {
  if (!hasStationing(s)) return { min: 0, max: length }
  const values = [stationAtChainage(0, s), stationAtChainage(length, s)]
  for (const e of s.equations) {
    const c = equationChainage(e, s)
    if (c < 0 || c > length) continue
    values.push(e.ahead, stationAtChainage(Math.max(0, c - 1e-6), s))
  }
  return { min: Math.min(...values), max: Math.max(...values) }
}

/** A station as `1+234.5`: thousands, then metres to `decimals` places; a negative one as `−0+012.0`. */
export function formatStationValue(station: number, decimals = 1): string {
  const scale = 10 ** decimals
  const rounded = Math.round(Math.abs(station) * scale) / scale
  const whole = Math.floor(rounded / 1000 + 1e-9)
  const rest = Math.max(0, rounded - whole * 1000)
  const sign = station < 0 && rounded > 0 ? '−' : ''
  return `${sign}${whole}+${rest.toFixed(decimals).padStart(decimals ? 4 + decimals : 3, '0')}`
}

/**
 * The label of the station at `chainage`. Without stationing it is exactly the chainage label used
 * before stationing existed (never below `0+000.0`). With it, the station name, followed by its
 * region `(n)` where an equation makes the name occur more than once.
 */
export function formatStationLabel(chainage: number, s: RoadStationing | null | undefined, decimals = 1): string {
  if (!hasStationing(s)) return formatStationValue(Math.max(0, chainage), decimals)
  const station = stationAtChainage(chainage, s)
  const text = formatStationValue(station, decimals)
  return isAmbiguous(station, s) ? `${text} (${stationRegionAt(chainage, s) + 1})` : text
}

/** True when an equation makes `station` name more than one place on an endless road. */
function isAmbiguous(station: number, s: RoadStationing): boolean {
  return s.equations.length > 0 && chainagesAtStation(station, s, Number.MAX_SAFE_INTEGER / 4).length > 1
}

/**
 * A station typed as `1+234.5`, `1234.5`, `−0+012` or with a region `0+550 (2)`. Null when the text
 * is not a station.
 */
export function parseStationText(text: string): { station: number; region?: number } | null {
  const t = text.trim().replace(/−/g, '-')
  const m = /^(-)?\s*(?:(\d+)\s*\+\s*(\d+(?:\.\d*)?|\.\d+)|(\d+(?:\.\d*)?|\.\d+))\s*(?:\(\s*(\d+)\s*\))?$/.exec(t)
  if (!m) return null
  const value = m[4] !== undefined ? Number(m[4]) : Number(m[2]) * 1000 + Number(m[3])
  if (!Number.isFinite(value)) return null
  const station = m[1] ? -value : value
  return m[5] !== undefined ? { station, region: Number(m[5]) } : { station }
}

/**
 * Throws unless the stationing is usable: finite stations within ±{@link MAX_ROAD_STATION_M} m, at
 * most {@link MAX_ROAD_STATION_EQUATIONS} equations in increasing back-station order, each after
 * the start station and, given the road's `length`, on the road.
 */
export function checkRoadStationing(s: RoadStationing, length?: number) {
  const finite = (v: number) => Number.isFinite(v) && Math.abs(v) <= MAX_ROAD_STATION_M
  if (
    s.chainageScale !== undefined &&
    !(Number.isFinite(s.chainageScale) && s.chainageScale >= 0.5 && s.chainageScale <= 2)
  )
    throw Error('A road’s chainage per station must be between 0.5 and 2.')
  if (!finite(s.startStation))
    throw Error(`The start station must be a number within ±${MAX_ROAD_STATION_M.toLocaleString('en-CA')} m.`)
  if (s.equations.length > MAX_ROAD_STATION_EQUATIONS)
    throw Error(`A road holds at most ${MAX_ROAD_STATION_EQUATIONS} station equations.`)
  let last = s.startStation
  s.equations.forEach((e, k) => {
    if (!finite(e.back) || !finite(e.ahead)) throw Error(`Station equation ${k + 1} needs a back and an ahead station.`)
    if (e.back < last + MIN_STATION_EQUATION_GAP_M - 1e-9)
      throw Error(
        k === 0
          ? 'The first station equation must come after the start station.'
          : 'Station equations must run along the road, one per place.',
      )
    if (length !== undefined && e.back > calculatedAt(length, s) + 1e-6)
      throw Error(`Station equation ${k + 1} is past the road's end.`)
    if (e.description !== undefined && e.description.length > MAX_STATION_EQUATION_TEXT)
      throw Error(`A station equation's description takes at most ${MAX_STATION_EQUATION_TEXT} characters.`)
    last = e.back
  })
}

/** A road's stationing from a project file: refused, never repaired, when malformed. */
export function parseRoadStationing(raw: unknown): RoadStationing {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('A road’s stationing must be an object.')
  const r = raw as Record<string, unknown>
  if (typeof r.startStation !== 'number') throw Error('A road’s stationing needs a start station.')
  if (!Array.isArray(r.equations)) throw Error('A road’s station equations must be a list.')
  const equations = r.equations.map((rawEquation, k): RoadStationEquation => {
    if (!rawEquation || typeof rawEquation !== 'object') throw Error(`Station equation ${k + 1} is not valid.`)
    const e = rawEquation as Record<string, unknown>
    if (typeof e.back !== 'number' || typeof e.ahead !== 'number')
      throw Error(`Station equation ${k + 1} needs a back and an ahead station.`)
    if (e.decreasing !== undefined && e.decreasing !== true)
      throw Error(`Station equation ${k + 1} has an invalid direction.`)
    if (e.description !== undefined && typeof e.description !== 'string')
      throw Error(`Station equation ${k + 1} has an invalid description.`)
    return {
      back: e.back,
      ahead: e.ahead,
      ...(e.decreasing ? { decreasing: true as const } : {}),
      ...(e.description ? { description: e.description } : {}),
    }
  })
  if (r.chainageScale !== undefined && typeof r.chainageScale !== 'number')
    throw Error('A road’s chainage per station must be a number.')
  const result: RoadStationing = {
    startStation: r.startStation,
    ...(r.chainageScale === undefined ? {} : { chainageScale: r.chainageScale }),
    equations,
  }
  checkRoadStationing(result)
  return result
}

/** The stationing to keep on a road: undefined when it renames nothing, so the road stays as before. */
export function keptStationing(s: RoadStationing | null | undefined): RoadStationing | undefined {
  return hasStationing(s)
    ? {
        startStation: s.startStation,
        ...(s.chainageScale !== undefined ? { chainageScale: s.chainageScale } : {}),
        equations: s.equations.map((e) => ({ ...e })),
      }
    : undefined
}

/** The chainage of an equation on the road. */
export const equationChainage = (
  e: Pick<StationEquation, 'back'>,
  s: Pick<RoadStationing, 'startStation' | 'chainageScale'>,
) => (e.back - s.startStation) * scaleOf(s)

/** The calculated chain at a chainage: start station plus chainage ÷ the scale. */
export const calculatedAt = (chainage: number, s: Pick<RoadStationing, 'startStation' | 'chainageScale'>) =>
  s.startStation + chainage / scaleOf(s)

const scaleOf = (s: Pick<RoadStationing, 'chainageScale'>) => s.chainageScale ?? 1

/**
 * One line naming an equation the way a station table or report prints it:
 * `0+500.0 back = 0+600.0 ahead`.
 */
export function describeStationEquation(e: RoadStationEquation, s: RoadStationing, decimals = 1): string {
  const back = stationAtChainage(Math.max(0, equationChainage(e, s) - 1e-6), s)
  return `${formatStationValue(back, decimals)} back = ${formatStationValue(e.ahead, decimals)} ahead${
    e.decreasing ? ', decreasing' : ''
  }`
}

/**
 * One sentence on a road's stationing, as reports print it: its start and end stations and each
 * equation with the distance along the road it stands at.
 */
export function stationingSummary(s: RoadStationing, length: number): string {
  const parts = [
    `Stations run from ${formatStationLabel(0, s)} to ${formatStationLabel(length, s)} over ${length.toFixed(1)} m.`,
  ]
  const on = s.equations.filter((e) => equationChainage(e, s) <= length + 1e-6)
  if (on.length)
    parts.push(
      `Station equation${on.length === 1 ? '' : 's'}: ${on
        .map(
          (e) =>
            `${describeStationEquation(e, s)} at ${equationChainage(e, s).toFixed(1)} m${e.description ? ` (${e.description})` : ''}`,
        )
        .join('; ')}.`,
    )
  return parts.join(' ')
}

/**
 * The stationing of stations read from a file whose stations are `factor` road chainage each (the
 * import's `stationScale`): the file's names stay exactly, each equation at its place on the road.
 */
export function scaleStationing(s: RoadStationing, factor: number): RoadStationing {
  const chainageScale = scaleOf(s) * factor
  return {
    startStation: s.startStation,
    ...(Math.abs(chainageScale - 1) > 1e-12 ? { chainageScale } : {}),
    equations: s.equations.map((e) => ({ ...e })),
  }
}

// ─── which stationing bare labels follow ───────────────────────────────────────────────────────

const UNSET = Symbol('unset')
let scoped: RoadStationing | undefined | typeof UNSET = UNSET
let screen: RoadStationing | undefined

/** Sets the stationing screen labels follow: the road on screen's, or none for a terrain profile. */
export function setScreenStationing(stationing: RoadStationing | null | undefined) {
  screen = hasStationing(stationing) ? stationing : undefined
}

/**
 * Runs `run` with bare labels following `stationing` (none: chainage), whatever the screen shows.
 * Synchronous only: the stationing is restored when `run` returns or throws.
 */
export function withStationing<T>(stationing: RoadStationing | null | undefined, run: () => T): T {
  const previous = scoped
  scoped = hasStationing(stationing) ? stationing : undefined
  try {
    return run()
  } finally {
    scoped = previous
  }
}

/** The stationing a bare label follows now: the scoped one, else the screen's. */
export function activeStationing(): RoadStationing | undefined {
  return scoped === UNSET ? screen : scoped
}

/** The label of the station at `chainage` under the {@link activeStationing}. */
export function labelStation(chainage: number, decimals = 1): string {
  return formatStationLabel(chainage, activeStationing(), decimals)
}

/**
 * Time of concentration for a culvert's catchment, read from its longest D8 flow path on the
 * routed design surface (`hydrology.ts`, `flowPathProfile`), and the IDF intensity at that
 * duration (`idfCurve.ts`). An option of the drainage check, off by default: with it off every
 * culvert keeps the one design intensity.
 *
 * - Kirpich (1940), metric form: Tc = 0.0195 · L^0.77 · S^−0.385, Tc in minutes, L the longest
 *   flow path in metres, S its slope in m/m (TxDOT Hydraulic Design Manual, ch. 4 §11: K = 0.0078
 *   with L in feet, 0.0195 with L in metres). Kirpich fitted it to seven small agricultural
 *   catchments in Tennessee, 1.2–112 acres (0.49–45.3 ha) with well-defined channels and slopes of
 *   3–10 % (Chow, Maidment & Mays, Applied Hydrology, 1988, Table 15.1.2). A catchment outside
 *   that range is flagged, never silently accepted.
 * - The slope is one of:
 *   - `10-85`: (z at 85 % of L − z at 10 % of L, both from the outlet) / 0.75 L — Benson (1962),
 *     USGS Water-Supply Paper 1580-B; it leaves out the steep head and flat outlet ends.
 *   - `equal-area`: the slope of the line through the outlet that has the same area under it as
 *     the profile, S = 2·∫(z − z₀) dx / L² (Australian Rainfall and Runoff, 1987, Book IV).
 *   - `end-to-end`: total fall over L, the slope Kirpich's own data used.
 * - The profile is read on a moving mean of `groundWindowFor(cellM)` metres along the path (12 m
 *   on cells of 3 m or finer, none on coarser cells), the window the route searches judge grades
 *   on (`groundTrend.ts`): a 1 m DTM carries stump holes and windthrow mounds no flow path
 *   follows. All three slopes are chords or areas over most of the path, so the mean moves them
 *   little; it keeps one pit at the 10 % or 85 % point from setting the 10–85 slope.
 * - A minimum Tc (5 min by default): FHWA HEC-22 (Urban Drainage Design Manual, 3rd ed., 2009)
 *   recommends 5 minutes as the least time of concentration, and 5 minutes is ECCC's shortest
 *   published IDF duration, so a shorter one would be read off the curve's end.
 *
 * Pure: no DOM or network access.
 */
import { groundWindowFor } from './groundTrend'
import { idfIntensity, idfLabel, parseIdfCurve, type IdfCurve, type IdfFlag } from './idfCurve'

export type SlopeMethod = '10-85' | 'equal-area' | 'end-to-end'
export const SLOPE_METHODS: readonly SlopeMethod[] = ['10-85', 'equal-area', 'end-to-end']

export interface ConcentrationSettings {
  /** Off: one design intensity for every culvert, exactly as without this block. */
  enabled: boolean
  slopeMethod: SlopeMethod
  /** Least Tc used, min. */
  minimumTcMin: number
  idf?: IdfCurve
}

/** Kirpich's metric coefficient (minutes, metres). */
export const KIRPICH_K_METRIC = 0.0195
/** The range of Kirpich's own catchments: 1.2–112 acres, slopes 3–10 %. */
export const KIRPICH_MIN_AREA_HA = 0.49
export const KIRPICH_MAX_AREA_HA = 45.3
export const KIRPICH_MIN_SLOPE = 0.03
export const KIRPICH_MAX_SLOPE = 0.1
/** HEC-22's recommended least Tc, and ECCC's shortest duration, min. */
export const DEFAULT_MINIMUM_TC_MIN = 5
export const MIN_TC_LIMITS = { min: 1, max: 60 } as const
/** A path slope below this (0.1 %) has no measurable fall: the minimum Tc is used, not Kirpich. */
export const MIN_MEASURABLE_SLOPE = 0.001

export const DEFAULT_CONCENTRATION_SETTINGS: ConcentrationSettings = {
  enabled: false,
  slopeMethod: '10-85',
  minimumTcMin: DEFAULT_MINIMUM_TC_MIN,
}

export type TimingFlag =
  | 'area-below-kirpich'
  | 'area-above-kirpich'
  | 'slope-below-kirpich'
  | 'slope-above-kirpich'
  | 'no-measurable-slope'
  | 'minimum-tc'
  | IdfFlag

/** What a culvert's own intensity was read from; every figure that prints Tc prints these. */
export interface CulvertTiming {
  /** Longest flow path to the culvert's outlet cell on the design surface, m. */
  pathLengthM: number
  /** Path slope by `slopeMethod`, m/m; null when the path is one cell. */
  pathSlope: number | null
  slopeMethod: SlopeMethod
  /** Moving-mean window the profile was read on, m (0: none). */
  smoothingWindowM: number
  /** Kirpich's Tc before the minimum, min; null without a measurable slope. */
  kirpichTcMin: number | null
  /** The Tc used: Kirpich's, or the minimum, min. */
  tcMin: number
  intensityMmPerHr: number
  /** The duration the IDF was read at (the end of the curve when Tc lies beyond it), min. */
  idfReadAtMin: number
  returnPeriodYears: number
  /** `idfLabel` of the curve: station, return period, form and source. */
  idf: string
  flags: TimingFlag[]
}

/** Distances from the outlet (0) up the path, and the elevation at each. */
export interface PathProfile {
  distanceM: number[]
  elevationM: number[]
}

export const kirpichTcMin = (lengthM: number, slope: number) => KIRPICH_K_METRIC * lengthM ** 0.77 * slope ** -0.385

/**
 * A centred moving mean of the profile over `windowM` of path distance; 0 returns it unchanged.
 * Near either end the window shrinks to stay centred, so a straight profile is left exactly as it
 * is (a one-sided window would bend it at the outlet, where the 10 % point of a short path lies).
 */
export function smoothProfile(profile: PathProfile, windowM: number): PathProfile {
  const { distanceM: d, elevationM: z } = profile
  if (!(windowM > 0) || d.length < 3) return profile
  const first = d[0],
    last = d[d.length - 1],
    out: number[] = []
  for (let k = 0; k < d.length; k++) {
    const half = Math.min(windowM / 2, d[k] - first, last - d[k])
    let sum = z[k],
      count = 1
    for (let j = k - 1; j >= 0 && d[j] >= d[k] - half; j--) {
      sum += z[j]
      count++
    }
    for (let j = k + 1; j < d.length && d[j] <= d[k] + half; j++) {
      sum += z[j]
      count++
    }
    out.push(sum / count)
  }
  return { distanceM: d, elevationM: out }
}

/** Elevation at `x` metres from the outlet, linear between profile points. */
export function elevationAt(profile: PathProfile, x: number): number {
  const { distanceM: d, elevationM: z } = profile
  if (x <= d[0]) return z[0]
  if (x >= d[d.length - 1]) return z[z.length - 1]
  let k = 1
  while (d[k] < x) k++
  const f = (x - d[k - 1]) / (d[k] - d[k - 1])
  return z[k - 1] + f * (z[k] - z[k - 1])
}

/** The path's slope by `method`, m/m; null for a path without length. */
export function profileSlope(profile: PathProfile, method: SlopeMethod): number | null {
  const { distanceM: d, elevationM: z } = profile
  const L = d.length ? d[d.length - 1] : 0
  if (!(L > 0)) return null
  if (method === 'end-to-end') return (z[z.length - 1] - z[0]) / L
  if (method === '10-85') return (elevationAt(profile, 0.85 * L) - elevationAt(profile, 0.1 * L)) / (0.75 * L)
  // Equal-area: S = 2A / L², A the area between the profile and the outlet's level (trapezoids).
  let area = 0
  for (let k = 1; k < d.length; k++) area += ((z[k] - z[0] + z[k - 1] - z[0]) / 2) * (d[k] - d[k - 1])
  return (2 * area) / (L * L)
}

/**
 * One culvert's Tc and intensity from its catchment area, its longest flow path and the profile
 * along it. Every reason the figure is outside its formula's footing goes in `flags`.
 */
export function culvertTiming({
  areaHa,
  pathLengthM,
  profile,
  cellM,
  settings,
  idf,
}: {
  areaHa: number
  pathLengthM: number
  profile: PathProfile
  cellM: number
  settings: Pick<ConcentrationSettings, 'slopeMethod' | 'minimumTcMin'>
  idf: IdfCurve
}): CulvertTiming {
  const flags: TimingFlag[] = []
  const smoothingWindowM = groundWindowFor(cellM)
  const pathSlope = profileSlope(smoothProfile(profile, smoothingWindowM), settings.slopeMethod)
  if (areaHa < KIRPICH_MIN_AREA_HA) flags.push('area-below-kirpich')
  if (areaHa > KIRPICH_MAX_AREA_HA) flags.push('area-above-kirpich')
  let kirpich: number | null = null
  if (pathSlope === null || !(pathSlope >= MIN_MEASURABLE_SLOPE)) flags.push('no-measurable-slope')
  else {
    if (pathSlope < KIRPICH_MIN_SLOPE) flags.push('slope-below-kirpich')
    if (pathSlope > KIRPICH_MAX_SLOPE) flags.push('slope-above-kirpich')
    kirpich = kirpichTcMin(pathLengthM, pathSlope)
  }
  const tcMin = kirpich === null ? settings.minimumTcMin : Math.max(kirpich, settings.minimumTcMin)
  if (kirpich !== null && kirpich < settings.minimumTcMin) flags.push('minimum-tc')
  const reading = idfIntensity(idf, tcMin)
  if (reading.flag) flags.push(reading.flag)
  return {
    pathLengthM,
    pathSlope,
    slopeMethod: settings.slopeMethod,
    smoothingWindowM,
    kirpichTcMin: kirpich,
    tcMin,
    intensityMmPerHr: reading.intensityMmPerHr,
    idfReadAtMin: reading.readAtMin,
    returnPeriodYears: idf.returnPeriodYears,
    idf: idfLabel(idf),
    flags,
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)} %`
/** A sentence per flag, for the run's warnings and the report. */
export function timingFlagText(flag: TimingFlag, t: CulvertTiming, areaHa: number): string {
  switch (flag) {
    case 'area-below-kirpich':
    case 'area-above-kirpich':
      return `catchment ${areaHa.toFixed(2)} ha is outside Kirpich's ${KIRPICH_MIN_AREA_HA}–${KIRPICH_MAX_AREA_HA} ha range, so its Tc is extrapolated`
    case 'slope-below-kirpich':
    case 'slope-above-kirpich':
      return `flow-path slope ${pct(t.pathSlope ?? 0)} (${t.slopeMethod}) is outside Kirpich's ${pct(KIRPICH_MIN_SLOPE)}–${pct(KIRPICH_MAX_SLOPE)} range, so its Tc is extrapolated`
    case 'no-measurable-slope':
      return `the flow path has no measurable fall (under ${pct(MIN_MEASURABLE_SLOPE)}), so the minimum Tc of ${t.tcMin} min was used instead of Kirpich`
    case 'minimum-tc':
      return `Kirpich gives ${t.kirpichTcMin!.toFixed(1)} min, under the ${t.tcMin} min minimum, which was used`
    case 'below-idf':
      return `Tc ${t.tcMin.toFixed(1)} min is shorter than the IDF curve, so the intensity was read at its shortest duration (${t.idfReadAtMin} min)`
    case 'above-idf':
      return `Tc ${t.tcMin.toFixed(1)} min is longer than the IDF curve, so the intensity was read at its longest duration (${t.idfReadAtMin} min), which overstates it`
  }
}

/** Parses the project's `drainage.settings.concentration` by hand; absent stays absent. */
export function parseConcentrationSettings(value: unknown): ConcentrationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Time of concentration settings must be an object.')
  const r = value as Record<string, unknown>
  if (typeof r.enabled !== 'boolean') throw Error('Time of concentration needs on or off.')
  if (!SLOPE_METHODS.includes(r.slopeMethod as SlopeMethod)) throw Error('Choose a flow-path slope method.')
  const minimum = r.minimumTcMin
  if (
    typeof minimum !== 'number' ||
    !Number.isFinite(minimum) ||
    minimum < MIN_TC_LIMITS.min ||
    minimum > MIN_TC_LIMITS.max
  )
    throw Error(`The minimum time of concentration must be between ${MIN_TC_LIMITS.min} and ${MIN_TC_LIMITS.max} min.`)
  return {
    enabled: r.enabled,
    slopeMethod: r.slopeMethod as SlopeMethod,
    minimumTcMin: minimum,
    ...(r.idf === undefined ? {} : { idf: parseIdfCurve(r.idf) }),
  }
}

/** The settings a run applies: on and with a curve, else none (one intensity for every culvert). */
export function activeConcentration(
  value: ConcentrationSettings | undefined,
): (ConcentrationSettings & { idf: IdfCurve }) | undefined {
  if (!value?.enabled) return undefined
  if (!value.idf) throw Error('Per-culvert intensity is on but no IDF curve is entered. Enter or import one.')
  return value as ConcentrationSettings & { idf: IdfCurve }
}

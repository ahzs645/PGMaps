import { analyzeSkylineSpan, heightAlong, MAX_MECHANICS_SPAN_M, riggingErrors } from './cableMechanics'
import type { CableRigging } from './cableMechanics'
import { offsetCoordinate } from './engine'
import { MAX_RADIAL_RADIUS_M, MAX_RADIAL_SPOKES } from './radialDeflection'
import type { CableLine, Coordinate, TerrainSource } from './types'

/**
 * Maximum-reach radial search from a landing: along each bearing, the farthest tailhold (up to a
 * cap) for which a single-span skyline clears the ground. It closes the gap the fixed-radius fan
 * in `radialDeflection.ts` leaves: that fan tests one radius, this finds each bearing's reach.
 *
 * Each bearing's ground is sampled once out to the cap. Tailholds are tried from the cap inward at
 * a fixed step on those same samples, so no candidate makes a terrain query of its own, and the
 * first that clears is the reach. A line clears when every sample between the supports is at least
 * the minimum clearance below the cable: the assumed parabolic sag (the D-line model), or with
 * rigging the loaded carriage path and the allowable tension (`cableMechanics.ts`).
 *
 * Unknown ground stops a bearing as unknown. Tailholds beyond the gap cannot be tested, so the
 * reach is not known; the farthest line that clears before the gap is reported separately as a
 * lower bound and never as the reach.
 *
 * Pure: no DOM or network access. The search is a generator so a page can run it in slices.
 */

/** Ground samples per bearing; spacing widens past 2 m only for caps over 2 km. */
export const MAX_REACH_SAMPLES = 1001
/** Finest sample spacing along a bearing, m. */
export const MIN_REACH_SPACING_M = 2

export interface ReachSettings {
  startBearingDeg: number
  sweepDeg: number
  bearingStepDeg: number
  yarderHeightM: number
  tailholdHeightM: number
  /** Assumed sag, % of span; unused with rigging. */
  deflectionPercent: number
  minimumClearanceM: number
  /** Shortest line worth reporting, m. */
  minLengthM: number
  /** Farthest tailhold tried, m. */
  maxLengthM: number
  /** Distance between tried tailholds, m. */
  candidateStepM: number
}

export const DEFAULT_REACH_SETTINGS: ReachSettings = {
  startBearingDeg: 0,
  sweepDeg: 360,
  bearingStepDeg: 15,
  yarderHeightM: 18,
  tailholdHeightM: 8,
  deflectionPercent: 3,
  minimumClearanceM: 1,
  minLengthM: 50,
  maxLengthM: 600,
  candidateStepM: 10,
}

/** Why a bearing's reach stops where it does. */
export type ReachLimit =
  /** The line at the cap clears: the real reach may be farther. */
  | 'max-length'
  /** The next tailhold out does not clear the ground. */
  | 'clearance'
  /** The next tailhold out cannot carry the load within the allowable tension. */
  | 'tension'
  /** Ground is unknown before the cap; tailholds beyond it were not tested. */
  | 'unknown-terrain'

export interface ReachSpoke {
  id: string
  bearingDeg: number
  /** Farthest tailhold that clears; null when none clears or the reach is unknown. */
  reachM: number | null
  /** With unknown ground: the farthest line that clears before the gap, a lower bound. */
  knownFeasibleM: number | null
  /** First distance whose ground is unknown; null when the whole bearing is known. */
  unknownFromM: number | null
  limitedBy: ReachLimit
  status: 'clear' | 'conflict' | 'unknown'
  /** Minimum clearance of the line to the reach (or to the lower bound). */
  minClearanceM: number | null
  /** A D-line to the reach (or to the lower bound) on this bearing; null when there is none. */
  line: CableLine | null
}

export interface ReachResult {
  center: Coordinate
  settings: ReachSettings
  /** Present when the search used rope mechanics. */
  rigging: CableRigging | null
  effectiveStepDeg: number
  sampleSpacingM: number
  spokes: ReachSpoke[]
  /** Spoke ends in bearing order; spokes without a line contribute the landing. */
  envelope: Coordinate[]
  warnings: string[]
}

export interface ReachProgress {
  done: number
  total: number
}

function bounded(value: number, name: string, low: number, high: number): number {
  if (!Number.isFinite(value) || value < low || value > high)
    throw new Error(`${name} must be between ${low} and ${high}.`)
  return value
}
const wrap = (degrees: number) => ((degrees % 360) + 360) % 360

/** Validates the settings, refusing combinations that cannot produce a line. */
export function validReachSettings(settings: ReachSettings): ReachSettings {
  const s: ReachSettings = {
    startBearingDeg: bounded(settings.startBearingDeg, 'Start bearing (degrees)', 0, 360),
    sweepDeg: bounded(settings.sweepDeg, 'Bearing sweep (degrees)', 0, 360),
    bearingStepDeg: bounded(settings.bearingStepDeg, 'Bearing step (degrees)', 1, 180),
    yarderHeightM: bounded(settings.yarderHeightM, 'Yarder height (m)', 0, 100),
    tailholdHeightM: bounded(settings.tailholdHeightM, 'Tailhold height (m)', 0, 100),
    deflectionPercent: bounded(settings.deflectionPercent, 'Assumed sag (%)', 0, 30),
    minimumClearanceM: bounded(settings.minimumClearanceM, 'Minimum clearance (m)', 0, 100),
    minLengthM: bounded(settings.minLengthM, 'Shortest line (m)', 10, MAX_RADIAL_RADIUS_M),
    maxLengthM: bounded(settings.maxLengthM, 'Farthest tailhold (m)', 10, MAX_RADIAL_RADIUS_M),
    candidateStepM: bounded(settings.candidateStepM, 'Tailhold step (m)', 2, 100),
  }
  if (s.minLengthM > s.maxLengthM) throw new Error('The shortest line must not be longer than the farthest tailhold.')
  return s
}

type Test = { ok: true; minClearance: number } | { ok: false; reason: 'clearance' | 'tension' }

/**
 * The reach search, one bearing at a time. Yields after each tried tailhold so a caller can slice
 * it; `runCooperatively` drives it in the page and `runToCompletion` in tests.
 */
export function* maxReachSteps(
  center: Coordinate,
  terrain: TerrainSource,
  input: ReachSettings,
  rigging: CableRigging | null = null,
): Generator<ReachProgress, ReachResult> {
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    !center.every(Number.isFinite) ||
    Math.abs(center[0]) > 180 ||
    Math.abs(center[1]) >= 85
  )
    throw new Error('The landing must use valid WGS84 coordinates between latitudes −85° and 85°.')
  const s = validReachSettings(input)
  // The radial panel has one clearance field; rope mechanics checks against it too.
  const rope = rigging ? { ...rigging, minClearanceM: s.minimumClearanceM } : null
  if (rope) {
    const errors = riggingErrors(rope)
    if (errors.length) throw new Error(errors[0])
    if (s.maxLengthM > MAX_MECHANICS_SPAN_M)
      throw new Error(`Rope mechanics solve spans up to ${MAX_MECHANICS_SPAN_M} m.`)
  }
  const fullCircle = s.sweepDeg === 360
  const requested = s.sweepDeg === 0 ? 1 : Math.ceil(s.sweepDeg / s.bearingStepDeg) + (fullCircle ? 0 : 1)
  const count = Math.min(MAX_RADIAL_SPOKES, requested)
  const effectiveStepDeg =
    requested > MAX_RADIAL_SPOKES ? s.sweepDeg / (fullCircle ? count : count - 1) : s.bearingStepDeg
  const warnings =
    requested > MAX_RADIAL_SPOKES
      ? [
          `Bearing spacing increased to ${effectiveStepDeg.toFixed(2)}° to keep the run within ${MAX_RADIAL_SPOKES} spokes.`,
        ]
      : []
  const intervals = Math.max(1, Math.ceil(s.maxLengthM / MIN_REACH_SPACING_M))
  const n = Math.min(MAX_REACH_SAMPLES - 1, intervals)
  const spacing = s.maxLengthM / n
  const stride = Math.max(1, Math.round(s.candidateStepM / spacing))
  const distances = Array.from({ length: n + 1 }, (_, i) => (s.maxLengthM * i) / n)
  const firstCandidate = Math.ceil(s.minLengthM / spacing - 1e-9)

  const spokes: ReachSpoke[] = []
  for (let index = 0; index < count; index++) {
    const delta = fullCircle ? index * effectiveStepDeg : Math.min(s.sweepDeg, index * effectiveStepDeg)
    const bearingDeg = wrap(s.startBearingDeg + delta)
    const ground: number[] = []
    let unknownAt = -1
    for (let i = 0; i <= n; i++) {
      const value = terrain.elevationAt(...offsetCoordinate(center, bearingDeg, distances[i]))
      if (!Number.isFinite(value)) {
        unknownAt = i
        break
      }
      ground.push(value)
    }
    const known = unknownAt < 0 ? n : unknownAt - 1
    const test = (j: number): Test => {
      const length = distances[j]
      const a = ground[0] + s.yarderHeightM,
        b = ground[j] + s.tailholdHeightM
      // The loaded rope always hangs below the chord, so a chord that does not clear never will.
      for (let i = 1; i < j; i++) {
        const t = distances[i] / length
        if (a + (b - a) * t - ground[i] < s.minimumClearanceM - 1e-7) return { ok: false, reason: 'clearance' }
      }
      let cableAt: (i: number) => number
      if (rope) {
        const solved = analyzeSkylineSpan({ horizontalM: length, verticalM: b - a }, rope)
        if (!solved.ok || !solved.result.tensionOk) return { ok: false, reason: 'tension' }
        const path = solved.result.loadPath.map((p) => ({ x: p.x, z: p.z }))
        cableAt = (i) => a + heightAlong(path, distances[i])!
      } else {
        const sag = (s.deflectionPercent / 100) * length
        cableAt = (i) => {
          const t = distances[i] / length
          return a + (b - a) * t - 4 * sag * t * (1 - t)
        }
      }
      let min = Math.min(s.yarderHeightM, s.tailholdHeightM)
      for (let i = 1; i < j; i++) {
        const clearance = cableAt(i) - ground[i]
        if (clearance < s.minimumClearanceM - 1e-7) return { ok: false, reason: 'clearance' }
        min = Math.min(min, clearance)
      }
      return { ok: true, minClearance: min }
    }
    // Tailholds from the cap (or the last known ground) inward, on the candidate stride from the cap.
    let found: { j: number; minClearance: number } | null = null
    let beyond: 'clearance' | 'tension' | null = null
    const top = known === n ? n : n - stride * Math.ceil((n - known) / stride)
    for (let j = top; j >= Math.max(1, firstCandidate); j -= stride) {
      const result = test(j)
      yield { done: index, total: count }
      if (result.ok) {
        found = { j, minClearance: result.minClearance }
        break
      }
      beyond = result.reason
    }
    const unknownFromM = unknownAt < 0 ? null : distances[unknownAt]
    const reachM = found && unknownAt < 0 ? distances[found.j] : null
    const lineTo = (j: number): CableLine => ({
      id: `reach-spoke-${index + 1}`,
      name: `Landing reach ${bearingDeg.toFixed(1)}° · ${distances[j].toFixed(0)} m`,
      start: [...center],
      end: offsetCoordinate(center, bearingDeg, distances[j]),
      startHeight: s.yarderHeightM,
      endHeight: s.tailholdHeightM,
      deflectionPercent: s.deflectionPercent,
      ...(rope ? { sagModel: 'mechanics' as const, rigging: rope } : {}),
    })
    spokes.push({
      id: `reach-spoke-${index + 1}`,
      bearingDeg,
      reachM,
      knownFeasibleM: found && unknownAt >= 0 ? distances[found.j] : null,
      unknownFromM,
      limitedBy: unknownAt >= 0 ? 'unknown-terrain' : found?.j === n ? 'max-length' : (beyond ?? 'clearance'),
      status: unknownAt >= 0 ? 'unknown' : found ? 'clear' : 'conflict',
      minClearanceM: found ? found.minClearance : null,
      line: found ? lineTo(found.j) : null,
    })
  }
  const envelope = spokes.map((spoke) => (spoke.line ? spoke.line.end : ([...center] as Coordinate)))
  if (fullCircle && envelope.length > 2) envelope.push(envelope[0])
  else {
    // A partial fan is a sector: close it through the landing.
    envelope.unshift([...center])
    envelope.push([...center])
  }
  return {
    center: [...center],
    settings: s,
    rigging: rope,
    effectiveStepDeg,
    sampleSpacingM: spacing,
    spokes,
    envelope,
    warnings,
  }
}

export const REACH_COLORS: Record<ReachSpoke['status'], string> = {
  clear: '#15803d',
  conflict: '#dc2626',
  unknown: '#6b7280',
}

export const REACH_LIMIT_TEXT: Record<ReachLimit, string> = {
  'max-length': 'Farthest tailhold tried',
  clearance: 'Clearance',
  tension: 'Tension',
  'unknown-terrain': 'Unknown terrain',
}

/** Temporary map overlay: each spoke to its reach and the envelope through the spoke ends. */
export function maxReachGeoJson(result: ReachResult, selectedSpokeId?: string | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  features.push({
    type: 'Feature',
    id: 'reach-envelope',
    properties: {
      kind: 'radial-reach-envelope',
      color: '#7c3aed',
      // Unknown bearings contribute their lower bound or the landing, never a reach.
      lower_bound_spokes: result.spokes.filter((spoke) => spoke.status === 'unknown').length,
      model: result.rigging ? 'rope mechanics load path' : 'assumed-sag geometric screen',
    },
    geometry: { type: 'LineString', coordinates: result.envelope },
  })
  for (const spoke of result.spokes) {
    if (!spoke.line) continue
    features.push({
      type: 'Feature',
      id: spoke.id,
      properties: {
        kind: 'radial-spoke',
        spokeId: spoke.id,
        label: `${spoke.bearingDeg.toFixed(1)}°`,
        color: REACH_COLORS[spoke.status],
        selected: spoke.id === selectedSpokeId,
        status: spoke.status,
        reach_m: spoke.reachM,
        known_feasible_m: spoke.knownFeasibleM,
        limited_by: spoke.limitedBy,
        bearing_deg: spoke.bearingDeg,
      },
      geometry: { type: 'LineString', coordinates: [spoke.line.start, spoke.line.end] },
    })
  }
  features.push({
    type: 'Feature',
    id: 'radial-landing',
    properties: { kind: 'radial-center', label: 'Landing', color: '#7c3aed' },
    geometry: { type: 'Point', coordinates: result.center },
  })
  return { type: 'FeatureCollection', features }
}

/** Per-bearing table as CSV, with the settings and model on every row. */
export function maxReachCsv(result: ReachResult): string {
  const s = result.settings
  const cell = (value: string | number | null) =>
    value === null
      ? ''
      : typeof value === 'number'
        ? String(Number(value.toFixed(3)))
        : `"${value.replace(/"/g, '""')}"`
  const header = [
    'bearing_deg',
    'status',
    'reach_m',
    'known_feasible_m',
    'unknown_from_m',
    'limited_by',
    'min_clearance_m',
    'tailhold_longitude',
    'tailhold_latitude',
    'landing_longitude',
    'landing_latitude',
    'yarder_height_m',
    'tailhold_height_m',
    'minimum_clearance_m',
    'farthest_tailhold_m',
    'tailhold_step_m',
    'sample_spacing_m',
    'sag_model',
    'assumptions',
  ]
  const model = result.rigging
    ? `rope mechanics (${result.rigging.tensionMode} tension, ${result.rigging.payloadKg + result.rigging.carriageKg} kg load)`
    : `assumed sag ${s.deflectionPercent}% of span`
  const assumptions =
    'Single span from the landing; reach is the farthest tried tailhold whose line clears every ground sample. ' +
    'Unknown ground stops a bearing: known_feasible_m is a lower bound, not the reach. ' +
    'No lateral yarding, side-slope, intermediate supports, anchors or equipment rating. Not a safe operating area.'
  const rows = result.spokes.map((spoke) =>
    [
      spoke.bearingDeg,
      spoke.status,
      spoke.reachM,
      spoke.knownFeasibleM,
      spoke.unknownFromM,
      spoke.limitedBy,
      spoke.minClearanceM,
      spoke.line?.end[0] ?? null,
      spoke.line?.end[1] ?? null,
      result.center[0],
      result.center[1],
      s.yarderHeightM,
      s.tailholdHeightM,
      s.minimumClearanceM,
      s.maxLengthM,
      s.candidateStepM,
      result.sampleSpacingM,
      model,
      assumptions,
    ]
      .map(cell)
      .join(','),
  )
  return [header.join(','), ...rows].join('\r\n') + '\r\n'
}

import { analyzeCable, offsetCoordinate } from './engine'
import type { CableAnalysis, CableLine, Coordinate, TerrainSource } from './types'

export const MAX_RADIAL_SPOKES = 72
export const MAX_RADIAL_RADIUS_M = 2000

export interface RadialDeflectionSettings {
  radiusM: number
  startBearingDeg: number
  sweepDeg: number
  bearingStepDeg: number
  yarderHeightM: number
  tailholdHeightM: number
  deflectionPercent: number
  minimumClearanceM: number
}

export const DEFAULT_RADIAL_SETTINGS: RadialDeflectionSettings = {
  radiusM: 250,
  startBearingDeg: 0,
  sweepDeg: 360,
  bearingStepDeg: 15,
  yarderHeightM: 18,
  tailholdHeightM: 8,
  deflectionPercent: 3,
  minimumClearanceM: 1,
}

export type RadialStatus = 'clear' | 'conflict' | 'unknown'
export interface RadialSpoke {
  id: string
  bearingDeg: number
  line: CableLine
  analysis: CableAnalysis
  status: RadialStatus
  knownCoveragePercent: number
  hasObservedConflict: boolean
}
export interface RadialDeflectionResult {
  center: Coordinate
  settings: RadialDeflectionSettings
  effectiveStepDeg: number
  spokes: RadialSpoke[]
  warnings: string[]
}

export const RADIAL_COLORS: Record<RadialStatus, string> = {
  clear: '#15803d',
  conflict: '#dc2626',
  unknown: '#6b7280',
}

function bounded(value: number, name: string, low: number, high: number): number {
  if (!Number.isFinite(value) || value < low || value > high)
    throw new Error(`${name} must be between ${low} and ${high}.`)
  return value
}
function validCoordinate(point: Coordinate) {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !point.every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) >= 85
  )
    throw new Error('The landing and tailholds must use valid WGS84 coordinates between latitudes −85° and 85°.')
}
const bearing = (degrees: number) => ((degrees % 360) + 360) % 360

/**
 * Fixed-radius candidate D-lines, using the same assumed parabolic sag model as
 * individually drawn lines. This is not a cable force solution or maximum-reach
 * search. A missing terrain sample makes a whole spoke unknown, never clear.
 *
 * The cable sampler caps each spoke at 1,001 samples (+ two support queries),
 * so a run makes no more than 72,216 terrain lookups.
 */
export function analyzeRadialDeflection(
  center: Coordinate,
  source: TerrainSource,
  settings: RadialDeflectionSettings,
): RadialDeflectionResult {
  validCoordinate(center)
  const s: RadialDeflectionSettings = {
    radiusM: bounded(settings.radiusM, 'Radius (m)', 10, MAX_RADIAL_RADIUS_M),
    startBearingDeg: bounded(settings.startBearingDeg, 'Start bearing (degrees)', 0, 360),
    sweepDeg: bounded(settings.sweepDeg, 'Bearing sweep (degrees)', 0, 360),
    bearingStepDeg: bounded(settings.bearingStepDeg, 'Bearing step (degrees)', 1, 180),
    yarderHeightM: bounded(settings.yarderHeightM, 'Yarder height (m)', 0, 100),
    tailholdHeightM: bounded(settings.tailholdHeightM, 'Tailhold height (m)', 0, 100),
    deflectionPercent: bounded(settings.deflectionPercent, 'Assumed sag (%)', 0, 30),
    minimumClearanceM: bounded(settings.minimumClearanceM, 'Minimum clearance (m)', 0, 100),
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
  const spokes = Array.from({ length: count }, (_, index): RadialSpoke => {
    const delta = fullCircle ? index * effectiveStepDeg : Math.min(s.sweepDeg, index * effectiveStepDeg)
    const bearingDeg = bearing(s.startBearingDeg + delta)
    const end = offsetCoordinate(center, bearingDeg, s.radiusM)
    validCoordinate(end)
    const id = `radial-spoke-${index + 1}`
    const line: CableLine = {
      id,
      name: `Landing D-line ${bearingDeg.toFixed(1)}°`,
      start: [...center],
      end,
      startHeight: s.yarderHeightM,
      endHeight: s.tailholdHeightM,
      deflectionPercent: s.deflectionPercent,
    }
    const analysis = analyzeCable(line, source)
    const knownGround = analysis.samples.filter((sample) => sample.ground !== null)
    const hasObservedConflict = analysis.samples.some(
      (sample) => sample.clearance !== null && sample.clearance < s.minimumClearanceM - 1e-7,
    )
    const status: RadialStatus =
      !analysis.complete || analysis.minClearance === null ? 'unknown' : hasObservedConflict ? 'conflict' : 'clear'
    return {
      id,
      bearingDeg,
      line,
      analysis,
      status,
      knownCoveragePercent: analysis.samples.length ? (100 * knownGround.length) / analysis.samples.length : 0,
      hasObservedConflict,
    }
  })
  return { center: [...center], settings: s, effectiveStepDeg, spokes, warnings }
}

/** Temporary map overlay. Adopting a line is an explicit, separate project edit. */
export function radialDeflectionGeoJson(
  result: RadialDeflectionResult,
  selectedSpokeId?: string | null,
  cursorDistanceM?: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = result.spokes.map((spoke) => ({
    type: 'Feature',
    id: spoke.id,
    properties: {
      kind: 'radial-spoke',
      spokeId: spoke.id,
      name: spoke.line.name,
      label: `${spoke.bearingDeg.toFixed(1)}°`,
      color: RADIAL_COLORS[spoke.status],
      selected: spoke.id === selectedSpokeId,
      status: spoke.status,
      clearance_m: spoke.analysis.minClearance,
      minimum_required_clearance_m: result.settings.minimumClearanceM,
      known_coverage_percent: spoke.knownCoveragePercent,
      observed_conflict: spoke.hasObservedConflict,
      bearing_deg: spoke.bearingDeg,
      radius_m: result.settings.radiusM,
      assumed_deflection_percent: spoke.line.deflectionPercent,
      yarder_height_m: spoke.line.startHeight,
      tailhold_height_m: spoke.line.endHeight,
      model: 'fixed-radius assumed-sag geometric screen',
    },
    geometry: { type: 'LineString', coordinates: [spoke.line.start, spoke.line.end] },
  }))
  features.push({
    type: 'Feature',
    id: 'radial-landing',
    properties: { kind: 'radial-center', label: 'Landing', color: '#7c3aed' },
    geometry: { type: 'Point', coordinates: result.center },
  })
  const selected = result.spokes.find((spoke) => spoke.id === selectedSpokeId)
  if (selected) {
    const spanDistance =
      cursorDistanceM !== undefined && Number.isFinite(cursorDistanceM)
        ? Math.max(0, Math.min(selected.analysis.length, cursorDistanceM))
        : selected.analysis.length
    features.push({
      type: 'Feature',
      id: `${selected.id}-cursor`,
      properties: {
        kind: 'radial-spoke',
        spokeId: selected.id,
        label: `${selected.bearingDeg.toFixed(1)}° · ${spanDistance.toFixed(0)} m`,
        color: '#be185d',
        selected: true,
        distance_m: spanDistance,
        status: selected.status,
      },
      geometry: {
        type: 'Point',
        coordinates: offsetCoordinate(result.center, selected.bearingDeg, spanDistance),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

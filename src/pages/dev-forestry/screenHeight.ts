/**
 * How tall a screen of standing timber must be, between a viewpoint and a block, to hide the block's ground: the
 * forestry counterpart of EnVision's "seen-area depth" grid (USFS, public domain), which gave each cell how far it
 * lies below the line of sight, i.e. how tall something there must be to be seen.
 *
 * Each block sample's sightline is walked as the run walks it (`testSightline`, `visibility.ts`): the same earth
 * curvature and refraction, the same 0.5 m clearance, and unknown ground is never read as clear. Where the bare
 * ground already hides the sample it is `terrainHidden`. Otherwise the reading records the least height a screen
 * would need, over the stretch of the line where timber may stand: by default only ground outside the block, past
 * the eye's road clearing. A screen of at least that height there hides the sample.
 *
 * A design aid for leave strips and screening retention only. It is never a run input and never a reported VIA
 * figure: the run's own figures already include the timber the inventory records.
 *
 * DOM-free and network-free. `screenHeightSteps` is a generator for `runCooperatively` (`cooperative.ts`);
 * `screenHeightReading` drains it.
 */

import { MAX_SIGHTLINE_STEPS, sightlineSampling } from '@/features/terrain-viewshed/model'

import { lngLatToMercator, mercatorToLngLat, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import { DEFAULT_ANALYSIS_SETTINGS } from './types'
import {
  DEFAULT_SIGHTLINE_OPTIONS,
  earthCurvatureDropMeters,
  haversineMeters,
  polygonBounds,
  polygonGridSamples,
  preparePolygons,
  spacingForSampleBudget,
  type GridSample,
  type PolygonGeometry,
} from './visibility'

/** Tallest screen the curve reads, metres. */
export const SCREEN_HEIGHT_MAX_METERS = 60
/** The curve's step, metres. */
export const SCREEN_HEIGHT_STEP_METERS = 1
/** Most block samples one reading walks; a finer grid is widened to fit. */
export const SCREEN_HEIGHT_MAX_SAMPLES = 2_500
/** Sample spacing when neither a spacing nor the terrain's resolution is given, metres. */
export const SCREEN_HEIGHT_FALLBACK_SPACING_METERS = 20
/** Sightline step when neither a step nor the terrain's resolution is given: the run's floor, metres. */
export const SCREEN_HEIGHT_FALLBACK_STEP_METERS = 5
/**
 * Ground this close to the eye holds no screen: the road clearing and its shoulder. The run clears screening timber
 * within the same 50 m of each station (`screeningEyeClearingMeters`), so the two agree.
 */
export const SCREEN_HEIGHT_NEAR_EYE_METERS = 50
/** Samples between progress reports. */
export const SCREEN_HEIGHT_YIELD_EVERY = 25

/** Where a screen may stand: only outside the block (the default), or anywhere on the line but the sample's own cell. */
export type ScreenZone = 'outside-block' | 'anywhere'

export type ScreenHeightInput = {
  eye: {
    lng: number
    lat: number
    /** Eye above the ground under it, metres. */
    heightAboveGroundMeters: number
    /** A surveyed eye elevation above sea level; stands the eye there instead of ground + height. */
    eyeElevationMeters?: number
  }
  block: PolygonGeometry
  elevation: ElevationSource
  /** The terrain's cell size, metres. Sets the default sample spacing (as the run's) and sightline step (half a cell). */
  terrainResolutionMeters?: number
  /** Block sample spacing, metres. Default: the run's (`sampleBudget` over the block), else 20 m. */
  sampleSpacingMeters?: number
  /** Default `SCREEN_HEIGHT_MAX_SAMPLES`; past it the spacing is widened. */
  maxSamples?: number
  /** Default `outside-block`. */
  screenZone?: ScreenZone
  /** Default `SCREEN_HEIGHT_NEAR_EYE_METERS`. */
  nearEyeExclusionMeters?: number
  /** Sightline step, metres. Default half the terrain cell (`sightlineSampling`), else 5 m. */
  stepMeters?: number
  /** Target above the sample's ground, metres (the run's `targetOffsetMeters`, default 0). */
  targetOffsetMeters?: number
  /** Default the run's 0.13. */
  refractionCoefficient?: number
  /** Ground counts as crossing the sightline only this far above it, metres (the run's 0.5 m). */
  clearanceMeters?: number
}

export type ScreenHeightStatus = 'terrainHidden' | 'visible' | 'unknown'

export type ScreenHeightSample = {
  lng: number
  lat: number
  /** Ground area the sample stands for, m². */
  areaMeters: number
  /** Eye to sample, metres. */
  distanceMeters: number
  status: ScreenHeightStatus
  /**
   * For a visible sample: the least screen height, metres above the ground it stands on, that hides the sample.
   * Null when no ground on the line may hold a screen (the block reaches the eye's clearing), or the sample is not
   * visible.
   */
  minClearanceMeters: number | null
  /** Where that screen stands: distance from the eye, metres, and its position. */
  atMeters: number | null
  atLng: number | null
  atLat: number | null
}

export type ScreenHeightCurvePoint = {
  heightMeters: number
  /** Share of the terrain-visible ground a screen this tall hides, percent; null with no visible ground. */
  hiddenOfVisiblePercent: number | null
  /** Share of all known ground hidden, by the terrain or by the screen, percent; null with no known ground. */
  hiddenOfKnownPercent: number | null
}

export type ScreenHeightCounts = {
  total: number
  visible: number
  terrainHidden: number
  /** Unknown is never counted as hidden or visible, as the run's code 2. */
  unknown: number
  /** Visible samples no screen in the zone can hide. */
  unscreenable: number
}

export type ScreenHeightReading = {
  samples: ScreenHeightSample[]
  counts: ScreenHeightCounts
  /** Of the known ground, percent; null with none known. */
  terrainHiddenPercent: number | null
  /** Of the whole block, percent. */
  unknownPercent: number
  /** 0 to `SCREEN_HEIGHT_MAX_METERS` every `SCREEN_HEIGHT_STEP_METERS`. */
  curve: ScreenHeightCurvePoint[]
  /** `screenHeightForShare` at 50, 75 and 90% of the visible ground. */
  screenFor: { half: number | null; threeQuarters: number | null; ninety: number | null }
  eyeElevationMeters: number | null
  sampleSpacingMeters: number
  stepMeters: number
  screenZone: ScreenZone
  nearEyeExclusionMeters: number
  clearanceMeters: number
}

export type ScreenHeightProgress = { completed: number; total: number; fraction: number }

/** The sample spacing the reading uses, before the cap: given, else the run's, else 20 m. */
function baseSpacing(input: ScreenHeightInput): number {
  if (input.sampleSpacingMeters !== undefined) {
    if (!(input.sampleSpacingMeters > 0) || !Number.isFinite(input.sampleSpacingMeters))
      throw new Error('Sample spacing must be a positive number of metres.')
    return input.sampleSpacingMeters
  }
  const resolution = input.terrainResolutionMeters
  if (resolution !== undefined && resolution > 0 && Number.isFinite(resolution))
    return spacingForSampleBudget(input.block, DEFAULT_ANALYSIS_SETTINGS.sampleBudget, Math.max(5, resolution * 0.75))
  return SCREEN_HEIGHT_FALLBACK_SPACING_METERS
}

/** The block's grid, widened as the run widens its grids until it fits `maxSamples`. */
function blockSamples(input: ScreenHeightInput): { grid: GridSample[]; spacing: number } {
  const maxSamples = Math.max(1, Math.floor(input.maxSamples ?? SCREEN_HEIGHT_MAX_SAMPLES))
  let spacing = Math.max(baseSpacing(input), spacingForSampleBudget(input.block, maxSamples, 0))
  let grid = polygonGridSamples(input.block, spacing)
  for (let attempt = 0; grid.length > maxSamples && attempt < 8; attempt++) {
    spacing *= Math.sqrt(grid.length / maxSamples) * 1.05
    grid = polygonGridSamples(input.block, spacing)
  }
  return { grid, spacing }
}

function stepFor(input: ScreenHeightInput): number {
  if (input.stepMeters !== undefined) {
    if (!(input.stepMeters > 0) || !Number.isFinite(input.stepMeters))
      throw new Error('Sightline step must be a positive number of metres.')
    return input.stepMeters
  }
  const resolution = input.terrainResolutionMeters
  if (resolution !== undefined && resolution > 0 && Number.isFinite(resolution))
    return sightlineSampling(resolution, 0).stepMeters
  return SCREEN_HEIGHT_FALLBACK_STEP_METERS
}

/**
 * The least screen height that hides at least `percent` of the block's terrain-visible ground, metres: a screen
 * reaching that height hides that share. Null when no visible ground is left, or when that share includes ground no
 * screen in the zone can hide. Not capped at the curve's 60 m.
 */
export function screenHeightForShare(reading: Pick<ScreenHeightReading, 'samples'>, percent: number): number | null {
  const visible = reading.samples.filter((sample) => sample.status === 'visible')
  const total = visible.reduce((sum, sample) => sum + sample.areaMeters, 0)
  if (!(total > 0)) return null
  const wanted = (Math.max(0, Math.min(100, percent)) / 100) * total
  const sorted = visible
    .map((sample) => ({ clearance: sample.minClearanceMeters ?? Infinity, area: sample.areaMeters }))
    .sort((a, b) => a.clearance - b.clearance)
  let hidden = 0
  for (const { clearance, area } of sorted) {
    hidden += area
    if (hidden >= wanted - total * 1e-9) return Number.isFinite(clearance) ? clearance : null
  }
  return null
}

/**
 * Share of the terrain-visible ground a screen `heightMeters` tall hides, percent, read from the samples rather than
 * the whole-metre curve, so a stand height between two curve steps reads exactly. Null with no visible ground.
 */
export function hiddenShareAt(reading: Pick<ScreenHeightReading, 'samples'>, heightMeters: number): number | null {
  let total = 0,
    hidden = 0
  for (const sample of reading.samples) {
    if (sample.status !== 'visible') continue
    total += sample.areaMeters
    if (sample.minClearanceMeters !== null && sample.minClearanceMeters <= heightMeters) hidden += sample.areaMeters
  }
  return total > 0 ? (100 * hidden) / total : null
}

function summarise(
  samples: ScreenHeightSample[],
  setup: Omit<
    ScreenHeightReading,
    'samples' | 'counts' | 'terrainHiddenPercent' | 'unknownPercent' | 'curve' | 'screenFor'
  >,
): ScreenHeightReading {
  const counts: ScreenHeightCounts = {
    total: samples.length,
    visible: 0,
    terrainHidden: 0,
    unknown: 0,
    unscreenable: 0,
  }
  let visibleArea = 0,
    hiddenArea = 0,
    unknownArea = 0,
    totalArea = 0
  for (const sample of samples) {
    totalArea += sample.areaMeters
    if (sample.status === 'visible') {
      counts.visible++
      visibleArea += sample.areaMeters
      if (sample.minClearanceMeters === null) counts.unscreenable++
    } else if (sample.status === 'terrainHidden') {
      counts.terrainHidden++
      hiddenArea += sample.areaMeters
    } else {
      counts.unknown++
      unknownArea += sample.areaMeters
    }
  }
  const knownArea = visibleArea + hiddenArea
  const screenable = samples
    .filter((sample) => sample.status === 'visible' && sample.minClearanceMeters !== null)
    .map((sample) => ({ clearance: sample.minClearanceMeters!, area: sample.areaMeters }))
    .sort((a, b) => a.clearance - b.clearance)
  const curve: ScreenHeightCurvePoint[] = []
  let index = 0,
    screened = 0
  for (let height = 0; height <= SCREEN_HEIGHT_MAX_METERS; height += SCREEN_HEIGHT_STEP_METERS) {
    // A screen whose top reaches the clearance hides the sample.
    while (index < screenable.length && screenable[index].clearance <= height) screened += screenable[index++].area
    curve.push({
      heightMeters: height,
      hiddenOfVisiblePercent: visibleArea > 0 ? (100 * screened) / visibleArea : null,
      hiddenOfKnownPercent: knownArea > 0 ? (100 * (hiddenArea + screened)) / knownArea : null,
    })
  }
  return {
    ...setup,
    samples,
    counts,
    terrainHiddenPercent: knownArea > 0 ? (100 * hiddenArea) / knownArea : null,
    unknownPercent: totalArea > 0 ? (100 * unknownArea) / totalArea : 0,
    curve,
    screenFor: {
      half: screenHeightForShare({ samples }, 50),
      threeQuarters: screenHeightForShare({ samples }, 75),
      ninety: screenHeightForShare({ samples }, 90),
    },
  }
}

/**
 * Walks every block sample's sightline, yielding progress every `yieldEvery` samples, and returns the reading. Drive
 * it with `runCooperatively` so Cancel takes effect, or drain it with `screenHeightReading`.
 */
export function* screenHeightSteps(
  input: ScreenHeightInput,
  options: { yieldEvery?: number } = {},
): Generator<ScreenHeightProgress, ScreenHeightReading, void> {
  const { eye, elevation, block } = input
  if (!Number.isFinite(eye.lng) || !Number.isFinite(eye.lat)) throw new Error('The viewpoint has no position.')
  polygonBounds(block)
  const zone: ScreenZone = input.screenZone ?? 'outside-block'
  const nearEye = Math.max(0, input.nearEyeExclusionMeters ?? SCREEN_HEIGHT_NEAR_EYE_METERS)
  const refraction = input.refractionCoefficient ?? DEFAULT_SIGHTLINE_OPTIONS.refractionCoefficient
  const tolerance = input.clearanceMeters ?? DEFAULT_SIGHTLINE_OPTIONS.clearanceMeters
  const offset = input.targetOffsetMeters ?? 0
  const step = stepFor(input)
  const { grid, spacing } = blockSamples(input)
  // In `anywhere`, a sample is never screened by timber on its own cell.
  const nearTarget = zone === 'anywhere' ? spacing / 2 : 0
  const yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? SCREEN_HEIGHT_YIELD_EVERY))

  const eyeElevation =
    eye.eyeElevationMeters !== undefined && Number.isFinite(eye.eyeElevationMeters)
      ? eye.eyeElevationMeters
      : elevation.elevationAt(eye.lng, eye.lat) + eye.heightAboveGroundMeters
  const known = Number.isFinite(eyeElevation)

  // The block in Mercator for a cheap reject; points inside its box go through the prepared polygon.
  const [minLng, minLat, maxLng, maxLat] = polygonBounds(block)
  const [boxWest, boxNorth] = lngLatToMercator(minLng, maxLat)
  const [boxEast, boxSouth] = lngLatToMercator(maxLng, minLat)
  const inBlock = preparePolygons([block]).contains
  const groundAt = (x: number, y: number) => {
    if (elevation.elevationAtMercator) return elevation.elevationAtMercator(x, y)
    const [lng, lat] = mercatorToLngLat(x, y)
    return elevation.elevationAt(lng, lat)
  }
  const start = lngLatToMercator(eye.lng, eye.lat)

  const samples: ScreenHeightSample[] = []
  for (let n = 0; n < grid.length; n++) {
    const point = grid[n]
    const distance = haversineMeters(eye, point)
    const sample: ScreenHeightSample = {
      lng: point.lng,
      lat: point.lat,
      areaMeters: point.areaMeters,
      distanceMeters: distance,
      status: 'unknown',
      minClearanceMeters: null,
      atMeters: null,
      atLng: null,
      atLat: null,
    }
    samples.push(sample)
    const target = elevation.elevationAt(point.lng, point.lat) + offset
    if (known && Number.isFinite(target) && Number.isFinite(distance)) {
      if (distance < 1) sample.status = 'visible'
      else {
        const steps = Math.min(MAX_SIGHTLINE_STEPS, Math.max(2, Math.ceil(distance / step)))
        const end = lngLatToMercator(point.lng, point.lat)
        const slope = (target - earthCurvatureDropMeters(distance, refraction) - eyeElevation) / distance
        let unknown = false,
          hidden = false,
          best = Infinity,
          bestAt = -1,
          bestX = 0,
          bestY = 0
        for (let i = 1; i < steps; i++) {
          const f = i / steps,
            d = distance * f
          const x = start[0] + (end[0] - start[0]) * f,
            y = start[1] + (end[1] - start[1]) * f
          const ground = groundAt(x, y)
          if (!Number.isFinite(ground)) {
            unknown = true
            continue
          }
          // The sightline's height over the ground's own datum, as `testSightline` sets its limit.
          const clearance = eyeElevation + slope * d + earthCurvatureDropMeters(d, refraction) + tolerance - ground
          // A known obstruction settles it even where other ground is unknown.
          if (clearance < 0) {
            hidden = true
            break
          }
          if (d < nearEye || clearance >= best) continue
          if (zone === 'anywhere') {
            if (d > distance - nearTarget) continue
          } else if (x >= boxWest && x <= boxEast && y >= boxNorth && y <= boxSouth) {
            const [lng, lat] = mercatorToLngLat(x, y)
            if (inBlock(lng, lat)) continue
          }
          best = clearance
          bestAt = d
          bestX = x
          bestY = y
        }
        if (hidden) sample.status = 'terrainHidden'
        else if (!unknown) {
          sample.status = 'visible'
          if (bestAt >= 0) {
            const [lng, lat] = mercatorToLngLat(bestX, bestY)
            sample.minClearanceMeters = best
            sample.atMeters = bestAt
            sample.atLng = lng
            sample.atLat = lat
          }
        }
      }
    }
    if ((n + 1) % yieldEvery === 0 && n + 1 < grid.length)
      yield { completed: n + 1, total: grid.length, fraction: (n + 1) / grid.length }
  }
  return summarise(samples, {
    eyeElevationMeters: known ? eyeElevation : null,
    sampleSpacingMeters: spacing,
    stepMeters: step,
    screenZone: zone,
    nearEyeExclusionMeters: nearEye,
    clearanceMeters: tolerance,
  })
}

/** `screenHeightSteps` drained in one go. */
export function screenHeightReading(input: ScreenHeightInput): ScreenHeightReading {
  const steps = screenHeightSteps(input, { yieldEvery: Number.MAX_SAFE_INTEGER })
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

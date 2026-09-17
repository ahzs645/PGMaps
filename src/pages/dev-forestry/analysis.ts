/**
 * The visibility run itself: stations along the road, a sample grid over every
 * polygon, and a sightline between each pair.
 *
 * Split from the worker so it can be exercised directly against real DEM tiles
 * or synthetic terrain — the worker adds tile fetching and message passing and
 * nothing else.
 */

import { buildCanopyGrid, type CanopyStand } from './canopy'
import { demResolutionMeters, type Bounds, type ElevationSource } from './terrain'
import {
  DEFAULT_SIGHTLINE_OPTIONS,
  haversineMeters,
  lineLengthMeters,
  polygonAreaMeters,
  polygonBounds,
  pointInPolygon,
  polygonGridSamples,
  sampleAlongLine,
  spacingForSampleBudget,
  terrainNormal,
  testSightline,
  apparentSolidAngle,
  type CorridorStation,
  type GroundPoint,
  type PolygonGeometry,
  type SightlineOptions,
} from './visibility'
import { VIEWING_ZONES, viewingZoneFor } from './vqo'
import type {
  AlterationBreakdown,
  AnalysisInput,
  AnalysisProgress,
  AnalysisResult,
  StationResult,
  TargetRole,
  TargetVisibility,
} from './types'

/**
 * Ceiling on sightlines per run, chosen to keep a worst case around ten
 * seconds: a sightline walks the terrain profile a DEM cell at a time, so this
 * is tens of millions of elevation samples. The grid is coarsened to stay under
 * it rather than the stations being thinned — losing a viewpoint loses a whole
 * answer, whereas a coarser grid only blurs one.
 */
const MAX_TOTAL_SIGHTLINES = 250_000

/** Sampling the DEM finer than it resolves adds cost and no information. */
const MIN_SAMPLE_SPACING_FACTOR = 0.75

export type TerrainInfo = {
  tileCount: number
  missingTileCount: number
  resolutionMeters: number
}

export type PreparedTarget = {
  id: string
  name: string
  role: TargetRole
  geometry: PolygonGeometry
  spacingMeters: number
  areaMeters: number
  inRange: boolean
  /**
   * How much of this polygon reads as denudation, 0–1. Existing openings count
   * only their clearcut share, and nothing at all once they pass green-up.
   */
  alterationWeight: number
  /** True for an existing opening excluded because regeneration has caught up. */
  recovered: boolean
}

/** Shortest distance from a point to a bounding box, in metres. */
function distanceToBounds(point: { lng: number; lat: number }, bounds: Bounds): number {
  const [minLng, minLat, maxLng, maxLat] = bounds
  const clampedLng = Math.min(maxLng, Math.max(minLng, point.lng))
  const clampedLat = Math.min(maxLat, Math.max(minLat, point.lat))
  return haversineMeters(point, { lng: clampedLng, lat: clampedLat })
}

/** Viewing stations for a viewpoint: one for a spot, evenly spaced for a corridor. */
export function buildStations(input: AnalysisInput): CorridorStation[] {
  const { coordinates, mode } = input.viewpoint
  if (coordinates.length === 0) return []
  if (mode === 'spot' || coordinates.length === 1) {
    return [{ lng: coordinates[0][0], lat: coordinates[0][1], distanceAlongMeters: 0 }]
  }
  return sampleAlongLine(coordinates, Math.max(10, input.settings.stationSpacingMeters))
}

/**
 * Grid spacing and range check per target, and the work budget applied across
 * all of them together.
 */
export function prepareTargets(input: AnalysisInput, stations: CorridorStation[]): PreparedTarget[] {
  const midLat = stations.length > 0 ? stations[0].lat : 0
  const demResolution = demResolutionMeters(midLat, input.settings.demZoom)
  const minSpacing = Math.max(5, demResolution * MIN_SAMPLE_SPACING_FACTOR)

  const prepared = input.targets.map((target): PreparedTarget => {
    const bounds = polygonBounds(target.geometry)
    const nearest = stations.reduce(
      (closest, station) => Math.min(closest, distanceToBounds(station, bounds)),
      Number.POSITIVE_INFINITY,
    )

    // An opening older than green-up has grown back into forest cover and stops
    // counting; a partial cut only ever counted for its clearcut share.
    const age =
      target.role === 'harvested' && typeof target.harvestYear === 'number'
        ? input.assessmentYear - target.harvestYear
        : null
    const recovered = age !== null && age >= input.settings.greenUpAgeYears
    const clearcutFraction =
      target.role === 'harvested' && typeof target.clearcutPercent === 'number'
        ? Math.max(0, Math.min(1, target.clearcutPercent / 100))
        : 1

    return {
      id: target.id,
      name: target.name,
      role: target.role,
      geometry: target.geometry,
      spacingMeters: spacingForSampleBudget(target.geometry, input.settings.sampleBudget, minSpacing),
      areaMeters: polygonAreaMeters(target.geometry),
      inRange: nearest <= input.settings.maxViewDistanceMeters,
      alterationWeight: recovered ? 0 : clearcutFraction,
      recovered,
    }
  })

  // Estimated sightlines, using each polygon's area over its cell area rather
  // than building the grids twice.
  const estimate = prepared.reduce((total, target) => {
    if (!target.inRange) return total
    const cells = Math.max(1, target.areaMeters / target.spacingMeters ** 2)
    return total + cells * stations.length
  }, 0)

  if (estimate <= MAX_TOTAL_SIGHTLINES) return prepared

  const coarsen = Math.sqrt(estimate / MAX_TOTAL_SIGHTLINES)
  return prepared.map((target) => ({ ...target, spacingMeters: target.spacingMeters * coarsen }))
}

/** Bounding box the DEM has to cover: the stations plus every in-range target. */
export function analysisBounds(input: AnalysisInput, stations: CorridorStation[]): Bounds | null {
  const boxes: Bounds[] = []
  if (stations.length > 0) {
    boxes.push([
      Math.min(...stations.map((station) => station.lng)),
      Math.min(...stations.map((station) => station.lat)),
      Math.max(...stations.map((station) => station.lng)),
      Math.max(...stations.map((station) => station.lat)),
    ])
  }
  for (const target of prepareTargets(input, stations)) {
    if (target.inRange) boxes.push(polygonBounds(target.geometry))
  }
  if (boxes.length === 0) return null

  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ]
}

function sightlineOptions(input: AnalysisInput, demResolution: number): SightlineOptions {
  return {
    ...DEFAULT_SIGHTLINE_OPTIONS,
    observerHeightMeters: input.settings.observerHeightMeters,
    targetOffsetMeters: input.settings.targetOffsetMeters,
    maxDistanceMeters: input.settings.maxViewDistanceMeters,
    // Stepping at roughly the DEM's own resolution samples every cell the ray
    // crosses without re-reading the same one.
    stepMeters: Math.max(5, demResolution * 0.9),
  }
}

function emptyZoneTotals(): Record<string, number> {
  return Object.fromEntries(VIEWING_ZONES.map((zone) => [zone.id, 0]))
}

/**
 * Run every sightline and reduce the result to the numbers the page reports.
 *
 * Visibility is kept per station rather than collapsed as it goes: the same
 * matrix answers "can this block be seen anywhere along the road", "where is it
 * most exposed", and "what does the driver see right now" without a second pass
 * over the terrain.
 */
export function computeAnalysis(
  source: ElevationSource,
  input: AnalysisInput,
  terrain: TerrainInfo,
  onProgress?: (progress: AnalysisProgress) => void,
  /**
   * Inventory stands to screen with. Built into a grid here rather than by the
   * caller so the rule for what ground is currently open — the same green-up
   * and clearcut logic the alteration figures use — lives in one place.
   */
  canopyStands: CanopyStand[] = [],
): AnalysisResult {
  const startedAt = Date.now()
  const stations = buildStations(input)
  const prepared = prepareTargets(input, stations)
  const options = sightlineOptions(input, terrain.resolutionMeters)

  // Screening is built before any sightline runs: the proposal and every
  // opening that has not grown back are standing on cleared ground.
  const canopyBounds = analysisBounds(input, stations)
  const canopy =
    input.settings.screeningEnabled && canopyStands.length > 0 && canopyBounds
      ? buildCanopyGrid(
          canopyStands,
          canopyBounds,
          prepared
            .filter((target) => target.role === 'block' || (target.role === 'harvested' && !target.recovered))
            .map((target) => target.geometry),
          { minCrownClosurePercent: input.settings.minCrownClosurePercent },
        )
      : null

  const stationPoints: GroundPoint[] = stations.map((station) => ({
    lng: station.lng,
    lat: station.lat,
    groundElevationMeters: source.elevationAt(station.lng, station.lat),
  }))

  const totalSightlines = prepared.reduce((total, target) => {
    if (!target.inRange) return total
    return total + Math.max(1, target.areaMeters / target.spacingMeters ** 2) * stations.length
  }, 0)
  let completedSightlines = 0
  let lastProgressAt = 0

  const reportProgress = (force = false) => {
    if (!onProgress) return
    const now = Date.now()
    if (!force && now - lastProgressAt < 80) return
    lastProgressAt = now
    onProgress({
      phase: 'sightlines',
      completed: Math.round(completedSightlines),
      total: Math.max(1, Math.round(totalSightlines)),
    })
  }

  type Pass = {
    target: PreparedTarget
    samples: GroundPoint[]
    sampleAreaMeters: number
    anyVisible: Uint8Array
    visibleByStation: Uint8Array
    visibleDistances: Float64Array
    visibleAreaPerStation: Float64Array
  }

  const passes: Pass[] = prepared.map((target) => {
    const grid = target.inRange ? polygonGridSamples(target.geometry, target.spacingMeters) : []
    const samples: GroundPoint[] = grid.map((sample) => ({
      lng: sample.lng,
      lat: sample.lat,
      groundElevationMeters: source.elevationAt(sample.lng, sample.lat),
    }))
    const sampleCount = samples.length
    // Every cell covers the same ground, except the degenerate single-sample
    // fallback for a polygon smaller than one cell.
    const sampleAreaMeters = sampleCount > 0 ? grid[0].areaMeters : 0

    const pass: Pass = {
      target,
      samples,
      sampleAreaMeters,
      anyVisible: new Uint8Array(sampleCount),
      visibleByStation: new Uint8Array(sampleCount * stations.length),
      visibleDistances: new Float64Array(sampleCount).fill(-1),
      visibleAreaPerStation: new Float64Array(stations.length),
    }

    for (let stationIndex = 0; stationIndex < stationPoints.length; stationIndex += 1) {
      const station = stationPoints[stationIndex]
      const rowOffset = stationIndex * sampleCount
      let visibleCount = 0

      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const sample = samples[sampleIndex]
        if (Number.isNaN(sample.groundElevationMeters)) continue

        const result = testSightline(source, station, sample, options, canopy ?? undefined)
        if (!result.visible) continue

        visibleCount += 1
        pass.visibleByStation[rowOffset + sampleIndex] = 1
        pass.anyVisible[sampleIndex] = 1
        const previous = pass.visibleDistances[sampleIndex]
        if (previous < 0 || result.distanceMeters < previous) {
          pass.visibleDistances[sampleIndex] = result.distanceMeters
        }
      }

      pass.visibleAreaPerStation[stationIndex] = visibleCount * sampleAreaMeters
      completedSightlines += sampleCount
      reportProgress()
    }

    return pass
  })
  reportProgress(true)

  // The assessment station is where the blocks together show the most ground —
  // the critical viewpoint a visual impact assessment would be written from.
  let assessmentStationIndex = 0
  let worstVisibleArea = -1
  for (let stationIndex = 0; stationIndex < stations.length; stationIndex += 1) {
    const visibleArea = passes.reduce(
      (total, pass) => (pass.target.role === 'block' ? total + pass.visibleAreaPerStation[stationIndex] : total),
      0,
    )
    if (visibleArea > worstVisibleArea) {
      worstVisibleArea = visibleArea
      assessmentStationIndex = stationIndex
    }
  }

  const assessmentStation = stationPoints[assessmentStationIndex]
  const assessmentObserver = assessmentStation
    ? { ...assessmentStation, eyeHeightMeters: input.settings.observerHeightMeters }
    : null

  // Percent alteration is written against an identifiable landform rather than
  // the whole visible landscape, so the planimetric figure below needs one to
  // divide by — and only counts the parts of blocks that fall inside it.
  const landform = prepared.find((target) => target.role === 'landscape') ?? null
  const landformGeometry = landform?.geometry ?? null

  // Openings that still read as disturbance. Recovered ones are out entirely,
  // so ground under them is available to a proposed block again.
  const countedOpenings = prepared
    .filter((target) => target.role === 'harvested' && target.alterationWeight > 0)
    .map((target) => target.geometry)

  const targets: TargetVisibility[] = passes.map((pass) => {
    const sampleCount = pass.samples.length
    const positions = new Float64Array(sampleCount * 2)
    const elevations = new Float64Array(sampleCount)

    let visibleSamples = 0
    let apparentTotal = 0
    let apparentVisible = 0
    let apparentVisibleNew = 0
    let nearestVisible: number | null = null
    let farthestVisible: number | null = null
    let slopeTotal = 0
    let slopeSamples = 0
    let samplesInsideLandform = 0
    let samplesAlreadyAltered = 0
    const alreadyAltered = new Uint8Array(sampleCount)
    const visibleAreaByZone = emptyZoneTotals()
    const assessmentRow = assessmentStationIndex * sampleCount

    // The grid estimates the visible *fraction*; the polygon's own area is
    // known exactly. Reporting hectares against the grid's total instead would
    // show a fully visible block as slightly less than its own size.
    const griddedArea = sampleCount * pass.sampleAreaMeters
    const areaScale = griddedArea > 0 ? pass.target.areaMeters / griddedArea : 0
    const sampleGroundArea = pass.sampleAreaMeters * areaScale

    for (let index = 0; index < sampleCount; index += 1) {
      const sample = pass.samples[index]
      positions[index * 2] = sample.lng
      positions[index * 2 + 1] = sample.lat
      elevations[index] = sample.groundElevationMeters

      if (pass.target.role !== 'landscape' && landformGeometry) {
        if (pointInPolygon(landformGeometry, sample.lng, sample.lat)) samplesInsideLandform += 1
      }

      // Ground a still-counting opening already covers is existing alteration,
      // so a proposed block laid over it must not be charged for it again.
      if (pass.target.role === 'block' && countedOpenings.length > 0) {
        if (countedOpenings.some((opening) => pointInPolygon(opening, sample.lng, sample.lat))) {
          alreadyAltered[index] = 1
          samplesAlreadyAltered += 1
        }
      }

      if (assessmentObserver && !Number.isNaN(sample.groundElevationMeters)) {
        const normal = terrainNormal(source, sample.lng, sample.lat, pass.target.spacingMeters)
        const solidAngle = apparentSolidAngle(assessmentObserver, sample, pass.sampleAreaMeters, normal)
        apparentTotal += solidAngle
        if (pass.visibleByStation[assessmentRow + index] === 1) {
          apparentVisible += solidAngle
          if (alreadyAltered[index] !== 1) apparentVisibleNew += solidAngle
        }

        // The normal already carries the gradient: its horizontal length over
        // its vertical one is the tangent of the slope, which is slope percent.
        if (normal[2] > 0) {
          slopeTotal += (Math.hypot(normal[0], normal[1]) / normal[2]) * 100
          slopeSamples += 1
        }
      }

      if (pass.anyVisible[index] !== 1) continue
      visibleSamples += 1
      const distance = pass.visibleDistances[index]
      visibleAreaByZone[viewingZoneFor(distance).id] += sampleGroundArea
      if (nearestVisible === null || distance < nearestVisible) nearestVisible = distance
      if (farthestVisible === null || distance > farthestVisible) farthestVisible = distance
    }

    const visibleAreaMeters = visibleSamples * sampleGroundArea
    const stationResults: StationResult[] = stations.map((station, stationIndex) => ({
      lng: station.lng,
      lat: station.lat,
      groundElevationMeters: stationPoints[stationIndex].groundElevationMeters,
      distanceAlongMeters: station.distanceAlongMeters,
      visiblePercent: griddedArea > 0 ? (pass.visibleAreaPerStation[stationIndex] / griddedArea) * 100 : 0,
    }))

    return {
      targetId: pass.target.id,
      role: pass.target.role,
      positions,
      elevations,
      anyVisible: pass.anyVisible,
      visibleByStation: pass.visibleByStation,
      visibleDistances: pass.visibleDistances,
      sampleCount,
      sampleAreaMeters: pass.sampleAreaMeters,
      areaMeters: pass.target.areaMeters,
      visibleAreaMeters,
      visiblePercent: sampleCount > 0 ? (visibleSamples / sampleCount) * 100 : 0,
      apparentSolidAngle: apparentTotal,
      visibleApparentSolidAngle: apparentVisible,
      apparentVisiblePercent: apparentTotal > 0 ? (apparentVisible / apparentTotal) * 100 : 0,
      visibleAreaByZone,
      nearestVisibleDistanceMeters: nearestVisible,
      farthestVisibleDistanceMeters: farthestVisible,
      meanSlopePercent: slopeSamples > 0 ? slopeTotal / slopeSamples : null,
      areaInsideLandformMeters:
        landformGeometry && sampleCount > 0 ? (samplesInsideLandform / sampleCount) * pass.target.areaMeters : null,
      newAreaInsideLandformMeters:
        landformGeometry && sampleCount > 0
          ? ((samplesInsideLandform - samplesAlreadyAltered) / sampleCount) * pass.target.areaMeters
          : null,
      visibleApparentSolidAngleNew: apparentVisibleNew,
      alterationWeight: pass.target.alterationWeight,
      recovered: pass.target.recovered,
      outOfRange: !pass.target.inRange,
      stations: stationResults,
    }
  })

  // A visual quality objective is written against the altered share of an
  // identifiable landform, so both figures need one to divide by. Without a
  // landform the page reports per-block visibility and says so.
  const landformSolidAngle = targets.reduce(
    (total, target) => (target.role === 'landscape' ? total + target.visibleApparentSolidAngle : total),
    0,
  )
  const landformArea = targets.reduce(
    (total, target) => (target.role === 'landscape' ? total + target.areaMeters : total),
    0,
  )

  /** Existing and proposed shares of a denominator, and their sum. */
  const breakdown = (
    denominator: number,
    existing: (target: TargetVisibility) => number,
    proposed: (target: TargetVisibility) => number,
  ): AlterationBreakdown | null => {
    if (denominator <= 0) return null
    const existingTotal = targets.reduce(
      (total, target) => (target.role === 'harvested' ? total + existing(target) * target.alterationWeight : total),
      0,
    )
    const proposedTotal = targets.reduce(
      (total, target) => (target.role === 'block' ? total + proposed(target) : total),
      0,
    )
    const existingPercent = (existingTotal / denominator) * 100
    const proposedPercent = (proposedTotal / denominator) * 100
    return { existingPercent, proposedPercent, cumulativePercent: existingPercent + proposedPercent }
  }

  const perspectiveAlteration = breakdown(
    landformSolidAngle,
    (target) => target.visibleApparentSolidAngle,
    // Proposed counts only ground an opening is not already holding.
    (target) => target.visibleApparentSolidAngleNew,
  )

  // The planimetric figure is flat map area, visible or not: that is what the
  // timber-supply scale is applied to. Forest cover is not modelled, so the
  // denominator is the landform's whole area rather than its "green" area.
  const planimetricAlteration = breakdown(
    landformArea,
    (target) => target.areaInsideLandformMeters ?? 0,
    (target) => target.newAreaInsideLandformMeters ?? 0,
  )

  return {
    settings: input.settings,
    stations: stations.map((station, index) => ({
      lng: station.lng,
      lat: station.lat,
      groundElevationMeters: stationPoints[index].groundElevationMeters,
      distanceAlongMeters: station.distanceAlongMeters,
    })),
    corridorLengthMeters: input.viewpoint.mode === 'corridor' ? lineLengthMeters(input.viewpoint.coordinates) : 0,
    assessmentStationIndex,
    targets,
    perspectiveAlteration,
    planimetricAlteration,
    landformAreaMeters: landformArea > 0 ? landformArea : null,
    recoveredOpeningCount: prepared.filter((target) => target.role === 'harvested' && target.recovered).length,
    demTileCount: terrain.tileCount,
    demResolutionMeters: terrain.resolutionMeters,
    missingTileCount: terrain.missingTileCount,
    canopyCoverageFraction: canopy ? canopy.coverageFraction() : null,
    canopyStandCount: canopy ? canopyStands.length : 0,
    elapsedMs: Date.now() - startedAt,
  }
}

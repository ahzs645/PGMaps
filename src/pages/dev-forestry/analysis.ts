/**
 * Finite-budget screening analysis. Cumulative figures use ONE landform ledger,
 * ONE set of surface weights and mutually exclusive alteration contributions.
 * Per-block visibility grids are descriptive; their areas must not be added to
 * reconstruct the cumulative result (overlapping blocks are not additive).
 */
import { buildCanopyGrid, type CanopyStand } from './canopy'
import { demResolutionMeters, lngLatToMercator, type Bounds, type ElevationSource } from './terrain'
import { activeLandform, alterationWeight, canonicalInput, unionContributions } from './integrity'
import { DEFAULT_SIGHTLINE_OPTIONS, haversineMeters, lineLengthMeters, polygonAreaMeters, polygonBounds, pointInPolygon, polygonGridSamples, sampleAlongLine, spacingForSampleBudget, terrainNormal, testSightline, apparentSolidAngle, type CorridorStation, type GroundPoint, type GridSample, type PolygonGeometry, type Vector3 } from './visibility'
import { VIEWING_ZONES, vegHeightForSlope, viewingZoneFor } from './vqo'
import type { AlterationBreakdown, AnalysisInput, AnalysisProgress, AnalysisResult, TargetRole, TargetVisibility, InventoryEvidence } from './types'
export const MAX_TOTAL_SIGHTLINES = 250_000
export type TerrainInfo = { tileCount: number; missingTileCount: number; resolutionMeters: number }
export type AnalysisContext = { vegetation?: InventoryEvidence }
export type PreparedTarget = {
  id: string; name: string; role: TargetRole; geometry: PolygonGeometry
  spacingMeters: number; areaMeters: number; inRange: boolean; alterationWeight: number; recovered: boolean; siteDisturbance: boolean
}
function validate(input: AnalysisInput) {
  canonicalInput(input)
  if (!Number.isInteger(input.assessmentYear) || input.assessmentYear < 1900 || input.assessmentYear > 2200) throw new Error('Set a valid assessment year.')
  for (const key of ['observerHeightMeters', 'stationSpacingMeters', 'maxViewDistanceMeters', 'sampleBudget', 'greenUpAgeYears'] as const) if (!(input.settings[key] > 0)) throw new Error(`${key} must be positive.`)
  if (input.settings.sampleBudget > 100_000 || input.targets.length > 3000) throw new Error('This scenario exceeds the browser analysis limits. Split it into smaller assessments.')
  if (new Set(input.targets.map((t) => t.id)).size !== input.targets.length) throw new Error('Duplicate target IDs. Re-import the scene before analysis.')
  for (const point of input.viewpoint.coordinates) if (point.length !== 2 || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85) throw new Error('The viewpoint must use WGS84 longitude and latitude.')
  for (const target of input.targets) for (const value of [target.clearcutPercent, target.recoveryPercent]) if (value != null && (value < 0 || value > 100)) throw new Error('Clearcut and recovery percentages must be in [0, 100].')
}
export function buildStations(input: AnalysisInput): CorridorStation[] {
  const coordinates = input.viewpoint.coordinates
  if (!coordinates.length) return []
  if (input.viewpoint.mode === 'spot' || coordinates.length === 1) return [{ lng: coordinates[0][0], lat: coordinates[0][1], distanceAlongMeters: 0 }]
  return sampleAlongLine(coordinates, Math.max(10, input.settings.stationSpacingMeters))
}
export function prepareTargets(input: AnalysisInput, stations: CorridorStation[]): PreparedTarget[] {
  const landform = activeLandform(input.targets, input.activeLandformId)
  const minimum = Math.max(5, demResolutionMeters(stations[0]?.lat ?? 0, input.settings.demZoom) * 0.75)
  let targets = input.targets.filter((t) => t.role !== 'landscape' || t.id === landform?.id).map((target): PreparedTarget => {
    const bounds = polygonBounds(target.geometry), areaMeters = polygonAreaMeters(target.geometry)
    if (!(areaMeters > 0)) throw new Error(`${target.name} has no measurable polygon area.`)
    const nearest = stations.reduce((best, p) => Math.min(best, haversineMeters(p, { lng: Math.max(bounds[0], Math.min(bounds[2], p.lng)), lat: Math.max(bounds[1], Math.min(bounds[3], p.lat)) })), Infinity)
    const weight = alterationWeight(target, input.assessmentYear, input.settings.greenUpAgeYears)
    return { id: target.id, name: target.name, role: target.role, geometry: target.geometry, areaMeters,
      spacingMeters: spacingForSampleBudget(target.geometry, input.settings.sampleBudget, minimum), inRange: nearest <= input.settings.maxViewDistanceMeters,
      alterationWeight: weight, recovered: target.role === 'harvested' && !target.siteDisturbance && weight === 0, siteDisturbance: target.siteDisturbance === true }
  })
  const tier = (t: PreparedTarget) => t.role !== 'harvested' ? 0 : t.recovered ? 2 : 1
  const cost = (t: PreparedTarget) => t.inRange ? Math.max(1, t.areaMeters / t.spacingMeters ** 2) * stations.length : 0
  if (targets.filter((t) => t.inRange).length * stations.length > MAX_TOTAL_SIGHTLINES) throw new Error('Too many polygons and stations even at one sample per polygon. Split this scenario.')
  let remaining = MAX_TOTAL_SIGHTLINES
  for (let current = 0; current < 3; current++) {
    const group = targets.filter((t) => tier(t) === current), floor = targets.filter((t) => tier(t) > current && t.inRange).length * stations.length
    const total = group.reduce((sum, t) => sum + cost(t), 0), allowance = Math.max(1, remaining - floor)
    const coarsen = total > allowance ? Math.sqrt(total / allowance) : 1
    targets = targets.map((t) => tier(t) === current ? { ...t, spacingMeters: t.spacingMeters * coarsen } : t)
    remaining -= targets.filter((t) => tier(t) === current).reduce((sum, t) => sum + cost(t), 0)
  }
  return targets
}
export function analysisBounds(input: AnalysisInput, stations: CorridorStation[]): Bounds | null {
  const boxes = prepareTargets(input, stations).filter((t) => t.inRange).map((t) => polygonBounds(t.geometry))
  for (const station of stations) boxes.push([station.lng, station.lat, station.lng, station.lat])
  if (!boxes.length) return null
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
}
const zero = () => ({ existing: 0, proposed: 0, disturbance: 0 })
function asPercent(denominator: number, sum: ReturnType<typeof zero>): AlterationBreakdown | null {
  if (!(denominator > 0)) return null
  const existingPercent = sum.existing / denominator * 100, proposedPercent = sum.proposed / denominator * 100, disturbancePercent = sum.disturbance / denominator * 100
  return { existingPercent, proposedPercent, disturbancePercent, cumulativePercent: existingPercent + proposedPercent + disturbancePercent }
}
function containsBounds(outer: Bounds, inner: Bounds) { return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3] }
function bounded(geometry: PolygonGeometry) {
  const b = polygonBounds(geometry)
  return (p: { lng: number; lat: number }) => p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3] && pointInPolygon(geometry, p.lng, p.lat)
}
type Pass = { target: PreparedTarget; grid: GridSample[]; samples: GroundPoint[]; areas: Float64Array; normals: Vector3[]; surface: GroundPoint[]; matrix: Uint8Array; any: Uint8Array; distance: Float64Array; visibleArea: Float64Array }
export function computeAnalysis(source: ElevationSource, input: AnalysisInput, terrain: TerrainInfo, onProgress?: (p: AnalysisProgress) => void, canopyStands: CanopyStand[] = [], forestedGround: PolygonGeometry[] = [], context: AnalysisContext = {}): AnalysisResult {
  const start = Date.now(); validate(input)
  const inputSignature = canonicalInput(input), stations = buildStations(input)
  if (!stations.length) throw new Error('Place a viewpoint before running an analysis.')
  const stationPoints = stations.map((s) => ({ ...s, groundElevationMeters: source.elevationAt(s.lng, s.lat) }))
  let prepared = prepareTargets(input, stations)
  let grids: GridSample[][] = []
  for (let attempt = 0; attempt < 8; attempt++) {
    grids = prepared.map((t) => t.inRange || t.role === 'landscape' ? polygonGridSamples(t.geometry, t.spacingMeters) : [])
    const actual = grids.reduce((n, grid, i) => n + (prepared[i].inRange ? grid.length * stations.length : 0), 0)
    if (actual <= MAX_TOTAL_SIGHTLINES) break
    if (attempt === 7) throw new Error('The geometry cannot fit the sightline budget. Use fewer polygons or stations.')
    prepared = prepared.map((t) => ({ ...t, spacingMeters: t.spacingMeters * Math.sqrt(actual / MAX_TOTAL_SIGHTLINES) * 1.05 }))
  }
  const bounds = analysisBounds(input, stations)
  // Partial-opening fractions do not locate leave patches. Do not silently clear their entire canopy.
  const canopy = input.settings.screeningEnabled && canopyStands.length && bounds ? buildCanopyGrid(canopyStands, bounds, prepared.filter((t) => t.role === 'block' || t.role === 'harvested' && t.alterationWeight >= 1).map((t) => t.geometry), { minCrownClosurePercent: input.settings.minCrownClosurePercent }) : null
  const options = { ...DEFAULT_SIGHTLINE_OPTIONS, observerHeightMeters: input.settings.observerHeightMeters, targetOffsetMeters: input.settings.targetOffsetMeters, maxDistanceMeters: input.settings.maxViewDistanceMeters, stepMeters: Math.max(5, terrain.resolutionMeters * 0.9) }
  let completed = 0, lastProgress = 0, unknownSightlines = 0
  const total = grids.reduce((n, grid, i) => n + (prepared[i].inRange ? grid.length * stations.length : 0), 0)
  const passes: Pass[] = prepared.map((target, targetIndex) => {
    const grid = grids[targetIndex], represented = grid.reduce((n, p) => n + p.areaMeters, 0)
    const areas = Float64Array.from(grid.map((p) => p.areaMeters / represented * target.areaMeters))
    const samples = grid.map((p) => ({ lng: p.lng, lat: p.lat, groundElevationMeters: source.elevationAt(p.lng, p.lat) }))
    const normals = samples.map((p) => target.inRange ? terrainNormal(source, p.lng, p.lat, Math.max(5, terrain.resolutionMeters)) : [NaN, NaN, NaN] as Vector3)
    const surface = samples.map((p) => {
      if (target.role !== 'landscape' || !canopy) return p
      const xy = lngLatToMercator(p.lng, p.lat)
      // The landform denominator is the visible canopy envelope, not invisible forest floor.
      return { ...p, groundElevationMeters: p.groundElevationMeters + canopy.heightAtMercator(xy[0], xy[1]) }
    })
    const matrix = new Uint8Array(grid.length * stations.length), any = new Uint8Array(grid.length), distance = new Float64Array(grid.length).fill(-1), visibleArea = new Float64Array(stations.length)
    if (target.inRange) for (let s = 0; s < stations.length; s++) {
      for (let p = 0; p < grid.length; p++) {
        const sight = testSightline(source, stationPoints[s], surface[p], target.role === 'landscape' ? { ...options, targetOffsetMeters: 0 } : options, canopy ?? undefined)
        const code = sight.status === 'unknown' ? 2 : sight.visible ? 1 : 0
        matrix[s * grid.length + p] = code
        if (code === 1) { any[p] = 1; visibleArea[s] += areas[p]; distance[p] = distance[p] < 0 ? sight.distanceMeters : Math.min(distance[p], sight.distanceMeters) }
        else if (code === 2) { unknownSightlines++; if (any[p] !== 1) any[p] = 2 }
      }
      completed += grid.length
      if (onProgress && Date.now() - lastProgress > 80) { lastProgress = Date.now(); onProgress({ phase: 'sightlines', completed, total }) }
    }
    return { target, grid, samples, surface, normals, areas, matrix, any, distance, visibleArea }
  })
  onProgress?.({ phase: 'sightlines', completed: total, total })
  const land = passes.find((p) => p.target.role === 'landscape')
  const inLand = land ? bounded(land.target.geometry) : () => false
  const openings = prepared.filter((t) => t.role === 'harvested' && !t.siteDisturbance && t.alterationWeight > 0).map((t) => ({ weight: t.alterationWeight, contains: bounded(t.geometry), id: t.id }))
  const proposals = prepared.filter((t) => t.role === 'block').map((t) => ({ contains: bounded(t.geometry), id: t.id }))
  const roads = prepared.filter((t) => t.siteDisturbance && t.alterationWeight > 0).map((t) => ({ contains: bounded(t.geometry), id: t.id }))
  const treed = forestedGround.map(bounded)
  // Supplied forest alterations, including access roads, remain in the assessable
  // land base after clearing. The operator must exclude natural non-forest ground.
  const historicForest = prepared.filter((t) => t.role !== 'landscape').map((t) => bounded(t.geometry))
  const vegetation = context.vegetation?.status ?? (forestedGround.length ? 'complete' : 'unavailable')
  const inventoryCoversLand = !!land && (!context.vegetation?.bounds || containsBounds(context.vegetation.bounds, polygonBounds(land.target.geometry)))
  const verifiedGreen = !!input.settings.greenAreaConfirmed || vegetation === 'complete' && inventoryCoversLand
  const greenBasis = input.settings.greenAreaConfirmed ? 'confirmed-landform' : verifiedGreen ? 'inventory-and-openings' : 'unverified-whole-landform'
  const hits = new Map<string, number>()
  const ledger = land?.samples.map((sample) => {
    const existing = openings.filter((o) => o.contains(sample)), proposed = proposals.filter((o) => o.contains(sample)), disturbance = roads.filter((o) => o.contains(sample))
    for (const item of [...existing, ...proposed, ...disturbance]) hits.set(item.id, (hits.get(item.id) ?? 0) + 1)
    return { ...unionContributions(existing.map((o) => o.weight), proposed.length > 0, disturbance.length > 0), green: !verifiedGreen || input.settings.greenAreaConfirmed || treed.some((contains) => contains(sample)) || historicForest.some((contains) => contains(sample)) }
  }) ?? []
  let greenArea = 0
  const plan = zero()
  ledger.forEach((cell, i) => { if (!cell.green) return; const area = land!.areas[i]; greenArea += area; plan.existing += area * cell.existing; plan.proposed += area * cell.proposed; plan.disturbance += area * cell.disturbance })
  let unknownStationCount = 0
  const perspectiveByStation = stationPoints.map((station, s) => {
    if (!land) return null
    if (!Number.isFinite(station.groundElevationMeters)) { unknownStationCount++; return null }
    let denominator = 0, missing = false
    const sum = zero()
    ledger.forEach((cell, i) => {
      if (!cell.green) return
      const visible = land.matrix[s * ledger.length + i]
      if (visible === 2) { missing = true; return }
      if (visible !== 1) return
      if (!land.normals[i].every(Number.isFinite)) { missing = true; return }
      const angle = apparentSolidAngle({ ...station, eyeHeightMeters: input.settings.observerHeightMeters }, land.surface[i], land.areas[i], land.normals[i])
      denominator += angle; sum.existing += angle * cell.existing; sum.proposed += angle * cell.proposed; sum.disturbance += angle * cell.disturbance
    })
    if (missing) { unknownStationCount++; return null }
    return asPercent(denominator, sum)
  })
  let largestVisibleAreaStationIndex = 0, maxGround = -1
  for (let s = 0; s < stations.length; s++) {
    const area = passes.filter((p) => p.target.role === 'block').reduce((n, p) => n + p.visibleArea[s], 0)
    if (area > maxGround) { maxGround = area; largestVisibleAreaStationIndex = s }
  }
  let assessmentStationIndex = largestVisibleAreaStationIndex, maxRatio = -1
  perspectiveByStation.forEach((p, s) => { if (p && p.cumulativePercent > maxRatio) { maxRatio = p.cumulativePercent; assessmentStationIndex = s } })
  const targets: TargetVisibility[] = passes.map((pass) => {
    const n = pass.grid.length, positions = new Float64Array(n * 2), elevations = new Float64Array(n)
    const angles = new Float64Array(stations.length), newAngles = new Float64Array(stations.length), totalAngles = new Float64Array(stations.length)
    const zone = Object.fromEntries(VIEWING_ZONES.map((z) => [z.id, 0]))
    let visibleArea = 0, unknownArea = 0, areaInside = 0, newAreaInside = 0, slopeArea = 0, slopes = 0, heights = 0, nearest: number | null = null, farthest: number | null = null
    for (let i = 0; i < n; i++) {
      const point = pass.samples[i], area = pass.areas[i], normal = pass.normals[i]
      positions[i * 2] = point.lng; positions[i * 2 + 1] = point.lat; elevations[i] = point.groundElevationMeters
      const inside = inLand(point), previous = openings.reduce((best, opening) => opening.contains(point) ? Math.max(best, opening.weight) : best, 0)
      if (inside) { areaInside += area; newAreaInside += area * (pass.target.role === 'block' ? 1 - previous : 1) }
      if (normal.every(Number.isFinite) && normal[2] > 0) { const slope = Math.hypot(normal[0], normal[1]) / normal[2] * 100; slopes += slope * area; heights += vegHeightForSlope(slope) * area; slopeArea += area }
      if (pass.any[i] === 1) { visibleArea += area; const d = pass.distance[i]; zone[viewingZoneFor(d).id] += area; nearest = nearest === null ? d : Math.min(nearest, d); farthest = farthest === null ? d : Math.max(farthest, d) }
      if (pass.any[i] === 2) unknownArea += area
      for (let s = 0; s < stations.length; s++) {
        const angle = apparentSolidAngle({ ...stationPoints[s], eyeHeightMeters: input.settings.observerHeightMeters }, pass.surface[i], area, normal)
        totalAngles[s] += angle
        if (pass.matrix[s * n + i] === 1) { angles[s] += angle; if (inside) newAngles[s] += angle * (pass.target.role === 'block' ? 1 - previous : 1) }
      }
    }
    return { targetId: pass.target.id, role: pass.target.role, positions, elevations, anyVisible: pass.any, visibleByStation: pass.matrix, visibleDistances: pass.distance,
      sampleCount: n, sampleAreaMeters: n ? pass.target.areaMeters / n : 0, areaMeters: pass.target.areaMeters, visibleAreaMeters: visibleArea, visiblePercent: 100 * visibleArea / pass.target.areaMeters, unknownPercent: 100 * unknownArea / pass.target.areaMeters,
      apparentSolidAngle: totalAngles[assessmentStationIndex], visibleApparentSolidAngle: angles[assessmentStationIndex], apparentVisiblePercent: totalAngles[assessmentStationIndex] > 0 ? 100 * angles[assessmentStationIndex] / totalAngles[assessmentStationIndex] : 0,
      visibleAreaByZone: zone, nearestVisibleDistanceMeters: nearest, farthestVisibleDistanceMeters: farthest, meanSlopePercent: slopeArea ? slopes / slopeArea : null, vegHeightMeters: slopeArea ? heights / slopeArea : null,
      forestedAreaMeters: pass.target.role === 'landscape' && verifiedGreen ? greenArea : null,
      areaInsideLandformMeters: land ? areaInside : null, newAreaInsideLandformMeters: land ? newAreaInside : null,
      visibleApparentSolidAngleNew: newAngles[assessmentStationIndex], visibleApparentSolidAngleByStation: angles, visibleApparentSolidAngleNewByStation: newAngles,
      alterationWeight: pass.target.alterationWeight, recovered: pass.target.recovered, siteDisturbance: pass.target.siteDisturbance, outOfRange: !pass.target.inRange,
      stations: stationPoints.map((s, index) => ({ ...s, visiblePercent: 100 * pass.visibleArea[index] / pass.target.areaMeters, unknownPercent: 100 * pass.grid.reduce((area, _, i) => area + (pass.matrix[index * n + i] === 2 ? pass.areas[i] : 0), 0) / pass.target.areaMeters })) }
  })
  const underResolvedTargetIds = land ? passes.filter((p) => p.target.role !== 'landscape' && (p.target.role === 'block' || p.target.alterationWeight > 0) && !hits.has(p.target.id) && p.samples.some(inLand)).map((p) => p.target.id) : []
  let existingInventory = input.harvestInventory?.status ?? 'not-requested'
  if (land && input.harvestInventory?.bounds && !containsBounds(input.harvestInventory.bounds, polygonBounds(land.target.geometry))) existingInventory = 'partial'
  if (input.settings.existingDisturbanceConfirmed) existingInventory = 'scenario-only'
  const existingReady = input.settings.existingDisturbanceConfirmed === true || existingInventory === 'complete'
  const warnings: string[] = []
  if (!verifiedGreen) warnings.push('Green-area coverage is unverified. Whole-landform ratios are provisional and are not inserted into the FS1252 numerical fields.')
  if (!existingReady) warnings.push('Existing disturbance coverage has not been confirmed. A missing inventory is not zero existing alteration.')
  if (unknownSightlines || unknownStationCount) warnings.push('Some terrain/surface sightlines are unknown. Unknown is not screened or visible; no complete worst-case result can be asserted.')
  if (terrain.missingTileCount) warnings.push(`${terrain.missingTileCount} DEM tiles did not load.`)
  if (underResolvedTargetIds.length) warnings.push('An alteration intersects the landform but is missed by its shared grid. Increase the sample budget or assess a shorter corridor before exporting numerical fields.')
  if (input.settings.screeningEnabled && (!canopy || vegetation !== 'complete')) warnings.push('Requested vegetation screening is incomplete; the numerical assessment is provisional.')
  const partialScreening = !!canopy && prepared.some((t) => t.role === 'harvested' && t.alterationWeight > 0 && t.alterationWeight < 1)
  if (partialScreening) warnings.push('Partial-opening fractions do not locate retained patches; retained canopy is not geometrically resolved.')
  warnings.push('Apparent-area integration is a screening approximation, not a calibrated photographic measurement. Grid spacing is not the native accuracy of the elevation source.')
  if (prepared.some((t) => t.role === 'harvested' && !t.siteDisturbance)) warnings.push('Recovery uses an explicit percentage where supplied; otherwise the stated green-up-age planning assumption applies. Neither is an automatic field observation.')
  if (input.settings.targetOffsetMeters !== 0) warnings.push('Target offset is not zero: the sightline target is not the cut surface. Numerical PDF fields are withheld.')
  if (land && !(greenArea > 0)) warnings.push('No assessable green landform area is available as a denominator.')
  if (land && !perspectiveByStation.some((value) => value !== null)) warnings.push('No selected station has a complete visible landform denominator.')
  const numericalReady = input.settings.targetOffsetMeters === 0 && !!land && greenArea > 0 && perspectiveByStation.some((value) => value !== null) && verifiedGreen && !!existingReady && unknownStationCount === 0 && underResolvedTargetIds.length === 0 && (!input.settings.screeningEnabled || !!canopy && vegetation === 'complete' && !partialScreening)
  return { settings: { ...input.settings }, stations: stationPoints, corridorLengthMeters: input.viewpoint.mode === 'corridor' ? lineLengthMeters(input.viewpoint.coordinates) : 0,
    assessmentStationIndex, largestVisibleAreaStationIndex, targets, perspectiveAlteration: perspectiveByStation[assessmentStationIndex], perspectiveByStation,
    planimetricAlteration: land ? asPercent(greenArea, plan) : null, landformAreaMeters: land?.target.areaMeters ?? null, landformForestedAreaMeters: land && verifiedGreen ? greenArea : null,
    recoveredOpeningCount: prepared.filter((t) => t.recovered).length, canopyCoverageFraction: canopy?.coverageFraction() ?? null, canopyStandCount: canopy ? canopyStands.length : 0,
    demTileCount: terrain.tileCount, demResolutionMeters: terrain.resolutionMeters, missingTileCount: terrain.missingTileCount, elapsedMs: Date.now() - start,
    inputSignature, inputSnapshot: JSON.parse(inputSignature) as AnalysisInput, activeLandformId: land?.target.id ?? null, actualSightlineCount: total, renderStands: canopyStands,
    quality: { terrain: unknownSightlines || unknownStationCount ? 'partial' : 'complete', vegetation, existingInventory, greenBasis, unknownSightlines, unknownStationCount, underResolvedTargetIds,
      largestGroundCellPercent: land && greenArea > 0 ? 100 * Math.max(...land.areas) / greenArea : null, numericalReady, warnings } }
}

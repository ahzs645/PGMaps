/**
 * One drainage check: sample the terrain around the road, burn the road prism and culverts in,
 * and compare flow on the existing ground with flow on the design surface. Pure: the terrain is
 * an ElevationSource and the projection is passed in, so a run can be checked outside a browser.
 */
import { burnRoad } from './designSurface'
import { analyzeDrainage, type DrainageAnalysis } from './hydrology'
import { parseDepressionPolicy, type DepressionPolicy } from './drainagePolicies'
import { corridorBounds, sampleSurfaceGrid, type ToGrid, type ToLonLat } from './surfaceGrid'
import type { Culvert, RoadAnalysis, TerrainSource } from './types'
import {
  delineateCatchment,
  delineateWatersheds,
  type CatchmentResult,
  type DrainageGrid,
  type PourPoint,
  type CatchmentProperties,
} from './drainageCatchments'

export interface DrainageSettings {
  /** Design storm intensity, mm/h. */
  rainfallMmPerHr: number
  runoffCoefficient: number
  manningN: number
  /** Contributing area at which a flow line is drawn as a stream, ha. */
  streamThresholdHa: number
  /** Ground sampled beyond the catch lines, so upslope catchments are not cut off, m. */
  bufferM: number
  /** Omitted retains the legacy full Priority-Flood conditioning. */
  depressionPolicy?: DepressionPolicy
  /** Optional coarser working grid; never finer than the source or the 1 m sampling floor. */
  workingResolutionM?: number
}
/** Forested-hillside planning defaults: C 0.35, corrugated steel pipe n 0.024. */
export const DEFAULT_DRAINAGE_SETTINGS: DrainageSettings = {
  rainfallMmPerHr: 50,
  runoffCoefficient: 0.35,
  manningN: 0.024,
  streamThresholdHa: 1,
  bufferM: 250,
}

export interface DrainageRun extends DrainageAnalysis {
  cellM: number
  cells: number
  changedCells: number
  settings: DrainageSettings
  /** Actual sampling decisions, including automatic coarsening to fit the cell budget. */
  resolution: {
    sourceM: number
    requestedM?: number
    minimumM: number
    actualM: number
    maxCells: number
    coarsenedForBudget: boolean
  }
  /** Features for the plan, each with a `role` (see PlanView's `drainage` prop). */
  plan: GeoJSON.FeatureCollection
  grid: DrainageGrid
  catchment?: CatchmentResult
  watersheds?: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, CatchmentProperties>
}

export function runDrainage({
  terrain,
  analysis,
  culverts,
  toGrid,
  toLonLat,
  resolutionM,
  settings,
  maxCells = 4_194_304,
  pourPoint,
  watershedMinAreaHa,
}: {
  terrain: TerrainSource
  analysis: RoadAnalysis
  culverts: Culvert[]
  toGrid: ToGrid
  toLonLat: ToLonLat
  /** The terrain's native resolution: the grid is never finer than its source. */
  resolutionM: number
  settings: DrainageSettings
  maxCells?: number
  pourPoint?: PourPoint
  /** Omitted skips watershed partitioning. Zero includes every raster outlet basin within the output budget. */
  watershedMinAreaHa?: number
}): DrainageRun {
  if (!Number.isFinite(resolutionM) || resolutionM <= 0 || resolutionM > 100_000)
    throw Error('The source resolution must be greater than zero and at most 100,000 m.')
  if (
    settings.workingResolutionM !== undefined &&
    (!Number.isFinite(settings.workingResolutionM) ||
      settings.workingResolutionM <= 0 ||
      settings.workingResolutionM > 100_000)
  )
    throw Error('The working resolution must be greater than zero and at most 100,000 m.')
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 4_194_304)
    throw Error('The drainage cell budget must be from 1 to 4,194,304 cells.')
  const depressionPolicy = parseDepressionPolicy(settings.depressionPolicy)
  const minimumM = Math.max(1, resolutionM, settings.workingResolutionM ?? 0)
  if (!analysis.stations.some((s) => s.designElevation !== null))
    throw Error('The road has no design elevations on this terrain, so there is no design surface to route over.')
  const bounds = corridorBounds(analysis, toGrid, settings.bufferM)
  const existing = sampleSurfaceGrid(terrain, bounds, toLonLat, { cellM: minimumM, maxCells })
  const burned = burnRoad(existing, analysis, toGrid, { culverts })
  const result = analyzeDrainage({
    existing,
    design: burned.surface,
    footprint: burned.footprint,
    channels: burned.channels,
    analysis,
    culverts,
    toGrid,
    toLonLat,
    rainfallMmPerHr: settings.rainfallMmPerHr,
    runoffCoefficient: settings.runoffCoefficient,
    manningN: settings.manningN,
    streamThresholdM2: settings.streamThresholdHa * 10_000,
    depressionPolicy,
  })
  result.warnings.push(
    'Contributing areas stop at the sampled buffer and terrain-data edges. Increase the upslope buffer and compare catchments before relying on the flow estimate.',
  )
  if (existing.cellM > minimumM)
    result.warnings.push(
      `The working grid was coarsened from ${minimumM.toFixed(2)} m to ${existing.cellM.toFixed(2)} m to fit the ${maxCells.toLocaleString('en-CA')}-cell budget.`,
    )
  if (settings.workingResolutionM !== undefined && settings.workingResolutionM < Math.max(1, resolutionM))
    result.warnings.push(
      'The requested working resolution was limited by the source resolution and the 1 m sampling floor.',
    )
  if (depressionPolicy.mode !== 'fill-all')
    result.warnings.push(
      depressionPolicy.mode === 'preserve'
        ? 'Depressions remain unfilled for flow routing. Interior sinks retain contributing area; reported ponding is potential depth to spill, not simulated water storage.'
        : `Only connected depressions requiring at most ${depressionPolicy.maxDepthM} m of fill were conditioned. Deeper depressions remain sinks; reported ponding is potential depth to spill.`,
    )
  if (
    depressionPolicy.mode !== 'fill-all' &&
    result.existing.conditioning.interiorSinkCells + result.design.conditioning.interiorSinkCells > 0
  )
    result.warnings.push(
      'Retained closed flats can have multiple terminal cells. A selected sink catchment may cover only part of a closed flat depression; inspect nearby sinks and ponding before treating it as the whole basin.',
    )
  let missingCells = 0
  for (const value of existing.values) if (!Number.isFinite(value)) missingCells++
  if (missingCells)
    result.warnings.push(
      `${missingCells.toLocaleString('en-CA')} sampled cells have no ground. Data gaps act as outlets and can cut off upstream catchments; load terrain covering the contributing area.`,
    )
  if (existing.cellM > 2)
    result.warnings.push(
      `${existing.cellM.toFixed(2)} m cells may not resolve narrow ditches or culvert channels. Use finer bare-earth terrain to review local drainage details.`,
    )
  for (const culvert of result.culverts)
    if (culvert.existingAreaHa >= 0.05 && culvert.designAreaHa < culvert.existingAreaHa / 2)
      result.warnings.push(
        `${culvert.name}: the modeled design catchment (${culvert.designAreaHa.toFixed(2)} ha) is much smaller than the existing-ground catchment (${culvert.existingAreaHa.toFixed(2)} ha). Inspect diverted flow, the inlet location and terrain detail before relying on this pipe check.`,
      )
  const grid: DrainageGrid = {
    origin: existing.origin,
    cellM: existing.cellM,
    width: existing.width,
    height: existing.height,
  }
  const catchmentSurface = pourPoint?.surface === 'existing' ? result.existing : result.design
  const catchment = pourPoint
    ? delineateCatchment(
        grid,
        catchmentSurface.directions,
        catchmentSurface.accumulation,
        pourPoint,
        toGrid,
        toLonLat,
        pourPoint.surface === 'existing' ? existing.values : burned.surface.values,
      )
    : undefined
  const watersheds =
    watershedMinAreaHa === undefined
      ? undefined
      : delineateWatersheds(grid, catchmentSurface.directions, toLonLat, {
          minAreaHa: watershedMinAreaHa,
          surface: pourPoint?.surface ?? 'design',
        })
  if (catchment?.feature.properties.truncated)
    result.warnings.push(
      'The selected catchment touches the sampled grid edge or missing terrain. Its area may be truncated; expand terrain/buffer and compare.',
    )
  const features: GeoJSON.Feature[] = [
    ...(watersheds?.features ?? []),
    ...(catchment
      ? [
          catchment.feature,
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: catchment.snappedCoordinate },
            properties: {
              role: 'pour-point',
              areaHa: catchment.feature.properties.areaHa,
              snapPolicy: catchment.snapPolicy,
              snappedDistanceM: catchment.snappedDistanceM,
              outletCell: catchment.outletCell,
              ...(catchment.selectedElevationM === undefined
                ? {}
                : { selectedElevationM: catchment.selectedElevationM }),
            },
          },
        ]
      : []),
    ...result.existing.streams.features.map((f) => ({
      ...f,
      properties: { ...f.properties, role: 'stream-existing' },
    })),
    ...result.design.streams.features.map((f) => ({ ...f, properties: { ...f.properties, role: 'stream-design' } })),
    ...result.crossings
      .filter((c) => c.redirected && !c.throughCulvertId)
      .map(
        (c): GeoJSON.Feature => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [c.coordinate, c.exitCoordinate] },
          properties: { role: 'diversion', id: c.id, divertedM: c.divertedM },
        }),
      ),
    ...result.lowPoints
      .filter((p) => !p.throughCulvert)
      .map(
        (p): GeoJSON.Feature => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p.coordinate },
          properties: { role: 'low-point', id: p.id, areaHa: p.areaHa },
        }),
      ),
    ...result.newPonding.ponds.features.map((f) => ({ ...f, properties: { ...f.properties, role: 'pond' } })),
  ]
  return {
    ...result,
    cellM: existing.cellM,
    cells: existing.width * existing.height,
    changedCells: burned.changedCells,
    settings: { ...settings, depressionPolicy },
    resolution: {
      sourceM: resolutionM,
      ...(settings.workingResolutionM === undefined ? {} : { requestedM: settings.workingResolutionM }),
      minimumM,
      actualM: existing.cellM,
      maxCells,
      coarsenedForBudget: existing.cellM > minimumM,
    },
    grid,
    catchment,
    watersheds,
    plan: { type: 'FeatureCollection', features },
  }
}

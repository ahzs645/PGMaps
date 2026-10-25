/**
 * One drainage check: sample the terrain around the road, burn the road prism and culverts in,
 * and compare flow on the existing ground with flow on the design surface. Pure: the terrain is
 * an ElevationSource and the projection is passed in, so a run can be checked outside a browser.
 */
import { burnRoad } from './designSurface'
import { analyzeDrainage, type DrainageAnalysis } from './hydrology'
import { corridorBounds, sampleSurfaceGrid, type ToGrid, type ToLonLat } from './surfaceGrid'
import type { Culvert, RoadAnalysis, TerrainSource } from './types'

export interface DrainageSettings {
  /** Design storm intensity, mm/h. */
  rainfallMmPerHr: number
  runoffCoefficient: number
  manningN: number
  /** Contributing area at which a flow line is drawn as a stream, ha. */
  streamThresholdHa: number
  /** Ground sampled beyond the catch lines, so upslope catchments are not cut off, m. */
  bufferM: number
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
  /** Features for the plan, each with a `role` (see PlanView's `drainage` prop). */
  plan: GeoJSON.FeatureCollection
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
}): DrainageRun {
  if (!analysis.stations.some((s) => s.designElevation !== null))
    throw Error('The road has no design elevations on this terrain, so there is no design surface to route over.')
  const bounds = corridorBounds(analysis, toGrid, settings.bufferM)
  const existing = sampleSurfaceGrid(terrain, bounds, toLonLat, { cellM: Math.max(1, resolutionM), maxCells })
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
  })
  result.warnings.push(
    'Contributing areas stop at the sampled buffer and terrain-data edges. Increase the upslope buffer and compare catchments before relying on the flow estimate.',
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
  const features: GeoJSON.Feature[] = [
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
    settings,
    plan: { type: 'FeatureCollection', features },
  }
}

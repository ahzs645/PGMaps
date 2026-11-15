/**
 * Roads written back as the same thing they can be opened from: a zipped RoadEng project holding a
 * design (`.dsnx`, `roadEngExport.ts`) and its terrain (`.terx`, `roadEngTerrainExport.ts`), so a
 * project goes to RoadEng and comes back whole.
 *
 * - **Grid.** The caller's export grid; a project on the flat plane writes its file's own
 *   coordinates ({@link roadEngExportGrid}), so a design opened without a CRS goes back where it was.
 * - **Ground.** The project's terrain grid, clipped to {@link ROADENG_EXPORT_CORRIDOR_M} either side
 *   of the roads and thinned to the writer's vertex budget. A terrain held as tiles (regional DEM)
 *   or the training terrain has no grid to write, so the project goes without ground and says so.
 * - **Drawn layers.** The inverse of `roadEngProject.ts`: streams, existing roads, D-lines, proposed
 *   harvest blocks (felling boundaries), avoidance areas (boundaries) and reference layers, each at
 *   the terrain's level where it has one. A feature imported from RoadEng keeps its class.
 *
 * Pure: no DOM or network access.
 */
import type { LocalRaster } from '../dev-forestry/types'
import type { XY } from './landXmlImport'
import { localPlaneProjection, isLocalPlane } from './localPlane'
import type { ReferenceFeature } from './referenceFeatures'
import { roadEngDesign, type RoadEngExportRoad } from './roadEngExport'
import {
  roadEngProjectFileNames,
  roadEngProjectZip,
  roadEngTerrainArchive,
  type RoadEngExportFeature,
  type RoadEngExportFeatureKind,
} from './roadEngTerrainExport'
import type { CableLine, ContextFeature, Coordinate, TerrainMetadata } from './types'

/** Ground kept either side of the exported roads, m. */
export const ROADENG_EXPORT_CORRIDOR_M = 250

export interface RoadEngExportGrid {
  /** The CRS the coordinates are in; null for a project on the flat plane (its file's own grid). */
  epsg: number | null
  toGrid: (c: Coordinate) => XY
  /** The project's terrain grid in this grid, when it has one. */
  raster: LocalRaster | null
}

/**
 * Where a RoadEng export writes coordinates: the export grid, or on the flat plane the file's own
 * coordinates (plane + offset), with the terrain grid moved the same way.
 */
export function roadEngExportGrid(
  terrain: TerrainMetadata,
  exportGrid: { epsg: number; toGrid: (c: Coordinate) => XY },
): RoadEngExportGrid {
  // A grid with no levels (a design opened without terrain) is no ground to write.
  const levelled = terrain.raster?.values.some((v) => v !== null) ? terrain.raster : null
  if (isLocalPlane(terrain) && terrain.localPlane) {
    const { offsetM } = terrain.localPlane
    const raster = levelled
      ? { ...levelled, origin: [levelled.origin[0] + offsetM[0], levelled.origin[1] + offsetM[1]] as [number, number] }
      : null
    return { epsg: null, toGrid: localPlaneProjection(offsetM).toFile, raster }
  }
  const raster = levelled && levelled.epsg === exportGrid.epsg ? levelled : null
  return { epsg: exportGrid.epsg, toGrid: exportGrid.toGrid, raster }
}

/** What a road project's own layers become in a RoadEng terrain. */
function drawnFeatures(
  parts: { context: readonly ContextFeature[]; cables: readonly CableLine[]; reference: readonly ReferenceFeature[] },
  toGrid: (c: Coordinate) => XY,
  level: (c: Coordinate) => number | undefined,
): RoadEngExportFeature[] {
  const point = (c: Coordinate): readonly [number, number, number?] => {
    const [x, y] = toGrid(c),
      z = level(c)
    return z === undefined ? [x, y] : [x, y, z]
  }
  const from = (name: string, kind: RoadEngExportFeatureKind, coords: readonly Coordinate[], closed = false) => ({
    name,
    kind,
    points: coords.map(point),
    ...(closed ? { closed } : {}),
  })
  const out: RoadEngExportFeature[] = []
  for (const f of parts.context) {
    const ring = f.geometry.type === 'Polygon' ? (f.geometry.coordinates[0] as Coordinate[]) : null
    const line = f.geometry.type === 'LineString' ? (f.geometry.coordinates as Coordinate[]) : null
    if (f.kind === 'stream' && line) out.push(from(f.name, 'stream', line))
    else if (f.kind === 'existing-road' && line) out.push(from(f.name, 'road', line))
    else if (f.kind === 'harvest' && ring) out.push(from(f.name, 'falling-boundary', ring, true))
    else if (ring) out.push(from(f.name, 'boundary', ring, true))
    else if (line) out.push(from(f.name, 'other', line))
  }
  for (const c of parts.cables) out.push(from(c.name, 'd-line', [c.start, c.end]))
  const KINDS: Record<string, RoadEngExportFeatureKind> = {
    landing: 'landing',
    boundary: 'boundary',
    stream: 'stream',
    road: 'road',
    'd-line': 'd-line',
  }
  for (const r of parts.reference) {
    const kind = KINDS[String(r.attributes?.roadEngClass ?? '')] ?? (r.geometry.type === 'Point' ? 'landing' : 'other')
    const g = r.geometry
    if (g.type === 'Point') out.push(from(r.name, kind, [g.coordinates as Coordinate]))
    else if (g.type === 'LineString') out.push(from(r.name, kind, g.coordinates as Coordinate[]))
    else if (g.type === 'MultiLineString')
      g.coordinates.forEach((part, k) => out.push(from(`${r.name} ${k + 1}`, kind, part as Coordinate[])))
    else if (g.type === 'Polygon') out.push(from(r.name, kind, g.coordinates[0] as Coordinate[], true))
  }
  return out
}

/** The zipped RoadEng project for some roads of a project. */
export function roadEngProjectExport(input: {
  name: string
  roads: readonly RoadEngExportRoad[]
  grid: RoadEngExportGrid
  context: readonly ContextFeature[]
  cables: readonly CableLine[]
  reference: readonly ReferenceFeature[]
  /** Terrain level at a place, for drawn features. */
  elevationAt?: (c: Coordinate) => number
  designSpeedKmh?: number
}): { bytes: Uint8Array; fileName: string; notes: string[] } {
  const files = roadEngProjectFileNames(input.name)
  const design = roadEngDesign(input.roads, input.grid.toGrid, {
    terrainName: files.terrain,
    ...(input.designSpeedKmh ? { designSpeedKmh: input.designSpeedKmh } : {}),
  })
  const level = (c: Coordinate) => {
    const z = input.elevationAt?.(c)
    return z !== undefined && Number.isFinite(z) ? z : undefined
  }
  const terrain = roadEngTerrainArchive({
    raster: input.grid.raster,
    corridor: {
      lines: input.roads.map((road) => road.alignment.points.map((p) => input.grid.toGrid(p.coordinate))),
      halfWidthM: ROADENG_EXPORT_CORRIDOR_M,
    },
    features: drawnFeatures(input, input.grid.toGrid, level),
    coordSys: input.grid.epsg === null ? null : { epsg: input.grid.epsg },
  })
  const notes = [
    ...design.notes,
    ...(input.grid.raster
      ? []
      : ['This project has no terrain grid with levels to write, so the RoadEng project goes without ground.']),
    ...terrain.notes,
  ]
  return {
    bytes: roadEngProjectZip({ name: files.stem, design: design.bytes, terrain: terrain.bytes }),
    fileName: files.zip,
    notes,
  }
}

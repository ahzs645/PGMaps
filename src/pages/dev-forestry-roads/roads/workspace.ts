/** Adapters between the metric raster model and the georeferenced road-design workspace. */
import type { Alignment, Coordinate, RoadProject, RoadTemplate, TerrainSource } from '../types'
import { localMetricGrid } from '../terrain'
import { cellCentre, cellIndexAt } from '../surfaceGrid'
import { prepExData } from './examples'
import { getDistFromSource, getLandingsFromTarget, rasterizeLine } from './utilities'
import type { RoadsGrid, RoadsInput, RoadsLanding, RoadsPath, RoadsResultSummary } from './types'
import {
  MAX_NETWORK_CELLS,
  MAX_NETWORK_TARGETS,
  networkSeedReason,
  parseNetworkPlanning,
  type NetworkPlanning,
  type NetworkTarget,
} from './planning'
export { createNetworkPlanning, networkSeedReason, parseNetworkPlanning, parseNetworkScenario } from './planning'
export type { NetworkPlanning, NetworkTarget } from './planning'

export interface PreparedNetworkScenario {
  input: RoadsInput
  stages: RoadsLanding[][]
  epsg: number | null
  toLonLat?: (xy: [number, number]) => Coordinate
  planning: NetworkPlanning
  provenance: string
  canAdopt: boolean
  warnings: string[]
}
export interface PrepareNetworkOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
}
const yieldUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
function inRing(point: [number, number], ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i]
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}
function inPolygon(point: [number, number], rings: number[][][]): boolean {
  return inRing(point, rings[0]) && !rings.slice(1).some((ring) => inRing(point, ring))
}

/** Conservative occupied-cell mask: includes boundary cells, even for sub-cell exclusion slivers. */
function polygonCells(grid: RoadsGrid, rings: [number, number][][]): number[] {
  if (!rings[0]?.length) return []
  const xs = rings[0].map((p) => p[0]),
    ys = rings[0].map((p) => p[1])
  const c0 = Math.max(0, Math.floor((Math.min(...xs) - grid.origin[0]) / grid.cellM)),
    c1 = Math.min(grid.width - 1, Math.ceil((Math.max(...xs) - grid.origin[0]) / grid.cellM)),
    r0 = Math.max(0, Math.floor((grid.origin[1] - Math.max(...ys)) / grid.cellM)),
    r1 = Math.min(grid.height - 1, Math.ceil((grid.origin[1] - Math.min(...ys)) / grid.cellM))
  if ((c1 - c0 + 1) * (r1 - r0 + 1) * rings.reduce((n, ring) => n + ring.length, 0) > 30_000_000)
    throw Error('A constraint is too complex for this grid. Crop the planning area or increase cell size.')
  const result = new Set(rasterizeLine(rings, grid, { includeNoData: true }))
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) {
      const index = row * grid.width + col
      if (inPolygon(cellCentre(grid, index), rings)) result.add(index)
    }
  return [...result]
}

export async function prepareNetworkScenario(
  project: RoadProject,
  source: TerrainSource,
  rawPlanning: NetworkPlanning,
  { signal, onProgress }: PrepareNetworkOptions = {},
): Promise<PreparedNetworkScenario> {
  signal?.throwIfAborted()
  let planning = parseNetworkPlanning(rawPlanning)
  if (planning.mode === 'example') {
    if (planning.importedScenario) {
      const imported = planning.importedScenario
      const input: RoadsInput = {
        grid: { ...imported.grid, values: Float64Array.from(imported.grid.values, (v) => v ?? NaN) },
        roadCells: [...imported.roadCells],
        landings: imported.landings,
        options: planning.options,
        ...(imported.elevations ? { elevations: Float64Array.from(imported.elevations, (v) => v ?? NaN) } : {}),
      }
      return {
        input,
        stages: imported.stages ?? [input.landings],
        epsg: null,
        planning,
        provenance: imported.provenance,
        canAdopt: false,
        warnings: [
          'Imported raster coordinates are retained as local scenario coordinates; these results cannot be adopted into an unrelated terrain project.',
        ],
      }
    }
    const example = prepExData(planning.exampleId)
    const input = { ...example.input, options: { ...example.input.options, ...planning.options } }
    return {
      input,
      stages: example.stages?.map((stage) => stage.landings) ?? [input.landings],
      epsg: null,
      planning,
      provenance: `Synthetic ${example.name}. ${example.description}`,
      canAdopt: false,
      warnings: ['Example rasters use local coordinates, with no geographic or survey datum.'],
    }
  }
  // Geographic planning always keeps measured terrain independent of road/cost codes and treats
  // excluded cells conservatively. Strict upstream experiments belong to the local raster mode.
  planning = { ...planning, options: { ...planning.options, gradeMode: 'terrain', preventCornerCutting: true } }
  if (!planning.roadIds.length) throw Error('Select at least one reviewed existing road to seed the network.')
  if (!planning.targets.length) throw Error('Add landing targets or generate them from harvest polygons.')
  const roads = planning.roadIds.map((id) => {
    const road = project.context.find((item) => item.id === id)
    if (!road) throw Error(`Selected road ${id} no longer exists. Select current source roads.`)
    const reason = networkSeedReason(road)
    if (reason) throw Error(`${road.name}: ${reason}`)
    return road
  })
  const reference = planning.targets[0].coordinate
  const projection = localMetricGrid(reference)
  const lines = roads.map((road) =>
    (road.geometry as GeoJSON.LineString).coordinates.map((p) => projection.toGrid([p[0], p[1]])),
  )
  const points = [...lines.flat(), ...planning.targets.map((target) => projection.toGrid(target.coordinate))]
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  const minX = Math.min(...xs) - planning.marginM,
    maxX = Math.max(...xs) + planning.marginM,
    minY = Math.min(...ys) - planning.marginM,
    maxY = Math.max(...ys) + planning.marginM
  if (maxX - minX > 100_000 || maxY - minY > 100_000)
    throw Error('Crop network planning to a local area at most 100 km across.')
  const cellM = Math.max(planning.cellM, project.terrain.resolutionM)
  const width = Math.max(2, Math.ceil((maxX - minX) / cellM) + 1),
    height = Math.max(2, Math.ceil((maxY - minY) / cellM) + 1)
  if (width * height > MAX_NETWORK_CELLS) {
    const suggested = Math.ceil(Math.sqrt(((maxX - minX) * (maxY - minY)) / (MAX_NETWORK_CELLS * 0.95)))
    throw Error(
      `This area needs ${(width * height).toLocaleString()} cells; the limit is ${MAX_NETWORK_CELLS.toLocaleString()}. Use at least ${suggested} m cells, reduce the margin, or select shorter road sections.`,
    )
  }
  const grid: RoadsGrid = { origin: [minX, maxY], cellM, width, height, values: new Float64Array(width * height) }
  const elevations = new Float64Array(width * height)
  onProgress?.(`Sampling ${grid.values.length.toLocaleString()} terrain cells…`)
  let missing = 0
  for (let i = 0; i < grid.values.length; i++) {
    if (i % 2048 === 0) {
      signal?.throwIfAborted()
      await yieldUi()
    }
    const [lon, lat] = projection.toLonLat(cellCentre(grid, i)),
      z = source.elevationAt(lon, lat)
    elevations[i] = Number.isFinite(z) ? z : NaN
    grid.values[i] = Number.isFinite(z) ? planning.baseWeight : NaN
    if (!Number.isFinite(z)) missing++
  }
  const warnings: string[] = []
  if (cellM > planning.cellM)
    warnings.push(`Grid spacing raised to source resolution (${cellM} m); no finer terrain was invented.`)
  if (missing) warnings.push(`${missing.toLocaleString()} cells have missing terrain and are blocked.`)
  onProgress?.('Applying exclusion areas and relative crossing weights…')
  for (const feature of project.context) {
    signal?.throwIfAborted()
    if (feature.kind === 'avoid' && feature.geometry.type === 'Polygon') {
      const rings = feature.geometry.coordinates.map((ring) => ring.map((p) => projection.toGrid([p[0], p[1]])))
      for (const index of polygonCells(grid, rings)) {
        // A hard mask never becomes traversable by selecting a road that crosses it.
        if (feature.routeCostPerM === undefined) {
          grid.values[index] = NaN
          elevations[index] = NaN
        } else if (Number.isFinite(grid.values[index])) {
          if (planning.options.weightFunction === 'grade' && planning.options.gradeMode === 'upstream')
            throw Error(
              'Soft avoidance zones cannot share an overloaded elevation raster. Use terrain-aware grade mode or simple weights.',
            )
          grid.values[index] += feature.routeCostPerM
        }
      }
    }
    await yieldUi()
  }
  if (project.context.some((f) => f.kind === 'avoid' && f.routeCostPerM !== undefined))
    warnings.push(
      'Soft-zone values are added to relative cell weights; terrain-aware grade costs are multiplied by those weights. They are not a complete construction estimate.',
    )
  if (project.context.some((f) => f.kind === 'stream'))
    warnings.push(
      'Streams are shown in the detailed designer. This raster projection does not price or size crossing structures; use hard exclusions or an explicit cost raster to control crossings.',
    )
  const roadCells = rasterizeLine(lines, grid)
  if (!roadCells.length) throw Error('No selected source-road cells remain inside covered, unblocked terrain.')
  const landings = planning.targets.map((target) => {
    const [x, y] = projection.toGrid(target.coordinate)
    return { id: target.id, name: target.name, cell: cellIndexAt(grid, x, y) }
  })
  const stages = [...new Set(planning.targets.map((t) => t.stage))]
    .sort((a, b) => a - b)
    .map((stage) => landings.filter((_, i) => planning.targets[i].stage === stage))
  if (planning.options.weightFunction === 'grade' && planning.options.gradeMode === 'upstream')
    warnings.push(
      'Upstream grade mode uses elevation values as weights; burning roads to zero retains the R package’s road/elevation grade-limit behaviour.',
    )
  const input: RoadsInput = { grid, roadCells, landings, options: planning.options, elevations }
  return {
    input,
    stages,
    epsg: projection.epsg,
    toLonLat: projection.toLonLat,
    planning,
    canAdopt: true,
    warnings,
    provenance: `${project.terrain.name}; ${project.terrain.verticalReference}; EPSG:${projection.epsg}; ${cellM} m sampled grid. Road cells are raster approximations; review exact junction positions after adoption.`,
  }
}

export async function generateNetworkTargets(
  project: RoadProject,
  source: TerrainSource,
  planning: NetworkPlanning,
): Promise<NetworkTarget[]> {
  const blocks = project.context.filter((f) => f.kind === 'harvest' && f.geometry.type === 'Polygon')
  if (!blocks.length) throw Error('Import or draw harvest polygons before generating landing targets.')
  const at = (blocks[0].geometry as GeoJSON.Polygon).coordinates[0][0] as Coordinate,
    projection = localMetricGrid(at)
  const targets = blocks.map((block) => ({
    id: block.id,
    name: block.name,
    polygons: [
      (block.geometry as GeoJSON.Polygon).coordinates.map((ring) => ring.map((p) => projection.toGrid([p[0], p[1]]))),
    ],
  }))
  const generated = getLandingsFromTarget(targets, {
    sampleType: planning.landingMethod === 'systematic' ? 'regular' : planning.landingMethod,
    densityPerHa: planning.landingDensity,
    seed: planning.randomSeed,
  })
  const result: NetworkTarget[] = []
  const perBlock = new Map<string, number>()
  for (const point of generated) perBlock.set(point.targetId, (perBlock.get(point.targetId) ?? 0) + 1)
  let missingTerrain = 0,
    blocked = 0
  for (const point of generated) {
    const coordinate = projection.toLonLat(point.point)
    if (!Number.isFinite(source.elevationAt(...coordinate))) {
      missingTerrain++
      continue
    }
    if (
      project.context.some(
        (f) =>
          f.kind === 'avoid' &&
          f.geometry.type === 'Polygon' &&
          f.routeCostPerM === undefined &&
          inPolygon(coordinate, f.geometry.coordinates),
      )
    ) {
      blocked++
      continue
    }
    result.push({
      id: `landing-${result.length + 1}`,
      // Several density-sampled landings in one block would otherwise share the block's name.
      name:
        point.name && (perBlock.get(point.targetId) ?? 0) > 1
          ? `${point.name} · ${point.id.slice(point.targetId.length + 1)}`
          : (point.name ?? `Landing ${result.length + 1}`),
      coordinate,
      stage: 1,
    })
    if (result.length > MAX_NETWORK_TARGETS)
      throw Error(`Generated more than ${MAX_NETWORK_TARGETS} targets. Reduce density or the number of harvest blocks.`)
  }
  if (missingTerrain || blocked)
    throw Error(
      `${missingTerrain} generated targets lack terrain and ${blocked} fall in hard exclusions. No target list was replaced. Adjust the sampling or place targets manually; unsupported harvest blocks cannot be silently omitted.`,
    )
  if (!result.length)
    throw Error('No generated targets have covered, unblocked terrain. Review the harvest polygons and DEM.')
  return result
}

export function networkOverlay(
  prepared: PreparedNetworkScenario,
  result: RoadsResultSummary,
  selectedPathId?: string,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (!prepared.toLonLat) return { type: 'FeatureCollection', features }
  const coordinate = (cell: number) => prepared.toLonLat!(cellCentre(prepared.input.grid, cell))
  for (const path of result.paths)
    if (path.cells.length > 1)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: path.cells.map(coordinate) },
        properties: {
          kind: 'network-projection',
          id: path.id,
          label: `${result.method.toUpperCase()} · ${path.id}`,
          color: '#7c3aed',
          selected: path.id === selectedPathId,
        },
      })
  for (const target of result.targets)
    if (target.cell >= 0 && target.cell < prepared.input.grid.values.length)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coordinate(target.cell) },
        properties: {
          kind: 'network-landing',
          id: target.id,
          label: `${target.name ?? target.id} · ${target.status}`,
          color: ['connected', 'already-connected'].includes(target.status) ? '#0f766e' : '#dc2626',
        },
      })
  return { type: 'FeatureCollection', features }
}

/** Keep only exactly collinear steps; smoothing can cross a blocked cell. */
export function networkPathAlignment(
  prepared: PreparedNetworkScenario,
  path: RoadsPath,
  template: RoadTemplate,
): Alignment {
  if (!prepared.canAdopt || !prepared.toLonLat)
    throw Error('Local-coordinate example results cannot be adopted into a geographic terrain project.')
  if (path.cells.length < 2) throw Error('Choose a path containing at least two cells.')
  const grid = prepared.input.grid,
    seeds = new Set(prepared.input.roadCells)
  let start = 0,
    end = path.cells.length - 1
  while (start < end && seeds.has(path.cells[start]) && seeds.has(path.cells[start + 1])) start++
  while (end > start && seeds.has(path.cells[end]) && seeds.has(path.cells[end - 1])) end--
  const branch = path.cells.slice(start, end + 1)
  if (branch.length < 2) throw Error('This path only reuses source roads; it has no new branch to design.')
  // LCP/ILCP route from the landing to the road. Station a branch from its road junction outward,
  // so 0+000 is the junction and the landing is at the far end, as with the designer's own roads.
  const landingCells = new Set(prepared.input.landings.map((landing) => landing.cell))
  if (landingCells.has(branch[0]) && !landingCells.has(branch[branch.length - 1])) branch.reverse()
  if (branch.some((cell, i) => i > 0 && seeds.has(cell) && seeds.has(branch[i - 1])))
    throw Error(
      'This path contains an existing-road section between new branches. Split those branches before designing their construction quantities.',
    )
  const cells = branch.filter((cell, i) => {
    if (!i || i === branch.length - 1) return true
    const a = cellCentre(grid, branch[i - 1]),
      b = cellCentre(grid, cell),
      c = cellCentre(grid, branch[i + 1])
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      ex = c[0] - b[0],
      ey = c[1] - b[1]
    return Math.abs(dx * ey - dy * ex) > 1e-7 || dx * ex + dy * ey <= 0
  })
  if (cells.length > 2000)
    throw Error('This path exceeds the 2,000-point design limit; use a coarser planning grid or adopt a shorter path.')
  const id = crypto.randomUUID()
  return {
    id,
    name: `${prepared.planning.options.method.toUpperCase()} network branch · ${path.id}`,
    color: '#7c3aed',
    points: cells.map((cell, i) => ({
      id: `${id}-${i}`,
      coordinate: prepared.toLonLat!(cellCentre(grid, cell)),
      radiusM: 0,
    })),
    vertical: [],
    template: structuredClone(template),
    overrides: [],
  }
}

function csv(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let s = String(value ?? '')
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
export function networkResultsCsv(result: RoadsResultSummary): string {
  const rows: unknown[][] = [
    ['record', 'id', 'status', 'length_m', 'new_length_m', 'reused_length_m', 'relative_objective', 'target_ids'],
    [
      'summary',
      result.method,
      '',
      result.newLengthM + result.reusedLengthM,
      result.newLengthM,
      result.reusedLengthM,
      result.objective,
      '',
    ],
  ]
  for (const path of result.paths)
    rows.push([
      'path',
      path.id,
      'projected',
      path.lengthM,
      path.newLengthM,
      path.reusedLengthM,
      path.objective,
      path.targetIds.join(';'),
    ])
  for (const target of result.targets)
    rows.push(['target', target.id, target.status, '', '', '', '', target.pathIds.join(';')])
  return rows.map((row) => row.map(csv).join(',')).join('\r\n') + '\r\n'
}
export function networkGridCsv(prepared: PreparedNetworkScenario, result?: RoadsResultSummary): string {
  const grid = prepared.input.grid,
    seeds = new Set(prepared.input.roadCells),
    proposed = new Set(result?.paths.flatMap((p) => p.cells) ?? [])
  const rows = ['cell,x_m,y_m,weight,elevation_m,seed_road,projected_road,epsg']
  for (let i = 0; i < grid.values.length; i++)
    rows.push(
      [
        i,
        ...cellCentre(grid, i),
        grid.values[i],
        prepared.input.elevations?.[i],
        seeds.has(i) ? 1 : 0,
        proposed.has(i) ? 1 : 0,
        prepared.epsg,
      ]
        .map(csv)
        .join(','),
    )
  return rows.join('\r\n') + '\r\n'
}
export function networkDistanceCsv(prepared: PreparedNetworkScenario): string {
  const distance = getDistFromSource(prepared.input.grid, prepared.input.roadCells)
  const rows = ['cell,x_m,y_m,euclidean_distance_to_seed_m']
  for (let i = 0; i < distance.values.length; i++)
    rows.push([i, ...cellCentre(distance, i), distance.values[i]].map(csv).join(','))
  return rows.join('\r\n') + '\r\n'
}
export function serializeNetworkScenario(prepared: PreparedNetworkScenario, results: RoadsResultSummary[]): string {
  const { input } = prepared
  const array = (v: Float64Array) => Array.from(v, (n) => (Number.isFinite(n) ? n : null))
  return (
    JSON.stringify(
      {
        schema: 'pgmaps-road-network-planning-v1',
        planning: { ...prepared.planning, importedScenario: undefined },
        provenance: prepared.provenance,
        epsg: prepared.epsg,
        warnings: prepared.warnings,
        input: {
          ...input,
          grid: { ...input.grid, values: array(input.grid.values) },
          ...(input.elevations ? { elevations: array(input.elevations) } : {}),
        },
        stages: prepared.stages,
        results: results.map(({ simulation, ...result }) => ({
          ...result,
          stage: simulation.stage,
          cumulativeNewLengthM: simulation.cumulativeNewLengthM,
          cumulativeObjective: simulation.cumulativeObjective,
        })),
      },
      null,
      2,
    ) + '\n'
  )
}

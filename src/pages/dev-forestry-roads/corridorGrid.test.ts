import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sampleCorridorGrid } from './corridorGrid'
import { burnRoad } from './designSurface'
import { delineateCatchment, delineateWatersheds, type PourPoint } from './drainageCatchments'
import { DEFAULT_DRAINAGE_SETTINGS, runDrainage, type DrainageSettings } from './drainageRun'
import { analyzeRoad, positionAt } from './engine'
import {
  analyzeDrainage,
  conditionDrainageSurface,
  extractStreams,
  flowAccumulation,
  MISSING,
  type DrainageAnalysis,
} from './hydrology'
import { parseProject } from './project'
import { roadEngProject } from './roadEngProject'
import {
  cellCentre,
  cellIndexAt,
  cellRowCol,
  corridorBounds,
  gridCellIndex,
  sampleSurfaceGrid,
  TILE_NO_GROUND,
  TILE_NOT_SAMPLED,
  type GridTiles,
  type SurfaceGrid,
  type ToGrid,
  type ToLonLat,
} from './surfaceGrid'
import {
  createDemoProject,
  DEFAULT_ROAD_SETTINGS,
  DEFAULT_TEMPLATE,
  localMetricGrid,
  terrainFromMetadata,
} from './terrain'
import { terrainGridCellM } from './tinGround'
import type { Alignment, Culvert, RoadAnalysis, TerrainSource } from './types'

/** The same grid with only the tiles `keep` accepts held, laid out as `sampleCorridorGrid` lays them. */
function tileGrid(dense: SurfaceGrid, shift: number, keep: (tx: number, ty: number) => boolean): SurfaceGrid {
  const side = 1 << shift,
    across = Math.ceil(dense.width / side),
    down = Math.ceil(dense.height / side)
  const position = new Int32Array(across * down).fill(TILE_NOT_SAMPLED),
    held = new Int32Array(down),
    rowBase = new Int32Array(down + 1),
    columnStart = new Int32Array(down + 1)
  const columns: number[] = [],
    rowOfBlock: number[] = []
  for (let ty = 0; ty < down; ty++) {
    columnStart[ty] = columns.length
    rowBase[ty] = rowOfBlock.length * side * side
    for (let tx = 0; tx < across; tx++)
      if (keep(tx, ty)) {
        position[ty * across + tx] = held[ty]++
        columns.push(tx)
        rowOfBlock.push(ty)
      } else position[ty * across + tx] = TILE_NO_GROUND
  }
  rowBase[down] = rowOfBlock.length * side * side
  columnStart[down] = columns.length
  const tiles: GridTiles = {
    side,
    shift,
    across,
    down,
    position,
    held,
    rowBase,
    columns: Int32Array.from(columns),
    columnStart,
    rowOfBlock: Int32Array.from(rowOfBlock),
  }
  const grid: SurfaceGrid = { ...dense, values: new Float64Array(rowBase[down]).fill(NaN), tiles }
  for (let row = 0; row < dense.height; row++)
    for (let col = 0; col < dense.width; col++) {
      const i = gridCellIndex(grid, row, col)
      if (i >= 0) grid.values[i] = dense.values[row * dense.width + col]
    }
  return grid
}

/** Dense index of every stored cell inside the grid, in storage order. */
function denseIndices(grid: SurfaceGrid): number[] {
  const out: number[] = []
  for (let i = 0; i < grid.values.length; i++) {
    const [row, col] = cellRowCol(grid, i)
    if (row < grid.height && col < grid.width) out.push(row * grid.width + col)
  }
  return out
}

describe('tiled drainage grid', () => {
  it('addresses cells in the full grid’s row-major order, and absent tiles have no index', () => {
    const dense: SurfaceGrid = {
      origin: [0, 0],
      cellM: 1,
      width: 13,
      height: 9,
      values: Float64Array.from({ length: 117 }, (_, i) => i),
    }
    const tiled = tileGrid(dense, 2, (tx, ty) => !(tx === 1 && ty === 1))
    const order = denseIndices(tiled)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    for (let i = 0; i < tiled.values.length; i++) {
      const [row, col] = cellRowCol(tiled, i)
      if (row >= dense.height || col >= dense.width) {
        expect(tiled.values[i]).toBeNaN()
        continue
      }
      expect(tiled.values[i]).toBe(row * 13 + col)
      expect(gridCellIndex(tiled, row, col)).toBe(i)
      expect(cellCentre(tiled, i)).toEqual(cellCentre(dense, row * 13 + col))
    }
    // Tile (1, 1) holds rows 4–7, columns 4–7.
    expect(gridCellIndex(tiled, 5, 5)).toBe(-1)
    expect(cellIndexAt(tiled, 5, -5)).toBe(-1)
    expect(cellIndexAt(tiled, 3, -5)).toBe(gridCellIndex(tiled, 5, 3))
  })

  it('routes a tiled grid exactly as the dense one under every depression policy', () => {
    const w = 77,
      h = 61
    const values = new Float64Array(w * h)
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        // A tilted surface with closed pits, a level flat and a hole of missing ground.
        const pit = Math.hypot(r - 20, c - 30) < 5 ? -1.2 : 0
        const flat = r > 40 && r < 46 && c > 10 && c < 30
        const hole = Math.hypot(r - 50, c - 60) < 4
        values[r * w + c] = hole
          ? NaN
          : flat
            ? 30
            : 50 - 0.3 * r + 0.1 * c + 0.8 * Math.sin(c / 3) * Math.cos(r / 4) + pit
      }
    // Ground missing beyond a band, so the dropped tiles hold none.
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (c > 62 && r < 16) values[r * w + c] = NaN
    const dense: SurfaceGrid = { origin: [500, 900], cellM: 2, width: w, height: h, values }
    const tiled = tileGrid(dense, 3, (tx, ty) => !(tx >= 8 && ty <= 1))
    const order = denseIndices(tiled)
    for (const policy of [
      undefined,
      { mode: 'preserve' as const },
      { mode: 'depth-limited' as const, maxDepthM: 0.5 },
    ]) {
      const a = conditionDrainageSurface(dense, policy),
        b = conditionDrainageSurface(tiled, policy)
      expect(b.diagnostics).toEqual(a.diagnostics)
      const accA = flowAccumulation(a.directions, dense),
        accB = flowAccumulation(b.directions, tiled)
      // Each stored cell: same direction (or missing), same contributing area, same fill depth.
      for (let i = 0; i < order.length; i++) {
        const k = order[i],
          j = gridCellIndex(tiled, Math.floor(k / w), k % w)
        expect(b.directions[j]).toBe(a.directions[k])
        expect(accB[j]).toBe(accA[k])
        expect(Object.is(b.depth[j], a.depth[k]) || b.depth[j] === a.depth[k]).toBe(true)
      }
      const toLonLat: ToLonLat = ([x, y]) => [x, y]
      expect(extractStreams(accB, b.directions, tiled, toLonLat, { thresholdM2: 200 })).toEqual(
        extractStreams(accA, a.directions, dense, toLonLat, { thresholdM2: 200 }),
      )
    }
  })
})

// A winding road on a generated hillside whose ground lies only within 110 m of the road, like a
// RoadEng TIN surveyed along its line, with a hole in it and a gully the road crosses on a culvert.
const projection = localMetricGrid([-122.5, 54])
const [ox, oy] = projection.toGrid([-122.5, 54])
const at = (x: number, y: number) => projection.toLonLat([ox + x, oy + y])
const bend = [
  [0, 0],
  [320, 160],
  [640, -60],
  [960, 210],
  [1280, 20],
] as const
function distanceToBend(x: number, y: number) {
  let best = Infinity
  for (let k = 1; k < bend.length; k++) {
    const [ax, ay] = bend[k - 1],
      [bx, by] = bend[k]
    const dx = bx - ax,
      dy = by - ay,
      t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t))
  }
  return best
}
const hillside = (x: number, y: number) =>
  700 + 0.09 * y + 0.025 * x + 2.5 * Math.sin(x / 41) * Math.cos(y / 57) - 5 * Math.exp(-((x - 470) ** 2) / 900)
const corridorTerrain: TerrainSource = {
  elevationAt(lon, lat) {
    const [gx, gy] = projection.toGrid([lon, lat])
    const x = gx - ox,
      y = gy - oy
    if (distanceToBend(x, y) > 110) return NaN
    if (Math.hypot(x - 800, y - 150) < 14) return NaN
    return hillside(x, y)
  },
}
const winding: Alignment = {
  id: 'winding',
  name: 'Winding',
  color: '#16817a',
  points: bend.map(([x, y], k) => ({ id: `p${k}`, coordinate: at(x, y), radiusM: k && k < bend.length - 1 ? 80 : 0 })),
  vertical: [],
  template: DEFAULT_TEMPLATE,
  overrides: [],
}
const groundLine = (alignment: Alignment, length: number): Alignment => ({
  ...alignment,
  vertical: Array.from({ length: Math.floor(length / 150) + 2 }, (_, k) => {
    const chainage = Math.min(length, k * 150)
    const [x, y] = projection.toGrid(positionAt(alignment, chainage).coordinate)
    return { id: `v${k}`, chainage, elevation: hillside(x - ox, y - oy) + 0.4, curveLength: 0 }
  }).filter((v, k, all) => k === 0 || v.chainage > all[k - 1].chainage),
})
const culvert = (chainage: number): Culvert => ({
  id: 'gully',
  name: 'Gully CMP',
  chainage,
  skewDegrees: 0,
  lengthM: 18,
  diameterM: 0.8,
  inletInvertM: null,
  outletInvertM: null,
  minCoverM: 0.3,
  unitCost: 0,
  fixedCost: 0,
})

/** The run as it was before routing followed the road: one dense grid over the corridor's box. */
function denseRun(
  terrain: TerrainSource,
  analysis: RoadAnalysis,
  culverts: Culvert[],
  toGrid: ToGrid,
  toLonLat: ToLonLat,
  cellM: number,
  settings: DrainageSettings,
  pourPoint: PourPoint,
): DrainageAnalysis & { cellM: number; catchment: unknown; watersheds: unknown } {
  const existing = sampleSurfaceGrid(terrain, corridorBounds(analysis, toGrid, settings.bufferM), toLonLat, {
    cellM,
    maxCells: 4_194_304,
  })
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
  return {
    ...result,
    cellM: existing.cellM,
    catchment: delineateCatchment(
      existing,
      result.design.directions,
      result.design.accumulation,
      pourPoint,
      toGrid,
      toLonLat,
      burned.surface.values,
    ),
    watersheds: delineateWatersheds(existing, result.design.directions, toLonLat, { minAreaHa: 0.5 }),
  }
}
const comparable = (run: DrainageAnalysis & { catchment?: unknown; watersheds?: unknown }) => ({
  crossings: run.crossings,
  lowPoints: run.lowPoints,
  newPonding: run.newPonding,
  culverts: run.culverts,
  existingStreams: run.existing.streams,
  designStreams: run.design.streams,
  existingPonding: run.existing.ponding,
  designPonding: run.design.ponding,
  conditioning: [run.existing.conditioning, run.design.conditioning],
  catchment: run.catchment,
  watersheds: run.watersheds,
})

describe('drainage routed along the road', () => {
  const analysis0 = analyzeRoad(winding, corridorTerrain, DEFAULT_ROAD_SETTINGS)
  const road = groundLine(winding, analysis0.length)
  const analysis = analyzeRoad(road, corridorTerrain, DEFAULT_ROAD_SETTINGS)
  const gully = analysis.stations.reduce((best, s) => {
    const [x] = projection.toGrid(s.coordinate)
    return Math.abs(x - ox - 470) < Math.abs(projection.toGrid(best.coordinate)[0] - ox - 470) ? s : best
  })
  const culverts = [culvert(Math.round(gully.chainage))]
  const settings: DrainageSettings = { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 150, streamThresholdHa: 0.3 }
  const pourPoint: PourPoint = { coordinate: gully.coordinate, snapRadiusM: 30, surface: 'design' }

  it('finds the same streams, crossings, cross-drain candidates, ponds and catchments as a dense run', () => {
    const dense = denseRun(
      corridorTerrain,
      analysis,
      culverts,
      projection.toGrid,
      projection.toLonLat,
      2,
      settings,
      pourPoint,
    )
    const tiled = runDrainage({
      terrain: corridorTerrain,
      analysis,
      culverts,
      ...projection,
      resolutionM: 2,
      settings,
      pourPoint,
      watershedMinAreaHa: 0.5,
    })
    expect(tiled.cellM).toBe(dense.cellM)
    // The road crosses the gully, and the comparison has something to compare.
    expect(dense.crossings.length).toBeGreaterThan(0)
    expect(dense.lowPoints.length).toBeGreaterThan(0)
    expect(dense.culverts).toHaveLength(1)
    expect(dense.design.streams.features.length).toBeGreaterThan(3)
    expect(comparable(tiled)).toEqual(comparable(dense))
    // Fewer cells than the box, every one of the box's ground cells among them.
    expect(tiled.domain.routedCells).toBeLessThan(tiled.domain.boxCells)
    const box = sampleSurfaceGrid(
      corridorTerrain,
      corridorBounds(analysis, projection.toGrid, settings.bufferM),
      projection.toLonLat,
      { cellM: 2 },
    )
    expect(tiled.domain.groundCells).toBe(box.values.filter(Number.isFinite).length)
  })

  it('keeps missing ground missing: the hole and the ground’s edge are no data, never routed through', () => {
    const run = runDrainage({ terrain: corridorTerrain, analysis, culverts, ...projection, resolutionM: 2, settings })
    const hole = cellIndexAt(
      { ...run.grid, tiles: undefined },
      ...(projection.toGrid(at(800, 150)) as [number, number]),
    )
    expect(hole).toBeGreaterThanOrEqual(0)
    // The hole's cell is in a held tile (it lies within the buffer) and reads as missing on both surfaces.
    const corridor = sampleCorridorGrid(corridorTerrain, analysis, projection.toGrid, projection.toLonLat, {
      bufferM: settings.bufferM,
      cellM: 2,
    })
    const i = cellIndexAt(corridor.grid, ...(projection.toGrid(at(800, 150)) as [number, number]))
    expect(i).toBeGreaterThanOrEqual(0)
    expect(corridor.grid.values[i]).toBeNaN()
    // Beyond the buffer nothing is sampled; within it, tiles with no ground are dropped.
    const kinds = new Set(corridor.grid.tiles.position.filter((p) => p < 0))
    expect(kinds).toEqual(new Set([TILE_NOT_SAMPLED, TILE_NO_GROUND]))
    expect(run.existing.directions[i]).toBe(MISSING)
    expect(run.existing.accumulation[i]).toBe(0)
    expect(run.warnings.join(' ')).toMatch(/sampled cells have no ground/)
  })

  it('limits the cells routed, not the box: a winding road keeps its cell where the box would not fit', () => {
    const box = corridorBounds(analysis, projection.toGrid, settings.bufferM)
    const boxCells = (Math.floor((box[2] - box[0]) / 2) + 1) * (Math.floor((box[3] - box[1]) / 2) + 1)
    const corridor = sampleCorridorGrid(corridorTerrain, analysis, projection.toGrid, projection.toLonLat, {
      bufferM: settings.bufferM,
      cellM: 2,
    })
    const maxCells = Math.ceil((corridor.storedCells + boxCells) / 2)
    expect(maxCells).toBeLessThan(boxCells)
    const run = runDrainage({
      terrain: corridorTerrain,
      analysis,
      culverts,
      ...projection,
      resolutionM: 2,
      settings,
      maxCells,
    })
    expect(run.cellM).toBe(2)
    expect(run.resolution.coarsenedForBudget).toBe(false)
    expect(run.cells).toBe(corridor.heldCells)
    // A budget under the road's own cells coarsens, and says the budget is on routed cells.
    const coarse = runDrainage({
      terrain: corridorTerrain,
      analysis,
      culverts,
      ...projection,
      resolutionM: 2,
      settings,
      maxCells: Math.floor(corridor.storedCells / 3),
    })
    expect(coarse.cellM).toBeGreaterThan(2)
    expect(coarse.warnings.join(' ')).toMatch(/budget of routed cells/)
  })
})

const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples)('LongRoad drainage along its TIN (ROADENG_SAMPLES)', () => {
  it('routes at the TIN’s own cell, and at the old cell matches the dense run exactly', () => {
    let n = 0
    const files = ['LongRoad_1/LongRoad 1.dsnx', 'LongRoad_1/LongRoad 1.terx']
    const read = roadEngProject(
      files.map((f) => ({ name: f.split('/').pop()!, bytes: new Uint8Array(readFileSync(join(samples!, f))) })),
      {
        newId: () => `id${n++}`,
        color: () => '#123456',
        template: { ...DEFAULT_TEMPLATE },
        verticalReference: 'CGVD2013',
      },
    )
    const demo = createDemoProject()
    const project = parseProject({
      ...demo,
      name: read.name,
      terrain: read.terrain,
      alignments: read.roads.map((r) => r.alignment),
      activeAlignmentId: read.roads[0].alignment.id,
      context: read.context,
      cables: read.cables,
      reference: read.reference,
      profiles: [],
    })
    const terrain = terrainFromMetadata(project.terrain)!
    const alignment = project.alignments[0]
    const analysis = analyzeRoad(alignment, terrain, project.settings)
    const grid = localMetricGrid(alignment.points[0].coordinate)
    const resolutionM = terrainGridCellM(project.terrain)
    const culverts = alignment.engineering?.culverts ?? []
    const own = runDrainage({
      terrain,
      analysis,
      culverts,
      ...grid,
      resolutionM,
      settings: DEFAULT_DRAINAGE_SETTINGS,
    })
    expect(own.cellM).toBe(resolutionM)
    expect(own.resolution.coarsenedForBudget).toBe(false)
    expect(own.cells).toBeLessThan(1_000_000)
    expect(own.domain.boxCells).toBeGreaterThan(4_194_304)
    // The cell the dense box had to take (7.67 m): every cell of TIN ground is routed, and every result is the same.
    const oldCell = 7.665039062500001
    const settings = { ...DEFAULT_DRAINAGE_SETTINGS, workingResolutionM: oldCell }
    const pourPoint: PourPoint = { coordinate: analysis.stations[400].coordinate, snapRadiusM: 50, surface: 'design' }
    const tiled = runDrainage({
      terrain,
      analysis,
      culverts,
      ...grid,
      resolutionM,
      settings,
      pourPoint,
      watershedMinAreaHa: 0.5,
    })
    const dense = denseRun(terrain, analysis, culverts, grid.toGrid, grid.toLonLat, oldCell, settings, pourPoint)
    expect(dense.cellM).toBe(oldCell)
    expect(tiled.cellM).toBe(oldCell)
    expect(comparable(tiled)).toEqual(comparable(dense))
    expect(tiled.crossings.length).toBe(48)
    expect(tiled.lowPoints.length).toBe(242)
  }, 120_000)
})

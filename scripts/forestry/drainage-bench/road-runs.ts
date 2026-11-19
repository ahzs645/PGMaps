/**
 * The road check's own outputs under each conditioning: a road is pegged along a mapped road on the
 * bench tile (its grade following the ground, as a reconstruction would), and the drainage check's
 * crossings, cross-drain candidates and new ponding are compared with the existing ground and the
 * design surface conditioned five ways:
 *
 * - `fill-all`, `preserve`, `depth-0.5`: PGMaps' policies, as the Drainage view runs them;
 * - `breach-existing`: the existing ground breached by Whitebox (`--max_dist`, `--fill_deps`) before
 *   the road is burned in, then full fill, so only the LiDAR's own dams are cut;
 * - `breach-both`: the design surface breached as well, so the new prism can be cut too;
 * - `burn-existing`: Whitebox's `burn_streams_at_roads` cuts the existing ground only where a mapped
 *   FWA stream crosses a mapped road (25 m wide), then full fill.
 *
 * The grid is one dense box over the corridor (as before tiling), so Whitebox can read it; the
 * policies' own runs are identical on it.
 *
 *   node --import tsx scripts/forestry/drainage-bench/road-runs.ts <inputs dir> <out.json> \
 *     [--tiles a,b] [--roads 2] [--buffer 150] [--breach-dist 100] [--png dir]
 */
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { burnRoad } from '../../../src/pages/dev-forestry-roads/designSurface'
import { DEFAULT_DRAINAGE_SETTINGS } from '../../../src/pages/dev-forestry-roads/drainageRun'
import type { DepressionPolicy } from '../../../src/pages/dev-forestry-roads/drainagePolicies'
import { analyzeRoad, positionAt } from '../../../src/pages/dev-forestry-roads/engine'
import { analyzeDrainage, type DrainageAnalysis } from '../../../src/pages/dev-forestry-roads/hydrology'
import {
  corridorBounds,
  sampleBilinear,
  sampleSurfaceGrid,
  type SurfaceGrid,
} from '../../../src/pages/dev-forestry-roads/surfaceGrid'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from '../../../src/pages/dev-forestry-roads/terrain'
import type { Alignment, RoadAnalysis, TerrainSource } from '../../../src/pages/dev-forestry-roads/types'
import { burnStreamsAtRoads, readTile, type Line, type Tile } from './inputs'
import { hillshade, writeMap } from './render'
import { gridToTiff, tiffToGrid, tool } from './whitebox'

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const [inputs, out] = argv
assert(inputs && out && !inputs.startsWith('--'), 'Usage: road-runs.ts <inputs dir> <out.json> [options]')
const tiles = flag('tiles')?.split(',') ?? readdirSync(inputs).filter((d) => !d.startsWith('.'))
const roadsPerTile = Number(flag('roads') ?? 2)
const bufferM = Number(flag('buffer') ?? 150)
const breachDist = Number(flag('breach-dist') ?? 100)
const pngDir = flag('png')
/** Road points are this far apart; the mapped line's own vertices are closer than a peg would be. */
const PEG_SPACING_M = 40
/** Low points this close in chainage are the same cross-drain site in two runs (`CROSS_DRAIN_SITE_M`). */
const SAME_SITE_M = 40
const t0 = performance.now()
const log = (...m: unknown[]) => console.error(`[${((performance.now() - t0) / 1000).toFixed(0)} s]`, ...m)

/** The longest stretch of `line` whose every point lies `margin` m inside the tile's ground. */
function innerStretch(tile: Tile, line: Line, margin: number): Line {
  const g = tile.dem
  const inside = ([x, y]: [number, number]) =>
    x - g.origin[0] > margin &&
    g.origin[0] + (g.width - 1) * g.cellM - x > margin &&
    g.origin[1] - y > margin &&
    y - (g.origin[1] - (g.height - 1) * g.cellM) > margin &&
    Number.isFinite(sampleBilinear(g, x, y))
  let best: Line = [],
    run: Line = []
  for (const p of line) {
    if (inside(p)) run.push(p)
    else run = []
    if (length(run) > length(best)) best = [...run]
  }
  return best
}
const length = (line: Line) =>
  line.reduce((s, p, k) => (k ? s + Math.hypot(p[0] - line[k - 1][0], p[1] - line[k - 1][1]) : 0), 0)

function resample(line: Line, spacing: number): Line {
  const total = length(line),
    n = Math.max(1, Math.round(total / spacing))
  const out: Line = []
  let k = 1,
    walked = 0
  for (let s = 0; s <= n; s++) {
    const target = (total * s) / n
    while (
      k < line.length - 1 &&
      walked + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]) < target
    ) {
      walked += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1])
      k++
    }
    const seg = Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]) || 1,
      t = Math.min(1, (target - walked) / seg)
    out.push([line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t])
  }
  return out
}

function roadOn(tile: Tile, line: Line, terrain: TerrainSource, id: string): RoadAnalysis {
  const points = resample(line, PEG_SPACING_M).map((xy, k) => ({
    id: `p${k}`,
    coordinate: tile.toLonLat(xy),
    radiusM: 0,
  }))
  const base: Alignment = {
    id,
    name: id,
    color: '#16817a',
    points,
    vertical: [],
    template: DEFAULT_TEMPLATE,
    overrides: [],
  }
  const plain = analyzeRoad(base, terrain, DEFAULT_ROAD_SETTINGS)
  // Grade follows the ground 0.4 m up, a PVI every 150 m: a road rebuilt on its own line.
  const vertical = Array.from({ length: Math.floor(plain.length / 150) + 2 }, (_, k) => {
    const chainage = Math.min(plain.length, k * 150)
    const [lon, lat] = positionAt(base, chainage).coordinate
    return { id: `v${k}`, chainage, elevation: terrain.elevationAt(lon, lat) + 0.4, curveLength: 0 }
  }).filter((v, k, all) => (k === 0 || v.chainage > all[k - 1].chainage) && Number.isFinite(v.elevation))
  return analyzeRoad({ ...base, vertical }, terrain, DEFAULT_ROAD_SETTINGS)
}

async function breach(grid: SurfaceGrid, epsg: number): Promise<SurfaceGrid> {
  const run = await tool(
    'breach_depressions_least_cost',
    ['--input=/work/d.tif', '--output=/work/o.tif', `--max_dist=${breachDist}`, '--fill_deps=true'],
    { 'd.tif': await gridToTiff(grid, epsg) },
  )
  const values = (await tiffToGrid(run.files['o.tif'])).values
  return { ...grid, values }
}

function summary(run: DrainageAnalysis) {
  return {
    crossings: run.crossings.length,
    crossingsRedirected: run.crossings.filter((c) => c.redirected).length,
    crossingAreaHa: Number(run.crossings.reduce((s, c) => s + c.areaHa, 0).toFixed(2)),
    crossDrainSites: run.lowPoints.length,
    crossDrainSitesPond: run.lowPoints.filter((p) => p.kind === 'pond').length,
    crossDrainSiteAreaHa: Number(run.lowPoints.reduce((s, p) => s + p.areaHa, 0).toFixed(2)),
    newPondingM2: Math.round(run.newPonding.areaM2),
    existingPondingM2: Math.round(run.existing.ponding.areaM2),
    existingInteriorSinks: run.existing.conditioning.interiorSinkCells,
    designInteriorSinks: run.design.conditioning.interiorSinkCells,
  }
}

/** Sites of `a` with a site of `b` within `SAME_SITE_M` along the road, and both counts. */
/** Mapped FWA stream crossings of this road (within 15 m of its line) that a modelled crossing lies within 50 m of. */
function mappedCrossingsFound(tile: Tile, line: Line, run: DrainageAnalysis) {
  const nearLine = (x: number, y: number) =>
    line.some((p, k) => {
      if (!k) return false
      const [ax, ay] = line[k - 1],
        dx = p[0] - ax,
        dy = p[1] - ay,
        t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      return Math.hypot(x - ax - dx * t, y - ay - dy * t) <= 15
    })
  const mapped = tile.crossings.filter((c) => nearLine(c.x, c.y))
  const found = mapped.filter((c) =>
    run.crossings.some((m) => {
      const [x, y] = tile.toGrid(m.coordinate as [number, number])
      return Math.hypot(x - c.x, y - c.y) <= 50
    }),
  )
  return { mapped: mapped.length, found: found.length }
}

function sameSites(a: { chainage: number }[], b: { chainage: number }[]) {
  const matched = a.filter((p) => b.some((q) => Math.abs(q.chainage - p.chainage) <= SAME_SITE_M)).length
  return {
    matched,
    onlyInBaseline: a.length - matched,
    onlyHere: b.length - b.filter((q) => a.some((p) => Math.abs(q.chainage - p.chainage) <= SAME_SITE_M)).length,
  }
}

/**
 * Existing-ground streams under full fill (blue) and after breaching (red), both (purple), the road's
 * footprint (yellow), mapped FWA streams (cyan) and each run's crossings and cross-drain sites
 * (squares: fill-all blue, breach red; sites outlined).
 */
async function drawRun(
  file: string,
  tile: Tile,
  box: SurfaceGrid,
  footprint: Uint8Array,
  fill: DrainageAnalysis,
  breached: DrainageAnalysis,
) {
  const threshold = DEFAULT_DRAINAGE_SETTINGS.streamThresholdHa * 10_000
  const a = (i: number) => fill.existing.accumulation[i] >= threshold,
    b = (i: number) => breached.existing.accumulation[i] >= threshold
  const fwa = new Uint8Array(box.values.length)
  for (const { line } of tile.streams)
    for (let k = 1; k < line.length; k++) {
      const n = Math.ceil(Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]) * 2)
      for (let s = 0; s <= n; s++) {
        const x = line[k - 1][0] + ((line[k][0] - line[k - 1][0]) * s) / n,
          y = line[k - 1][1] + ((line[k][1] - line[k - 1][1]) * s) / n
        const col = Math.round((x - box.origin[0]) / box.cellM),
          row = Math.round((box.origin[1] - y) / box.cellM)
        if (row >= 0 && col >= 0 && row < box.height && col < box.width) fwa[row * box.width + col] = 1
      }
    }
  const marks = new Uint8Array(box.values.length)
  const mark = (lonLat: [number, number], value: number, r: number, ring: boolean) => {
    const [x, y] = tile.toGrid(lonLat)
    const col = Math.round((x - box.origin[0]) / box.cellM),
      row = Math.round((box.origin[1] - y) / box.cellM)
    for (let dr = -r; dr <= r; dr++)
      for (let dc = -r; dc <= r; dc++) {
        if (ring && Math.max(Math.abs(dr), Math.abs(dc)) < r - 1) continue
        const rr = row + dr,
          cc = col + dc
        if (rr >= 0 && cc >= 0 && rr < box.height && cc < box.width) marks[rr * box.width + cc] = value
      }
  }
  for (const c of fill.crossings) mark(c.coordinate as [number, number], 1, 6, false)
  for (const c of breached.crossings) mark(c.coordinate as [number, number], 2, 4, false)
  for (const p of fill.lowPoints) mark(p.coordinate as [number, number], 1, 9, true)
  for (const p of breached.lowPoints) mark(p.coordinate as [number, number], 2, 12, true)
  await writeMap(file, box, hillshade(box), [
    { mask: (i) => footprint[i] === 1, color: [250, 210, 0], alpha: 0.35 },
    { mask: (i) => fwa[i] === 1, color: [0, 200, 220] },
    { mask: (i) => a(i) && !b(i), color: [30, 110, 255] },
    { mask: (i) => b(i) && !a(i), color: [230, 20, 20] },
    { mask: (i) => a(i) && b(i), color: [110, 0, 140] },
    { mask: (i) => marks[i] === 1, color: [30, 110, 255] },
    { mask: (i) => marks[i] === 2, color: [230, 20, 20] },
  ])
}

const results: Record<string, unknown> = {}
for (const name of tiles) {
  const tile = await readTile(path.join(inputs, name))
  const terrain: TerrainSource = {
    elevationAt: (lon, lat) => {
      const [x, y] = tile.toGrid([lon, lat])
      return sampleBilinear(tile.dem, x, y)
    },
  }
  const lines = tile.roads
    .map((line) => innerStretch(tile, line, 40))
    .filter((line) => length(line) >= 300)
    .sort((a, b) => length(b) - length(a))
  // Two stretches of one road are one road: skip a line starting near one already taken.
  const chosen: Line[] = []
  for (const line of lines) {
    if (chosen.length >= roadsPerTile) break
    if (chosen.some((c) => c.some((p) => Math.hypot(p[0] - line[0][0], p[1] - line[0][1]) < 30))) continue
    chosen.push(line)
  }
  results[name] = []
  for (const [k, line] of chosen.entries()) {
    const id = `${name}-road${k + 1}`
    log(id, `${Math.round(length(line))} m`)
    const analysis = roadOn(tile, line, terrain, id)
    const toGrid = tile.toGrid as (c: [number, number]) => [number, number]
    const box = sampleSurfaceGrid(terrain, corridorBounds(analysis, toGrid, bufferM), tile.toLonLat, { cellM: 1 })
    const settings = DEFAULT_DRAINAGE_SETTINGS
    const run = (existing: SurfaceGrid, design: ReturnType<typeof burnRoad>, policy?: DepressionPolicy) =>
      analyzeDrainage({
        existing,
        design: design.surface,
        footprint: design.footprint,
        channels: design.channels,
        analysis,
        culverts: [],
        toGrid,
        toLonLat: tile.toLonLat,
        rainfallMmPerHr: settings.rainfallMmPerHr,
        runoffCoefficient: settings.runoffCoefficient,
        manningN: settings.manningN,
        streamThresholdM2: settings.streamThresholdHa * 10_000,
        ...(policy ? { depressionPolicy: policy } : {}),
      })
    const burned = burnRoad(box, analysis, toGrid, { culverts: [] })
    const breachedBox = await breach(box, tile.epsg)
    const burnedBox = {
      ...box,
      values: (await tiffToGrid((await burnStreamsAtRoads(tile, await gridToTiff(box, tile.epsg), 25)).files['o.tif']))
        .values,
    }
    const burnedOnBreached = burnRoad(breachedBox, analysis, toGrid, { culverts: [] })
    const breachedDesign = { ...burnedOnBreached, surface: await breach(burnedOnBreached.surface, tile.epsg) }
    const runs: Record<string, DrainageAnalysis> = {
      'fill-all': run(box, burned),
      preserve: run(box, burned, { mode: 'preserve' }),
      'depth-0.5': run(box, burned, { mode: 'depth-limited', maxDepthM: 0.5 }),
      'breach-existing': run(breachedBox, burnedOnBreached),
      'breach-both': run(breachedBox, breachedDesign),
      'burn-existing': run(burnedBox, burnRoad(burnedBox, analysis, toGrid, { culverts: [] })),
    }
    const base = runs['fill-all']
    if (pngDir)
      await drawRun(path.join(pngDir, `${id}.png`), tile, box, burned.footprint, base, runs['breach-existing'])
    ;(results[name] as unknown[]).push({
      road: id,
      lengthM: Math.round(analysis.length),
      cells: box.width * box.height,
      runs: Object.fromEntries(
        Object.entries(runs).map(([key, r]) => [
          key,
          {
            ...summary(r),
            sitesAgainstFillAll: sameSites(base.lowPoints, r.lowPoints),
            mappedCrossings: mappedCrossingsFound(tile, line, r),
            crossingsAgainstFillAll: sameSites(base.crossings, r.crossings),
          },
        ]),
      ),
      sites: Object.fromEntries(
        Object.entries(runs).map(([key, r]) => [
          key,
          r.lowPoints.map((p) => ({
            chainage: Math.round(p.chainage),
            kind: p.kind,
            areaHa: Number(p.areaHa.toFixed(2)),
            depthM: Number(p.depthM.toFixed(2)),
          })),
        ]),
      ),
      crossingList: Object.fromEntries(
        Object.entries(runs).map(([key, r]) => [
          key,
          r.crossings.map((c) => ({
            chainage: Math.round(c.chainage),
            areaHa: Number(c.areaHa.toFixed(2)),
            exitChainage: Math.round(c.exitChainage),
            redirected: c.redirected,
          })),
        ]),
      ),
    })
  }
  await writeFile(out, JSON.stringify({ bufferM, breachDist, tiles: results }, null, 1))
}
log('wrote', out)

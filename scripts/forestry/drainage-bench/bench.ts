/**
 * Drainage conditioning bench: PGMaps' depression policies (`conditionDrainageSurface`) against
 * WhiteboxTools' `fill_depressions` and `breach_depressions_least_cost` (Lindsay 2016), on real
 * 1 m LiDAR tiles with mapped roads. Read-only: writes a JSON summary and PNG maps to `<out>`.
 * See README.md for the inputs and `docs/research/drainage-breaching-2026-11-18.md` for findings.
 *
 *   node --import tsx scripts/forestry/drainage-bench/bench.ts <inputs dir> <out dir> \
 *     [--tiles a,b] [--threshold-ha 1] [--breach-dist 20,100] [--no-png] [--context]
 */
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  conditionDrainageSurface,
  extractStreams,
  flowAccumulation,
  flowDirections,
  MISSING,
  OUTLET,
} from '../../../src/pages/dev-forestry-roads/hydrology'
import type { DepressionPolicy } from '../../../src/pages/dev-forestry-roads/drainagePolicies'
import type { SurfaceGrid } from '../../../src/pages/dev-forestry-roads/surfaceGrid'
import { burnStreamsAtRoads, readTile, type Tile } from './inputs'
import { hillshade, writeMap, type Layer } from './render'
import { gridToTiff, tiffToGrid, tool } from './whitebox'

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const [inputs, out] = argv
assert(inputs && out && !inputs.startsWith('--'), 'Usage: bench.ts <inputs dir> <out dir> [options]')
const thresholdHa = Number(flag('threshold-ha') ?? 1)
const breachDists = (flag('breach-dist') ?? '20,100').split(',').map(Number)
const tiles = flag('tiles')?.split(',') ?? readdirSync(inputs).filter((d) => !d.startsWith('.'))
const png = !argv.includes('--no-png')
const context = argv.includes('--context')
/** PGMaps' `pondDepthM` default: ponding shallower than this is not reported. */
const POND_M = 0.05
/** Stream cells this many cells apart still agree (D8 lines move by a cell on tiny differences). */
const AGREE_CELLS = 2
/** A stream carried further than this inside the road mask runs along the road, m. */
const ALONG_ROAD_M = 40
/** Radius searched around a mapped road–stream crossing, m. */
const CROSSING_RADIUS_M = 30
/** Width of road burned through at a mapped stream crossing (`burn_streams_at_roads`), m. */
const BURN_ROAD_WIDTH_M = 25

const t0 = performance.now()
const log = (...m: unknown[]) => console.error(`[${((performance.now() - t0) / 1000).toFixed(0)} s]`, ...m)
const round = (v: number, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v)

interface Method {
  name: string
  surface: Float64Array
  dirs: Int8Array
  acc: Float64Array
  /** Routed − original (negative where cut), but for full fill the spill depth PGMaps reports as ponding, without ε. */
  raise: ArrayLike<number>
  seconds: number
}

function routed(
  name: string,
  grid: SurfaceGrid,
  surface: Float64Array,
  dirs: Int8Array,
  seconds: number,
  raise: ArrayLike<number> = surface.map((v, i) => v - grid.values[i]),
): Method {
  return { name, surface, dirs, acc: flowAccumulation(dirs, grid), raise, seconds }
}

function pgMethod(name: string, grid: SurfaceGrid, policy?: DepressionPolicy): Method {
  const start = performance.now()
  const c = conditionDrainageSurface(grid, policy)
  const seconds = (performance.now() - start) / 1000
  // Full fill lifts flats by ε per cell (millimetres over a large pond); ponding is read without it, as PGMaps reports it.
  const raise = policy ? undefined : c.depth
  return routed(name, grid, c.surface.values, c.directions, seconds, raise)
}

/** Whitebox conditions the surface; PGMaps' own D8 routes it, so only the conditioning differs. */
async function wbMethod(name: string, grid: SurfaceGrid, tiff: Uint8Array, toolName: string, args: string[]) {
  const run = await tool(toolName, ['--input=/work/dem.tif', '--output=/work/out.tif', ...args], { 'dem.tif': tiff })
  const surface = (await tiffToGrid(run.files['out.tif'])).values
  const dirs = flowDirections({ ...grid, values: surface })
  return routed(name, grid, surface, dirs, run.seconds)
}

const dilate = (mask: Uint8Array, w: number, h: number, times: number) => {
  let cur = mask
  for (let t = 0; t < times; t++) {
    const next = new Uint8Array(cur)
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        if (!cur[r * w + c]) continue
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr,
              cc = c + dc
            if (rr >= 0 && cc >= 0 && rr < h && cc < w) next[rr * w + cc] = 1
          }
      }
    cur = next
  }
  return cur
}

/** 8-connected clusters of `mask` cells: their cell lists. */
function clusters(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(mask.length),
    out: number[][] = []
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue
    const cells = [s]
    seen[s] = 1
    for (let q = 0; q < cells.length; q++) {
      const i = cells[q],
        r = Math.floor(i / w),
        c = i - r * w
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr,
            cc = c + dc
          if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue
          const j = rr * w + cc
          if (mask[j] && !seen[j]) {
            seen[j] = 1
            cells.push(j)
          }
        }
    }
    out.push(cells)
  }
  return out
}

const isOpen = (grid: SurfaceGrid, i: number) => {
  const w = grid.width,
    r = Math.floor(i / w),
    c = i - r * w
  if (r === 0 || c === 0 || r === grid.height - 1 || c === w - 1) return true
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) if (!Number.isFinite(grid.values[(r + dr) * w + c + dc])) return true
  return false
}

function downstreamOf(dirs: Int8Array, w: number, i: number) {
  const k = dirs[i]
  if (k < 0) return -1
  const dr = [0, 1, 1, 1, 0, -1, -1, -1][k],
    dc = [1, 1, 0, -1, -1, -1, 0, 1][k]
  return i + dr * w + dc
}

function surfaceMetrics(tile: Tile, m: Method, pondClusters: number[][], thresholdM2: number) {
  const { dem, roadMask } = tile,
    z0 = dem.values,
    area = dem.cellM ** 2
  let raised = 0,
    raisedVol = 0,
    maxRaise = 0,
    ponds = 0,
    pondsByRoad = 0,
    cut = 0,
    cutVol = 0,
    maxCut = 0,
    cutOnRoad = 0,
    cutCentreline = 0,
    sinks = 0
  const pondMask = new Uint8Array(z0.length)
  for (let i = 0; i < z0.length; i++) {
    if (!Number.isFinite(z0[i])) continue
    const d = m.raise[i]
    if (d > 1e-6) {
      raised++
      raisedVol += d * area
      maxRaise = Math.max(maxRaise, d)
      if (d > POND_M) {
        ponds++
        pondMask[i] = 1
      }
    } else if (d < -1e-6) {
      cut++
      cutVol -= d * area
      maxCut = Math.max(maxCut, -d)
      if (roadMask[i]) cutOnRoad++
      if (roadMask[i] === 2) cutCentreline++
    }
    if (m.dirs[i] === OUTLET && !isOpen(dem, i)) sinks++
  }
  for (const cells of clusters(pondMask, dem.width, dem.height))
    if (cells.some((i) => roadMask[i])) pondsByRoad += cells.length
  // Breach channels through a road: connected cut clusters that reach the centreline.
  const cutMask = new Uint8Array(z0.length)
  for (let i = 0; i < z0.length; i++) if (m.surface[i] - z0[i] < -1e-6) cutMask[i] = 1
  let channelsThroughRoads = 0
  for (const cells of clusters(cutMask, dem.width, dem.height))
    if (cells.some((i) => roadMask[i] === 2) && cells.length >= 3) channelsThroughRoads++

  // Streams meeting roads.
  const stream = (i: number) => m.acc[i] >= thresholdM2
  let entries = 0,
    alongRoad = 0,
    inRoadM = 0
  const runs: number[] = []
  for (let i = 0; i < z0.length; i++) {
    if (!stream(i) || roadMask[i]) continue
    let j = downstreamOf(m.dirs, dem.width, i)
    if (j < 0 || !roadMask[j]) continue
    entries++
    let run = 0
    while (j >= 0 && roadMask[j]) {
      run += m.dirs[j] & 1 ? dem.cellM * Math.SQRT2 : dem.cellM
      j = downstreamOf(m.dirs, dem.width, j)
    }
    runs.push(run)
    if (run > ALONG_ROAD_M) alongRoad++
  }
  for (let i = 0; i < z0.length; i++) if (stream(i) && roadMask[i]) inRoadM += dem.cellM
  runs.sort((a, b) => a - b)
  // Fill-all ponds that this method still routes over a raised surface.
  let pondCellsKept = 0,
    pondCellsAll = 0
  for (const cells of pondClusters)
    for (const i of cells) {
      pondCellsAll++
      if (m.raise[i] > POND_M) pondCellsKept++
    }
  return {
    seconds: round(m.seconds, 2),
    raisedCells: raised,
    raisedVolumeM3: round(raisedVol, 0),
    maxRaiseM: round(maxRaise, 2),
    pondAreaM2: ponds * area,
    pondAreaTouchingRoadM2: pondsByRoad * area,
    fillAllPondAreaStillRaisedPercent: round((100 * pondCellsKept) / Math.max(1, pondCellsAll), 1),
    cutCells: cut,
    cutVolumeM3: round(cutVol, 0),
    maxCutM: round(maxCut, 2),
    cutCellsInRoadBuffer: cutOnRoad,
    cutCellsOnCentreline: cutCentreline,
    cutChannelsThroughRoads: channelsThroughRoads,
    interiorSinkCells: sinks,
    streamCells: m.acc.reduce((n, a) => n + (a >= thresholdM2 ? 1 : 0), 0),
    streamEntriesIntoRoads: entries,
    streamsRunAlongRoad: alongRoad,
    streamLengthInRoadBufferM: round(inRoadM, 0),
    medianRunInRoadM: round(runs[Math.floor(runs.length / 2)] ?? NaN, 1),
    maxRunInRoadM: round(runs.at(-1) ?? NaN, 1),
  }
}

/** Stream-cell agreement of two methods, and where the cells of `a` that `b` lacks lie. */
function streamAgreement(tile: Tile, a: Method, b: Method, thresholdM2: number, pondsOfFill: Uint8Array) {
  const { width: w, height: h } = tile.dem
  const sa = new Uint8Array(a.acc.length),
    sb = new Uint8Array(b.acc.length)
  for (let i = 0; i < sa.length; i++) {
    sa[i] = a.acc[i] >= thresholdM2 ? 1 : 0
    sb[i] = b.acc[i] >= thresholdM2 ? 1 : 0
  }
  const near = dilate(tile.roadMask, w, h, Math.ceil(22 / tile.dem.cellM))
  const da = dilate(sa, w, h, AGREE_CELLS),
    db = dilate(sb, w, h, AGREE_CELLS)
  let both = 0,
    either = 0,
    aNear = 0,
    bNear = 0,
    na = 0,
    nb = 0
  const missed = { nearRoad: 0, inFillPond: 0, elsewhere: 0 },
    extra = { nearRoad: 0, inFillPond: 0, elsewhere: 0 }
  const where = (i: number, tally: typeof missed) => {
    if (near[i]) tally.nearRoad++
    else if (pondsOfFill[i]) tally.inFillPond++
    else tally.elsewhere++
  }
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] && sb[i]) both++
    if (sa[i] || sb[i]) either++
    if (sa[i]) {
      na++
      if (db[i]) aNear++
      else where(i, missed)
    }
    if (sb[i]) {
      nb++
      if (da[i]) bNear++
      else where(i, extra)
    }
  }
  return {
    jaccardExact: round(both / Math.max(1, either)),
    aWithinTwoCellsOfB: round(aNear / Math.max(1, na)),
    bWithinTwoCellsOfA: round(bNear / Math.max(1, nb)),
    aOnlyCells: missed,
    bOnlyCells: extra,
  }
}

/** At each mapped road–stream crossing: fill-all's pond and each method's flow either side of the road. */
function crossingMetrics(tile: Tile, methods: Method[], fillAll: Method) {
  const { dem } = tile,
    r = Math.ceil(CROSSING_RADIUS_M / dem.cellM)
  return tile.crossings.map((x) => {
    const centre = [
      Math.round((dem.origin[1] - x.y) / dem.cellM),
      Math.round((x.x - dem.origin[0]) / dem.cellM),
    ] as const
    let pond = 0
    const up = new Map<string, number>(),
      down = new Map<string, number>()
    for (let dr = -r; dr <= r; dr++)
      for (let dc = -r; dc <= r; dc++) {
        const row = centre[0] + dr,
          col = centre[1] + dc
        if (row < 0 || col < 0 || row >= dem.height || col >= dem.width) continue
        const dist = Math.hypot(dr, dc) * dem.cellM
        if (dist > CROSSING_RADIUS_M) continue
        const i = row * dem.width + col
        pond = Math.max(pond, fillAll.raise[i])
        if (tile.roadMask[i]) continue
        const along = dc * dem.cellM * x.downX - dr * dem.cellM * x.downY
        for (const m of methods) {
          const side = along > 0 ? down : up
          side.set(m.name, Math.max(side.get(m.name) ?? 0, m.acc[i]))
        }
      }
    return {
      at: tile.toLonLat([x.x, x.y]).map((v) => round(v, 5)),
      fillAllPondDepthM: round(pond, 2),
      upstreamHa: Object.fromEntries(methods.map((m) => [m.name, round((up.get(m.name) ?? 0) / 1e4, 2)])),
      downstreamHa: Object.fromEntries(methods.map((m) => [m.name, round((down.get(m.name) ?? 0) / 1e4, 2)])),
    }
  })
}

/** D8 agreement on cells routed by both, split by whether either surface was changed there. */
function d8Agreement(grid: SurfaceGrid, a: Method, b: Method) {
  let same = 0,
    n = 0,
    sameUnchanged = 0,
    nUnchanged = 0,
    accSame = 0
  for (let i = 0; i < a.dirs.length; i++) {
    if (a.dirs[i] === MISSING || b.dirs[i] === MISSING) continue
    n++
    const eq = a.dirs[i] === b.dirs[i]
    if (eq) same++
    if (Math.abs(a.acc[i] - b.acc[i]) < 1e-6) accSame++
    const z = grid.values[i]
    if (Math.abs(a.surface[i] - z) < 1e-9 && Math.abs(b.surface[i] - z) < 1e-9) {
      nUnchanged++
      if (eq) sameUnchanged++
    }
  }
  return {
    cells: n,
    sameDirection: round(same / n, 5),
    sameDirectionWhereNeitherChanged: round(sameUnchanged / Math.max(1, nUnchanged), 5),
    changedCellsShare: round(1 - nUnchanged / n, 4),
    sameAccumulation: round(accSame / n, 5),
  }
}

/** Whitebox's own D8 pointer and accumulation on a surface, against PGMaps' D8 on the same surface. */
async function whiteboxD8(grid: SurfaceGrid, m: Method, epsg: number, thresholdM2: number) {
  const tiff = await gridToTiff({ ...grid, values: m.surface }, epsg)
  const ptr = await tool('d8_pointer', ['--dem=/work/s.tif', '--output=/work/p.tif'], { 's.tif': tiff })
  const pointer = (await tiffToGrid(ptr.files['p.tif'])).values
  const acc = await tool('d8_flow_accum', ['--input=/work/s.tif', '--output=/work/a.tif', '--out_type=cells'], {
    's.tif': tiff,
  })
  const cells = (await tiffToGrid(acc.files['a.tif'])).values
  // Whitebox pointers: 1 NE, 2 E, 4 SE, 8 S, 16 SW, 32 W, 64 NW, 128 N; PGMaps: 0 E … 7 NE.
  let same = 0,
    n = 0,
    flats = 0,
    accSame = 0,
    sa = 0,
    sb = 0,
    sBoth = 0
  const nb = new Float64Array(8)
  for (let i = 0; i < pointer.length; i++) {
    if (m.dirs[i] === MISSING || !Number.isFinite(pointer[i])) continue
    n++
    const p = pointer[i]
    const wb = p > 0 ? (Math.log2(p) + 7) % 8 : OUTLET
    if (wb === m.dirs[i]) same++
    else if (m.dirs[i] >= 0 && wb >= 0) {
      // A tie between two equally steep neighbours?
      const w = grid.width,
        r = Math.floor(i / w),
        c = i - r * w
      for (let k = 0; k < 8; k++) {
        const rr = r + [0, 1, 1, 1, 0, -1, -1, -1][k],
          cc = c + [1, 1, 0, -1, -1, -1, 0, 1][k]
        nb[k] = (m.surface[i] - m.surface[rr * w + cc]) * (k & 1 ? Math.SQRT1_2 : 1)
      }
      if (Math.abs(nb[wb] - nb[m.dirs[i]]) < 1e-9) flats++
    }
    const pgCells = m.acc[i] / grid.cellM ** 2
    if (Math.abs(pgCells - cells[i]) < 0.5 || Math.abs(pgCells - 1 - cells[i]) < 0.5) accSame++
    const inA = m.acc[i] >= thresholdM2,
      inB = cells[i] * grid.cellM ** 2 >= thresholdM2
    if (inA) sa++
    if (inB) sb++
    if (inA && inB) sBoth++
  }
  return {
    pointerSeconds: round(ptr.seconds, 2),
    accumulationSeconds: round(acc.seconds, 2),
    sameDirection: round(same / n, 5),
    differingOnExactTies: round(flats / Math.max(1, n - same), 3),
    sameAccumulation: round(accSame / n, 5),
    streamJaccard: round(sBoth / Math.max(1, sa + sb - sBoth), 4),
  }
}

async function contextTools(tile: Tile, m: Method, epsg: number, thresholdM2: number) {
  const tiff = await gridToTiff({ ...tile.dem, values: m.surface }, epsg)
  const fd8 = await tool('fd8_flow_accum', ['--dem=/work/s.tif', '--output=/work/f.tif', '--out_type=sca'], {
    's.tif': tiff,
  })
  const slope = await tool('slope', ['--input=/work/s.tif', '--output=/work/sl.tif'], { 's.tif': tiff })
  const twi = await tool('wetness_index', ['--sca=/work/f.tif', '--slope=/work/sl.tif', '--output=/work/t.tif'], {
    'f.tif': fd8.files['f.tif'],
    'sl.tif': slope.files['sl.tif'],
  })
  const streams = new Float64Array(m.acc.length)
  for (let i = 0; i < streams.length; i++) streams[i] = m.acc[i] >= thresholdM2 ? 1 : 0
  const streamTiff = await gridToTiff({ ...tile.dem, values: streams }, epsg)
  const hand = await tool(
    'elevation_above_stream',
    ['--dem=/work/s.tif', '--streams=/work/st.tif', '--output=/work/h.tif'],
    {
      's.tif': tiff,
      'st.tif': streamTiff,
    },
  )
  return {
    seconds: round(fd8.seconds + slope.seconds + twi.seconds + hand.seconds, 2),
    twi: (await tiffToGrid(twi.files['t.tif'])).values,
    hand: (await tiffToGrid(hand.files['h.tif'])).values,
  }
}

const results: Record<string, unknown> = {}
await mkdir(out, { recursive: true })
for (const name of tiles) {
  log(name)
  const tile = await readTile(path.join(inputs, name))
  const grid = tile.dem,
    thresholdM2 = thresholdHa * 10_000
  const tiff = await gridToTiff(grid, tile.epsg)
  const methods: Method[] = [
    pgMethod('pg-fill-all', grid),
    pgMethod('pg-preserve', grid, { mode: 'preserve' }),
    pgMethod('pg-depth-0.5', grid, { mode: 'depth-limited', maxDepthM: 0.5 }),
    await wbMethod('wb-fill', grid, tiff, 'fill_depressions', []),
  ]
  for (const d of breachDists)
    methods.push(
      await wbMethod(`wb-breach-${d}`, grid, tiff, 'breach_depressions_least_cost', [
        `--max_dist=${d}`,
        '--fill_deps=true',
      ]),
    )
  {
    // Targeted: cut only where a mapped stream crosses a mapped road, then PGMaps' full fill.
    const burn = await burnStreamsAtRoads(tile, tiff, BURN_ROAD_WIDTH_M)
    const burned = { ...grid, values: (await tiffToGrid(burn.files['o.tif'])).values }
    const c = conditionDrainageSurface(burned)
    methods.push(
      routed(
        'wb-burn-roads+fill',
        grid,
        c.surface.values,
        c.directions,
        burn.seconds,
        burned.values.map((v, i) => v - grid.values[i] + c.depth[i]),
      ),
    )
  }
  const breachOnly = await wbMethod('wb-breach-100-nofill', grid, tiff, 'breach_depressions_least_cost', [
    '--max_dist=100',
  ])
  log('methods routed')
  const fillAll = methods[0]
  const pondMask = new Uint8Array(grid.values.length)
  for (let i = 0; i < pondMask.length; i++) if (fillAll.raise[i] > POND_M) pondMask[i] = 1
  const pondClusters = clusters(pondMask, grid.width, grid.height)
  const valid = grid.values.reduce((n, v) => n + (Number.isFinite(v) ? 1 : 0), 0)
  let breachOnlyResidual = 0
  {
    const residual = conditionDrainageSurface({ ...grid, values: breachOnly.surface }, undefined)
    for (let i = 0; i < pondMask.length; i++)
      if (residual.surface.values[i] - breachOnly.surface[i] > POND_M) breachOnlyResidual++
  }
  results[name] = {
    cells: grid.width * grid.height,
    groundCells: valid,
    cellM: grid.cellM,
    reliefM: round(
      grid.values.reduce((m, v) => (v > m ? v : m), -Infinity) -
        grid.values.reduce((m, v) => (v < m ? v : m), Infinity),
      1,
    ),
    roadLines: tile.roads.length,
    roadBufferAreaM2: tile.roadMask.reduce((n, v) => n + (v ? 1 : 0), 0) * grid.cellM ** 2,
    mappedCrossings: tile.crossings.length,
    fillAllPonds: {
      count: pondClusters.length,
      touchingRoad: pondClusters.filter((c) => c.some((i) => tile.roadMask[i])).length,
      largestTouchingRoadM2:
        pondClusters.reduce((m, c) => (c.some((i) => tile.roadMask[i]) ? Math.max(m, c.length) : m), 0) *
        grid.cellM ** 2,
    },
    breach100WithoutFillResidualPondAreaM2: breachOnlyResidual * grid.cellM ** 2,
    methods: Object.fromEntries(methods.map((m) => [m.name, surfaceMetrics(tile, m, pondClusters, thresholdM2)])),
    streamsAgainstFillAll: Object.fromEntries(
      methods.slice(1).map((m) => [m.name, streamAgreement(tile, fillAll, m, thresholdM2, pondMask)]),
    ),
    d8: {
      pgFillAllVsWbFill: d8Agreement(grid, fillAll, methods[3]),
      whiteboxD8OnWbFill: await whiteboxD8(grid, methods[3], tile.epsg, thresholdM2),
      whiteboxD8OnPgFillAll: await whiteboxD8(grid, fillAll, tile.epsg, thresholdM2),
    },
    crossings: crossingMetrics(tile, methods, fillAll),
    streamLines: Object.fromEntries(
      [fillAll, methods.find((m) => m.name === 'wb-breach-100')!].map((m) => [
        m.name,
        extractStreams(m.acc, m.dirs, grid, tile.toLonLat, { thresholdM2 }).features.length,
      ]),
    ),
  }
  const breach = methods.find((m) => m.name === 'wb-breach-100')!
  if (context) {
    const ctx = await contextTools(tile, breach, tile.epsg, thresholdM2)
    const med = (vals: number[]) => round(vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)] ?? NaN, 2)
    const inPond: number[] = [],
      handPond: number[] = [],
      twiAll: number[] = []
    for (let i = 0; i < pondMask.length; i += pondMask[i] ? 1 : 7) {
      if (!Number.isFinite(ctx.twi[i])) continue
      if (pondMask[i]) {
        inPond.push(ctx.twi[i])
        handPond.push(ctx.hand[i])
      } else twiAll.push(ctx.twi[i])
    }
    ;(results[name] as Record<string, unknown>).context = {
      seconds: ctx.seconds,
      medianWetnessIndexInFillAllPonds: med(inPond),
      medianWetnessIndexElsewhere: med(twiAll),
      medianHeightAboveStreamInFillAllPondsM: med(handPond),
    }
  }
  if (png) {
    const shade = hillshade(grid)
    const roads: Layer = { mask: (i) => tile.roadMask[i] === 2, color: [250, 200, 0] }
    const ponds: Layer = { mask: (i) => pondMask[i] === 1, color: [30, 110, 255], alpha: 0.75 }
    const cuts: Layer = { mask: (i) => breach.surface[i] - grid.values[i] < -0.05, color: [230, 20, 20] }
    const sA = (i: number) => fillAll.acc[i] >= thresholdM2,
      sB = (i: number) => breach.acc[i] >= thresholdM2
    const streams: Layer[] = [
      { mask: (i) => sA(i) && !sB(i), color: [30, 110, 255] },
      { mask: (i) => sB(i) && !sA(i), color: [230, 20, 20] },
      { mask: (i) => sA(i) && sB(i), color: [110, 0, 140] },
    ]
    await writeMap(path.join(out, `${name}-ponds-cuts.png`), grid, shade, [roads, ponds, cuts])
    await writeMap(path.join(out, `${name}-streams.png`), grid, shade, [roads, ...streams])
    // A close-up of the largest fill-all pond that touches a road.
    const byRoad = pondClusters.filter((c) => c.some((i) => tile.roadMask[i])).sort((a, b) => b.length - a.length)
    for (const [k, cells] of byRoad.slice(0, 3).entries()) {
      const rows = cells.map((i) => Math.floor(i / grid.width)),
        cols = cells.map((i) => i % grid.width)
      const r0 = rows.reduce((a, b) => Math.min(a, b)),
        r1 = rows.reduce((a, b) => Math.max(a, b)),
        c0 = cols.reduce((a, b) => Math.min(a, b)),
        c1 = cols.reduce((a, b) => Math.max(a, b))
      const span = Math.max(160, r1 - r0 + 80, c1 - c0 + 80)
      const win: [number, number, number, number] = [
        Math.round((r0 + r1) / 2 - span / 2),
        Math.round((c0 + c1) / 2 - span / 2),
        span,
        span,
      ]
      const scale = Math.max(1, Math.floor(640 / span))
      await writeMap(
        path.join(out, `${name}-pond${k + 1}-fill.png`),
        grid,
        shade,
        [roads, ponds, streams[0], streams[2]],
        win,
        scale,
      )
      await writeMap(
        path.join(out, `${name}-pond${k + 1}-breach.png`),
        grid,
        shade,
        [roads, cuts, { ...streams[1], color: [230, 20, 20] }, { ...streams[2], color: [230, 20, 20] }],
        win,
        scale,
      )
    }
  }
  log(name, 'done')
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ thresholdHa, breachDists, tiles: results }, null, 1))
}
log('wrote', path.join(out, 'results.json'))

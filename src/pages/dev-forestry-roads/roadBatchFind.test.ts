import { describe, expect, it } from 'vitest'
import { runCooperatively } from './cooperative'
import {
  findRoadsOnTerrainSteps,
  insidePolygon,
  reconnectBatch,
  ROAD_BATCH_MAX_ROADS,
  ROAD_BATCH_MAX_TOTAL_M,
  selectBatchRoads,
  type BatchFindProgress,
  type BatchRoad,
  type BatchRow,
} from './roadBatchFind'
import { cumulativeLength, nearestOnLine, resampleLine, spreadOf, type TerrainSampler, type XY } from './roadGrid'
import { circle, mappedRecord, NET_X0, NET_Y0, networkTerrain, straight } from './roadNetworkFixture'
import { findRoadOnTerrain } from './roadRelocation'
import { sampleBilinear } from './surfaceGrid'

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** Distance from points every metre along `line` to the nearest of the true centrelines. */
const offTruth = (line: XY[], truths: XY[][]) =>
  spreadOf(
    resampleLine(line, 1).map((p) => Math.min(...truths.map((t) => nearestOnLine(t, cumulativeLength(t), p).distance))),
  )!
const run = (roads: BatchRoad[], ground: ReturnType<typeof networkTerrain>) =>
  runCooperatively(findRoadsOnTerrainSteps({ roads, ground, terrainCellM: 1 }), { sliceMs: 0 })
const all = (rows: BatchRow[]) => new Set(rows.map((r) => r.id))

// A through road west–east with a spur north from its middle, as three records meeting at one node.
const junction: XY = [NET_X0 + 350, NET_Y0 - 400]
const west = straight([NET_X0 + 60, junction[1]], junction)
const east = straight(junction, [NET_X0 + 640, junction[1]])
const north = straight(junction, [junction[0], NET_Y0 - 60])

describe('finding several roads on the terrain and reconnecting them', () => {
  const tGround = networkTerrain([west, east, north])
  const shift: XY = [6, 9]
  const tRoads: BatchRoad[] = [
    { id: 'w', name: 'West', line: mappedRecord(west, shift) },
    { id: 'e', name: 'East', line: mappedRecord(east, shift) },
    { id: 'n', name: 'Spur', line: mappedRecord(north, shift) },
  ]

  it('gives every road exactly the result of searching it alone', async () => {
    const rows = await run(tRoads, tGround)
    expect(rows.map((r) => r.id)).toEqual(['w', 'e', 'n'])
    for (const [i, road] of tRoads.entries()) {
      expect(rows[i].error).toBeNull()
      expect(rows[i].result).toEqual(findRoadOnTerrain({ line: road.line, ground: tGround, terrainCellM: 1 }))
      expect(rows[i].result!.status).toBe('found')
      expect(rows[i].record).toBe(road.line)
    }
  })

  it('rebuilds a T junction where the record had it, on the found roads', async () => {
    const copy = JSON.parse(JSON.stringify(tRoads))
    const rows = await run(tRoads, tGround)
    // Found one at a time, the three roads end metres apart around the junction.
    const ends = [rows[0].result!.candidate.at(-1)!, rows[1].result!.candidate[0], rows[2].result!.candidate[0]]
    expect(Math.max(...ends.map((p) => dist(p, junction)))).toBeGreaterThan(4)
    const net = reconnectBatch(rows, all(rows), 30)
    expect(net.junctions).toHaveLength(1)
    const [j] = net.junctions
    expect(j.status).toBe('joined')
    expect(j.throughPair!.map((e) => e.roadId).sort()).toEqual(['e', 'w'])
    expect(dist(j.at!, junction)).toBeLessThan(1.5)
    expect(net.lines.w.at(-1)).toEqual(j.at)
    expect(net.lines.e[0]).toEqual(j.at)
    expect(net.lines.n[0]).toEqual(j.at)
    expect(offTruth(net.lines.w, [west]).p90).toBeLessThanOrEqual(1)
    expect(offTruth(net.lines.e, [east]).p90).toBeLessThanOrEqual(1)
    expect(offTruth(net.lines.n, [north]).p90).toBeLessThanOrEqual(1)
    expect(net.nearMisses).toEqual([])
    // Nothing edits the records.
    expect(tRoads).toEqual(copy)
  })

  it('reconnects only the roads chosen, joining the others to their records', async () => {
    const rows = await run(tRoads, tGround)
    // The spur not chosen: the through road rejoins itself and says the kept spur no longer meets it.
    const net = reconnectBatch(rows, new Set(['w', 'e']), 30)
    expect(net.lines.n).toBeUndefined()
    const [j] = net.junctions
    expect(j.status).toBe('partial')
    expect(j.message).toMatch(/Spur, kept as mapped, ends \d+\.\d m from them and is not joined/)
    expect(net.lines.w.at(-1)).toEqual(net.lines.e[0])
  })

  it('reports progress road by road and stops on Cancel', async () => {
    const controller = new AbortController()
    const seen: BatchFindProgress[] = []
    const search = runCooperatively(findRoadsOnTerrainSteps({ roads: tRoads, ground: tGround, terrainCellM: 1 }), {
      signal: controller.signal,
      sliceMs: 0,
      onProgress: (p) => {
        seen.push(p)
        if (p.road === 2 && p.step?.phase === 'search') controller.abort()
      },
    })
    await expect(search).rejects.toThrow(/Cancelled/)
    expect(seen.some((p) => p.road === 1 && p.name === 'West' && p.roads === 3)).toBe(true)
    expect(seen.some((p) => p.road === 3)).toBe(false)
  })

  it('reconnects a spur that the record joins to a through road mid-line', async () => {
    const main = straight([NET_X0 + 60, junction[1]], [NET_X0 + 640, junction[1]])
    const ground = networkTerrain([main, north])
    const roads: BatchRoad[] = [
      { id: 'main', name: 'Main', line: mappedRecord(main, [-7, 8]) },
      { id: 'spur', name: 'Spur', line: mappedRecord(north, [-7, 8]) },
    ]
    const rows = await run(roads, ground)
    expect(rows.map((r) => r.result!.status)).toEqual(['found', 'found'])
    const net = reconnectBatch(rows, all(rows), 30)
    expect(net.junctions).toHaveLength(1)
    const [j] = net.junctions
    expect(j.kind).toBe('mid-road')
    expect(j.status).toBe('joined')
    expect(dist(j.at!, junction)).toBeLessThan(1.5)
    expect(net.lines.spur[0]).toEqual(j.at)
    // The through road is a found copy, never split at the spur.
    expect(net.lines.main).toEqual(rows[0].result!.candidate)
    expect(offTruth(net.lines.spur, [north]).p90).toBeLessThanOrEqual(1)
  })

  it('finds a loop in two halves and closes it with the road that leads into it', async () => {
    const closure: XY = [NET_X0 + 350, NET_Y0 - 480]
    const loop = circle([closure[0], closure[1] + 110], 110, -Math.PI / 2)
    loop[loop.length - 1] = loop[0]
    const access = straight(closure, [closure[0], NET_Y0 - 660])
    const ground = networkTerrain([loop, access])
    const roads: BatchRoad[] = [
      { id: 'loop', name: 'Loop', line: mappedRecord(loop, [8, -6]) },
      { id: 'access', name: 'Access', line: mappedRecord(access, [8, -6]) },
    ]
    const rows = await run(roads, ground)
    expect(rows.map((r) => r.result!.status)).toEqual(['found', 'found'])
    expect(offTruth(rows[0].result!.candidate, [loop]).p90).toBeLessThanOrEqual(1)
    const net = reconnectBatch(rows, all(rows), 30)
    const [j] = net.junctions
    expect(j.status).toBe('joined')
    expect(j.throughPair!.map((e) => `${e.roadId}:${e.end}`)).toEqual(['loop:start', 'loop:end'])
    expect(net.lines.loop[0]).toEqual(j.at)
    expect(net.lines.loop.at(-1)).toEqual(j.at)
    expect(net.lines.access[0]).toEqual(j.at)
    expect(dist(j.at!, closure)).toBeLessThan(2)
  })

  it('reports a road whose search fails in its own row, by name, and carries on', async () => {
    const ground = networkTerrain([west, east])
    const failing: TerrainSampler = {
      cellM: 1,
      toLonLat: (xy) => [xy[0], xy[1]],
      terrain: {
        elevationAt(x, y) {
          if (x > NET_X0 + 470) throw Error('tile not loaded')
          return sampleBilinear(ground, x, y)
        },
      },
    }
    const rows = await runCooperatively(
      findRoadsOnTerrainSteps({ roads: tRoads.slice(0, 2), ground: failing, terrainCellM: 1 }),
      { sliceMs: 0 },
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].result!.status).toBe('found')
    expect(rows[1].result).toBeNull()
    expect(rows[1].error).toBe('East: tile not loaded')
  })
})

describe('choosing the roads to search', () => {
  const short = (i: number): BatchRoad => ({
    id: `r${i}`,
    name: `Road ${i}`,
    line: [
      [i * 100, 0],
      [i * 100, 200],
    ],
  })

  it('takes the roads in the area and on the terrain, in order, within the caps', () => {
    const roads = Array.from({ length: ROAD_BATCH_MAX_ROADS + 5 }, (_, i) => short(i))
    const selection = selectBatchRoads(
      roads,
      () => true,
      () => true,
    )
    expect(selection.chosen.map((r) => r.id)).toEqual(roads.slice(0, ROAD_BATCH_MAX_ROADS).map((r) => r.id))
    expect(selection.overCap).toHaveLength(5)
    expect(selection.outside).toBe(0)
    // A road with less than half its length in the area is outside it.
    const area: XY[][] = [
      [
        [-50, -10],
        [250, -10],
        [250, 90],
        [-50, 90],
      ],
    ]
    const inArea = selectBatchRoads(
      roads.slice(0, 4),
      (p) => insidePolygon(area, p),
      () => true,
    )
    expect(inArea.chosen).toEqual([])
    const tall: XY[][] = [area[0].map(([x, y]) => [x, y < 0 ? y : 150] as XY)]
    expect(
      selectBatchRoads(
        roads.slice(0, 4),
        (p) => insidePolygon(tall, p),
        () => true,
      ).chosen.map((r) => r.id),
    ).toEqual(['r0', 'r1', 'r2'])
  })

  it('caps the total length searched', () => {
    const long = (i: number): BatchRoad => ({
      id: `l${i}`,
      name: `Long ${i}`,
      line: [
        [i * 100, 0],
        [i * 100, 6_000],
      ],
    })
    const selection = selectBatchRoads(
      Array.from({ length: 6 }, (_, i) => long(i)),
      () => true,
      () => true,
    )
    expect(selection.chosen).toHaveLength(Math.floor(ROAD_BATCH_MAX_TOTAL_M / 6_000))
    expect(selection.overCap).toHaveLength(6 - selection.chosen.length)
  })

  it('leaves out roads off the terrain', () => {
    const selection = selectBatchRoads(
      [short(0), short(5)],
      () => true,
      ([x]) => x < 300,
    )
    expect(selection.chosen.map((r) => r.id)).toEqual(['r0'])
    expect(selection.outside).toBe(1)
  })
})

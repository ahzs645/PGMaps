import { describe, expect, it } from 'vitest'
import type { XY } from './roadGrid'
import { reconnectRoads, ROAD_RECONNECT_TOLERANCE_M, type ReconnectRoad } from './roadReconnect'

const line = (...points: XY[]) => points
const close = (a: XY | undefined, b: XY, digits = 6) => {
  expect(a).toBeDefined()
  expect(a![0]).toBeCloseTo(b[0], digits)
  expect(a![1]).toBeCloseTo(b[1], digits)
}
const road = (id: string, record: XY[], candidate: XY[] | null, extra: Partial<ReconnectRoad> = {}): ReconnectRoad => ({
  id,
  name: id,
  record,
  candidate,
  ...extra,
})

describe('reconnecting found roads where their records met', () => {
  it('joins two roads that met end to end at the midpoint of their found ends', () => {
    const result = reconnectRoads([
      road('A', line([0, 0], [100, 0]), line([0, 5], [98, 5])),
      road('B', line([100, 0], [200, 0]), line([103, 6], [200, 6])),
    ])
    expect(result.junctions).toHaveLength(1)
    const [j] = result.junctions
    expect(j.status).toBe('joined')
    close(j.at!, [100.5, 5.5])
    close(result.lines.A.at(-1), [100.5, 5.5])
    close(result.lines.B[0], [100.5, 5.5])
    expect(j.shiftM).toBeCloseTo(Math.hypot(0.5, 5.5), 6)
    expect(result.movedEnds).toEqual({ A: 1, B: 1 })
    expect(result.toleranceM).toBe(ROAD_RECONNECT_TOLERANCE_M)
  })

  it('rebuilds a T on the through road, where the spur crosses it', () => {
    // Records meet at (300, 0); every found road sits 8 m south of its record, and the spur's
    // found start stops 9 m short of the through road, as an end cap leaves it.
    const result = reconnectRoads([
      road('west', line([0, 0], [300, 0]), line([0, -8], [306, -8])),
      road('east', line([300, 0], [600, 0]), line([305, -8], [600, -8])),
      road('spur', line([300, 0], [300, 300]), line([294, 1], [294, 300])),
    ])
    const [j] = result.junctions
    expect(j.status).toBe('joined')
    expect(j.throughPair!.map((e) => e.roadId).sort()).toEqual(['east', 'west'])
    close(j.at!, [294, -8])
    close(result.lines.west.at(-1), [294, -8])
    close(result.lines.east[0], [294, -8])
    close(result.lines.spur[0], [294, -8])
    // The through road is not bent: both halves stay on y = −8.
    expect(result.lines.west.every(([, y]) => Math.abs(y + 8) < 1e-9)).toBe(true)
    expect(result.lines.east.every(([, y]) => Math.abs(y + 8) < 1e-9)).toBe(true)
  })

  it('breaks a tie between equally straight pairs by state class, then score', () => {
    // A symmetric Y: the stem meets two branches at 170°; the branches meet each other at 20°.
    const stem = line([0, -200], [0, 0])
    const left = line([0, 0], [-35, 200])
    const right = line([0, 0], [35, 200])
    const roads = (leftClass: number, rightClass: number, leftScore = 50, rightScore = 50) => [
      road('stem', stem, stem, { stateClass: 2, score: 60 }),
      road('left', left, left, { stateClass: leftClass, score: leftScore }),
      road('right', right, right, { stateClass: rightClass, score: rightScore }),
    ]
    const pair = (rs: ReconnectRoad[]) =>
      reconnectRoads(rs)
        .junctions[0].throughPair!.map((e) => e.roadId)
        .sort()
    expect(pair(roads(3, 1))).toEqual(['right', 'stem'])
    expect(pair(roads(1, 3))).toEqual(['left', 'stem'])
    expect(pair(roads(2, 2, 40, 90))).toEqual(['right', 'stem'])
    // No class counts as 5, after any class.
    expect(pair(roads(0, 4))).toEqual(['right', 'stem'])
  })

  it('leaves a node as found when half the through gap is past the tolerance', () => {
    const roads = [
      road('A', line([0, 0], [100, 0]), line([0, 0], [70, 0])),
      road('B', line([100, 0], [200, 0]), line([140, 0], [200, 0])),
    ]
    const tight = reconnectRoads(roads, { toleranceM: 20 })
    expect(tight.junctions[0].status).toBe('not-joined')
    expect(tight.junctions[0].message).toMatch(/70\.0 m apart: half of that is past the 20 m tolerance/)
    expect(tight.lines.A).toEqual(roads[0].candidate)
    expect(tight.lines.B).toEqual(roads[1].candidate)
    expect(tight.movedEnds).toEqual({ A: 0, B: 0 })
    // Each end would move 35 m: past the default 30 m too, within 40 m.
    expect(reconnectRoads(roads).junctions[0].status).toBe('not-joined')
    expect(reconnectRoads(roads, { toleranceM: 40 }).junctions[0].status).toBe('joined')
  })

  it('never joins ends the record did not join, however close they come', () => {
    // The records end 5 m apart; the found roads end 1 m apart.
    const result = reconnectRoads([
      road('A', line([0, 0], [100, 0]), line([0, 2], [100, 2])),
      road('B', line([105, 0], [200, 0]), line([101, 2], [200, 2])),
    ])
    expect(result.junctions).toEqual([])
    expect(result.lines.A.at(-1)).toEqual([100, 2])
    expect(result.lines.B[0]).toEqual([101, 2])
    // Listed for review instead.
    expect(result.nearMisses.map((n) => [n.end.roadId, n.nearRoadId])).toEqual([
      ['A', 'B'],
      ['B', 'A'],
    ])
    expect(result.nearMisses[0].distanceM).toBeCloseTo(1, 6)
  })

  it('holds a junction where a kept record is half of the through road', () => {
    // East has no candidate: it keeps its record, so west joins it where the record meets it.
    const result = reconnectRoads([
      road('west', line([0, 0], [300, 0]), line([0, -6], [303, -6])),
      road('east', line([300, 0], [600, 0]), null),
    ])
    const [j] = result.junctions
    expect(j.status).toBe('joined')
    close(j.at!, [300, 0])
    close(result.lines.west.at(-1), [300, 0])
    expect(result.lines.east).toBeUndefined()
    expect(j.message).toMatch(/kept as mapped/)
  })

  it('rejoins the found through road and reports a kept spur it no longer meets', () => {
    const result = reconnectRoads([
      road('west', line([0, 0], [300, 0]), line([0, -8], [306, -8])),
      road('east', line([300, 0], [600, 0]), line([305, -8], [600, -8])),
      road('spur', line([300, 0], [300, 300]), null),
    ])
    const [j] = result.junctions
    expect(j.status).toBe('partial')
    close(j.at!, [305.5, -8])
    expect(j.message).toMatch(/spur, kept as mapped, ends 9\.7 m from them and is not joined/)
  })

  it('does not drag another road at the node further than the tolerance', () => {
    // The spur's found end stops 35 m north of the through road: its crossing is 10 m along the
    // through road from the midpoint, within the tolerance, but the end itself would move 35 m.
    const result = reconnectRoads([
      road('west', line([0, 0], [300, 0]), line([0, 0], [300, 0])),
      road('east', line([300, 0], [600, 0]), line([300, 0], [600, 0])),
      road('late', line([300, 0], [300, 300]), line([310, 35], [310, 300])),
    ])
    expect(result.junctions[0].status).toBe('not-joined')
    expect(result.junctions[0].message).toMatch(/late would have to move 35\.0 m to meet the through road/)
    expect(result.lines.late[0]).toEqual([310, 35])
  })

  it('closes a loop and brings the road into it to the same point', () => {
    const ring = (r: number, dx = 0, dy = 0) =>
      Array.from({ length: 37 }, (_, i) => {
        const t = -Math.PI / 2 + (2 * Math.PI * i) / 36
        return [dx + r * Math.cos(t), dy + r * Math.sin(t)] as XY
      })
    const record = ring(100)
    record[36] = record[0]
    // The found loop is open by 3 m at its closure; the access road stops 6 m short.
    const found = ring(100, 0, 2)
    found[0] = [found[0][0] - 1.5, found[0][1]]
    found[36] = [found[36][0] + 1.5, found[36][1]]
    const result = reconnectRoads([
      road('loop', record, found),
      road('access', line([0, -100], [0, -300]), line([0, -104], [0, -300])),
    ])
    const [j] = result.junctions
    expect(j.status).toBe('joined')
    expect(j.throughPair!.map((e) => e.end)).toEqual(['start', 'end'])
    close(result.lines.loop[0], j.at!)
    close(result.lines.loop.at(-1), j.at!)
    close(result.lines.access[0], j.at!)
    close(j.at!, [0, -98])
    expect(result.movedEnds).toEqual({ loop: 2, access: 1 })
  })

  it('closes a loop on its own', () => {
    const result = reconnectRoads([
      road(
        'loop',
        line([0, 0], [100, 0], [100, 100], [0, 100], [0, 0]),
        line([2, 1], [100, 1], [100, 100], [1, 100], [1, 3]),
      ),
    ])
    expect(result.junctions[0].status).toBe('joined')
    close(result.lines.loop[0], [1.5, 2])
    close(result.lines.loop.at(-1), [1.5, 2])
  })

  it('leaves a loop with two other roads at its node as found, and says why', () => {
    const loop = line([0, 0], [100, 0], [100, 100], [0, 100], [0, 0])
    const result = reconnectRoads([
      road('loop', loop, loop),
      road('a', line([0, 0], [-100, 0]), line([0, 0], [-100, 0])),
      road('b', line([0, 0], [0, -100]), line([0, 0], [0, -100])),
    ])
    expect(result.junctions[0].status).toBe('not-joined')
    expect(result.junctions[0].message).toMatch(/A loop meets 2 other road ends here/)
  })

  it('joins a spur whose record ends on another road mid-line, without splitting that road', () => {
    const result = reconnectRoads([
      road('main', line([0, 0], [600, 0]), line([0, -7], [600, -7])),
      road('spur', line([300, 0], [300, 300]), line([294, 2], [294, 300])),
    ])
    const [j] = result.junctions
    expect(j.kind).toBe('mid-road')
    expect(j.onRoadId).toBe('main')
    expect(j.status).toBe('joined')
    close(j.at!, [294, -7])
    close(result.lines.spur[0], [294, -7])
    expect(result.lines.main).toEqual([
      [0, -7],
      [600, -7],
    ])
    expect(j.message).toMatch(/not split/)
  })

  it('never edits the lines it was given', () => {
    const roads = [
      road('A', line([0, 0], [100, 0]), line([0, 5], [98, 5])),
      road('B', line([100, 0], [200, 0]), line([103, 6], [200, 6])),
    ]
    const copy = JSON.parse(JSON.stringify(roads))
    reconnectRoads(roads)
    expect(roads).toEqual(copy)
  })
})

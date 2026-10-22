import { describe, expect, it } from 'vitest'
import { buildTin, gridFromPoints, rasterizeTin, readBreaklines, type Breakline } from './tinSurface'
import type { GroundGrid } from './lasSurface'

/** Seeded so every run samples the same cloud. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cloud(list: Array<[number, number, number]>) {
  return {
    x: Float64Array.from(list, (p) => p[0]),
    y: Float64Array.from(list, (p) => p[1]),
    z: Float64Array.from(list, (p) => p[2]),
  }
}

/** Scattered points over a square, with its corners so the hull is the whole square. */
function scatter(n: number, x0: number, y0: number, size: number, surface: (x: number, y: number) => number, seed = 1) {
  const next = random(seed)
  const list: Array<[number, number, number]> = []
  for (const [cx, cy] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ])
    list.push([x0 + cx, y0 + cy, surface(x0 + cx, y0 + cy)])
  for (let i = 0; i < n; i++) {
    const x = x0 + next() * size,
      y = y0 + next() * size
    list.push([x, y, surface(x, y)])
  }
  return list
}

/** Largest |grid − surface| over cell centres inside the box, and how many were filled. */
function errorWithin(
  grid: GroundGrid,
  surface: (x: number, y: number) => number,
  box: [number, number, number, number],
) {
  let worst = 0,
    filled = 0,
    inside = 0
  for (let row = 0; row < grid.height; row++)
    for (let col = 0; col < grid.width; col++) {
      const x = grid.origin[0] + col * grid.pixelSize[0],
        y = grid.origin[1] + row * grid.pixelSize[1]
      if (x < box[0] || y < box[1] || x > box[2] || y > box[3]) continue
      inside++
      const v = grid.values[row * grid.width + col]
      if (v === null) continue
      filled++
      worst = Math.max(worst, Math.abs(v - surface(x, y)))
    }
  return { worst, filled, inside }
}

/**
 * Whether the breakline vertices passing `on`, ordered by `along`, are each joined to the next
 * by a triangle edge: the breakline is held.
 */
function unbroken(
  tin: ReturnType<typeof buildTin>,
  on: (x: number, y: number) => boolean,
  along: (x: number, y: number) => number,
) {
  const edges = new Set<string>()
  for (let t = 0; t < tin.triangles.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tin.triangles[t + k],
        b = tin.triangles[t + ((k + 1) % 3)]
      edges.add(`${Math.min(a, b)},${Math.max(a, b)}`)
    }
  const x = (v: number) => tin.coords[v * 2],
    y = (v: number) => tin.coords[v * 2 + 1]
  const chain = Array.from({ length: tin.z.length - tin.cloudPoints }, (_, k) => tin.cloudPoints + k)
    .filter((v) => on(x(v), y(v)))
    .sort((a, b) => along(x(a), y(a)) - along(x(b), y(b)))
  return (
    chain.length > 1 &&
    chain.every((v, k) => k === 0 || edges.has(`${Math.min(chain[k - 1], v)},${Math.max(chain[k - 1], v)}`))
  )
}

describe('TIN surface', () => {
  it('rasterizes a sampled plane back to the plane', () => {
    const plane = (x: number, y: number) => 500 + 0.12 * (x - 500000) - 0.05 * (y - 6000000)
    const { grid, tin } = gridFromPoints(cloud(scatter(5000, 500000, 6000000, 100, plane)), [], { cellM: 1 })
    expect(tin.cloudPoints).toBe(5004)
    expect(grid.filledCells).toBe(0)
    expect(grid.groundPoints).toBe(5004)
    expect(grid.epsg).toBeNull()
    const { worst, filled, inside } = errorWithin(grid, plane, [500000, 6000000, 500100, 6000100])
    expect(worst).toBeLessThanOrEqual(0.001)
    expect(filled / inside).toBeGreaterThan(0.98)
  })

  it('holds a ridge crease only when it is a breakline', () => {
    // Two 30% planes meeting at x = 10.37, a line no sample point falls on.
    const crease = 10.37
    const ridge = (x: number) => 100 - 0.3 * Math.abs(x - crease)
    const points = cloud(scatter(800, 0, 0, 20, ridge, 7))
    const box: [number, number, number, number] = [1, 1, 19, 19]
    // Two points per m²: edges run past the 8-cell default at 0.25 m, so allow 4 m.
    const raster = { cellM: 0.25, maxEdgeM: 4 }
    const plain = rasterizeTin(buildTin(points), raster)
    expect(errorWithin(plain, ridge, box).worst).toBeGreaterThan(0.05)

    const line: Breakline = {
      id: 'ridge',
      points: [
        [crease, 0, 100],
        [crease, 20, 100],
      ],
    }
    const tin = buildTin(points, [line])
    expect(tin.skipped).toEqual([])
    expect(tin.constrained).toBeGreaterThan(5)
    expect(
      unbroken(
        tin,
        (x) => x === crease,
        (_, y) => y,
      ),
    ).toBe(true)
    const held = rasterizeTin(tin, raster)
    const { worst, filled, inside } = errorWithin(held, ridge, box)
    expect(worst).toBeLessThan(0.01)
    expect(filled).toBe(inside)
  })

  it('takes a null-z breakline height from the ground', () => {
    const plane = (x: number, y: number) => 50 + 0.1 * x + 0.2 * y
    const tin = buildTin(cloud(scatter(400, 0, 0, 20, plane, 3)), [
      {
        id: 'drape',
        points: [
          [2.2, 3.1, null],
          [17.6, 15.3, null],
        ],
      },
      {
        id: 'off the cloud',
        points: [
          [30, 30, null],
          [40, 30, null],
        ],
      },
    ])
    const start = tin.cloudPoints
    expect(tin.z.length - start).toBeGreaterThan(5)
    for (let v = start; v < tin.z.length; v++)
      expect(tin.z[v]).toBeCloseTo(plane(tin.coords[v * 2], tin.coords[v * 2 + 1]), 6)
    expect(tin.skipped).toHaveLength(1)
    expect(tin.skipped[0].id).toBe('off the cloud')
  })

  it('leaves a data gap missing instead of bridging it', () => {
    const plane = (x: number) => 200 + 0.05 * x
    const list: Array<[number, number, number]> = []
    for (let x = 0; x <= 40; x += 0.5)
      for (let y = 0; y <= 20; y += 0.5) if (!(x > 15 && x < 25 && y > 5 && y < 15)) list.push([x, y, plane(x)])
    const tin = buildTin(cloud(list))
    const gappy = rasterizeTin(tin, { cellM: 1 })
    const centre = (g: GroundGrid, x: number, y: number) =>
      g.values[Math.round((g.origin[1] - y) / g.cellM) * g.width + Math.round((x - g.origin[0]) / g.cellM)]
    // Cell centres sit on the half metre: the grid starts half a cell inside the cloud's corner.
    expect(centre(gappy, 20.5, 10.5)).toBeNull()
    expect(centre(gappy, 5.5, 10.5)).toBeCloseTo(plane(5.5), 3)
    const bridged = rasterizeTin(tin, { cellM: 1, maxEdgeM: 20 })
    expect(centre(bridged, 20.5, 10.5)).toBeCloseTo(plane(20.5), 3)
  })

  it('splits crossing breaklines and goes through overlapping ones, without throwing', () => {
    const points = cloud(scatter(600, 0, 0, 20, () => 10, 11))
    const lines: Breakline[] = [
      {
        id: 'a',
        points: [
          [2, 2, 9],
          [18, 18, 9],
        ],
      },
      {
        id: 'b',
        points: [
          [2, 18, 9.5],
          [18, 2, 9.5],
        ],
      },
      // Collinear with part of `a` but offset along it, so its vertices sit on a's segments.
      {
        id: 'c',
        points: [
          [5.3, 5.3, 9],
          [12.1, 12.1, 9],
        ],
      },
      { id: 'single', points: [[1, 1, 1]] },
    ]
    let tin: ReturnType<typeof buildTin> | undefined
    expect(() => (tin = buildTin(points, lines))).not.toThrow()
    // b crosses a and c at the same point, (10, 10); both crossings share one vertex.
    expect(tin!.split).toBe(2)
    // a and b meet at (10, 10) with different given heights; the earlier one (a) wins.
    expect(tin!.skipped.map((s) => s.id)).toEqual(['single', 'b'])
    expect(tin!.skipped[1].reason).toMatch(/0\.50 m/)
    const at = Array.from({ length: tin!.z.length }, (_, v) => v).find(
      (v) => Math.hypot(tin!.coords[v * 2] - 10, tin!.coords[v * 2 + 1] - 10) < 1e-6,
    )
    expect(tin!.z[at!]).toBe(9)
    // Both diagonals, overlap included, are unbroken chains of triangle edges.
    expect(
      unbroken(
        tin!,
        (x, y) => Math.abs(x - y) < 1e-6,
        (x) => x,
      ),
    ).toBe(true)
    expect(
      unbroken(
        tin!,
        (x, y) => Math.abs(x + y - 20) < 1e-6,
        (x) => x,
      ),
    ).toBe(true)
  })

  it('thins to the lowest point per cell, the same whatever the input order', () => {
    const next = random(5)
    const list: Array<[number, number, number]> = []
    for (let i = 0; i < 4000; i++) list.push([next() * 10, next() * 10, 100 + next() * 5])
    const minX = Math.min(...list.map((p) => p[0])),
      maxY = Math.max(...list.map((p) => p[1]))
    const lowest = new Map<string, number>()
    for (const [x, y, z] of list) {
      const key = `${Math.floor(x - minX)},${Math.floor(maxY - y)}`
      lowest.set(key, Math.min(lowest.get(key) ?? Infinity, z))
    }
    const options = { thinCellM: 1, maxPoints: 1000 }
    const tin = buildTin(cloud(list), [], options)
    expect(tin.thinCellM).toBe(1)
    expect(tin.cloudPoints).toBe(lowest.size)
    const kept = new Set(Array.from(tin.z))
    for (const z of lowest.values()) expect(kept.has(z)).toBe(true)
    const again = buildTin(cloud(list.slice().reverse()), [], options)
    expect(Array.from(again.coords)).toEqual(Array.from(tin.coords))
    expect(Array.from(again.z)).toEqual(Array.from(tin.z))
    expect(Array.from(again.triangles)).toEqual(Array.from(tin.triangles))
  })

  it('keeps one point, the lowest, where points coincide', () => {
    const list: Array<[number, number, number]> = []
    for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) list.push([x, y, 5])
    list.push([5, 5, 4], [5, 5, 6], [5.0004, 5.0002, 7], [3, 3, 5])
    const tin = buildTin(cloud(list))
    expect(tin.cloudPoints).toBe(121)
    const at = Array.from({ length: tin.cloudPoints }, (_, v) => v).find(
      (v) => tin.coords[v * 2] === 5 && tin.coords[v * 2 + 1] === 5,
    )
    expect(tin.z[at!]).toBe(4)
  })

  it('reads GeoJSON breaklines with coordinate or property heights', () => {
    const lines = readBreaklines(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'ditch',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122, 54, 700],
                [-122.001, 54.001, 699],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { elevation: 712 },
            geometry: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [-122, 54],
                  [-122.002, 54],
                ],
                [
                  [-122, 54.002],
                  [-122.002, 54.002],
                ],
              ],
            },
          },
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      },
      (lon, lat) => [lon * 1000, lat * 1000],
    )
    expect(lines.map((l) => l.id)).toEqual(['ditch', 'feature 2 · part 1', 'feature 2 · part 2'])
    expect(lines[0].points[1]).toEqual([-122001, 54001, 699])
    expect(lines[1].points[0][2]).toBe(712)
  })
})

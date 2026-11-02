import { describe, expect, it } from 'vitest'
import { CLUS_EXPECTED_ROAD_CELLS, getCLUSExample, prepExData, ROADS_EXAMPLES } from './examples'
import { roadsCellAt, roadsCellCentre } from './graph'
import {
  getDistFromSource,
  getLandingsFromTarget,
  rasterizeLine,
  rasterToLineSegments,
  type RoadsTarget,
  type RoadsXY,
} from './utilities'
import type { RoadsGrid } from './types'

function grid(width = 5, height = 5, cellM = 1): RoadsGrid {
  return {
    origin: [0.5 * cellM, (height - 0.5) * cellM],
    width,
    height,
    cellM,
    values: new Float64Array(width * height),
  }
}

const square = (x: number, y: number, size: number): RoadsXY[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
]
const donut: RoadsTarget = { id: 'donut', polygons: [[square(0, 0, 100), square(30, 30, 40)]] }
const inDonut = ([x, y]: RoadsXY) =>
  x >= 0 && x <= 100 && y >= 0 && y <= 100 && !(x >= 30 && x <= 70 && y >= 30 && y <= 70)

describe('line rasterization', () => {
  it('burns a whole horizontal line, clips outside portions and does not mutate source values', () => {
    const input = grid()
    expect(
      rasterizeLine(
        [
          [
            [-10, 4.5],
            [10, 4.5],
          ],
        ],
        input,
      ),
    ).toEqual([0, 1, 2, 3, 4])
    expect([...input.values]).toEqual(Array(25).fill(0))
    expect(
      rasterizeLine(
        [
          [
            [-10, 9],
            [10, 9],
          ],
        ],
        input,
      ),
    ).toEqual([])
  })
  it('includes all cells at corner touches and both sides of a grid-aligned boundary', () => {
    const input = grid(3, 3)
    expect(
      rasterizeLine(
        [
          [
            [0.5, 2.5],
            [2.5, 0.5],
          ],
        ],
        input,
      ),
    ).toEqual([0, 1, 3, 4, 5, 7, 8])
    expect(
      rasterizeLine(
        [
          [
            [1, 2.9],
            [1, 0.1],
          ],
        ],
        input,
      ),
    ).toEqual([0, 1, 3, 4, 6, 7])
  })
  it('preserves missing cells unless geometry-only burning is explicit', () => {
    const input = grid()
    input.values[2] = NaN
    const line: RoadsXY[][] = [
      [
        [0.5, 4.5],
        [4.5, 4.5],
      ],
    ]
    expect(rasterizeLine(line, input)).toEqual([0, 1, 3, 4])
    expect(rasterizeLine(line, input, { includeNoData: true })).toEqual([0, 1, 2, 3, 4])
  })
  it('rejects malformed line coordinates', () => {
    expect(() => rasterizeLine([[[0, 0]]], grid())).toThrow('at least two')
    expect(() =>
      rasterizeLine(
        [
          [
            [0, 0],
            [NaN, 2],
          ],
        ],
        grid(),
      ),
    ).toThrow('finite')
  })
})

describe('Euclidean road proximity', () => {
  it('uses exact Euclidean distances in metres, including off-axis distances', () => {
    const input = grid(5, 5, 10)
    const distances = getDistFromSource(input, [0, 24])
    expect(distances.values[0]).toBe(0)
    expect(distances.values[7]).toBeCloseTo(Math.sqrt(5) * 10)
    expect(distances.values[12]).toBeCloseTo(Math.sqrt(8) * 10)
    expect(distances.values[24]).toBe(0)
  })
  it('matches brute force with irregularly distributed sources', () => {
    const input = grid(19, 13, 7.3),
      sources = [3, 28, 140, 211]
    const out = getDistFromSource(input, sources)
    for (let cell = 0; cell < input.values.length; cell++) {
      const [x, y] = roadsCellCentre(input, cell)
      const distance = Math.min(
        ...sources.map((source) => {
          const p = roadsCellCentre(input, source)
          return Math.hypot(p[0] - x, p[1] - y)
        }),
      )
      expect(out.values[cell]).toBeCloseTo(distance, 10)
    }
  })
  it('keeps no-data and absent sources missing, supports a distance limit and a binary mask', () => {
    const input = grid()
    input.values[0] = 1
    input.values[1] = NaN
    const out = getDistFromSource(input, undefined, 2)
    expect(out.values[0]).toBe(0)
    expect(out.values[1]).toBeNaN()
    expect(out.values[10]).toBe(2)
    expect(out.values[24]).toBeNaN()
    expect([...getDistFromSource(input, []).values].every(Number.isNaN)).toBe(true)
    expect(() => getDistFromSource(input, [-1])).toThrow('valid integer')
  })
})

describe('raster roads to approximate lines', () => {
  it('reconstructs a simple connected line with both algorithms', () => {
    const input = grid()
    ;[0, 1, 2, 3, 4].forEach((cell) => {
      input.values[cell] = 1
    })
    for (const method of ['nearest', 'mst'] as const) {
      const result = rasterToLineSegments(input, undefined, { method })
      expect(result.lines).toHaveLength(4)
      expect(result.addedCells).toEqual([])
      expect(result.components).toBe(1)
    }
  })
  it('reports MST-inferred gap cells and keeps gaps across no-data disconnected', () => {
    const input = grid(5, 1)
    const inferred = rasterToLineSegments(input, [0, 4])
    expect(inferred.addedCells).toEqual([1, 2, 3])
    expect(inferred.warnings.join(' ')).toContain('inferred')
    input.values[2] = NaN
    const disconnected = rasterToLineSegments(input, [0, 4])
    expect(disconnected.lines).toEqual([])
    expect(disconnected.components).toBe(2)
  })
  it('keeps single-cell input explicit and rejects unbounded reconstruction', () => {
    expect(rasterToLineSegments(grid(), [2]).lines).toEqual([])
    expect(rasterToLineSegments(grid(), [2]).components).toBe(1)
    expect(() =>
      rasterToLineSegments(
        grid(30, 30),
        Array.from({ length: 600 }, (_, i) => i),
      ),
    ).toThrow('budget')
  })
})

describe('landing generation', () => {
  it('places an interior point in a concave target and outside a polygon hole', () => {
    const concave: RoadsTarget = {
      id: 'concave',
      polygons: [
        [
          [
            [0, 0],
            [100, 0],
            [100, 20],
            [20, 20],
            [20, 100],
            [0, 100],
            [0, 0],
          ],
        ],
      ],
    }
    const sampled = getLandingsFromTarget([concave, donut])
    expect(sampled).toHaveLength(2)
    expect(sampled[0].point[0] <= 20 || sampled[0].point[1] <= 20).toBe(true)
    expect(inDonut(sampled[1].point)).toBe(true)
  })
  it('uses a density grid, respects holes and retains a fallback for tiny polygons', () => {
    const tiny: RoadsTarget = { id: 'tiny', polygons: [[square(201, 201, 1)]] }
    const output = getLandingsFromTarget([donut, tiny], { sampleType: 'regular', densityPerHa: 4 })
    expect(output.filter((p) => p.targetId === 'donut').every((p) => inDonut(p.point))).toBe(true)
    expect(output.filter((p) => p.targetId === 'tiny')).toHaveLength(1)
  })
  it('samples random points reproducibly, by area, excluding holes', () => {
    const options = { sampleType: 'random' as const, densityPerHa: 20, seed: 471 }
    const result = getLandingsFromTarget([donut], options)
    expect(result).toHaveLength(17)
    expect(result.every((p) => inDonut(p.point))).toBe(true)
    expect(getLandingsFromTarget([donut], options)).toEqual(result)
    expect(getLandingsFromTarget([donut], { ...options, seed: 472 })).not.toEqual(result)
  })
  it('samples multipolygon components by their actual area instead of their bounding rectangles', () => {
    const target: RoadsTarget = { id: 'multi', polygons: [[square(0, 0, 100)], [square(1000, 1000, 100)]] }
    const result = getLandingsFromTarget([target], { sampleType: 'random', densityPerHa: 10, seed: 9 })
    expect(result).toHaveLength(20)
    expect(result.every(({ point: [x, y] }) => (x <= 100 && y <= 100) || (x >= 1000 && y >= 1000))).toBe(true)
    expect(result.some(({ point: [x] }) => x < 100)).toBe(true)
    expect(result.some(({ point: [x] }) => x > 1000)).toBe(true)
  })
  it('identifies binary connected components and keeps explicit raster IDs grouped', () => {
    const input = grid()
    input.values[0] = 1
    input.values[1] = 1
    input.values[24] = 1
    expect(getLandingsFromTarget(input)).toHaveLength(2)
    input.values[0] = 2
    input.values[1] = 2
    input.values[24] = 2
    const out = getLandingsFromTarget(input)
    expect(out).toHaveLength(1)
    expect(out[0].targetId).toBe('2')
    expect(input.values[roadsCellAt(input, out[0].point)]).toBe(2)
  })
  it('samples raster areas with both density methods and never samples a missing cell', () => {
    const input = grid(10, 10, 10)
    input.values.fill(1)
    input.values[55] = NaN
    for (const sampleType of ['regular', 'random'] as const) {
      const out = getLandingsFromTarget(input, { sampleType, densityPerHa: 10, seed: 7 })
      expect(out.length).toBeGreaterThan(1)
      expect(out.every((p) => input.values[roadsCellAt(input, p.point)] === 1)).toBe(true)
    }
  })
  it('rejects missing density, duplicated IDs, invalid area and excessive point counts', () => {
    expect(() => getLandingsFromTarget([donut], { sampleType: 'random' })).toThrow('positive landing density')
    expect(() => getLandingsFromTarget([donut, donut])).toThrow('unique')
    expect(() =>
      getLandingsFromTarget([
        {
          id: 'empty',
          polygons: [
            [
              [
                [0, 0],
                [1, 1],
                [2, 2],
              ],
            ],
          ],
        },
      ]),
    ).toThrow('positive area')
    expect(() => getLandingsFromTarget([donut], { sampleType: 'random', densityPerHa: 100000 })).toThrow('budget')
  })
})

describe('portable teaching scenarios', () => {
  it('retains exact upstream CLUS weights and documented zero-based expectations', () => {
    const input = getCLUSExample()
    expect(input.grid.values[5]).toBe(18.0694040143862367)
    expect(input.landings.map((p) => p.cell)).toEqual([10, 12, 21, 24])
    expect(CLUS_EXPECTED_ROAD_CELLS.mst).toHaveLength(14)
  })
  it('returns fresh input arrays, complete metadata and staged target sets', () => {
    for (const example of ROADS_EXAMPLES) {
      const first = prepExData(example.id),
        second = prepExData(example.id)
      expect(first.input.grid.values).not.toBe(second.input.grid.values)
      expect(first.input.grid.values).toEqual(second.input.grid.values)
      expect(first.input.landings.length).toBeGreaterThan(0)
      expect(first.description).toContain('synthetic')
    }
    const staged = prepExData('staged-harvest')
    expect(staged.stages?.flatMap((s) => s.landings)).toEqual(staged.input.landings)
    expect(() => prepExData('missing')).toThrow('Unknown')
  })
})

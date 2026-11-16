import { describe, expect, it } from 'vitest'
import Delaunator from 'delaunator'
import {
  analysisTin,
  terrainCoverShare,
  terrainGridCellM,
  terrainResolution,
  terrainResolutionText,
  TIN_MIN_CELL_M,
  tinGround,
  tinMedianEdge,
  tinStats,
  tinTerrainSource,
  type TinData,
} from './tinGround'
import type { TerrainMetadata } from './types'

/** A seeded generator, so the scattered TIN is the same every run. */
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Scattered points with an uneven surface, triangulated: dense in a strip, sparse beside it. */
function scatteredTin(): TinData {
  const next = random(7)
  const coordinates: number[] = [],
    elevations: number[] = []
  for (let i = 0; i < 1500; i++) {
    const strip = i < 1000
    const x = 500_000 + next() * 2000,
      y = 6_000_000 + (strip ? 900 + next() * 200 : next() * 2000)
    coordinates.push(x, y)
    elevations.push(700 + 30 * Math.sin(x / 70) + 20 * Math.cos(y / 45) + next() * 3)
  }
  return { coordinates, elevations, triangles: Array.from(new Delaunator(coordinates).triangles) }
}

/** Every triangle tried in turn: the reference the index must agree with. */
function bruteForce(tin: TinData, x: number, y: number) {
  const { coordinates: c, elevations: z, triangles: t } = tin
  for (let k = 0; k < t.length; k += 3) {
    const [a, b, d] = [t[k], t[k + 1], t[k + 2]]
    const ux = c[b * 2] - c[a * 2],
      uy = c[b * 2 + 1] - c[a * 2 + 1],
      vx = c[d * 2] - c[a * 2],
      vy = c[d * 2 + 1] - c[a * 2 + 1],
      det = ux * vy - vx * uy
    const dx = x - c[a * 2],
      dy = y - c[a * 2 + 1]
    const wb = (dx * vy - vx * dy) / det,
      wd = (ux * dy - dx * uy) / det
    if (wb >= 0 && wd >= 0 && wb + wd <= 1) return z[a] + wb * (z[b] - z[a]) + wd * (z[d] - z[a])
  }
  return NaN
}

describe('TIN ground', () => {
  const tin = scatteredTin()
  const ground = tinGround(tin)

  it('reads every vertex at its own level and a facet as the plane through its corners', () => {
    for (let i = 0; i < tin.elevations.length; i += 37)
      expect(ground.heightAt(tin.coordinates[i * 2], tin.coordinates[i * 2 + 1])).toBeCloseTo(tin.elevations[i], 9)
    const t = tin.triangles
    for (let k = 0; k < t.length; k += 3 * 53) {
      const [a, b, d] = [t[k], t[k + 1], t[k + 2]]
      const x = (tin.coordinates[a * 2] + tin.coordinates[b * 2] + tin.coordinates[d * 2]) / 3,
        y = (tin.coordinates[a * 2 + 1] + tin.coordinates[b * 2 + 1] + tin.coordinates[d * 2 + 1]) / 3
      expect(ground.heightAt(x, y)).toBeCloseTo((tin.elevations[a] + tin.elevations[b] + tin.elevations[d]) / 3, 9)
    }
  })

  it('agrees with trying every triangle, across the dense strip and the sparse ground', () => {
    const next = random(11)
    for (let i = 0; i < 3000; i++) {
      const x = 499_900 + next() * 2200,
        y = 5_999_900 + next() * 2200
      const want = bruteForce(tin, x, y),
        got = ground.heightAt(x, y)
      if (Number.isNaN(want)) expect(got).toBeNaN()
      else expect(got).toBeCloseTo(want, 9)
    }
  })

  it('reads the same level on a shared edge from either side, and nothing off the TIN', () => {
    const t = tin.triangles
    const [a, b] = [t[0], t[1]]
    const x = (tin.coordinates[a * 2] + tin.coordinates[b * 2]) / 2,
      y = (tin.coordinates[a * 2 + 1] + tin.coordinates[b * 2 + 1]) / 2
    expect(ground.heightAt(x, y)).toBeCloseTo((tin.elevations[a] + tin.elevations[b]) / 2, 9)
    expect(ground.heightAt(400_000, 6_000_000)).toBeNaN()
    expect(ground.heightAt(NaN, 6_000_000)).toBeNaN()
  })

  it('states the TIN’s size, spacing and covered area', () => {
    // Two right triangles over a 10 × 20 m rectangle.
    const square: TinData = {
      coordinates: [0, 0, 10, 0, 10, 20, 0, 20],
      elevations: [1, 2, 3, 4],
      triangles: [0, 1, 2, 0, 2, 3],
    }
    expect(tinStats(square)).toEqual({
      vertices: 4,
      triangles: 2,
      medianEdgeM: 20,
      areaM2: 200,
      bounds: [0, 0, 10, 20],
    })
    expect(tinMedianEdge(square.coordinates, [])).toBeNaN()
    expect(() => tinGround({ ...square, triangles: [] })).toThrow(/no triangles/)
  })

  it('reads through a projection as a terrain source', () => {
    const source = tinTerrainSource(ground, ([lon, lat]) => [500_000 + lon, 6_000_000 + lat])
    expect(source.elevationAt(tin.coordinates[0] - 500_000, tin.coordinates[1] - 6_000_000)).toBeCloseTo(
      tin.elevations[0],
      9,
    )
  })

  it('is the ground only of a terrain whose RoadEng TIN is kept with it', () => {
    const preparation = (operation: 'roadeng-tin' | 'point-cloud') =>
      ({
        preparation: {
          operation,
          sources: [],
          method: '',
          parameters: {},
          tin: {
            coordinates: Array.from(tin.coordinates),
            elevations: Array.from(tin.elevations),
            triangles: Array.from(tin.triangles),
          },
        },
      }) as Pick<TerrainMetadata, 'preparation'>
    expect(analysisTin(preparation('roadeng-tin'))).not.toBeNull()
    // A point cloud's retained TIN stays a record of how its grid was made; the grid is its ground.
    expect(analysisTin(preparation('point-cloud'))).toBeNull()
    expect(analysisTin({})).toBeNull()
  })
})

describe('what a TIN terrain states and samples at', () => {
  // A 2 × 2 m square of two triangles, inside a 100 × 50 m grid box drawn at 5 m.
  const square: TinData = {
    coordinates: [0, 0, 2, 0, 2, 2, 0, 2],
    elevations: [1, 2, 3, 4],
    triangles: [0, 1, 2, 0, 2, 3],
  }
  const raster = { width: 20, height: 10, pixelSize: [5, -5] as [number, number] }
  const kept = (medianEdgeM?: number) =>
    ({
      resolutionM: 5,
      raster,
      preparation: {
        operation: 'roadeng-tin',
        sources: [],
        method: "RoadEng's TIN, read at its facets",
        parameters: medianEdgeM === undefined ? {} : { medianEdgeM, areaM2: 4 },
        tin: square,
      },
    }) as unknown as TerrainMetadata

  it('states a kept TIN by its median edge and any other terrain by its cell', () => {
    expect(terrainResolution(kept(7.85))).toMatchObject({ kind: 'tin', spacingM: 7.85, vertices: 4, triangles: 2 })
    expect(terrainResolutionText(kept(7.85))).toBe('TIN, 7.85 m median point spacing')
    // Without stated figures they are measured from the TIN.
    expect(terrainResolution(kept())).toMatchObject({ kind: 'tin', spacingM: 2 })
    const grid = { resolutionM: 7.69 } as TerrainMetadata
    expect(terrainResolution(grid)).toEqual({ kind: 'grid', spacingM: 7.69 })
    expect(terrainResolutionText(grid)).toBe('7.69 m cells')
  })

  it('samples a TIN at half its median edge, never under 1 m, and a grid at its cell', () => {
    expect(terrainGridCellM(kept(7.85))).toBeCloseTo(3.925, 9)
    expect(terrainGridCellM(kept(1.3))).toBe(TIN_MIN_CELL_M)
    expect(terrainGridCellM({ resolutionM: 7.69 } as TerrainMetadata)).toBe(7.69)
  })

  it('measures the share of the grid box the TIN covers', () => {
    // 4 m² of a 100 × 50 m box.
    expect(terrainCoverShare(kept(2))).toBeCloseTo(4 / 5000, 12)
    expect(terrainCoverShare({ raster } as unknown as TerrainMetadata)).toBe(1)
  })
})

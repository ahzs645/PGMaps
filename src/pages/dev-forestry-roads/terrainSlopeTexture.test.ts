import { describe, expect, it } from 'vitest'
import { runCooperatively, runToCompletion } from './cooperative'
import { terrainSlopeColor } from './terrainDisplay'
import {
  SLOPE_TEXTURE_YIELD_TEXELS,
  TERRAIN_SLOPE_TEXTURE_SIDES,
  slopeTextureUv,
  terrainSlopeTextureGrid,
  terrainSlopeTextureSteps,
  type TerrainSlopeTexture,
  type TerrainSlopeTextureInput,
} from './terrainSlopeTexture'

const bake = (input: TerrainSlopeTextureInput) => runToCompletion(terrainSlopeTextureSteps(input))
const degrees = (gradient: number) => (Math.atan(gradient) * 180) / Math.PI
const texel = (texture: TerrainSlopeTexture, col: number, row: number) =>
  Array.from(texture.rgba.subarray((row * texture.width + col) * 4, (row * texture.width + col) * 4 + 4))
/** The texel under a plan position, found through the texture coordinates. */
const texelAt = (texture: TerrainSlopeTexture, x: number, y: number) => {
  const [u, v] = slopeTextureUv(texture, x, y)
  return texel(texture, Math.floor(u * texture.width), Math.floor(v * texture.height))
}
const centreX = (texture: TerrainSlopeTexture, col: number) => texture.bounds[0] + (col + 0.5) * texture.texelM

describe('terrainSlopeTextureSteps', () => {
  it('colours a plane of known gradient one colour everywhere, edges included', () => {
    // dz/dx 0.3 and dz/dy 0.4: a gradient of 0.5.
    const texture = bake({ bounds: [0, 0, 640, 320], elevationAt: (x, y) => 300 + 0.3 * x - 0.4 * y, maxSide: 65 })
    const expected = [...terrainSlopeColor(degrees(0.5)), 255]
    expect(texture.width).toBe(64)
    expect(texture.height).toBe(32)
    for (let row = 0; row < texture.height; row++)
      for (let col = 0; col < texture.width; col++) expect(texel(texture, col, row)).toEqual(expected)
  })

  it('takes the texel size from the source resolution and the side budget', () => {
    expect(terrainSlopeTextureGrid([0, 0, 1000, 500], 101)).toEqual({
      texelM: 10,
      width: 100,
      height: 50,
      bounds: [0, 0, 1000, 500],
    })
    // A coarser source sets the texel; a finer one does not.
    expect(terrainSlopeTextureGrid([0, 0, 1000, 500], 101, 25).texelM).toBe(25)
    expect(terrainSlopeTextureGrid([0, 0, 1000, 500], 101, 1).texelM).toBe(10)
    // An unaligned window snaps outward and still keeps within the budget.
    const unaligned = terrainSlopeTextureGrid([3.3, 7.1, 1003.3, 507.1], 101)
    expect(unaligned.width).toBeLessThanOrEqual(101)
    expect(unaligned.height).toBeLessThanOrEqual(101)
    expect(unaligned.bounds[0]).toBeLessThanOrEqual(3.3)
    expect(unaligned.bounds[2]).toBeGreaterThanOrEqual(1003.3)
    expect(unaligned.bounds[1]).toBeLessThanOrEqual(7.1)
    expect(unaligned.bounds[3]).toBeGreaterThanOrEqual(507.1)
    for (const edge of unaligned.bounds) expect(Math.abs(edge / 10 - Math.round(edge / 10))).toBeLessThan(1e-9)
    expect(TERRAIN_SLOPE_TEXTURE_SIDES).toEqual({ auto: 1024, high: 1536, efficient: 512 })
  })

  it('keeps the same texels when the window moves by less than a texel', () => {
    const elevationAt = (x: number, y: number) => 50 * Math.sin(x / 70) + 30 * Math.cos(y / 45)
    const a = bake({ bounds: [1, 1, 1001, 1001], elevationAt, maxSide: 101 })
    const b = bake({ bounds: [4, 4, 1004, 1004], elevationAt, maxSide: 101 })
    expect(b.bounds).toEqual(a.bounds)
    expect(b.texelM).toBe(a.texelM)
    expect(b.rgba).toEqual(a.rgba)
    // A move past a texel edge shifts the grid by whole texels; shared interior texels agree.
    const c = bake({ bounds: [11, 1, 1011, 1001], elevationAt, maxSide: 101 })
    expect(c.texelM).toBe(a.texelM)
    expect(c.bounds[0] - a.bounds[0]).toBe(10)
    for (let row = 1; row < a.height - 1; row++)
      for (let col = 2; col < a.width - 1; col++) expect(texel(c, col - 1, row)).toEqual(texel(a, col, row))
  })

  it('leaves missing ground transparent and takes one-sided slopes beside it', () => {
    const plane = (x: number, y: number) => 0.3 * x + 0.4 * y
    const planeColour = [...terrainSlopeColor(degrees(0.5)), 255]
    // No ground west of x = 100 and in one texel at (505, 505).
    const texture = bake({
      bounds: [0, 0, 1000, 1000],
      elevationAt: (x, y) => (x < 100 || (x === 505 && y === 505) ? NaN : plane(x, y)),
      maxSide: 101,
    })
    for (let row = 0; row < texture.height; row++)
      for (let col = 0; col < texture.width; col++) {
        const x = centreX(texture, col),
          y = texture.bounds[3] - (row + 0.5) * texture.texelM
        const missing = x < 100 || (x === 505 && y === 505)
        // Beside the gap the one-sided difference reads the plane exactly.
        expect(texel(texture, col, row)).toEqual(missing ? [0, 0, 0, 0] : planeColour)
      }

    // A strip one texel wide has no neighbour across it: its slope is unknown.
    const strip = bake({
      bounds: [0, 0, 100, 100],
      elevationAt: (x, y) => (x > 50 && x < 60 ? plane(x, y) : NaN),
      maxSide: 11,
    })
    expect(strip.rgba.every((value) => value === 0)).toBe(true)
  })

  it('samples the ground exactly once at each texel centre', () => {
    const calls: [number, number][] = []
    const texture = bake({
      bounds: [12.5, -40, 812.5, 260],
      elevationAt: (x, y) => {
        calls.push([x, y])
        return x * 0.1
      },
      maxSide: 81,
    })
    expect(calls).toHaveLength(texture.width * texture.height)
    const seen = new Set<string>()
    for (const [x, y] of calls) {
      const col = (x - texture.bounds[0]) / texture.texelM - 0.5
      const row = (texture.bounds[3] - y) / texture.texelM - 0.5
      expect(Math.abs(col - Math.round(col))).toBeLessThan(1e-9)
      expect(Math.abs(row - Math.round(row))).toBeLessThan(1e-9)
      seen.add(`${Math.round(col)},${Math.round(row)}`)
    }
    expect(seen.size).toBe(calls.length)
  })

  it('puts a steep corner where slopeTextureUv says that corner is', () => {
    // Steep ground only in the north-east corner; level ground elsewhere.
    const texture = bake({
      bounds: [0, 0, 1000, 600],
      elevationAt: (x, y) => (x > 850 && y > 450 ? 2 * x : 100),
      maxSide: 101,
    })
    const steep = [...terrainSlopeColor(degrees(2)), 255]
    const level = [...terrainSlopeColor(0), 255]
    expect(texelAt(texture, 950, 550)).toEqual(steep)
    for (const [x, y] of [
      [50, 50],
      [950, 50],
      [50, 550],
    ])
      expect(texelAt(texture, x, y)).toEqual(level)
    // North is row 0: the steep texels are in the first rows, not the last.
    expect(texel(texture, texture.width - 3, 2)).toEqual(steep)
    expect(texel(texture, texture.width - 3, texture.height - 3)).toEqual(level)
    expect(slopeTextureUv(texture, texture.bounds[0], texture.bounds[3])).toEqual([0, 0])
    expect(slopeTextureUv(texture, texture.bounds[2], texture.bounds[1])).toEqual([1, 1])
  })

  it('yields in slices and returns the same bytes as a run to completion', async () => {
    const input: TerrainSlopeTextureInput = {
      bounds: [0, 0, 2000, 1500],
      elevationAt: (x, y) => 20 * Math.sin(x / 90) * Math.cos(y / 60),
      maxSide: 400,
    }
    const steps = terrainSlopeTextureSteps(input)
    let yields = 0,
      last = { done: 0, total: 0 },
      next = steps.next()
    while (!next.done) {
      yields++
      expect(next.value.done - last.done).toBeLessThanOrEqual(SLOPE_TEXTURE_YIELD_TEXELS)
      last = next.value
      next = steps.next()
    }
    const sliced = next.value
    expect(yields).toBeGreaterThan(1)
    expect(yields).toBeGreaterThanOrEqual(Math.floor((2 * sliced.width * sliced.height) / SLOPE_TEXTURE_YIELD_TEXELS))
    expect(last.total).toBe(2 * sliced.width * sliced.height)
    expect(sliced.rgba).toEqual(bake(input).rgba)
    expect((await runCooperatively(terrainSlopeTextureSteps(input))).rgba).toEqual(sliced.rgba)
  })

  it('refuses a window it cannot cover', () => {
    expect(() => bake({ bounds: [0, 0, Number.NaN, 10], elevationAt: () => 0, maxSide: 10 })).toThrow()
    expect(() => bake({ bounds: [10, 0, 0, 10], elevationAt: () => 0, maxSide: 10 })).toThrow()
    expect(() => bake({ bounds: [5, 5, 5, 5], elevationAt: () => 0, maxSide: 10 })).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { geoidAt, readGeoid, type GeoidTiff } from './geoid'

/** The 2.5′ EGM2008 node layout, with N a plane in lon and lat so bilinear reads it exactly. */
const plane = (lon: number, lat: number) => -13.7 + 0.05 * (lon + 122.81) - 0.08 * (lat - 53.89)
const fake = (width = 8640): GeoidTiff => ({
  getImage: async () => ({
    getWidth: () => width,
    getHeight: () => 4321,
    getOrigin: () => [-180, 90, 0],
    getResolution: () => [1 / 24, -1 / 24, 0],
    readRasters: async ({ window: [c0, r0, c1, r1] }) => {
      const out = new Float32Array((c1 - c0) * (r1 - r0))
      for (let r = r0; r < r1; r++)
        for (let c = c0; c < c1; c++) out[(r - r0) * (c1 - c0) + (c - c0)] = plane(-180 + c / 24, 90 - r / 24)
      return [out]
    },
  }),
})

describe('EGM2008 geoid', () => {
  it('interpolates between nodes inside the window it read', async () => {
    const grid = await readGeoid([-122.835, 53.88, -122.79, 53.907], fake())
    expect(geoidAt(grid, -122.81, 53.89)).toBeCloseTo(-13.7, 4)
    expect(geoidAt(grid, -122.8, 53.9)).toBeCloseTo(plane(-122.8, 53.9), 4)
    expect(geoidAt(grid, -121, 53.9)).toBeNaN()
  })

  it('refuses a file that is not the 2.5′ grid', async () => {
    await expect(readGeoid([-122.835, 53.88, -122.79, 53.907], fake(4320))).rejects.toThrow(/not the 2.5′ EGM2008 grid/)
  })
})

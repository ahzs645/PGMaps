import { describe, expect, it } from 'vitest'
import { heightAtLocation } from './data'

const grid = { file: 'height.bin', width: 2, height: 2, bounds_mercator: [-100, -100, 100, 100] }
const lon = (x: number) => (x * 180) / 20037508.342789244
const lat = (y: number) => ((2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180) / Math.PI

describe('quantitative web height sampling', () => {
  it('uses north-up row order and the correct projected cell', () => {
    const samples = new Float32Array([5, 10, 15, 20])
    expect(heightAtLocation(samples, grid, lon(-50), lat(50))).toBe(5)
    expect(heightAtLocation(samples, grid, lon(50), lat(50))).toBe(10)
    expect(heightAtLocation(samples, grid, lon(-50), lat(-50))).toBe(15)
    expect(heightAtLocation(samples, grid, lon(50), lat(-50))).toBe(20)
  })
  it('does not convert missing terrain support or outside pixels to zero height', () => {
    const samples = new Float32Array([NaN, 10, 15, 20])
    expect(heightAtLocation(samples, grid, lon(-50), lat(50))).toBeNull()
    expect(heightAtLocation(samples, grid, lon(110), lat(50))).toBeNull()
    expect(heightAtLocation(samples, grid, 0, 90)).toBeNull()
  })
})

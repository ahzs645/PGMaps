import { describe, expect, it } from 'vitest'

import type { TreeInstance } from './forest'
import { movingPixelRatio } from './MovingResolution'
import { LONGEST_SHADOW, shadowStrips } from './treeShadows'

const tree = (overrides: Partial<TreeInstance> = {}): TreeInstance => ({
  lng: -122.4,
  lat: 53.9,
  elevationMeters: 700,
  heightMeters: 20,
  slenderness: 0.2,
  tone: 0.5,
  species: 'spruce',
  variant: 0,
  ...overrides,
})
const flat = () => 700
const metresNorth = (lat: number) => (lat - 53.9) * 111_320
const metresEast = (lng: number) => (lng + 122.4) * 111_320 * Math.cos((53.9 * Math.PI) / 180)

describe('shadowStrips', () => {
  it('lays a shadow away from the sun, as long as the sun is low', () => {
    // The sun in the south at 45°: mercator y runs south, so +y. The shadow falls north, one height long.
    const strips = shadowStrips([tree()], [0, Math.SQRT1_2, Math.SQRT1_2], flat)
    expect(strips.count).toBe(12)
    let farthestNorth = -Infinity
    let farthestEast = 0
    for (let i = 0; i < strips.count; i += 1) {
      farthestNorth = Math.max(farthestNorth, metresNorth(strips.positions[i * 3 + 1]))
      farthestEast = Math.max(farthestEast, Math.abs(metresEast(strips.positions[i * 3])))
    }
    expect(farthestNorth).toBeCloseTo(20, 0)
    // As wide as the crown, 4 m, and no wider.
    expect(farthestEast).toBeGreaterThan(1)
    expect(farthestEast).toBeLessThan(2.1)
  })

  it('never runs past its longest, however low the sun', () => {
    const low = shadowStrips([tree()], [0, Math.cos(0.05), Math.sin(0.05)], flat)
    let farthest = 0
    for (let i = 0; i < low.count; i += 1) farthest = Math.max(farthest, metresNorth(low.positions[i * 3 + 1]))
    expect(farthest).toBeCloseTo(20 * LONGEST_SHADOW, 0)
  })

  it('lies on the ground it is bent over, a little above it', () => {
    // Ground rising to the north: the shadow's end is higher than its foot.
    const rising = (_lng: number, lat: number) => 700 + metresNorth(lat) * 0.5
    const strips = shadowStrips([tree()], [0, Math.SQRT1_2, Math.SQRT1_2], rising)
    const heights = Array.from({ length: strips.count }, (_, i) => strips.positions[i * 3 + 2])
    expect(Math.min(...heights)).toBeGreaterThan(700)
    expect(Math.min(...heights)).toBeLessThan(700.5)
    expect(Math.max(...heights)).toBeGreaterThan(709)
    // Where the ground is unknown the shadow keeps its foot's height rather than falling to nothing.
    const unknown = shadowStrips([tree()], [0, Math.SQRT1_2, Math.SQRT1_2], () => Number.NaN)
    expect(Array.from({ length: unknown.count }, (_, i) => unknown.positions[i * 3 + 2]).every(Number.isFinite)).toBe(
      true,
    )
  })

  it('lays none with the sun overhead or under the horizon', () => {
    expect(shadowStrips([tree()], [0, 0, 1], flat).count).toBe(0)
    expect(shadowStrips([tree()], [0.8, 0, -0.6], flat).count).toBe(0)
  })

  it('shapes each shadow from −1 to 1 across and 0 to 1 along, for the soft edge', () => {
    const strips = shadowStrips([tree(), tree({ lng: -122.401 })], [0.5, 0.5, Math.SQRT1_2], flat)
    expect(strips.count).toBe(24)
    for (let i = 0; i < strips.count; i += 1) {
      expect(Math.abs(strips.shapes[i * 2])).toBe(1)
      expect([0, 0.5, 1]).toContain(strips.shapes[i * 2 + 1])
    }
  })
})

describe('movingPixelRatio', () => {
  it('draws fewer pixels on a dense screen and never more than the screen has', () => {
    expect(movingPixelRatio(2)).toBe(1.25)
    expect(movingPixelRatio(3)).toBe(1.25)
    expect(movingPixelRatio(1)).toBe(1)
  })
})

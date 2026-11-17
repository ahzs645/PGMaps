import { describe, expect, it } from 'vitest'
import { BARREL_RING_SIDES, barrelPolygons, culvertBarrel, shadedColour } from './culvertBarrel'
import type { CulvertProfilePoint } from './engineeringTypes'
import type { TerrainVertex } from './terrainMesh'

// A barrel running along local x from 0 to 12 m, its invert falling 0.24 m (2 %).
const point = (distanceM: number, invert: number | null): CulvertProfilePoint => ({
  distanceM,
  coordinate: [distanceM, 0],
  groundElevation: null,
  formationElevation: null,
  invertElevation: invert,
  crownElevation: invert === null ? null : invert + 0.8,
})
const profile = [point(0, 100), point(4, 99.92), point(8, 99.84), point(12, 99.76)]
const local = (coordinate: CulvertProfilePoint['coordinate']) => [coordinate[0], coordinate[1]] as [number, number]

describe('culvertBarrel', () => {
  it('builds one ring at each end, centred on the true axis', () => {
    const barrel = culvertBarrel({ profile, riseM: 0.8, spanM: 0.8, shape: 'round', point: local, exaggeration: 1 })!
    expect(barrel.rings).toHaveLength(2)
    expect(barrel.rings[0]).toHaveLength(BARREL_RING_SIDES)
    expect(barrel.centres[0]).toEqual({ x: 0, y: 0, z: 100.4 })
    expect(barrel.centres[1].x).toBe(12)
    expect(barrel.centres[1].z).toBeCloseTo(100.16, 9)
  })

  it('keeps the opening its true shape under the preview’s vertical exaggeration', () => {
    const exaggeration = 4
    const barrel = culvertBarrel({ profile, riseM: 0.8, spanM: 0.8, shape: 'round', point: local, exaggeration })!
    const ring = barrel.rings[0]
    const across = Math.max(...ring.map((v) => v.y)) - Math.min(...ring.map((v) => v.y))
    const drawnRise = (Math.max(...ring.map((v) => v.z)) - Math.min(...ring.map((v) => v.z))) * exaggeration
    expect(across).toBeCloseTo(0.8, 9)
    expect(drawnRise).toBeCloseTo(0.8, 9)
  })

  it('draws a box square-cornered at its span and rise', () => {
    const barrel = culvertBarrel({ profile, riseM: 1.2, spanM: 2.4, shape: 'box', point: local, exaggeration: 1 })!
    const ring = barrel.rings[0]
    const corner = ring[BARREL_RING_SIDES / 8]
    expect(Math.abs(corner.y)).toBeCloseTo(1.2, 9)
    expect(corner.z - barrel.centres[0].z).toBeCloseTo(0.6, 9)
  })

  it('draws nothing until two inverts are known', () => {
    const unknown = [point(0, 100), point(12, null)]
    expect(
      culvertBarrel({ profile: unknown, riseM: 0.8, spanM: 0.8, shape: 'round', point: local, exaggeration: 1 }),
    ).toBe(null)
  })
})

describe('barrelPolygons', () => {
  // Looking along +x from the inlet end, in plain orthographic: the inlet opening faces the camera.
  const project = (v: TerrainVertex) => ({ x: v.y * 100, y: -v.z * 100, depth: v.x })

  it('keeps the faces and the opening turned to the camera', () => {
    const barrel = culvertBarrel({ profile, riseM: 0.8, spanM: 0.8, shape: 'round', point: local, exaggeration: 1 })!
    // Seen end-on every side is edge-on; tilt the view a little so half of them face the camera.
    const tilted = (v: TerrainVertex) => ({ x: v.y * 100, y: -(v.z * 100 + v.x * 20), depth: v.x - v.z * 0.2 })
    const drawn = barrelPolygons(barrel, tilted)
    expect(drawn.sides.length).toBeGreaterThan(0)
    expect(drawn.sides.length).toBeLessThan(BARREL_RING_SIDES)
    expect(drawn.ends).toHaveLength(1)
    expect(barrelPolygons(barrel, project).ends).toHaveLength(1)
  })

  it('shows the outlet, not the inlet, when the camera looks from the outlet end', () => {
    const barrel = culvertBarrel({ profile, riseM: 0.8, spanM: 0.8, shape: 'round', point: local, exaggeration: 1 })!
    const fromOutlet = barrelPolygons(barrel, (v) => ({ x: v.y * 100, y: -v.z * 100, depth: 20 - v.x }))
    const outletRing = barrel.rings[1].map((v) => `${(v.y * 100).toFixed(1)},${(-v.z * 100).toFixed(1)}`).join(' ')
    expect(fromOutlet.ends).toEqual([outletRing])
  })
})

describe('shadedColour', () => {
  it('lightens the crown and darkens the invert', () => {
    expect(shadedColour('#0284c7', 0.5)).toBe('#0284c7')
    expect(Number.parseInt(shadedColour('#0284c7', 1).slice(1), 16)).toBeGreaterThan(0x0284c7)
    expect(Number.parseInt(shadedColour('#0284c7', 0).slice(5), 16)).toBeLessThan(0xc7)
  })
})

import { describe, expect, it } from 'vitest'
import { previewCamera } from './previewCamera'
import type { TerrainVertex } from './terrainMesh'
import { groundNearFootprint, occlusionTest, polygonsNear } from './terrainOcclusion'

// Level ground with a 30 m ridge along y = 0; the camera (angle 0) looks toward +y, low over the ground.
const SPACING = 10
const ridge = (x: number, y: number) => ({ x, y, z: Math.abs(y) <= 10 ? 30 : 0 })
const ground: TerrainVertex[][] = []
for (let x = -100; x < 100; x += SPACING)
  for (let y = -100; y < 100; y += SPACING) {
    const a = ridge(x, y),
      b = ridge(x + SPACING, y),
      c = ridge(x + SPACING, y + SPACING),
      d = ridge(x, y + SPACING)
    ground.push([a, b, c], [a, c, d])
  }
const camera = previewCamera({
  bounds: [-100, -100, 100, 100],
  low: 0,
  high: 30,
  target: [0, 0],
  targetZ: 0,
  angle: 0,
  tilt: 0.2,
  exaggeration: 1,
  width: 800,
  height: 400,
  zoom: 1,
})
const strip = (y0: number, y1: number, z: number): TerrainVertex[] => [
  { x: -3, y: y0, z },
  { x: 3, y: y0, z },
  { x: 3, y: y1, z },
  { x: -3, y: y1, z },
]
const test = (footprint: TerrainVertex[][]) =>
  occlusionTest({
    ground,
    skip: groundNearFootprint(ground, footprint, SPACING),
    project: camera.project,
    width: 800,
    height: 400,
    tolerance: SPACING / 2,
  })
const seen = (visible: ReturnType<typeof test>, face: TerrainVertex[]) => visible(face.map(camera.project))

describe('terrain occlusion', () => {
  it('hides a road behind a ridge and keeps one in front of it', () => {
    const behind = strip(50, 60, 0.5),
      inFront = strip(-60, -50, 0.5)
    const visible = test([behind, inFront])
    expect(seen(visible, behind)).toBe(false)
    expect(seen(visible, inFront)).toBe(true)
  })

  it('keeps a road cut through the ridge visible, because the ground over its footprint is not an occluder', () => {
    const cut = strip(-10, 10, 0.5)
    expect(seen(test([cut]), cut)).toBe(true)
    // The same face tested against the whole, unexcavated ground is buried in the ridge.
    const unexcavated = occlusionTest({
      ground,
      skip: new Set(),
      project: camera.project,
      width: 800,
      height: 400,
      tolerance: SPACING / 2,
    })
    expect(seen(unexcavated, cut)).toBe(false)
  })

  it('keeps anything off the depth buffer or over no ground visible', () => {
    const visible = test([])
    expect(visible([{ x: -50, y: 10, depth: 1e6 }])).toBe(true)
    expect(visible([{ x: 400, y: 2, depth: 1e6 }])).toBe(true)
    expect(visible([])).toBe(false)
  })

  it('finds ground faces that overlap or come within the margin of the footprint', () => {
    const square = (x: number, y: number, size: number): TerrainVertex[] => [
      { x, y, z: 0 },
      { x: x + size, y, z: 0 },
      { x: x + size, y: y + size, z: 0 },
      { x, y: y + size, z: 0 },
    ]
    expect(polygonsNear(square(0, 0, 10), square(5, 5, 10), 0)).toBe(true)
    expect(polygonsNear(square(0, 0, 10), square(2, 2, 2), 0)).toBe(true)
    expect(polygonsNear(square(0, 0, 10), square(13, 0, 10), 2)).toBe(false)
    expect(polygonsNear(square(0, 0, 10), square(11, 0, 10), 2)).toBe(true)
    const near = groundNearFootprint([square(0, 0, 10), square(40, 0, 10), square(100, 0, 10)], [square(45, 2, 2)], 5)
    expect([...near]).toEqual([1])
  })
})

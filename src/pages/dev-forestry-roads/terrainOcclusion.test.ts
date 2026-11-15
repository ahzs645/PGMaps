import { describe, expect, it } from 'vitest'
import { previewCamera } from './previewCamera'
import type { TerrainVertex } from './terrainMesh'
import { excavatedGround, faceHeightAt, occlusionTest } from './terrainOcclusion'

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
    ground: excavatedGround(ground, footprint),
    project: camera.project,
    width: 800,
    height: 400,
    tolerance: SPACING / 2,
  })
const seen = (occlusion: ReturnType<typeof test>, face: TerrainVertex[]) => occlusion.visible(face.map(camera.project))
const square = (x: number, y: number, size: number, z = 0): TerrainVertex[] => [
  { x, y, z },
  { x: x + size, y, z },
  { x: x + size, y: y + size, z },
  { x, y: y + size, z },
]

describe('terrain occlusion', () => {
  it('hides a road behind a ridge and keeps one in front of it', () => {
    const behind = strip(50, 60, 0.5),
      inFront = strip(-60, -50, 0.5)
    const occlusion = test([behind, inFront])
    expect(seen(occlusion, behind)).toBe(false)
    expect(seen(occlusion, inFront)).toBe(true)
  })

  it('keeps a road cut through the ridge visible, because the ground over its footprint is excavated', () => {
    const cut = strip(-10, 10, 0.5)
    expect(seen(test([cut]), cut)).toBe(true)
    // The same face tested against the whole, unexcavated ground is buried in the ridge.
    expect(seen(test([]), cut)).toBe(false)
  })

  it('still hides a road behind the ridge when the ridge runs right beside the road', () => {
    // A road through a notch in the ridge, and a road behind the ridge a cell beyond the notch's side:
    // the ridge beside the notch is not part of the notch's footprint, so it still hides the far road.
    const notch = [
      { x: -3, y: -10, z: 0.5 },
      { x: 3, y: -10, z: 0.5 },
      { x: 3, y: 10, z: 0.5 },
      { x: -3, y: 10, z: 0.5 },
    ]
    const behind = [
      { x: 15, y: 50, z: 0.5 },
      { x: 25, y: 50, z: 0.5 },
      { x: 25, y: 60, z: 0.5 },
      { x: 15, y: 60, z: 0.5 },
    ]
    expect(seen(test([notch, behind]), behind)).toBe(false)
  })

  it('covers the part of a strip behind the ground and leaves the part in front', () => {
    // A strip running from in front of the ridge to behind it is drawn as a face, but the cells the
    // ridge hides are marked for the ground to be drawn back over.
    const long = strip(-60, 60, 0.5)
    const occlusion = test([])
    expect(seen(occlusion, long)).toBe(true)
    const cover = occlusion.cover([long.map(camera.project)])!
    const at = (vertex: TerrainVertex) => {
      const p = camera.project(vertex)
      return cover.alpha[Math.floor(p.y / cover.cell) * cover.columns + Math.floor(p.x / cover.cell)]
    }
    expect(at({ x: 0, y: -40, z: 0.5 })).toBe(0)
    expect(at({ x: 0, y: 40, z: 0.5 })).toBe(255)
    expect(occlusion.cover([strip(-60, -50, 0.5).map(camera.project)])).toBeNull()
  })

  it('keeps anything off the depth buffer or over no ground visible', () => {
    const occlusion = test([])
    expect(occlusion.visible([{ x: -50, y: 10, depth: 1e6 }])).toBe(true)
    expect(occlusion.visible([{ x: 400, y: 2, depth: 1e6 }])).toBe(true)
    expect(occlusion.visible([])).toBe(false)
  })

  it('drops ground wholly inside the footprint and lowers the inside corners of ground across its edge', () => {
    const footprint = [square(0, 0, 10, -2)]
    const result = excavatedGround(
      [square(2, 2, 4, 5), square(5, 5, 10, 5), square(40, 0, 10, 5), square(-5, -5, 2, -9)],
      footprint,
    )
    expect(result).toHaveLength(3)
    // Across the edge: the corner inside the footprint drops to the design surface, the rest stay.
    expect(result[0].map((v) => v.z)).toEqual([-2, 5, 5, 5])
    // Clear of the footprint: unchanged, the same face.
    expect(result[1]).toEqual(square(40, 0, 10, 5))
    expect(result[2]).toEqual(square(-5, -5, 2, -9))
    // A fill: ground below the design surface stays where it is.
    expect(excavatedGround([square(5, 5, 10, -6)], footprint)[0].map((v) => v.z)).toEqual([-6, -6, -6, -6])
  })

  it('reads a face height by its fan triangles', () => {
    const face = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 10 },
      { x: 10, y: 10, z: 20 },
      { x: 0, y: 10, z: 10 },
    ]
    expect(faceHeightAt(5, 5, face)).toBeCloseTo(10)
    expect(faceHeightAt(10, 0, face)).toBeCloseTo(10)
    expect(faceHeightAt(11, 5, face)).toBeNull()
  })
})

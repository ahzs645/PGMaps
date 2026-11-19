import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { previewCamera } from './previewCamera'
import { setTerrainGpuCamera } from './terrainGpuRenderer'
import type { TerrainGpuView } from './terrainGpuTypes'

const vertices = [
  { x: -120, y: -95, z: 700 },
  { x: -100, y: -120, z: 710 },
  { x: 120, y: 95, z: 967.5 },
  { x: 100, y: 120, z: 900 },
  { x: 25, y: -30, z: 800 },
]
const options = {
  bounds: [-120, -120, 120, 120],
  low: 700,
  high: 967.5,
  target: [0, 0],
  targetZ: 800,
  angle: 0.49,
  tilt: 0.73,
  exaggeration: 2,
  width: 773,
  height: 431,
  zoom: 1,
  fitVertices: vertices,
}

function viewFor(settings: Parameters<typeof previewCamera>[0]): TerrainGpuView {
  return {
    ...settings,
    camera: previewCamera(settings),
    quality: 'auto',
    wireframe: false,
    showEarthwork: true,
    xray: false,
  }
}

describe('GPU terrain camera agrees with the engineering preview', () => {
  it('projects the same pixels for aspect ratios, turns, tilts, zooms, exaggeration and an offset focus', () => {
    const camera = new THREE.PerspectiveCamera()
    for (const [width, height] of [
      [320, 220],
      [773, 431],
      [1120, 320],
      [320, 640],
    ])
      for (const angle of [0, 0.49, 2.4, -1.2])
        for (const tilt of [0.26, 0.73, 1.39])
          for (const zoom of [0.35, 1, 4, 16])
            for (const exaggeration of [1, 4])
              for (const focus of [undefined, { x: 60, y: -30, z: 760, screen: { x: 0.37, y: 0.61 } }]) {
                const view = viewFor({ ...options, width, height, angle, tilt, zoom, exaggeration, focus })
                const originZ = 730
                setTerrainGpuCamera(camera, view, originZ)
                // WebGLRenderer updates a parentless camera before drawing; that must keep this pose.
                camera.updateMatrixWorld(true)
                for (const vertex of vertices) {
                  const expected = view.camera.project(vertex)
                  const projected = new THREE.Vector3(vertex.x, vertex.y, (vertex.z - originZ) * exaggeration).project(
                    camera,
                  )
                  expect(((projected.x + 1) * width) / 2).toBeCloseTo(expected.x, 6)
                  expect(((1 - projected.y) * height) / 2).toBeCloseTo(expected.y, 6)
                  // Every point covered by the source's world envelope remains within GPU depth limits.
                  expect(projected.z).toBeGreaterThan(-1)
                  expect(projected.z).toBeLessThan(1)
                }
              }
  })

  it('keeps high fills and deep cuts aligned when the upload origin is moved', () => {
    const fitVertices = [
      { x: -120, y: -80, z: -1000 },
      { x: -50, y: 110, z: 700 },
      { x: 110, y: 80, z: 9000 },
    ]
    const camera = new THREE.PerspectiveCamera()
    for (const shift of [0, 1_000_000])
      for (const originZ of [-1000, 0, 7200, 9000]) {
        const shiftedVertices = fitVertices.map((vertex) => ({ ...vertex, z: vertex.z + shift }))
        const view = viewFor({
          ...options,
          low: -1000 + shift,
          high: 9000 + shift,
          targetZ: 9000 + shift,
          fitVertices: shiftedVertices,
          focus: { x: -85, y: 60, z: 8000 + shift, screen: { x: 0.71, y: 0.23 } },
          angle: -2.3,
          tilt: 0.26,
          exaggeration: 4,
          zoom: 4,
        })
        setTerrainGpuCamera(camera, view, originZ + shift)
        for (const vertex of shiftedVertices) {
          const expected = view.camera.project(vertex)
          const projected = new THREE.Vector3(
            vertex.x,
            vertex.y,
            (vertex.z - originZ - shift) * view.exaggeration,
          ).project(camera)
          expect(((projected.x + 1) * view.width) / 2).toBeCloseTo(expected.x, 6)
          expect(((1 - projected.y) * view.height) / 2).toBeCloseTo(expected.y, 6)
          expect(projected.z).toBeGreaterThan(-1)
          expect(projected.z).toBeLessThan(1)
        }
      }
  })

  it('casts picking rays onto the same elevation planes as pointer zoom and pan', () => {
    const camera = new THREE.PerspectiveCamera()
    const raycaster = new THREE.Raycaster()
    for (const [width, height] of [
      [320, 640],
      [1120, 320],
    ])
      for (const angle of [0, 1.5, -2.4])
        for (const tilt of [0.26, 0.73, 1.39])
          for (const exaggeration of [1, 4]) {
            const view = viewFor({
              ...options,
              width,
              height,
              angle,
              tilt,
              exaggeration,
              zoom: 3,
              focus: { x: 40, y: -60, z: 820, screen: { x: 0.35, y: 0.7 } },
            })
            const originZ = 760
            setTerrainGpuCamera(camera, view, originZ)
            for (const [u, v] of [
              [0.2, 0.2],
              [0.5, 0.5],
              [0.8, 0.8],
              [0.35, 0.7],
            ])
              for (const z of [700, 800, 967.5]) {
                const expected = view.camera.unproject(u * width, v * height, z)
                raycaster.setFromCamera(new THREE.Vector2(2 * u - 1, 1 - 2 * v), camera)
                const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(z - originZ) * exaggeration)
                const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
                if (!expected) expect(hit).toBeNull()
                else {
                  expect(hit).not.toBeNull()
                  expect(hit!.x).toBeCloseTo(expected.x, 5)
                  expect(hit!.y).toBeCloseTo(expected.y, 5)
                  expect(hit!.z / exaggeration + originZ).toBeCloseTo(z, 6)
                }
              }
          }
  })

  it('finds no ground with either projection when looking above a level plane horizon', () => {
    const view = viewFor({ ...options, tilt: 0.26 })
    const camera = new THREE.PerspectiveCamera()
    const originZ = 730
    setTerrainGpuCamera(camera, view, originZ)
    const x = view.camera.anchor.x,
      y = -1_000_000,
      z = 700
    expect(view.camera.unproject(x, y, z)).toBeNull()
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2((2 * x) / view.width - 1, 1 - (2 * y) / view.height), camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(z - originZ) * view.exaggeration)
    expect(raycaster.ray.intersectPlane(plane, new THREE.Vector3())).toBeNull()
  })
})

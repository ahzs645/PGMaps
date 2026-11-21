import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { previewCamera } from './previewCamera'
import {
  createTerrainGpu,
  groundGeometry,
  SLOPE_TEXTURE_FRAGMENT,
  setTerrainGpuCamera,
  slopeTextureUvAttribute,
  terrainGpuSceneBox,
  terrainSkirtGeometry,
} from './terrainGpuRenderer'
import type { TerrainGpuData, TerrainGpuView } from './terrainGpuTypes'
import type { TerrainSlopeTexture } from './terrainSlopeTexture'

// No WebGL in the unit tests: the renderer is a stand-in that records the scene it is asked to draw.
const drawn = vi.hoisted(() => ({ scenes: [] as unknown[] }))
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class WebGLRenderer {
    capabilities = { maxTextureSize: 4096, getMaxAnisotropy: () => 4 }
    info = { render: { triangles: 0, calls: 0 } }
    outputColorSpace = ''
    localClippingEnabled = false
    setClearColor() {}
    setSize() {}
    render(scene: unknown) {
      drawn.scenes.push(scene)
    }
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer }
})

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

describe('GPU terrain depth range', () => {
  it('fits near and far to the drawn scene, so a far camera still tells ground from skirt at the road', () => {
    // About the training road's window: 1.6 km across, so the camera stands about 4 km back and zooms by focal length.
    const settings = {
      ...options,
      bounds: [-800, -800, 800, 800],
      low: 680,
      high: 760,
      targetZ: 720,
      fitVertices: [
        { x: -800, y: -800, z: 680 },
        { x: 800, y: 800, z: 760 },
      ],
      zoom: 16,
      exaggeration: 2,
    }
    const view = viewFor(settings)
    const originZ = 680
    // Ground over the window and a skirt hanging 20 m below its lowest point, in the group's own coordinates.
    const group = new THREE.Group()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-800, -800, 0, 800, -800, 40, 800, 800, 80, -800, 800, 60, 0, 0, -20], 3),
    )
    group.add(new THREE.Mesh(geometry))
    const box = terrainGpuSceneBox(group)!
    expect(box.min.toArray()).toEqual([-800, -800, -20])
    expect(box.max.toArray()).toEqual([800, 800, 80])
    expect(terrainGpuSceneBox(new THREE.Group())).toBeNull()

    const loose = new THREE.PerspectiveCamera()
    const fitted = new THREE.PerspectiveCamera()
    setTerrainGpuCamera(loose, view, originZ)
    setTerrainGpuCamera(fitted, view, originZ, box)
    const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, (z - originZ) * view.exaggeration)
    // Only depth changes: every pixel, and so every label and picking ray, stays where it was.
    for (const v of [...vertices, ...settings.fitVertices]) {
      const a = world(v.x, v.y, v.z).project(loose),
        b = world(v.x, v.y, v.z).project(fitted)
      expect(b.x).toBeCloseTo(a.x, 9)
      expect(b.y).toBeCloseTo(a.y, 9)
    }
    // Everything drawn stays between the planes.
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const depth = new THREE.Vector3(x, y, z * view.exaggeration).project(fitted).z
          expect(depth).toBeGreaterThan(-1)
          expect(depth).toBeLessThan(1)
        }
    // Two points 1 cm apart along the view at the focus: a 24-bit depth buffer must tell them apart.
    const { focus } = view.camera
    const at = world(focus.x, focus.y, focus.z)
    const forward = new THREE.Vector3()
    fitted.getWorldDirection(forward)
    const step = (camera: THREE.PerspectiveCamera) =>
      (at.clone().addScaledVector(forward, 0.01).project(camera).z - at.clone().project(camera).z) / 2
    expect(step(fitted)).toBeGreaterThan(2 ** -24)
    // The planes this replaced could not: a step there was metres.
    expect(step(loose)).toBeLessThan(2 ** -24 / 100)
  })
})

describe('GPU terrain skirt', () => {
  it('hangs a vertical face of the given depth under each cut edge, coloured as the ground above it', () => {
    const a = { x: 0, y: 0, z: 805 },
      b = { x: 10, y: 0, z: 803 }
    const colour: [number, number, number] = [0.2, 0.4, 0.6]
    const geometry = terrainSkirtGeometry(
      [
        { a, b },
        // Nothing to hang from a point, or from an unreadable level.
        { a, b: { ...a } },
        { a, b: { x: 5, y: 5, z: NaN } },
      ],
      6,
      800,
      (v) => (v === a || v === b ? colour : null),
      (x, y) => [x / 10, y / 10],
    )
    const position = geometry.getAttribute('position')
    expect(position.count).toBe(6)
    const corners = Array.from({ length: position.count }, (_, i) => [
      position.getX(i),
      position.getY(i),
      position.getZ(i),
    ])
    // Both triangles together: the top edge at the ground's level and the bottom edge `depth` below it.
    expect(new Set(corners.map((c) => c.join(',')))).toEqual(new Set(['0,0,5', '10,0,3', '10,0,-3', '0,0,-1']))
    const normal = geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      expect(Math.abs(normal.getZ(i))).toBeLessThan(1e-9)
      expect(Math.abs(normal.getY(i))).toBeCloseTo(1, 9)
    }
    const colours = geometry.getAttribute('color')
    for (let i = 0; i < colours.count; i++)
      expect([colours.getX(i), colours.getY(i), colours.getZ(i)]).toEqual(colour.map((c) => Math.fround(c)))
    const uv = geometry.getAttribute('uv')
    expect(uv.count).toBe(6)
    for (let i = 0; i < uv.count; i++) expect(uv.getX(i)).toBeCloseTo(position.getX(i) / 10, 6)
    expect(terrainSkirtGeometry([], 6, 800).getAttribute('position').count).toBe(0)
  })
})

describe('GPU ground vertices', () => {
  it('shares vertices exactly where their positions are equal, whether or not the faces share the objects', () => {
    const a = { x: 0, y: 0, z: 700 },
      b = { x: 1, y: 0, z: 701 },
      c = { x: 1, y: 1, z: 702 },
      d = { x: 0, y: 1, z: 703 }
    const data = (ground: TerrainGpuData['ground']): TerrainGpuData => ({
      ground,
      road: [],
      earthwork: [],
      lines: [],
      culverts: [],
      stations: [],
      colour: 'slope',
      low: 700,
      high: 703,
      originZ: 700,
    })
    const shared = groundGeometry(
      data([
        { vertices: [a, b, c], fill: '' },
        { vertices: [a, c, d], fill: '' },
        // An estimated face keeps vertices of its own at the same places.
        { vertices: [a, c, d], fill: '', estimated: true },
      ]),
    )
    const copies = groundGeometry(
      data([
        { vertices: [{ ...a }, { ...b }, { ...c }], fill: '' },
        { vertices: [{ ...a }, { ...c }, { ...d }], fill: '' },
        { vertices: [{ ...a }, { ...c }, { ...d }], fill: '', estimated: true },
      ]),
    )
    for (const result of [shared, copies]) {
      expect(result.geometry.getAttribute('position').count).toBe(7)
      expect(Array.from(result.geometry.getIndex()!.array)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6])
    }
    expect(Array.from(copies.geometry.getAttribute('position').array)).toEqual(
      Array.from(shared.geometry.getAttribute('position').array),
    )
    expect(shared.colourAt({ ...c })).toEqual(
      [0, 1, 2].map((k) => shared.geometry.getAttribute('color').array[2 * 3 + k]),
    )
    expect(shared.colourAt({ x: 5, y: 5, z: 0 })).toBeNull()
  })
})

describe('GPU slope texture', () => {
  const texture: TerrainSlopeTexture = {
    width: 2,
    height: 2,
    rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]),
    bounds: [0, 0, 20, 10],
    texelM: 10,
  }

  it('maps plan positions onto the texture, west to east and north to south', () => {
    const position = new THREE.Float32BufferAttribute([0, 10, 0, 20, 0, 0, 10, 5, 0, 30, 5, 0], 3)
    const uv = slopeTextureUvAttribute(position, texture)
    expect(Array.from(uv.array)).toEqual([0, 0, 1, 1, 0.5, 0.5, 1.5, 0.5])
  })

  it('lays the texture over the vertex colour by its alpha, and only inside its bounds', () => {
    expect(SLOPE_TEXTURE_FRAGMENT).toContain('diffuseColor *= vColor')
    expect(SLOPE_TEXTURE_FRAGMENT).toContain('diffuseColor.rgb * ( 1.0 - slopeTexel.a ) + slopeTexel.rgb')
    expect(SLOPE_TEXTURE_FRAGMENT).toContain('slopeCovered')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    drawn.scenes.length = 0
  })

  it('takes a texture without rebuilding the scene, keeps it across a rebuild in Slope, and drops it otherwise', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} })
    const flush = () => {
      while (frames.length) frames.shift()!(0)
    }
    const dataset: Record<string, string> = {}
    const canvas = {
      width: 0,
      height: 0,
      dataset,
      style: { visibility: '' },
      getContext: () => ({}),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLCanvasElement
    const gpu = createTerrainGpu(canvas, () => {})
    const a = { x: 0, y: 0, z: 700 },
      b = { x: 20, y: 0, z: 701 },
      c = { x: 20, y: 10, z: 702 }
    const data: TerrainGpuData = {
      ground: [{ vertices: [a, b, c], fill: '' }],
      skirt: [{ a, b }],
      skirtDepth: 5,
      road: [],
      earthwork: [],
      lines: [],
      culverts: [],
      stations: [],
      colour: 'slope',
      low: 700,
      high: 702,
      originZ: 700,
    }
    gpu.setData(data)
    gpu.setView(viewFor(options))
    flush()
    const groundOf = () => {
      const group = (drawn.scenes.at(-1) as THREE.Scene).children[0] as THREE.Group
      return group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh).slice(0, 2)
    }
    const revision = dataset.geometryRevision
    expect(groundOf()[0].material).toHaveProperty('map', null)
    expect(groundOf()[0].geometry.getAttribute('uv')).toBeUndefined()

    gpu.setGroundTexture(texture)
    flush()
    // One more frame, the same geometry: the ground and its skirt take the texture at their plan positions.
    expect(dataset.geometryRevision).toBe(revision)
    for (const mesh of groundOf()) {
      const map = (mesh.material as THREE.MeshStandardMaterial).map as THREE.DataTexture
      expect(map).toBeInstanceOf(THREE.DataTexture)
      expect(map.image.data).toBe(texture.rgba)
      expect(map.colorSpace).toBe(THREE.SRGBColorSpace)
      expect(mesh.geometry.getAttribute('uv').count).toBe(mesh.geometry.getAttribute('position').count)
    }
    expect(Array.from(groundOf()[0].geometry.getAttribute('uv').array)).toEqual([0, 1, 1, 1, 1, 0])
    const map = (groundOf()[0].material as THREE.MeshStandardMaterial).map

    // A rebuild in Slope colour keeps the texture in hand.
    gpu.setData({ ...data, ground: [...data.ground] })
    flush()
    expect(Number(dataset.geometryRevision)).toBe(Number(revision) + 1)
    expect((groundOf()[0].material as THREE.MeshStandardMaterial).map).toBe(map)
    expect(groundOf()[0].geometry.getAttribute('uv')).toBeDefined()

    // In Elevation colour the vertex colours alone are drawn.
    gpu.setData({ ...data, colour: 'elevation' })
    flush()
    expect((groundOf()[0].material as THREE.MeshStandardMaterial).map).toBeNull()
    expect(groundOf()[0].geometry.getAttribute('uv')).toBeUndefined()

    gpu.setData({ ...data })
    flush()
    expect((groundOf()[0].material as THREE.MeshStandardMaterial).map).toBe(map)
    gpu.setGroundTexture(null)
    flush()
    expect((groundOf()[0].material as THREE.MeshStandardMaterial).map).toBeNull()
    gpu.dispose()
  })
})

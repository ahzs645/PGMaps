import { describe, expect, it } from 'vitest'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import {
  SCENE_TREE_FIELDS,
  buildScenePackage,
  packageHeightAt,
  parseScenePackage,
  type ScenePackageInput,
} from './scenePackage'
import type { ElevationSource } from './terrain'
import { metersPerDegree } from './visibility'

const EYE = { lng: -122.6, lat: 53.9 }
const m = metersPerDegree(EYE.lat)
/** Ground rising 5% to the north from 700 m. */
const slope: ElevationSource = { elevationAt: (_lng, lat) => 700 + (lat - EYE.lat) * m.lat * 0.05 }
const block: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [EYE.lng + 40 / m.lng, EYE.lat + 60 / m.lat],
      [EYE.lng + 240 / m.lng, EYE.lat + 60 / m.lat],
      [EYE.lng + 240 / m.lng, EYE.lat + 260 / m.lat],
      [EYE.lng + 40 / m.lng, EYE.lat + 260 / m.lat],
      [EYE.lng + 40 / m.lng, EYE.lat + 60 / m.lat],
    ],
  ],
}
const input: ScenePackageInput = {
  eye: EYE,
  eyeHeightMeters: 1.5,
  bearingDegrees: 10,
  pitchDegrees: 2,
  verticalFovDegrees: 40,
  forest: { anchorLatitude: EYE.lat, stands: [], clearings: [block], openings: [block], standHeightMeters: 25 },
  elevation: slope,
  treeRadiusMeters: 400,
  terrainRadiusMeters: 600,
  terrainSpacingMeters: 20,
  createdAt: new Date('2026-11-12T12:00:00Z'),
}

describe('the road view as a scene package', () => {
  const scene = buildScenePackage(input)
  const stride = SCENE_TREE_FIELDS.length
  const trees = Array.from({ length: scene.trees.count }, (_, i) =>
    scene.trees.data.slice(i * stride, (i + 1) * stride),
  )

  it('writes the road view’s own stems, each once', () => {
    // Every stem in the package is one the road view grows, at the same place and height.
    const bands = forestBands(400)
    const grown = forestPatches(EYE, bands, EYE.lat).flatMap((patch) =>
      growForestPatch(
        patch,
        bands[patch.band],
        { stands: [], clearings: [block], openings: [block], heightMeters: 25 },
        slope,
        EYE.lat,
      ),
    )
    // A 1 m spatial hash, matched within 2 cm (the package rounds to the centimetre).
    const cell = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`
    const known = new Map<string, Array<{ x: number; y: number; height: number }>>()
    for (const tree of grown) {
      const x = (tree.lng - EYE.lng) * m.lng
      const y = (tree.lat - EYE.lat) * m.lat
      const list = known.get(cell(x, y)) ?? []
      list.push({ x, y, height: tree.heightMeters })
      known.set(cell(x, y), list)
    }
    const find = (x: number, y: number) => {
      for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1])
          for (const tree of known.get(cell(x + dx, y + dy)) ?? [])
            if (Math.hypot(tree.x - x, tree.y - y) < 0.02) return tree
      return null
    }
    expect(scene.trees.count).toBeGreaterThan(1000)
    for (const [x, y, , , height] of trees) {
      const tree = find(x, y)
      expect(tree).not.toBeNull()
      expect(tree!.height).toBeCloseTo(height, 1)
    }
    const key = (x: number, y: number) => `${x},${y}`
    // No stem twice where the bands overlap.
    expect(new Set(trees.map(([x, y]) => key(x, y))).size).toBe(trees.length)
    expect(Math.max(...trees.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(400)
  })

  it('keeps the block open and puts slash on it', () => {
    const inBlock = (x: number, y: number) => x > 40 && x < 240 && y > 60 && y < 260
    expect(trees.some(([x, y]) => inBlock(x, y))).toBe(false)
    expect(scene.debris.count).toBeGreaterThan(100)
    const debris = Array.from({ length: scene.debris.count }, (_, i) => scene.debris.data.slice(i * 4, i * 4 + 4))
    expect(debris.every(([x, y]) => inBlock(x, y))).toBe(true)
    expect(scene.openings[0].rings[0][0]).toEqual([40, 60])
  })

  it('carries the drawn ground and stands each stem on it', () => {
    expect(scene.terrain.columns).toBe(61)
    expect(packageHeightAt(scene, 0, 0)).toBeCloseTo(700, 1)
    expect(packageHeightAt(scene, 33, 210)).toBeCloseTo(700 + 210 * 0.05, 1)
    for (const [x, y, z] of trees.slice(0, 50)) expect(z).toBeCloseTo(packageHeightAt(scene, x, y), 0)
  })

  it('puts the eye at its height over the ground, facing the way it faced', () => {
    expect(scene.camera).toEqual({
      position: [0, 0, 701.5],
      bearingDegrees: 10,
      pitchDegrees: 2,
      verticalFovDegrees: 40,
    })
  })

  it('carries each species’ own model at unit height and unit crown width', () => {
    for (const id of scene.trees.species) {
      const model = scene.models![id]
      expect(model.positions.length % 9).toBe(0)
      expect(model.normals.length).toBe(model.positions.length)
      expect(model.bark.length * 3).toBe(model.positions.length)
      let top = 0
      let widest = 0
      for (let i = 0; i < model.positions.length; i += 3) {
        top = Math.max(top, model.positions[i + 2])
        widest = Math.max(widest, Math.hypot(model.positions[i], model.positions[i + 1]))
      }
      expect(top).toBeCloseTo(1, 3)
      expect(widest).toBeCloseTo(0.5, 2)
    }
    expect(buildScenePackage({ ...input, includeModels: false }).models).toBeUndefined()
  })

  it('reads back, and refuses what is not a package', () => {
    expect(parseScenePackage(JSON.parse(JSON.stringify(scene))).trees.count).toBe(scene.trees.count)
    expect(() => parseScenePackage({ format: 'other' })).toThrow(/Not a PGMaps/)
    expect(() => parseScenePackage({ ...scene, trees: { ...scene.trees, count: 1 } })).toThrow(/tree list/)
  })
})

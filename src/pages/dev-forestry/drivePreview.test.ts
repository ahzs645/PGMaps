import { describe, expect, it } from 'vitest'
import { roadLookAhead, roadPath, roadPlacement, smoothAngle } from './driveMath'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import { roadsideTreeMesh } from './treeGeometry'
import { TREE_SPECIES_IDS, bufferLine } from './forest'
import { pointInPolygon } from './visibility'

const eye = { lng: -122.65, lat: 53.9 }
const bands = forestBands(10000)
const inputs = { stands: [], clearings: [], heightMeters: 28 }
describe('driving through a forest', () => {
  it('turns continuously through a bend while the eye remains on the road', () => {
    const path = roadPath([
      [-122.65, 53.9],
      [-122.649, 53.9],
      [-122.649, 53.901],
    ])
    const bend = path[1].distanceAlongMeters
    expect(roadPlacement(path, bend)?.lng).toBe(-122.649)
    const before = roadLookAhead(path, bend - 0.01)!,
      after = roadLookAhead(path, bend + 0.01)!
    expect(Math.abs(before.bearing - after.bearing)).toBeLessThan(0.1)
    expect(before.bearing).toBeGreaterThan(0)
    expect(before.bearing).toBeLessThan(90)
    expect(smoothAngle(359, 1, 0.5)).toBe(0)
  })
  it('keeps identical trees and elevations in overlapping patches as the eye moves', () => {
    const a = forestPatches(eye, bands, eye.lat),
      b = forestPatches({ ...eye, lng: eye.lng + 0.001 }, bands, eye.lat)
    const common = a.find((p) => p.band === 0 && b.some((q) => q.key === p.key))!
    const other = b.find((p) => p.key === common.key)!
    const terrain = { elevationAt: (lng: number, lat: number) => 800 + (lng - eye.lng) * 1000 + (lat - eye.lat) * 3000 }
    const trees = growForestPatch(common, bands[0], inputs, terrain, eye.lat)
    expect(trees.length).toBeGreaterThan(100)
    expect(trees).toEqual(growForestPatch(other, bands[0], inputs, terrain, eye.lat))
    for (const tree of trees) expect(tree.elevationMeters).toBe(terrain.elevationAt(tree.lng, tree.lat))
  })
  it('never grows trees on missing terrain, and preserves road and cutblock clearings', () => {
    const patch = forestPatches(eye, bands, eye.lat)[0]
    expect(growForestPatch(patch, bands[0], inputs, { elevationAt: () => NaN }, eye.lat)).toEqual([])
    const clearing = bufferLine(
      [
        [-122.66, 53.9],
        [-122.64, 53.9],
      ],
      30,
    )!
    const trees = growForestPatch(
      patch,
      bands[0],
      { ...inputs, clearings: [clearing] },
      { elevationAt: () => 800 },
      eye.lat,
    )
    expect(trees.length).toBeGreaterThan(0)
    expect(trees.every((tree) => !pointInPolygon(clearing, tree.lng, tree.lat))).toBe(true)
  })
  it('covers the distant hillside without duplicating trees at tile boundaries', () => {
    const patches = forestPatches(eye, bands, eye.lat)
    expect(patches.some((p) => p.band === 2 && p.centre.lng > eye.lng + 0.1)).toBe(true)
    const trees = patches
      .filter((p) => p.band === 0)
      .flatMap((p) => growForestPatch(p, bands[0], inputs, { elevationAt: () => 800 }, eye.lat))
    expect(new Set(trees.map((t) => `${t.lng}/${t.lat}`)).size).toBe(trees.length)
    expect(trees.length).toBeLessThan(60000)
  })
  it('builds bounded 3D branches and separate bark for every supported species', () => {
    for (const species of TREE_SPECIES_IDS) {
      const mesh = roadsideTreeMesh(species),
        p = mesh.attributes.positions.value
      expect([...p].every(Number.isFinite)).toBe(true)
      expect(mesh.indices.value.length / 3).toBeLessThan(1000)
      expect(Math.max(...mesh.indices.value)).toBeLessThan(p.length / 3)
      expect(mesh.attributes.bark?.value).toContain(1)
      expect(mesh.attributes.bark?.value).toContain(0)
      expect(Math.min(...[...p].filter((_, i) => i % 3 === 2))).toBe(0)
    }
  })
})

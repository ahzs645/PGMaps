import { describe, expect, it } from 'vitest'
import { TREE_SPECIES_IDS } from './forest'
import { TREE_SPECIES_DRAWING } from './impostor'
import { detailedTreeMesh, roadsideTreeMesh } from './treeGeometry'

describe('detailed tree meshes', () => {
  for (const species of TREE_SPECIES_IDS) {
    describe(species, () => {
      const mesh = detailedTreeMesh(species, 1)
      const positions = mesh.attributes.positions.value
      const bark = mesh.attributes.bark!.value
      const foliage = Array.from({ length: positions.length / 3 }, (_, i) => i).filter((i) => bark[i] === 0)

      it('stands one unit tall from the ground, so a stem scales by its own height', () => {
        let top = 0
        let bottom = Infinity
        for (let i = 2; i < positions.length; i += 3) {
          top = Math.max(top, positions[i])
          bottom = Math.min(bottom, positions[i])
        }
        expect(bottom).toBeCloseTo(0, 2)
        expect(top).toBeGreaterThan(0.95)
        expect(top).toBeLessThan(1.06)
      })

      it('is as wide as the near mesh it stands in for, so a crown width means the same', () => {
        const radius = (data: Float32Array) => {
          let widest = 0
          for (let i = 0; i < data.length; i += 3) widest = Math.max(widest, Math.hypot(data[i], data[i + 1]))
          return widest
        }
        const simple = radius(roadsideTreeMesh(species).attributes.positions.value)
        expect(radius(positions)).toBeGreaterThan(simple * 0.75)
        expect(radius(positions)).toBeLessThan(simple * 1.25)
      })

      it('starts its foliage where the far card starts its crown', () => {
        const lowest = Math.min(...foliage.map((i) => positions[i * 3 + 2]))
        // Lower limbs droop below where they leave the stem.
        expect(lowest).toBeGreaterThan(TREE_SPECIES_DRAWING[species].crownBase - 0.15)
        expect(lowest).toBeLessThan(TREE_SPECIES_DRAWING[species].crownBase + 0.15)
      })

      it('fits a 16-bit index buffer and a few thousand triangles', () => {
        expect(positions.length / 3).toBeLessThan(65_536)
        const triangles = mesh.indices.value.length / 3
        expect(triangles).toBeGreaterThan(1_000)
        expect(triangles).toBeLessThan(6_000)
      })

      it('is the same tree every time for the same seed, and a different one for another', () => {
        expect(detailedTreeMesh(species, 1).attributes.positions.value).toEqual(positions)
        expect(detailedTreeMesh(species, 2).attributes.positions.value).not.toEqual(positions)
      })
    })
  }
})

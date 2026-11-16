import { describe, expect, it } from 'vitest'
import { TREE_DRAWING_IDS, TREE_SPECIES_IDS } from './forest'
import { TREE_DRAWINGS, TREE_SPECIES_DRAWING } from './impostor'
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
        // Exactly: a stem is drawn at its recorded height.
        expect(top).toBeCloseTo(1, 6)
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
        for (const seed of [2, 3, 4, 5, 6]) {
          const other = detailedTreeMesh(species, seed).attributes.positions.value
          let highest = 0
          for (let i = 2; i < other.length; i += 3) highest = Math.max(highest, other[i])
          expect(highest).toBeCloseTo(1, 6)
        }
        expect(detailedTreeMesh(species, 2).attributes.positions.value).not.toEqual(positions)
      })
    })
  }
})

describe('every drawing, built of bough cards', () => {
  for (const drawing of TREE_DRAWING_IDS) {
    describe(drawing, () => {
      const solid = detailedTreeMesh(drawing, 3)
      const cards = detailedTreeMesh(drawing, 3, 'cards')
      const positions = cards.attributes.positions.value
      const bark = cards.attributes.bark!.value
      const uvs = cards.attributes.uvs!.value

      it('is the same tree as its solid build, in fewer triangles', () => {
        expect(solid.attributes.uvs).toBeUndefined()
        expect(cards.indices.value.length).toBeLessThan(solid.indices.value.length)
        // Stems and limbs are the same tubes in both; only the sprays differ.
        const woody = (mesh: typeof solid) =>
          Array.from(mesh.attributes.bark!.value).filter((value) => value > 0).length
        expect(woody(cards)).toBe(woody(solid))
      })

      it('stands one unit tall and starts its foliage where its card starts its crown', () => {
        let top = 0
        let lowest = Infinity
        for (let i = 0; i < positions.length / 3; i += 1) {
          top = Math.max(top, positions[i * 3 + 2])
          if (bark[i] === 0) lowest = Math.min(lowest, positions[i * 3 + 2])
        }
        expect(top).toBeCloseTo(1, 6)
        expect(lowest).toBeGreaterThan(TREE_DRAWINGS[drawing].crownBase - 0.2)
        expect(lowest).toBeLessThan(TREE_DRAWINGS[drawing].crownBase + 0.15)
      })

      it('gives its foliage a place in the spray sheet and its wood none', () => {
        expect(uvs.length).toBe((positions.length / 3) * 2)
        for (let i = 0; i < positions.length / 3; i += 1) {
          if (bark[i] > 0) expect(uvs[i * 2]).toBeLessThan(0)
          else {
            expect(uvs[i * 2]).toBeGreaterThanOrEqual(0)
            expect(uvs[i * 2]).toBeLessThanOrEqual(1)
            expect(uvs[i * 2 + 1]).toBeGreaterThanOrEqual(0)
            expect(uvs[i * 2 + 1]).toBeLessThanOrEqual(1)
          }
        }
      })

      it('fits a 16-bit index buffer', () => {
        expect(positions.length / 3).toBeLessThan(65_536)
      })
    })
  }
})

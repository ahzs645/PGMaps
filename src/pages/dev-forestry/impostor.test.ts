import { describe, expect, it } from 'vitest'

import { TREE_SPECIES_IDS, VARIANTS_PER_SPECIES, type TreeSpeciesId } from './forest'
import { BILLBOARD_ASPECT, TREE_SPECIES_DRAWING, atlasCell, impostorShapes } from './impostor'

/** Every point of every shape, flattened. */
function allPoints(species: TreeSpeciesId, variant = 0) {
  return impostorShapes(species, variant).flatMap((shape) => shape.points)
}

describe('impostorShapes', () => {
  it('draws every species inside the card', () => {
    for (const species of TREE_SPECIES_IDS) {
      for (let variant = 0; variant < VARIANTS_PER_SPECIES; variant += 1) {
        const points = allPoints(species, variant)
        expect(points.length).toBeGreaterThan(10)
        for (const [x, y] of points) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(1)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('stands on the ground and reaches the top of the card', () => {
    for (const species of TREE_SPECIES_IDS) {
      const ys = allPoints(species).map(([, y]) => y)
      expect(Math.min(...ys)).toBeCloseTo(0, 6)
      expect(Math.max(...ys)).toBeCloseTo(1, 6)
    }
  })

  it('gives each species a crown no wider than its own', () => {
    for (const species of TREE_SPECIES_IDS) {
      const halfWidth = Math.max(...allPoints(species).map(([x]) => Math.abs(x - 0.5)))
      // The card is BILLBOARD_ASPECT of the tree's height, so a crown of
      // `crownRatio` fills `crownRatio / BILLBOARD_ASPECT` of the card's width.
      const expected = TREE_SPECIES_DRAWING[species].crownRatio / BILLBOARD_ASPECT / 2
      expect(halfWidth).toBeLessThanOrEqual(expected * 1.25)
      expect(halfWidth).toBeGreaterThan(expected * 0.55)
    }
  })

  it('narrows from the butt to the leader on a conifer', () => {
    // Widest point of the live crown against the width near the top.
    const widthBetween = (species: TreeSpeciesId, from: number, to: number) =>
      Math.max(
        0,
        ...allPoints(species)
          .filter(([, y]) => y >= from && y <= to)
          .map(([x]) => Math.abs(x - 0.5)),
      )

    for (const species of ['spruce', 'fir'] as const) {
      const low = widthBetween(species, 0.2, 0.4)
      const high = widthBetween(species, 0.8, 0.95)
      expect(low).toBeGreaterThan(high * 1.8)
    }
  })

  it('keeps a lodgepole bare below its crown and a spruce branched to the ground', () => {
    const foliageFloor = (species: TreeSpeciesId) => {
      const shapes = impostorShapes(species, 0)
      // The bole is the first shape; everything after it is crown.
      const crown = shapes.slice(1).flatMap((shape) => shape.points)
      return Math.min(...crown.map(([, y]) => y))
    }

    expect(foliageFloor('pine')).toBeGreaterThan(0.35)
    expect(foliageFloor('spruce')).toBeLessThan(0.2)
  })

  it('draws an aspen as a rounded crown rather than tiers', () => {
    const aspen = impostorShapes('aspen', 0)
    const spruce = impostorShapes('spruce', 0)
    // Blobs are many-sided; branch tiers are six-point wings.
    expect(aspen.slice(1).every((shape) => shape.points.length > 8)).toBe(true)
    expect(spruce.slice(1, -1).every((shape) => shape.points.length === 6)).toBe(true)
  })

  it('is the same drawing every time, and different between variants', () => {
    expect(impostorShapes('spruce', 1)).toEqual(impostorShapes('spruce', 1))
    expect(impostorShapes('spruce', 1)).not.toEqual(impostorShapes('spruce', 2))
    expect(impostorShapes('spruce', 1)).not.toEqual(impostorShapes('fir', 1))
  })

  it('keeps every colour in range', () => {
    for (const species of TREE_SPECIES_IDS) {
      for (const shape of impostorShapes(species, 0)) {
        expect(shape.color).toHaveLength(3)
        expect(shape.color.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)).toBe(true)
      }
    }
  })
})

describe('atlasCell', () => {
  const atlas = {
    columns: VARIANTS_PER_SPECIES,
    rows: TREE_SPECIES_IDS.length,
    speciesRow: { pine: 0, spruce: 1, fir: 2, aspen: 3 } as Record<TreeSpeciesId, number>,
  }

  it('puts each species on its own row and each variant in its own column', () => {
    expect(atlasCell(atlas, 'pine', 0)).toEqual([0, 0])
    expect(atlasCell(atlas, 'aspen', 0)).toEqual([0, 0.75])
    expect(atlasCell(atlas, 'spruce', 2)).toEqual([0.5, 0.25])
  })

  it('wraps a variant outside the atlas rather than reading past it', () => {
    expect(atlasCell(atlas, 'fir', VARIANTS_PER_SPECIES)).toEqual(atlasCell(atlas, 'fir', 0))
    expect(atlasCell(atlas, 'fir', -1)).toEqual(atlasCell(atlas, 'fir', VARIANTS_PER_SPECIES - 1))
  })
})

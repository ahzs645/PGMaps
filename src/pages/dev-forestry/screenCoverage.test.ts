/**
 * How much of the view each drawn tree covers, pinned.
 *
 * Screening is what decides whether a block is seen from a road, and the
 * trial (`docs/forestry-visual-tools-trial-2026-11-12.md`) measured that a
 * tree's drawn shape alone moves the share of a view a stand hides by 10–12
 * points at the same density and crown closure. So a change to a silhouette
 * or to the detailed mesh is a change to the evidence, not just to the look,
 * and it should fail here rather than pass unnoticed. Update the pinned
 * figures only on purpose, and say why in the commit.
 *
 * Both are measured side-on, in the frame the layer draws them in: a stem of
 * height 1 with its species' crown ratio. The far card's coverage is its
 * opaque area; the detailed mesh's is its silhouette seen from the side.
 */
import { describe, expect, it } from 'vitest'
import {
  CONE_BASE_DIAMETER,
  SPECIES_CROWN_RATIO,
  TREE_SPECIES_IDS,
  VARIANTS_PER_SPECIES as VARIANTS_PER_SPECIES_FOR_TESTS,
  type TreeSpeciesId,
} from './forest'
import { BILLBOARD_ASPECT, impostorShapes } from './impostor'
import { detailedTreeMesh } from './treeGeometry'

const GRID = 360

/** Share of a unit-height card's bounding square its opaque shapes cover, averaged over variants. */
function cardArea(species: TreeSpeciesId): number {
  let total = 0
  for (let variant = 0; variant < VARIANTS_PER_SPECIES_FOR_TESTS; variant += 1) {
    const mask = new Uint8Array(GRID * GRID)
    for (const shape of impostorShapes(species, variant)) {
      // Even-odd scanline fill of each shape; shapes overlap, so the mask is their union.
      const points = shape.points
      for (let row = 0; row < GRID; row += 1) {
        const y = (row + 0.5) / GRID
        const crossings: number[] = []
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i]
          const [xj, yj] = points[j]
          if (yi > y !== yj > y) crossings.push(xi + ((y - yi) / (yj - yi)) * (xj - xi))
        }
        crossings.sort((a, b) => a - b)
        for (let k = 0; k + 1 < crossings.length; k += 2) {
          const from = Math.max(0, Math.ceil(crossings[k] * GRID - 0.5))
          const to = Math.min(GRID - 1, Math.floor(crossings[k + 1] * GRID - 0.5))
          for (let col = from; col <= to; col += 1) mask[row * GRID + col] = 1
        }
      }
    }
    // The card is BILLBOARD_ASPECT of the tree's height wide.
    total += (mask.reduce((sum, value) => sum + value, 0) / (GRID * GRID)) * BILLBOARD_ASPECT
  }
  return total / VARIANTS_PER_SPECIES_FOR_TESTS
}

/** Side-on silhouette area of the detailed mesh, at unit height and the species' crown ratio. */
function meshArea(species: TreeSpeciesId): number {
  const mesh = detailedTreeMesh(species, 1)
  const p = mesh.attributes.positions.value
  const index = mesh.indices.value
  // The layer scales x by crown width over CONE_BASE_DIAMETER; height stays 1.
  const widthScale = SPECIES_CROWN_RATIO[species] / CONE_BASE_DIAMETER
  const span = 1.2
  const mask = new Uint8Array(GRID * GRID)
  const toCol = (x: number) => ((x * widthScale) / span + 0.5) * GRID
  const toRow = (z: number) => z * GRID
  for (let t = 0; t < index.length; t += 3) {
    const ax = toCol(p[index[t] * 3]),
      ay = toRow(p[index[t] * 3 + 2])
    const bx = toCol(p[index[t + 1] * 3]),
      by = toRow(p[index[t + 1] * 3 + 2])
    const cx = toCol(p[index[t + 2] * 3]),
      cy = toRow(p[index[t + 2] * 3 + 2])
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(area) < 1e-9) continue
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(GRID - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(GRID - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let row = minY; row <= maxY; row += 1) {
      for (let col = minX; col <= maxX; col += 1) {
        const x = col + 0.5,
          y = row + 0.5
        const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area
        const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mask[row * GRID + col] = 1
      }
    }
  }
  return (mask.reduce((sum, value) => sum + value, 0) / (GRID * GRID)) * span
}

/**
 * Side-on area of each species' drawing, in units of its height squared.
 * Pinned on 12 November 2026 when the detailed mesh and Douglas-fir were
 * added; the detailed fir, Douglas-fir and spruce were tuned to their cards
 * against this test (first draft: 0.79, 1.20 and 0.88 of the card). Re-pinned
 * the same day when the detailed mesh was normalised to exactly unit height
 * (some seeds had stood up to 6% taller than the stem's recorded height).
 */
const PINNED: Record<TreeSpeciesId, { card: number; mesh: number }> = {
  pine: { card: 0.037, mesh: 0.0341 },
  spruce: { card: 0.0664, mesh: 0.06 },
  fir: { card: 0.045, mesh: 0.0426 },
  douglasFir: { card: 0.0466, mesh: 0.0503 },
  aspen: { card: 0.0831, mesh: 0.0787 },
  birch: { card: 0.0689, mesh: 0.0662 },
}

describe('screen coverage of the drawn trees', () => {
  const measured = Object.fromEntries(
    TREE_SPECIES_IDS.map((species) => [species, { card: cardArea(species), mesh: meshArea(species) }]),
  ) as Record<TreeSpeciesId, { card: number; mesh: number }>

  for (const species of TREE_SPECIES_IDS) {
    it(`${species}: the far card covers what it was pinned at`, () => {
      // Within half a percent: a re-drawn silhouette moves it by more.
      expect(Math.abs(measured[species].card / PINNED[species].card - 1)).toBeLessThan(0.005)
    })
    it(`${species}: the detailed mesh covers what it was pinned at`, () => {
      expect(Math.abs(measured[species].mesh / PINNED[species].mesh - 1)).toBeLessThan(0.005)
    })
    it(`${species}: stopping to draw detail changes the tree's screen cover by under 15%`, () => {
      // The detail is the same stem drawn again; if it hid much more or much
      // less of the view than its card, stopping would change the screening.
      expect(measured[species].mesh / measured[species].card).toBeGreaterThan(0.85)
      expect(measured[species].mesh / measured[species].card).toBeLessThan(1.15)
    })
  }
})

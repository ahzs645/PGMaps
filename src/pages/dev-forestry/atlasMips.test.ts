import { describe, expect, it } from 'vitest'
import { alphaCoverage, coveragePreservingMips, downsample, type MipLevel } from './atlasMips'

/**
 * A crown-like cell: a cone of foliage, solid in its core and a sparse fringe
 * of needles (`fringe` of texels covered) toward its edge.
 */
function raggedCrown(width: number, height: number, seed = 3, core = 0.7, fringe = 0.35): MipLevel {
  const data = new Uint8ClampedArray(width * height * 4)
  let state = seed
  const random = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646
  for (let y = 0; y < height; y += 1) {
    const t = y / height
    const half = (width / 2) * (0.1 + 0.85 * t)
    for (let x = 0; x < width; x += 1) {
      const d = Math.abs(x - width / 2)
      const i = (y * width + x) * 4
      data[i] = 40
      data[i + 1] = 90
      data[i + 2] = 50
      data[i + 3] = d < half * core ? 255 : d < half && random() < fringe ? 255 : 0
    }
  }
  return { width, height, data }
}

/** Coverage of one cell of a level laid out `columns` across. */
function cellCoverage(level: MipLevel, columns: number, column: number, threshold: number): number {
  const cellWidth = level.width / columns
  const x0 = Math.round(column * cellWidth)
  const x1 = Math.round((column + 1) * cellWidth)
  const cell = new Uint8ClampedArray((x1 - x0) * level.height * 4)
  for (let y = 0; y < level.height; y += 1)
    cell.set(level.data.subarray((y * level.width + x0) * 4, (y * level.width + x1) * 4), y * (x1 - x0) * 4)
  return alphaCoverage(cell, threshold)
}

describe('coverage-preserving atlas mipmaps', () => {
  const threshold = 0.45

  it('shows the problem: a plain box filter thins a ragged crown with every level', () => {
    // An open crown: most of its width is the needle fringe.
    let level = raggedCrown(64, 256, 3, 0.3, 0.3)
    const full = alphaCoverage(level.data, threshold)
    for (let i = 0; i < 4; i += 1) level = downsample(level)
    const plain = alphaCoverage(level.data, threshold)
    // Not an exact figure: the point is that the canopy gets visibly thinner.
    expect(Math.abs(plain - full) / full).toBeGreaterThan(0.05)
  })

  it('keeps each cell within a few percent of its full-size coverage down the chain', () => {
    // Two cells side by side, one dense and one open, so a scale shared across
    // the atlas rather than set per cell would show.
    const a = raggedCrown(64, 256, 3)
    const b = raggedCrown(64, 256, 11, 0.3, 0.3)
    const atlas: MipLevel = { width: 128, height: 256, data: new Uint8ClampedArray(128 * 256 * 4) }
    for (let y = 0; y < 256; y += 1) {
      atlas.data.set(a.data.subarray(y * 64 * 4, (y + 1) * 64 * 4), y * 128 * 4)
      atlas.data.set(b.data.subarray(y * 64 * 4, (y + 1) * 64 * 4), (y * 128 + 64) * 4)
    }
    const levels = coveragePreservingMips(atlas, 2, 1, threshold)
    const full = [cellCoverage(levels[0], 2, 0, threshold), cellCoverage(levels[0], 2, 1, threshold)]
    // Levels 1–3, while a cell is still at least 8 texels across. Below that a
    // cell is a few dozen texels and one texel is several percent of it.
    for (const level of levels.slice(1, 4)) {
      for (const column of [0, 1]) {
        const coverage = cellCoverage(level, 2, column, threshold)
        expect(Math.abs(coverage - full[column]) / full[column]).toBeLessThan(0.08)
      }
    }
  })

  it('builds a complete chain down to one texel', () => {
    const levels = coveragePreservingMips(raggedCrown(64, 256), 1, 1, threshold)
    expect(levels.at(-1)).toMatchObject({ width: 1, height: 1 })
    expect(levels.map((level) => level.height)).toEqual([256, 128, 64, 32, 16, 8, 4, 2, 1])
  })
})

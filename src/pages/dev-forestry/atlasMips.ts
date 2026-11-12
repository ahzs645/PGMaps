/**
 * Mipmaps for the tree atlas that keep each crown's coverage.
 *
 * The billboard shader cuts foliage out at an alpha threshold rather than
 * blending it. A GPU-built mipmap averages alpha, so a ragged crown edge — a
 * fringe of half-covered texels — falls below the threshold a little more at
 * each level, and a stand seen across a valley draws thinner and more speckled
 * than the same stand close up. In a visual impact assessment that is not
 * cosmetic: a thinner distant canopy screens less and shows more of a block.
 *
 * So each level is built by box filter as the GPU would, then its alpha is
 * scaled so the share of texels above the threshold matches the full-size
 * image's. The technique is the one Nanite Forest (MIT, `src/nanite-lib/
 * alpha.ts`) and yomotsu/vegetation (MIT, `textureMipmaps.ts`) use; this is our
 * own implementation of it, applied per atlas cell so one species cannot borrow
 * coverage from another.
 */

export type MipLevel = { width: number; height: number; data: Uint8ClampedArray }

/** Share of texels whose alpha is at or above `threshold` (0–1). */
export function alphaCoverage(data: Uint8ClampedArray, threshold: number): number {
  const cut = threshold * 255
  let covered = 0
  const count = data.length / 4
  for (let index = 0; index < count; index += 1) if (data[index * 4 + 3] >= cut) covered += 1
  return count > 0 ? covered / count : 0
}

/**
 * One level down: each texel the mean of the 2×2 block above it, in
 * premultiplied space so a transparent neighbour does not darken a crown edge.
 */
export function downsample(level: MipLevel): MipLevel {
  const width = Math.max(1, level.width >> 1)
  const height = Math.max(1, level.height >> 1)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let dy = 0; dy < 2; dy += 1) {
        const sy = Math.min(level.height - 1, y * 2 + dy)
        for (let dx = 0; dx < 2; dx += 1) {
          const sx = Math.min(level.width - 1, x * 2 + dx)
          const i = (sy * level.width + sx) * 4
          const alpha = level.data[i + 3] / 255
          r += level.data[i] * alpha
          g += level.data[i + 1] * alpha
          b += level.data[i + 2] * alpha
          a += alpha
          n += 1
        }
      }
      const o = (y * width + x) * 4
      const meanAlpha = a / n
      data[o] = a > 0 ? r / a : 0
      data[o + 1] = a > 0 ? g / a : 0
      data[o + 2] = a > 0 ? b / a : 0
      data[o + 3] = Math.round(meanAlpha * 255)
    }
  }
  return { width, height, data }
}

/**
 * Scales a level's alpha within one rectangle so the share of its texels at
 * or above `threshold` is `target`.
 *
 * Box-filtered alpha takes few distinct values (a quarter, a half, three
 * quarters…), so no single scale can land on an arbitrary share. The cut is
 * chosen from a histogram — the lowest alpha value whose texels, with all
 * those above it, reach the target — and mapped onto the threshold. Of the
 * texels sitting exactly on that value, only as many as the target needs stay
 * at the threshold; the rest drop just under it, picked by a spatial hash so
 * the ones kept are spread through the crown rather than bunched. Scaling is
 * capped both ways so a nearly empty cell is not blown up into a solid block,
 * nor a full one emptied. Returns the scale applied.
 */
export function matchCoverage(
  level: MipLevel,
  rect: { x: number; y: number; width: number; height: number },
  target: number,
  threshold: number,
): number {
  const histogram = new Uint32Array(256)
  let count = 0
  for (let y = rect.y; y < rect.y + rect.height; y += 1)
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      histogram[level.data[(y * level.width + x) * 4 + 3]] += 1
      count += 1
    }
  if (count === 0 || target <= 0) return 1
  const wanted = Math.round(target * count)

  // Walk down from opaque until the texels at or above a value reach the target.
  let above = 0
  let pivot = 0
  for (let value = 255; value >= 1; value -= 1) {
    if (above + histogram[value] >= wanted && histogram[value] > 0) {
      pivot = value
      break
    }
    above += histogram[value]
  }
  if (pivot === 0) return 1

  // Either way: a fringe of sparse needles averages below the cut and thins,
  // a fringe just over half covered averages above it and fattens.
  const cut = threshold * 255
  const scale = Math.min(4, Math.max(0.25, cut / pivot))
  // How many texels on the pivot value stay covered, as a share of them.
  const keepOnPivot = Math.max(0, Math.min(1, (wanted - above) / histogram[pivot]))
  const below = Math.max(0, Math.ceil(cut) - 1)
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const i = (y * level.width + x) * 4 + 3
      const value = level.data[i]
      if (value === pivot && scale * pivot >= cut) {
        // A stable per-texel value in [0, 1): an integer hash of the position.
        let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1)
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
        const hashed = ((h ^ (h >>> 13)) >>> 0) / 4294967296
        level.data[i] = hashed < keepOnPivot ? Math.min(255, Math.ceil(cut)) : below
      } else {
        level.data[i] = Math.min(255, Math.round(value * scale))
      }
    }
  }
  return scale
}

/**
 * The full mip chain for an atlas laid out as `columns` × `rows` equal cells,
 * each level's cells keeping the coverage their full-size cell had. Stops once
 * a cell is under two texels on a side: below that there is no crown left to
 * keep, and the last levels are left as the box filter makes them.
 */
export function coveragePreservingMips(base: MipLevel, columns: number, rows: number, threshold: number): MipLevel[] {
  const cellWidth = base.width / columns
  const cellHeight = base.height / rows
  const targets: number[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const rect = {
        x: Math.round(column * cellWidth),
        y: Math.round(row * cellHeight),
        width: Math.round(cellWidth),
        height: Math.round(cellHeight),
      }
      let covered = 0
      for (let y = rect.y; y < rect.y + rect.height; y += 1)
        for (let x = rect.x; x < rect.x + rect.width; x += 1)
          if (base.data[(y * base.width + x) * 4 + 3] >= threshold * 255) covered += 1
      targets.push(covered / (rect.width * rect.height))
    }
  }

  const levels: MipLevel[] = [base]
  let current = base
  while (current.width > 1 || current.height > 1) {
    current = downsample(current)
    const levelCellWidth = current.width / columns
    const levelCellHeight = current.height / rows
    if (levelCellWidth >= 2 && levelCellHeight >= 2) {
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = Math.round(column * levelCellWidth)
          const y = Math.round(row * levelCellHeight)
          const rect = {
            x,
            y,
            width: Math.max(1, Math.round((column + 1) * levelCellWidth) - x),
            height: Math.max(1, Math.round((row + 1) * levelCellHeight) - y),
          }
          matchCoverage(current, rect, targets[row * columns + column], threshold)
        }
      }
    }
    levels.push(current)
  }
  return levels
}

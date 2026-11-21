/**
 * A slope texture for the 3D view's ground, baked once from the source ground over the display
 * window. Colouring by this texture makes the colour a property of the ground, not of the display
 * mesh: the same ground gets the same colour whatever the mesh density.
 *
 * Slope is measured between texel centres in true metres, with no vertical exaggeration, and
 * coloured with the plan's slope ramp (`terrainSlopeColor`).
 *
 * Pure: no DOM, canvas, renderer or network access.
 */
import { terrainSlopeColor } from './terrainDisplay'
import type { TerrainRenderQuality } from './terrainRenderQuality'

/**
 * Most texels along the window's longer side, for each 3D render quality. With a source sampler costing about
 * 0.4 to 0.55 µs a call (measured 20 November 2026), the whole road of the training example (a 1.6 km window) bakes
 * at Auto in about 0.25 to 0.4 s, High in about 1 s and Efficient in under 0.1 s, all in slices.
 */
export const TERRAIN_SLOPE_TEXTURE_SIDES = {
  auto: 1024,
  high: 1536,
  efficient: 512,
} as const satisfies Record<TerrainRenderQuality, number>

/**
 * Texels handled between two yields of the bake, in either pass: about 0.5 to 1 ms of work at the measured sampler
 * cost, so a 12 ms cooperative slice runs over by at most that.
 */
export const SLOPE_TEXTURE_YIELD_TEXELS = 1024

/**
 * A slope texture over a plan window.
 *
 * Row order: row 0 is the northern edge and rows run south, as the orthophoto's rows do. Within a
 * row texels run west to east. Texel (col, row) covers the square whose centre is
 * `(bounds[0] + (col + 0.5) * texelM, bounds[3] - (row + 0.5) * texelM)`.
 *
 * Texture coordinates follow the same order (`slopeTextureUv`): u runs 0 at the west edge to 1 at
 * the east edge, and v runs 0 at the north edge to 1 at the south edge. Uploaded as a Three.js
 * `DataTexture` with its default `flipY = false`, row 0 sits at v = 0, as for the orthophoto.
 */
export interface TerrainSlopeTexture {
  width: number
  height: number
  /** sRGB bytes, 4 per texel, rows north to south. Alpha 0 where the slope is unknown. */
  rgba: Uint8Array
  /** Outer edges of the texel grid in the sampler's metres: [west, south, east, north]. */
  bounds: [number, number, number, number]
  /** Side of one square texel, m. */
  texelM: number
}

export interface TerrainSlopeTextureInput {
  /** Display window [west, south, east, north], m. The texel grid covers it. */
  bounds: readonly number[]
  /** Ground elevation, m. NaN (or any non-finite value) where there is no ground. */
  elevationAt: (x: number, y: number) => number
  /** The source resolution, m. A texel is never finer than this. */
  minSpacing?: number
  /** Most texels along the longer side (see {@link TERRAIN_SLOPE_TEXTURE_SIDES}). */
  maxSide: number
}

export interface TerrainSlopeTextureProgress {
  done: number
  total: number
}

/** Texture coordinates [u, v] of a plan position: u west to east, v north to south (see the type). */
export function slopeTextureUv(texture: Pick<TerrainSlopeTexture, 'bounds'>, x: number, y: number): [number, number] {
  const [west, south, east, north] = texture.bounds
  return [(x - west) / (east - west), (north - y) / (north - south)]
}

export interface TerrainSlopeTextureGrid {
  texelM: number
  width: number
  height: number
  bounds: [number, number, number, number]
}

/**
 * The texel grid for a window. The texel side is the larger of the source resolution and the
 * longer side over `maxSide - 1`; the one texel of slack lets the edges snap outward to whole
 * multiples of the texel side and still keep both sides within `maxSide`. Snapped edges keep the
 * same texels while the window moves by less than a texel.
 */
export function terrainSlopeTextureGrid(
  bounds: readonly number[],
  maxSide: number,
  minSpacing = 0,
): TerrainSlopeTextureGrid {
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] > bounds[2] || bounds[1] > bounds[3])
    throw Error('A slope texture needs a finite window with west ≤ east and south ≤ north.')
  const side = Math.max(2, Math.floor(Number.isFinite(maxSide) ? maxSide : 2))
  const floor = Number.isFinite(minSpacing) && minSpacing > 0 ? minSpacing : 0
  const longer = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1])
  const texelM = Math.max(floor, longer / (side - 1))
  if (!(texelM > 0)) throw Error('A slope texture needs a window with area or a source resolution.')
  const firstColumn = Math.floor(bounds[0] / texelM),
    lastColumn = Math.max(firstColumn + 1, Math.ceil(bounds[2] / texelM))
  const firstRow = Math.floor(bounds[1] / texelM),
    lastRow = Math.max(firstRow + 1, Math.ceil(bounds[3] / texelM))
  return {
    texelM,
    width: lastColumn - firstColumn,
    height: lastRow - firstRow,
    bounds: [firstColumn * texelM, firstRow * texelM, lastColumn * texelM, lastRow * texelM],
  }
}

/**
 * The bake, in slices so a caller can keep the page responsive: drive it with `runCooperatively`
 * or `runToCompletion` (`cooperative.ts`). It yields progress every
 * {@link SLOPE_TEXTURE_YIELD_TEXELS} texels in both passes and returns the texture.
 *
 * The first pass samples `elevationAt` once at each texel centre, and nowhere else. The second
 * takes each texel's gradient from central differences of its neighbours' centres. At the grid's
 * edge or beside a missing neighbour it takes the one-sided difference (east before west, north
 * before south, as the plan does); with neither side known along an axis, or with no ground at the
 * texel itself, the slope is unknown and the texel stays transparent.
 */
export function* terrainSlopeTextureSteps(
  input: TerrainSlopeTextureInput,
): Generator<TerrainSlopeTextureProgress, TerrainSlopeTexture> {
  const { elevationAt } = input
  const { texelM, width, height, bounds } = terrainSlopeTextureGrid(input.bounds, input.maxSide, input.minSpacing)
  const count = width * height,
    total = count * 2
  const values = new Float64Array(count)
  let done = 0,
    sinceYield = 0

  const west = bounds[0],
    north = bounds[3]
  for (let row = 0; row < height; row++) {
    const y = north - (row + 0.5) * texelM
    for (let col = 0; col < width; col++) {
      const value = elevationAt(west + (col + 0.5) * texelM, y)
      values[row * width + col] = Number.isFinite(value) ? value : NaN
      done++
      if (++sinceYield >= SLOPE_TEXTURE_YIELD_TEXELS) {
        sinceYield = 0
        yield { done, total }
      }
    }
  }

  const rgba = new Uint8Array(count * 4)
  // Prefer the central difference, then a one-sided one. Never bridge a gap.
  const gradient = (here: number, before: number, after: number) => {
    const hasBefore = before === before,
      hasAfter = after === after
    if (hasBefore && hasAfter) return (after - before) / (2 * texelM)
    if (hasAfter) return (after - here) / texelM
    if (hasBefore) return (here - before) / texelM
    return NaN
  }
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const index = row * width + col,
        here = values[index]
      if (here === here) {
        const westValue = col > 0 ? values[index - 1] : NaN,
          eastValue = col < width - 1 ? values[index + 1] : NaN
        // Rows run south, so the row above is north.
        const northValue = row > 0 ? values[index - width] : NaN,
          southValue = row < height - 1 ? values[index + width] : NaN
        const zx = gradient(here, westValue, eastValue)
        const zy = gradient(here, southValue, northValue)
        if (zx === zx && zy === zy) {
          const color = terrainSlopeColor((Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI)
          const at = index * 4
          rgba[at] = color[0]
          rgba[at + 1] = color[1]
          rgba[at + 2] = color[2]
          rgba[at + 3] = 255
        }
      }
      done++
      if (++sinceYield >= SLOPE_TEXTURE_YIELD_TEXELS) {
        sinceYield = 0
        yield { done, total }
      }
    }

  return { width, height, rgba, bounds, texelM }
}

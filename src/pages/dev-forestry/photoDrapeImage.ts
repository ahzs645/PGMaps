import { areaPatternTile, type RgbaImage } from '@/lib/mapSheet/symbolRaster'

import { hexBytes, PHOTO_PLAN_SYMBOLS } from './photoPlanStyle'
import type { Bounds, Rgba } from './photoViews'

/**
 * The image a photo drape shows on the plan for each look, from the drape's own cells (`photoViews.drapePhoto`).
 * Kept free of DOM access: the layer paints the result, the tests read it.
 *
 * - `filled`: the photo's pixels on the ground.
 * - `edges`: only the photo's edges, in one bright colour, so the imagery under it stays readable. From the air
 *   this is the most telling check: a lake shore, a road or a cutblock edge should sit on the imagery's.
 * - `footprint`: no image, the frame's outline alone (drawn by the layer).
 *
 * In both images, ground the frame covers but nearer terrain hides (`hiddenMask`) is hatched with the
 * `hiddenGround` symbol's tile, so hidden ground no longer reads the same as out of frame.
 */
export type PhotoDrapeLook = 'filled' | 'edges' | 'footprint'

/**
 * Edge strength, as the sum of the Sobel gradients' magnitudes on luminance, below which nothing is an edge.
 * Flat ground and sensor noise stay under it; a timber edge against a clearing is several times over.
 */
export const MIN_EDGE_STRENGTH = 60
/** The share of the photo's ground whose edges are drawn: the strongest 15%, never weaker than the floor. */
export const EDGE_SHARE = 0.15

const lum = (data: Uint8ClampedArray, i: number) => 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]

/**
 * Which cells are on a photo edge: 1 where the Sobel magnitude is in the strongest `share` of the photo's
 * ground and above `minStrength`. Only cells whose whole 3×3 neighbourhood is drawn are tested, so the frame's
 * border and the edge of hidden ground are not taken for edges in the photo.
 */
export function drapeEdges(
  drape: Rgba,
  { share = EDGE_SHARE, minStrength = MIN_EDGE_STRENGTH }: { share?: number; minStrength?: number } = {},
): Uint8Array {
  const { width: W, height: H, data } = drape
  const edges = new Uint8Array(W * H)
  if (W < 3 || H < 3) return edges
  const L = new Float32Array(W * H)
  const drawn = new Uint8Array(W * H)
  for (let k = 0; k < W * H; k++) {
    drawn[k] = data[k * 4 + 3] > 0 ? 1 : 0
    L[k] = lum(data, k * 4)
  }
  const strength = new Float32Array(W * H)
  const values: number[] = []
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x
      let whole = true
      for (let dy = -1; dy <= 1 && whole; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!drawn[k + dy * W + dx]) {
            whole = false
            break
          }
      if (!whole) continue
      const a = L[k - W - 1],
        b = L[k - W],
        c = L[k - W + 1],
        d = L[k - 1],
        f = L[k + 1],
        g = L[k + W - 1],
        h = L[k + W],
        i = L[k + W + 1]
      const gx = c + 2 * f + i - (a + 2 * d + g)
      const gy = g + 2 * h + i - (a + 2 * b + c)
      const s = Math.abs(gx) + Math.abs(gy)
      strength[k] = s
      values.push(s)
    }
  if (!values.length) return edges
  values.sort((p, q) => p - q)
  const cut = Math.max(minStrength, values[Math.min(values.length - 1, Math.floor(values.length * (1 - share)))])
  for (let k = 0; k < W * H; k++) if (strength[k] >= cut && strength[k] > 0) edges[k] = 1
  return edges
}

/** The hidden-ground hatch tile at one cell a pixel. */
export function hiddenGroundTile(): RgbaImage | null {
  return areaPatternTile(PHOTO_PLAN_SYMBOLS.hiddenGround, 1)
}

/**
 * The image to lay on the plan for a drape and a look, or null when the look draws none. `hiddenMask` is one
 * byte a cell, 1 where the cell is in frame but hidden by nearer terrain; `hatch` is the tile drawn there
 * (`hiddenGroundTile`), repeated in cells.
 */
export function drapeLookImage(
  drape: Rgba,
  look: PhotoDrapeLook,
  { hiddenMask = null, hatch = null }: { hiddenMask?: Uint8Array | null; hatch?: RgbaImage | null } = {},
): Rgba | null {
  if (look === 'footprint') return null
  const { width: W, height: H } = drape
  const out = new Uint8ClampedArray(W * H * 4)
  if (look === 'filled') out.set(drape.data)
  else {
    const edges = drapeEdges(drape)
    const [r, g, b] = hexBytes(PHOTO_PLAN_SYMBOLS.edges.color)
    for (let k = 0; k < W * H; k++)
      if (edges[k]) {
        out[k * 4] = r
        out[k * 4 + 1] = g
        out[k * 4 + 2] = b
        out[k * 4 + 3] = 255
      }
  }
  if (hiddenMask && hatch && hiddenMask.length === W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = y * W + x
        if (!hiddenMask[k] || out[k * 4 + 3]) continue
        const t = ((y % hatch.height) * hatch.width + (x % hatch.width)) * 4
        out[k * 4] = hatch.data[t]
        out[k * 4 + 1] = hatch.data[t + 1]
        out[k * 4 + 2] = hatch.data[t + 2]
        out[k * 4 + 3] = hatch.data[t + 3]
      }
  return { width: W, height: H, data: out }
}

/** A footprint ring, closed, as [lng, lat]; null when it has fewer than three distinct corners. */
export function closedFootprint(footprint: ReadonlyArray<readonly [number, number]>): [number, number][] | null {
  const ring = footprint
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    .map(([lng, lat]) => [lng, lat] as [number, number])
  if (ring.length < 3) return null
  const [first, last] = [ring[0], ring[ring.length - 1]]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
  return ring.length < 4 ? null : ring
}

/** The drape's west, south, east, north as an object, for the toolkit's `boundsToQuad`. */
export const boundsBox = ([west, south, east, north]: Bounds) => ({ west, south, east, north })

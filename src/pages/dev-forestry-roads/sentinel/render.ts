/**
 * Sentinel-2 bands to RGBA: true colour, NDVI, and the NDVI change between two scenes with its
 * "first seen between" label. NBR and NDMI, and the shared index maths, are in `indices.ts`.
 * DOM-free; the plan layer puts the pixels on a canvas.
 */
import {
  indexChange,
  indexChangeRgba,
  indexRgba,
  NDVI_CHANGE_STOPS,
  NDVI_STOPS,
  normalizedDifference,
  rampColour,
} from './indices'
import { SENTINEL_CLEARING_NDVI_DROP } from './limits'
import type { BandScaling } from './stac'
import type { NdviBands } from './window'

/** True colour from the TCI's three bands. A pixel with all three at 0 is no data and drawn clear. */
export function trueColourRgba(bands: ArrayLike<number>[], width: number, height: number): Uint8ClampedArray {
  const [r, g, b] = bands
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const red = r[i],
      green = g[i],
      blue = b[i]
    out[i * 4] = red
    out[i * 4 + 1] = green
    out[i * 4 + 2] = blue
    out[i * 4 + 3] = red || green || blue ? 255 : 0
  }
  return out
}

/** NDVI per pixel: (NIR − red) ÷ (NIR + red), as `normalizedDifference` (indices.ts) computes it. */
export function ndviValues(
  { red, nir, scl }: NdviBands,
  scaling: { red: BandScaling; nir: BandScaling },
): Float32Array {
  return normalizedDifference(nir, red, scl, scaling.nir, scaling.red)
}

export { NDVI_CHANGE_STOPS, NDVI_STOPS, rampColour }

/** NDVI as colour; masked pixels are clear. */
export const ndviRgba = (ndvi: Float32Array) => indexRgba(ndvi, NDVI_STOPS)

export type NdviChange = {
  /** Later minus earlier NDVI; NaN where either scene is masked. */
  delta: Float32Array
  /** Pixels clear in both scenes. */
  compared: number
  /** Compared pixels whose NDVI fell by at least the clearing drop. */
  cleared: number
}

/** Per-pixel NDVI change between two scenes on the same window. */
export function ndviChange(earlier: Float32Array, later: Float32Array, drop = SENTINEL_CLEARING_NDVI_DROP): NdviChange {
  const { delta, compared, changed } = indexChange(earlier, later, drop)
  return { delta, compared, cleared: changed }
}

/**
 * NDVI change as colour. Changes smaller than the clearing drop fade out so the clearings stand
 * out; pixels masked in either scene are clear.
 */
export const ndviChangeRgba = (delta: Float32Array, drop = SENTINEL_CLEARING_NDVI_DROP) =>
  indexChangeRgba(delta, NDVI_CHANGE_STOPS, drop)

/** True when any day strictly between the two dates falls in November to April. */
export function crossesSnowSeason(earlier: string, later: string): boolean {
  const start = Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`),
    end = Date.parse(`${later.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false
  if (end - start > 366 * 86_400_000) return true
  for (let t = start + 86_400_000; t < end; t += 86_400_000) {
    const month = new Date(t).getUTCMonth() + 1
    if (month >= 11 || month <= 4) return true
  }
  return false
}

/**
 * The change view's label. A clearing's appearance is an interval between the two scenes, never one
 * date (bc-access-research-timing.md, "What it means for the app"), and a bracket over the winter
 * says so.
 */
export function firstSeenLabel(earlier: string, later: string): string {
  const [a, b] = [earlier.slice(0, 10), later.slice(0, 10)].sort()
  return `first seen between ${a} and ${b}${crossesSnowSeason(a, b) ? ' (snow gap)' : ''}`
}

/**
 * Sentinel-2 bands to RGBA: true colour, NDVI, and the NDVI change between two scenes with its
 * "first seen between" label. DOM-free; the plan layer puts the pixels on a canvas.
 */
import { SENTINEL_CLEARING_NDVI_DROP } from './limits'
import type { BandScaling } from './stac'
import { SCL_CLEAR, type NdviBands } from './window'

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

/**
 * NDVI per pixel from reflectance (digital number × scale + offset, floored at zero), so it stays
 * within ±1. NaN where the tile has no data, the scene classification does not see clear ground
 * (cloud, shadow, snow, saturated) or both reflectances are zero.
 */
export function ndviValues(
  { red, nir, scl }: NdviBands,
  scaling: { red: BandScaling; nir: BandScaling },
): Float32Array {
  const out = new Float32Array(red.length)
  for (let i = 0; i < red.length; i++) {
    if (!red[i] || !nir[i] || !SCL_CLEAR.has(scl[i])) {
      out[i] = NaN
      continue
    }
    // With the baseline 04.00 offset, very dark ground can read below zero, which would put NDVI
    // past ±1. Reflectance is floored at zero instead.
    const r = Math.max(0, red[i] * scaling.red.scale + scaling.red.offset),
      n = Math.max(0, nir[i] * scaling.nir.scale + scaling.nir.offset)
    const sum = n + r
    out[i] = sum > 0 ? (n - r) / sum : NaN
  }
  return out
}

type Stop = readonly [number, readonly [number, number, number]]

/** NDVI colours: bare and water brown, sparse cover yellow, closed canopy dark green. */
export const NDVI_STOPS: readonly Stop[] = [
  [-0.2, [120, 85, 60]],
  [0.2, [214, 196, 120]],
  [0.45, [166, 206, 98]],
  [0.7, [62, 150, 60]],
  [0.9, [12, 84, 36]],
]

/** NDVI change colours, later minus earlier: loss red, gain green, little change clear. */
export const NDVI_CHANGE_STOPS: readonly Stop[] = [
  [-0.5, [178, 24, 43]],
  [-SENTINEL_CLEARING_NDVI_DROP, [239, 138, 98]],
  [0, [247, 247, 247]],
  [SENTINEL_CLEARING_NDVI_DROP, [127, 188, 120]],
  [0.5, [27, 120, 55]],
]

export function rampColour(stops: readonly Stop[], value: number): [number, number, number] {
  if (value <= stops[0][0]) return [...stops[0][1]]
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i]
    if (value > v1) continue
    const [v0, c0] = stops[i - 1]
    const t = (value - v0) / (v1 - v0)
    return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number]
  }
  return [...stops[stops.length - 1][1]]
}

/** NDVI as colour; masked pixels are clear. */
export function ndviRgba(ndvi: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ndvi.length * 4)
  for (let i = 0; i < ndvi.length; i++) {
    const value = ndvi[i]
    if (Number.isNaN(value)) continue
    const [r, g, b] = rampColour(NDVI_STOPS, value)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return out
}

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
  if (earlier.length !== later.length) throw new Error('The two NDVI windows differ in size.')
  const delta = new Float32Array(earlier.length)
  let compared = 0,
    cleared = 0
  for (let i = 0; i < earlier.length; i++) {
    const value = later[i] - earlier[i]
    delta[i] = value
    if (Number.isNaN(value)) continue
    compared++
    if (value <= -drop) cleared++
  }
  return { delta, compared, cleared }
}

/**
 * NDVI change as colour. Changes smaller than the clearing drop fade out so the clearings stand
 * out; pixels masked in either scene are clear.
 */
export function ndviChangeRgba(delta: Float32Array, drop = SENTINEL_CLEARING_NDVI_DROP): Uint8ClampedArray {
  const out = new Uint8ClampedArray(delta.length * 4)
  for (let i = 0; i < delta.length; i++) {
    const value = delta[i]
    if (Number.isNaN(value)) continue
    const [r, g, b] = rampColour(NDVI_CHANGE_STOPS, value)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = Math.abs(value) >= drop ? 235 : Math.round(60 + (175 * Math.abs(value)) / drop)
  }
  return out
}

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

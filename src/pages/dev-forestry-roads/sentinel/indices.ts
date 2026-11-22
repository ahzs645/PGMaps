/**
 * The normalized-difference indices the Sentinel-2 layer draws: NDVI for green cover, NBR for burned
 * ground and NDMI for moisture. Each is (a − b) ÷ (a + b) on reflectance; their change between two
 * scenes is the later value minus the earlier. DOM-free.
 */
import {
  SENTINEL_BURN_DNBR,
  SENTINEL_CLEARING_NDVI_DROP,
  SENTINEL_DNBR_UNBURNED,
  SENTINEL_DRYING_NDMI_DROP,
} from '@/lib/sentinel2/limits'
import type { BandScaling, SentinelScene } from '@/lib/sentinel2/stac'
import { SCL_CLEAR } from '@/lib/sentinel2/window'

export type SentinelIndex = 'ndvi' | 'nbr' | 'ndmi'
export type ReflectanceBand = 'red' | 'nir' | 'swir16' | 'swir22'

type Stop = readonly [number, readonly [number, number, number]]

export type IndexSpec = {
  id: SentinelIndex
  /** Short name: NDVI, NBR, NDMI. */
  label: string
  /** The change view's name in the display list. */
  changeLabel: string
  /** (a − b) ÷ (a + b). */
  bands: readonly [ReflectanceBand, ReflectanceBand]
  /** A fall at least this large between two scenes is counted. */
  drop: number
  /** A fall smaller than this is drawn clear in the change view (it is noise, not a change). */
  quiet: number
  /** What a counted fall is called on the card: "Clearing on 3.2 ha". */
  changed: string
  /** The card's line when nothing fell that far. */
  unchanged: string
  /** What the index reads, for the card's InfoTip. */
  about: string
  stops: readonly Stop[]
  changeStops: readonly Stop[]
  /** The value range the histogram bins over, so scenes compare on the same bins. */
  domain: readonly [number, number]
}

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

/** NBR colours: burned and bare ground dark red-brown, healthy forest green. */
export const NBR_STOPS: readonly Stop[] = [
  [-0.5, [103, 0, 13]],
  [-0.1, [203, 24, 29]],
  [0.1, [252, 187, 161]],
  [0.3, [161, 217, 155]],
  [0.6, [35, 139, 69]],
]

/**
 * NBR change, later minus earlier (dNBR is its negative): the falls are coloured at Key & Benson's
 * table LA-2 breaks, low (0.1), moderate-low (0.27), moderate-high (0.44) and high (0.66) severity.
 */
export const NBR_CHANGE_STOPS: readonly Stop[] = [
  [-0.66, [103, 0, 13]],
  [-0.44, [203, 24, 29]],
  [-SENTINEL_BURN_DNBR, [251, 106, 74]],
  [-SENTINEL_DNBR_UNBURNED, [254, 224, 144]],
  [0, [247, 247, 247]],
  [SENTINEL_DNBR_UNBURNED, [199, 233, 192]],
  [0.25, [65, 171, 93]],
]

/** NDMI colours: dry brown through moist blue. */
export const NDMI_STOPS: readonly Stop[] = [
  [-0.4, [140, 81, 10]],
  [-0.1, [216, 179, 101]],
  [0.1, [199, 234, 229]],
  [0.3, [90, 180, 172]],
  [0.5, [1, 102, 94]],
]

/** NDMI change, later minus earlier: drier brown, wetter blue-green. */
export const NDMI_CHANGE_STOPS: readonly Stop[] = [
  [-0.4, [140, 81, 10]],
  [-SENTINEL_DRYING_NDMI_DROP, [216, 179, 101]],
  [0, [245, 245, 245]],
  [SENTINEL_DRYING_NDMI_DROP, [128, 205, 193]],
  [0.4, [1, 102, 94]],
]

export const SENTINEL_INDICES: Record<SentinelIndex, IndexSpec> = {
  ndvi: {
    id: 'ndvi',
    label: 'NDVI',
    changeLabel: 'NDVI change',
    bands: ['nir', 'red'],
    drop: SENTINEL_CLEARING_NDVI_DROP,
    quiet: 0,
    changed: 'Clearing',
    unchanged: 'No clearing between the two scenes',
    about: 'NDVI is (NIR − red) ÷ (NIR + red) from bands B08 and B04: green cover reads high, bare ground low.',
    stops: NDVI_STOPS,
    changeStops: NDVI_CHANGE_STOPS,
    domain: [-0.4, 1],
  },
  nbr: {
    id: 'nbr',
    label: 'NBR',
    changeLabel: 'dNBR (burn)',
    bands: ['nir', 'swir22'],
    drop: SENTINEL_BURN_DNBR,
    quiet: SENTINEL_DNBR_UNBURNED,
    changed: 'Burned or cleared',
    unchanged: 'No burned or cleared ground between the two scenes',
    about:
      'NBR is (NIR − SWIR) ÷ (NIR + SWIR) from bands B08 and B12: live forest reads high, burned and bare ground low. dNBR is the earlier NBR minus the later; the colours break at Key & Benson’s severity classes (USDA RMRS-GTR-164-CD, table LA-2).',
    stops: NBR_STOPS,
    changeStops: NBR_CHANGE_STOPS,
    domain: [-0.6, 1],
  },
  ndmi: {
    id: 'ndmi',
    label: 'NDMI',
    changeLabel: 'NDMI change',
    bands: ['nir', 'swir16'],
    drop: SENTINEL_DRYING_NDMI_DROP,
    quiet: 0,
    changed: 'Drier',
    unchanged: 'No drier ground between the two scenes',
    about:
      'NDMI is (NIR − SWIR) ÷ (NIR + SWIR) from bands B08 and B11: it falls as leaves and ground dry out, as in drought or beetle red attack. Season moves it too, so compare scenes from the same part of the summer.',
    stops: NDMI_STOPS,
    changeStops: NDMI_CHANGE_STOPS,
    domain: [-0.6, 0.8],
  },
}

/** Whether the scene lists both bands the index needs. */
export const sceneHasIndex = (scene: SentinelScene, index: SentinelIndex) =>
  SENTINEL_INDICES[index].bands.every((band) => !!scene.assets[band] && !!scene.scaling[band])

/**
 * (a − b) ÷ (a + b) per pixel from reflectance (digital number × scale + offset, floored at zero),
 * so it stays within ±1. NaN where either band has no data (0), the scene classification does not
 * see clear ground (cloud, shadow, snow, saturated) or both reflectances are zero.
 */
export function normalizedDifference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  scl: ArrayLike<number>,
  scaleA: BandScaling,
  scaleB: BandScaling,
): Float32Array {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) {
    if (!a[i] || !b[i] || !SCL_CLEAR.has(scl[i])) {
      out[i] = NaN
      continue
    }
    // With the baseline 04.00 offset, very dark ground can read below zero, which would put the
    // index past ±1. Reflectance is floored at zero instead.
    const ra = Math.max(0, a[i] * scaleA.scale + scaleA.offset),
      rb = Math.max(0, b[i] * scaleB.scale + scaleB.offset)
    const sum = ra + rb
    out[i] = sum > 0 ? (ra - rb) / sum : NaN
  }
  return out
}

export type IndexBands = Partial<Record<ReflectanceBand, ArrayLike<number>>> & { scl: ArrayLike<number> }

/** The index from the bands it needs, with the scene's scaling. */
export function indexValues(
  index: SentinelIndex,
  bands: IndexBands,
  scaling: Partial<Record<ReflectanceBand, BandScaling>>,
): Float32Array {
  const [a, b] = SENTINEL_INDICES[index].bands
  const [va, vb, sa, sb] = [bands[a], bands[b], scaling[a], scaling[b]]
  if (!va || !vb || !sa || !sb) throw new Error(`The ${SENTINEL_INDICES[index].label} needs bands ${a} and ${b}.`)
  return normalizedDifference(va, vb, bands.scl, sa, sb)
}

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

/** An index as colour; masked pixels are clear. */
export function indexRgba(values: Float32Array, stops: readonly Stop[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (Number.isNaN(value)) continue
    const [r, g, b] = rampColour(stops, value)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return out
}

export type IndexChange = {
  /** Later minus earlier; NaN where either scene is masked. */
  delta: Float32Array
  /** Pixels clear in both scenes. */
  compared: number
  /** Compared pixels whose value fell by at least `drop`. */
  changed: number
}

/** Per-pixel change between two scenes on the same window. */
export function indexChange(earlier: Float32Array, later: Float32Array, drop: number): IndexChange {
  if (earlier.length !== later.length) throw new Error('The two windows differ in size.')
  const delta = new Float32Array(earlier.length)
  let compared = 0,
    changed = 0
  for (let i = 0; i < earlier.length; i++) {
    const value = later[i] - earlier[i]
    delta[i] = value
    if (Number.isNaN(value)) continue
    compared++
    if (value <= -drop) changed++
  }
  return { delta, compared, changed }
}

/**
 * A change as colour. Changes smaller than `drop` fade out so the counted falls stand out, and those
 * under `quiet` are clear; pixels masked in either scene are clear.
 */
export function indexChangeRgba(
  delta: Float32Array,
  stops: readonly Stop[],
  drop: number,
  quiet = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(delta.length * 4)
  for (let i = 0; i < delta.length; i++) {
    const value = delta[i]
    if (Number.isNaN(value) || Math.abs(value) < quiet) continue
    const [r, g, b] = rampColour(stops, value)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = Math.abs(value) >= drop ? 235 : Math.round(60 + (175 * Math.abs(value)) / drop)
  }
  return out
}

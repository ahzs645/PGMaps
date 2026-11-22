import { describe, expect, it } from 'vitest'
import {
  indexChange,
  indexChangeRgba,
  indexValues,
  NBR_CHANGE_STOPS,
  normalizedDifference,
  sceneHasIndex,
  SENTINEL_INDICES,
} from './indices'
import { SENTINEL_BURN_DNBR, SENTINEL_DNBR_UNBURNED, SENTINEL_DRYING_NDMI_DROP } from '@/lib/sentinel2/limits'
import { ndviValues } from './render'
import { parseSentinelItem } from '@/lib/sentinel2/stac'

const BASELINE_04 = { scale: 0.0001, offset: -0.1 }
const APPLIED = { scale: 0.0001, offset: 0 }

describe('NBR and NDMI', () => {
  it('computes NBR from NIR and SWIR B12 on reflectance, with the baseline 04.00 offset when it applies', () => {
    // Reflectance NIR 0.30, SWIR2 0.10: NBR 0.5. Raw numbers with the offset left in would read 0.4.
    const withOffset = indexValues(
      'nbr',
      { nir: [4000], swir22: [2000], scl: [4] },
      { nir: BASELINE_04, swir22: BASELINE_04 },
    )
    expect(withOffset[0]).toBeCloseTo(0.5, 5)
    // Earth Search has already removed it: the same pixels are 0.30 and 0.10 as stored.
    const removed = indexValues('nbr', { nir: [3000], swir22: [1000], scl: [4] }, { nir: APPLIED, swir22: APPLIED })
    expect(removed[0]).toBeCloseTo(0.5, 5)
  })

  it('computes NDMI from NIR and SWIR B11', () => {
    const ndmi = indexValues('ndmi', { nir: [3000], swir16: [1500], scl: [5] }, { nir: APPLIED, swir16: APPLIED })
    expect(ndmi[0]).toBeCloseTo(1 / 3, 5)
  })

  it('masks no data, cloud, shadow, snow and saturated pixels, and both-zero reflectance', () => {
    const values = normalizedDifference(
      [3000, 0, 3000, 3000, 3000, 3000, 1000],
      [1000, 1000, 0, 1000, 1000, 1000, 1000],
      [4, 4, 4, 9, 3, 11, 4],
      APPLIED,
      APPLIED,
    )
    expect(values[0]).toBeCloseTo(0.5, 5)
    expect(Array.from(values.slice(1, 6)).every(Number.isNaN)).toBe(true)
    expect(values[6]).toBe(0)
    // Floored at zero, so a dark pixel past the offset stays within ±1.
    const dark = normalizedDifference([1300], [950], [4], BASELINE_04, BASELINE_04)
    expect(dark[0]).toBe(1)
  })

  it('NDVI still reads as before through the shared maths', () => {
    const ndvi = ndviValues({ red: [1500], nir: [4500], scl: [4] }, { red: BASELINE_04, nir: BASELINE_04 })
    expect(ndvi[0]).toBeCloseTo(0.75, 5)
  })

  it('refuses an index whose bands the scene does not list', () => {
    expect(() => indexValues('nbr', { nir: [1], scl: [4] }, { nir: APPLIED })).toThrow('NBR needs bands nir and swir22')
  })

  it('counts a burn at Key & Benson moderate-low (dNBR 0.27) and draws low severity faintly', () => {
    // NBR 0.6 → 0.2 (dNBR 0.4), 0.6 → 0.4 (0.2, low severity), 0.6 → 0.55 (unburned), masked.
    const result = indexChange(
      Float32Array.from([0.6, 0.6, 0.6, NaN]),
      Float32Array.from([0.2, 0.4, 0.55, 0.1]),
      SENTINEL_INDICES.nbr.drop,
    )
    expect(SENTINEL_INDICES.nbr.drop).toBe(SENTINEL_BURN_DNBR)
    expect(result).toMatchObject({ compared: 3, changed: 1 })
    const rgba = indexChangeRgba(result.delta, NBR_CHANGE_STOPS, SENTINEL_BURN_DNBR, SENTINEL_DNBR_UNBURNED)
    expect(rgba[3]).toBe(235)
    expect(rgba[7]).toBeGreaterThan(0)
    expect(rgba[7]).toBeLessThan(235)
    // Under the unburned bound and masked pixels stay clear.
    expect(rgba[11]).toBe(0)
    expect(rgba[15]).toBe(0)
  })

  it('counts NDMI drying at its screen', () => {
    const result = indexChange(Float32Array.from([0.3, 0.3]), Float32Array.from([0.1, 0.25]), SENTINEL_DRYING_NDMI_DROP)
    expect(result.changed).toBe(1)
  })
})

describe('SWIR assets', () => {
  const asset = (band: string) => ({
    href: `https://sentinel-cogs.s3.us-west-2.amazonaws.com/x/${band}.tif`,
    'raster:bands': [{ scale: 0.0001, offset: -0.1 }],
  })
  const item = (applied: boolean | undefined, swir = true) => ({
    id: 'S2B_10UEE_20250830_0_L2A',
    properties: {
      datetime: '2025-08-30T19:29:40Z',
      'proj:epsg': 32610,
      ...(applied === undefined ? {} : { 'earthsearch:boa_offset_applied': applied }),
    },
    assets: {
      visual: asset('TCI'),
      red: asset('B04'),
      nir: asset('B08'),
      scl: asset('SCL'),
      ...(swir ? { swir16: asset('B11'), swir22: asset('B12') } : {}),
    },
  })

  it('reads B11 and B12 with the offset only when Earth Search has not removed it', () => {
    const applied = parseSentinelItem(item(true))!
    expect(applied.assets.swir16).toMatch(/B11\.tif$/)
    expect(applied.assets.swir22).toMatch(/B12\.tif$/)
    expect(applied.scaling.swir22).toEqual({ scale: 0.0001, offset: 0 })
    expect(parseSentinelItem(item(false))!.scaling.swir16).toEqual({ scale: 0.0001, offset: -0.1 })
    expect(parseSentinelItem(item(undefined))!.scaling.swir16).toEqual({ scale: 0.0001, offset: -0.1 })
    expect(sceneHasIndex(applied, 'nbr')).toBe(true)
  })

  it('keeps a scene without SWIR for true colour and NDVI', () => {
    const scene = parseSentinelItem(item(true, false))!
    expect(scene).not.toBeNull()
    expect('swir16' in scene.assets).toBe(false)
    expect(sceneHasIndex(scene, 'ndvi')).toBe(true)
    expect(sceneHasIndex(scene, 'ndmi')).toBe(false)
  })
})

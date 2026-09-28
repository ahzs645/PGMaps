import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fromArrayBuffer } from 'geotiff'
import { describe, expect, it } from 'vitest'
import { bgcLabel, legacyRating, regionalOutlook, type LegacyReference, type LegacyRegion } from './legacyAnalysis'
import { sampleCcissRaster } from './raster'
const root = 'vendor/bcdatamapper/datascrapers/bc/cciss/output/legacy-analysis/'
const reference: LegacyReference = JSON.parse(gunzipSync(readFileSync(root + 'reference.json.gz')).toString())
const region: LegacyRegion = JSON.parse(gunzipSync(readFileSync(root + 'BC.json.gz')).toString())

describe('legacy CCISS numeric analysis', () => {
  it('uses the reconciled one-based codebook and handles unknown cells', () => {
    expect(bgcLabel(reference, 46)).toBe('CDFmm')
    expect(bgcLabel(reference, 381)).toBe('SBSmh')
    expect(bgcLabel(reference, 0)).toBeNull()
    expect(bgcLabel(reference, NaN)).toBeNull()
    expect(bgcLabel(reference, 999)).toBeNull()
  })
  it('matches source CSV ratings and distinguishes absent from unsuitable', () => {
    expect(legacyRating(reference, 'CDFmm', 'C4', 'Fd')).toBe(1)
    expect(legacyRating(reference, 'CDFmm', 'C4', 'Sx')).toBeNull()
    expect(legacyRating(reference, 'ICHwk1', 'C4', 'Pl')).toBe(4)
    expect(legacyRating(reference, 'missing', 'C4', 'Pl')).toBeNull()
  })
  it('matches independently sampled rasterio cells in the original TIFFs', async () => {
    const bytes = readFileSync(root + 'BGC.pred.ref.tif')
    const tiff = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const image = await tiff.getImage()
    const pg = await sampleCcissRaster(image, 53.9171, -122.7497)
    const victoria = await sampleCcissRaster(image, 48.43, -123.37)
    expect(pg).toMatchObject({ status: 'value', value: 381 })
    expect(victoria).toMatchObject({ status: 'value', value: 46 })
    expect(await sampleCcissRaster(image, 10, 10)).toEqual({ status: 'outside' })
    await tiff.close()
  })
  it('reproduces the source R regional ratios with real source CSV counts', () => {
    const rows = regionalOutlook(region, 'C4', 'Pl', 'ACCESS-ESM1-5')
    const result = rows.find((r) => r.PERIOD === '2061_2080' && r.RUN === 'r1i1p1f1')!
    expect(result.total).toBe(94484)
    expect(result.baseline).toBe(119507)
    expect(result.persistence).toBeCloseTo(84425 / 119507, 12)
    expect(result.expansion).toBeCloseTo((94484 - 84425) / 119507, 12)
  })
  it('joins summary rows by model/run/period rather than row position', () => {
    const shuffled = structuredClone(region)
    shuffled.tables['PredSum.spp.home.C4'].rows.reverse()
    expect(regionalOutlook(shuffled, 'C4', 'Pl', 'ACCESS-ESM1-5')).toEqual(
      regionalOutlook(region, 'C4', 'Pl', 'ACCESS-ESM1-5'),
    )
  })
  it('does not manufacture ratios for a zero baseline', () => {
    expect(
      regionalOutlook(region, 'C4', 'Sw', 'ACCESS-ESM1-5').every((r) => r.persistence === null && r.expansion === null),
    ).toBe(true)
    expect(regionalOutlook(region, 'C4', 'unknown', 'ACCESS-ESM1-5')).toEqual([])
  })
})

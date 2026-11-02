import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fromArrayBuffer } from 'geotiff'
import { describe, expect, it } from 'vitest'
import {
  bgcLabel,
  legacyRating,
  regionalOutlook,
  legacySiteConditions,
  legacySpecies,
  preferredLegacyOption,
  legacyConditionLabel,
  legacyScenarioLabel,
  validateLegacyManifest,
  type LegacyManifest,
  type LegacyReference,
  type LegacyRegion,
} from './legacyAnalysis'
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

describe('legacy dataset options and identity', () => {
  const customReference: LegacyReference = {
    levels: ['CUSTOM'],
    sites: { CUSTOM: { A1: 'CUSTOM/01', E8: 'CUSTOM/02' } },
    ratings: { Pl: { 'CUSTOM/01': 1 }, Fd: { 'CUSTOM/02': 2 }, X: {} },
    names: { Pl: 'pine', Fd: 'fir' },
  }
  const customRegion: LegacyRegion = {
    tables: {
      'PredSum.spp.A1': { columns: ['Fd', 'Pl', 'Fd'], rows: [] },
      'PredSum.spp.E8': { columns: ['Pl'], rows: [] },
      'PredSum.spp.home.A1': { columns: ['Pl'], rows: [] },
    },
  }
  const customManifest = (): LegacyManifest => ({
    schema: 'cciss-legacy-analysis-v1',
    reference: { file: 'reference.json.gz' },
    regions: [{ id: 'Custom', file: 'regional/Custom.json.gz' }],
    rasters: [
      { model: 'CustomModel', period: '2031_2050', scenario: 'ssp585', run: 'r2', file: 'model.tif' },
      { model: 'CustomModel', period: '2031_2050', scenario: 'ssp245', run: 'r2', file: 'model245.tif' },
    ],
  })
  it('derives unfamiliar site conditions and condition-specific species without a C4 or BC table', () => {
    expect(legacySiteConditions(customReference, customRegion)).toEqual(['A1', 'E8'])
    expect(legacySpecies(customReference, customRegion, 'A1')).toEqual(['Fd', 'Pl'])
    expect(legacySpecies(customReference, customRegion, 'E8')).toEqual(['Pl'])
    expect(legacySpecies(customReference, undefined, 'A1')).toEqual(['Pl', 'Fd'])
    expect(legacyConditionLabel('E8')).toBe('E8')
    expect(legacyScenarioLabel('ssp585')).toBe('SSP5-8.5')
    expect(legacyScenarioLabel('custom-pathway')).toBe('custom-pathway')
    expect(preferredLegacyOption(['A1', 'E8'], 'E8')).toBe('E8')
    expect(preferredLegacyOption(['A1', 'E8'], 'C4')).toBe('A1')
    expect(preferredLegacyOption([], 'C4')).toBe('')
  })
  it('retains scenarios as distinct identities and rejects ambiguous resources', () => {
    expect(validateLegacyManifest(customManifest()).rasters).toHaveLength(2)
    const duplicate = customManifest()
    duplicate.rasters.push({ ...duplicate.rasters[0], file: 'different-file.tif' })
    expect(() => validateLegacyManifest(duplicate)).toThrow('Duplicate legacy model/scenario/run/period')
    for (const file of ['../other.json', '/other.json', 'https://example.com/x', '%2e%2e/other.json']) {
      const unsafe = customManifest()
      unsafe.reference.file = file
      expect(() => validateLegacyManifest(unsafe)).toThrow('reference, regions and raster')
    }
    const noProjection = customManifest()
    noProjection.rasters = [{ ...noProjection.rasters[0], role: 'aggregate' }]
    expect(() => validateLegacyManifest(noProjection)).toThrow('no model projections')
  })
  it('joins regional ratios by model, scenario, run and period with an explicit historical baseline', () => {
    const row = (GCM: string, SSP: string, RUN: string, PERIOD: string, n: number) => ({
      id: { GCM, SSP, RUN, PERIOD },
      values: [n],
    })
    const custom: LegacyRegion = {
      tables: {
        'PredSum.spp.E8': {
          columns: ['Pl'],
          rows: [
            row('obs', 'obs', 'NA', '1981_2010', 100),
            row('Model', 'ssp245', 'r1', '2031_2050', 90),
            row('Model', 'ssp585', 'r1', '2031_2050', 70),
            row('Model', 'ssp585', 'r2', '2031_2050', 50),
          ],
        },
        'PredSum.spp.home.E8': {
          columns: ['Pl'],
          rows: [
            row('Model', 'ssp585', 'r2', '2031_2050', 30),
            row('Model', 'ssp245', 'r1', '2031_2050', 80),
            row('Model', 'ssp585', 'r1', '2031_2050', 60),
          ],
        },
      },
    }
    expect(regionalOutlook(custom, 'E8', 'Pl', 'Model', { scenario: 'ssp585', run: 'r1' })).toMatchObject([
      { baseline: 100, total: 70, persistence: 0.6, expansion: 0.1, SSP: 'ssp585', RUN: 'r1' },
    ])
    expect(regionalOutlook(custom, 'E8', 'Pl', 'Model', { scenario: 'ssp585', run: 'r2' })).toMatchObject([
      { total: 50, persistence: 0.3, expansion: 0.2 },
    ])
    expect(
      regionalOutlook(custom, 'E8', 'Pl', 'Model', { baselinePeriod: '1961_1990' }).every(
        (r) => r.persistence === null,
      ),
    ).toBe(true)
  })
})

import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fromArrayBuffer } from 'geotiff'
import {
  compareLegacyPoint,
  LEGACY_LIMITATION,
  type LegacyComparisonReport,
  type LegacyPointSample,
} from './legacyComparison'
import { regionalOutlook, type LegacyManifest, type LegacyReference, type LegacyRegion } from './legacyAnalysis'
import { legacyComparisonSnapshot } from './legacyComparisonAdapter'
import { sampleCcissRaster } from './raster'
import { compareSnapshots } from './comparison'

const root = 'vendor/bcdatamapper/datascrapers/bc/cciss/output/legacy-analysis/'
const manifest: LegacyManifest = JSON.parse(readFileSync(root + 'manifest.json', 'utf8'))
const reference: LegacyReference = JSON.parse(gunzipSync(readFileSync(root + 'reference.json.gz')).toString())
const region: LegacyRegion = JSON.parse(gunzipSync(readFileSync(root + 'BC.json.gz')).toString())
let pg: LegacyPointSample[], victoria: LegacyPointSample[]
beforeAll(async () => {
  const sampled = await Promise.all(
    manifest.rasters.map(async (raster) => {
      const bytes = readFileSync(root + raster.file)
      const tif = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const image = await tif.getImage()
      const pg = await sampleCcissRaster(image, 53.9171, -122.7497)
      const victoria = await sampleCcissRaster(image, 48.43, -123.37)
      await tif.close()
      return { pg: { ...raster, sample: pg }, victoria: { ...raster, sample: victoria } }
    }),
  )
  pg = sampled.map((value) => value.pg)
  victoria = sampled.map((value) => value.victoria)
})
function report(samples: LegacyPointSample[], edatope = 'C4', model = 'ACCESS-ESM1-5'): LegacyComparisonReport {
  const comparison = compareLegacyPoint(reference, samples, edatope, ['Pl', 'Fd'])
  const member = comparison.members.find((member) => member.model === model)!
  return {
    schema: 'cciss-legacy-comparison-v1',
    method: LEGACY_LIMITATION,
    source: 'Province of British Columbia · CCISS_ShinyApp/Development/OLD/spatial_app',
    dataset: manifest.schema,
    provenance: structuredClone(manifest),
    longitude: samples === victoria ? -123.37 : -122.7497,
    latitude: samples === victoria ? 48.43 : 53.9171,
    edatope,
    comparison,
    regional: {
      region: 'BC',
      species: 'Pl',
      model,
      scenario: member.scenario,
      run: member.run,
      trends: regionalOutlook(region, edatope, 'Pl', model, { scenario: member.scenario, run: member.run }),
    },
  }
}
function capture(value: LegacyComparisonReport, model = value.regional.model) {
  const member = value.comparison.members.find((member) => member.model === model)!
  return legacyComparisonSnapshot(value, {
    reference,
    member: member.key,
    id: 'test-capture',
    capturedAt: '2026-11-02T12:00:00Z',
  })
}

describe('real-data legacy comparison snapshots', () => {
  it('captures one actual model across all species/periods and keeps observed and modelled intervals distinct', () => {
    const snapshot = capture(report(pg))
    expect(snapshot.context).toMatchObject({
      longitude: -122.7497,
      latitude: 53.9171,
      model: 'ACCESS-ESM1-5',
      scenario: 'ssp245',
      run: 'r1i1p1f1',
      siteCondition: 'C4',
    })
    const pine = snapshot.metrics.filter((metric) => metric.measure === 'species-suitability' && metric.entity === 'Pl')
    expect(pine).toHaveLength(7)
    expect(pine.filter((metric) => metric.dimensions.stage === 'modelled').map((metric) => metric.value)).toEqual([
      3, 3, 3, 2, 2,
    ])
    expect(
      pine.filter((metric) => metric.period === '2001_2020').map((metric) => [metric.dimensions.stage, metric.value]),
    ).toEqual([
      ['observed', 1],
      ['modelled', 3],
    ])
    expect(snapshot.periods['2001_2020']).toMatchObject({ startYear: 2001, endYear: 2020 })
    expect(snapshot.metrics.find((metric) => metric.measure === 'bgc' && metric.period === '2061_2080')).toMatchObject({
      value: 'ICHmw3',
      unit: 'category',
    })
    expect(
      snapshot.metrics.find((metric) => metric.measure === 'site-series' && metric.period === '2061_2080'),
    ).toMatchObject({ value: reference.sites.ICHmw3.C4, unit: 'category' })
    expect(snapshot.provenance.limitations?.join(' ')).toContain('provisional')
    expect(snapshot.provenance.metadata?.sourceManifest).toMatchObject({
      reference: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
  })
  it('freezes independent captures for different locations, models and site conditions', () => {
    const source = report(pg)
    const first = capture(source)
    const second = capture(report(victoria))
    const third = capture(report(pg, 'B2', 'EC-Earth3'))
    expect(
      first.metrics.find((metric) => metric.measure === 'bgc' && metric.dimensions.stage === 'baseline')?.value,
    ).toBe('SBSmh')
    expect(
      second.metrics.find((metric) => metric.measure === 'bgc' && metric.dimensions.stage === 'baseline')?.value,
    ).toBe('CDFmm')
    expect(third.context).toMatchObject({ model: 'EC-Earth3', siteCondition: 'B2' })
    source.comparison.species[0].baseline = null
    source.comparison.projections[0].bgc = 'Changed after capture'
    source.regional.trends[0].persistence = 0
    ;(source.provenance as LegacyManifest).reference.file = 'changed.json'
    expect(
      first.metrics.find((metric) => metric.entity === 'Pl' && metric.dimensions.stage === 'baseline')?.value,
    ).toBe(1)
    expect(first.provenance.metadata?.sourceManifest).toMatchObject({ reference: { file: 'reference.json.gz' } })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.metrics[0])).toBe(true)
  })
  it('retains unknown point values and treats regional ratios/counts as a different scope from point classes', () => {
    const source = report(pg.map((raster) => ({ ...raster, sample: { status: 'outside' } })))
    source.regional.trends[0].expansion = 1.7 // Synthetic ratio edge case, not an additional model result.
    source.regional.trends[1].persistence = null
    const snapshot = capture(source)
    expect(
      snapshot.metrics.filter((metric) => metric.dimensions.scope === 'point').every((metric) => metric.value === null),
    ).toBe(true)
    expect(snapshot.metrics.find((metric) => metric.measure === 'regional-expansion')).toMatchObject({
      unit: 'ratio',
      value: 1.7,
      dimensions: { scope: 'named-region' },
    })
    expect(
      snapshot.metrics.find(
        (metric) => metric.measure === 'regional-persistence' && metric.period === source.regional.trends[1].PERIOD,
      )?.value,
    ).toBeNull()
    expect(snapshot.metrics.find((metric) => metric.measure === 'regional-baseline-cells')).toMatchObject({
      value: 119507,
      unit: 'count',
      period: '1961_1990',
    })
    expect(snapshot.metrics.filter((metric) => metric.unit === 'probability')).toHaveLength(0)
  })
  it('aligns real sites and model settings by species, exact interval and stage', () => {
    const a = capture(report(pg))
    const modelChange = compareSnapshots(a, capture(report(pg, 'C4', 'EC-Earth3')))
    const pine = modelChange.rows.find(
      (row) =>
        row.metric.measure === 'species-suitability' &&
        row.metric.entity === 'Pl' &&
        row.metric.period === '2001_2020' &&
        row.metric.dimensions.stage === 'modelled',
    )!
    expect(pine).toMatchObject({
      leftValue: 3,
      rightValue: 1,
      delta: -2,
      deltaUnit: 'class-steps',
      interpretation: 'improved',
    })
    const siteChange = compareSnapshots(a, capture(report(victoria)))
    const baseline = siteChange.rows.find(
      (row) => row.metric.measure === 'bgc' && row.metric.dimensions.stage === 'baseline',
    )!
    expect(baseline).toMatchObject({
      leftValue: 'SBSmh',
      rightValue: 'CDFmm',
      delta: null,
      interpretation: 'changed',
      compatible: true,
    })
    const conditionChange = compareSnapshots(a, capture(report(pg, 'B2')))
    expect(conditionChange.rows.some((row) => row.metric.measure === 'species-suitability' && row.delta !== null)).toBe(
      true,
    )
  })
  it('rejects an unavailable member or mismatched regional rows and preserves unclassified source codes', () => {
    const source = report(pg)
    expect(() => legacyComparisonSnapshot(source, { reference, member: 'unavailable' })).toThrow('available model run')
    source.regional.trends[0].SSP = 'ssp585'
    expect(() => capture(source)).toThrow('do not match')
    source.regional.trends[0].SSP = 'ssp245'
    source.comparison.species[0].baseline = 5
    // Code 5 is non-suitable in the source app, so it compares as class 4 and keeps its raw code.
    const five = capture(source)
    const baselineMetric = (snapshot: typeof five, measure: string) =>
      snapshot.metrics.find(
        (metric) => metric.measure === measure && metric.entity === 'Pl' && metric.dimensions.stage === 'baseline',
      )
    expect(baselineMetric(five, 'species-suitability')?.value).toBe(4)
    expect(baselineMetric(five, 'species-source-code')).toMatchObject({ value: '5', unit: 'category' })
    expect(five.provenance.limitations?.join(' ') ?? '').not.toContain('outside the defined 1–4')
    source.comparison.species[0].baseline = 6
    const unclassified = capture(source)
    expect(
      unclassified.metrics.find(
        (metric) =>
          metric.measure === 'species-suitability' && metric.entity === 'Pl' && metric.dimensions.stage === 'baseline',
      )?.value,
    ).toBeNull()
    expect(
      unclassified.metrics.find(
        (metric) =>
          metric.measure === 'species-source-code' && metric.entity === 'Pl' && metric.dimensions.stage === 'baseline',
      ),
    ).toMatchObject({ value: '6', unit: 'category' })
    expect(unclassified.provenance.limitations?.join(' ')).toContain('outside the defined 1–4')
  })
})

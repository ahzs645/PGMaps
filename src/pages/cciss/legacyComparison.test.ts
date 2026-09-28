import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fromArrayBuffer } from 'geotiff'
import { beforeAll, describe, expect, it } from 'vitest'
import { compareLegacyPoint, legacyComparisonHtml, LEGACY_LIMITATION, type LegacyPointSample } from './legacyComparison'
import { sampleCcissRaster } from './raster'
import type { LegacyManifest, LegacyReference } from './legacyAnalysis'
const root = 'vendor/bcdatamapper/datascrapers/bc/cciss/output/legacy-analysis/'
const manifest: LegacyManifest = JSON.parse(readFileSync(root + 'manifest.json', 'utf8'))
const reference: LegacyReference = JSON.parse(gunzipSync(readFileSync(root + 'reference.json.gz')).toString())
let samples: LegacyPointSample[]
beforeAll(async () => {
  samples = await Promise.all(
    manifest.rasters.map(async (r) => {
      const bytes = readFileSync(root + r.file)
      const tif = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const sample = await sampleCcissRaster(await tif.getImage(), 53.9171, -122.7497)
      await tif.close()
      return { ...r, sample }
    }),
  )
})
describe('legacy point comparisons', () => {
  it('matches independently sampled rasterio ratings for all six runs and five periods', () => {
    const c = compareLegacyPoint(reference, samples, 'C4', ['Pl'])
    expect(c.members).toHaveLength(6)
    expect(c.periods).toEqual(['2001_2020', '2021_2040', '2041_2060', '2061_2080', '2081_2100'])
    expect(c.species[0]).toMatchObject({ baseline: 1, observed: 1 })
    const expected: Record<string, number[]> = {
      'ACCESS-ESM1-5': [3, 3, 3, 2, 2],
      'EC-Earth3': [1, 3, 2, 2, 2],
      'GISS-E2-1-G': [1, 2, 2, 2, 2],
      MIROC6: [3, 3, 2, 2, 2],
      'MPI-ESM1-2-HR': [1, 3, 3, 2, 2],
      'MRI-ESM2-0': [2, 2, 2, 2, 2],
    }
    for (const m of c.members)
      expect(
        c.periods.map((p) => c.species[0].projections.find((r) => r.member === m.key && r.period === p)?.rating),
      ).toEqual(expected[m.model])
    expect(c.baseline?.bgc).toBe('SBSmh')
    expect(c.projections.find((r) => r.model === 'ACCESS-ESM1-5' && r.period === '2061_2080')?.bgc).toBe('ICHmw3')
  })
  it('keeps observed and modelled 2001–2020 separate and joins by identity after shuffling', () => {
    const c = compareLegacyPoint(reference, [...samples].reverse(), 'C4', ['Pl'])
    expect(c.observed?.model).toBe('Observed')
    expect(c.species[0].observed).toBe(1)
    expect(c.species[0].projections.find((r) => r.model === 'ACCESS-ESM1-5' && r.period === '2001_2020')?.rating).toBe(
      3,
    )
    const run = samples.find((r) => r.scenario === 'ssp245')!
    const twoRuns = compareLegacyPoint(
      reference,
      [...samples, { ...run, run: 'test-second-run', sample: { status: 'nodata' } }],
      'C4',
      ['Pl'],
    )
    expect(twoRuns.members).toHaveLength(7)
    expect(twoRuns.species[0].projections.find((r) => r.run === 'test-second-run')?.rating).toBeNull()
  })
  it('keeps outside/nodata/unmapped values unknown, including exports', () => {
    const c = compareLegacyPoint(
      reference,
      samples.map((r, i) => ({ ...r, sample: i % 2 ? { status: 'nodata' } : { status: 'outside' } })),
      'C4',
      ['Pl', 'missing'],
    )
    expect(c.baseline?.bgc).toBeNull()
    expect(
      c.species.every(
        (s) => s.baseline === null && s.observed === null && s.projections.every((r) => r.rating === null),
      ),
    ).toBe(true)
    const html = legacyComparisonHtml({
      schema: 'cciss-legacy-comparison-v1',
      method: LEGACY_LIMITATION,
      source: '<script>test</script>',
      dataset: manifest.schema,
      longitude: 0,
      latitude: 0,
      edatope: 'C4',
      comparison: c,
      regional: { region: 'BC', species: 'Pl', model: 'ACCESS-ESM1-5', trends: [] },
    })
    expect(html).toContain('No rating')
    expect(html).toContain('provisional')
    expect(html).toContain('MRI-ESM2-0')
    expect(html).toContain('&lt;script&gt;test&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
})

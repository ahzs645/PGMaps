import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { LegacyManifest, LegacyReference, LegacyRegion } from '../../src/pages/cciss/legacyAnalysis'
import { choose, expectSelected, optionLabels } from './styled-select'

// The production data worker can serve JSON before page.route sees it; this fixture must reach its mocked manifest.
test.use({ serviceWorkers: 'block' })

const root = 'vendor/bcdatamapper/datascrapers/bc/cciss/output/legacy-analysis/'

test('legacy options follow a manifest with another scenario, period, condition and regional identity', async ({
  page,
}) => {
  // Synthetic metadata fixtures reuse the real numeric inputs solely to exercise option compatibility.
  // They do not claim to be additional climate-model predictions.
  const manifest: LegacyManifest = JSON.parse(await readFile(root + 'manifest.json', 'utf8'))
  const reference: LegacyReference = JSON.parse(gunzipSync(await readFile(root + 'reference.json.gz')).toString())
  const regional: LegacyRegion = JSON.parse(gunzipSync(await readFile(root + 'BC.json.gz')).toString())
  const source = manifest.rasters.find((r) => r.model === 'ACCESS-ESM1-5' && r.period === '2061_2080')!
  manifest.rasters.push({ ...source, scenario: 'ssp585', period: '2031_2050' })
  manifest.regions = [{ id: 'SyntheticPilot', label: 'Synthetic option verification', file: 'BC.json.gz' }]
  for (const site of Object.values(reference.sites)) site.E8 = site.C4
  for (const prefix of ['PredSum.spp.', 'PredSum.spp.home.']) {
    const table = regional.tables[prefix + 'C4']
    const columns = ['Fd', 'Pl']
    regional.tables[prefix + 'E8'] = {
      columns,
      rows: table.rows.map((row) => ({
        ...row,
        values: columns.map((species) => row.values[table.columns.indexOf(species)]),
      })),
    }
  }
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.route('**/legacy-analysis/manifest.json', (route) => route.fulfill({ json: manifest }))
  await page.route('**/legacy-analysis/reference.json.gz', (route) =>
    route.fulfill({ contentType: 'application/gzip', body: gzipSync(JSON.stringify(reference)) }),
  )
  await page.route('**/legacy-analysis/BC.json.gz', (route) =>
    route.fulfill({ contentType: 'application/gzip', body: gzipSync(JSON.stringify(regional)) }),
  )
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.7497&lat=53.9171&render=tiles&analysis=legacy')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('table', { name: 'Legacy species suitability' })).toBeVisible()
  await choose(dialog.getByLabel('Analysis site condition'), 'E8')
  await expect.poll(async () => (await optionLabels(dialog.getByLabel('Comparison species'))).length).toBe(2)
  await choose(dialog.getByLabel('Emissions scenario'), 'ssp585')
  await expect.poll(() => optionLabels(dialog.getByLabel('Projection period'))).toEqual(['2031–2050'])
  await expect.poll(async () => (await optionLabels(dialog.getByLabel('Climate model'))).length).toBe(1)
  await dialog.getByRole('tab', { name: 'Regional outlook', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Regional outlook · SyntheticPilot' })).toBeVisible()
  await expectSelected(dialog.getByLabel('Regional summary'), 'SyntheticPilot')
  await expect(dialog.getByText('No regional rows for this selection.', { exact: true })).toBeVisible()
  await dialog.getByLabel('Longitude', { exact: true }).fill('-123.37')
  await dialog.getByLabel('Latitude', { exact: true }).fill('48.43')
  await dialog.getByRole('button', { name: 'Analyse location' }).click()
  await expect(dialog.getByText('CDFmm', { exact: true }).first()).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Regional outlook', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expectSelected(dialog.getByLabel('Analysis site condition'), 'E8')
  await expectSelected(dialog.getByLabel('Emissions scenario'), 'ssp585')
  await expectSelected(dialog.getByLabel('Projection period'), '2031_2050')
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download analysis JSON' }).click()
  const report = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'))
  expect(report.edatope).toBe('E8')
  expect(report.regional).toMatchObject({ region: 'SyntheticPilot', scenario: 'ssp585', run: source.run, trends: [] })
  expect(report.comparison.species.map((species: { species: string }) => species.species)).toEqual(['Fd', 'Pl'])
  expect(errors).toEqual([])
})

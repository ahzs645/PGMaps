import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})

test('location, six-model comparisons, regional results, references and complete reports without CSV', async ({
  page,
}) => {
  const errors: string[] = []
  const rasterRequests: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (/\/legacy-analysis\/.*\.tif$/.test(r.url())) rasterRequests.push(r.url())
  })
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.7497&lat=53.9171&z=7&render=tiles')
  await page.getByRole('button', { name: 'Open legacy analysis' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('SBSmh', { exact: true })).toBeVisible()
  await expect(dialog.getByText('ICHmw3', { exact: true })).toBeVisible()
  const table = dialog.getByRole('table', { name: 'Legacy species suitability' })
  const pl = table.getByRole('row').filter({ hasText: 'Pl ·' })
  await expect(pl.getByRole('cell').nth(1)).toHaveText('High')
  await expect(pl.getByRole('cell').nth(2)).toHaveText('High') // Observed, distinct from ACCESS model.
  await expect(pl.getByRole('cell').nth(3)).toHaveText('Low')
  await expect(pl.getByRole('cell').nth(6)).toHaveText('Moderate')
  expect(rasterRequests).toHaveLength(32)
  await dialog.getByRole('tab', { name: 'Model comparison', exact: true }).click()
  const models = dialog.getByRole('table', { name: 'Species by model and period' })
  await expect(models.getByRole('row')).toHaveCount(7)
  await expect(models.getByRole('row').filter({ hasText: 'EC-Earth3' }).getByRole('cell').nth(1)).toHaveText('High')
  await page.screenshot({ path: 'tmp/cciss-legacy-comparison.png' })
  await dialog.getByRole('tab', { name: 'BGC changes', exact: true }).click()
  await expect(
    dialog
      .getByRole('table', { name: 'BGC by model and period' })
      .getByRole('row')
      .filter({ hasText: 'ACCESS-ESM1-5' }),
  ).toContainText('ICHdw4')
  await dialog.getByRole('tab', { name: 'Regional outlook', exact: true }).click()
  const outlook = dialog.getByRole('table', { name: 'Regional persistence and expansion' })
  await expect(outlook).toContainText('70.6%')
  await expect(outlook).toContainText('8.4%')
  await expect(outlook.getByRole('row')).toHaveCount(6) // One actual run, no ensembleMean duplicate.
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download analysis JSON' }).click()
  const download = await downloadPromise
  const report = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(report.longitude).toBe(-122.7497)
  expect(report.comparison.members).toHaveLength(6)
  expect(report.comparison.species.find((s: { species: string }) => s.species === 'Pl').projections).toHaveLength(30)
  expect(report.regional.trends).toHaveLength(5)
  expect(report.method).toContain('provisional')
  expect(report.provenance.reference.sha256).toHaveLength(64)
  await dialog.getByRole('tab', { name: 'Silvics', exact: true }).click()
  await expect(dialog.getByText('Tree Code', { exact: true })).toHaveCount(4)
  await dialog.getByRole('tab', { name: 'Report', exact: true }).click()
  const htmlPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download printable report' }).click()
  const html = await readFile((await (await htmlPromise).path())!, 'utf8')
  expect(html).toContain('MRI-ESM2-0')
  expect(html).toContain('70.6%')
  expect(html).toContain('No rating means missing data')
  await dialog.getByLabel('Analysis site condition').selectOption('B2')
  await dialog.getByRole('tab', { name: 'Regional outlook', exact: true }).click()
  await dialog.getByLabel('Regional summary').selectOption('100MileHouse')
  await expect(dialog.getByRole('heading', { name: 'Regional outlook · 100MileHouse' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Download analysis JSON' })).toBeEnabled()
  await dialog.getByLabel('Longitude', { exact: true }).fill('-123.37')
  await dialog.getByLabel('Latitude', { exact: true }).fill('48.43')
  await dialog.getByRole('button', { name: 'Analyse location' }).click()
  await expect(dialog.getByText('CDFmm', { exact: true }).first()).toBeVisible()
  // Coordinate changes reuse already fetched numeric rasters.
  expect(rasterRequests).toHaveLength(32)
  await dialog.getByLabel('Longitude', { exact: true }).fill('10')
  await dialog.getByLabel('Latitude', { exact: true }).fill('10')
  await dialog.getByRole('button', { name: 'Analyse location' }).click()
  await expect(dialog.getByText('This location has no valid BGC', { exact: false })).toBeVisible()
  await expect(
    dialog.getByRole('table', { name: 'Legacy species suitability' }).getByRole('row').filter({ hasText: 'Pl ·' }),
  ).toContainText('No rating')
  expect(rasterRequests).toHaveLength(32)
  expect(errors).toEqual([])
})

test('a failed comparison raster is reported and retries without pretending it is no-data', async ({ page }) => {
  let fails = true
  await page.route('**/legacy-analysis/BGC.pred.ref.tif', (route) =>
    fails ? route.fulfill({ status: 503, body: 'temporarily unavailable' }) : route.continue(),
  )
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.7497&lat=53.9171&render=tiles&analysis=legacy')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('Could not load analysis')
  await expect(dialog.getByRole('button', { name: 'Download analysis JSON' })).toHaveCount(0)
  fails = false
  await dialog.getByRole('button', { name: 'Retry analysis' }).click()
  await expect(dialog.getByText('SBSmh', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

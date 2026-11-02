import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// Real prepared CCISS analysis files are served unchanged; only the unrelated external basemap is stubbed.
test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})

test('compares frozen legacy results for Prince George and Victoria with real source periods and geographic scopes', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.7497&lat=53.9171&render=tiles&analysis=legacy')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('table', { name: 'Legacy species suitability' })).toBeVisible()
  await dialog.getByLabel('Comparison label').fill('Prince George · C4 · ACCESS')
  await dialog.getByRole('button', { name: 'Save for comparison', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Saved for comparison: Prince George')
  await dialog.getByLabel('Longitude', { exact: true }).fill('-123.37')
  await dialog.getByLabel('Latitude', { exact: true }).fill('48.43')
  await dialog.getByRole('button', { name: 'Analyse location' }).click()
  await expect(dialog.getByText('CDFmm', { exact: true }).first()).toBeVisible()
  await dialog.getByLabel('Comparison label').fill('Victoria · C4 · ACCESS')
  await dialog.getByRole('button', { name: 'Save for comparison', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open comparisons (2)', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'CCISS comparison', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Comparison A').locator('option:checked')).toHaveText('Prince George · C4 · ACCESS')
  await expect(dialog.getByLabel('Comparison B').locator('option:checked')).toHaveText('Victoria · C4 · ACCESS')
  await dialog.getByLabel('Comparison measure').selectOption('bgc')
  const baseline = dialog
    .getByRole('table', { name: 'CCISS aligned comparison' })
    .getByRole('row')
    .filter({ hasText: 'baseline' })
  await expect(baseline).toContainText('1961_1990')
  await expect(baseline).toContainText('SBSmh')
  await expect(baseline).toContainText('CDFmm')
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download comparison JSON', exact: true }).click()
  const exported = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'))
  expect(exported.left.context).toMatchObject({
    longitude: -122.7497,
    latitude: 53.9171,
    siteCondition: 'C4',
    model: 'ACCESS-ESM1-5',
    scenario: 'ssp245',
    run: 'r1i1p1f1',
  })
  expect(exported.right.context).toMatchObject({ longitude: -123.37, latitude: 48.43, siteCondition: 'C4' })
  expect(exported.left.periods['2001_2020']).toMatchObject({ startYear: 2001, endYear: 2020 })
  expect(exported.left.provenance.limitations.join(' ')).toContain('provisional')
  expect(
    exported.left.metrics.find((metric: { measure: string }) => metric.measure === 'regional-expansion'),
  ).toMatchObject({ unit: 'ratio', dimensions: { scope: 'named-region' } })
  expect(exported.left.metrics.filter((metric: { unit: string }) => metric.unit === 'probability')).toHaveLength(0)
  expect(errors).toEqual([])
})

test('compares different actual models and site conditions without changing an earlier saved result', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.7497&lat=53.9171&render=tiles&analysis=legacy')
  const dialog = page.getByRole('dialog')
  const table = dialog.getByRole('table', { name: 'Legacy species suitability' })
  await expect(table).toBeVisible()
  const firstRating = await table.getByRole('row').filter({ hasText: 'Pl ·' }).getByRole('cell').nth(3).innerText()
  await dialog.getByLabel('Comparison label').fill('ACCESS · C4')
  await dialog.getByRole('button', { name: 'Save for comparison', exact: true }).click()
  await dialog.getByLabel('Climate model').selectOption({ label: 'EC-Earth3 · r4i1p1f1' })
  await dialog.getByLabel('Analysis site condition').selectOption('B2')
  const secondRating = await table.getByRole('row').filter({ hasText: 'Pl ·' }).getByRole('cell').nth(3).innerText()
  await dialog.getByLabel('Comparison label').fill('EC-Earth3 · B2')
  await dialog.getByRole('button', { name: 'Save for comparison', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open comparisons (2)', exact: true }).click()
  await dialog.getByLabel('Comparison measure').selectOption('species-suitability')
  await dialog.getByLabel('Search comparison').fill('Pl')
  await expect(dialog.getByRole('table', { name: 'CCISS aligned comparison' })).toContainText('2001_2020')
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download comparison JSON', exact: true }).click()
  const exported = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'))
  expect(exported.left.context).toMatchObject({
    siteCondition: 'C4',
    model: 'ACCESS-ESM1-5',
    run: 'r1i1p1f1',
    scenario: 'ssp245',
  })
  expect(exported.right.context).toMatchObject({
    siteCondition: 'B2',
    model: 'EC-Earth3',
    run: 'r4i1p1f1',
    scenario: 'ssp245',
  })
  const ratingCodes: Record<string, number | null> = { High: 1, Moderate: 2, Low: 3, Unsuitable: 4, 'No rating': null }
  const value = (snapshot: {
    metrics: { measure: string; entity: string; period: string; dimensions: { stage: string }; value: number | null }[]
  }) =>
    snapshot.metrics.find(
      (metric) =>
        metric.measure === 'species-suitability' &&
        metric.entity === 'Pl' &&
        metric.period === '2001_2020' &&
        metric.dimensions.stage === 'modelled',
    )!.value
  expect(value(exported.left)).toBe(ratingCodes[firstRating.trim()])
  expect(value(exported.right)).toBe(ratingCodes[secondRating.trim()])
  expect(exported.left.context.longitude).toBe(exported.right.context.longitude)
  expect(exported.left.context.latitude).toBe(exported.right.context.latitude)
  expect(errors).toEqual([])
})

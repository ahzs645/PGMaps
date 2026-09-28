import { expect, test } from '@playwright/test'

test('legacy numeric analysis loads, calculates, changes selection and exports', async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.7497&lat=53.9171&z=7&render=tiles')
  await page.getByRole('button', { name: 'Open legacy analysis' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('SBSmh', { exact: true })).toBeVisible()
  await expect(dialog.getByText('ICHmw3', { exact: true })).toBeVisible()
  const table = dialog.getByRole('table', { name: 'Legacy species suitability' })
  await expect(table.getByRole('row').filter({ hasText: 'Pl ·' })).toContainText('High')
  await expect(table.getByRole('row').filter({ hasText: 'Pl ·' })).toContainText('Moderate')
  const outlook = dialog.getByRole('table', { name: 'Regional persistence and expansion' })
  await expect(outlook).toContainText('70.6%')
  await expect(outlook).toContainText('8.4%')
  await page.screenshot({ path: 'tmp/cciss-legacy-analysis.png' })
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download analysis JSON' }).click()
  expect((await download).suggestedFilename()).toBe('cciss-legacy-analysis.json')
  await dialog.getByLabel('Analysis site condition').selectOption('B2')
  await expect(dialog.getByRole('table', { name: 'Legacy species suitability' })).toBeVisible()
  await dialog.getByLabel('Regional summary').selectOption('100MileHouse')
  await expect(dialog.getByRole('heading', { name: 'Regional outlook · 100MileHouse' })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

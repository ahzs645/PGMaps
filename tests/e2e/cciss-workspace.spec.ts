import { expect, test } from '@playwright/test'
import { choose, expectSelected } from './styled-select'

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})

test('a shared workspace restores map controls and keeps the assessment point separate from the camera', async ({
  page,
}) => {
  await page.goto(
    '/dev/forestry/cciss-suitability?lng=-125&lat=55&z=7&pointLng=-122.7497&pointLat=53.9171&kind=bgc&period=2081_2100&gcm=Ensemble&byZone=1&render=tiles&analysis=legacy',
  )
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Longitude', { exact: true })).toHaveValue('-122.7497')
  await expect(dialog.getByLabel('Latitude', { exact: true })).toHaveValue('53.9171')
  await expect(dialog.getByRole('table', { name: 'Legacy species suitability' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page).not.toHaveURL(/analysis=/)
  await expectSelected(page.getByRole('combobox', { name: 'Display', exact: true }), 'bgc')
  await expectSelected(page.getByRole('combobox', { name: 'Time period', exact: true }), '2081_2100')
  await expectSelected(page.getByRole('combobox', { name: 'Climate model', exact: true }), 'Ensemble')
  await expect(page.getByLabel('Group by zone', { exact: true })).toBeChecked()
  expect(new URL(page.url()).searchParams.get('lng')).toBe('-125')
  await page.getByRole('button', { name: 'Open current data analysis', exact: true }).click()
  await expect(page).toHaveURL(/analysis=current/)
  await expect(page.getByRole('dialog')).toContainText('Import current CCISS JSON')
  await page.reload()
  await expect(page.getByRole('dialog')).toContainText('Import current CCISS JSON')
})

test('local raster values remain inspectable when published options change and can be cleared', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.7497&lat=53.9171&render=native')
  const source = 'vendor/bcdatamapper/datascrapers/bc/cciss/output/historical-download-1961-1990-C4-Pl.tif'
  await page.getByLabel('Local suitability GeoTIFF', { exact: true }).setInputFiles(source)
  const local = page
    .getByText('Local GeoTIFF value · historical-download-1961-1990-C4-Pl.tif', { exact: true })
    .locator('..')
  await expect(local).toContainText('Numeric raster cell: 20')
  await expect(local).not.toContainText('Moderate')
  await choose(page.getByRole('combobox', { name: 'Species', exact: true }), 'Fd')
  await choose(page.getByRole('combobox', { name: 'Time period', exact: true }), '2081_2100')
  await expect(page.getByRole('button', { name: 'Direct GeoTIFF', exact: true })).toBeEnabled()
  await expect(local).toContainText('Numeric raster cell: 20')
  await expect(
    page.getByText('Local file values are shown without assigning a suitability class.', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Use prepared data again', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Direct GeoTIFF', exact: true })).toBeDisabled()
  await expect(local).toHaveCount(0)
  expect(errors).toEqual([])
})

import { expect, test } from '@playwright/test'

test.describe('North / South census subdivision boundaries', () => {
  test('loads every CSD and exposes both classifications', async ({ page }) => {
    const simplifiedRequests: string[] = []
    const legacyProvinceRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/data/census/canada-csd-simplified.geojson')) {
        simplifiedRequests.push(request.url())
      }
      if (request.url().includes('/data/census/canada-csd/provinces/')) {
        legacyProvinceRequests.push(request.url())
      }
    })

    await page.goto('/dev/boundaries', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Add' }).first().click()
    await page.getByRole('button', { name: 'Choose a level for Census boundaries' }).click()
    await page.getByRole('button', { name: 'Census Subdivision', exact: true }).click()
    await page.getByRole('button', { name: /Done/ }).click()

    await expect(page.getByText('Census boundaries · Census Subdivision · 5,161')).toBeVisible({
      timeout: 45_000,
    })
    expect(simplifiedRequests).toHaveLength(1)
    expect(legacyProvinceRequests).toHaveLength(0)

    await page.getByRole('button', { name: /^North \/ South CSDs/ }).click()
    await expect(page.getByText('Census boundaries · North / South CSDs · 5,161')).toBeVisible({
      timeout: 10_000,
    })
    expect(simplifiedRequests).toHaveLength(1)
    expect(legacyProvinceRequests).toHaveLength(0)
    await expect(page.getByText('North', { exact: true })).toBeVisible()
    await expect(page.getByText('South', { exact: true })).toBeVisible()

    const search = page.getByPlaceholder('Filter selected layers')
    await search.fill('5953023')
    await page.getByRole('button', { name: /Prince George/ }).first().click()
    await expect(page.locator('.maplibregl-popup').getByText('North', { exact: true })).toBeVisible()

    await search.fill('5915022')
    await page.getByRole('button', { name: /Vancouver/ }).first().click()
    await expect(page.locator('.maplibregl-popup').getByText('South', { exact: true })).toBeVisible()
  })
})

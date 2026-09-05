import { expect, test } from '@playwright/test'

test.describe('BCER boundary geometry comparison', () => {
  test('renders synchronized optimized and raw maps with measured payload stats', async ({ page }) => {
    await page.goto('/dev/boundaries/bcer', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: 'BCER admin zones: optimized vs raw' })).toBeVisible()
    await expect(page.getByText('Raw payload')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('7.02 MiB', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('316 KiB', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Topology check')).toBeVisible()
    await expect(page.getByText('Pass', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Optimized snapshot' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Raw BCER service' })).toBeVisible()
    await expect(page.locator('.maplibregl-map')).toHaveCount(2)
  })
})

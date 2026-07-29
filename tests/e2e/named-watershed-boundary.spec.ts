import { expect, test } from '@playwright/test'

test('loads the full Nechako named watershed from the compressed FWA snapshot', async ({ page }) => {
  await page.goto('/dev/boundaries', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Add' }).first().click()
  await page.getByRole('button', { name: 'Choose a level for Watershed boundaries' }).click()
  await page.getByRole('button', { name: 'Named Watershed', exact: true }).click()
  await page.getByRole('button', { name: /Done/ }).click()

  await expect(
    page.getByText('Watershed boundaries · Named Watershed · 11,580'),
  ).toBeVisible({ timeout: 60_000 })

  await page.getByPlaceholder('Search name, code, source, variant').fill('Nechako River')
  const result = page.getByRole('button').filter({ hasText: 'Nechako River' }).first()
  await expect(result).toContainText('8886')
  await expect(result).toContainText('47,258 km²')
})

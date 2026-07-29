import { expect, test } from '@playwright/test'

test('loads the full Nechako named watershed from the compressed stream-order shard', async ({ page }) => {
  await page.goto('/dev/boundaries', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Add' }).first().click()
  await page.getByRole('button', { name: 'Choose a level for Named watersheds' }).click()
  await page.getByRole('button', { name: 'Stream Order 8', exact: true }).click()
  await page.getByRole('button', { name: /Done/ }).click()

  await expect(
    page.getByText('Named watersheds · Stream Order 8 · 41'),
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/boundaries overlap by design/i)).toBeVisible()

  await page.getByPlaceholder('Search name, code, source, variant').fill('Nechako River')
  await expect(
    page.getByText('Named watersheds · Stream Order 8 · 1'),
  ).toBeVisible()
  const result = page.getByRole('button').filter({ hasText: 'Nechako River' }).first()
  await expect(result).toContainText('8886')
  await expect(result).toContainText('47,258 km²')
  await result.click()
  await expect(page.getByText(/cumulative drainage area; may overlap/i)).toBeVisible()
})

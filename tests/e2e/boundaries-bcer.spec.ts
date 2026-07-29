import { expect, test } from '@playwright/test'

test.describe('BCER administrative zone boundaries', () => {
  test('loads all four named zones from the local snapshot', async ({ page }) => {
    await page.goto('/dev/boundaries', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Add' }).first().click()
    await page.getByRole('button', { name: /^BCER admin zones/ }).click()
    await page.getByRole('button', { name: /Done/ }).click()

    await expect(page.getByText('BCER admin zones · Administrative Zone · 4')).toBeVisible({
      timeout: 15_000,
    })

    for (const name of ['Central', 'North', 'South East', 'South West']) {
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
    }
  })
})

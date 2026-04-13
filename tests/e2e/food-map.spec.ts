import { expect, test } from '@playwright/test'

test.describe('Food Map', () => {
  test('loads and displays restaurants', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    // Wait for data to load - sidebar should show restaurant count
    await expect(page.getByText(/restaurants/i)).toBeVisible({ timeout: 15_000 })
  })

  test('search query is reflected in URL params', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    // Wait for data to load
    await expect(page.getByText(/restaurants/i)).toBeVisible({ timeout: 15_000 })

    // Find and fill the search input
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('pizza')

      // URL should contain the search query
      await expect(page).toHaveURL(/q=pizza/)
    }
  })

  test('loads with URL search param pre-filled', async ({ page }) => {
    await page.goto('/foodmap?q=pizza', { waitUntil: 'domcontentloaded' })

    // Wait for data to load
    await expect(page.getByText(/restaurants/i)).toBeVisible({ timeout: 15_000 })

    // Search should be pre-filled
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await expect(searchInput).toHaveValue('pizza')
    }
  })
})

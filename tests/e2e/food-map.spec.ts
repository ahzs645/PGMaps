import { expect, test } from '@playwright/test'

test.describe('Food Map', () => {
  test('loads and displays food establishments', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    // Wait for data to load - sidebar should show the establishment count
    await expect(page.getByText(/establishments/i)).toBeVisible({ timeout: 15_000 })
  })

  test('search query is reflected in URL params', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    // Wait for data to load
    await expect(page.getByText(/establishments/i)).toBeVisible({ timeout: 15_000 })

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
    await expect(page.getByText(/establishments/i)).toBeVisible({ timeout: 15_000 })

    // Search should be pre-filled
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await expect(searchInput).toHaveValue('pizza')
    }
  })

  test('refreshes donut clusters when the violation time window changes', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    const donutPaths = page.locator('.maplibregl-marker svg path')
    await expect(donutPaths.first()).toBeVisible({ timeout: 15_000 })
    const periodDonuts = await donutPaths.evaluateAll((paths) => paths.map((path) => path.outerHTML).join(''))

    await page.getByRole('button', { name: 'Cumulative', exact: true }).click()
    await expect(page).toHaveURL(/violationTimeline=cumulative/)
    await expect.poll(
      () => donutPaths.evaluateAll((paths) => paths.map((path) => path.outerHTML).join('')),
      { timeout: 15_000 },
    ).not.toBe(periodDonuts)
  })

  test('opens earlier inspection history when the selected period has no records', async ({ page }) => {
    await page.goto('/foodmap?restaurant=7-Eleven+Food+Store+%2337258', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: 'Inspection history' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Latest inspection outside selected period:')).toBeVisible()
    await page.getByRole('button', { name: 'Inspection history' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('All inspection history', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Routine March 18, 2024/ })).toBeVisible()
    await dialog.getByRole('button', { name: 'Selected period' }).click()
    await expect(dialog.getByText(/^No inspections in /)).toBeVisible()
    await dialog.getByRole('button', { name: 'All history' }).click()
    await expect(dialog.getByRole('button', { name: /Routine March 18, 2024/ })).toBeVisible()
  })

  test('an establishment with no inspection records shows one empty state, not a page of zeros', async ({ page }) => {
    await page.goto('/foodmap?restaurant=Freeman+Park', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Inspection history' }).click()
    const dialog = page.getByRole('dialog', { name: 'Freeman Park' })
    await expect(dialog.getByText('No inspection records on file')).toBeVisible()
    await expect(dialog.getByText('2825 12th Avenue, Prince George', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'All history' })).toHaveCount(0)
    await expect(dialog.getByText(/N\/A/)).toHaveCount(0)
  })
})

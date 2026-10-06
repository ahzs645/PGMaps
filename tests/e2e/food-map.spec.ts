import { expect, test } from '@playwright/test'

test.describe('Food Map', () => {
  test('roulette keeps non-dining premises out even when optional filters are disabled', async ({ page }) => {
    const categories: Record<string, string> = {
      'Pizza place': 'Restaurant',
      'Coffee place': 'Coffee Shop',
      'Evangelical Free Church': 'Community Kitchen',
      'PG Civic Centre - CG 60667': 'Concession',
      'Meal program': 'Social Services',
      '7-Eleven Food Store #37259': 'Restaurant',
      'Costco Food Court': 'Concession',
    }
    const premises = Object.keys(categories).map((name, index) => ({
      name,
      address: 'Prince George',
      latitude: 53.91 + index * 0.001,
      longitude: -122.75,
      facility_type: 'Restaurant',
      hazard_rating: 'Low',
      details_url: `https://example.test/premise/${index}`,
      inspections: [],
    }))
    await page.route('**/data/restaurants.json', (route) => route.fulfill({ json: premises }))
    await page.route('**/data/restaurant-classifications.json', (route) => route.fulfill({ json: categories }))
    await page.route('**/data/restaurant-location-overrides.json', (route) => route.fulfill({ json: {} }))
    await page.route('**/data/ui/restaurant-locations.json', (route) => route.fulfill({ json: {} }))
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('7 establishments', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Restaurant roulette', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Restaurant Roulette' })
    const dining = dialog.getByRole('region', { name: 'Dining categories' })
    await expect(dialog.getByText('2 available', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Use filters', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(dining.getByText(/5 other inspected premises excluded/)).toBeVisible()
    const costco = dialog.getByRole('button', { name: 'Include Costco Food Court', exact: true })
    await expect(costco).toHaveAttribute('aria-pressed', 'false')
    await expect(costco).toContainText('Concession → Restaurant')
    await costco.click()
    await expect(costco).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByText('3 available', { exact: true })).toBeVisible()
    await expect(dining.getByText(/4 other inspected premises excluded/)).toBeVisible()
    await dining.getByRole('button', { name: 'None', exact: true }).click()
    await expect(dialog.getByText('0 available', { exact: true })).toBeVisible()
    await expect(dialog.getByText('No restaurants match your filters')).toBeVisible()
    await dining.getByRole('button', { name: 'Restaurant 2', exact: true }).click()
    await expect(dialog.getByText('2 available', { exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: 'Use filters', exact: true }).click()
    await expect(dialog.getByText('2 available', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Use filters', exact: true }).click()
    await expect(dialog.getByText('2 available', { exact: true })).toBeVisible()
    await dining.getByRole('button', { name: 'All', exact: true }).click()
    await expect(dialog.getByText('3 available', { exact: true })).toBeVisible()
    const store = dialog.getByRole('button', { name: 'Include 7-Eleven Food Store #37259', exact: true })
    await store.click()
    await expect(dialog.getByText('4 available', { exact: true })).toBeVisible()
    await store.click()
    await costco.click()
    await expect(dialog.getByText('2 available', { exact: true })).toBeVisible()
  })

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

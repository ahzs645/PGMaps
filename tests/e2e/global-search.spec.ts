import { expect, test } from '@playwright/test'

test.describe('Global Search', () => {
  test('opens and shows section quick links', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Open search' }).click()

    // Search dialog should appear
    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    // Should show map section quick links by default
    await expect(page.getByText('Food Safety Map')).toBeVisible()
    await expect(page.getByText('Air Quality Map')).toBeVisible()
    await expect(page.getByRole('option', { name: 'Parks & Trails Parks, trails, and amenities' })).toBeVisible()
  })

  test('filters results by search query', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Click the search button
    await page.getByRole('button', { name: 'Open search' }).click()

    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    // Type a query
    await searchInput.fill('Air')

    // Should show Air Quality related results
    await expect(page.getByText('Air Quality Map')).toBeVisible()
  })

  test('opens the map search panel on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/airquality', { waitUntil: 'domcontentloaded' })
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await expect(handle).toBeVisible()
    await page.getByRole('button', { name: 'Open search' }).click()
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
    await expect(page.getByPlaceholder('Search monitors, city, network, parameter...')).toBeFocused()
  })

  test('closes on Escape', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Open search' }).click()
    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(searchInput).toBeHidden()
  })

  test('navigates to a section when clicked', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Open search' }).click()
    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    // Click on Air Quality Map
    await page.getByText('Air Quality Map').click()

    // Should navigate to airquality page
    await expect(page).toHaveURL(/airquality/)
  })
})

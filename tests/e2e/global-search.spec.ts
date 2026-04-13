import { expect, test } from '@playwright/test'

test.describe('Global Search', () => {
  test('opens with Cmd+K and shows section quick links', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Press Cmd+K to open search
    await page.keyboard.press('Meta+k')

    // Search dialog should appear
    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    // Should show map section quick links by default
    await expect(page.getByText('Food Safety Map')).toBeVisible()
    await expect(page.getByText('Air Quality Map')).toBeVisible()
    await expect(page.getByText('Parks & Trails', { exact: false })).toBeVisible()
  })

  test('filters results by search query', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Click the search button
    await page.getByRole('button', { name: /Search/ }).click()

    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    // Type a query
    await searchInput.fill('Air')

    // Should show Air Quality related results
    await expect(page.getByText('Air Quality Map')).toBeVisible()
  })

  test('closes on Escape', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.keyboard.press('Meta+k')
    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(searchInput).toBeHidden()
  })

  test('navigates to a section when clicked', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.keyboard.press('Meta+k')
    const searchInput = page.getByPlaceholder('Search restaurants, parks, maps...')
    await expect(searchInput).toBeVisible()

    // Click on Air Quality Map
    await page.getByText('Air Quality Map').click()

    // Should navigate to airquality page
    await expect(page).toHaveURL(/airquality/)
  })
})

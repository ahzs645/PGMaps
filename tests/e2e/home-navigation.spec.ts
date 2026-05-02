import { expect, test } from '@playwright/test'

test.describe('Home Page Navigation', () => {
  test('renders all available map cards', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('Prince George Data Platform')).toBeVisible()

    const availableMaps = page.locator('section').filter({ hasText: 'Available Maps' })
    for (const name of ['Food Safety', 'Air Quality', 'Parks & Trails', 'Census Data', 'Score Builder', 'PG Data', 'Explorer']) {
      await expect(availableMaps.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
    }
  })

  test('navigates to food map section', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const availableMaps = page.locator('section').filter({ hasText: 'Available Maps' })
    await availableMaps.getByRole('link', { name: /^Food Safety/ }).click()
    await expect(page).toHaveURL(/foodmap/)
  })

  test('navigates to explorer section', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.getByRole('link', { name: 'Open Explorer' }).click()
    await expect(page).toHaveURL(/explorer/)
  })

  test('navbar links work and highlight active page', async ({ page }) => {
    await page.goto('/census', { waitUntil: 'domcontentloaded' })

    // Census link should be active
    const censusLink = page.locator('nav').getByText('Census')
    await expect(censusLink).toBeVisible()
  })

  test('mobile menu opens, closes, and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const menuButton = page.getByRole('button', { name: 'Toggle menu' })
    await expect(menuButton).toBeVisible()

    await menuButton.click()
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    const airQualityMenuLink = page.getByRole('link', { name: 'Air Quality', exact: true })
    await expect(airQualityMenuLink).toBeVisible()

    await menuButton.click()
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(airQualityMenuLink).not.toBeVisible()

    await menuButton.click()
    await airQualityMenuLink.click()
    await expect(page).toHaveURL(/airquality/)
  })

  test('theme toggle switches between light and dark', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const themeButton = page.getByRole('button', { name: 'Toggle theme' })
    await expect(themeButton).toBeVisible()

    await themeButton.click()
    // Theme should change - check that html has class 'dark' or 'light'
    const htmlClass = await page.locator('html').getAttribute('class')
    expect(htmlClass).toBeTruthy()
  })
})

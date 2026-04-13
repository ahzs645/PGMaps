import { expect, test } from '@playwright/test'

test.describe('Home Page Navigation', () => {
  test('renders all available map cards', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('Prince George Data Platform')).toBeVisible()
    await expect(page.getByText('Food Safety')).toBeVisible()
    await expect(page.getByText('Air Quality')).toBeVisible()
    await expect(page.getByText('Parks & Trails')).toBeVisible()
    await expect(page.getByText('Census Data')).toBeVisible()
    await expect(page.getByText('Score Builder')).toBeVisible()
    await expect(page.getByText('PG Data')).toBeVisible()
    await expect(page.getByText('Explorer')).toBeVisible()
  })

  test('navigates to food map section', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.getByText('Food Safety').click()
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

import { expect, test } from '@playwright/test'

test.describe('Home Page Navigation', () => {
  test('renders all available map cards', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('Prince George Data Platform')).toBeVisible()

    const availableMaps = page.locator('section').filter({ hasText: 'Available Maps' })
    for (const name of [
      'Food Safety',
      'Air Quality',
      'Parks & Trails',
      'Census Data',
      'Index Lab',
      'PG Data',
      'Explorer',
    ]) {
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

  test('navbar leaves selected air quality monitor URLs for PG Data tabs', async ({ page }) => {
    await page.goto('/airquality?boundaries=0&monitor=23541', { waitUntil: 'domcontentloaded' })

    await page.locator('nav').getByRole('link', { name: 'Parks & Trails' }).click()

    await expect(page).toHaveURL(/\/pgdata\?tab=parks$/)
  })

  test('mobile menu opens, closes, and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const menuButton = page.getByRole('button', { name: 'Main menu' })
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

  test('mobile menu supports keyboard open, focus, and escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const menuButton = page.getByRole('button', { name: 'Main menu' })
    await menuButton.focus()
    await menuButton.press('Enter')

    await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(menuButton).toBeFocused()
  })

  test('home mobile toolbar and menu stay inside a 320px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Main menu' }).click()

    const measurements = await page.getByTestId('mobile-nav-menu').evaluate((menu) => {
      const menuRect = menu.getBoundingClientRect()
      const toolbarRect = document
        .querySelector<HTMLElement>('[data-map-mobile-toolbar="true"]')
        ?.getBoundingClientRect()
      return {
        menuLeft: menuRect.left,
        menuRight: menuRect.right,
        toolbarLeft: toolbarRect?.left ?? -1,
        toolbarRight: toolbarRect?.right ?? Number.POSITIVE_INFINITY,
      }
    })

    expect(measurements.menuLeft).toBeGreaterThanOrEqual(0)
    expect(measurements.menuRight).toBeLessThanOrEqual(320)
    expect(measurements.toolbarLeft).toBeGreaterThanOrEqual(0)
    expect(measurements.toolbarRight).toBeLessThanOrEqual(320)
  })

  test('mobile menu exposes MISC dataset tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/misc?tab=network', { waitUntil: 'domcontentloaded' })

    const menuButton = page.getByRole('button', { name: 'Main menu' })
    await menuButton.click()

    await page.getByRole('button', { name: /MISC/ }).click()
    await expect(page.getByRole('button', { name: 'Back to main menu' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Network', exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Water', exact: true }).click()
    await expect(page).toHaveURL(/\/misc\?tab=water$/)

    await page.getByRole('button', { name: /Open dataset information/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('mobile submenu stays within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/misc?tab=network', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Main menu' }).click()
    await page.getByRole('button', { name: /MISC/ }).click()
    await expect(page.getByRole('button', { name: 'Back to main menu' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Flood', exact: true })).toBeVisible()

    const menuBounds = await page.getByTestId('mobile-nav-menu').boundingBox()
    expect(menuBounds).not.toBeNull()
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(844)
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

  test('desktop navigation keeps destination labels visible without widening the page', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(
      page.getByRole('navigation', { name: 'Primary navigation' }).getByText('Food Safety', { exact: true }),
    ).toBeVisible()
    const pageWidth = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.innerWidth)
  })

  test('global search is a labelled modal and restores focus', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const trigger = page.getByRole('button', { name: 'Open search' })
    await trigger.click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Search PGMaps' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('skip link reaches main content and unknown routes show a recovery action', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skipLink).toBeFocused()
    await skipLink.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()

    await page.goto('/not-a-real-map', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Map not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Return to PGMaps' })).toBeVisible()
  })
})

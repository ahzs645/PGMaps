import { expect, test } from '@playwright/test'

test.describe('Shared map persistence', () => {
  test('map canvas survives a client-side swap between food and air quality', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      // Ignore basemap/tile network failures (CDN fetch, TLS interception in
      // sandboxed CI), which depend on outbound network rather than app code.
      if (/AJAXError|cartocdn|Failed to fetch|Failed to load resource|net::ERR/i.test(text)) return
      errors.push(text)
    })

    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    // Neither the route nor the shared map provider should crash the boundary.
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    // MapLibre creates its canvas on construction (no tiles/data required).
    const canvas = page.locator('.maplibregl-canvas').first()
    await canvas.waitFor({ state: 'attached', timeout: 20_000 })
    await canvas.evaluate((el) => el.setAttribute('data-persist-probe', 'yes'))

    // Client-side navigation to the other mode (NOT a full page reload).
    await page.getByRole('link', { name: 'Air Quality' }).first().click()
    await expect(page).toHaveURL(/\/airquality/)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    // The exact same canvas DOM node is still present => the WebGL map instance
    // was reused, not torn down and rebuilt.
    await expect(page.locator('.maplibregl-canvas[data-persist-probe="yes"]')).toHaveCount(1)

    // And back again — still the same instance.
    await page.getByRole('link', { name: 'Food Safety' }).first().click()
    await expect(page).toHaveURL(/\/foodmap/)
    await expect(page.locator('.maplibregl-canvas[data-persist-probe="yes"]')).toHaveCount(1)

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([])
  })
})

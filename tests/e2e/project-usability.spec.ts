import { expect, test } from '@playwright/test'

test('mobile scrolly exposes the map and preserves the reading position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dev/projects/bc-big-tree-registry')
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Explore map', exact: true })
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Read story', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.elementFromPoint(150, 400)?.classList.contains('maplibregl-canvas'))).toBe(
    true,
  )
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true })
  await zoom.click()
  await page.getByRole('button', { name: 'Read story', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'B.C. BigTree Registry', exact: true })).toBeVisible()
})

test('small-phone slides start at the next heading', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/dev/projects/roadless-areas-bc-ecoregions')
  const first = page.getByRole('heading', { name: "Two thirds of B.C.'s landbase is roadless", includeHidden: true })
  await expect(first).toBeVisible()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  const scroller = first.locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")]')
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await page.getByRole('button', { name: 'Next scene', exact: true }).click()
  expect(await scroller.evaluate((node) => node.scrollTop)).toBe(0)
  await expect(
    page.getByRole('heading', { name: 'Twenty-seven ecoregions are more than half roadless' }),
  ).toBeInViewport()
})

test.describe('source recovery', () => {
  test.use({ serviceWorkers: 'block' })
  test('story failures show retry and recover without replacing the map', async ({ page }) => {
    let failing = true
    await page.route('**/regional_district_environmental_indicators.json', (route) =>
      failing ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue(),
    )
    await page.goto('/dev/projects/bc-population-distribution')
    await expect(page.getByRole('alert')).toContainText('Could not load')
    await page.locator('.maplibregl-canvas').evaluate((node) => node.setAttribute('data-original-map', 'yes'))
    failing = false
    await page.getByRole('button', { name: 'Retry layers', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: /Loading .*…/ })).toHaveCount(0, { timeout: 30000 })
    await expect(page.locator('.maplibregl-canvas')).toHaveAttribute('data-original-map', 'yes')
  })
})

test('mobile research controls and timeline respect filters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dev/projects/nechako-watershed-research-portal')
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true })
  await expect(zoom).toBeVisible({ timeout: 30000 })
  expect(
    await zoom.evaluate((node) => {
      const r = node.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === node
    }),
  ).toBe(true)
  await page.locator('[data-map-mobile-sheet-handle]').press('End')
  await page.getByPlaceholder('Search titles, authors, tags…').fill('zzzz-no-match-audit')
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await page.locator('[data-map-mobile-sheet-handle]').press('Home')
  await expect(page.getByText('0 publications', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Expand legend', exact: true }).click()
  const legend = page.getByText('Journal Articles', { exact: true }).locator('../..')
  await expect(legend).toContainText('0')
})

test('research lists expose remaining results and playback restores the static decade', async ({ page }) => {
  await page.goto('/dev/projects/nechako-watershed-research-portal')
  await page.getByRole('button', { name: /publications tagged to watershed region only/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Regional Publications' })
  await expect(dialog.locator('article')).toHaveCount(20)
  const firstTitle = await dialog.locator('article h3').first().textContent()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(dialog.locator('article')).toHaveCount(20)
  expect(await dialog.locator('article h3').first().textContent()).not.toBe(firstTitle)
  await page.keyboard.press('Escape')
  const locations = page.getByRole('navigation', { name: 'Location pages' })
  await locations.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(locations).toContainText('2 / 2')
  const decade = page.getByRole('combobox', { name: 'Filter by decade' })
  await decade.click()
  await page.getByRole('option', { name: /1990s/ }).click()
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(decade).toContainText('2020s')
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(decade).toContainText('1990s')
})

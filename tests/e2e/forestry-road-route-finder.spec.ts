import { expect, test, type Page } from '@playwright/test'
import { openRoadPanel } from './road-sidebar'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(240_000)

async function openTraining(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
}
const roads = (page: Page) => page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')
const results = (page: Page) => page.getByTestId('road-route-results')

async function compare(page: Page) {
  await page.getByTestId('road-compare-routes').click()
  await expect(results(page)).toBeVisible({ timeout: 180_000 })
}

test('compares the current road with designed routes and keeps only what is chosen', async ({ page }) => {
  await openTraining(page)
  const before = await roads(page).count()
  for (const goal of ['Gentlest', 'Fewest drainage issues'])
    await page.getByRole('group', { name: 'Route goals' }).getByRole('button', { name: goal, exact: true }).click()
  await expect(page.getByTestId('road-compare-routes')).toHaveText('Compare 2 routes')
  await compare(page)
  await expect(roads(page)).toHaveCount(before)
  await expect(results(page).locator('[data-route-row="current"]')).toContainText('Current road')
  // Cost prices the other lines too, so a line it shares with Shortest is one row.
  const cheapest = results(page).locator('[data-route-row="cost"]')
  await expect(cheapest).toContainText(/\$[\d,]+/)
  await expect(cheapest).toContainText(/\d+ drain/)

  await results(page).getByRole('button', { name: /^Use / }).first().click()
  await expect(roads(page)).toHaveCount(before + 1)
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true })).toHaveValue(/.+/)
  await expect(results(page)).toContainText('Added')

  // Changing a limit makes the prices old, and says so rather than leaving them on show.
  const limit = page.getByRole('spinbutton', { name: 'Grade limit %', exact: true })
  await limit.fill('11')
  await limit.press('Tab')
  await expect(results(page)).toHaveCount(0)
  await expect(page.getByTestId('road-route-finder')).toContainText('Compare again')
})

test('Cancel stops the comparison and changes nothing', async ({ page }) => {
  await openTraining(page)
  const before = await roads(page).count()
  await page.getByTestId('road-compare-routes').click()
  await page.getByRole('button', { name: 'Cancel route comparison', exact: true }).click()
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText('cancelled', {
    timeout: 60_000,
  })
  await expect(results(page)).toHaveCount(0)
  await expect(roads(page)).toHaveCount(before)
})

test('the review checklist reports the road and links to the next step', async ({ page }) => {
  await openTraining(page)
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  const checks = page.getByTestId('road-readiness-checks')
  await expect(checks.locator('[data-check="grade"]')).toContainText('Steepest')
  await checks.locator('[data-check="drainage"]').getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Drainage/ })).toBeVisible()
  await openRoadPanel(page, 'Limits & sampling')
  await expect(page.getByRole('spinbutton', { name: 'Station spacing (m)', exact: true })).toBeVisible()
})

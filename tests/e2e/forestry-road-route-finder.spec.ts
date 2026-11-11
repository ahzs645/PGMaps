import { openWorkbench } from './road-workbench'
import { expect, test, type Page } from '@playwright/test'
import { openRoadPanel } from './road-sidebar'
import { choose, optionEntries, optionLabels, selectedValue } from './styled-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(240_000)

async function openTraining(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
}
const roads = (page: Page) => page.getByRole('combobox', { name: 'Active road', exact: true })
const roadCount = async (page: Page) => (await optionLabels(roads(page))).length
const results = (page: Page) => page.getByTestId('road-route-results')

async function compare(page: Page) {
  await page.getByTestId('road-compare-routes').click()
  await expect(results(page)).toBeVisible({ timeout: 180_000 })
}

test('compares your road with designed routes, opens one and switches between them from any view', async ({ page }) => {
  await openTraining(page)
  const before = await roadCount(page)
  for (const goal of ['Gentlest', 'Fewest drainage issues'])
    await page.getByRole('group', { name: 'Route goals' }).getByRole('button', { name: goal, exact: true }).click()
  await expect(page.getByTestId('road-compare-routes')).toHaveText('Compare 2 routes')
  await compare(page)
  await expect.poll(() => roadCount(page)).toBe(before)
  await expect(results(page).locator('[data-route-row="current"]')).toContainText('Your road')
  // Every row is named for what it measured, so no goal appears twice and prices are explained.
  const designed = results(page).locator('[data-route-row]:not([data-route-row="current"])')
  const labels = await designed.locator('span.font-medium').allTextContents()
  const goals = labels.flatMap((label) => label.split(' · '))
  expect(new Set(goals).size).toBe(goals.length)
  await expect(designed.first()).toContainText(/\$[\d,]+ build \+ \$[\d,]+ drainage/)

  // Opening a road adds it and turns every chart to it; the original is one click back.
  const original = await selectedValue(page.getByRole('combobox', { name: 'Active road', exact: true }))
  const profileBefore = await page.getByTestId('road-profile-chart').innerHTML()
  await designed.first().click()
  await expect.poll(() => roadCount(page)).toBe(before + 1)
  await expect(designed.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(designed.first()).toContainText('Viewing')
  await expect.poll(() => page.getByTestId('road-profile-chart').innerHTML()).not.toBe(profileBefore)

  const switcher = page.getByTestId('road-switcher')
  await expect(switcher).toBeVisible()
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  await expect(switcher).toBeVisible()
  const viewing = switcher.getByRole('combobox', { name: 'Viewing road', exact: true })
  const firstRoad = (await optionEntries(viewing))[0].value
  await choose(viewing, firstRoad)
  await expect(viewing).toHaveAttribute('data-value', firstRoad)
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true })).toHaveAttribute('data-value', original)

  // Changing a limit makes the prices old, and says so rather than leaving them on show.
  const limit = page.getByRole('spinbutton', { name: 'Grade limit %', exact: true })
  await limit.fill('11')
  await limit.press('Tab')
  await expect(results(page)).toHaveCount(0)
  await expect(page.getByTestId('road-route-finder')).toContainText('Compare again')
})

test('the toast names the job, shows how far along it is and keeps Cancel beside it', async ({ page }) => {
  await openTraining(page)
  await page.getByTestId('road-compare-routes').click()
  const toast = page.getByTestId('workspace-toast-loading')
  await expect(toast).toContainText('Comparing routes')
  await expect(toast.getByRole('progressbar')).toBeVisible()
  await expect(toast).toContainText(/\d+ of \d+/)
  await toast.getByRole('button', { name: 'Cancel route comparison', exact: true }).click()
  await expect(toast).toHaveCount(0, { timeout: 60_000 })
})

test('Cancel stops the comparison and changes nothing', async ({ page }) => {
  await openTraining(page)
  const before = await roadCount(page)
  await page.getByTestId('road-compare-routes').click()
  await page.getByRole('button', { name: 'Cancel route comparison', exact: true }).click()
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText('cancelled', {
    timeout: 60_000,
  })
  await expect(results(page)).toHaveCount(0)
  await expect.poll(() => roadCount(page)).toBe(before)
})

test('the review checklist reports the road and links to the next step', async ({ page }) => {
  await openTraining(page)
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  const checks = page.getByTestId('road-readiness-checks')
  await expect(checks.locator('[data-check="grade"]')).toContainText('Steepest')
  // A check that was never run reads as not assessed, never as met.
  await expect(checks.locator('[data-check="drainage"]')).toHaveAttribute('data-state', 'not-assessed')
  await page.getByTestId('road-readiness-not-assessed-toggle').click()
  await checks.locator('[data-check="drainage"]').getByRole('button', { name: 'Run check', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Drainage/ })).toBeVisible()
  await openRoadPanel(page, 'Sampling')
  await expect(page.getByRole('spinbutton', { name: 'Station spacing (m)', exact: true })).toBeVisible()
})

test('each failing check can be cleared from where it points', async ({ page }) => {
  await openTraining(page)
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  const checks = page.getByTestId('road-readiness-checks')
  const crossing = checks.locator('[data-check="crossing-structures"]')
  await expect(crossing).toContainText(/ha(s|ve) no structure/)
  await crossing.getByRole('button', { name: 'Add culvert', exact: true }).click()
  await page
    .getByRole('button', { name: /^Add culvert at (?!station)/ })
    .first()
    .click()
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  // A culvert dropped in at its starting size is a structure, but not yet a sized one.
  await expect(crossing).not.toContainText('no structure')
  await expect(crossing).toContainText('not sized')
  const price = checks.locator('[data-check="structure-costs"]')
  await expect(price).toContainText('no price')
  await price.getByRole('button', { name: 'Set price', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Culvert 1 installed $/m', exact: true }).fill('450')
  await page.getByRole('spinbutton', { name: 'Culvert 1 installed $/m', exact: true }).press('Tab')
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  await expect(price).not.toContainText('no price')

  const rates = checks.locator('[data-check="rates"]')
  await expect(rates).toContainText('Still the starting value')
  await rates.getByRole('button', { name: 'Enter rates', exact: true }).click()
  for (const [label, value] of [
    ['Cut ($/m³)', '9'],
    ['Fill ($/m³)', '7'],
    ['Surfacing ($/m³)', '31'],
    ['Clearing ($/m²)', '1.4'],
  ]) {
    const field = page.getByRole('spinbutton', { name: label, exact: true })
    await field.fill(value)
    await field.press('Tab')
  }
  await expect(rates).toContainText('Every base rate with a quantity has been entered')
  await expect(rates).toHaveAttribute('data-state', 'met')
  await expect(rates.getByRole('button', { name: 'Enter rates', exact: true })).toHaveCount(0)
})

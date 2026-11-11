import { openWorkbench } from './road-workbench'
import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { choose } from './road-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })

async function open(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
}
const stream = (page: Page) => page.getByTestId('road-streams').getByRole('button', { name: /Synthetic drainage/ })
const suggestion = (page: Page) => page.getByTestId('road-stream-suggestion')

test('a stream goes from unassessed to a reviewed class, and survives a reload', async ({ page }) => {
  await open(page)
  await expect(stream(page)).toContainText('No class · unassessed')
  await expect(stream(page)).toContainText(/\d road crossing/)
  await stream(page).click()

  // Width alone leaves the class open, and shows both outcomes rather than guessing the lower one.
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).fill('2.4')
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).press('Tab')
  await expect(suggestion(page)).toContainText('No class yet')
  await expect(suggestion(page)).toContainText('S3 if fish-bearing or in a community watershed, otherwise S6')
  await expect(suggestion(page)).toContainText('Outstanding: determine whether it is a fish stream')

  await choose(page.getByRole('combobox', { name: 'Fish stream' }), 'presumed')
  await expect(suggestion(page)).toContainText('S3')
  await expect(suggestion(page)).toContainText('20 m reserve + 20 m management each side')
  await expect(suggestion(page)).toContainText('Provisional')

  await page.getByText('Record a review', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Assessor' }).fill('A. Reviewer')
  await page.getByRole('button', { name: 'Record review', exact: true }).click()
  await expect(suggestion(page)).toContainText('Reviewed')

  // New evidence reopens the question rather than leaving an old decision standing.
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).fill('6')
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).press('Tab')
  await expect(suggestion(page)).toContainText('Needs review')
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).fill('2.4')
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).press('Tab')
  await expect(suggestion(page)).toContainText('Reviewed')

  // Saving to a file and opening it in a fresh page is how the evidence has to travel.
  await page.getByRole('button', { name: 'Back to streams', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const file = await (await pending).path()
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()

  await open(page)
  await expect(stream(page)).toContainText('No class · unassessed')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'streams.road.json',
    mimeType: 'application/json',
    buffer: fs.readFileSync(file),
  })
  await expect(stream(page)).toContainText('S3 · reviewed · 2.4 m')
  await stream(page).click()
  await expect(suggestion(page)).toContainText('Reviewed')
})

test('a stream row opens its assessment, and its profile is one action inside it', async ({ page }) => {
  await open(page)
  await stream(page).click()
  await expect(page.getByTestId('road-stream-details')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Terrain profile · elevation & distance', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'View terrain profile', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Terrain profile · elevation & distance', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to streams', exact: true }).click()
  await expect(page.getByTestId('road-streams')).toBeVisible()
})

test('constraints say what they do, and a cost does not read as permission', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /^Constraints/ }).click()
  const list = page.getByTestId('road-constraints')
  await expect(list).toContainText('Excluded from route search')
  await choose(list.getByRole('combobox').first(), 'additional-cost')
  const field = list.getByRole('spinbutton').first()
  await field.fill('250')
  await field.press('Tab')
  await expect(list).toContainText('Additional cost, $250/m')
})

test('riparian screening keeps unresolved evidence visible and condition reviews become stale', async ({ page }) => {
  await open(page)
  await stream(page).click()
  // A narrow channel can still have a wide active floodplain; the average is always available.
  await expect(page.getByRole('spinbutton', { name: '1 km average width (m)', exact: true })).toBeVisible()
  await page.getByText('Riparian map & route treatment', { exact: true }).click()
  const policy = page.getByTestId('stream-riparian-policy')
  await expect(policy).toContainText('100 m horizontal screening allowance')
  await expect(policy).toContainText('not surveyed legal boundaries')
  await expect(policy).toContainText('Blocked: conditional review pending')
  await policy.getByText('Review conditional use', { exact: true }).click()
  await expect(policy.getByRole('button', { name: 'Record conditional review', exact: true })).toBeDisabled()
  await policy.getByRole('textbox', { name: 'Condition reviewer', exact: true }).fill('Planning reviewer')
  await policy
    .getByRole('textbox', { name: 'Condition review evidence', exact: true })
    .fill('Crossing location and preliminary protection measures checked for this planning comparison.')
  await policy.getByRole('button', { name: 'Record conditional review', exact: true }).click()
  await expect(policy).toContainText('Conditional planning review current')
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).fill('2.4')
  await page.getByRole('spinbutton', { name: 'Channel width (m)', exact: true }).press('Tab')
  await expect(policy).toContainText('Blocked: conditional review stale')
})

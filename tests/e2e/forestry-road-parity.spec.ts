import { expect, test, type Locator, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  return errors
}
async function download(page: Page, button: Locator) {
  const pending = page.waitForEvent('download')
  await button.click()
  const result = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await result.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { name: result.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') }
}
const estimate = async (page: Page) =>
  Number(
    (await page
      .getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true })
      .locator('xpath=..')
      .locator('dd')
      .textContent())!.replace(/[$,]/g, ''),
  )
const roads = (page: Page) => page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')

test('vertical standards, control points and the profile optimizer', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByLabel('Min sag K', { exact: true }).fill('4')
  await page.getByLabel('Min crest K', { exact: true }).fill('4')
  await page.getByLabel('Min sag K', { exact: true }).press('Tab')
  // A control at the selected station draws on the profile with its tolerance.
  await page.getByRole('button', { name: 'Control at selected station', exact: true }).click()
  await expect(page.getByTestId('road-profile-chart').locator('[data-vertical-control]')).toHaveCount(1)

  const before = await estimate(page)
  const count = await roads(page).count()
  await page.getByLabel('Search ± (m)', { exact: true }).fill('12')
  await page.getByLabel('Search ± (m)', { exact: true }).press('Tab')
  await page.getByLabel('Tie both ends to ground', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Optimize profile (K 4)', exact: true }).click()
  await expect(roads(page)).toHaveCount(count + 1)
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true })).toHaveText(/optimized profile/)
  await expect.poll(() => estimate(page)).toBeLessThan(before)
  // The optimized profile meets the standards and the control it was given.
  await expect(page.getByTestId('road-vertical-checks-pass')).toBeVisible()
  await expect(page.getByTestId('road-vertical-checks')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('bulk curves, ranked route alternatives and design exports', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByRole('button', { name: 'Best fit every corner', exact: true }).click()
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText(/Set \d+ curves?/)

  const count = await roads(page).count()
  await page.getByLabel('Alternatives', { exact: true }).fill('3')
  await page.getByLabel('Alternatives', { exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Suggest terrain-cost alternatives', exact: true }).click()
  await expect.poll(() => roads(page).count()).toBeGreaterThan(count + 1)
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true })).toHaveText(/terrain-cost #1 \(\$/)
  await page.getByRole('combobox', { name: 'Active road', exact: true }).selectOption({ index: count - 1 })

  await page.getByRole('tablist', { name: 'Road workflow', exact: true }).getByRole('tab', { name: 'Files' }).click()
  const xml = await download(page, page.getByRole('button', { name: 'LandXML', exact: true }))
  expect(xml.name).toMatch(/\.xml$/)
  expect(xml.text).toContain('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"')
  expect(xml.text).toMatch(/<CoordinateSystem epsgCode="326\d\d"/)
  expect(xml.text).toContain('<CrossSect sta="0.000">')
  const stakes = await download(page, page.getByRole('button', { name: 'Stakeout CSV', exact: true }))
  expect(stakes.text.split('\n')[0]).toBe(
    'point,station_m,code,offset_m,easting,northing,elevation_m,ground_m,cut_fill_m,epsg',
  )
  expect(stakes.text).toContain(',left-catch,')
  const report = await download(page, page.getByRole('button', { name: 'Print report', exact: true }))
  expect(report.text).toContain('Cross-sections · every 20 m')
  expect(errors).toEqual([])
})

test('station table interval and columns, saved layouts and cost status', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: 'Stations', exact: true }).click()
  const table = page.getByTestId('road-station-table')
  const all = await table.locator('tbody tr').count()
  await page.getByLabel('Station table reporting interval', { exact: true }).selectOption('100')
  await expect.poll(() => table.locator('tbody tr').count()).toBeLessThan(all / 5)
  await expect(table.locator('tfoot')).toContainText('Cum. tot.')
  await page.getByText('Columns', { exact: true }).click()
  await page.getByRole('checkbox', { name: 'Mass', exact: true }).check()
  await expect(table.locator('thead')).toContainText('Mass')

  const picker = page.getByTestId('road-workspace-header').getByRole('combobox', { name: 'Road view layout' })
  await picker.click()
  await page.getByRole('option', { name: 'Save or manage layouts…', exact: true }).click()
  const dialog = page.getByTestId('road-layouts-dialog')
  await dialog.getByLabel('Name for the current layout').fill('Wide plan')
  await dialog.getByRole('button', { name: 'Save current layout', exact: true }).click()
  await expect(picker).toHaveText(/Wide plan/)
  await page.reload()
  await expect(page.getByTestId('road-profile-chart')).toBeVisible()
  await expect(picker).toHaveText(/Wide plan/)

  await page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true }).click()
  await expect(page.getByTestId('road-cost-status')).toContainText(/Cost status: current.*process time \d/)
  await expect(page.getByTestId('road-haul-cost-graph')).toHaveCount(0)
  expect(errors).toEqual([])
})

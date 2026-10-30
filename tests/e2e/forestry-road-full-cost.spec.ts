import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 20_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

const IDS = {
  a: 'training-full-cost-short-a',
  b: 'training-full-cost-long-b',
  armA: 'training-full-cost-arm-a',
  armB: 'training-full-cost-arm-b',
}

async function loadScenario(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await page
    .getByRole('button', { name: 'Load Training · connected access, gravel and condition', exact: true })
    .click()
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true, includeHidden: true })).toHaveValue(IDS.a)
}

async function comparison(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Complete route cost comparison', exact: true })
  if (!(await dialog.isVisible())) {
    await page
      .getByRole('tablist', { name: 'Road workflow', exact: true })
      .getByRole('tab', { name: 'Design', exact: true })
      .click()
    await page.getByRole('button', { name: 'Compare complete route costs', exact: true }).click()
  }
  await expect(dialog).toBeVisible()
  return dialog
}

async function calculate(dialog: Locator) {
  const button = dialog.getByRole('button', { name: 'Calculate route comparison', exact: true })
  await button.click()
  await expect(button).toBeEnabled({ timeout: 120_000 })
  await expect(dialog.getByTestId('full-cost-results')).toBeVisible()
  await expect(
    dialog.getByText('Inputs changed. Calculate again; previous results cannot be used.', { exact: true }),
  ).toHaveCount(0)
}

const candidate = (dialog: Locator, id: string) => dialog.getByTestId(`full-cost-candidate-${id}`)
const winner = (dialog: Locator) => dialog.locator('[data-testid^="full-cost-candidate-"][data-recommended="true"]')
const tab = (dialog: Locator, name: string) =>
  dialog.getByRole('tablist', { name: 'Complete cost workflow', exact: true }).getByRole('tab', { name, exact: true })
async function close(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
}

async function exportProject(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await close(page.getByRole('dialog', { name: 'Save & export', exact: true }))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
}

async function reviewRoad(page: Page, id: string) {
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  const roads = page.getByTestId('road-existing-roads')
  await roads.getByRole('combobox', { name: 'Review existing road', exact: true }).selectOption(id)
  return roads
}

async function networkEditor(roads: Locator) {
  const toggle = roads.getByRole('button', { name: /^Connected-network access & costs/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  return roads.getByTestId('road-network-evidence')
}

async function expectNoAdoption(dialog: Locator) {
  await expect(winner(dialog)).toHaveCount(0)
  const buttons = dialog.getByTestId('full-cost-results').getByRole('button', { name: /^Use / })
  expect(await buttons.count()).toBeGreaterThan(0)
  for (const button of await buttons.all()) await expect(button).toBeDisabled()
}

test('network hauling changes the chosen horizontal road and adopted totals round-trip with every input', async ({
  page,
}) => {
  await loadScenario(page)
  const initial = await exportProject(page)
  const dialog = await comparison(page)
  await calculate(dialog)
  await expect(winner(dialog)).toContainText('Short connector A')
  await tab(dialog, 'Setup').click()
  const rate = dialog.getByRole('spinbutton', { name: 'Loaded haul ($/m³·km)', exact: true })
  await rate.fill('40')
  await expect(rate).toBeFocused()
  await expect(
    dialog.getByText('Inputs changed. Calculate again; previous results cannot be used.', { exact: true }),
  ).toBeVisible()
  await tab(dialog, 'Results').click()
  await expect(candidate(dialog, IDS.a).getByRole('button', { name: /^Use / })).toBeDisabled()
  await calculate(dialog)
  await expect(winner(dialog)).toContainText('Long connector B')
  await expect(candidate(dialog, IDS.b)).toContainText('Loaded/return delivery')
  const quotedCost = await candidate(dialog, IDS.b).locator('strong').first().innerText()
  await page.screenshot({ path: '/tmp/full-cost-results.png' })
  await candidate(dialog, IDS.b)
    .getByRole('button', { name: /^Preview / })
    .click()
  await expect(page.getByTestId('full-cost-map-preview')).toBeVisible()
  await expect(page.getByTestId('road-profile-summary')).toContainText('400 m')
  await expect(page.getByRole('term').filter({ hasText: 'Candidate complete cost' }).locator('..')).toContainText(
    quotedCost,
  )
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true, includeHidden: true })).toHaveValue(IDS.a)
  await page.screenshot({ path: '/tmp/full-cost-preview.png' })
  await page.getByRole('button', { name: 'Return to comparison', exact: true }).click()
  await expect(dialog).toBeVisible()
  await candidate(dialog, IDS.b).getByRole('button', { name: /^Use / }).click()
  await expect(dialog).not.toBeVisible()
  const summary = page.getByTestId('full-cost-record-summary').first()
  await expect(summary).toHaveAttribute('data-current', 'true')
  await expect(summary).toContainText('Complete access cost')
  const saved = await exportProject(page)
  const adopted = saved.alignments.find((alignment) => alignment.id === saved.activeAlignmentId)!
  const chosen = initial.alignments.find((alignment) => alignment.id === IDS.b)!
  expect(adopted.points).toEqual(chosen.points)
  expect(adopted.vertical).toEqual(chosen.vertical)
  expect(adopted.points.at(-1)!.coordinate).toEqual(
    initial.alignments.find((alignment) => alignment.id === IDS.b)!.points.at(-1)!.coordinate,
  )
  expect(adopted.fullCostRecord!.candidateName).toContain('Long connector B')
  expect(adopted.fullCostRecord!.allocations.length).toBeGreaterThan(0)
  expect(adopted.fullCostRecord!.accessPath.edgeIds.length).toBeGreaterThan(0)
  expect(adopted.fullCostRecord!.accessReturnPath.edgeIds.length).toBeGreaterThan(0)
  expect(saved.totalCostPlanning).toEqual({ ...initial.totalCostPlanning!, haulRatePerM3Km: 40 })
  expect(saved.context).toEqual(initial.context)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'full-cost.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  })
  await expect(summary).toHaveAttribute('data-current', 'true')
  const reopened = await exportProject(page)
  expect(reopened).toEqual(saved)
  const again = await comparison(page)
  await tab(again, 'Sources').click()
  await again.getByRole('spinbutton', { name: 'Source acquisition/disposal ($/m³)', exact: true }).fill('5')
  await expect(summary).toHaveAttribute('data-current', 'false')
  await close(again)
  await expect(summary).toContainText('Saved comparison is stale')
})

test('a closed bridge or road access blocks network reuse rather than granting a proximity shortcut', async ({
  page,
}) => {
  await loadScenario(page)
  let dialog = await comparison(page)
  await calculate(dialog)
  await expect(candidate(dialog, IDS.a)).toHaveAttribute('data-status', 'feasible')
  await close(dialog)
  let roads = await reviewRoad(page, IDS.armA)
  let network = await networkEditor(roads)
  await network.getByRole('combobox', { name: 'Bridge / structure status', exact: true }).selectOption('closed')
  await expect(roads.getByRole('combobox', { name: 'Planning condition', exact: true })).toHaveValue('serviceable')
  dialog = await comparison(page)
  await calculate(dialog)
  await expect(candidate(dialog, IDS.a)).toHaveAttribute('data-status', 'infeasible')
  await expect(candidate(dialog, IDS.a).getByRole('button', { name: /^Use / })).toBeDisabled()
  await expect(candidate(dialog, IDS.b)).toHaveAttribute('data-status', 'feasible')
  await close(dialog)
  roads = await reviewRoad(page, IDS.armB)
  network = await networkEditor(roads)
  await network.getByRole('combobox', { name: 'Road access', exact: true }).selectOption('closed')
  dialog = await comparison(page)
  await calculate(dialog)
  await expectNoAdoption(dialog)
  await expect(dialog.getByTestId('full-cost-results')).toContainText('Synthetic B arm')
})

test('dated evidence expires eligibility without fabricating or overwriting the entered road condition', async ({
  page,
}) => {
  await loadScenario(page)
  let roads = await reviewRoad(page, IDS.armA)
  const estimate = roads.getByTestId('road-condition-estimate')
  await expect(estimate).toHaveAttribute('data-estimated-condition', 'serviceable')
  await expect(estimate).toHaveAttribute('data-evidence-basis', 'inspection')
  await roads.getByLabel('Assess condition as of', { exact: true }).fill('2028-01-01')
  await expect(estimate).toHaveAttribute('data-estimated-condition', 'unknown')
  await expect(roads.getByRole('combobox', { name: 'Planning condition', exact: true })).toHaveValue('serviceable')
  await expect(roads.getByRole('combobox', { name: 'Condition evidence', exact: true })).toHaveValue('assumed')
  const dialog = await comparison(page)
  await calculate(dialog)
  await expectNoAdoption(dialog)
  await expect(dialog.getByTestId('full-cost-results')).toContainText(/current|stale|evidence/i)
  await tab(dialog, 'Setup').click()
  await dialog.getByLabel('Planning assessment date', { exact: true }).fill('2026-10-28')
  await calculate(dialog)
  await expect(candidate(dialog, IDS.a)).toHaveAttribute('data-status', 'feasible')
  await close(dialog)
  roads = await reviewRoad(page, IDS.armA)
  await expect(roads.getByTestId('road-condition-estimate')).toHaveAttribute('data-estimated-condition', 'serviceable')
  await expect(roads.getByRole('combobox', { name: 'Condition evidence', exact: true })).toHaveValue('assumed')
})

test('final prism and directional-grade failures cannot be adopted even with priced connected access', async ({
  page,
}) => {
  await loadScenario(page)
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await page.getByRole('button', { name: 'Import streams / constraints', exact: true }).click()
  const at = (x: number, y: number) => [-122.72 + x / (111195 * Math.cos((53.89 * Math.PI) / 180)), 53.89 + y / 111195]
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'fill-toe-exclusion.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Toe exclusion', kind: 'avoid' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [45, -3.8],
                  [55, -3.8],
                  [55, -3.02],
                  [45, -3.02],
                  [45, -3.8],
                ].map(([x, y]) => at(x, y)),
              ],
            },
          },
        ],
      }),
    ),
  })
  const dialog = await comparison(page)
  await calculate(dialog)
  await expect(candidate(dialog, IDS.a)).toHaveAttribute('data-status', 'infeasible')
  await expect(candidate(dialog, IDS.a)).toContainText(/footprint|prism|exclusion|daylight/i)
  await expect(candidate(dialog, IDS.a).getByRole('button', { name: /^Use / })).toBeDisabled()
  await tab(dialog, 'Setup').click()
  await dialog.getByRole('spinbutton', { name: 'Loaded adverse grade limit (%)', exact: true }).fill('0.1')
  await dialog.getByRole('spinbutton', { name: 'Loaded favourable grade limit (%)', exact: true }).fill('0.1')
  await calculate(dialog)
  await expectNoAdoption(dialog)
  await expect(candidate(dialog, IDS.b)).toContainText(/grade/i)
})

test('phone complete-cost setup, sources, footer, preview and adoption remain reachable without horizontal overflow', async ({
  page,
}) => {
  await loadScenario(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.click()
  const dialog = await comparison(page)
  const expectNoOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
  await expectNoOverflow()
  await expect(dialog.getByLabel('Planning assessment date', { exact: true })).toHaveValue('2026-10-28')
  await tab(dialog, 'Sources').click()
  const capacity = dialog.getByRole('spinbutton', { name: 'Source capacity (m³)', exact: true })
  await capacity.scrollIntoViewIfNeeded()
  await expect(capacity).toHaveValue('100000')
  const longitude = dialog.getByRole('spinbutton', { name: 'Source longitude', exact: true })
  const originalLongitude = await longitude.inputValue()
  await longitude.fill(String(Number(originalLongitude) + 0.000001))
  const access = dialog.getByRole('checkbox', { name: /Supply\/disposal access confirmed/ })
  const quality = dialog.getByRole('checkbox', { name: /Material suitability or disposal acceptance confirmed/ })
  await expect(access).not.toBeChecked()
  await expect(quality).not.toBeChecked()
  await calculate(dialog)
  await expectNoAdoption(dialog)
  await tab(dialog, 'Sources').click()
  await longitude.fill(originalLongitude)
  await access.check()
  await quality.check()
  await expectNoOverflow()
  const calculateButton = dialog.getByRole('button', { name: 'Calculate route comparison', exact: true })
  const footerBox = await calculateButton.boundingBox()
  expect(footerBox).not.toBeNull()
  expect(footerBox!.y).toBeGreaterThanOrEqual(0)
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(844)
  await calculate(dialog)
  await expectNoOverflow()
  for (const name of ['Setup', 'Sources', 'Results']) await expect(tab(dialog, name)).toBeInViewport()
  await page.screenshot({ path: '/tmp/full-cost-phone-results.png' })
  await candidate(dialog, IDS.a)
    .getByRole('button', { name: /^Preview / })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('full-cost-map-preview')).toBeVisible()
  await page.getByRole('button', { name: 'Return to comparison', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expectNoOverflow()
  await candidate(dialog, IDS.a).getByRole('button', { name: /^Use / }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('full-cost-record-summary').first()).toHaveAttribute('data-current', 'true')
})

import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Profile', exact: true }).click()
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Plan', exact: true }).click()
  return errors
}

async function downloadJson<T>(page: Page, button: Locator): Promise<T> {
  const pending = page.waitForEvent('download')
  await button.click()
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

async function saveProject(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const project = await downloadJson<RoadProject>(
    page,
    page.getByRole('button', { name: 'Save project JSON', exact: true }),
  )
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return project
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function openCosts(page: Page) {
  await page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Covered estimate', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

test('rate presets preserve shrink and BC comparisons leave the itemized estimate unchanged', async ({
  page,
}, testInfo) => {
  const errors = await prepare(page)
  const project = await saveProject(page)
  const road = project.alignments.find((item) => item.id === project.activeAlignmentId)!
  // A short ground-following road has complete sections, but still has unreviewed cost scope.
  road.points = road.points.slice(0, 2).map((point) => ({ ...point, radiusM: 0 }))
  road.vertical = []
  road.overrides = []
  project.alignments = [road]
  project.context = []
  project.cables = []
  project.settings = {
    ...project.settings,
    crossSectionHalfWidth: 100,
    cutRate: 22,
    fillRate: 11,
    surfacingRate: 50,
    clearingRate: 2,
    shrinkFactor: 0.85,
  }
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'complete-quantity-cost-review.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByLabel('Active road').locator('option')).toHaveCount(1)

  const dialog = await openCosts(page)
  await expect(dialog).toContainText('100.0% of the road has complete sections')
  await expect(page.getByTestId('road-cost-status')).toContainText('section coverage complete')
  await expect(page.getByTestId('road-cost-readiness')).toContainText('Cost scope and pricing need review')
  await expect(page.getByTestId('road-cost-readiness')).toContainText('does not measure cost confidence')
  await page.screenshot({ path: testInfo.outputPath('desktop-estimate-review.png') })
  const customTotal = await page.getByTestId('road-cost-total').innerText()
  await choose(page, 'Rate preset', 'PG Maps placeholder rates')
  for (const [label, value] of [
    ['Cut rate', '12'],
    ['Fill rate', '8'],
    ['Surfacing rate', '40'],
    ['Clearing rate', '1.5'],
  ])
    await expect(page.getByRole('spinbutton', { name: label, exact: true })).toHaveValue(value)
  await expect(page.getByTestId('road-cost-total')).not.toHaveText(customTotal)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const priced = await saveProject(page)
  expect(priced.settings).toEqual({
    ...project.settings,
    cutRate: 12,
    fillRate: 8,
    surfacingRate: 40,
    clearingRate: 1.5,
  })
  expect(priced.settings.shrinkFactor).toBe(0.85)
  expect(priced.alignments).toEqual(project.alignments)

  await openCosts(page)
  const coveredTotal = await page.getByTestId('road-cost-total').innerText()
  await page.getByTestId('road-bc-cost-toggle').click()
  await page.getByRole('combobox', { name: 'BC natural resource region', exact: true }).click()
  await expect(page.getByRole('option')).toHaveText([
    'Choose a region',
    'Cariboo',
    'Kootenay-Boundary',
    'Northeast',
    'Omineca',
    'Skeena',
    'Thompson-Okanagan',
    'South Coast',
    'West Coast',
  ])
  await page.getByRole('option', { name: 'Cariboo', exact: true }).click()
  const interiorDownload = page.getByRole('button', { name: 'Download Interior comparison JSON', exact: true })
  await expect(interiorDownload).toBeDisabled()
  await choose(page, 'Interior road group', '4 · Cariboo supply blocks / Prince George G–H')
  await page.getByRole('spinbutton', { name: 'Uphill side slope (%)', exact: true }).fill('30')
  await page.getByRole('spinbutton', { name: 'Section rock (%)', exact: true }).fill('20')
  await choose(page, 'Interior road type', 'Long-term · raised subgrade and ditch')
  await choose(page, 'Verified BEC zone', 'ESSF')
  await choose(page, 'Absolute soil moisture', 'Wet')
  await page.getByRole('spinbutton', { name: 'Homogeneous section length (m, optional)', exact: true }).fill('1200')
  await expect(interiorDownload).toBeDisabled()
  await page.getByRole('button', { name: 'Confirm Interior benchmark applicability reviewed', exact: true }).click()
  await expect(page.getByTestId('road-interior-benchmark-result')).toContainText('$25,347 CAD/km · subgrade')
  const interior = await downloadJson<{
    schema: string
    result: { subgradePerKm: number; subgradeTotal: number }
  }>(page, interiorDownload)
  expect(interior.schema).toBe('pgmaps-bc-interior-cost-comparison-v1')
  expect(interior.result.subgradePerKm).toBe(25347)
  expect(interior.result.subgradeTotal).toBeCloseTo(30416.4, 2)
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)
  await page.getByTestId('road-interior-benchmark-result').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('desktop-interior-comparison.png') })

  await choose(page, 'BC natural resource region', 'West Coast')
  const coastDownload = page.getByRole('button', { name: 'Download Coast comparison JSON', exact: true })
  await expect(coastDownload).toBeDisabled()
  await choose(page, 'Coast construction category', 'MRK · Blasted rock face 1.51–3.00 m')
  await choose(page, 'Coast rock hardness', 'Hard · RMC 5')
  await page
    .getByRole('spinbutton', { name: 'Eligible isolated timber volume fraction (0–1)', exact: true })
    .fill('0.5')
  await page.getByRole('button', { name: 'Coast tabular-road eligibility reviewed', exact: true }).click()
  await expect(coastDownload).toBeDisabled()
  await page.getByRole('button', { name: 'CAM isolation eligibility reviewed', exact: true }).click()
  // Other eligibility confirmations cannot silently treat an unreviewed origin as a zero addition.
  await expect(coastDownload).toBeDisabled()
  await expect(page.getByTestId('road-coast-benchmark-result')).toContainText('Choose a point-of-origin area')
  await expect(page.getByTestId('road-coast-benchmark-result')).not.toContainText('CAD/km')
  await choose(page, 'Coast point-of-origin area', 'Graham Island (GRIS) · +$7,548/km')
  await expect(page.getByTestId('road-coast-benchmark-result')).toContainText('$155,533 CAD/km')
  const coast = await downloadJson<{
    schema: string
    inputs: { isolationFraction: number; pointOfOrigin: string }
    result: { unitCostCadPerKm: number }
  }>(page, coastDownload)
  expect(coast.schema).toBe('pgmaps-bc-coast-cost-comparison-v1')
  expect(coast.inputs.isolationFraction).toBe(0.5)
  expect(coast.inputs.pointOfOrigin).toBe('GRIS')
  expect(coast.result.unitCostCadPerKm).toBe(155532.5)
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)
  await page.getByTestId('road-coast-benchmark-result').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('desktop-coast-comparison.png') })

  // Quote conversions use their explicit volume basis and remain temporary comparison inputs.
  await page.getByRole('button', { name: 'Convert quotes and calculate unit rates', exact: true }).click()
  await choose(page, 'Material quote unit', 'CAD per tonne')
  await page.getByRole('spinbutton', { name: 'Quoted price (CAD/tonne)', exact: true }).fill('13')
  await page.getByRole('spinbutton', { name: 'Tonnes required per compacted m³', exact: true }).fill('2')
  await expect(page.getByTestId('road-material-unit-rate')).toHaveText('26.00 CAD/compacted m³')
  await page.getByRole('spinbutton', { name: 'All-in truck rate (CAD/hour)', exact: true }).fill('160')
  await page.getByRole('spinbutton', { name: 'Complete truck cycle (minutes)', exact: true }).fill('60')
  await page.getByRole('spinbutton', { name: 'Delivered payload (compacted m³)', exact: true }).fill('10')
  await expect(page.getByTestId('road-truck-unit-rate')).toHaveText('16.00 CAD/compacted m³')
  await page.getByRole('spinbutton', { name: 'All-in crew rate (CAD/hour)', exact: true }).fill('300')
  await page.getByRole('spinbutton', { name: 'Net production (bank m³/charged hour)', exact: true }).fill('25')
  await expect(page.getByTestId('road-equipment-unit-rate')).toHaveText('12.00 CAD/bank m³')
  await page.getByTestId('road-equipment-unit-rate').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('desktop-unit-rates.png') })
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect(await saveProject(page)).toEqual(priced)
  expect(errors).toEqual([])
})

test('phone cost references scroll to an eligible Coast comparison and download without page overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await prepare(page)
  const dialog = await openCosts(page)
  const coveredTotal = await page.getByTestId('road-cost-total').innerText()
  await expect
    .poll(() => page.getByTestId('road-rate-source').evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('phone-estimate-review.png') })
  await page.getByTestId('road-bc-cost-toggle').click()
  await choose(page, 'BC natural resource region', 'West Coast')
  await choose(page, 'Coast construction category', 'OMLB · Other material — local ballast')
  await choose(page, 'Coast rock hardness', 'Soft/medium · RMC 1–4')
  await page.getByRole('button', { name: 'Coast tabular-road eligibility reviewed', exact: true }).click()
  const result = page.getByTestId('road-coast-benchmark-result')
  const download = page.getByRole('button', { name: 'Download Coast comparison JSON', exact: true })
  await expect(download).toBeDisabled()
  await expect(result).toContainText('Choose a point-of-origin area')
  await expect(result).not.toContainText('CAD/km')
  await choose(page, 'Coast point-of-origin area', 'Reviewed · no eligible origin addition')
  await result.scrollIntoViewIfNeeded()
  await expect(result).toContainText('$72,601 CAD/km')
  await expect(result).toBeInViewport()
  await download.scrollIntoViewIfNeeded()
  await expect(download).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('phone-coast-comparison.png') })
  const box = (await download.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const comparison = await downloadJson<{
    inputs: { pointOfOrigin: null; pointOfOriginReviewed: boolean }
    result: { unitCostCadPerKm: number }
  }>(page, download)
  expect(comparison.inputs.pointOfOrigin).toBeNull()
  expect(comparison.inputs.pointOfOriginReviewed).toBe(true)
  expect(comparison.result.unitCostCadPerKm).toBe(72601)
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(errors).toEqual([])
})

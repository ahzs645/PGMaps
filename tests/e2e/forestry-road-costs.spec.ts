import { openWorkbench } from './road-workbench'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { choose, optionLabels } from './styled-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
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
  const dialog = page.getByRole('dialog', { name: 'Save & export', exact: true })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  return project
}

async function chooseOption(page: Page, label: string, option: string) {
  await choose(page.getByRole('combobox', { name: label, exact: true }), { label: option })
}

async function openCosts(page: Page) {
  // On a phone the road summary starts folded.
  const showSummary = page.getByRole('button', { name: 'Show road summary', exact: true })
  if (await showSummary.isVisible()) await showSummary.click()
  await page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Covered estimate', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

test('rate presets preserve shrink and BC comparisons leave the itemized estimate unchanged', async ({
  page,
}, testInfo) => {
  // Several large software-rendered captures share this journey; control assertions retain 15 s.
  testInfo.setTimeout(240_000)
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
  await expect.poll(async () => (await optionLabels(page.getByLabel('Active road'))).length).toBe(1)

  const dialog = await openCosts(page)
  const table = dialog.getByTestId('road-cost-calculation')
  await expect(table.locator('tfoot').getByTestId('road-cost-coverage')).toHaveText('100.0% complete sections')
  await expect(dialog).not.toContainText('Recalculated on every edit')
  // The estimate's caveats sit behind the method tip; there is no separate review dialog.
  await expect(page.getByTestId('road-cost-review-bar')).toHaveCount(0)
  const method = page.getByRole('button', { name: 'How amounts are calculated', exact: true })
  await method.click()
  await expect(page.getByRole('tooltip')).toContainText('not cost confidence')
  await page.screenshot({
    path: testInfo.outputPath('desktop-estimate-review.png'),
    animations: 'disabled',
    timeout: 60_000,
  })
  // A second click closes the pinned tip; Escape would close the whole dialog.
  await method.click()
  await expect(dialog).toBeVisible()
  const customTotal = await page.getByTestId('road-cost-total').innerText()
  await chooseOption(page, 'Rate preset', 'PG Maps placeholder rates')
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
  const region = page.getByRole('combobox', { name: 'BC natural resource region', exact: true })
  await expect
    .poll(() => optionLabels(region))
    .toEqual([
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
  await choose(region, { label: 'Cariboo' })
  // Cariboo has no comparable supplier price: the gap stays stated, and a winter-sand award is
  // listed apart from supplier prices instead of filling it.
  const local = page.getByTestId('road-bc-local-evidence')
  await expect(local).toContainText('Local quote required')
  await expect(local).toContainText('City of Williams Lake contract award')
  await expect(local).toContainText('Winter sand $34.86/m³')
  await expect(local).toContainText('93 Mile Aggregates')
  await expect(page.getByTestId('road-allowance-scope-interior-subgrade')).toContainText(
    'Pipe culverts under 950 mm and log culverts up to 3.4 m span',
  )
  const interiorDownload = page.getByRole('button', { name: 'Download Interior comparison JSON', exact: true })
  await expect(interiorDownload).toBeDisabled()
  // The region's candidate groups are marked in the list; none is chosen for the user.
  await chooseOption(
    page,
    'Interior road group',
    '4 · Cariboo supply blocks / Prince George G–H · candidate for Cariboo',
  )
  await page.getByRole('spinbutton', { name: 'Uphill side slope (%)', exact: true }).fill('30')
  await page.getByRole('spinbutton', { name: 'Section rock (%)', exact: true }).fill('20')
  await chooseOption(page, 'Interior road type', 'Long-term · raised subgrade and ditch')
  await chooseOption(page, 'Verified BEC zone', 'ESSF')
  await chooseOption(page, 'Absolute soil moisture', 'Wet')
  await page.getByRole('spinbutton', { name: 'Homogeneous section length (m, optional)', exact: true }).fill('1200')
  await expect(interiorDownload).toBeDisabled()
  await page.getByRole('button', { name: 'Confirm Interior benchmark applicability reviewed', exact: true }).click()
  await expect(page.getByTestId('road-interior-benchmark-result')).toContainText('$25,347 CAD/km · subgrade')
  // Stabilizing material is its own allowance beside the subgrade figure, never summed into it.
  const stabilization = page.getByTestId('road-interior-stabilization')
  await expect(stabilization).toContainText('$24,910 CAD/km')
  await stabilization.getByRole('button', { name: 'Ripped or quarry rock (+$4,277/km)', exact: true }).click()
  await expect(stabilization).toContainText('$29,187 CAD/km')
  await expect(page.getByTestId('road-interior-benchmark-result')).toContainText('$25,347 CAD/km · subgrade')
  const interior = await downloadJson<{
    schema: string
    result: { subgradePerKm: number; subgradeTotal: number }
    stabilization: { perKm: number; rippedOrQuarryRock: boolean }
  }>(page, interiorDownload)
  expect(interior.schema).toBe('pgmaps-bc-interior-cost-comparison-v1')
  expect(interior.result.subgradePerKm).toBe(25347)
  expect(interior.stabilization).toMatchObject({ perKm: 29187, rippedOrQuarryRock: true })
  expect(interior.result.subgradeTotal).toBeCloseTo(30416.4, 2)
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)
  await page.getByTestId('road-interior-benchmark-result').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('desktop-interior-comparison.png'),
    animations: 'disabled',
    timeout: 60_000,
  })

  await chooseOption(page, 'BC natural resource region', 'West Coast')
  const coastDownload = page.getByRole('button', { name: 'Download Coast comparison JSON', exact: true })
  await expect(coastDownload).toBeDisabled()
  await chooseOption(page, 'Coast construction category', 'MRK · Blasted rock face 1.51–3.00 m')
  await chooseOption(page, 'Coast rock hardness', 'Hard · RMC 5')
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
  await chooseOption(page, 'Coast point-of-origin area', 'Graham Island (GRIS) · +$7,548/km')
  await expect(page.getByTestId('road-coast-benchmark-result')).toContainText('$155,533 CAD/km')
  // Coast gets what Interior gets: the road's measured sidehill (here against the 150% screen, read
  // only) and an optional length that scales the $/km figure into a total.
  await expect(page.getByTestId('road-measured-sidehill-screen')).toContainText('150%')
  await page.getByRole('spinbutton', { name: 'Road length (m, optional)', exact: true }).fill('2000')
  await expect(page.getByTestId('road-coast-benchmark-result')).toContainText(
    '$311,065 CAD for the entered length, before escalation',
  )
  const coast = await downloadJson<{
    schema: string
    region: string
    inputs: { isolationFraction: number; pointOfOrigin: string; lengthM: number }
    result: { unitCostCadPerKm: number; totalCad: number }
    sidehillScreen: { limitPercent?: number; kind?: string }
  }>(page, coastDownload)
  expect(coast.region).toBe('West Coast')
  expect(coast.inputs.lengthM).toBe(2000)
  expect(coast.result.totalCad).toBeCloseTo(311065, 2)
  expect(coast.sidehillScreen).toBeTruthy()
  expect(coast.schema).toBe('pgmaps-bc-coast-cost-comparison-v1')
  expect(coast.inputs.isolationFraction).toBe(0.5)
  expect(coast.inputs.pointOfOrigin).toBe('GRIS')
  expect(coast.result.unitCostCadPerKm).toBe(155532.5)
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)
  await page.getByTestId('road-coast-benchmark-result').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('desktop-coast-comparison.png'),
    animations: 'disabled',
    timeout: 60_000,
  })

  // West Coast lists dated supplier prices, each folded row showing a price in its own unit.
  await expect(local).toContainText('Ronin Earthworks')
  await expect(local).toContainText('3/4-inch road base $17.60/t')
  await expect(page.getByTestId('road-allowance-scope-coast-culverts')).toContainText('Column A')

  // The evidence catalogue keeps every record in its own currency and never touches the estimate.
  const references = page.getByTestId('road-bc-cost-references')
  await local.getByTestId('road-bc-region-projects').click()
  const evidenceCount = page.getByTestId('road-cost-evidence-count')
  await expect(references.getByRole('tab', { name: 'Evidence', exact: true })).toHaveAttribute('aria-selected', 'true')
  // The link opens exactly the project records it counts, not the region's supplier prices too.
  await expect(evidenceCount).toHaveText('16 records from 6 sources')
  await expect(page.getByRole('combobox', { name: 'Evidence type', exact: true })).toHaveText(
    'Project records · every type',
  )
  await chooseOption(page, 'Where', 'Everywhere')
  await expect(evidenceCount).toHaveText('161 records from 38 sources')
  await chooseOption(page, 'Evidence type', 'Tender average')
  await expect(evidenceCount).toHaveText('8 records from 1 source')
  const tenderGroup = page.getByTestId('road-cost-evidence-group')
  await expect(tenderGroup).toContainText('$33.70/tonne')
  await expect(tenderGroup).toContainText('1,316,195 tonne · 28 contracts')
  await references.getByRole('button', { name: 'Worked estimates', exact: true }).click()
  const worked = page.getByTestId('road-cost-worked-estimate')
  await expect(worked).toContainText('US$17,555')
  await expect(worked).toContainText('US$20,889')
  await references.getByRole('tab', { name: 'Sources', exact: true }).click()
  await expect(page.getByTestId('road-bc-fuel-references')).toContainText('+$26.10/hour on-road')
  await expect(page.getByTestId('road-bc-fuel-references')).toContainText('$10.23/hour on-road')
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)

  // Quote conversions use their explicit volume basis and remain temporary comparison inputs.
  await page.getByTestId('road-bc-cost-references').getByRole('tab', { name: 'Unit rates', exact: true }).click()
  await chooseOption(page, 'Material quote unit', 'CAD per tonne')
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
  await page.screenshot({
    path: testInfo.outputPath('desktop-unit-rates.png'),
    animations: 'disabled',
    timeout: 60_000,
  })
  await expect(page.getByTestId('road-cost-total')).toHaveText(coveredTotal)
  await page.getByTestId('road-bc-cost-references').getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect(await saveProject(page)).toEqual(priced)
  expect(errors).toEqual([])
})

test('an evidence record is adopted into a project rate with its observation kept beside it', async ({
  page,
}, testInfo) => {
  const errors = await prepare(page)
  const before = await saveProject(page)
  expect(before.rateEvidence).toBeUndefined()

  const dialog = await openCosts(page)
  await page.getByTestId('road-bc-cost-toggle').click()
  const references = page.getByTestId('road-bc-cost-references')
  await references.getByRole('tab', { name: 'Evidence', exact: true }).click()
  // A funding reference shows what a programme pays: it offers no adoption.
  await chooseOption(page, 'Evidence type', 'Funding reference')
  await expect(page.getByTestId('road-cost-evidence-count')).toHaveText('3 records from 2 sources')
  await references.getByRole('button', { name: /Ireland forest road grants/ }).click()
  await expect(page.getByTestId('road-cost-evidence-group')).toContainText('Harvesting road grant ceiling')
  await expect(references.getByTestId('road-rate-adopt-open')).toHaveCount(0)

  await chooseOption(page, 'Evidence type', 'Tender average')
  const record = page
    .getByTestId('road-cost-evidence-group')
    .getByRole('listitem')
    .filter({ hasText: 'Granular Base Course — Des.2 Cl.25' })
  await expect(record).toContainText('$33.70/tonne')
  await record.getByTestId('road-rate-adopt-open').click()
  const form = record.getByTestId('road-rate-adopt-form')
  const save = form.getByTestId('road-rate-adopt-save')
  await expect(save).toBeDisabled()
  await chooseOption(page, 'Project rate to inform', 'Project rates · Surfacing rate · now $40.00/m³')
  // A tonne price is never turned into a cubic-metre rate: the field starts empty.
  const adopted = form.getByRole('spinbutton', { name: 'Adopted rate (CAD/m³)', exact: true })
  await expect(adopted).toHaveValue('')
  await expect(form.getByTestId('road-rate-adopt-basis')).toContainText('Nothing is converted')
  await adopted.fill('74')
  await expect(form.getByTestId('road-rate-adopt-problem')).toHaveText('Confirm the specification matches.')
  await form.getByRole('checkbox', { name: 'The specification matches', exact: true }).check()
  await expect(form.getByTestId('road-rate-adopt-problem')).toContainText('Say why the adopted rate differs')
  await expect(save).toBeDisabled()
  // Nothing has been written while the form is open. The cost dialog is behind this one, so it is
  // read by its row rather than by role.
  await expect(page.locator('[data-cost-row="surfacing"] input')).toHaveValue('40')
  const reason = '2.2 t per compacted m³ from the pit test report'
  await form.getByRole('textbox', { name: 'Reason for any adjustment', exact: true }).fill(reason)
  await page.screenshot({ path: testInfo.outputPath('desktop-rate-adoption-form.png'), animations: 'disabled' })
  await save.click()
  await expect(record.getByTestId('road-rate-adopt-saved')).toContainText('Surfacing rate set to $74.00/m³')
  await references.getByRole('button', { name: 'Close', exact: true }).click()

  // The cost dialog answers "why $74/m³ when the reference says $33.70/tonne?" on the row and below.
  await expect(dialog.getByRole('spinbutton', { name: 'Surfacing rate', exact: true })).toHaveValue('74')
  await expect(dialog.locator('[data-cost-row="surfacing"]').getByTestId('road-cost-rate-source')).toHaveText(
    'Rate adopted from $33.70/tonne · CAD · 2026',
  )
  const source = dialog.getByTestId('road-rate-sources-adopted').locator('[data-rate-source="surfacingRate"]')
  await expect(source).toContainText('Surfacing rate $74.00/m³ · reference $33.70/tonne · CAD · 2026')
  await expect(source).toContainText('Tender average · Granular Base Course — Des.2 Cl.25 · Alberta tender averages')
  await expect(source).toContainText(`Adjustment: ${reason}`)
  await page.screenshot({ path: testInfo.outputPath('desktop-rate-source.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  const saved = await saveProject(page)
  expect(saved.settings).toEqual({ ...before.settings, surfacingRate: 74 })
  expect(saved.rateEvidence).toEqual({
    surfacingRate: {
      rate: 74,
      observation: {
        recordId: 'alberta-upa-2026-3',
        kind: 'tender-average',
        title: 'Granular Base Course — Des.2 Cl.25',
        group: 'Alberta tender averages',
        place: 'Alberta, provincial highway projects',
        currency: 'CAD',
        amounts: { value: 33.7 },
        unit: '/tonne',
        costYear: 2026,
        url: 'https://www.alberta.ca/system/files/custom_downloaded_images/trans-unit-price-averages.xlsx',
        locator: "'2026 UPA '!B14:H14",
        checked: '2026-11-12',
        // Every term the record stated is frozen with it, and its place.
        terms: expect.arrayContaining([expect.objectContaining({ label: 'Tax' })]),
        where: { country: 'CA', subdivision: 'CA-AB' },
      },
      specificationConfirmed: true,
      reason,
      adoptedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      currency: 'CAD',
      // The surfacing rate prices supply through compaction; the form starts from that.
      includes: ['supply', 'processing', 'loading', 'haul', 'placement', 'compaction'],
      target: { label: 'Surfacing rate', unit: '/m³' },
    },
  })
  expect(saved.alignments).toEqual(before.alignments)

  // The rate and its source went in as one step, so one undo takes both back.
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  const undone = await saveProject(page)
  expect(undone.settings).toEqual(before.settings)
  expect(undone.rateEvidence).toBeUndefined()
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
    .poll(() => page.getByTestId('road-rate-sources').evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({
    path: testInfo.outputPath('phone-estimate-review.png'),
    animations: 'disabled',
    timeout: 60_000,
  })
  await page.getByTestId('road-bc-cost-toggle').click()
  await chooseOption(page, 'BC natural resource region', 'West Coast')
  await chooseOption(page, 'Coast construction category', 'OMLB · Other material — local ballast')
  await chooseOption(page, 'Coast rock hardness', 'Soft/medium · RMC 1–4')
  await page.getByRole('button', { name: 'Coast tabular-road eligibility reviewed', exact: true }).click()
  const result = page.getByTestId('road-coast-benchmark-result')
  const download = page.getByRole('button', { name: 'Download Coast comparison JSON', exact: true })
  await expect(download).toBeDisabled()
  await expect(result).toContainText('Choose a point-of-origin area')
  await expect(result).not.toContainText('CAD/km')
  await chooseOption(page, 'Coast point-of-origin area', 'Reviewed · no eligible origin addition')
  await result.scrollIntoViewIfNeeded()
  await expect(result).toContainText('$72,601 CAD/km')
  await expect(result).toBeInViewport()
  await download.scrollIntoViewIfNeeded()
  await expect(download).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('phone-coast-comparison.png'),
    animations: 'disabled',
    timeout: 60_000,
  })
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
  await page.getByTestId('road-bc-cost-references').getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(errors).toEqual([])
})

test('the cost location, own records, budget items, build-ups and low and high cases', async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000)
  const errors = await prepare(page)
  const before = await saveProject(page)
  for (const key of ['costLocation', 'costSchedule', 'rateBuildUps', 'costScenarios'] as const)
    expect(before[key]).toBeUndefined()

  // The training road is at Prince George: Omineca is offered from its points, and nothing is written yet.
  const dialog = await openCosts(page)
  const location = dialog.getByTestId('road-cost-location')
  await expect(location).toContainText('No cost location')
  await expect(location.getByTestId('road-cost-location-suggestion')).toHaveText('Omineca, British Columbia, Canada')
  await location.getByTestId('road-cost-location-use').click()
  await expect(dialog.getByTestId('road-cost-location-label')).toHaveText('Omineca, British Columbia, Canada')
  await expect(location).toContainText('CAD')

  // The references open on the project's region, its local prices first.
  await page.getByTestId('road-bc-cost-toggle').click()
  const references = page.getByTestId('road-bc-cost-references')
  await expect(page.getByRole('combobox', { name: 'BC natural resource region', exact: true })).toHaveText('Omineca')
  await expect(page.getByTestId('road-bc-local-evidence')).toContainText('GetGravel')

  // An own quote joins the evidence, marked as the person's, without entering the catalogue or project.
  await references.getByRole('tab', { name: 'My records', exact: true }).click()
  await page.getByTestId('road-user-record-add').click()
  const form = page.getByTestId('road-user-record-form')
  await form.getByRole('textbox', { name: 'Work or product', exact: true }).fill('Pit run, delivered to km 12')
  await form.getByRole('textbox', { name: 'Where', exact: true }).fill('Bobtail FSR km 12')
  await form.getByRole('spinbutton', { name: 'Amount (CAD)', exact: true }).fill('28')
  await form
    .getByRole('textbox', { name: 'What the price covers', exact: true })
    .fill('Supply and deliver, 300 m³ minimum')
  await page.getByTestId('road-user-record-save').click()
  await expect(page.getByTestId('road-user-cost-records')).toContainText('Pit run, delivered to km 12')

  await references.getByRole('tab', { name: 'Evidence', exact: true }).click()
  const evidenceCount = page.getByTestId('road-cost-evidence-count')
  await expect(evidenceCount).toHaveText('162 records from 39 sources')
  // Nearest the project first: the first group is in the project's own region.
  await expect(references.getByRole('button', { name: /GetGravel/ }).first()).toContainText('Same region')
  const search = page.locator('#road-cost-evidence-search')
  await search.fill('Pit run, delivered to km 12')
  await expect(page.getByTestId('road-cost-evidence-browser').getByTestId('road-cost-evidence-group')).toContainText(
    'Own record',
  )

  // A bundled price: the Canim Lake excavation reused on site includes placing, which the fill rate prices.
  await search.fill('Common excavation, reused')
  const reuse = page
    .getByTestId('road-cost-evidence-group')
    .getByRole('listitem')
    .filter({ hasText: 'Common excavation, reused on site' })
  await reuse.getByTestId('road-rate-adopt-open').click()
  const adopt = reuse.getByTestId('road-rate-adopt-form')
  await chooseOption(page, 'Project rate to inform', 'Project rates · Cut rate · now $12.00/m³')
  // Already in CAD per m³: the figure is offered as a start.
  await expect(adopt.getByRole('spinbutton', { name: 'Adopted rate (CAD/m³)', exact: true })).toHaveValue('50')
  await adopt.getByRole('checkbox', { name: 'Placing', exact: true }).check()
  await expect(adopt.getByTestId('road-rate-adopt-overlaps')).toContainText(
    'Placing is in this price and also in the fill rate (8/m³).',
  )
  await adopt.getByRole('checkbox', { name: 'The specification matches', exact: true }).check()
  await expect(adopt.getByTestId('road-rate-adopt-problem')).toContainText('say how you accounted for it')
  await adopt.getByRole('button', { name: 'Cancel', exact: true }).click()

  // A percentage from the same estimate starts a percentage budget item.
  await search.fill('Bonding and insurance')
  const bonding = page
    .getByTestId('road-cost-evidence-group')
    .getByRole('listitem')
    .filter({ hasText: 'Bonding and insurance' })
  await expect(bonding).toContainText('3% of works subtotal')
  await bonding.getByTestId('road-rate-adopt-open').click()
  await chooseOption(page, 'Project rate to inform', 'Project budget · Insurance and bonding · now not set')
  const bondingForm = bonding.getByTestId('road-rate-adopt-form')
  await expect(bondingForm.getByRole('spinbutton', { name: 'Adopted rate (%)', exact: true })).toHaveValue('3')
  await bondingForm.getByRole('checkbox', { name: 'The specification matches', exact: true }).check()
  await bondingForm.getByTestId('road-rate-adopt-save').click()
  await expect(bonding.getByTestId('road-rate-adopt-saved')).toContainText('Insurance and bonding set to 3%')

  // A saved build-up sets a rate with its formula beside it.
  await references.getByRole('tab', { name: 'Unit rates', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'All-in crew rate (CAD/hour)', exact: true }).fill('270')
  await page.getByRole('spinbutton', { name: 'Net production (bank m³/charged hour)', exact: true }).fill('20')
  await expect(page.getByTestId('road-equipment-unit-rate')).toHaveText('13.50 CAD/bank m³')
  await page.getByRole('textbox', { name: 'Equipment and crew build-up name', exact: true }).fill('Excavator crew')
  await page.getByTestId('road-build-up-save-equipment-button').click()
  const buildUps = page.getByTestId('road-build-ups')
  await expect(buildUps).toContainText('270/h ÷ 20 bank m³ an hour = 13.5 per bank m³')
  await chooseOption(page, 'Apply to', 'Project rates · Cut rate · now $12.00/m³')
  await buildUps.getByTestId('road-build-up-apply').click()
  await expect(page.getByTestId('road-build-up-message')).toContainText('Cut rate set to $13.50/m³ from Excavator crew')
  await references.getByRole('button', { name: 'Close', exact: true }).click()

  // The budget sits beside the estimate: the bonding item is priced off the construction total.
  const total = await dialog.getByTestId('road-cost-total').innerText()
  await dialog.getByTestId('road-project-budget-toggle').click()
  const budget = dialog.getByTestId('road-project-budget')
  const totalWhole = Math.round(Number(total.replace(/[^\d.]/g, '')))
  await expect(budget.getByTestId('road-project-budget-construction-estimate')).toHaveText(
    `$${totalWhole.toLocaleString('en-CA')}`,
  )
  await expect(budget.getByTestId('road-project-budget-project-items')).not.toHaveText('$0')
  await expect(budget.getByTestId('road-project-budget-not-assessed')).not.toHaveText('0')
  const rateSources = dialog.getByTestId('road-rate-sources-adopted')
  await expect(rateSources.locator('[data-rate-source="schedule:insurance-bonding"]')).toContainText(
    'Insurance and bonding 3%',
  )
  await expect(rateSources.locator('[data-rate-source="cutRate"]')).toContainText(
    'Build-up · Equipment and crew · Excavator crew',
  )

  // Low and high cases run on copies; the estimate does not move.
  await dialog.getByTestId('road-cost-scenarios-toggle').click()
  const scenarios = dialog.getByTestId('road-cost-scenarios')
  await scenarios.locator('[data-scenario-driver="excavation-rate"] input[type="checkbox"]').check()
  await scenarios.getByTestId('road-cost-scenarios-run').click()
  const row = scenarios.getByTestId('road-cost-scenarios-table').locator('[data-scenario-row="total"] td')
  await expect(row).toHaveCount(4)
  const money = async (index: number) => Number((await row.nth(index).innerText()).replace(/[^\d.]/g, ''))
  expect(await money(1)).toBeLessThan(await money(2))
  expect(await money(3)).toBeGreaterThan(await money(2))
  await expect(dialog.getByTestId('road-cost-total')).toHaveText(total)
  await page.screenshot({
    path: testInfo.outputPath('desktop-budget-and-cases.png'),
    animations: 'disabled',
    timeout: 60_000,
  })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  const saved = await saveProject(page)
  expect(saved.costLocation).toEqual({
    place: { country: 'CA', subdivision: 'CA-BC', region: 'bc-nr:omineca' },
    basis: 'road-location',
    setOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  })
  expect(saved.costSchedule?.entries).toEqual([
    { id: 'insurance-bonding', status: 'priced', basis: 'percent', percent: 3 },
  ])
  expect(saved.settings.cutRate).toBe(13.5)
  expect(Object.keys(saved.rateEvidence ?? {}).sort()).toEqual(['cutRate', 'schedule:insurance-bonding'])
  expect(saved.rateEvidence?.cutRate.buildUp).toMatchObject({ name: 'Excavator crew', kind: 'equipment', result: 13.5 })
  expect(saved.rateBuildUps?.map((item) => item.name)).toEqual(['Excavator crew'])
  expect(saved.costScenarios).toEqual({ drivers: { 'excavation-rate': { low: 0.9, high: 1.25 } } })
  // Own records stay in the browser, never in the project file.
  expect(JSON.stringify(saved)).not.toContain('Pit run, delivered')
  expect(saved.alignments).toEqual(before.alignments)
  expect(errors).toEqual([])
})

/** The active road's segments as the plan's `road-roads` source holds them (map state, not the legend). */
async function activeRoadSegments(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-roads')
        if (source?.type !== 'geojson') return null
        return (source.serialize().data as GeoJSON.FeatureCollection).features
          .map((feature) => feature.properties ?? {})
          .filter((properties) => properties.selected)
      }
    }
    return null
  })
}

test('a cost row opens where it falls, and a stretch takes the plan to its section coloured by cost', async ({
  page,
}) => {
  const errors = await prepare(page)
  const dialog = await openCosts(page)
  // The whole estimate and each placed row spread along the road.
  await dialog.getByRole('button', { name: 'Whole estimate', exact: true }).click()
  await expect(dialog.getByTestId('road-cost-where-it-falls').first()).toHaveAttribute('data-cost-series', 'total')
  const where = dialog.getByRole('button', { name: /^Where .+ falls$/ }).first()
  await where.click()
  await expect(where).toHaveAttribute('aria-expanded', 'true')
  const panel = dialog.locator('[data-cost-stretches] [data-testid="road-cost-where-it-falls"]')
  await expect(panel).toBeVisible()
  const rowId = await panel.getAttribute('data-cost-series')
  const stretch = panel.locator('li[data-cost-stretch]').first()
  const [start, end] = (await stretch.getAttribute('data-cost-stretch'))!.split('-').map(Number)
  await stretch.getByRole('button').click()
  await expect(dialog).not.toBeVisible()

  // The selected station is the stretch's costliest one, and the road is coloured by that row.
  await expect
    .poll(async () => Number(await page.getByLabel('Selected station metres', { exact: true }).inputValue()))
    .toBeGreaterThan(start)
  expect(Number(await page.getByLabel('Selected station metres', { exact: true }).inputValue())).toBeLessThanOrEqual(
    end + 1e-6,
  )
  await expect
    .poll(async () => (await activeRoadSegments(page))?.every((segment) => typeof segment.costClass === 'string'))
    .toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('pgmaps-road-colour-by'))).toBe('cost')
  const legend = page.getByTestId('road-plan-legend-content')
  await expect(legend.locator('[data-legend-section="roads"]')).toContainText('Cost per metre')
  if (rowId !== 'total') {
    await legend.getByRole('button', { name: 'Whole estimate', exact: true }).click()
    await expect(legend.locator('[data-legend-section="roads"]')).toContainText('Whole estimate')
  }
  expect(errors).toEqual([])
})

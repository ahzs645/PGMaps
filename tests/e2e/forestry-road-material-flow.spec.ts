import { expect, test, type Locator, type Page } from '@playwright/test'
import { createTrainingScenario } from '../../src/pages/dev-forestry-roads/scenarios'
import { alignmentLength, positionAt } from '../../src/pages/dev-forestry-roads/engine'
import { demoTerrain } from '../../src/pages/dev-forestry-roads/terrain'
import { createEngineeringDesign } from '../../src/pages/dev-forestry-roads/engineeringTypes'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.setTimeout(180_000)
async function activate(locator: Locator) {
  if ((locator.page().viewportSize()?.width ?? 0) >= 1000) await locator.click()
  else await locator.tap()
}
async function savedProject(page: Page): Promise<RoadProject> {
  await activate(page.getByRole('button', { name: 'Save', exact: true }))
  const pending = page.waitForEvent('download')
  await activate(page.getByRole('button', { name: 'Save project JSON', exact: true }))
  const chunks: Buffer[] = []
  const stream = await (await pending).createReadStream()
  for await (const part of stream!) chunks.push(Buffer.from(part))
  await activate(
    page
      .getByRole('dialog', { name: 'Save & export', exact: true })
      .getByRole('button', { name: 'Close', exact: true }),
  )
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function importProject(page: Page, project: RoadProject) {
  await activate(page.getByRole('button', { name: 'Open', exact: true }))
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'material-flow.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  // Import includes local persistence and analysis/rendering before busy clears.
  // Wait for that lifecycle within the existing overall test budget, rather
  // than treating a generic button action timeout as an import deadline.
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect
    .poll(
      async () => ({
        loading: await page.getByTestId('workspace-toast-loading').count(),
        saveEnabled: await save.isEnabled(),
      }),
      { timeout: 60_000, message: 'Imported road project finishes loading and enables saving' },
    )
    .toEqual({ loading: 0, saveEnabled: true })
  await expect(save).toBeEnabled()
  await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(project.activeAlignmentId)
  await expect(page.getByTestId('workspace-toast-error')).toHaveCount(0)
}
async function dialogFits(dialog: Locator) {
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const issues: string[] = []
        if (bounds.left < -1 || bounds.right > innerWidth + 1) issues.push('dialog outside viewport')
        for (const el of element.querySelectorAll('fieldset,input,select,button,p')) {
          const rect = el.getBoundingClientRect()
          if (rect.width && rect.height && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1))
            issues.push(
              `${el.tagName} ${(el.textContent ?? '').slice(0, 35)} ${Math.round(rect.left)}..${Math.round(rect.right)} outside ${Math.round(bounds.left)}..${Math.round(bounds.right)}`,
            )
          if (el.tagName === 'FIELDSET' && el.scrollWidth > el.clientWidth + 1) issues.push('fieldset overflows')
        }
        return issues
      }),
    )
    .toEqual([])
}
function fixture() {
  const p = createTrainingScenario('training-full-cost-access')
  const road = p.alignments[0],
    length = alignmentLength(road)
  road.template = { ...road.template, crossfallPercent: 0, ditchWidth: 0, ditchDepth: 0, cutSlope: 1, fillSlope: 1 }
  road.vertical = Array.from({ length: 11 }, (_, i) => ({
    id: `v${i}`,
    chainage: (length * i) / 10,
    elevation: demoTerrain.elevationAt(...positionAt(road, (length * i) / 10).coordinate) + 2,
    curveLength: 0,
  }))
  road.engineering = createEngineeringDesign()
  road.engineering.materials = [
    {
      id: 'test-rock',
      name: 'TEST rock',
      color: '#888888',
      cutRate: 10,
      reusableFraction: 1,
      compactionFactor: 0.9,
      quality: 90,
    },
  ]
  road.engineering.sites = [
    {
      id: 'test-pit',
      name: 'TEST supply',
      kind: 'borrow',
      chainage: 0,
      accessDistanceM: 10,
      capacityM3: null,
      unitRate: 10,
      fixedCost: 100,
      materialId: 'test-rock',
    },
    {
      id: 'test-spoil',
      name: 'TEST disposal',
      kind: 'waste',
      chainage: length,
      accessDistanceM: 10,
      capacityM3: null,
      unitRate: 2,
      fixedCost: 50,
    },
  ]
  road.engineering.haul = {
    ...road.engineering.haul,
    freeHaulDistanceM: 0,
    overhaulDistanceM: 0,
    freeHaulRate: 1,
    overhaulRate: 1,
    endHaulRate: 1,
  }
  p.name = 'TEST economic material workflow'
  p.alignments = [road]
  p.activeAlignmentId = road.id
  p.context = []
  p.cables = []
  p.settings.stationInterval = 20
  p.settings.crossSectionHalfWidth = 100
  return p
}

for (const size of [
  { name: 'desktop', width: 1512, height: 982 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(size.name, () => {
    test.use({
      serviceWorkers: 'block',
      hasTouch: true,
      isMobile: size.name === 'mobile',
      viewport: { width: size.width, height: size.height },
      actionTimeout: 20_000,
    })
    test('economic policies update quantities, fit the viewport and survive a fresh project import', async ({
      page,
    }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('https://basemaps.cartocdn.com/**', (route) =>
        route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
      )
      await page.goto('/dev/forestry/road-design?example=training')
      await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
      await importProject(page, fixture())
      const show = page.getByRole('button', { name: 'Show road controls', exact: true })
      if (await show.isVisible()) await activate(show)
      await activate(
        page
          .getByRole('tablist', { name: 'Road workflow', exact: true })
          .getByRole('tab', { name: 'Engineering', exact: true }),
      )
      await activate(
        page
          .getByRole('tablist', { name: 'Engineering inputs', exact: true })
          .getByRole('tab', { name: 'Haul', exact: true }),
      )
      await activate(page.getByRole('button', { name: 'Haul & cost settings', exact: true }))
      const dialog = page.getByRole('dialog', { name: 'Haul & cost settings', exact: true })
      await activate(dialog.getByRole('combobox', { name: 'Material allocation method', exact: true }))
      await activate(page.getByRole('option', { name: 'Economic material flow', exact: true }))
      await activate(dialog.getByRole('button', { name: 'Add fill requirement', exact: true }))
      await dialog.getByLabel('Permit substitution by quality', { exact: true }).check()
      await dialog.getByRole('spinbutton', { name: 'Requirement 1 minimum quality', exact: true }).fill('80')
      await activate(dialog.getByRole('button', { name: 'Add direction range', exact: true }))
      await expect(dialog.getByRole('combobox', { name: 'Direction 1 movement', exact: true })).toHaveValue('forward')
      await activate(dialog.getByRole('button', { name: 'Add sidecast range', exact: true }))
      await dialog.getByRole('spinbutton', { name: 'Sidecast 1 capacity (bank m³/m)', exact: true }).fill('1')
      await dialog.getByRole('spinbutton', { name: 'Sidecast 1 disposal ($/bank m³)', exact: true }).fill('0.5')
      await dialogFits(dialog)
      await page.screenshot({
        timeout: 60000,
        animations: 'disabled',
        path: info.outputPath(`${size.name}-material-policies.png`),
      })
      if (size.name === 'mobile') {
        await page.setViewportSize({ width: 320, height: 568 })
        await page.screenshot({
          timeout: 60000,
          animations: 'disabled',
          path: info.outputPath('mobile320-beforecheck.png'),
        })
        await dialogFits(dialog)
        await page.screenshot({
          timeout: 60000,
          animations: 'disabled',
          path: info.outputPath('mobile320-material-policies.png'),
        })
        await page.setViewportSize({ width: size.width, height: size.height })
      }
      await activate(dialog.getByRole('button', { name: 'Done', exact: true }))
      await activate(page.getByRole('button', { name: 'Show quantities & cost breakdown', exact: true }))
      const hide = page.getByRole('button', { name: 'Hide road controls', exact: true })
      if (await hide.isVisible()) await activate(hide)
      const panes = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
      if (await panes.isVisible()) await activate(panes.getByRole('tab', { name: 'Detail', exact: true }))
      const haulResults = page
        .getByRole('tablist', { name: 'Engineering results', exact: true })
        .getByRole('tab', { name: 'Haul', exact: true })
      if (size.name === 'mobile') await activate(haulResults)
      else await haulResults.click()
      await expect(page.getByTestId('road-haul-allocation-status')).toContainText('optimal')
      await expect(page.getByTestId('road-haul-transfers').locator('tbody tr')).not.toHaveCount(0)
      const saved = await savedProject(page),
        engineering = saved.alignments[0].engineering!
      expect(engineering.haul.allocation).toBe('economic')
      expect(engineering.fillRequirements?.[0]).toMatchObject({
        minQuality: 80,
        replaceable: true,
        materialId: 'test-rock',
      })
      expect(engineering.haul.directionRanges?.[0].direction).toBe('forward')
      expect(engineering.haul.sidecastRanges?.[0]).toMatchObject({ capacityBankM3PerM: 1, unitRate: 0.5 })
      await importProject(page, saved)
      expect(await savedProject(page)).toEqual(saved)
      expect(errors).toEqual([])
    })
  })
}

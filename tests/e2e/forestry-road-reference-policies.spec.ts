import { expect, test, type Page } from '@playwright/test'
import { createDemoProject } from '../../src/pages/dev-forestry-roads/terrain'
import { alignmentLength, positionAt } from '../../src/pages/dev-forestry-roads/engine'
import { DEFAULT_DRAINAGE_SETTINGS } from '../../src/pages/dev-forestry-roads/drainageRun'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import type { drainageComparisonsExport } from '../../src/pages/dev-forestry-roads/drainageSensitivity'
import { choose } from './road-select'

test.setTimeout(180_000)
async function prepare(page: Page, url = '/dev/forestry/road-design?example=training') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto(url)
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}
async function importProject(page: Page, bytes: Buffer) {
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'policy-comparison.road.json', mimeType: 'application/json', buffer: bytes })
  await expect(page.getByTestId('workspace-toast-loading')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByTestId('workspace-toast-error')).toHaveCount(0)
}
async function showDrainage(page: Page) {
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Detail', exact: true }).click()
  await choose(page.getByRole('combobox', { name: 'Road detail view', exact: true }), { label: 'Drainage' })
}
async function chooseOption(page: Page, control: string, value: string) {
  await choose(page.getByRole('combobox', { name: control, exact: true }), { label: value })
}
async function download(page: Page, name: string): Promise<Buffer> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
function fixture(): RoadProject {
  const project = createDemoProject()
  const road = project.alignments.find((a) => a.id === project.activeAlignmentId)!
  project.drainage = {
    settings: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 50, workingResolutionM: 5 },
    pourPoint: {
      coordinate: positionAt(road, alignmentLength(road) / 2).coordinate,
      snapRadiusM: 20,
      surface: 'existing',
    },
    records: [],
  }
  return project
}

for (const size of [
  { name: 'desktop', width: 1512, height: 982 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
      isMobile: size.name === 'phone',
      serviceWorkers: 'block',
      actionTimeout: 20_000,
    })
    test('drainage policies stale evidence and comparison runs survive a fresh import', async ({
      page,
      browser,
    }, info) => {
      const errors = await prepare(page)
      await importProject(page, Buffer.from(JSON.stringify(fixture())))
      await showDrainage(page)
      const panel = page.getByTestId('road-drainage')
      await expect(panel.getByLabel('Requested grid cell (m)', { exact: true })).toHaveValue('5')
      await panel.getByRole('button', { name: 'Run drainage check', exact: true }).click()
      await expect(panel.getByRole('region', { name: 'Selected catchment', exact: true })).toBeVisible({
        timeout: 60_000,
      })
      await panel.getByTestId('road-drainage-comparisons-toggle').click()
      await panel.getByLabel('Comparison label', { exact: true }).fill('Baseline')
      await panel.getByRole('button', { name: 'Save comparison run', exact: true }).click()
      await expect(panel.getByRole('article', { name: 'Comparison Baseline', exact: true })).toBeVisible()

      await chooseOption(page, 'Depression treatment', 'Preserve depressions')
      await chooseOption(page, 'Outlet snap policy', 'Lowest elevation')
      await panel.getByLabel('Requested grid cell (m)', { exact: true }).fill('10')
      await panel.getByLabel('Requested grid cell (m)', { exact: true }).press('Tab')
      await expect(panel.getByRole('button', { name: 'Export drainage evidence', exact: true })).toBeDisabled()
      await expect(panel.getByRole('button', { name: 'Save comparison run', exact: true })).toBeDisabled()
      await panel.getByRole('button', { name: 'Re-run drainage', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Save comparison run', exact: true })).toBeEnabled({
        timeout: 60_000,
      })
      await panel.getByLabel('Comparison label', { exact: true }).fill('Preserved basin')
      await panel.getByRole('button', { name: 'Save comparison run', exact: true }).click()
      const candidate = panel.getByRole('article', { name: 'Comparison Preserved basin', exact: true })
      await expect(candidate).toContainText('Depression treatment')
      await expect(candidate).toContainText('Snap policy')
      await expect(candidate).toContainText('Actual grid resolution')
      const comparisonBytes = await download(page, 'Export comparison evidence')
      const exported = JSON.parse(comparisonBytes.toString()) as ReturnType<typeof drainageComparisonsExport>
      expect(exported.status).toBe('historical-comparison')
      expect(exported.runs).toHaveLength(2)
      expect(exported.runs[0].record.grid.cellM).toBe(5)
      expect(exported.runs[1].record.settings.depressionPolicy).toEqual({ mode: 'preserve' })
      expect(exported.runs[1].record.grid.cellM).toBe(10)
      expect(exported.runs[1].record.selectedCatchment?.snapPolicy).toBe('lowest-elevation')
      expect(exported.runs[1].comparison.changedInputs).toContain('Snap policy')
      expect(exported.runs[0].record.selectedCatchment?.requestedCoordinate).toEqual(
        exported.runs[1].record.selectedCatchment?.requestedCoordinate,
      )
      await candidate.scrollIntoViewIfNeeded()
      expect(
        await candidate
          .locator('dd')
          .evaluateAll((values) => values.every((value) => value.scrollWidth <= value.clientWidth + 1)),
      ).toBe(true)
      await page.screenshot({ path: info.outputPath(`drainage-comparison-${size.name}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      const saved = await download(page, 'Save project JSON')
      const project = JSON.parse(saved.toString()) as RoadProject
      expect(project.drainage?.comparisons).toHaveLength(2)

      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        hasTouch: true,
        isMobile: size.name === 'phone',
        serviceWorkers: 'block',
      })
      try {
        const fresh = await context.newPage()
        const freshErrors = await prepare(fresh, page.url())
        await importProject(fresh, saved)
        await showDrainage(fresh)
        await expect(fresh.getByLabel('Requested grid cell (m)', { exact: true })).toHaveValue('10')
        await fresh.getByTestId('road-drainage-comparisons-toggle').click()
        await expect(fresh.getByRole('article', { name: 'Comparison Baseline', exact: true })).toBeVisible()
        await expect(fresh.getByRole('article', { name: 'Comparison Preserved basin', exact: true })).toContainText(
          'Preserve depressions',
        )
        await expect(
          fresh.getByRole('combobox', { name: 'Outlet snap policy', exact: true }),
        ).toHaveText('Lowest elevation')
        await expect(
          fresh.getByRole('combobox', { name: 'Depression treatment', exact: true }),
        ).toHaveText('Preserve depressions')
        const again = JSON.parse((await download(fresh, 'Export comparison evidence')).toString()) as ReturnType<
          typeof drainageComparisonsExport
        >
        expect(again.runs.map((r) => r.record)).toEqual(exported.runs.map((r) => r.record))
        expect(freshErrors).toEqual([])
      } finally {
        await context.close()
      }
      expect(errors).toEqual([])
    })
  })
}

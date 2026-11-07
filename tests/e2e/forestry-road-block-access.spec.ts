import { expect, test, type Page } from '@playwright/test'
import { createFullCostTrainingProject } from '../../src/pages/dev-forestry-roads/trainingFullCostScenario'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { expandRoadSection } from './road-sidebar'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(240_000)

async function openProject(page: Page, project: RoadProject) {
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (await pending).setFiles({
    name: 'block-access.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(project.activeAlignmentId, {
    timeout: 60_000,
  })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({ timeout: 60_000 })
}

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await openProject(page, createFullCostTrainingProject())
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
  await expandRoadSection(page, 'road-route-tools')
  return errors
}

test('grades by haul direction are set in the search tools and saved with the project', async ({ page }) => {
  const errors = await prepare(page)
  const haul = page.getByTestId('road-haul-grades')
  const direction = haul.getByRole('combobox', { name: 'Loaded haul direction', exact: true })
  await expect(haul.getByLabel('Empty uphill %', { exact: true })).toHaveCount(0)
  await direction.selectOption('end-to-start')
  await haul.getByLabel('Loaded uphill %', { exact: true }).fill('8')
  await haul.getByLabel('Loaded uphill %', { exact: true }).press('Tab')
  await haul.getByLabel('Empty uphill %', { exact: true }).fill('16')
  await haul.getByLabel('Empty uphill %', { exact: true }).press('Tab')

  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const saved = JSON.parse(await (await pending).createReadStream().then((stream) => readAll(stream!))) as RoadProject
  expect(saved.routeSearch?.haulGrades).toEqual({
    loadedDirection: 'end-to-start',
    maxLoadedUphillPercent: 8,
    maxLoadedDownhillPercent: null,
    maxEmptyUphillPercent: 16,
  })
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await direction.selectOption('off')
  await expect(haul.getByLabel('Empty uphill %', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a harvest block gets ranked access options to nearby FSRs, and the chosen one becomes a road', async ({
  page,
}, info) => {
  const errors = await prepare(page)
  const panel = page.getByTestId('road-block-access')
  await expect(panel.getByRole('combobox', { name: 'Harvest block', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Find access', exact: true }).click()

  const options = page.getByTestId('road-block-access-options').getByRole('radio')
  await expect(options.first()).toBeVisible({ timeout: 180_000 })
  await expect(options.first()).toHaveAttribute('aria-checked', 'true')
  await expect(options.first()).toContainText(/Steepest loaded uphill [\d.]+% · empty uphill [\d.]+%/)
  await expect(page.getByTestId('workspace-toast-error')).toHaveCount(0)
  const count = await options.count()
  if (count > 1) {
    await options.nth(1).click()
    await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect(options.first()).toHaveAttribute('aria-checked', 'false')
  }
  const chosen = (await page.locator('[data-access-option][aria-checked="true"] .font-medium').textContent()) ?? ''
  await page.screenshot({ path: info.outputPath('block-access-options.png') })

  const roads = page.getByLabel('Active road', { exact: true }).locator('option')
  const before = await roads.count()
  await panel.getByRole('button', { name: 'Add as road', exact: true }).click()
  await expect(roads).toHaveCount(before + 1)
  const active = page.getByLabel('Active road', { exact: true }).locator('option:checked')
  await expect(active).toContainText('block access')
  await expect(active).toContainText(chosen.replace(/^\d+\.\s*/, ''))
  await expect(page.getByTestId('road-block-access-options')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Draw block adds a harvest block rather than an avoidance area', async ({ page }) => {
  const errors = await prepare(page)
  const panel = page.getByTestId('road-block-access')
  const blocks = panel.getByRole('combobox', { name: 'Harvest block', exact: true }).locator('option')
  const before = await blocks.count()
  await panel.getByRole('button', { name: 'Draw block', exact: true }).click()
  await expect(page.getByTestId('pegging-feedback')).toContainText('Draw harvest block')
  const box = (await page.getByTestId('road-plan-view').locator('canvas').first().boundingBox())!
  for (const [x, y] of [
    [0.4, 0.4],
    [0.55, 0.4],
    [0.55, 0.55],
  ])
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
  await page.getByRole('button', { name: 'Finish block', exact: true }).click()
  await expect(blocks).toHaveCount(before + 1)
  await expect(blocks.last()).toHaveText(/^Harvest block \d+$/)
  expect(errors).toEqual([])
})

async function readAll(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}
